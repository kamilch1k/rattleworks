import * as THREE from 'three';
import { PhysicsWorld } from '../../src/game/PhysicsWorld';
import {
  createIndustrialTruck,
  createParkedCar,
  createParkedTank,
  type VehiclePrefabOptions,
} from '../../src/game/VehiclePrefabs';
import type { Entity, SpawnDefinition, Vec3 } from '../../src/game/types';

const FIXED_STEP = 1 / 60;
const IDLE_FRAMES = 600;
const SETTLE_FRAMES = 180;
const BLAST_FRAMES = 180;

interface Pose {
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
}

interface PrefabScenario {
  name: string;
  definitions: number;
  idle: {
    spawned: number;
    broken: number;
    explosions: number;
    connectors: number;
    peakSpeed: number;
    peakAngularSpeed: number;
    lateActiveBodies: number;
    maxDisplacement: number;
    maxDrop: number;
    maxRotationDegrees: number;
    finite: boolean;
  };
  destruction: {
    spawned: number;
    vehicleBreaks: number;
    explosions: number;
    removedVehicleParts: number;
    displacedVehicleParts: number;
    finite: boolean;
  };
  impact: {
    vehicleBreaks: number;
    removedVehicleParts: number;
    displacedVehicleParts: number;
    finite: boolean;
  };
}

export interface VehiclePrefabRegressionReport {
  pass: boolean;
  assertions: Array<{ name: string; pass: boolean; detail: string }>;
  scenarios: PrefabScenario[];
}

type PrefabFactory = (origin: Vec3, group: string, options?: VehiclePrefabOptions) => SpawnDefinition[];

const round = (value: number): number => Number(value.toFixed(4));

function pose(entity: Entity): Pose {
  const position = entity.body.translation();
  const rotation = entity.body.rotation();
  return {
    position: new THREE.Vector3(position.x, position.y, position.z),
    rotation: new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
  };
}

function isFiniteEntity(entity: Entity): boolean {
  if (!entity.body.isValid()) return false;
  const position = entity.body.translation();
  const rotation = entity.body.rotation();
  const linear = entity.body.linvel();
  const angular = entity.body.angvel();
  return [
    position.x, position.y, position.z,
    rotation.x, rotation.y, rotation.z, rotation.w,
    linear.x, linear.y, linear.z,
    angular.x, angular.y, angular.z,
  ].every(Number.isFinite);
}

function spawnDefinitions(physics: PhysicsWorld, definitions: SpawnDefinition[]): Entity[] {
  const result: Entity[] = [];
  for (const definition of definitions) {
    const spawned = physics.spawn(definition, false);
    if (spawned && 'body' in spawned) result.push(spawned);
  }
  return result;
}

function runIdle(name: string, factory: PrefabFactory): PrefabScenario['idle'] {
  let broken = 0;
  let explosions = 0;
  const physics = new PhysicsWorld(new THREE.Scene(), undefined, {
    onBreak: () => { broken += 1; },
    onExplosion: () => { explosions += 1; },
  });
  physics.setQuality('high');
  const entities = spawnDefinitions(physics, factory({ x: 0, y: 0, z: 0 }, `vehicle-test-${name}`, { yaw: 0.37 }));
  const initial = new Map(entities.map((entity) => [entity.id, pose(entity)]));
  let peakSpeed = 0;
  let peakAngularSpeed = 0;
  let lateActiveBodies = 0;
  let finite = true;

  for (let frame = 0; frame < IDLE_FRAMES; frame += 1) {
    physics.update(FIXED_STEP);
    let activeBodies = 0;
    for (const entity of physics.entities.values()) {
      finite = finite && isFiniteEntity(entity);
      if (!entity.body.isValid() || entity.fixed) continue;
      const linear = entity.body.linvel();
      const angular = entity.body.angvel();
      peakSpeed = Math.max(peakSpeed, Math.hypot(linear.x, linear.y, linear.z));
      peakAngularSpeed = Math.max(peakAngularSpeed, Math.hypot(angular.x, angular.y, angular.z));
      if (!entity.body.isSleeping()) activeBodies += 1;
    }
    if (frame >= IDLE_FRAMES - 120) lateActiveBodies = Math.max(lateActiveBodies, activeBodies);
  }

  let maxDisplacement = 0;
  let maxDrop = 0;
  let maxRotationDegrees = 0;
  for (const entity of entities) {
    const before = initial.get(entity.id);
    if (!before || !physics.entities.has(entity.id) || !entity.body.isValid()) continue;
    const after = pose(entity);
    maxDisplacement = Math.max(maxDisplacement, before.position.distanceTo(after.position));
    maxDrop = Math.max(maxDrop, before.position.y - after.position.y);
    maxRotationDegrees = Math.max(maxRotationDegrees, THREE.MathUtils.radToDeg(before.rotation.angleTo(after.rotation)));
  }

  const result = {
    spawned: entities.length,
    broken,
    explosions,
    connectors: physics.connectors.size,
    peakSpeed: round(peakSpeed),
    peakAngularSpeed: round(peakAngularSpeed),
    lateActiveBodies,
    maxDisplacement: round(maxDisplacement),
    maxDrop: round(maxDrop),
    maxRotationDegrees: round(maxRotationDegrees),
    finite,
  };
  physics.clear();
  return result;
}

