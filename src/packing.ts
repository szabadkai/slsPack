import * as CANNON from 'cannon-es';
import type {
  BuildVolume,
  JobSettings,
  ModelPart,
  PackingFrame,
  PackingPhase,
  PackingSimulation,
  PackMetrics,
  PrinterModel,
  QuatTuple,
  Vec3Tuple,
  VisualKind,
} from './types';

export const PRINTER_SPECS: Record<PrinterModel, { buildVolume: BuildVolume; maxPartCount: number; throughputKgPerHr: number }> = {
  'Fuse 1': {
    buildVolume: {
      width: 16.5,
      depth: 16.5,
      height: 30,
    },
    maxPartCount: 300,
    throughputKgPerHr: 0.063,
  },
  'Fuse X1': {
    buildVolume: {
      width: 33,
      depth: 33,
      height: 56.5,
    },
    maxPartCount: 540,
    throughputKgPerHr: 0.33,
  },
};

export const BUILD_VOLUME: BuildVolume = PRINTER_SPECS['Fuse 1'].buildVolume;

export function getBuildVolume(settings: Pick<JobSettings, 'printer'> | PrinterModel = 'Fuse 1') {
  const printer = typeof settings === 'string' ? settings : settings.printer;
  return PRINTER_SPECS[printer]?.buildVolume ?? BUILD_VOLUME;
}

export function getPrinterMaxPartCount(settings: Pick<JobSettings, 'printer'> | PrinterModel = 'Fuse 1') {
  const printer = typeof settings === 'string' ? settings : settings.printer;
  return PRINTER_SPECS[printer]?.maxPartCount ?? PRINTER_SPECS['Fuse 1'].maxPartCount;
}

const NYLON_DENSITY_KG_PER_L = 1.04;

function mulberry32(seed: number) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBetween(rand: () => number, min: number, max: number) {
  return min + (max - min) * rand();
}

function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

function volumeFor(kind: VisualKind, dims: Vec3Tuple, radius: number) {
  const [w, h, d] = dims;
  const box = w * h * d;
  const sphere = (4 / 3) * Math.PI * radius ** 3;
  const estimate =
    kind === 'gear'
      ? box * 0.72
      : kind === 'fin'
        ? box * 0.58
        : kind === 'bracket'
          ? box * 0.66
          : kind === 'uploaded'
            ? box * 0.5
          : sphere * 0.82 + box * 0.24;
  return estimate * 2.1;
}

export function createGeneratedParts(count: number, seed: number, startIndex = 0, buildVolume: BuildVolume = BUILD_VOLUME): ModelPart[] {
  const rand = mulberry32(seed + startIndex * 53);
  const kinds: VisualKind[] = ['shell', 'gear', 'fin', 'bracket'];
  const models: ModelPart[] = [];
  const columns = Math.ceil(Math.sqrt(count));
  const xStep = Math.max(2.1, buildVolume.width / (columns + 1));
  const zStep = Math.max(2.1, buildVolume.depth / (columns + 1));

  for (let index = 0; index < count; index += 1) {
    const partNumber = startIndex + index + 1;
    const kind = kinds[Math.floor(rand() * kinds.length)] ?? 'shell';
    const width = randomBetween(rand, 2.55, 3.8);
    const height = randomBetween(rand, 1.65, 2.85);
    const depth = randomBetween(rand, 2.35, 4.15);
    const radius = Math.max(width, height, depth) * randomBetween(rand, 0.45, 0.56);
    const column = index % columns;
    const row = Math.floor(index / columns) % columns;
    const layer = Math.floor(index / (columns * columns));
    const x = -buildVolume.width / 2 + xStep * (column + 1) + randomBetween(rand, -0.35, 0.35);
    const z = -buildVolume.depth / 2 + zStep * (row + 1) + randomBetween(rand, -0.35, 0.35);
    const y = 2.2 + layer * 3.2 + randomBetween(rand, -0.35, 0.35);
    const yaw = randomBetween(rand, -Math.PI, Math.PI);
    const pitch = randomBetween(rand, -0.45, 0.45);
    const roll = randomBetween(rand, -0.55, 0.55);
    const q = new CANNON.Quaternion();
    q.setFromEuler(pitch, yaw, roll, 'XYZ');
    const dims: Vec3Tuple = [width, height, depth];

    models.push({
      id: `part-${partNumber}`,
      name: `cat_ams2 (${partNumber})`,
      visible: true,
      locked: false,
      position: [x, y, z],
      quaternion: [q.x, q.y, q.z, q.w],
      dims,
      radius,
      shape: rand() < 0.22 ? 'sphere' : 'box',
      kind,
      source: 'procedural',
      volumeCc: volumeFor(kind, dims, radius),
      warnings: [],
    });
  }

  return models;
}

