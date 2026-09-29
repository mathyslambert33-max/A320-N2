/**
 * 3D EFB tablets (owner: ui): a 10.2" tablet in a rugged case on a ball-and-socket arm, mounted on the side
 * wall forward of each sliding window (captain left, F/O right), facing the pilot. Clicking it opens the EFB.
 * The wall plate finds the real side wall by ray casting once the cockpit shell is built (self-contained:
 * nothing outside this module is touched). The screen shows the EFB home page (canvas texture, dimmed at night).
 */
import * as THREE from 'three';
import type { App } from '../app';
import { geo } from '../cockpit/kit';
import type { Handle } from '../cockpit/kit/interaction';
import { SCENARIO } from '../core/scenario';
import type { Vec3 } from './view';
import { EYE } from './view';

/** Tablet centre (captain side, body frame); mirrored for the F/O. */
export const TABLET_CAPT: Vec3 = [-0.905, 0.945, -0.5];

const CW = 1024, CH = 768;

interface TabletInst {
  side: 1 | -1;
  root: THREE.Group;
  device: THREE.Group;
  arm: THREE.Mesh;
  wallBall: THREE.Mesh;
  plate: THREE.Mesh;
  backBall: THREE.Object3D;
  center: THREE.Vector3;
}

export interface Tablets {
  /** Tablet centre per seat (captain frame, for the EFB preset view). */
  target(): Vec3;
  update(dt: number): void;
  fit(): void;
  objects: THREE.Object3D[];
}