function runDestruction(name: string, factory: PrefabFactory): PrefabScenario['destruction'] {
  let vehicleBreaks = 0;
  let explosions = 0;
  const physics = new PhysicsWorld(new THREE.Scene(), undefined, {
    onBreak: (entity) => {
      if (entity.group === `vehicle-test-${name}`) vehicleBreaks += 1;
    },
    onExplosion: () => { explosions += 1; },
  });
  physics.setQuality('high');
  const entities = spawnDefinitions(physics, factory({ x: 0, y: 0, z: 0 }, `vehicle-test-${name}`));
  for (let frame = 0; frame < SETTLE_FRAMES; frame += 1) physics.update(FIXED_STEP);
  const before = new Map(entities
    .filter((entity) => physics.entities.has(entity.id) && entity.body.isValid())
    .map((entity) => [entity.id, pose(entity)]));

  physics.explode(new THREE.Vector3(0, 0.82, 0), 3.8, 118);
  let finite = true;
  for (let frame = 0; frame < BLAST_FRAMES; frame += 1) {
    physics.update(FIXED_STEP);
    for (const entity of physics.entities.values()) finite = finite && isFiniteEntity(entity);
  }

  let removedVehicleParts = 0;
  let displacedVehicleParts = 0;
  for (const entity of entities) {
    const initialPose = before.get(entity.id);
    if (!initialPose) continue;
    if (!physics.entities.has(entity.id) || !entity.body.isValid()) {
      removedVehicleParts += 1;
      continue;
    }
    const after = pose(entity);
    if (after.position.distanceTo(initialPose.position) > 0.8
      || THREE.MathUtils.radToDeg(initialPose.rotation.angleTo(after.rotation)) > 20) {
      displacedVehicleParts += 1;
    }
  }

  const result = {
    spawned: entities.length,
    vehicleBreaks,
    explosions,
    removedVehicleParts,
    displacedVehicleParts,
    finite,
  };
  physics.clear();
  return result;
}

function runProjectileImpact(name: string, factory: PrefabFactory): PrefabScenario['impact'] {
  let vehicleBreaks = 0;
  const physics = new PhysicsWorld(new THREE.Scene(), undefined, {
    onBreak: (entity) => {
      if (entity.group === `vehicle-test-${name}`) vehicleBreaks += 1;
    },
  });
  physics.setQuality('high');
  const entities = spawnDefinitions(physics, factory({ x: 0, y: 0, z: 0 }, `vehicle-test-${name}`));
  for (let frame = 0; frame < SETTLE_FRAMES; frame += 1) physics.update(FIXED_STEP);
  const before = new Map(entities
    .filter((entity) => physics.entities.has(entity.id) && entity.body.isValid())
    .map((entity) => [entity.id, pose(entity)]));
  const projectile = physics.spawn({
    type: 'heavy-ball',
    position: { x: -7, y: 0.88, z: 0 },
    scale: { x: 1.1, y: 1.1, z: 1.1 },
    material: 'concrete',
  }, true);
  if (projectile && 'body' in projectile) {
    projectile.body.setLinvel({ x: 30, y: 0, z: 0 }, true);
  }

  let finite = Boolean(projectile && 'body' in projectile);
  for (let frame = 0; frame < BLAST_FRAMES; frame += 1) {
    physics.update(FIXED_STEP);
    for (const entity of physics.entities.values()) finite = finite && isFiniteEntity(entity);
  }

  let removedVehicleParts = 0;
  let displacedVehicleParts = 0;
  for (const entity of entities) {
    const initialPose = before.get(entity.id);
    if (!initialPose) continue;
    if (!physics.entities.has(entity.id) || !entity.body.isValid()) {
      removedVehicleParts += 1;
      continue;
    }
    const after = pose(entity);
    if (after.position.distanceTo(initialPose.position) > 0.45
      || THREE.MathUtils.radToDeg(initialPose.rotation.angleTo(after.rotation)) > 15) {
      displacedVehicleParts += 1;
    }
  }
  const result = { vehicleBreaks, removedVehicleParts, displacedVehicleParts, finite };
  physics.clear();
  return result;
}