export function createJob(settings: Pick<JobSettings, 'partCount' | 'seed'> & Partial<Pick<JobSettings, 'printer'>>): ModelPart[] {
  return createGeneratedParts(settings.partCount, settings.seed, 0, settings.printer ? getBuildVolume(settings.printer) : BUILD_VOLUME);
}

interface PackingWall {
  body: CANNON.Body;
  basePosition: CANNON.Vec3;
}

function createWall(
  world: CANNON.World,
  halfExtents: Vec3Tuple,
  position: Vec3Tuple,
  material: CANNON.Material,
  type: CANNON.BodyType = CANNON.Body.STATIC,
): PackingWall {
  const basePosition = new CANNON.Vec3(...position);
  const body = new CANNON.Body({ mass: 0, material, type });
  body.addShape(new CANNON.Box(new CANNON.Vec3(...halfExtents)));
  body.position.copy(basePosition);
  world.addBody(body);
  return { body, basePosition };
}

function dropStartForIndex(index: number, rand: () => number, buildVolume: BuildVolume): Vec3Tuple {
  const columns = 6;
  const rows = 5;
  const perLayer = columns * rows;
  const layer = Math.floor(index / perLayer);
  const column = index % columns;
  const row = Math.floor(index / columns) % rows;
  const xStep = buildVolume.width / (columns + 1);
  const zStep = buildVolume.depth / (rows + 1);
  const yStep = 2.22;
  const stagger = layer % 2 === 0 ? 0 : 0.5;

  return [
    -buildVolume.width / 2 + xStep * (column + 1 + stagger * 0.28) + randomBetween(rand, -0.55, 0.55),
    buildVolume.height - 1.8 - layer * yStep + randomBetween(rand, -0.25, 0.25),
    -buildVolume.depth / 2 + zStep * (row + 1 + stagger * 0.22) + randomBetween(rand, -0.55, 0.55),
  ];
}

function makeBody(
  model: ModelPart,
  rand: () => number,
  index: number,
  material: CANNON.Material,
  start: 'drop' | 'current',
  buildVolume: BuildVolume,
  dropIndex = index,
) {
  const [w, h, d] = model.dims;
  const body = new CANNON.Body({
    mass: model.locked ? 0 : Math.max(0.32, model.volumeCc / 75),
    material,
    linearDamping: 0.36,
    angularDamping: 0.54,
    sleepSpeedLimit: 0.08,
    sleepTimeLimit: 0.4,
  });

  if (model.shape === 'sphere') {
    body.addShape(new CANNON.Sphere(Math.max(w, h, d) * 0.43));
  } else {
    body.addShape(new CANNON.Box(new CANNON.Vec3(w * 0.43, h * 0.43, d * 0.43)));
  }

  if (start === 'current') {
    body.position.set(...model.position);
    body.quaternion.set(...model.quaternion);
  } else {
    const [x, y, z] = dropStartForIndex(dropIndex, rand, buildVolume);
    const q = new CANNON.Quaternion();
    q.setFromEuler(randomBetween(rand, -1.6, 1.6), randomBetween(rand, -Math.PI, Math.PI), randomBetween(rand, -1.6, 1.6), 'XYZ');
    body.position.set(x, y, z);
    body.quaternion.copy(q);
  }
  return body;
}

function createFrame(bodies: CANNON.Body[], phase: PackingPhase): PackingFrame {
  return {
    phase,
    positions: bodies.map((body) => [body.position.x, body.position.y, body.position.z] as Vec3Tuple),
    quaternions: bodies.map((body) => [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w] as QuatTuple),
  };
}

