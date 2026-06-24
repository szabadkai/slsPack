import * as THREE from 'three';
import type { CustomMeshData, LodLevel, ModelPart, RenderSettings } from './types';

const edgeMaterial = new THREE.LineBasicMaterial({ color: '#046b9c', transparent: true, opacity: 0.28 });
const uploadedGeometryCache = new WeakMap<CustomMeshData, THREE.BufferGeometry>();

function createPartMaterial(isSelected: boolean, realisticShaders: boolean) {
  if (realisticShaders) {
    return new THREE.MeshPhysicalMaterial({
      color: isSelected ? '#8be8ff' : '#13a8d6',
      roughness: isSelected ? 0.22 : 0.28,
      metalness: 0.78,
      clearcoat: 0.32,
      clearcoatRoughness: 0.18,
      emissive: isSelected ? '#00364a' : '#001a25',
      emissiveIntensity: isSelected ? 0.12 : 0.04,
      reflectivity: 0.82,
    });
  }

  return new THREE.MeshStandardMaterial({
    color: isSelected ? '#16c8ff' : '#00a8f4',
    roughness: isSelected ? 0.45 : 0.5,
    metalness: 0.04,
    emissive: isSelected ? '#0079ad' : '#006fa2',
    emissiveIntensity: isSelected ? 0.25 : 0.12,
  });
}

function lodSegments(lodLevel: LodLevel) {
  return lodLevel === 'quality'
    ? { sphereW: 34, sphereH: 20, radial: 28, torus: 42, knot: 48, edgeLimit: 30000, edges: true }
    : lodLevel === 'balanced'
      ? { sphereW: 24, sphereH: 14, radial: 18, torus: 30, knot: 32, edgeLimit: 18000, edges: true }
      : { sphereW: 14, sphereH: 8, radial: 12, torus: 18, knot: 18, edgeLimit: 0, edges: false };
}

function addEdges(mesh: THREE.Mesh, target: THREE.Group) {
  const edges = new THREE.EdgesGeometry(mesh.geometry, 22);
  const line = new THREE.LineSegments(edges, edgeMaterial.clone());
  line.position.copy(mesh.position);
  line.rotation.copy(mesh.rotation);
  line.scale.copy(mesh.scale);
  target.add(line);
}

function uploadedGeometryFor(meshData: CustomMeshData) {
  const cached = uploadedGeometryCache.get(meshData);
  if (cached) return cached;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
  if (meshData.normals) {
    geometry.setAttribute('normal', new THREE.BufferAttribute(meshData.normals, 3));
  } else {
    geometry.computeVertexNormals();
  }
  if (meshData.indices) {
    geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
  }
  geometry.userData.sharedUploadedGeometry = true;
  uploadedGeometryCache.set(meshData, geometry);
  return geometry;
}

function shell(model: ModelPart, material: THREE.Material, lodLevel: LodLevel) {
  const group = new THREE.Group();
  const [w, h, d] = model.dims;
  const lod = lodSegments(lodLevel);
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, lod.sphereW, lod.sphereH), material);
  body.scale.set(w * 0.43, h * 0.5, d * 0.43);
  group.add(body);
  if (lod.edges) addEdges(body, group);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(Math.max(w, d) * 0.34, 0.08, 8, lod.torus), material);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = h * 0.2;
  group.add(rim);
  if (lod.edges) addEdges(rim, group);

  const hook = new THREE.Mesh(new THREE.TorusKnotGeometry(Math.max(w, d) * 0.18, 0.055, lod.knot, 8, 2, 3), material);
  hook.position.set(w * 0.23, h * 0.08, d * 0.28);
  hook.rotation.set(0.8, 0.2, 0.15);
  group.add(hook);

  return group;
}

