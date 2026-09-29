/**
 * Sky shader (world agent): Preetham daylight model (three.js Sky.js), plus
 *  - two METAR cloud layers (cumulus fields projected on horizontal planes at their real base heights, drifting
 *    with the wind, lit by the sun or the moon, dissolving into the haze with distance);
 *  - a night sky: moonlit/light-polluted gradient with the orange sodium glow of Bordeaux on the eastern horizon;
 *  - a moon halo.
 * `skyRadianceJS` mirrors the daylight part on the CPU for the fog/aerial-perspective colour.
 */
import * as THREE from 'three';

export const SKY_UNIFORMS = () => ({
  sunDir: { value: new THREE.Vector3(0, 1, 0) },
  moonDir: { value: new THREE.Vector3(0, -1, 0) },
  moonIllum: { value: 0 },
  rayleigh: { value: 1.5 },
  turbidity: { value: 3 },
  mieCoefficient: { value: 0.005 },
  mieDirectionalG: { value: 0.8 },
  skyExposure: { value: 0.022 },
  showSunDisc: { value: 1 },
  /** night sky: zenith colour, horizon colour (linear radiance) */
  nightZenith: { value: new THREE.Color(0.0016, 0.0022, 0.0042) },
  nightHorizon: { value: new THREE.Color(0.006, 0.0058, 0.0065) },
  cityGlow: { value: new THREE.Color(0.030, 0.016, 0.006) },
  cityDir: { value: new THREE.Vector2(1, 0) },
  nightFactor: { value: 0 },
  /** cloud layers: x base height (m above eye), y coverage (0..1), z density, w enabled */
  cloud0: { value: new THREE.Vector4(900, 0.2, 1, 0) },
  cloud1: { value: new THREE.Vector4(1370, 0.45, 1, 0) },
  cloudOffset: { value: new THREE.Vector2(0, 0) },
  cloudTime: { value: 0 },
  /** sun colour for cloud lighting (linear, transmittance) */
  sunColor: { value: new THREE.Color(1, 1, 1) },
  /** 1 while rendering the environment map (no sun disc, softer clouds) */
  envPass: { value: 0 },
});

export const SKY_VERT = /* glsl */ `
uniform vec3 sunDir;
uniform float rayleigh;
uniform float turbidity;
uniform float mieCoefficient;
varying vec3 vWorldPosition;
varying float vSunfade;
varying vec3 vBetaR;
varying vec3 vBetaM;
varying float vSunE;
const float e = 2.71828182845904523536028747135266249775724709369995957;
const vec3 totalRayleigh = vec3( 5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5 );
const vec3 MieConst = vec3( 1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14 );
const float cutoffAngle = 1.6110731556870734;
const float steepness = 1.5;
const float EE = 1000.0;
float sunIntensity( float zenithAngleCos ) {
  zenithAngleCos = clamp( zenithAngleCos, -1.0, 1.0 );
  return EE * max( 0.0, 1.0 - pow( e, -( ( cutoffAngle - acos( zenithAngleCos ) ) / steepness ) ) );
}
vec3 totalMie( float T ) {
  float c = ( 0.2 * T ) * 10E-18;
  return 0.434 * c * MieConst;
}
void main() {
  vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position.z = gl_Position.w;
  vec3 sd = normalize( sunDir );
  vSunE = sunIntensity( sd.y );
  vSunfade = 1.0 - clamp( 1.0 - exp( sd.y * 450000.0 / 450000.0 ), 0.0, 1.0 );
  float rayleighCoefficient = rayleigh - ( 1.0 * ( 1.0 - vSunfade ) );
  vBetaR = totalRayleigh * rayleighCoefficient;
  vBetaM = totalMie( turbidity ) * mieCoefficient;
}
`;