function buildFinalModels(models: ModelPart[], bodies: CANNON.Body[], buildVolume: BuildVolume) {
  return models.map((model, index) => {
    const body = bodies[index];
    const xMargin = model.dims[0] * 0.4;
    const yMargin = model.dims[1] / 2;
    const zMargin = model.dims[2] * 0.4;
    const clampedX = Math.min(Math.max(body.position.x, -buildVolume.width / 2 + xMargin), buildVolume.width / 2 - xMargin);
    const clampedY = Math.min(Math.max(body.position.y, yMargin), buildVolume.height - yMargin);
    const clampedZ = Math.min(Math.max(body.position.z, -buildVolume.depth / 2 + zMargin), buildVolume.depth / 2 - zMargin);
    const top = clampedY + model.dims[1] / 2;
    const warning = top > buildVolume.height + 0.01 ? ['Near build height limit'] : [];
    return {
      ...model,
      position: [clampedX, clampedY, clampedZ] as Vec3Tuple,
      quaternion: [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w] as QuatTuple,
      warnings: warning,
    };
  });
}

function shakeEnvelope(step: number, rampSteps: number, holdSteps: number, releaseSteps: number) {
  if (step < rampSteps) return step / Math.max(rampSteps, 1);
  if (step < rampSteps + holdSteps) return 1;
  return clamp01(1 - (step - rampSteps - holdSteps) / Math.max(releaseSteps, 1));
}

function buildVolumeShakeOffset(step: number, fixedStep: number, intensity: number) {
  const t = step * fixedStep;
  return new CANNON.Vec3(
    Math.sin(t * Math.PI * 2 * 7.2) * 0.07 * intensity,
    Math.sin(t * Math.PI * 2 * 12.8) * 0.035 * intensity,
    Math.sin(t * Math.PI * 2 * 5.9 + 1.1) * 0.07 * intensity,
  );
}

function moveBuildVolumeWalls(walls: PackingWall[], offset: CANNON.Vec3, fixedStep: number) {
  walls.forEach(({ body, basePosition }) => {
    const nextX = basePosition.x + offset.x;
    const nextY = basePosition.y + offset.y;
    const nextZ = basePosition.z + offset.z;
    body.velocity.set(
      (nextX - body.position.x) / fixedStep,
      (nextY - body.position.y) / fixedStep,
      (nextZ - body.position.z) / fixedStep,
    );
    body.position.set(nextX, nextY, nextZ);
    body.aabbNeedsUpdate = true;
  });
}

function applyBuildVolumeShake(bodies: CANNON.Body[], step: number, fixedStep: number, buildVolume: BuildVolume, intensity: number) {
  if (intensity <= 0) return;
  const t = step * fixedStep;
  const lateralX = -Math.sin(t * Math.PI * 2 * 7.2) * 14 * intensity;
  const lateralZ = -Math.sin(t * Math.PI * 2 * 5.9 + 1.1) * 14 * intensity;
  const tap = Math.max(0, Math.sin(t * Math.PI * 2 * 13.4));
  const vertical = tap * tap * 9 * intensity;

  bodies.forEach((body) => {
    if (body.mass === 0) return;
    body.wakeUp();
    body.applyForce(new CANNON.Vec3(lateralX * body.mass, vertical * body.mass, lateralZ * body.mass), body.position);
    body.applyTorque(
      new CANNON.Vec3(
        (body.position.z / Math.max(buildVolume.depth, 1)) * vertical * body.mass * 0.26,
        0,
        -(body.position.x / Math.max(buildVolume.width, 1)) * vertical * body.mass * 0.26,
      ),
    );
  });
}

