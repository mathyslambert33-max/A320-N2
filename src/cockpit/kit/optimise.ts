/**
 * Draw-call reduction for a finished panel assembly (generalised from the overhead's batch.ts, lead-owned).
 *
 *   app.cockpit.add(root);                  // placed at its anchor
 *   app.kit.optimise(root, 'MAIN');         // once, after every panel of `root` is finished
 *
 * - Moving control parts made of the shared kit materials (pushbutton caps, keypad keys, knobs, toggle levers,
 *   guards, printed key/cap labels) → one BatchedMesh per material. Each instance follows its original mesh
 *   (position, animation, visibility) after every `kit.update`.
 * - Lit legends → one BatchedMesh; the per-instance colour carries the legend colour and the brightness the kit
 *   computes each frame (ANN LT TEST / DIM included), so they look exactly as before.
 * - Static geometry of the panels (`…:static` / `…:slab` meshes) → one merged mesh per material.
 * The original control meshes move to PROXY_LAYER: not rendered, still ray-cast by the kit interaction and still
 * animated by the kit, so behaviour, tooltips and module code that touches them are unchanged.
 */
import * as THREE from 'three';
import type { Kit } from './index';
import { materials } from './materials';
import { atlas } from './atlas';
import * as geo from './geo';

/** Layer of the original meshes replaced by batches (the Interaction raycaster enables it). */
export const PROXY_LAYER = 30;

export interface OptimiseOptions {
  /** Merge the panels' static meshes per material (default true). */
  statics?: boolean;
  /** Which merged statics cast shadows (default: panel paint only). */
  staticShadows?: (mat: THREE.Material) => boolean;
  /** Batch the moving control parts (default true). */
  controls?: boolean;
  /** Batch the lit legends (default true). */
  legends?: boolean;
}

export interface OptimiseStats {
  batchedMeshes: number;
  batches: number;
  mergedStatics: number;
}

const isSpecial = (o: THREE.Object3D) => !!((o as THREE.InstancedMesh).isInstancedMesh || (o as THREE.BatchedMesh).isBatchedMesh);

interface Group {
  batch: THREE.BatchedMesh;
  meshes: THREE.Mesh[];
  ids: number[];
  last: Float32Array;
  vis: Uint8Array;
  /** Legends: kit material whose emissive × intensity is copied into the instance colour. */
  legendMats?: THREE.MeshStandardMaterial[];
  lastI?: Float32Array;
}

let legendBatchMat: THREE.MeshStandardMaterial | null = null;
/** Legend material for batches: base = 0.07 × instance hue, emissive = hue × instance alpha (brightness). */
function legendMaterial(): THREE.MeshStandardMaterial {
  if (legendBatchMat) return legendBatchMat;
  const tex = atlas().texture;
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.07, 0.07, 0.07), map: tex, emissive: 0xffffff, emissiveMap: tex, roughness: 0.25, metalness: 0 });
  m.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader
      .replace('#include <color_fragment>', `#if defined( USE_COLOR_ALPHA )
  diffuseColor.rgb *= vColor.rgb;
#endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
#if defined( USE_COLOR_ALPHA )
  totalEmissiveRadiance *= vColor.rgb * vColor.a;
#endif`);
  };
  m.customProgramCacheKey = () => 'kit-legend-batch-v1';
  legendBatchMat = m;
  return m;
}

/** Is `o` visible up to (and including) `root`? */
function effectivelyVisible(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) {
    if (!p.visible) return false;
    if (p === root) return true;
  }
  return true;
}