export function runVehiclePrefabRegression(): VehiclePrefabRegressionReport {
  const factories: Array<{ name: string; factory: PrefabFactory }> = [
    { name: 'car', factory: createParkedCar },
    { name: 'tank', factory: createParkedTank },
    { name: 'industrial-truck', factory: createIndustrialTruck },
  ];
  const scenarios = factories.map(({ name, factory }) => {
    const definitions = factory({ x: 0, y: 0, z: 0 }, `vehicle-test-${name}`).length;
    return {
      name,
      definitions,
      idle: runIdle(name, factory),
      impact: runProjectileImpact(name, factory),
      destruction: runDestruction(name, factory),
    };
  });

  const assertions: VehiclePrefabRegressionReport['assertions'] = [];
  const assert = (name: string, pass: boolean, detail: string): void => {
    assertions.push({ name, pass, detail });
  };
  for (const scenario of scenarios) {
    const { idle, impact, destruction } = scenario;
    assert(`${scenario.name}: all definitions spawn`, idle.spawned === scenario.definitions,
      `${idle.spawned}/${scenario.definitions} spawned`);
    assert(`${scenario.name}: no implicit connectors`, idle.connectors === 0, `${idle.connectors} connectors`);
    assert(`${scenario.name}: no idle break or blast`, idle.broken === 0 && idle.explosions === 0,
      `${idle.broken} breaks, ${idle.explosions} explosions`);
    assert(`${scenario.name}: finite idle simulation`, idle.finite, 'all body values remain finite');
    assert(`${scenario.name}: bounded idle pose`, idle.maxDisplacement < 0.45 && idle.maxRotationDegrees < 18,
      `${idle.maxDisplacement}m max displacement, ${idle.maxRotationDegrees}deg max rotation`);
    assert(`${scenario.name}: settles by late window`, idle.lateActiveBodies === 0,
      `${idle.lateActiveBodies} awake bodies in final two seconds`);
    assert(`${scenario.name}: heavy-ball impact dismantles vehicle`,
      impact.vehicleBreaks >= 1 && impact.removedVehicleParts + impact.displacedVehicleParts >= 2,
      `${impact.vehicleBreaks} broken, ${impact.removedVehicleParts} removed, ${impact.displacedVehicleParts} displaced`);
    assert(`${scenario.name}: finite impact simulation`, impact.finite,
      'all surviving body values remain finite');
    assert(`${scenario.name}: blast visibly dismantles vehicle`,
      destruction.vehicleBreaks >= 1 && destruction.removedVehicleParts + destruction.displacedVehicleParts >= 3,
      `${destruction.vehicleBreaks} broken, ${destruction.removedVehicleParts} removed, ${destruction.displacedVehicleParts} displaced`);
    assert(`${scenario.name}: one deliberate blast only`, destruction.explosions === 1,
      `${destruction.explosions} explosion callbacks`);
    assert(`${scenario.name}: finite destruction simulation`, destruction.finite,
      'all surviving body values remain finite');
  }

  // Explosive cargo is optional and must remain inert while parked.
  let cargoExplosions = 0;
  const cargoPhysics = new PhysicsWorld(new THREE.Scene(), undefined, {
    onExplosion: () => { cargoExplosions += 1; },
  });
  const cargoDefinitions = createIndustrialTruck(
    { x: 0, y: 0, z: 0 },
    'vehicle-test-hazardous-cargo',
    { hazardousCargo: true },
  );
  const cargoEntities = spawnDefinitions(cargoPhysics, cargoDefinitions);
  for (let frame = 0; frame < IDLE_FRAMES; frame += 1) cargoPhysics.update(FIXED_STEP);
  const cargoDrums = cargoEntities.filter((entity) => entity.type === 'explosive-barrel');
  assert('hazardous cargo: four drums spawn', cargoDrums.length === 4, `${cargoDrums.length} drums`);
  assert('hazardous cargo: no spontaneous detonation', cargoExplosions === 0,
    `${cargoExplosions} explosion callbacks`);
  cargoPhysics.clear();

  return {
    pass: assertions.every((assertion) => assertion.pass),
    assertions,
    scenarios,
  };
}
