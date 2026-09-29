/**
 * Draw-call reduction for the overhead (≈180 controls): done once after the kit has built everything.
 *  1. multi-mesh moving parts (guard lids, pointer-knob skirt+grip…) → one mesh per material; the originals
 *     stay as invisible hit proxies so the kit interaction is unchanged;
 *  2. every pushbutton cap / lens (kit `cap` material) → one BatchedMesh, and every lit legend → one
 *     BatchedMesh whose per-instance colour carries the legend brightness the kit computes each frame
 *     (the kit keeps updating its per-legend materials; we copy emissive × intensity);
 *  3. static geometry (slabs, bezels, Dzus, hinge pins, collars…) of all plates → one mesh per material;
 *  4. only the big structure casts shadows.
 */
import * as THREE from 'three';
import type { App } from '../../app';
import { geo } from '../kit';
import { materials } from '../kit/materials';
import { atlas } from '../kit/atlas';

interface LegendRef { mat: THREE.MeshStandardMaterial }

function isSpecial(o: THREE.Object3D): boolean {
  return !!((o as THREE.InstancedMesh).isInstancedMesh || (o as THREE.BatchedMesh).isBatchedMesh);
}

/** 1. Merge sibling meshes sharing a material (moving sub-assemblies). */
function mergeSiblings(root: THREE.Group): void {
  const groups: THREE.Object3D[] = [];
  root.traverse((o) => { if (o.children.length > 1) groups.push(o); });
  const M = materials();
  for (const grp of groups) {
    const buckets = new Map<THREE.Material, THREE.Mesh[]>();
    for (const c of grp.children) {
      const m = c as THREE.Mesh;
      if (!m.isMesh || isSpecial(m) || !m.visible || m.children.length) continue;
      if (m.name.endsWith(':static') || m.name.endsWith(':slab') || m.name.endsWith(':face') || m.name === 'synoptic') continue;
      const mat = m.material as THREE.Material;
      if (Array.isArray(mat) || mat === M.cap || (mat as THREE.MeshStandardMaterial).emissiveMap) continue;
      let b = buckets.get(mat);
      if (!b) buckets.set(mat, (b = []));
      b.push(m);
    }
    for (const [mat, list] of buckets) {
      if (list.length < 2) continue;
      const geos = list.map((m) => { m.updateMatrix(); return geo.normalise(m.geometry).applyMatrix4(m.matrix); });
      const merged = geo.mergeGeometries(geos);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = 'merged';
      mesh.receiveShadow = true;
      grp.add(mesh);
      for (const m of list) {
        if (m.userData.handle) { m.visible = false; m.userData.hitProxy = true; }
        else grp.remove(m);
      }
    }
  }
}

/** 2. Batch caps and legends. Returns the per-frame updater. */
function batchCapsAndLegends(app: App, root: THREE.Group, name: string): () => void {
  const M = materials();
  const legendList = ((app.kit as unknown as { legends: LegendRef[] }).legends ?? []);
  const legendMats = new Set<THREE.Material>(legendList.map((l) => l.mat));
  const caps: THREE.Mesh[] = [];
  const legs: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || isSpecial(m) || !m.visible) return;
    if (m.name.endsWith(':static')) return;
    if (m.material === M.cap) caps.push(m);
    else if (legendMats.has(m.material as THREE.Material)) legs.push(m);
  });

  const legendBatchMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.07, 0.07, 0.066),
    map: atlas().texture,
    emissive: 0xffffff,
    emissiveMap: atlas().texture,
    roughness: 0.25,
    metalness: 0,
  });
  legendBatchMat.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader
      .replace('#include <color_fragment>', '')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
  totalEmissiveRadiance *= vColor.rgb;
#endif`);
  };
  legendBatchMat.customProgramCacheKey = () => 'ovhd-legend-batch-v1';

  const make = (meshes: THREE.Mesh[], mat: THREE.Material, label: string) => {
    if (!meshes.length) return null;
    // all geometries non-indexed with position/normal/uv only (BatchedMesh needs a consistent layout)
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
    batch.name = `${name}:${label}`;
    batch.frustumCulled = false;
    batch.castShadow = false;
    batch.receiveShadow = true;
    root.add(batch);
    for (const m of meshes) { m.visible = false; if (m.userData.handle) m.userData.hitProxy = true; }
    return { batch, ids };
  };

  const capB = make(caps, M.cap, 'caps');
  const legB = make(legs, legendBatchMat, 'legends');
  const legMat = legs.map((m) => m.material as THREE.MeshStandardMaterial);
  const lastI = new Float32Array(legs.length).fill(-1);
  const inv = new THREE.Matrix4();
  const rel = new THREE.Matrix4();
  const col = new THREE.Color();

  const update = () => {
    root.updateWorldMatrix(true, false);
    inv.copy(root.matrixWorld).invert();
    if (capB) caps.forEach((m, i) => { m.updateWorldMatrix(true, false); capB.batch.setMatrixAt(capB.ids[i], rel.multiplyMatrices(inv, m.matrixWorld)); });
    if (legB) {
      legs.forEach((m, i) => {
        m.updateWorldMatrix(true, false);
        legB.batch.setMatrixAt(legB.ids[i], rel.multiplyMatrices(inv, m.matrixWorld));
        const it = legMat[i].emissiveIntensity;
        if (it !== lastI[i]) {
          lastI[i] = it;
          legB.batch.setColorAt(legB.ids[i], col.copy(legMat[i].emissive).multiplyScalar(it));
        }
      });
    }
  };
  if (legB) legs.forEach((_, i) => legB.batch.setColorAt(legB.ids[i], col.setRGB(0, 0, 0)));
  update();
  return update;
}

/** 3. Merge static geometry of every plate per material (root must be at its final transform or identity). */
function mergeStatics(root: THREE.Group, name: string): void {
  root.updateWorldMatrix(true, true);
  const inv = root.matrixWorld.clone().invert();
  const by = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const kill: THREE.Mesh[] = [];
  const tmp = new THREE.Matrix4();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || isSpecial(m)) return;
    if (!(m.name.endsWith(':static') || m.name.endsWith(':slab'))) return;
    const mat = m.material as THREE.Material;
    let list = by.get(mat);
    if (!list) by.set(mat, (list = []));
    list.push(geo.normalise(m.geometry).applyMatrix4(tmp.multiplyMatrices(inv, m.matrixWorld)));
    kill.push(m);
  });
  for (const m of kill) m.parent?.remove(m);
  const M = materials();
  for (const [mat, list] of by) {
    const merged = geo.mergeGeometries(list);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = `${name}:statics`;
    mesh.receiveShadow = true;
    mesh.castShadow = mat === M.paint;
    root.add(mesh);
  }
}

/** Run all passes on one anchor group (already placed and added to the cockpit). */
export function optimiseOverhead(app: App, root: THREE.Group, name: string): () => void {
  mergeSiblings(root);
  const update = batchCapsAndLegends(app, root, name);
  mergeStatics(root, name);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (!(m.name.endsWith(':statics') || m.name.endsWith(':frame'))) m.castShadow = false;
  });
  return update;
}
