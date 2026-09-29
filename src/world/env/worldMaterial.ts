/**
 * World material patch (world agent).
 *
 * Every exterior material of the world module (airport, buildings, vehicles, exterior aircraft) is patched with
 * `patchWorldMaterial` to add, on top of three.js lighting:
 *  - two static "sun" shadow cascades (stand area ±60 m and airport ±600 m) rendered rarely by `FarShadows`, applied
 *    to the directional key light. The key light's own three.js shadow map is a tight box around the cockpit only
 *    (crisp shadows on the panels), so exterior surfaces need their own shadowing;
 *  - analytic lights that only the exterior receives: apron floodlight masts (night) and the aircraft exterior
 *    lights (taxi / take-off / runway turn-off / landing / wing / logo spots, beacons and strobes). They cost no
 *    extra three.js lights, so the cockpit shaders (several hundred draw calls) are unaffected.
 */
import * as THREE from 'three';

export const N_FLOOD = 12;
export const N_ACL = 14;

const v4 = (n: number) => Array.from({ length: n }, () => new THREE.Vector4());
const v3 = (n: number) => Array.from({ length: n }, () => new THREE.Vector3());

/** Shared uniform objects (the same objects are referenced by every patched material). */
export const WU = {
  wlShadowNear: { value: null as THREE.Texture | null },
  wlShadowNearMat: { value: new THREE.Matrix4() },
  wlShadowFar: { value: null as THREE.Texture | null },
  wlShadowFarMat: { value: new THREE.Matrix4() },
  /** x: shadows enabled, y: near cascade texel size (world m), z: far texel size, w: unused */
  wlShadowParams: { value: new THREE.Vector4(0, 0.05, 0.5, 0) },
  /** xyz position (world), w range (m) */
  wlFloodPos: { value: v4(N_FLOOD) },
  /** xyz direction, w cos(outer half-angle) */
  wlFloodDir: { value: v4(N_FLOOD) },
  /** radiant intensity (rgb), 0 = off */
  wlFloodCol: { value: v3(N_FLOOD) },
  wlAclPos: { value: v4(N_ACL) },
  /** xyz direction, w cos(outer half-angle); w < -1.5 = omnidirectional */
  wlAclDir: { value: v4(N_ACL) },
  wlAclCol: { value: v3(N_ACL) },
  wlLightsOn: { value: new THREE.Vector2(0, 0) }, // x floods on, y aircraft lights on
};

const VERT_PARS = /* glsl */ `
varying vec3 vWlPos;
`;
const VERT_MAIN = /* glsl */ `
{
  vec4 wlp = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    wlp = batchingMatrix * wlp;
  #endif
  #ifdef USE_INSTANCING
    wlp = instanceMatrix * wlp;
  #endif
  vWlPos = ( modelMatrix * wlp ).xyz;
}
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vWlPos;
uniform sampler2DShadow wlShadowNear;
uniform mat4 wlShadowNearMat;
uniform sampler2DShadow wlShadowFar;
uniform mat4 wlShadowFarMat;
uniform vec4 wlShadowParams;
uniform vec4 wlFloodPos[ ${N_FLOOD} ];
uniform vec4 wlFloodDir[ ${N_FLOOD} ];
uniform vec3 wlFloodCol[ ${N_FLOOD} ];
uniform vec4 wlAclPos[ ${N_ACL} ];
uniform vec4 wlAclDir[ ${N_ACL} ];
uniform vec3 wlAclCol[ ${N_ACL} ];
uniform vec2 wlLightsOn;

float wlSample( sampler2DShadow map, mat4 m, vec3 p, float texel, out float inside ) {
  vec4 sc = m * vec4( p, 1.0 );
  vec3 c = sc.xyz / sc.w;
  inside = step( 0.0, c.x ) * step( c.x, 1.0 ) * step( 0.0, c.y ) * step( c.y, 1.0 ) * step( c.z, 1.0 );
  if ( inside < 0.5 ) return 1.0;
  float o = 0.7 / 2048.0;
  float s = texture( map, vec3( c.xy + vec2( -o, -o ), c.z ) );
  s += texture( map, vec3( c.xy + vec2( o, -o ), c.z ) );
  s += texture( map, vec3( c.xy + vec2( -o, o ), c.z ) );
  s += texture( map, vec3( c.xy + vec2( o, o ), c.z ) );
  return s * 0.25;
}

float wlSunShadow( vec3 wn ) {
  if ( wlShadowParams.x < 0.5 ) return 1.0;
  float inN, inF;
  vec3 pn = vWlPos + wn * ( wlShadowParams.y * 1.5 );
  float sN = wlSample( wlShadowNear, wlShadowNearMat, pn, wlShadowParams.y, inN );
  if ( inN > 0.5 ) {
    // fade to the far cascade near the border of the near one
    vec4 sc = wlShadowNearMat * vec4( pn, 1.0 );
    vec2 e = abs( sc.xy - 0.5 ) * 2.0;
    float edge = smoothstep( 0.85, 1.0, max( e.x, e.y ) );
    if ( edge <= 0.0 ) return sN;
    float sF = wlSample( wlShadowFar, wlShadowFarMat, vWlPos + wn * ( wlShadowParams.z * 1.5 ), wlShadowParams.z, inF );
    return mix( sN, sF, edge );
  }
  return wlSample( wlShadowFar, wlShadowFarMat, vWlPos + wn * ( wlShadowParams.z * 1.5 ), wlShadowParams.z, inF );
}
`;