function gear(model: ModelPart, material: THREE.Material, lodLevel: LodLevel) {
  const group = new THREE.Group();
  const [w, h, d] = model.dims;
  const lod = lodSegments(lodLevel);
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(w, d) * 0.42, Math.max(w, d) * 0.42, h * 0.72, lod.radial), material);
  wheel.rotation.z = Math.PI / 2;
  group.add(wheel);
  if (lod.edges) addEdges(wheel, group);

  const toothCount = lodLevel === 'performance' ? 6 : 9;
  for (let index = 0; index < toothCount; index += 1) {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(w * 0.16, h * 0.76, d * 0.18), material);
    const angle = (index / toothCount) * Math.PI * 2;
    tooth.position.set(Math.cos(angle) * w * 0.47, 0, Math.sin(angle) * d * 0.47);
    tooth.rotation.y = -angle;
    group.add(tooth);
  }

  const hole = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(w, d) * 0.14, Math.min(w, d) * 0.14, h * 0.82, lod.radial), material);
  hole.rotation.z = Math.PI / 2;
  hole.scale.set(1, 1, 1);
  hole.material = new THREE.MeshStandardMaterial({ color: '#057fb7', roughness: 0.6 });
  group.add(hole);
  return group;
}

function fin(model: ModelPart, material: THREE.Material, lodLevel: LodLevel) {
  const group = new THREE.Group();
  const [w, h, d] = model.dims;
  const lod = lodSegments(lodLevel);
  const base = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, h * 0.34, d * 0.7), material);
  group.add(base);
  if (lod.edges) addEdges(base, group);

  const finCount = lodLevel === 'performance' ? 3 : 5;
  for (let index = 0; index < finCount; index += 1) {
    const finMesh = new THREE.Mesh(new THREE.BoxGeometry(w * 0.12, h * 0.96, d * 0.62), material);
    finMesh.position.x = -w * 0.34 + index * (w * 0.68) / Math.max(finCount - 1, 1);
    finMesh.position.y = h * 0.24;
    finMesh.rotation.z = (index - (finCount - 1) / 2) * 0.05;
    group.add(finMesh);
  }

  return group;
}

function bracket(model: ModelPart, material: THREE.Material, lodLevel: LodLevel) {
  const group = new THREE.Group();
  const [w, h, d] = model.dims;
  const lod = lodSegments(lodLevel);
  const base = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.34, d * 0.72), material);
  base.position.y = -h * 0.2;
  group.add(base);
  if (lod.edges) addEdges(base, group);

  const uprightA = new THREE.Mesh(new THREE.BoxGeometry(w * 0.18, h * 0.95, d * 0.72), material);
  uprightA.position.set(-w * 0.38, h * 0.1, 0);
  group.add(uprightA);

  const uprightB = uprightA.clone();
  uprightB.position.x = w * 0.38;
  group.add(uprightB);

  const bridge = new THREE.Mesh(new THREE.CylinderGeometry(d * 0.18, d * 0.18, w * 0.78, lod.radial), material);
  bridge.rotation.z = Math.PI / 2;
  bridge.position.y = h * 0.36;
  group.add(bridge);
  return group;
}

function uploaded(model: ModelPart, material: THREE.Material, lodLevel: LodLevel) {
  const group = new THREE.Group();
  const meshData = model.customMesh;

  if (!meshData) return bracket(model, material, lodLevel);

  if (lodLevel === 'performance') {
    const [w, h, d] = model.dims;
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    group.add(proxy);
    return group;
  }

  const mesh = new THREE.Mesh(uploadedGeometryFor(meshData), material);
  group.add(mesh);

  return group;
}

export function createPartObject(model: ModelPart, isSelected: boolean, renderSettings: RenderSettings) {
  const material = createPartMaterial(isSelected, renderSettings.realisticShaders);
  const object =
    model.kind === 'uploaded'
      ? uploaded(model, material, renderSettings.lodLevel)
      : model.kind === 'shell'
      ? shell(model, material, renderSettings.lodLevel)
      : model.kind === 'gear'
        ? gear(model, material, renderSettings.lodLevel)
        : model.kind === 'fin'
          ? fin(model, material, renderSettings.lodLevel)
          : bracket(model, material, renderSettings.lodLevel);
  object.name = model.id;
  object.userData.modelId = model.id;
  object.position.set(...model.position);
  object.quaternion.set(...model.quaternion);
  object.visible = model.visible;
  return object;
}