function createPackingWorld(settings: Pick<JobSettings, 'cageEnabled' | 'printer'>, options: { kinematicVolume?: boolean } = {}) {
  const buildVolume = getBuildVolume(settings);
  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -24, 0),
  });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  const solver = world.solver as CANNON.GSSolver;
  solver.iterations = 18;
  solver.tolerance = 0.001;

  const partMaterial = new CANNON.Material('nylon');
  const wallMaterial = new CANNON.Material('powder-bed');
  world.addContactMaterial(
    new CANNON.ContactMaterial(partMaterial, wallMaterial, {
      friction: 0.82,
      restitution: 0.02,
      contactEquationStiffness: 1e7,
      contactEquationRelaxation: 4,
    }),
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(partMaterial, partMaterial, {
      friction: 0.62,
      restitution: 0.03,
      contactEquationStiffness: 1e7,
      contactEquationRelaxation: 5,
    }),
  );

  const wall = 0.22;
  const wallType = options.kinematicVolume ? CANNON.Body.KINEMATIC : CANNON.Body.STATIC;
  const walls = [
    createWall(world, [buildVolume.width / 2, wall / 2, buildVolume.depth / 2], [0, -wall / 2, 0], wallMaterial, wallType),
    createWall(
      world,
      [wall / 2, buildVolume.height / 2, buildVolume.depth / 2],
      [-buildVolume.width / 2 - wall / 2, buildVolume.height / 2, 0],
      wallMaterial,
      wallType,
    ),
    createWall(
      world,
      [wall / 2, buildVolume.height / 2, buildVolume.depth / 2],
      [buildVolume.width / 2 + wall / 2, buildVolume.height / 2, 0],
      wallMaterial,
      wallType,
    ),
    createWall(
      world,
      [buildVolume.width / 2, buildVolume.height / 2, wall / 2],
      [0, buildVolume.height / 2, -buildVolume.depth / 2 - wall / 2],
      wallMaterial,
      wallType,
    ),
    createWall(
      world,
      [buildVolume.width / 2, buildVolume.height / 2, wall / 2],
      [0, buildVolume.height / 2, buildVolume.depth / 2 + wall / 2],
      wallMaterial,
      wallType,
    ),
  ];

  if (settings.cageEnabled) {
    walls.push(
      createWall(
        world,
        [buildVolume.width / 2, wall / 2, buildVolume.depth / 2],
        [0, buildVolume.height + wall / 2, 0],
        wallMaterial,
        wallType,
      ),
    );
  }

  return { world, partMaterial, buildVolume, walls };
}

export function simulatePackingTimeline(models: ModelPart[], settings: Pick<JobSettings, 'seed' | 'cageEnabled' | 'printer'>): PackingSimulation {
  const rand = mulberry32(settings.seed + 911);
  const { world, partMaterial, buildVolume, walls } = createPackingWorld(settings, { kinematicVolume: true });

  const bodies = models.map((model, index) => {
    const body = makeBody(model, rand, index, partMaterial, 'drop', buildVolume);
    world.addBody(body);
    return body;
  });

  const fixedStep = 1 / 60;
  const frames: PackingFrame[] = [createFrame(bodies, 'drop')];
  for (let step = 0; step < 780; step += 1) {
    const shake = step >= 180 && step < 560 ? shakeEnvelope(step - 180, 60, 190, 130) : 0;
    moveBuildVolumeWalls(walls, buildVolumeShakeOffset(step, fixedStep, shake * 0.72), fixedStep);
    applyBuildVolumeShake(bodies, step, fixedStep, buildVolume, shake * 0.85);
    world.step(fixedStep);
    if (step % 8 === 0 || step === 779) {
      frames.push(createFrame(bodies, step < 160 ? 'drop' : step < 420 ? 'shake' : 'settle'));
    }
  }

  const finalModels = buildFinalModels(models, bodies, buildVolume);
  frames.push({
    phase: 'settle',
    positions: finalModels.map((model) => model.position),
    quaternions: finalModels.map((model) => model.quaternion),
  });

  return { finalModels, frames };
}

export function simulateShakeTimeline(models: ModelPart[], settings: Pick<JobSettings, 'seed' | 'cageEnabled' | 'printer'>): PackingSimulation {
  const rand = mulberry32(settings.seed + models.length * 17 + 3231);
  const { world, partMaterial, buildVolume, walls } = createPackingWorld(settings, { kinematicVolume: true });
  const bodies = models.map((model, index) => {
    const body = makeBody(model, rand, index, partMaterial, 'current', buildVolume);
    world.addBody(body);
    return body;
  });

  const fixedStep = 1 / 60;
  const frames: PackingFrame[] = [createFrame(bodies, 'shake')];
  for (let step = 0; step < 560; step += 1) {
    const shake = step < 410 ? shakeEnvelope(step, 45, 230, 135) : 0;
    moveBuildVolumeWalls(walls, buildVolumeShakeOffset(step, fixedStep, shake), fixedStep);
    applyBuildVolumeShake(bodies, step, fixedStep, buildVolume, shake);
    world.step(fixedStep);
    if (step % 6 === 0 || step === 559) {
      frames.push(createFrame(bodies, step < 420 ? 'shake' : 'settle'));
    }
  }

  const finalModels = buildFinalModels(models, bodies, buildVolume);
  frames.push({
    phase: 'settle',
    positions: finalModels.map((model) => model.position),
    quaternions: finalModels.map((model) => model.quaternion),
  });

  return { finalModels, frames };
}

