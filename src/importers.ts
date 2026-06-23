import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { BUILD_VOLUME } from './packing';
import type { BuildVolume, CustomMeshData, ModelPart, QuatTuple, Vec3Tuple } from './types';

function maxImportedPartSize(buildVolume: BuildVolume) {
  return Math.min(buildVolume.width, buildVolume.depth) * 0.78;
}

function fileBaseName(file: File) {
  return file.name.replace(/\.[^/.]+$/, '') || file.name;
}

function copyVectorAttribute(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) {
  const values = new Float32Array(attribute.count * 3);
  for (let index = 0; index < attribute.count; index += 1) {
    values[index * 3] = attribute.getX(index);
    values[index * 3 + 1] = attribute.getY(index);
    values[index * 3 + 2] = attribute.getZ(index);
  }
  return values;
}

function serializeGeometry(geometry: THREE.BufferGeometry): CustomMeshData {
  const position = geometry.getAttribute('position');
  if (!position) throw new Error('Model has no vertex positions');

  const normal = geometry.getAttribute('normal');
  const index = geometry.getIndex();

  return {
    positions: copyVectorAttribute(position),
    normals: normal ? copyVectorAttribute(normal) : undefined,
    indices: index ? new Uint32Array(Array.from(index.array)) : undefined,
  };
}

function geometryFromObject(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  const positions: number[] = [];

  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    const position = geometry.getAttribute('position');
    for (let index = 0; index < position.count; index += 1) {
      positions.push(position.getX(index), position.getY(index), position.getZ(index));
    }
    geometry.dispose();
  });

  if (!positions.length) throw new Error('Model has no mesh geometry');
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.computeVertexNormals();
  return merged;
}

function normalizeGeometry(geometry: THREE.BufferGeometry, buildVolume: BuildVolume) {
  geometry.computeBoundingBox();
  const rawBox = geometry.boundingBox;
  if (!rawBox) throw new Error('Could not measure model bounds');

  const rawSize = new THREE.Vector3();
  rawBox.getSize(rawSize);
  const rawLargest = Math.max(rawSize.x, rawSize.y, rawSize.z);
  if (!Number.isFinite(rawLargest) || rawLargest <= 0) throw new Error('Model bounds are empty');

  const maxPartSize = maxImportedPartSize(buildVolume);
  const unitScale = rawLargest > buildVolume.width ? 0.1 : 1;
  const fitScale = rawLargest * unitScale > maxPartSize ? maxPartSize / (rawLargest * unitScale) : 1;
  const scale = unitScale * fitScale;
  geometry.scale(scale, scale, scale);
  geometry.computeBoundingBox();

  const box = geometry.boundingBox;
  if (!box) throw new Error('Could not normalize model bounds');
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const dims: Vec3Tuple = [Math.max(size.x, 0.15), Math.max(size.y, 0.15), Math.max(size.z, 0.15)];
  return dims;
}

function estimateMeshVolumeCc(mesh: CustomMeshData, dims: Vec3Tuple) {
  const { positions, indices } = mesh;
  let signedVolume = 0;

  const addTriangle = (aIndex: number, bIndex: number, cIndex: number) => {
    const ax = positions[aIndex * 3];
    const ay = positions[aIndex * 3 + 1];
    const az = positions[aIndex * 3 + 2];
    const bx = positions[bIndex * 3];
    const by = positions[bIndex * 3 + 1];
    const bz = positions[bIndex * 3 + 2];
    const cx = positions[cIndex * 3];
    const cy = positions[cIndex * 3 + 1];
    const cz = positions[cIndex * 3 + 2];
    signedVolume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  };

  if (indices?.length) {
    for (let index = 0; index + 2 < indices.length; index += 3) {
      addTriangle(indices[index], indices[index + 1], indices[index + 2]);
    }
  } else {
    for (let index = 0; index + 2 < positions.length / 3; index += 3) {
      addTriangle(index, index + 1, index + 2);
    }
  }

  const measuredVolume = Math.abs(signedVolume);
  const boxFallback = dims[0] * dims[1] * dims[2] * 0.48;
  return Number.isFinite(measuredVolume) && measuredVolume > 0.05 ? measuredVolume : boxFallback;
}

async function parseModelFile(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'stl') {
    const buffer = await file.arrayBuffer();
    return new STLLoader().parse(buffer);
  }
  if (extension === 'obj') {
    const text = await file.text();
    return geometryFromObject(new OBJLoader().parse(text));
  }
  throw new Error(`${file.name} is not an STL or OBJ file`);
}

export async function createImportedParts(files: File[], startIndex: number, buildVolume: BuildVolume = BUILD_VOLUME): Promise<ModelPart[]> {
  const imported: ModelPart[] = [];

  for (const [fileIndex, file] of files.entries()) {
    const geometry = await parseModelFile(file);
    const dims = normalizeGeometry(geometry, buildVolume);
    const mesh = serializeGeometry(geometry);
    const radius = Math.max(dims[0], dims[1], dims[2]) * 0.5;
    const quaternion: QuatTuple = [0, 0, 0, 1];
    const position: Vec3Tuple = [0, buildVolume.height - 2 - fileIndex * 1.2, 0];

    imported.push({
      id: `upload-${startIndex + fileIndex + 1}`,
      name: fileBaseName(file),
      visible: true,
      locked: false,
      position,
      quaternion,
      dims,
      radius,
      shape: dims[0] / Math.max(dims[2], 0.1) < 1.18 && dims[2] / Math.max(dims[0], 0.1) < 1.18 ? 'sphere' : 'box',
      kind: 'uploaded',
      source: 'uploaded',
      customMesh: mesh,
      volumeCc: estimateMeshVolumeCc(mesh, dims),
      warnings: [],
    });

    geometry.dispose();
  }

  return imported;
}