export function optimisePanels(kit: Kit, root: THREE.Object3D, name: string, o: OptimiseOptions = {}): { update(): void; stats: OptimiseStats } {
  const M = materials();
  const legendMats = kit.legendMaterialSet();
  const shared = new Set<THREE.Material>([
    M.cap, M.keyCap, M.knob, M.knobKnurl, M.knobGrey, M.white, M.chrome, M.alu, M.darkMetal, M.bezel, M.rubber,
    M.guardRed, M.guardBlack, M.black, ...kit.keyLabelMaterials(),
  ]);
  root.updateWorldMatrix(true, true);
  const rootInv = root.matrixWorld.clone().invert();
  const rel = new THREE.Matrix4();

  // ---- collect
  const byMat = new Map<THREE.Material, THREE.Mesh[]>();
  const legends: THREE.Mesh[] = [];
  const staticsBy = new Map<THREE.Material, THREE.Mesh[]>();
  root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (!m.isMesh || isSpecial(m) || Array.isArray(m.material) || m.layers.isEnabled(PROXY_LAYER)) return;
    if (m.name.endsWith(':face') || m.name.startsWith('display:')) return;
    const mat = m.material as THREE.Material;
    if (m.name.endsWith(':static') || m.name.endsWith(':slab')) {
      if (o.statics === false) return;
      let l = staticsBy.get(mat);
      if (!l) staticsBy.set(mat, (l = []));
      l.push(m);
      return;
    }
    if (m.children.length || m.matrixWorld.determinant() < 0) return;
    if (legendMats.has(mat)) { if (o.legends !== false) legends.push(m); return; }
    if (o.controls === false || !shared.has(mat)) return;
    let l = byMat.get(mat);
    if (!l) byMat.set(mat, (l = []));
    l.push(m);
  });

  // ---- batches
  const groups: Group[] = [];
  const makeBatch = (meshes: THREE.Mesh[], mat: THREE.Material, label: string, shadows: boolean): Group | null => {
    if (meshes.length < 2) return null;
    const flat = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
    let verts = 0;
    for (const m of meshes) {
      if (flat.has(m.geometry)) continue;
      const g = geo.normalise(m.geometry);
      flat.set(m.geometry, g);
      verts += g.attributes.position.count;
    }
    const batch = new THREE.BatchedMesh(meshes.length, verts, verts, mat);
    const geoIds = new Map<THREE.BufferGeometry, number>();
    for (const [src, g] of flat) geoIds.set(src, batch.addGeometry(g));
    const ids = meshes.map((m) => batch.addInstance(geoIds.get(m.geometry)!));
    batch.name = `${name}:batch:${label}`;
    batch.frustumCulled = false;
    batch.perObjectFrustumCulled = false;
    batch.sortObjects = false;
    batch.castShadow = shadows;
    batch.receiveShadow = true;
    root.add(batch);
    for (const m of meshes) m.layers.set(PROXY_LAYER);
    const grp: Group = { batch, meshes, ids, last: new Float32Array(meshes.length * 16).fill(NaN), vis: new Uint8Array(meshes.length).fill(1) };
    groups.push(grp);
    return grp;
  };
  let batched = 0;
  for (const [mat, list] of byMat) {
    const castShadow = list.some((m) => m.castShadow) && !(mat as THREE.Material).transparent;
    if (makeBatch(list, mat, (mat.name || mat.type) + groups.length, castShadow)) batched += list.length;
  }
  if (legends.length) {
    const g = makeBatch(legends, legendMaterial(), 'legends', false);
    if (g) {
      batched += legends.length;
      g.legendMats = legends.map((m) => m.material as THREE.MeshStandardMaterial);
      g.lastI = new Float32Array(legends.length).fill(-1);
      const v = new THREE.Vector4();
      g.legendMats.forEach((lm, i) => g.batch.setColorAt(g.ids[i], v.set(lm.emissive.r, lm.emissive.g, lm.emissive.b, 0)));
    }
  }

  // ---- merged statics
  let merged = 0;
  const shadowOf = o.staticShadows ?? ((mat: THREE.Material) => mat === M.paint);
  for (const [mat, list] of staticsBy) {
    if (list.length < 2) continue;
    const geos = list.map((m) => geo.normalise(m.geometry).applyMatrix4(rel.multiplyMatrices(rootInv, m.matrixWorld)));
    const g = geo.mergeGeometries(geos);
    if (!g) continue;
    for (const m of list) m.parent?.remove(m);
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = `${name}:statics`;
    mesh.castShadow = shadowOf(mat);
    mesh.receiveShadow = true;
    root.add(mesh);
    merged += list.length;
  }

  // ---- per-frame sync (after kit.update: controls animated, legend brightness computed)
  const v4 = new THREE.Vector4();
  const update = () => {
    root.updateMatrixWorld(true);
    rootInv.copy(root.matrixWorld).invert();
    for (const g of groups) {
      const { batch, meshes, ids, last, vis } = g;
      for (let i = 0; i < meshes.length; i++) {
        const m = meshes[i];
        const visible = effectivelyVisible(m, root) ? 1 : 0;
        if (visible !== vis[i]) { vis[i] = visible; batch.setVisibleAt(ids[i], !!visible); }
        if (!visible) continue;
        rel.multiplyMatrices(rootInv, m.matrixWorld);
        const e = rel.elements;
        const off = i * 16;
        let same = true;
        for (let k = 0; k < 16; k++) if (last[off + k] !== e[k]) { same = false; break; }
        if (!same) { last.set(e, off); batch.setMatrixAt(ids[i], rel); }
      }
      if (g.legendMats) {
        const lastI = g.lastI!;
        for (let i = 0; i < g.legendMats.length; i++) {
          const lm = g.legendMats[i];
          const it = lm.emissiveIntensity;
          if (it !== lastI[i]) { lastI[i] = it; batch.setColorAt(ids[i], v4.set(lm.emissive.r, lm.emissive.g, lm.emissive.b, it)); }
        }
      }
    }
  };
  update();
  return { update, stats: { batchedMeshes: batched, batches: groups.length, mergedStatics: merged } };
}
