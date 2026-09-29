/**
 * Application shell shared by the game (main.ts) and the dev harness.
 * Owns the renderer, scene graph roots, post-processing, main loop and the module registry.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { Sim } from './core/sim';
import { settings, type Quality } from './core/settings';
import { updateDisplays } from './displays/framework';
import { Kit } from './cockpit/kit';
import { Interaction } from './cockpit/kit/interaction';
import { loadFonts } from './fonts';

export type FrameFn = (dt: number, t: number) => void;

export interface PostFx {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  ao?: GTAOPass;
  smaa?: SMAAPass;
  enabled: boolean;
}

export interface App {
  sim: Sim;
  settings: typeof settings;
  isHarness: boolean;
  quality: Quality;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  /** Aircraft root: world-space transform of the aircraft (pushback moves it). Contains cockpit + exterior. */
  aircraft: THREE.Group;
  /** Cockpit interior root (child of aircraft, identity transform = aircraft body frame). */
  cockpit: THREE.Group;
  /** Static exterior world (airport). */
  world: THREE.Group;
  /** Player camera. The ui module parents it to a head rig inside `aircraft`. */
  camera: THREE.PerspectiveCamera;
  kit: Kit;
  interaction: Interaction;
  post: PostFx;
  /** Per-frame callback (after the sim step, before rendering). Lower order runs first. */
  onFrame(fn: FrameFn, order?: number): () => void;
  /** Real seconds since start. */
  time(): number;
  /** Free-form registry for modules to expose handles to each other (e.g. app.services.world). */
  services: Record<string, any>;
}

interface FrameEntry { fn: FrameFn; order: number }

export async function createApp(parent: HTMLElement, opts: { harness?: boolean } = {}): Promise<App & { start(): void; renderOnce(): void }> {
  await loadFonts();
  const quality = settings.get().quality;
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  const pr = Math.min(window.devicePixelRatio, quality === 'ultra' ? 2 : quality === 'high' ? 1.5 : quality === 'medium' ? 1.25 : 1);
  renderer.setPixelRatio(pr);
  renderer.setSize(parent.clientWidth || window.innerWidth, parent.clientHeight || window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = quality !== 'low';
  renderer.shadowMap.type = THREE.PCFShadowMap;
  parent.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202428);
  const aircraft = new THREE.Group();
  aircraft.name = 'aircraft';
  const cockpit = new THREE.Group();
  cockpit.name = 'cockpit';
  const world = new THREE.Group();
  world.name = 'world';
  aircraft.add(cockpit);
  scene.add(world, aircraft);

  const camera = new THREE.PerspectiveCamera(settings.get().fov, 16 / 9, 0.02, 60000);
  camera.position.set(-0.53, 1.28, 0);
  aircraft.add(camera);

  // Post-processing
  const size = renderer.getSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: quality === 'low' ? 0 : 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  let ao: GTAOPass | undefined;
  if (quality === 'high' || quality === 'ultra') {
    ao = new GTAOPass(scene, camera, size.x, size.y);
    ao.updateGtaoMaterial({ radius: 0.12, distanceExponent: 1.4, thickness: 1, scale: 1 });
    ao.blendIntensity = 0.85;
    composer.addPass(ao);
  }
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.35, 0.3, 1.4);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let smaa: SMAAPass | undefined;
  if (quality !== 'low') {
    smaa = new SMAAPass();
    composer.addPass(smaa);
  }
  const post: PostFx = { composer, bloom, ao, smaa, enabled: true };

  const sim = new Sim();
  const frames: FrameEntry[] = [];
  const t0 = performance.now();

  const app = {
    sim, settings, isHarness: !!opts.harness, quality, renderer, scene, aircraft, cockpit, world, camera,
    post, services: {} as Record<string, any>,
    onFrame(fn: FrameFn, order = 0) {
      const e = { fn, order };
      frames.push(e);
      frames.sort((a, b) => a.order - b.order);
      return () => { const i = frames.indexOf(e); if (i >= 0) frames.splice(i, 1); };
    },
    time: () => (performance.now() - t0) / 1000,
  } as unknown as App & { start(): void; renderOnce(): void };

  app.kit = new Kit(app);
  app.interaction = new Interaction(app);

  const resize = () => {
    const w = parent.clientWidth || window.innerWidth;
    const h = parent.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  let last = performance.now();
  const frame = () => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const t = (now - t0) / 1000;
    sim.advance(dt);
    for (const f of frames) {
      try { f.fn(dt, t); } catch (e) { console.error('[frame]', e); }
    }
    app.kit.update(dt, t);
    app.interaction.update(dt, t);
    updateDisplays(sim, t);
    if (post.enabled) composer.render(dt);
    else renderer.render(scene, camera);
  };
  app.renderOnce = frame;
  app.start = () => {
    sim.start();
    renderer.setAnimationLoop(frame);
  };
  (window as any).__app = app;
  (window as any).__sim = sim;
  return app;
}
