import { useEffect, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createPartObject } from './geometry';
import type { BuildVolume, ModelPart, PackingFrame, RenderSettings } from './types';

type PackingFrameSink = (frame: PackingFrame | null) => void;

interface ThreeViewportProps {
  models: ModelPart[];
  selectedId: string | null;
  sliceLayer: number;
  layerCount: number;
  showSlice: boolean;
  buildVolume: BuildVolume;
  renderSettings: RenderSettings;
  packingFrameSinkRef: RefObject<PackingFrameSink | null>;
  onSelectModel: (id: string) => void;
}

function pixelRatioFor(renderSettings: RenderSettings) {
  return Math.min(Math.max((window.devicePixelRatio * renderSettings.rasterResolution) / 100, 0.35), 3);
}

function createBuildBox(buildVolume: BuildVolume) {
  const group = new THREE.Group();
  const box = new THREE.BoxGeometry(buildVolume.width, buildVolume.height, buildVolume.depth);
  const edges = new THREE.EdgesGeometry(box);
  const outline = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: '#48bff7', transparent: true, opacity: 0.74 }),
  );
  outline.position.y = buildVolume.height / 2;
  group.add(outline);

  const transparent = new THREE.Mesh(
    box,
    new THREE.MeshBasicMaterial({
      color: '#dff6ff',
      transparent: true,
      opacity: 0.045,
      depthWrite: false,
    }),
  );
  transparent.position.y = buildVolume.height / 2;
  group.add(transparent);

  const grid = new THREE.GridHelper(buildVolume.width, Math.round(buildVolume.width), '#82919d', '#c7d1d9');
  grid.position.y = 0.01;
  grid.scale.z = buildVolume.depth / buildVolume.width;
  group.add(grid);
  return group;
}

const MAX_INTERSECTION_SEGMENTS = 12000;
const PLANE_EPSILON = 0.0008;

function isVisibleInTree(object: THREE.Object3D) {
  let cursor: THREE.Object3D | null = object;
  while (cursor) {
    if (!cursor.visible) return false;
    cursor = cursor.parent;
  }
  return true;
}

function pushUniquePoint(points: THREE.Vector3[], point: THREE.Vector3) {
  if (points.some((existing) => existing.distanceToSquared(point) < 0.000001)) return;
  points.push(point.clone());
}

function collectPlaneEdgePoints(a: THREE.Vector3, b: THREE.Vector3, da: number, db: number, points: THREE.Vector3[]) {
  const aOnPlane = Math.abs(da) <= PLANE_EPSILON;
  const bOnPlane = Math.abs(db) <= PLANE_EPSILON;

  if (aOnPlane && bOnPlane) return;
  if (aOnPlane) {
    pushUniquePoint(points, a);
    return;
  }
  if (bOnPlane) {
    pushUniquePoint(points, b);
    return;
  }
  if (da * db > 0) return;

  const t = da / (da - db);
  pushUniquePoint(points, new THREE.Vector3().lerpVectors(a, b, t));
}

function addTriangleIntersection(
  target: number[],
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  layerY: number,
) {
  const da = a.y - layerY;
  const db = b.y - layerY;
  const dc = c.y - layerY;

  if (da > PLANE_EPSILON && db > PLANE_EPSILON && dc > PLANE_EPSILON) return;
  if (da < -PLANE_EPSILON && db < -PLANE_EPSILON && dc < -PLANE_EPSILON) return;

  const points: THREE.Vector3[] = [];
  collectPlaneEdgePoints(a, b, da, db, points);
  collectPlaneEdgePoints(b, c, db, dc, points);
  collectPlaneEdgePoints(c, a, dc, da, points);

  if (points.length < 2) return;
  const p0 = points[0];
  const p1 = points[1];
  if (p0.distanceToSquared(p1) < 0.000001) return;

  target.push(p0.x, layerY + 0.045, p0.z, p1.x, layerY + 0.045, p1.z);
}