function drawHome(ctx: CanvasRenderingContext2D, utc: number, night: boolean): void {
  const bg = night ? '#0f141a' : '#eef1f4', rail = night ? '#0a0e13' : '#1b2430', text = night ? '#dbe4ec' : '#16202b', dim = night ? '#8c9aa8' : '#5b6776';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CW, CH);
  // status + header bars
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, CW, 34);
  const hh = Math.floor((utc % 86400) / 3600), mm = Math.floor((utc % 3600) / 60);
  const lt = `${String((hh + 2) % 24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  ctx.fillStyle = '#fff';
  ctx.font = '600 20px B612, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(lt, 18, 18);
  ctx.textAlign = 'right';
  ctx.fillText('87 %', CW - 60, 18);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.strokeRect(CW - 50, 10, 32, 16);
  ctx.fillRect(CW - 47, 13, 20, 10);
  ctx.textAlign = 'left';
  ctx.fillStyle = rail;
  ctx.fillRect(0, 34, CW, 70);
  ctx.fillStyle = '#4fd1ff';
  ctx.font = '600 30px "Barlow Semi Condensed", sans-serif';
  ctx.fillText('EFB', 26, 70);
  ctx.fillStyle = '#b8c6d4';
  ctx.font = '22px "B612 Mono", monospace';
  const f = SCENARIO.flight;
  ctx.fillText(`${f.number} · ${f.from} → ${f.to} · ${SCENARIO.aircraft.registration}`, 100, 70);
  // clock
  ctx.fillStyle = text;
  ctx.font = '600 120px "Barlow Semi Condensed", sans-serif';
  ctx.fillText(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, 44, 200);
  ctx.fillStyle = dim;
  ctx.font = '600 28px "Barlow Semi Condensed", sans-serif';
  ctx.fillText('UTC', 360, 176);
  ctx.font = '22px B612, sans-serif';
  ctx.fillText(`Bordeaux-Mérignac → Paris-Orly · FL${f.crzFl} · 0h55`, 46, 262);
  // tiles
  const tiles = ['OFP', 'LOADSHEET', 'PERF T.O', 'MÉTÉO', 'CHECKLISTS', 'SOP', 'SERVICES SOL', 'RÉGLAGES'];
  const tw = 218, th = 150, gx = 26, x0 = 44, y0 = 310;
  tiles.forEach((t, i) => {
    const x = x0 + (i % 4) * (tw + gx), y = y0 + Math.floor(i / 4) * (th + 24);
    ctx.fillStyle = night ? '#161d25' : '#ffffff';
    ctx.strokeStyle = night ? '#26313d' : '#d3dae2';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, tw, th, 18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = i === 6 ? '#0a72c2' : text;
    ctx.font = '600 26px "Barlow Semi Condensed", sans-serif';
    ctx.fillText(t, x + 20, y + th - 32);
    ctx.fillStyle = i === 6 ? '#0a72c2' : dim;
    ctx.fillRect(x + 20, y + 26, 44, 6);
  });
  ctx.fillStyle = dim;
  ctx.font = '20px B612, sans-serif';
  ctx.fillText('Touchez pour ouvrir', 44, CH - 34);
}

export function buildTablets(app: App, onOpen: (side: 'capt' | 'fo') => void): Tablets {
  const mCase = new THREE.MeshStandardMaterial({ color: 0x1c1f22, roughness: 0.82, metalness: 0 });
  const mBezel = new THREE.MeshStandardMaterial({ color: 0x060707, roughness: 0.35, metalness: 0.1 });
  const mMetal = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.42, metalness: 0.65 });
  const mRubber = new THREE.MeshStandardMaterial({ color: 0x101112, roughness: 0.92, metalness: 0 });
  const mGlass = new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.1, clearcoat: 1, clearcoatRoughness: 0.1, depthWrite: false });
  const canvas = document.createElement('canvas');
  canvas.width = CW;
  canvas.height = CH;
  const ctx = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mScreen = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  const tod = app.settings.get().timeOfDay;
  const night = tod !== 'day';
  mScreen.color.setScalar(tod === 'day' ? 0.92 : tod === 'dusk' ? 0.62 : 0.4);

  const armGeo = new THREE.CylinderGeometry(0.0105, 0.0105, 1, 16);
  const ballGeo = new THREE.SphereGeometry(0.0175, 20, 14);
  const plateGeo = new THREE.CylinderGeometry(0.032, 0.034, 0.007, 28);
  plateGeo.rotateZ(Math.PI / 2); // axis along X

  const inst: TabletInst[] = [];
  const eye = (side: 1 | -1) => new THREE.Vector3(EYE.capt[0] * side, EYE.capt[1], EYE.capt[2]);

  for (const side of [1, -1] as const) {
    const root = new THREE.Group();
    root.name = side > 0 ? 'ui:efbTablet:capt' : 'ui:efbTablet:fo';
    const device = new THREE.Group();
    const body = new THREE.Mesh(geo.roundedBox(0.268, 0.192, 0.02, 0.011), mCase);
    body.castShadow = true;
    body.receiveShadow = true;
    const front = new THREE.Mesh(geo.roundedBox(0.25, 0.174, 0.004, 0.009), mBezel);
    front.position.z = 0.0095;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.2074, 0.1555), mScreen);
    screen.position.z = 0.0117;
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.246, 0.17), mGlass);
    glass.position.z = 0.0119;
    glass.renderOrder = 2;
    // corner bumpers of the rugged case
    for (const [cx, cy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const b = new THREE.Mesh(geo.roundedBox(0.03, 0.03, 0.024, 0.008), mRubber);
      b.position.set(cx * 0.121, cy * 0.083, 0);
      device.add(b);
    }
    const backBall = new THREE.Mesh(ballGeo, mRubber);
    backBall.position.set(-0.02 * side, -0.01, -0.028);
    const socket = new THREE.Mesh(geo.cylZ(0.024, 0.028, 0.012, 24), mMetal);
    socket.position.set(-0.02 * side, -0.01, -0.022);
    device.add(body, front, screen, glass, backBall, socket);
    root.add(device);

    const arm = new THREE.Mesh(armGeo, mMetal);
    arm.castShadow = true;
    const wallBall = new THREE.Mesh(ballGeo, mRubber);
    const plate = new THREE.Mesh(plateGeo, mMetal);
    root.add(arm, wallBall, plate);
    app.cockpit.add(root);

    const c = new THREE.Vector3(TABLET_CAPT[0] * side, TABLET_CAPT[1], TABLET_CAPT[2]);
    const t: TabletInst = { side, root, device, arm, wallBall, plate, backBall, center: c };
    place(t, c, side > 0 ? -1.02 : 1.02);
    inst.push(t);

    const handle: Handle = {
      id: side > 0 ? 'EFB_TABLET_CAPT' : 'EFB_TABLET_FO',
      ref: device,
      cursor: 'push',
      onDown: () => onOpen(side > 0 ? 'capt' : 'fo'),
      describe: () => ({
        name: side > 0 ? 'EFB (CAPT)' : 'EFB (F/O)',
        fr: 'Tablette EFB : OFP, devis de masse, performances, météo, checklists, procédures, services au sol',
        state: '',
        id: side > 0 ? 'EFB_TABLET_CAPT' : 'EFB_TABLET_FO',
      }),
    };
    app.interaction.register(device, handle);
  }

  function place(t: TabletInst, c: THREE.Vector3, wallX: number): void {
    t.center.copy(c);
    t.device.position.copy(c);
    // face the pilot's eye (slightly above it: reclined like a clipboard); lookAt works in world space
    app.aircraft.updateMatrixWorld(true);
    t.device.lookAt(app.aircraft.localToWorld(eye(t.side).add(new THREE.Vector3(0, 0.08, 0))));
    t.root.updateMatrixWorld(true);
    const back = t.root.worldToLocal(t.backBall.getWorldPosition(new THREE.Vector3()));
    // wall point: outboard of the back ball, a little lower and aft
    const out = Math.sign(wallX);
    const wall = new THREE.Vector3(wallX, back.y - 0.015, back.z + 0.025);
    const wallBallPos = wall.clone().add(new THREE.Vector3(-out * 0.022, 0, 0));
    t.plate.position.copy(wall).add(new THREE.Vector3(-out * 0.0035, 0, 0));
    t.wallBall.position.copy(wallBallPos);
    const dir = wallBallPos.clone().sub(back);
    const len = dir.length();
    t.arm.position.copy(back).add(wallBallPos).multiplyScalar(0.5);
    t.arm.scale.set(1, Math.max(0.01, len), 1);
    t.arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  }

  /** Find the side wall (ray outboard from the tablet back) and make sure the screen is visible from the eye. */
  function fit(): void {
    const ray = new THREE.Raycaster();
    const mine = new Set<THREE.Object3D>();
    for (const t of inst) t.root.traverse((o) => mine.add(o));
    const targets: THREE.Object3D[] = [];
    app.cockpit.traverse((o) => { if ((o as THREE.Mesh).isMesh && !mine.has(o) && o.visible) targets.push(o); });
    if (!targets.length) return;
    app.aircraft.updateMatrixWorld(true);
    const hitBetween = (a: THREE.Vector3, b: THREE.Vector3) => {
      const d = b.clone().sub(a);
      const len = d.length();
      ray.set(a, d.normalize());
      ray.far = Math.max(0.001, len - 0.004);
      return ray.intersectObjects(targets, false)[0];
    };
    for (const t of inst) {
      const s = t.side;
      const wall0 = -1.02 * s;
      const base = new THREE.Vector3(TABLET_CAPT[0] * s, TABLET_CAPT[1], TABLET_CAPT[2]);
      const cands = [[0, 0, 0], [0.03 * s, 0.03, 0], [0.05 * s, 0.02, 0.05], [0.02 * s, 0.07, 0.07]]
        .map(([x, y, z]) => base.clone().add(new THREE.Vector3(x, y, z)));
      const eyeW = app.aircraft.localToWorld(eye(s));
      let chosen = cands[0];
      for (const c of cands) {
        place(t, c, wall0);
        const corners = [[0, 0], [-0.11, -0.075], [0.11, -0.075], [-0.11, 0.075], [0.11, 0.075]]
          .map(([x, y]) => t.device.localToWorld(new THREE.Vector3(x, y, 0.013)));
        if (!corners.some((p) => hitBetween(eyeW, p))) { chosen = c; break; }
      }
      place(t, chosen, wall0);
      const backW = t.backBall.getWorldPosition(new THREE.Vector3());
      const backB = app.aircraft.worldToLocal(backW.clone());
      const hit = hitBetween(backW, app.aircraft.localToWorld(backB.clone().add(new THREE.Vector3(-0.45 * s, 0, 0))));
      let wallX = wall0;
      if (hit) {
        const p = app.aircraft.worldToLocal(hit.point.clone());
        if (Math.abs(p.x) > Math.abs(backB.x) + 0.03) wallX = p.x + 0.002 * s;
      }
      place(t, chosen, wallX);
    }
  }

  let acc = 99, lastMin = -1;
  const redraw = (utc: number) => {
    try { drawHome(ctx, utc, night); tex.needsUpdate = true; } catch (e) { console.error('[ui] tablet screen', e); }
  };
  redraw(app.sim.get('G:TIME_UTC'));

  // Fit to the walls once everything is built (the harness installs the ui module first).
  let fitted = 0;
  app.sim.on('app:ready', () => { fit(); fitted = 2; });
  let tFit = 0;

  return {
    objects: inst.map((t) => t.root),
    target: () => [inst[0].center.x, inst[0].center.y, inst[0].center.z],
    fit,
    update(dt: number) {
      if (fitted < 2) {
        tFit += dt;
        if ((fitted === 0 && tFit > 1.5) || (fitted === 1 && tFit > 6)) { fit(); fitted++; }
      }
      acc += dt;
      if (acc < 2) return;
      acc = 0;
      const utc = app.sim.get('G:TIME_UTC');
      const m = Math.floor(utc / 60);
      if (m !== lastMin) { lastMin = m; redraw(utc); }
    },
  };
}