// Custom analytic lights, evaluated with the physical BRDF (RE_Direct) right after three's own lights.
const FRAG_LIGHTS = /* glsl */ `
{
  vec3 wlN = inverseTransformDirection( geometryNormal, viewMatrix );
  IncidentLight wl;
  wl.visible = true;
  if ( wlLightsOn.x > 0.5 ) {
    #pragma unroll_loop_start
    for ( int i = 0; i < ${N_FLOOD}; i ++ ) {
      if ( wlFloodCol[ i ].r + wlFloodCol[ i ].g + wlFloodCol[ i ].b > 0.0 ) {
        vec3 L = wlFloodPos[ i ].xyz - vWlPos;
        float d2 = dot( L, L );
        float d = sqrt( d2 );
        vec3 l = L / d;
        float cd = dot( -l, wlFloodDir[ i ].xyz );
        float spot = smoothstep( wlFloodDir[ i ].w, mix( wlFloodDir[ i ].w, 1.0, 0.35 ), cd );
        float rr = d / wlFloodPos[ i ].w;
        float att = spot / max( d2, 4.0 ) * clamp( 1.0 - rr * rr * rr * rr, 0.0, 1.0 );
        wl.direction = normalize( ( viewMatrix * vec4( l, 0.0 ) ).xyz );
        wl.color = wlFloodCol[ i ] * att;
        RE_Direct( wl, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
      }
    }
    #pragma unroll_loop_end
  }
  if ( wlLightsOn.y > 0.5 ) {
    #pragma unroll_loop_start
    for ( int i = 0; i < ${N_ACL}; i ++ ) {
      if ( wlAclCol[ i ].r + wlAclCol[ i ].g + wlAclCol[ i ].b > 0.0 ) {
        vec3 L = wlAclPos[ i ].xyz - vWlPos;
        float d2 = dot( L, L );
        float d = sqrt( d2 );
        vec3 l = L / d;
        float spot = 1.0;
        if ( wlAclDir[ i ].w > -1.5 ) {
          float cd = dot( -l, wlAclDir[ i ].xyz );
          spot = smoothstep( wlAclDir[ i ].w, mix( wlAclDir[ i ].w, 1.0, 0.5 ), cd );
        }
        float rr = d / wlAclPos[ i ].w;
        float att = spot / max( d2, 0.25 ) * clamp( 1.0 - rr * rr * rr * rr, 0.0, 1.0 );
        wl.direction = normalize( ( viewMatrix * vec4( l, 0.0 ) ).xyz );
        wl.color = wlAclCol[ i ] * att;
        RE_Direct( wl, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
      }
    }
    #pragma unroll_loop_end
  }
}
`;

export interface PatchOptions {
  /** Receive the far sun shadows (default true). */
  shadows?: boolean;
  /** Receive the analytic lights (default true). */
  lights?: boolean;
  /** Extra onBeforeCompile hook run after the world patch. */
  extra?: (shader: THREE.WebGLProgramParametersWithUniforms) => void;
  /** Cache key suffix when `extra` changes the shader. */
  key?: string;
}

/** Patch a MeshStandardMaterial / MeshPhysicalMaterial (or a subclass) in place. */
export function patchWorldMaterial<T extends THREE.Material>(mat: T, opts: PatchOptions = {}): T {
  const shadows = opts.shadows !== false;
  const lights = opts.lights !== false;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, WU);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_MAIN);
    let fs = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_PARS);
    if (shadows) {
      // Inline the lights chunk so the directional loop can be patched: the far cascades apply to every
      // directional light (the key light is the only one in the scene).
      fs = fs.replace(
        '#include <lights_fragment_begin>',
        'float wlSunSh = wlSunShadow( inverseTransformDirection( normal, viewMatrix ) );\n' +
          THREE.ShaderChunk.lights_fragment_begin.replace(
            'getDirectionalLightInfo( directionalLight, directLight );',
            'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= wlSunSh;',
          ),
      );
    }
    if (lights) fs = fs.replace('#include <lights_fragment_maps>', FRAG_LIGHTS + '\n#include <lights_fragment_maps>');
    shader.fragmentShader = fs;
    opts.extra?.(shader);
  };
  const baseKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => baseKey() + `|wl${shadows ? 1 : 0}${lights ? 1 : 0}${opts.key ?? ''}`;
  mat.needsUpdate = true;
  return mat;
}