function createIntersectionLines(parts: THREE.Group | null, layerY: number) {
  if (!parts) return null;

  parts.updateMatrixWorld(true);
  const positions: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  parts.traverse((object) => {
    if (positions.length / 6 >= MAX_INTERSECTION_SEGMENTS) return;
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || !isVisibleInTree(mesh)) return;

    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    if (!position) return;

    const index = geometry.getIndex();
    const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
    for (let triangle = 0; triangle < triangleCount && positions.length / 6 < MAX_INTERSECTION_SEGMENTS; triangle += 1) {
      const ia = index ? index.getX(triangle * 3) : triangle * 3;
      const ib = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
      const ic = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
      a.fromBufferAttribute(position, ia).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position, ib).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position, ic).applyMatrix4(mesh.matrixWorld);
      addTriangleIntersection(positions, a, b, c, layerY);
    }
  });

  if (!positions.length) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const lines = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({
      color: '#f97316',
      transparent: true,
      opacity: 0.98,
      depthTest: false,
      depthWrite: false,
    }),
  );
  lines.renderOrder = 8;
  return lines;
}

function createSliceGroup(parts: THREE.Group | null, layerY: number, buildVolume: BuildVolume) {
  const group = new THREE.Group();
  const fillHeight = Math.max(buildVolume.height - layerY, 0);
  if (fillHeight > 0.05) {
    const fillVolume = new THREE.Mesh(
      new THREE.BoxGeometry(buildVolume.width, fillHeight, buildVolume.depth),
      new THREE.MeshBasicMaterial({
        color: '#f4c76f',
        transparent: true,
        opacity: 0.085,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    fillVolume.position.y = layerY + fillHeight / 2;
    group.add(fillVolume);
  }

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(buildVolume.width, buildVolume.depth),
    new THREE.MeshBasicMaterial({ color: '#f59e0b', transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide }),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = layerY;
  group.add(plane);

  const intersections = createIntersectionLines(parts, layerY);
  if (intersections) group.add(intersections);

  return group;
}

function applyPartClipping(parts: THREE.Group | null, clippingPlanes: THREE.Plane[] | null) {
  if (!parts) return;

  parts.traverse((object) => {
    const maybeRenderable = object as THREE.Mesh | THREE.LineSegments;
    const material = maybeRenderable.material;
    if (!material) return;

    const materials = Array.isArray(material) ? material : [material];
    materials.forEach((item) => {
      item.clippingPlanes = clippingPlanes;
      item.clipIntersection = false;
      item.needsUpdate = true;
    });
  });
}

function applyCulling(parts: THREE.Group | null, enabled: boolean) {
  if (!parts) return;
  parts.traverse((object) => {
    object.frustumCulled = enabled;
  });
}

function modelRenderSignature(model: ModelPart, isSelected: boolean, renderSettings: RenderSettings) {
  const meshData = model.customMesh;
  return [
    model.kind,
    model.source,
    model.shape,
    model.dims.map((value) => value.toFixed(4)).join(','),
    model.radius.toFixed(4),
    meshData ? `${meshData.positions.length}:${meshData.normals?.length ?? 0}:${meshData.indices?.length ?? 0}` : 'procedural',
    renderSettings.lodLevel,
    renderSettings.realisticShaders ? 'metal' : 'standard',
    isSelected ? 'selected' : 'normal',
  ].join('|');
}

function syncPartObject(object: THREE.Object3D, model: ModelPart, renderSettings: RenderSettings) {
  object.position.set(...model.position);
  object.quaternion.set(...model.quaternion);
  object.visible = model.visible;
  object.traverse((child) => {
    child.frustumCulled = renderSettings.occlusionCulling;
  });
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh | THREE.LineSegments;
    if ('geometry' in mesh && mesh.geometry && !mesh.geometry.userData.sharedUploadedGeometry) mesh.geometry.dispose();
    const material = 'material' in mesh ? mesh.material : undefined;
    if (!material) return;
    const materials = Array.isArray(material) ? material : [material];
    materials.forEach((item) => item.dispose());
  });
}

export function ThreeViewport({
  models,
  selectedId,
  sliceLayer,
  layerCount,
  showSlice,
  buildVolume,
  renderSettings,
  packingFrameSinkRef,
  onSelectModel,
}: ThreeViewportProps) {
  const [renderStats, setRenderStats] = useState({ fps: 0, calls: 0, triangles: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const environmentRef = useRef<THREE.Texture | null>(null);
  const hemiRef = useRef<THREE.HemisphereLight | null>(null);
  const keyRef = useRef<THREE.DirectionalLight | null>(null);
  const partGroupRef = useRef<THREE.Group | null>(null);
  const sliceRef = useRef<THREE.Group | null>(null);
  const modelLookupRef = useRef(new Map<string, THREE.Object3D>());
  const modelIdsRef = useRef<string[]>(models.map((model) => model.id));
  const pendingPackingFrameRef = useRef<PackingFrame | null>(null);

  modelIdsRef.current = models.map((model) => model.id);

  useEffect(() => {
    const sink: PackingFrameSink = (frame) => {
      pendingPackingFrameRef.current = frame;
    };
    packingFrameSinkRef.current = sink;
    return () => {
      if (packingFrameSinkRef.current === sink) packingFrameSinkRef.current = null;
    };
  }, [packingFrameSinkRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#e8edf1');
    const volumeScale = Math.max(buildVolume.width / 16.5, buildVolume.depth / 16.5, buildVolume.height / 30);
    scene.fog = new THREE.Fog('#e8edf1', 78 * volumeScale, 135 * volumeScale);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.1, 260 * volumeScale);
    camera.position.set(29 * volumeScale, 27 * volumeScale, 49 * volumeScale);
    camera.lookAt(0, buildVolume.height * 0.49, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(pixelRatioFor(renderSettings));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.localClippingEnabled = true;
    renderer.shadowMap.enabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;
    container.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    environmentRef.current = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environment = renderSettings.realisticShaders ? environmentRef.current : null;

    const hemi = new THREE.HemisphereLight('#f8fbff', '#95a3ad', 2.4);
    hemiRef.current = hemi;
    scene.add(hemi);
    const key = new THREE.DirectionalLight('#ffffff', 2.6);
    key.position.set(12 * volumeScale, 25 * volumeScale, 16 * volumeScale);
    key.castShadow = true;
    keyRef.current = key;
    scene.add(key);
    scene.add(createBuildBox(buildVolume));

    const parts = new THREE.Group();
    partGroupRef.current = parts;
    scene.add(parts);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, buildVolume.height * 0.47, 0);
    controls.minDistance = 24 * volumeScale;
    controls.maxDistance = 92 * volumeScale;
    controls.maxPolarAngle = Math.PI * 0.48;
    controlsRef.current = controls;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const handlePointerDown = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(parts.children, true);
      const hit = hits.find((item) => {
        let cursor: THREE.Object3D | null = item.object;
        while (cursor) {
          if (cursor.userData.modelId) return true;
          cursor = cursor.parent;
        }
        return false;
      });
      if (hit) {
        let cursor: THREE.Object3D | null = hit.object;
        while (cursor && !cursor.userData.modelId) cursor = cursor.parent;
        if (cursor?.userData.modelId) onSelectModel(cursor.userData.modelId);
      }
    };
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);

    const resizeObserver = new ResizeObserver(() => {
      if (!container.clientWidth || !container.clientHeight) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    });
    resizeObserver.observe(container);

    let frame = 0;
    let fpsFrames = 0;
    let fpsStartedAt = 0;
    let lastRenderedAt = 0;
    const targetPosition = new THREE.Vector3();
    const targetQuaternion = new THREE.Quaternion();

    const animate = (time: number) => {
      frame = requestAnimationFrame(animate);
      if (!fpsStartedAt) fpsStartedAt = time;
      const packingFrame = pendingPackingFrameRef.current;
      if (packingFrame) {
        const deltaSeconds = lastRenderedAt ? (time - lastRenderedAt) / 1000 : 1 / 60;
        const blend = Math.min(1, 1 - Math.exp(-deltaSeconds * 18));
        packingFrame.positions.forEach((position, index) => {
          const id = modelIdsRef.current[index];
          if (!id) return;
          const object = modelLookupRef.current.get(id);
          if (!object) return;
          targetPosition.set(...position);
          object.position.lerp(targetPosition, blend);
          const quaternion = packingFrame.quaternions[index];
          if (!quaternion) return;
          targetQuaternion.set(...quaternion);
          object.quaternion.slerp(targetQuaternion, blend);
        });
      }
      lastRenderedAt = time;
      controls.update();
      renderer.render(scene, camera);
      fpsFrames += 1;
      if (time - fpsStartedAt >= 500) {
        setRenderStats({
          fps: Math.round((fpsFrames * 1000) / Math.max(time - fpsStartedAt, 1)),
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
        });
        fpsStartedAt = time;
        fpsFrames = 0;
      }
    };
    frame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      controls.dispose();
      partGroupRef.current?.children.forEach(disposeObject);
      environmentRef.current?.dispose();
      environmentRef.current = null;
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [onSelectModel, buildVolume]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const container = containerRef.current;
    if (!renderer || !container) return;
    if (sceneRef.current) sceneRef.current.environment = renderSettings.realisticShaders ? environmentRef.current : null;
    renderer.setPixelRatio(pixelRatioFor(renderSettings));
    renderer.toneMapping = renderSettings.realisticShaders ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    renderer.toneMappingExposure = renderSettings.realisticShaders ? 1.06 : 1;
    renderer.shadowMap.type = renderSettings.realisticShaders ? THREE.PCFShadowMap : THREE.BasicShadowMap;
    renderer.setSize(container.clientWidth, container.clientHeight);
    if (hemiRef.current) hemiRef.current.intensity = renderSettings.realisticShaders ? 1.65 : 2.4;
    if (keyRef.current) keyRef.current.intensity = renderSettings.realisticShaders ? 3.2 : 2.6;
  }, [renderSettings.rasterResolution, renderSettings.realisticShaders]);

  useEffect(() => {
    const parts = partGroupRef.current;
    if (!parts) return;
    const seen = new Set<string>();

    models.forEach((model) => {
      const isSelected = model.id === selectedId;
      const signature = modelRenderSignature(model, isSelected, renderSettings);
      const existing = modelLookupRef.current.get(model.id);
      if (existing && existing.userData.modelSignature === signature) {
        syncPartObject(existing, model, renderSettings);
        seen.add(model.id);
        return;
      }

      if (existing) {
        parts.remove(existing);
        disposeObject(existing);
      }

      const object = createPartObject(model, isSelected, renderSettings);
      object.userData.modelSignature = signature;
      syncPartObject(object, model, renderSettings);
      parts.add(object);
      modelLookupRef.current.set(model.id, object);
      seen.add(model.id);
    });

    Array.from(modelLookupRef.current.entries()).forEach(([id, object]) => {
      if (seen.has(id)) return;
      parts.remove(object);
      disposeObject(object);
      modelLookupRef.current.delete(id);
    });
  }, [models, selectedId, buildVolume, renderSettings.realisticShaders, renderSettings.lodLevel, renderSettings.occlusionCulling]);

  useEffect(() => {
    applyCulling(partGroupRef.current, renderSettings.occlusionCulling);
  }, [renderSettings.occlusionCulling]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (sliceRef.current) {
      scene.remove(sliceRef.current);
      disposeObject(sliceRef.current);
      sliceRef.current = null;
    }
    const layerY = (sliceLayer / Math.max(layerCount, 1)) * buildVolume.height;
    if (!showSlice) {
      applyPartClipping(partGroupRef.current, null);
      return;
    }

    applyPartClipping(partGroupRef.current, [new THREE.Plane(new THREE.Vector3(0, -1, 0), layerY)]);
    const slice = createSliceGroup(partGroupRef.current, layerY, buildVolume);
    sliceRef.current = slice;
    scene.add(slice);
  }, [models, selectedId, sliceLayer, layerCount, showSlice, buildVolume, renderSettings.lodLevel, renderSettings.realisticShaders]);

  return (
    <div className="viewport" ref={containerRef}>
      {renderSettings.showFps ? (
        <div className="fps-counter" data-testid="fps-counter">
          <strong>{renderStats.fps}</strong>
          <span>FPS</span>
          <small>
            {renderStats.calls} calls | {Math.round(renderStats.triangles / 1000)}k tris
          </small>
        </div>
      ) : null}
    </div>
  );
}
