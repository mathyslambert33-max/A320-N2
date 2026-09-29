/**
 * Sky dome, stars, moon and the PMREM environment (world agent).
 */
import * as THREE from 'three';
import { SKY_FRAG, SKY_UNIFORMS, SKY_VERT, skyRadianceJS, type SkyParams } from './skyShader';
import { equatorialToVec } from '../astro';

const SKY_SIZE = 50000;
const STAR_R = 42000;

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SkySystem {
  readonly uniforms = SKY_UNIFORMS();
  readonly mesh: THREE.Mesh;
  readonly stars: THREE.Points;
  readonly moon: THREE.Mesh;
  private readonly starMat: THREE.ShaderMaterial;
  private readonly moonMat: THREE.ShaderMaterial;
  private readonly envScene = new THREE.Scene();
  private readonly envGround: THREE.Mesh;
  private readonly pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  /** Equatorial unit vectors of the stars (RA/Dec), rotated to the local sky each update. */
  private readonly starEq: Float32Array;
  readonly group = new THREE.Group();

  constructor(private renderer: THREE.WebGLRenderer) {
    const mat = new THREE.ShaderMaterial({
      name: 'WorldSky',
      uniforms: this.uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    this.mesh.scale.setScalar(SKY_SIZE);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'world-sky';

    // --- stars: ~1400 stars down to magnitude 5, with a few bright ones; colour by temperature ---
    const r = rng(20260927);
    const n = 1400;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const mag = new Float32Array(n);
    this.starEq = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const ra = r() * 360;
      const dec = (Math.asin(r() * 2 - 1) * 180) / Math.PI;
      this.starEq[2 * i] = ra;
      this.starEq[2 * i + 1] = dec;
      // cumulative count N(<m) ~ 10^(0.45 m): invert for a magnitude
      mag[i] = Math.min(5.2, Math.log10(1 + r() * Math.pow(10, 0.45 * 5.2)) / 0.45 - 0.6 + (i < 12 ? -0.8 : 0));
      const t = r();
      const c = t < 0.15 ? [0.75, 0.82, 1.0] : t < 0.7 ? [1.0, 0.97, 0.92] : t < 0.9 ? [1.0, 0.88, 0.7] : [1.0, 0.75, 0.55];
      col.set(c, i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    sg.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
    this.starMat = new THREE.ShaderMaterial({
      name: 'WorldStars',
      uniforms: { visibility: { value: 0 }, pxScale: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float mag;
        attribute vec3 color;
        uniform float visibility;
        uniform float pxScale;
        varying vec3 vCol;
        void main() {
          vec3 d = normalize( position );
          // extinction near the horizon + light pollution: faint stars vanish first
          float ext = smoothstep( 0.0, 0.25, d.y );
          float limit = mix( 1.5, 4.6, ext );
          float b = clamp( ( limit - mag ) / 2.5, 0.0, 1.0 );
          vCol = color * b * b * visibility * 1.6;
          gl_PointSize = ( 1.2 + max( 0.0, 3.0 - mag ) * 0.9 ) * pxScale;
          vec4 mv = modelViewMatrix * vec4( position, 1.0 );
          gl_Position = projectionMatrix * mv;
          gl_Position.z = gl_Position.w * 0.99999;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vCol;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a = exp( -dot( c, c ) * 14.0 );
          gl_FragColor = vec4( vCol * a, 1.0 );
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -999;
    this.stars.name = 'world-stars';

    // --- moon: billboard with an analytic lit sphere (phase from the sun direction) ---
    this.moonMat = new THREE.ShaderMaterial({
      name: 'WorldMoon',
      uniforms: { sunDir: this.uniforms.sunDir, moonDir: this.uniforms.moonDir, visibility: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
          gl_Position.z = gl_Position.w * 0.99998;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 sunDir;
        uniform vec3 moonDir;
        uniform float visibility;
        varying vec2 vUv;
        float h( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }
        float n( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( h( i ), h( i + vec2( 1, 0 ) ), f.x ), mix( h( i + vec2( 0, 1 ) ), h( i + vec2( 1, 1 ) ), f.x ), f.y ); }
        void main() {
          float r2 = dot( vUv, vUv );
          if ( r2 > 1.0 ) discard;
          vec3 nrm = vec3( vUv, sqrt( 1.0 - r2 ) );          // sphere normal in billboard space (z toward viewer)
          // sun direction in billboard space: billboard z axis = -moonDir (toward the viewer)
          vec3 z = -normalize( moonDir );
          vec3 x = normalize( cross( vec3( 0.0, 1.0, 0.0 ), z ) );
          vec3 y = cross( z, x );
          vec3 s = normalize( vec3( dot( sunDir, x ), dot( sunDir, y ), dot( sunDir, z ) ) );
          float lit = smoothstep( -0.03, 0.08, dot( nrm, s ) );
          float maria = n( vUv * 3.1 + 2.0 ) * 0.6 + n( vUv * 7.3 ) * 0.4;
          float albedo = mix( 0.62, 1.0, smoothstep( 0.35, 0.6, maria ) );
          vec3 c = vec3( 1.0, 0.97, 0.9 ) * albedo * lit * 0.9 + vec3( 0.01, 0.012, 0.018 );
          gl_FragColor = vec4( c * visibility, 1.0 );
        }`,
      depthWrite: false,
      fog: false,
      transparent: true,
    });
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.moonMat);
    this.moon.frustumCulled = false;
    this.moon.renderOrder = -998;
    this.moon.name = 'world-moon';

    this.group.name = 'world-sky-group';
    this.group.add(this.mesh, this.stars, this.moon);

    // environment capture scene: the same sky + a ground disc with the average apron/grass colour
    const envSky = new THREE.Mesh(this.mesh.geometry, mat);
    envSky.scale.setScalar(SKY_SIZE);
    this.envGround = new THREE.Mesh(
      new THREE.CircleGeometry(20000, 48).rotateX(-Math.PI / 2).translate(0, -4, 0),
      new THREE.MeshBasicMaterial({ color: 0x333333, fog: false }),
    );
    this.envScene.add(envSky, this.envGround);
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  params(): SkyParams {
    const u = this.uniforms;
    return {
      sunDir: u.sunDir.value,
      rayleigh: u.rayleigh.value,
      turbidity: u.turbidity.value,
      mieCoefficient: u.mieCoefficient.value,
      mieDirectionalG: u.mieDirectionalG.value,
      skyExposure: u.skyExposure.value,
    };
  }

  /** Average horizon radiance around the compass (for fog) + a LUT texture per azimuth. */
  horizonColor(azimuthDeg: number, out = new THREE.Color()): THREE.Color {
    const a = (azimuthDeg * Math.PI) / 180;
    const d = new THREE.Vector3(Math.sin(a) * 0.999, 0.035, -Math.cos(a) * 0.999).normalize();
    skyRadianceJS(d, this.params(), out);
    const nf = this.uniforms.nightFactor.value;
    out.multiplyScalar(1 - nf * 0.85);
    const nh = this.uniforms.nightHorizon.value;
    const cg = this.uniforms.cityGlow.value;
    const cd = this.uniforms.cityDir.value;
    const toCity = Math.max(0, Math.sin(a) * cd.x - Math.cos(a) * cd.y);
    const k = Math.exp(-0.035 * 9) * (0.35 + 0.65 * toCity * toCity);
    out.r += (nh.r + cg.r * k) * nf;
    out.g += (nh.g + cg.g * k) * nf;
    out.b += (nh.b + cg.b * k) * nf;
    return out;
  }

  /** Place the sky elements around the camera, rotate the stars. */
  update(camPos: THREE.Vector3, lstDeg: number, latDeg: number, pxScale: number) {
    this.mesh.position.copy(camPos);
    this.stars.position.copy(camPos);
    // stars: rotate equatorial → local each update (1400 stars, cheap at the update rate used)
    const pos = this.stars.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < this.starEq.length / 2; i++) {
      const v = equatorialToVec(this.starEq[2 * i], this.starEq[2 * i + 1], lstDeg, latDeg);
      arr[3 * i] = v[0] * STAR_R;
      arr[3 * i + 1] = v[1] * STAR_R;
      arr[3 * i + 2] = v[2] * STAR_R;
    }
    pos.needsUpdate = true;
    this.starMat.uniforms.pxScale.value = pxScale;
    const md = this.uniforms.moonDir.value;
    const dist = STAR_R * 0.98;
    this.moon.position.copy(camPos).addScaledVector(md, dist);
    this.moon.scale.setScalar(dist * Math.tan((0.52 * Math.PI) / 180) * 1.0);
    this.moon.lookAt(camPos);
  }

  setVisibility(stars: number, moon: number) {
    this.starMat.uniforms.visibility.value = stars;
    this.moonMat.uniforms.visibility.value = moon;
    this.stars.visible = stars > 0.001;
    this.moon.visible = moon > 0.001;
  }

  /** Re-render the PMREM environment map (call rarely). */
  captureEnvironment(groundColor: THREE.Color): THREE.Texture {
    (this.envGround.material as THREE.MeshBasicMaterial).color.copy(groundColor);
    this.uniforms.envPass.value = 1;
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 100000);
    this.uniforms.envPass.value = 0;
    old?.dispose();
    return this.envRT.texture;
  }
}
