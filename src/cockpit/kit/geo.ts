/**
 * Geometry helpers for cockpit hardware (all in metres, local frames with +Z out of the panel face).
 * Geometries are cached by parameters: never dispose shared ones.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const cache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) { g = make(); cache.set(key, g); }
  return g;
}

export function roundedRectShape(w: number, h: number, r: number, cx = 0, cy = 0): THREE.Shape {
  const s = new THREE.Shape();
  const x = cx - w / 2, y = cy - h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function roundedRectPath(w: number, h: number, r: number): THREE.Path {
  const p = new THREE.Path();
  const x = -w / 2, y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.quadraticCurveTo(x + w, y, x + w, y + r);
  p.lineTo(x + w, y + h - r);
  p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  p.lineTo(x + r, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - r);
  p.lineTo(x, y + r);
  p.quadraticCurveTo(x, y, x + r, y);
  return p;
}

/** Panel slab: top face at z = 0, extends to z = −depth, bevelled edges. */
export function panelSlab(w: number, h: number, depth: number, r: number): THREE.BufferGeometry {
  return cached(`slab|${w}|${h}|${depth}|${r}`, () => {
    const bevel = Math.min(0.0009, depth * 0.3);
    const g = new THREE.ExtrudeGeometry(roundedRectShape(w - 2 * bevel, h - 2 * bevel, Math.max(0.0003, r - bevel)), {
      depth: depth - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6,
    });
    g.translate(0, 0, -depth + bevel);
    return g;
  });
}

/** Flat face (for labels) matching a slab, UVs 0..1 over the panel. */
export function panelFace(w: number, h: number, r: number): THREE.BufferGeometry {
  return cached(`face|${w}|${h}|${r}`, () => {
    const g = new THREE.ShapeGeometry(roundedRectShape(w, h, r), 8);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
    return g;
  });
}

/** Rectangular ring (pushbutton bezel), bottom at z = 0, height hz. */
export function rectRing(ow: number, oh: number, iw: number, ih: number, hz: number, r = 0.0012): THREE.BufferGeometry {
  return cached(`ring|${ow}|${oh}|${iw}|${ih}|${hz}|${r}`, () => {
    const s = roundedRectShape(ow, oh, r);
    s.holes.push(roundedRectPath(iw, ih, r * 0.6));
    const bevel = Math.min(0.0005, hz * 0.3);
    const g = new THREE.ExtrudeGeometry(s, { depth: hz - bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.6, bevelSegments: 2, curveSegments: 4 });
    return g;
  });
}

export function roundedBox(w: number, h: number, d: number, r: number, seg = 2): THREE.BufferGeometry {
  return cached(`rbox|${w}|${h}|${d}|${r}|${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, r));
}

export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return cached(`box|${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
}

/** Cylinder along +Z, bottom at z = 0. */
export function cylZ(rTop: number, rBottom: number, h: number, seg = 24): THREE.BufferGeometry {
  return cached(`cylz|${rTop}|${rBottom}|${h}|${seg}`, () => {
    const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, h / 2);
    return g;
  });
}

/** Lathe profile (points (r, z)) revolved around Z. */
export function latheZ(key: string, pts: Array<[number, number]>, seg = 32): THREE.BufferGeometry {
  return cached(`lathe|${key}|${seg}`, () => {
    const g = new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, z)), seg);
    g.rotateX(Math.PI / 2);
    return g;
  });
}

/**
 * Airbus "pointer" selector knob grip: a bar with a pointed end toward +Y, height along +Z.
 * length = total length, width = bar width, height = extrusion height.
 */
export function pointerGrip(length: number, width: number, height: number): THREE.BufferGeometry {
  return cached(`grip|${length}|${width}|${height}`, () => {
    const s = new THREE.Shape();
    const w = width / 2;
    const tail = -length * 0.38;
    const tip = length * 0.62;
    s.moveTo(-w, tail + w);
    s.quadraticCurveTo(-w, tail, 0, tail);
    s.quadraticCurveTo(w, tail, w, tail + w);
    s.lineTo(w, tip - width * 0.9);
    s.lineTo(width * 0.12, tip);
    s.lineTo(-width * 0.12, tip);
    s.lineTo(-w, tip - width * 0.9);
    s.lineTo(-w, tail + w);
    const bevel = Math.min(0.0012, width * 0.18);
    const g = new THREE.ExtrudeGeometry(s, { depth: height - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 8 });
    g.translate(0, 0, bevel);
    return g;
  });
}

/** Toggle switch lever ("bat handle") along +Z from the pivot, with a rounded tip. */
export function toggleLever(length: number, rBase: number, rTip: number): THREE.BufferGeometry {
  return cached(`lever|${length}|${rBase}|${rTip}`, () => {
    const shaft = new THREE.CylinderGeometry(rTip, rBase, length, 16);
    shaft.rotateX(Math.PI / 2);
    shaft.translate(0, 0, length / 2);
    const ball = new THREE.SphereGeometry(rTip * 1.25, 16, 12);
    ball.translate(0, 0, length);
    return mergeGeometries([normalise(shaft), normalise(ball)])!;
  });
}

/** Hexagonal nut + collar for toggle switches (static). */
export function toggleBase(): THREE.BufferGeometry {
  return cached('toggleBase', () => {
    const nut = new THREE.CylinderGeometry(0.0055, 0.0055, 0.0018, 6);
    nut.rotateX(Math.PI / 2);
    nut.translate(0, 0, 0.0009);
    const collar = new THREE.CylinderGeometry(0.0034, 0.0038, 0.0045, 20);
    collar.rotateX(Math.PI / 2);
    collar.translate(0, 0, 0.0018 + 0.00225);
    return mergeGeometries([normalise(nut), normalise(collar)])!;
  });
}

/** Dzus fastener head (static). */
export function dzus(): THREE.BufferGeometry {
  return cached('dzus', () => {
    const head = new THREE.CylinderGeometry(0.0032, 0.0036, 0.0012, 20);
    head.rotateX(Math.PI / 2);
    head.translate(0, 0, 0.0006);
    const slot = new THREE.BoxGeometry(0.0046, 0.0008, 0.0004);
    slot.translate(0, 0, 0.0013);
    return mergeGeometries([normalise(head), normalise(slot)])!;
  });
}

/** Make a geometry mergeable: non-indexed, only position/normal/uv. */
export function normalise(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
  if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((n.attributes.position.count) * 2), 2));
  if (!n.attributes.normal) n.computeVertexNormals();
  n.groups = [];
  return n;
}

export { mergeGeometries };