export function simulateDropInTimeline(
  existingModels: ModelPart[],
  addedModels: ModelPart[],
  settings: Pick<JobSettings, 'seed' | 'cageEnabled' | 'printer'>,
): PackingSimulation {
  const rand = mulberry32(settings.seed + existingModels.length * 43 + addedModels.length * 719 + 12007);
  const { world, partMaterial, buildVolume, walls } = createPackingWorld(settings, { kinematicVolume: true });
  const bodies: CANNON.Body[] = [];

  existingModels.forEach((model, index) => {
    const body = makeBody(model, rand, index, partMaterial, 'current', buildVolume);
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    world.addBody(body);
    bodies.push(body);
  });

  addedModels.forEach((model, index) => {
    const body = makeBody(model, rand, existingModels.length + index, partMaterial, 'drop', buildVolume, index);
    body.velocity.set(randomBetween(rand, -1.2, 1.2), randomBetween(rand, -2.8, -0.8), randomBetween(rand, -1.2, 1.2));
    body.angularVelocity.set(randomBetween(rand, -2.4, 2.4), randomBetween(rand, -2.4, 2.4), randomBetween(rand, -2.4, 2.4));
    world.addBody(body);
    bodies.push(body);
  });

  const fixedStep = 1 / 60;
  const frames: PackingFrame[] = [createFrame(bodies, 'drop')];
  for (let step = 0; step < 700; step += 1) {
    const shake = step >= 170 && step < 540 ? shakeEnvelope(step - 170, 50, 170, 150) : 0;
    moveBuildVolumeWalls(walls, buildVolumeShakeOffset(step, fixedStep, shake * 0.85), fixedStep);
    applyBuildVolumeShake(bodies, step, fixedStep, buildVolume, shake * 0.9);
    world.step(fixedStep);
    if (step % 6 === 0 || step === 699) {
      frames.push(createFrame(bodies, step < 260 ? 'drop' : step < 560 ? 'shake' : 'settle'));
    }
  }

  const finalModels = buildFinalModels([...existingModels, ...addedModels], bodies, buildVolume);
  frames.push({
    phase: 'settle',
    positions: finalModels.map((model) => model.position),
    quaternions: finalModels.map((model) => model.quaternion),
  });

  return { finalModels, frames };
}

export function simulatePacking(models: ModelPart[], settings: Pick<JobSettings, 'seed' | 'cageEnabled' | 'printer'>) {
  return simulatePackingTimeline(models, settings).finalModels;
}

export function calculateMetrics(models: ModelPart[], settings: Pick<JobSettings, 'layerThicknessMm' | 'printer'>): PackMetrics {
  const buildVolume = getBuildVolume(settings);
  const totalVolumeL = (buildVolume.width * buildVolume.depth * buildVolume.height) / 1000;
  const sinteredL = models.reduce((sum, model) => sum + model.volumeCc, 0) / 1000;
  const occupiedTop = models.reduce((top, model) => Math.max(top, model.position[1] + model.dims[1] / 2), 0);
  const occupiedVolumeL = (buildVolume.width * buildVolume.depth * Math.max(occupiedTop, 1)) / 1000;
  const packingDensity = Math.min(88, (sinteredL / Math.max(occupiedVolumeL, 0.1)) * 100);
  const layerCount = Math.ceil((buildVolume.height * 10) / settings.layerThicknessMm);
  const printTimeHours = 0.9 + layerCount * 0.0048 + models.length * 0.015;

  return {
    totalPowderL: totalVolumeL,
    totalPowderKg: totalVolumeL * 0.59,
    sinteredPowderL: sinteredL,
    sinteredPowderKg: sinteredL * NYLON_DENSITY_KG_PER_L,
    packingDensity,
    layerCount,
    printTimeHours,
    occupiedHeight: occupiedTop,
    status: 'idle',
    validation: models.some((model) => model.warnings.length > 0) ? 'Review part height warnings' : 'Ready to slice',
  };
}