export const SKY_FRAG = /* glsl */ `
varying vec3 vWorldPosition;
varying float vSunfade;
varying vec3 vBetaR;
varying vec3 vBetaM;
varying float vSunE;
uniform vec3 sunDir;
uniform vec3 moonDir;
uniform float moonIllum;
uniform float mieDirectionalG;
uniform float skyExposure;
uniform float showSunDisc;
uniform vec3 nightZenith;
uniform vec3 nightHorizon;
uniform vec3 cityGlow;
uniform vec2 cityDir;
uniform float nightFactor;
uniform vec4 cloud0;
uniform vec4 cloud1;
uniform vec2 cloudOffset;
uniform float cloudTime;
uniform vec3 sunColor;
uniform float envPass;

const float pi = 3.141592653589793238462643383279502884197169;
const float rayleighZenithLength = 8.4E3;
const float mieZenithLength = 1.25E3;
const float sunAngularDiameterCos = 0.99996;
const float THREE_OVER_SIXTEENPI = 0.05968310365946075;
const float ONE_OVER_FOURPI = 0.07957747154594767;

float rayleighPhase( float cosTheta ) { return THREE_OVER_SIXTEENPI * ( 1.0 + pow( cosTheta, 2.0 ) ); }
float hgPhase( float cosTheta, float g ) {
  float g2 = pow( g, 2.0 );
  float inverse = 1.0 / pow( 1.0 - 2.0 * g * cosTheta + g2, 1.5 );
  return ONE_OVER_FOURPI * ( ( 1.0 - g2 ) * inverse );
}

// --- noise ---
vec2 hash2( vec2 p ) {
  vec3 q = fract( p.xyx * vec3( 0.1031, 0.1030, 0.0973 ) );
  q += dot( q, q.yzx + 33.33 );
  return fract( ( q.xx + q.yz ) * q.zy );
}
float gnoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  vec2 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
  float a = dot( hash2( i ) * 2.0 - 1.0, f );
  float b = dot( hash2( i + vec2( 1, 0 ) ) * 2.0 - 1.0, f - vec2( 1, 0 ) );
  float c = dot( hash2( i + vec2( 0, 1 ) ) * 2.0 - 1.0, f - vec2( 0, 1 ) );
  float d = dot( hash2( i + vec2( 1, 1 ) ) * 2.0 - 1.0, f - vec2( 1, 1 ) );
  return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y ) * 1.4 + 0.5;
}
float fbm( vec2 p ) {
  float r = 0.0, a = 0.5;
  mat2 rot = mat2( 0.8, 0.6, -0.6, 0.8 );
  for ( int i = 0; i < 5; i ++ ) { r += a * gnoise( p ); p = rot * p * 2.03 + 17.1; a *= 0.5; }
  return r;
}
// cellular noise: isolated cumulus cells
float cells( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  float d = 1e9;
  for ( int y = -1; y <= 1; y ++ ) for ( int x = -1; x <= 1; x ++ ) {
    vec2 g = vec2( x, y );
    vec2 o = hash2( i + g );
    vec2 r = g + o - f;
    d = min( d, dot( r, r ) );
  }
  return 1.0 - sqrt( d );
}

// Cumulus density at a point of a layer (p in metres).
float cloudDensity( vec2 p, float coverage ) {
  vec2 q = p / 2600.0;
  float c = cells( q ) ;                                  // one cell ~ 2.6 km: individual cumulus
  float big = gnoise( p / 9000.0 );                       // clusters / gaps
  float detail = fbm( p / 520.0 + cloudTime * 0.002 );    // cauliflower edges
  float v = c * 0.75 + big * 0.35 + ( detail - 0.5 ) * 0.55;
  float thr = 1.02 - coverage * 0.62;
  return smoothstep( thr, thr + 0.16, v );
}

vec4 cloudLayer( vec3 dir, vec4 L, vec3 skyCol, vec3 sunLight, vec3 ambient ) {
  if ( L.w < 0.5 || dir.y < 0.004 ) return vec4( 0.0 );
  float t = L.x / dir.y;                                  // distance to the cloud base (m)
  if ( t > 60000.0 ) return vec4( 0.0 );
  vec2 p = dir.xz * t + cloudOffset;
  float d = cloudDensity( p, L.y );
  if ( d <= 0.001 ) return vec4( 0.0 );
  // self shadowing: density a bit toward the sun (thicker => darker base)
  vec3 sd = normalize( sunDir );
  vec2 toSun = sd.xz / max( 0.25, sd.y ) * 180.0;
  float ds = cloudDensity( p + toSun, L.y );
  float base = mix( 1.0, 0.45, clamp( d * 1.2, 0.0, 1.0 ) );      // flat, darker bases seen from below
  float lit = clamp( 1.0 - ( ds - d * 0.6 ) * 1.1, 0.25, 1.0 );
  float cosT = dot( dir, sd );
  float silver = pow( max( cosT, 0.0 ), 12.0 ) * ( 1.0 - d ) * 3.0;  // forward-scattered rims near the sun
  vec3 col = ambient * ( 0.55 + 0.45 * base ) + sunLight * ( 0.35 * lit * base + 0.5 * lit * ( 1.0 - base ) + silver );
  // aerial perspective: distant clouds melt into the sky
  float fade = exp( -t / 22000.0 );
  float alpha = clamp( d * L.z, 0.0, 1.0 ) * smoothstep( 0.004, 0.05, dir.y );
  col = mix( skyCol, col, fade );
  return vec4( col, alpha * mix( 0.6, 1.0, fade ) );
}

void main() {
  vec3 direction = normalize( vWorldPosition - cameraPosition );
  vec3 sd = normalize( sunDir );
  // --- Preetham ---
  vec3 dirA = vec3( direction.x, max( direction.y, 0.0 ), direction.z );
  float zenithAngle = acos( max( 0.0, dirA.y ) );
  float inverse = 1.0 / ( cos( zenithAngle ) + 0.15 * pow( 93.885 - ( ( zenithAngle * 180.0 ) / pi ), -1.253 ) );
  float sR = rayleighZenithLength * inverse;
  float sM = mieZenithLength * inverse;
  vec3 Fex = exp( -( vBetaR * sR + vBetaM * sM ) );
  float cosTheta = dot( direction, sd );
  float rPhase = rayleighPhase( cosTheta * 0.5 + 0.5 );
  vec3 betaRTheta = vBetaR * rPhase;
  float mPhase = hgPhase( cosTheta, mieDirectionalG );
  vec3 betaMTheta = vBetaM * mPhase;
  vec3 Lin = pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * ( 1.0 - Fex ), vec3( 1.5 ) );
  Lin *= mix( vec3( 1.0 ), pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * Fex, vec3( 1.0 / 2.0 ) ), clamp( pow( 1.0 - sd.y, 5.0 ), 0.0, 1.0 ) );
  vec3 L0 = vec3( 0.1 ) * Fex;
  vec3 day = ( Lin + L0 ) * skyExposure;

  // --- night sky ---
  float h = max( direction.y, 0.0 );
  vec3 night = mix( nightHorizon, nightZenith, pow( h, 0.45 ) );
  float toCity = max( 0.0, dot( normalize( direction.xz + 1e-5 ), cityDir ) );
  night += cityGlow * exp( -h * 9.0 ) * ( 0.35 + 0.65 * toCity * toCity );
  vec3 md = normalize( moonDir );
  float cm = max( dot( direction, md ), 0.0 );
  night += vec3( 0.55, 0.62, 0.78 ) * moonIllum * ( pow( cm, 60.0 ) * 0.02 + pow( cm, 6.0 ) * 0.0035 ) * step( -0.05, md.y );
  vec3 col = day * ( 1.0 - nightFactor * 0.85 ) + night * nightFactor;

  // --- clouds ---
  vec3 sunLight = sunColor * skyExposure * 26.0 * smoothstep( -0.10, 0.08, sd.y );
  vec3 ambient = day * 1.4 + night * 1.8 + vec3( 0.55, 0.62, 0.78 ) * moonIllum * 0.004 * nightFactor;
  vec4 c0 = cloudLayer( direction, cloud0, col, sunLight, ambient );
  vec4 c1 = cloudLayer( direction, cloud1, col, sunLight, ambient );
  // higher layer first, lower layer in front
  col = mix( col, c1.rgb, c1.a );
  col = mix( col, c0.rgb, c0.a );
  float cloudOcc = max( c0.a, c1.a );

  // --- sun disc ---
  float sundisc = smoothstep( sunAngularDiameterCos, sunAngularDiameterCos + 0.00002, cosTheta ) * showSunDisc * ( 1.0 - envPass );
  col += sundisc * sunColor * 60.0 * ( 1.0 - cloudOcc );

  // below the horizon: haze colour (only seen in the environment map / at the far edge of the ground)
  if ( direction.y < 0.0 ) {
    col = mix( col, day * 0.9 + night * nightFactor, clamp( -direction.y * 20.0, 0.0, 1.0 ) );
  }
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ------------------------------------------------------------------------------------------------------------
// CPU mirror of the daylight model (horizon colours for fog / ground bounce).

const totalRayleigh = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MieConst = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];

export interface SkyParams {
  sunDir: THREE.Vector3;
  rayleigh: number;
  turbidity: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  skyExposure: number;
}

export function skyRadianceJS(dir: THREE.Vector3, p: SkyParams, out = new THREE.Color()): THREE.Color {
  const sd = p.sunDir.clone().normalize();
  const zc = Math.max(-1, Math.min(1, sd.y));
  const vSunE = 1000 * Math.max(0, 1 - Math.exp(-((1.6110731556870734 - Math.acos(zc)) / 1.5)));
  const vSunfade = 1 - Math.max(0, Math.min(1, 1 - Math.exp(sd.y)));
  const rc = p.rayleigh - (1 - vSunfade);
  const bR = totalRayleigh.map((v) => v * rc);
  const c = 0.2 * p.turbidity * 10e-18;
  const bM = MieConst.map((v) => 0.434 * c * v * p.mieCoefficient);
  const dy = Math.max(dir.y, 0);
  const za = Math.acos(dy);
  const inv = 1 / (Math.cos(za) + 0.15 * Math.pow(93.885 - (za * 180) / Math.PI, -1.253));
  const sR = 8.4e3 * inv, sM = 1.25e3 * inv;
  const cosT = dir.x * sd.x + dir.y * sd.y + dir.z * sd.z;
  const rPhase = (3 / (16 * Math.PI)) * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
  const g = p.mieDirectionalG;
  const mPhase = (1 / (4 * Math.PI)) * ((1 - g * g) / Math.pow(1 - 2 * g * cosT + g * g, 1.5));
  const res = [0, 0, 0];
  const mixK = Math.max(0, Math.min(1, Math.pow(1 - sd.y, 5)));
  for (let i = 0; i < 3; i++) {
    const Fex = Math.exp(-(bR[i] * sR + bM[i] * sM));
    const ratio = (bR[i] * rPhase + bM[i] * mPhase) / (bR[i] + bM[i]);
    let Lin = Math.pow(vSunE * ratio * (1 - Fex), 1.5);
    Lin *= 1 + (Math.pow(vSunE * ratio * Fex, 0.5) - 1) * mixK;
    res[i] = (Lin + 0.1 * Fex) * p.skyExposure;
  }
  return out.setRGB(res[0], res[1], res[2]);
}
