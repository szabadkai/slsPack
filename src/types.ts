export type CollisionShape = 'box' | 'sphere';
export type VisualKind = 'shell' | 'gear' | 'fin' | 'bracket' | 'uploaded';
export type ModelSource = 'procedural' | 'uploaded';
export type PrinterModel = 'Fuse 1' | 'Fuse X1';
export type LodLevel = 'performance' | 'balanced' | 'quality';

export type Vec3Tuple = [number, number, number];
export type QuatTuple = [number, number, number, number];

export interface CustomMeshData {
  positions: Float32Array;
  normals?: Float32Array;
  indices?: Uint32Array;
}

export interface BuildVolume {
  width: number;
  depth: number;
  height: number;
}

export interface ModelPart {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  selected?: boolean;
  position: Vec3Tuple;
  quaternion: QuatTuple;
  dims: Vec3Tuple;
  radius: number;
  shape: CollisionShape;
  kind: VisualKind;
  source: ModelSource;
  customMesh?: CustomMeshData;
  volumeCc: number;
  warnings: string[];
}

export interface PackMetrics {
  totalPowderL: number;
  totalPowderKg: number;
  sinteredPowderL: number;
  sinteredPowderKg: number;
  packingDensity: number;
  layerCount: number;
  printTimeHours: number;
  occupiedHeight: number;
  status: 'idle' | 'simulating' | 'packed' | 'validating';
  validation: string;
}

export type PackingPhase = 'drop' | 'shake' | 'settle';

export interface PackingFrame {
  phase: PackingPhase;
  positions: Vec3Tuple[];
  quaternions: QuatTuple[];
}

export interface PackingSimulation {
  finalModels: ModelPart[];
  frames: PackingFrame[];
}

export interface RenderSettings {
  showFps: boolean;
  occlusionCulling: boolean;
  realisticShaders: boolean;
  rasterResolution: number;
  lodLevel: LodLevel;
}

export interface JobSettings {
  material: string;
  layerThicknessMm: number;
  printProfile: string;
  printer: PrinterModel;
  partCount: number;
  seed: number;
  sliceLayer: number;
  showSlice: boolean;
  cageEnabled: boolean;
}
