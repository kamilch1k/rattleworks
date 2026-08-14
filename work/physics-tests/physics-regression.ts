import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { PhysicsWorld } from '../../src/game/PhysicsWorld';
import { SelectionSystem } from '../../src/game/SelectionSystem';
import { LEVELS } from '../../src/game/levels';
import type { Character, Entity } from '../../src/game/types';

const FIXED_STEP = 1 / 60;
const DEFAULT_SECONDS = 10;
const LINEAR_SPEED_CAP = 70;
const ANGULAR_SPEED_CAP = 35;
const SPEED_EPSILON = 0.05;

interface PhysicsSnapshot {
  active: number;
  sleeping: number;
  entities: number;
  characters: number;
  connectors: number;
  rigidBodies: number;
  colliders: number;
  impulseJoints: number;
  maxLinearSpeed: number;
  maxAngularSpeed: number;
  rmsLinearSpeed: number;
  rmsAngularSpeed: number;
  maxAbsCoordinate: number;
  invalidBodyIds: number[];
  nonFiniteBodyIds: number[];
}

interface Assertion {
  name: string;
  pass: boolean;
  actual: number | string | boolean;
  expected: string;
}

interface ScenarioResult {
  name: string;
  simulatedSeconds: number;
  frames: number;
  durationMs: number;
  pass: boolean;
  assertions: Assertion[];
  failures: string[];
  initial: PhysicsSnapshot;
  final: PhysicsSnapshot;
  observed: {
    peakLinearSpeed: number;
    peakAngularSpeed: number;
    peakAbsCoordinate: number;
    lateRmsLinearSpeed: number;
    lateRmsAngularSpeed: number;
  };
}

interface RegressionReport {
  version: 1;
  generatedAt: string;
  source: string;
  pass: boolean;
  scenarios: ScenarioResult[];
}

declare global {
  interface Window {
    __RATTLEWORKS_PHYSICS_REGRESSION__?: RegressionReport;
  }
}

function magnitude(vector: { x: number; y: number; z: number }): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function isFiniteVector(vector: { x: number; y: number; z: number }): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

function snapshot(physics: PhysicsWorld): PhysicsSnapshot {
  let active = 0;
  let sleeping = 0;
  let maxLinearSpeed = 0;
  let maxAngularSpeed = 0;
  let linearSquares = 0;
  let angularSquares = 0;
  let maxAbsCoordinate = 0;
  const invalidBodyIds: number[] = [];
  const nonFiniteBodyIds: number[] = [];

  for (const entity of physics.entities.values()) {
    if (!entity.body.isValid()) {
      invalidBodyIds.push(entity.id);
      continue;
    }

    entity.body.isSleeping() ? sleeping++ : active++;
    const position = entity.body.translation();
    const rotation = entity.body.rotation();
    const linear = entity.body.linvel();
    const angular = entity.body.angvel();
    const finite = isFiniteVector(position)
      && isFiniteVector(linear)
      && isFiniteVector(angular)
      && [rotation.x, rotation.y, rotation.z, rotation.w].every(Number.isFinite);

    if (!finite) nonFiniteBodyIds.push(entity.id);
    const linearSpeed = magnitude(linear);
    const angularSpeed = magnitude(angular);
    maxLinearSpeed = Math.max(maxLinearSpeed, linearSpeed);
    maxAngularSpeed = Math.max(maxAngularSpeed, angularSpeed);
    linearSquares += linearSpeed * linearSpeed;
    angularSquares += angularSpeed * angularSpeed;
    maxAbsCoordinate = Math.max(
      maxAbsCoordinate,
      Math.abs(position.x),
      Math.abs(position.y),
      Math.abs(position.z),
    );
  }

  const count = Math.max(1, physics.entities.size);
  return {
    active,
    sleeping,
    entities: physics.entities.size,
    characters: physics.characters.size,
    connectors: physics.connectors.size,
    rigidBodies: physics.world.bodies.len(),
    colliders: physics.world.colliders.len(),
    impulseJoints: physics.world.impulseJoints.len(),
    maxLinearSpeed,
    maxAngularSpeed,
    rmsLinearSpeed: Math.sqrt(linearSquares / count),
    rmsAngularSpeed: Math.sqrt(angularSquares / count),
    maxAbsCoordinate,
    invalidBodyIds,
    nonFiniteBodyIds,
  };
}

function assertion(
  name: string,
  pass: boolean,
  actual: number | string | boolean,
  expected: string,
): Assertion {
  return { name, pass, actual, expected };
}

function rounded(value: number): number {
  return Number(value.toFixed(4));
}

function requireEntity(spawned: Entity | Character | null, fixture: string): Entity {
  if (!spawned || !('body' in spawned)) throw new Error(`Failed to spawn ${fixture} fixture.`);
  return spawned;
}

function quaternionDistance(
  a: { x: number; y: number; z: number; w: number },
  b: { x: number; y: number; z: number; w: number },
): number {
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return 2 * Math.acos(THREE.MathUtils.clamp(dot, -1, 1));
}

function noteInvariantFailures(
  failures: Set<string>,
  sample: PhysicsSnapshot,
  frame: number,
  coordinateBound: number,
): void {
  if (sample.invalidBodyIds.length) {
    failures.add(`frame ${frame}: invalid rigid bodies ${sample.invalidBodyIds.slice(0, 8).join(', ')}`);
  }
  if (sample.nonFiniteBodyIds.length) {
    failures.add(`frame ${frame}: NaN/Infinity on bodies ${sample.nonFiniteBodyIds.slice(0, 8).join(', ')}`);
  }
  if (sample.rigidBodies !== sample.entities + 1) {
    failures.add(`frame ${frame}: Rapier body count ${sample.rigidBodies} != tracked entities + ground ${sample.entities + 1}`);
  }
  const expectedColliderCount = sample.entities + 1 + sample.characters * 4;
  if (sample.colliders !== expectedColliderCount) {
    failures.add(`frame ${frame}: Rapier collider count ${sample.colliders} != tracked entities + ground + four extremities per character ${expectedColliderCount}`);
  }
  if (sample.maxLinearSpeed > LINEAR_SPEED_CAP + SPEED_EPSILON) {
    failures.add(`frame ${frame}: linear speed ${sample.maxLinearSpeed.toFixed(3)} exceeded ${LINEAR_SPEED_CAP}`);
  }
  if (sample.maxAngularSpeed > ANGULAR_SPEED_CAP + SPEED_EPSILON) {
    failures.add(`frame ${frame}: angular speed ${sample.maxAngularSpeed.toFixed(3)} exceeded ${ANGULAR_SPEED_CAP}`);
  }
  if (sample.maxAbsCoordinate > coordinateBound) {
    failures.add(`frame ${frame}: body coordinate ${sample.maxAbsCoordinate.toFixed(3)} exceeded scene bound ${coordinateBound}`);
  }
}

function disposePhysics(physics: PhysicsWorld): void {
  const internals = physics as unknown as { eventQueue?: { free: () => void } };
  internals.eventQueue?.free();
  physics.world.free();
}

async function nextFrame(realtime: boolean): Promise<void> {
  if (realtime) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 1000 / 60));
  } else {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
}

async function simulate(
  physics: PhysicsWorld,
  seconds: number,
  realtime: boolean,
  failures: Set<string>,
  coordinateBound: number,
  beforeStep?: (frame: number) => void,
  observe?: (frame: number, sample: PhysicsSnapshot) => void,
): Promise<{
  final: PhysicsSnapshot;
  peakLinearSpeed: number;
  peakAngularSpeed: number;
  peakAbsCoordinate: number;
  lateRmsLinearSpeed: number;
  lateRmsAngularSpeed: number;
}> {
  const frames = Math.round(seconds / FIXED_STEP);
  const lateStart = Math.floor(frames * 0.8);
  let peakLinearSpeed = 0;
  let peakAngularSpeed = 0;
  let peakAbsCoordinate = 0;
  let lateLinearSquares = 0;
  let lateAngularSquares = 0;
  let lateSamples = 0;

  for (let frame = 1; frame <= frames; frame++) {
    beforeStep?.(frame);
    physics.update(FIXED_STEP);
    const sample = snapshot(physics);
    noteInvariantFailures(failures, sample, frame, coordinateBound);
    peakLinearSpeed = Math.max(peakLinearSpeed, sample.maxLinearSpeed);
    peakAngularSpeed = Math.max(peakAngularSpeed, sample.maxAngularSpeed);
    peakAbsCoordinate = Math.max(peakAbsCoordinate, sample.maxAbsCoordinate);
    if (frame >= lateStart) {
      lateLinearSquares += sample.rmsLinearSpeed * sample.rmsLinearSpeed;
      lateAngularSquares += sample.rmsAngularSpeed * sample.rmsAngularSpeed;
      lateSamples++;
    }
    observe?.(frame, sample);

    if (realtime || frame % 15 === 0) await nextFrame(realtime);
  }

  return {
    final: snapshot(physics),
    peakLinearSpeed,
    peakAngularSpeed,
    peakAbsCoordinate,
    lateRmsLinearSpeed: Math.sqrt(lateLinearSquares / Math.max(1, lateSamples)),
    lateRmsAngularSpeed: Math.sqrt(lateAngularSquares / Math.max(1, lateSamples)),
  };
}

function spawnRagdollStress(physics: PhysicsWorld): void {
  const kinds = ['dummy', 'worker', 'monster', 'knight'] as const;
  for (let i = 0; i < 20; i++) {
    const spawned = physics.spawn({
      type: 'character',
      variant: kinds[i % kinds.length],
      position: {
        x: (i % 5) * 2.2 - 4.4,
        y: 0.2 + Math.floor(i / 5) * 1.4,
        z: (Math.floor(i / 5) % 2) * 2 - 1,
      },
    });
    if (spawned && 'parts' in spawned) spawned.parts.forEach((part) => part.body.wakeUp());
  }
}

function spawnPropStress(physics: PhysicsWorld): void {
  const types = ['crate', 'barrel', 'concrete-block', 'plank'] as const;
  for (let i = 0; i < 100; i++) {
    physics.spawn({
      type: types[i % types.length],
      position: {
        x: (i % 10) * 1.35 - 6,
        y: 1 + Math.floor(i / 10) * 1.2,
        z: (i % 5) * 1.5 - 3,
      },
    });
  }
}

const COMPOUND_EXTREMITY_PARTS = new Set([
  'lower-arm-l',
  'lower-arm-r',
  'lower-leg-l',
  'lower-leg-r',
]);

function characterBodyColliderCount(character: Character): number {
  return character.parts.reduce((total, part) => total + part.body.numColliders(), 0);
}

function characterCollidersAreFinite(character: Character): boolean {
  for (const part of character.parts) {
    if (!part.body.isValid()) return false;
    for (let index = 0; index < part.body.numColliders(); index++) {
      const collider = part.body.collider(index);
      if (!collider.isValid()) return false;
      const position = collider.translation();
      const rotation = collider.rotation();
      if (!isFiniteVector(position) || ![rotation.x, rotation.y, rotation.z, rotation.w].every(Number.isFinite)) return false;
    }
  }
  return true;
}

function characterColliderOwnershipIsExact(physics: PhysicsWorld, character: Character): boolean {
  return character.parts.every((part) => {
    for (let index = 0; index < part.body.numColliders(); index++) {
      if (physics.colliderToEntity.get(part.body.collider(index).handle) !== part.id) return false;
    }
    return true;
  });
}

function signedRelativeJointAngle(joint: RAPIER.RevoluteImpulseJoint): number {
  const rotationA = joint.body1().rotation();
  const rotationB = joint.body2().rotation();
  const relative = new THREE.Quaternion(rotationA.x, rotationA.y, rotationA.z, rotationA.w)
    .invert()
    .multiply(new THREE.Quaternion(rotationB.x, rotationB.y, rotationB.z, rotationB.w))
    .normalize();
  const twistLength = Math.hypot(relative.z, relative.w);
  if (twistLength < 1e-8) return 0;
  let angle = 2 * Math.atan2(relative.z / twistLength, relative.w / twistLength);
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function jointAnchorError(joint: RAPIER.RevoluteImpulseJoint): number {
  const bodyA = joint.body1();
  const bodyB = joint.body2();
  const positionA = bodyA.translation();
  const positionB = bodyB.translation();
  const rotationA = bodyA.rotation();
  const rotationB = bodyB.rotation();
  const anchorA = joint.anchor1();
  const anchorB = joint.anchor2();
  const worldA = new THREE.Vector3(anchorA.x, anchorA.y, anchorA.z)
    .applyQuaternion(new THREE.Quaternion(rotationA.x, rotationA.y, rotationA.z, rotationA.w))
    .add(new THREE.Vector3(positionA.x, positionA.y, positionA.z));
  const worldB = new THREE.Vector3(anchorB.x, anchorB.y, anchorB.z)
    .applyQuaternion(new THREE.Quaternion(rotationB.x, rotationB.y, rotationB.z, rotationB.w))
    .add(new THREE.Vector3(positionB.x, positionB.y, positionB.z));
  return worldA.distanceTo(worldB);
}

function collectCharacterSelfContacts(
  physics: PhysicsWorld,
  character: Character,
  observedPairs: Set<string>,
): void {
  for (const part of character.parts) {
    for (let index = 0; index < part.body.numColliders(); index++) {
      const collider = part.body.collider(index);
      physics.world.contactPairsWith(collider, (other) => {
        const otherId = physics.colliderToEntity.get(other.handle);
        const otherPart = otherId === undefined ? undefined : physics.entities.get(otherId);
        if (otherPart?.characterId !== character.id || otherPart.id === part.id) return;
        const low = Math.min(collider.handle, other.handle);
        const high = Math.max(collider.handle, other.handle);
        observedPairs.add(`${low}:${high}`);
      });
    }
  }
}

async function runCompoundRagdollIntegrity(seconds: number, realtime: boolean): Promise<ScenarioResult> {
  const started = performance.now();
  let characterHitCallbacks = 0;
  const physics = new PhysicsWorld(new THREE.Scene(), undefined, {
    onCharacterHit: () => { characterHitCallbacks++; },
  });
  physics.setQuality('high');
  // Keep this fixture away from external contacts. Any contacts it observes are
  // between non-adjacent bodies on the same character.
  physics.world.gravity = { x: 0, y: 0, z: 0 };
  const spawned = physics.spawn({ type: 'character', variant: 'dummy', position: { x: 0, y: 4, z: 0 } });
  if (!spawned || !('parts' in spawned)) throw new Error('Failed to spawn compound-ragdoll fixture.');
  const character = spawned as Character;
  const initial = snapshot(physics);
  const initialHealth = character.health;
  const initialPartColliderCounts = new Map(character.parts.map((part) => [part.part, part.body.numColliders()]));
  const initialBodyColliderCount = characterBodyColliderCount(character);
  const initialOwnershipExact = characterColliderOwnershipIsExact(physics, character);
  const joints = physics.world.impulseJoints.getAll() as RAPIER.RevoluteImpulseJoint[];
  const allJointsAreLimitedRevolutes = joints.every((joint) => (
    joint.type() === RAPIER.JointType.Revolute
    && joint.limitsEnabled()
    && !joint.contactsEnabled()
    && Number.isFinite(joint.limitsMin())
    && Number.isFinite(joint.limitsMax())
    && joint.limitsMin() < joint.limitsMax()
  ));
  const maximumConfiguredLimit = Math.max(...joints.map((joint) => (
    Math.max(Math.abs(joint.limitsMin()), Math.abs(joint.limitsMax()))
  )));

  // Fold the four compound extremities slightly into nearby non-adjacent
  // bodies and add a rotational disturbance. This exercises self-contact,
  // joint limits, and the neutral-position motors without any outside impact.
  for (const part of character.parts) {
    if (!COMPOUND_EXTREMITY_PARTS.has(part.part ?? '')) continue;
    const position = part.body.translation();
    const left = part.part?.endsWith('-l') ?? false;
    const inward = left ? 0.12 : -0.12;
    part.body.setTranslation({ x: position.x + inward, y: position.y, z: position.z }, false);
    const arm = part.part?.startsWith('lower-arm') ?? false;
    part.body.setAngvel({ x: 0, y: 0, z: (left ? 1 : -1) * (arm ? 5.5 : 4.5) }, false);
  }
  character.parts.forEach((part) => part.body.wakeUp());

  const failures = new Set<string>();
  const observedSelfContactPairs = new Set<string>();
  const duration = Math.max(10, seconds);
  const frameCount = Math.round(duration / FIXED_STEP);
  const lateStart = Math.floor(frameCount * 0.75);
  let compoundCollidersStayedFinite = true;
  let minimumBodyColliderCount = Number.POSITIVE_INFINITY;
  let maximumRelativeAngle = 0;
  let maximumAnchorError = 0;
  let lateRelativeAngleSquares = 0;
  let lateRelativeAngularSpeedSquares = 0;
  let lateJointSamples = 0;
  const outcome = await simulate(
    physics,
    duration,
    realtime,
    failures,
    20,
    undefined,
    (frame) => {
      collectCharacterSelfContacts(physics, character, observedSelfContactPairs);
      compoundCollidersStayedFinite = compoundCollidersStayedFinite && characterCollidersAreFinite(character);
      minimumBodyColliderCount = Math.min(minimumBodyColliderCount, characterBodyColliderCount(character));
      for (const joint of joints) {
        const relativeAngle = Math.abs(signedRelativeJointAngle(joint));
        const angularA = joint.body1().angvel();
        const angularB = joint.body2().angvel();
        const relativeAngularSpeed = Math.hypot(
          angularB.x - angularA.x,
          angularB.y - angularA.y,
          angularB.z - angularA.z,
        );
        maximumRelativeAngle = Math.max(maximumRelativeAngle, relativeAngle);
        maximumAnchorError = Math.max(maximumAnchorError, jointAnchorError(joint));
        if (frame >= lateStart) {
          lateRelativeAngleSquares += relativeAngle * relativeAngle;
          lateRelativeAngularSpeedSquares += relativeAngularSpeed * relativeAngularSpeed;
          lateJointSamples++;
        }
      }
    },
  );
  const lateRmsRelativeAngle = Math.sqrt(lateRelativeAngleSquares / Math.max(1, lateJointSamples));
  const lateRmsRelativeAngularSpeed = Math.sqrt(lateRelativeAngularSpeedSquares / Math.max(1, lateJointSamples));
  const finalBodyColliderCount = characterBodyColliderCount(character);
  const extremityCountsAreExact = character.parts.every((part) => (
    initialPartColliderCounts.get(part.part) === (COMPOUND_EXTREMITY_PARTS.has(part.part ?? '') ? 2 : 1)
  ));
  const finalCountsAreExact = character.parts.every((part) => (
    part.body.numColliders() === (COMPOUND_EXTREMITY_PARTS.has(part.part ?? '') ? 2 : 1)
  ));
  const assertions = [
    assertion('one ragdoll tracks exactly ten body entities', initial.entities === 10, initial.entities, '10'),
    assertion('one ragdoll has fourteen body colliders', initialBodyColliderCount === 14, initialBodyColliderCount, '14 (10 primary + 4 extremities)'),
    assertion('world collider count includes ragdoll compounds and ground', initial.colliders === 15, initial.colliders, '15 (14 ragdoll + ground)'),
    assertion('one ragdoll has exactly nine anatomical joints', initial.impulseJoints === 9, initial.impulseJoints, '9'),
    assertion('lower arms and legs have two colliders; all other parts have one', extremityCountsAreExact, extremityCountsAreExact, 'true'),
    assertion('all compound handles map to their owning entity', initialOwnershipExact, initialOwnershipExact, 'true'),
    assertion('all anatomical joints are limited contact-disabled revolutes', allJointsAreLimitedRevolutes, allJointsAreLimitedRevolutes, 'true'),
    assertion('anatomical joint limits stay within tuned maximum', maximumConfiguredLimit <= 2.2 + 1e-4, rounded(maximumConfiguredLimit), '<= 2.2 rad'),
    assertion('fold fixture produces non-adjacent self-contact', observedSelfContactPairs.size > 0, observedSelfContactPairs.size, '> 0 unique pairs'),
    assertion('self-contact produces no character damage callback', characterHitCallbacks === 0, characterHitCallbacks, '0'),
    assertion('self-contact leaves character health unchanged', Math.abs(character.health - initialHealth) <= 1e-6, rounded(character.health - initialHealth), '0 health delta'),
    assertion('compound colliders remain finite throughout ten seconds', compoundCollidersStayedFinite, compoundCollidersStayedFinite, 'true'),
    assertion('all fourteen compound body colliders survive ten seconds', minimumBodyColliderCount === 14 && finalBodyColliderCount === 14 && finalCountsAreExact, `${minimumBodyColliderCount}/${finalBodyColliderCount}/${finalCountsAreExact}`, '14 minimum / 14 final / exact per-part counts'),
    assertion('motorized joint motion reaches a meaningful disturbance', maximumRelativeAngle >= 0.08, rounded(maximumRelativeAngle), '>= 0.08 rad'),
    assertion('motorized joints remain inside configured range', maximumRelativeAngle <= maximumConfiguredLimit + 0.16, rounded(maximumRelativeAngle), `<= ${rounded(maximumConfiguredLimit + 0.16)} rad`),
    assertion('joint anchors remain coherent while folding', maximumAnchorError <= 0.16, rounded(maximumAnchorError), '<= 0.16 m'),
    assertion('motorized joints recover to a bounded resting pose', lateRmsRelativeAngle <= 0.55, rounded(lateRmsRelativeAngle), '<= 0.55 rad RMS over final 25%'),
    assertion('motorized joints recover substantially from peak fold', lateRmsRelativeAngle <= maximumRelativeAngle * 0.85, rounded(lateRmsRelativeAngle / Math.max(1e-6, maximumRelativeAngle)), '<= 0.85 of peak fold angle'),
    assertion('motorized relative motion settles', lateRmsRelativeAngularSpeed <= 0.18, rounded(lateRmsRelativeAngularSpeed), '<= 0.18 rad/s RMS over final 25%'),
    assertion('final ragdoll bookkeeping remains exact', outcome.final.entities === 10 && outcome.final.rigidBodies === 11 && outcome.final.colliders === 15 && outcome.final.impulseJoints === 9, `${outcome.final.entities}/${outcome.final.rigidBodies}/${outcome.final.colliders}/${outcome.final.impulseJoints}`, '10 entities / 11 bodies / 15 colliders / 9 joints'),
  ];
  assertions.filter((item) => !item.pass).forEach((item) => failures.add(`${item.name}: got ${item.actual}, expected ${item.expected}`));

  const result: ScenarioResult = {
    name: `compound ragdoll colliders, self-contact, and motor settling / ${duration}-second equivalent`,
    simulatedSeconds: duration,
    frames: frameCount,
    durationMs: rounded(performance.now() - started),
    pass: failures.size === 0,
    assertions,
    failures: [...failures].slice(0, 30),
    initial,
    final: outcome.final,
    observed: {
      peakLinearSpeed: rounded(outcome.peakLinearSpeed),
      peakAngularSpeed: rounded(outcome.peakAngularSpeed),
      peakAbsCoordinate: rounded(outcome.peakAbsCoordinate),
      lateRmsLinearSpeed: rounded(outcome.lateRmsLinearSpeed),
      lateRmsAngularSpeed: rounded(outcome.lateRmsAngularSpeed),
    },
  };
  disposePhysics(physics);
  return result;
}

async function runRagdollStress(seconds: number, realtime: boolean): Promise<ScenarioResult> {
  const started = performance.now();
  const physics = new PhysicsWorld(new THREE.Scene());
  physics.setQuality('high');
  spawnRagdollStress(physics);
  const initial = snapshot(physics);
  const failures = new Set<string>();
  const outcome = await simulate(physics, seconds, realtime, failures, 40);

  const assertions = [
    assertion('initial tracked ragdoll parts', initial.entities === 200, initial.entities, '200'),
    assertion('initial characters', initial.characters === 20, initial.characters, '20'),
    assertion('initial Rapier bodies', initial.rigidBodies === 201, initial.rigidBodies, '201 (200 parts + ground)'),
    assertion('initial Rapier colliders', initial.colliders === 281, initial.colliders, '281 (200 primary + 80 extremities + ground)'),
    assertion('initial ragdoll joints', initial.impulseJoints === 180, initial.impulseJoints, '180 (9 per ragdoll)'),
    assertion('final tracked ragdoll parts', outcome.final.entities === 200, outcome.final.entities, '200'),
    assertion('final compound ragdoll colliders', outcome.final.colliders === 281, outcome.final.colliders, '281'),
    assertion('final ragdoll joints', outcome.final.impulseJoints === 180, outcome.final.impulseJoints, '180'),
    assertion('finite transforms and velocities', outcome.final.nonFiniteBodyIds.length === 0, outcome.final.nonFiniteBodyIds.length, '0 invalid'),
    assertion('linear velocity cap', outcome.peakLinearSpeed <= LINEAR_SPEED_CAP + SPEED_EPSILON, rounded(outcome.peakLinearSpeed), `<= ${LINEAR_SPEED_CAP}`),
    assertion('angular velocity cap', outcome.peakAngularSpeed <= ANGULAR_SPEED_CAP + SPEED_EPSILON, rounded(outcome.peakAngularSpeed), `<= ${ANGULAR_SPEED_CAP}`),
    assertion('late ragdoll motion settles', outcome.lateRmsLinearSpeed <= 0.8, rounded(outcome.lateRmsLinearSpeed), '<= 0.8 m/s RMS over final 20%'),
  ];
  assertions.filter((item) => !item.pass).forEach((item) => failures.add(`${item.name}: got ${item.actual}, expected ${item.expected}`));

  const result: ScenarioResult = {
    name: `20-ragdoll stress / ${seconds}-second equivalent`,
    simulatedSeconds: seconds,
    frames: Math.round(seconds / FIXED_STEP),
    durationMs: rounded(performance.now() - started),
    pass: failures.size === 0,
    assertions,
    failures: [...failures].slice(0, 30),
    initial,
    final: outcome.final,
    observed: {
      peakLinearSpeed: rounded(outcome.peakLinearSpeed),
      peakAngularSpeed: rounded(outcome.peakAngularSpeed),
      peakAbsCoordinate: rounded(outcome.peakAbsCoordinate),
      lateRmsLinearSpeed: rounded(outcome.lateRmsLinearSpeed),
      lateRmsAngularSpeed: rounded(outcome.lateRmsAngularSpeed),
    },
  };
  disposePhysics(physics);
  return result;
}

async function runHeldRagdoll(seconds: number, realtime: boolean): Promise<ScenarioResult> {
  const started = performance.now();
  const physics = new PhysicsWorld(new THREE.Scene());
  physics.setQuality('high');
  const spawned = physics.spawn({ type: 'character', variant: 'dummy', position: { x: 0, y: 0.2, z: 0 } });
  if (!spawned || !('parts' in spawned)) throw new Error('Failed to spawn held-ragdoll fixture.');
  const character = spawned as Character;
  character.parts.forEach((part) => part.body.wakeUp());
  const heldPart = character.parts.find((part) => part.part === 'lower-arm-l') as Entity;
  // A player cannot grab the body in the same instant it is created. Let the
  // fixture reach the ground and let Rapier refresh collider-derived masses
  // before reproducing pointer-down.
  for (let frame = 1; frame <= 120; frame++) {
    physics.update(FIXED_STEP);
    if (frame % 15 === 0) await nextFrame(false);
  }
  const initialPartPosition = heldPart.body.translation();
  const initialPartRotation = heldPart.body.rotation();
  const grabLocalOffset = new THREE.Vector3(0.12, 0, 0.08);
  const initialGrabOffset = grabLocalOffset.clone().applyQuaternion(new THREE.Quaternion(
    initialPartRotation.x,
    initialPartRotation.y,
    initialPartRotation.z,
    initialPartRotation.w,
  ));
  const target = new THREE.Vector3(initialPartPosition.x, initialPartPosition.y, initialPartPosition.z)
    .add(initialGrabOffset)
    .add(new THREE.Vector3(0, 1.5, 0));

  const canvas = document.createElement('canvas');
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  const selection = new SelectionSystem(camera, canvas, physics);
  const linearDamping = heldPart.body.linearDamping();
  const angularDamping = heldPart.body.angularDamping();
  const ccdEnabled = heldPart.body.isCcdEnabled();
  const selectionInternals = selection as unknown as {
    drag?: unknown;
    controlledMass: (entity: Entity) => number;
    isLive: (entity: Entity) => boolean;
  };
  // Invoke the production method instead of duplicating its formula here. A
  // low-mass limb is the regression target: using only its own collider mass
  // made the connected ragdoll oscillate violently under the grab force.
  const controlledMass = selectionInternals.controlledMass(heldPart);
  const selectedPartMass = heldPart.body.mass();
  const aggregateMass = character.parts.reduce((total, part) => total + part.body.mass(), 0);
  const expectedControlledMass = THREE.MathUtils.clamp(
    Math.min(aggregateMass, Math.max(1.8, selectedPartMass * 3.5)),
    0.1,
    35,
  );
  // This is the exact internal state produced by a pointer-down. The superset
  // also keeps the harness compatible with the original, simpler controller.
  heldPart.body.setLinearDamping(Math.max(linearDamping, 1.4));
  heldPart.body.setAngularDamping(Math.max(angularDamping, 2.4));
  const dragFixture = {
    entity: heldPart,
    pointerId: 1,
    depth: 1,
    rawPoint: target.clone(),
    point: target.clone(),
    targetVelocity: new THREE.Vector3(),
    localOffset: grabLocalOffset.clone(),
    controlledMass,
    linearDamping,
    angularDamping,
    ccdEnabled,
  };
  const attachSyntheticGrab = () => {
    // The SelectionSystem intentionally cancels a real grab when its window
    // blurs. Browser test runners often background their tab, so restore this
    // synthetic pointer state before each step to measure the controller rather
    // than tab-focus behavior.
    if (!selectionInternals.drag) {
      heldPart.body.setLinearDamping(Math.max(linearDamping, 1.4));
      heldPart.body.setAngularDamping(Math.max(angularDamping, 2.4));
      heldPart.body.enableCcd(true);
      selectionInternals.drag = dragFixture;
    }
  };
  attachSyntheticGrab();

  const initial = snapshot(physics);
  const failures = new Set<string>();
  const positions: THREE.Vector3[] = [];
  const speeds: number[] = [];
  let controllerDropFrames = 0;
  const fixtureWasLive = selectionInternals.isLive(heldPart);
  const lateStart = Math.round(seconds / FIXED_STEP * 0.5);
  const outcome = await simulate(
    physics,
    seconds,
    realtime,
    failures,
    20,
    () => {
      attachSyntheticGrab();
      selection.update(FIXED_STEP);
      if (!selectionInternals.drag) controllerDropFrames++;
    },
    (frame) => {
      if (frame < lateStart || !heldPart.body.isValid()) return;
      const position = heldPart.body.translation();
      const rotation = heldPart.body.rotation();
      const offset = grabLocalOffset.clone().applyQuaternion(new THREE.Quaternion(
        rotation.x,
        rotation.y,
        rotation.z,
        rotation.w,
      ));
      const grabPoint = new THREE.Vector3(position.x, position.y, position.z).add(offset);
      const pointVelocity = heldPart.body.velocityAtPoint(grabPoint);
      positions.push(grabPoint);
      speeds.push(magnitude(pointVelocity));
    },
  );

  let displacementSquares = 0;
  let maxFrameDisplacement = 0;
  for (let i = 1; i < positions.length; i++) {
    const displacement = positions[i].distanceTo(positions[i - 1]);
    displacementSquares += displacement * displacement;
    maxFrameDisplacement = Math.max(maxFrameDisplacement, displacement);
  }
  const rmsFrameDisplacement = Math.sqrt(displacementSquares / Math.max(1, positions.length - 1));
  const rmsHeldSpeed = Math.sqrt(speeds.reduce((sum, speed) => sum + speed * speed, 0) / Math.max(1, speeds.length));
  const finalPartPosition = heldPart.body.translation();
  const finalPartRotation = heldPart.body.rotation();
  const finalGrabOffset = grabLocalOffset.clone().applyQuaternion(new THREE.Quaternion(
    finalPartRotation.x,
    finalPartRotation.y,
    finalPartRotation.z,
    finalPartRotation.w,
  ));
  const finalGrabPoint = new THREE.Vector3(finalPartPosition.x, finalPartPosition.y, finalPartPosition.z).add(finalGrabOffset);
  const finalTargetError = target.distanceTo(finalGrabPoint);

  const assertions = [
    assertion('initial held-ragdoll parts', initial.entities === 10, initial.entities, '10'),
    assertion('initial held-ragdoll world colliders', initial.colliders === 15, initial.colliders, '15 (14 body colliders + ground)'),
    assertion('initial held-ragdoll joints', initial.impulseJoints === 9, initial.impulseJoints, '9'),
    assertion('selected limb has low mass', selectedPartMass < 1, rounded(selectedPartMass), '< 1 kg'),
    assertion(
      'production controlled mass supports linked limb',
      Math.abs(controlledMass - expectedControlledMass) <= 0.001,
      rounded(controlledMass),
      `${rounded(expectedControlledMass)} kg from aggregate-capped limb formula`,
    ),
    assertion('grab fixture uses off-center surface point', grabLocalOffset.length() >= 0.14, rounded(grabLocalOffset.length()), '>= 0.14 m from COM'),
    assertion('held fixture is live', fixtureWasLive, fixtureWasLive, 'true'),
    assertion('grab controller remained attached', controllerDropFrames === 0, controllerDropFrames, '0 dropped frames'),
    assertion('final held-ragdoll parts', outcome.final.entities === 10, outcome.final.entities, '10'),
    assertion('final held-ragdoll world colliders', outcome.final.colliders === 15, outcome.final.colliders, '15'),
    assertion('final held-ragdoll joints', outcome.final.impulseJoints === 9, outcome.final.impulseJoints, '9'),
    assertion('finite transforms and velocities', outcome.final.nonFiniteBodyIds.length === 0, outcome.final.nonFiniteBodyIds.length, '0 invalid'),
    assertion('linear velocity cap', outcome.peakLinearSpeed <= LINEAR_SPEED_CAP + SPEED_EPSILON, rounded(outcome.peakLinearSpeed), `<= ${LINEAR_SPEED_CAP}`),
    assertion('angular velocity cap', outcome.peakAngularSpeed <= ANGULAR_SPEED_CAP + SPEED_EPSILON, rounded(outcome.peakAngularSpeed), `<= ${ANGULAR_SPEED_CAP}`),
    assertion('held limb target error', finalTargetError <= 0.75, rounded(finalTargetError), '<= 0.75 m'),
    assertion('held limb jitter', rmsFrameDisplacement <= 0.012, rounded(rmsFrameDisplacement), '<= 0.012 m RMS/frame over final 50%'),
    assertion('held limb jitter spike', maxFrameDisplacement <= 0.05, rounded(maxFrameDisplacement), '<= 0.05 m in any late frame'),
    assertion('held limb late speed', rmsHeldSpeed <= 0.7, rounded(rmsHeldSpeed), '<= 0.7 m/s RMS over final 50%'),
  ];
  assertions.filter((item) => !item.pass).forEach((item) => failures.add(`${item.name}: got ${item.actual}, expected ${item.expected}`));

  const result: ScenarioResult = {
    name: `held low-mass ragdoll limb / ${seconds}-second equivalent`,
    simulatedSeconds: seconds,
    frames: Math.round(seconds / FIXED_STEP),
    durationMs: rounded(performance.now() - started),
    pass: failures.size === 0,
    assertions,
    failures: [...failures].slice(0, 30),
    initial,
    final: outcome.final,
    observed: {
      peakLinearSpeed: rounded(outcome.peakLinearSpeed),
      peakAngularSpeed: rounded(outcome.peakAngularSpeed),
      peakAbsCoordinate: rounded(outcome.peakAbsCoordinate),
      lateRmsLinearSpeed: rounded(rmsHeldSpeed),
      lateRmsAngularSpeed: rounded(outcome.lateRmsAngularSpeed),
    },
  };
  selectionInternals.drag = undefined;
  disposePhysics(physics);
  return result;
}

async function runPropStress(seconds: number, realtime: boolean): Promise<ScenarioResult> {
  const started = performance.now();
  const physics = new PhysicsWorld(new THREE.Scene());
  physics.setQuality('high');
  spawnPropStress(physics);
  const initial = snapshot(physics);
  const failures = new Set<string>();
  const outcome = await simulate(physics, seconds, realtime, failures, 80);

  const assertions = [
    assertion('initial tracked props', initial.entities === 100, initial.entities, '100'),
    assertion('initial Rapier bodies', initial.rigidBodies === 101, initial.rigidBodies, '101 (100 props + ground)'),
    assertion('initial joints', initial.impulseJoints === 0, initial.impulseJoints, '0'),
    assertion('final body limit', outcome.final.entities <= physics.maxBodies, outcome.final.entities, `<= ${physics.maxBodies}`),
    assertion('final joints', outcome.final.impulseJoints === 0, outcome.final.impulseJoints, '0'),
    assertion('finite transforms and velocities', outcome.final.nonFiniteBodyIds.length === 0, outcome.final.nonFiniteBodyIds.length, '0 invalid'),
    assertion('linear velocity cap', outcome.peakLinearSpeed <= LINEAR_SPEED_CAP + SPEED_EPSILON, rounded(outcome.peakLinearSpeed), `<= ${LINEAR_SPEED_CAP}`),
    assertion('angular velocity cap', outcome.peakAngularSpeed <= ANGULAR_SPEED_CAP + SPEED_EPSILON, rounded(outcome.peakAngularSpeed), `<= ${ANGULAR_SPEED_CAP}`),
    assertion('late prop motion settles', outcome.lateRmsLinearSpeed <= 1.2, rounded(outcome.lateRmsLinearSpeed), '<= 1.2 m/s RMS over final 20%'),
  ];
  assertions.filter((item) => !item.pass).forEach((item) => failures.add(`${item.name}: got ${item.actual}, expected ${item.expected}`));

  const result: ScenarioResult = {
    name: `100-prop stress / ${seconds}-second equivalent`,
    simulatedSeconds: seconds,
    frames: Math.round(seconds / FIXED_STEP),
    durationMs: rounded(performance.now() - started),
    pass: failures.size === 0,
    assertions,
    failures: [...failures].slice(0, 30),
    initial,
    final: outcome.final,
    observed: {
      peakLinearSpeed: rounded(outcome.peakLinearSpeed),
      peakAngularSpeed: rounded(outcome.peakAngularSpeed),
      peakAbsCoordinate: rounded(outcome.peakAbsCoordinate),
      lateRmsLinearSpeed: rounded(outcome.lateRmsLinearSpeed),
      lateRmsAngularSpeed: rounded(outcome.lateRmsAngularSpeed),
    },
  };
  disposePhysics(physics);
  return result;
}

async function runRotatedWeld(seconds: number, realtime: boolean): Promise<ScenarioResult> {
  const started = performance.now();
  const physics = new PhysicsWorld(new THREE.Scene());
  physics.setQuality('high');
  const anchor = requireEntity(physics.spawn({
    type: 'crate',
    position: { x: -0.9, y: 7, z: 0.2 },
    rotation: { x: 0.31, y: -0.47, z: 0.18 },
    scale: { x: 1, y: 0.8, z: 0.9 },
    fixed: true,
  }), 'rotated weld anchor');
  const payload = requireEntity(physics.spawn({
    type: 'plank',
    position: { x: 1.05, y: 7.35, z: -0.25 },
    rotation: { x: -0.38, y: 0.57, z: 0.64 },
    scale: { x: 1.4, y: 0.42, z: 0.65 },
  }), 'rotated weld payload');
  const initialPositionRaw = payload.body.translation();
  const initialRotation = payload.body.rotation();
  const initialPosition = new THREE.Vector3(initialPositionRaw.x, initialPositionRaw.y, initialPositionRaw.z);
  const connector = physics.createConnector('weld', anchor, payload);
  const initial = snapshot(physics);
  const failures = new Set<string>();
  let firstPositionDrift = Number.POSITIVE_INFINITY;
  let firstAngularDrift = Number.POSITIVE_INFINITY;
  let maximumPositionDrift = 0;
  let maximumAngularDrift = 0;
  const duration = Math.max(FIXED_STEP, Math.min(seconds, 2));
  const outcome = await simulate(
    physics,
    duration,
    realtime,
    failures,
    20,
    undefined,
    (frame) => {
      const position = payload.body.translation();
      const rotation = payload.body.rotation();
      const positionDrift = initialPosition.distanceTo(new THREE.Vector3(position.x, position.y, position.z));
      const angularDrift = quaternionDistance(initialRotation, rotation);
      if (frame === 1) {
        firstPositionDrift = positionDrift;
        firstAngularDrift = angularDrift;
      }
      maximumPositionDrift = Math.max(maximumPositionDrift, positionDrift);
      maximumAngularDrift = Math.max(maximumAngularDrift, angularDrift);
    },
  );

  const assertions = [
    assertion('rotated weld was created', connector !== null, connector !== null, 'true'),
    assertion('rotated weld connector count', initial.connectors === 1, initial.connectors, '1'),
    assertion('rotated weld joint count', initial.impulseJoints === 1, initial.impulseJoints, '1'),
    assertion('no first-step weld position snap', firstPositionDrift <= 0.003, rounded(firstPositionDrift), '<= 0.003 m'),
    assertion('no first-step weld rotation snap', firstAngularDrift <= 0.003, rounded(firstAngularDrift), '<= 0.003 rad'),
    assertion('rotated weld remains position-stable', maximumPositionDrift <= 0.012, rounded(maximumPositionDrift), '<= 0.012 m'),
    assertion('rotated weld remains rotation-stable', maximumAngularDrift <= 0.012, rounded(maximumAngularDrift), '<= 0.012 rad'),
    assertion('rotated weld transform stays finite', outcome.final.nonFiniteBodyIds.length === 0, outcome.final.nonFiniteBodyIds.length, '0 invalid'),
    assertion('rotated weld remains registered', outcome.final.impulseJoints === 1 && outcome.final.connectors === 1, `${outcome.final.impulseJoints}/${outcome.final.connectors}`, '1 joint / 1 connector'),
  ];
  assertions.filter((item) => !item.pass).forEach((item) => failures.add(`${item.name}: got ${item.actual}, expected ${item.expected}`));

  const result: ScenarioResult = {
    name: 'rotated fixed weld / zero-snap regression',
    simulatedSeconds: duration,
    frames: Math.round(duration / FIXED_STEP),
    durationMs: rounded(performance.now() - started),
    pass: failures.size === 0,
    assertions,
    failures: [...failures].slice(0, 30),
    initial,
    final: outcome.final,
    observed: {
      peakLinearSpeed: rounded(outcome.peakLinearSpeed),
      peakAngularSpeed: rounded(outcome.peakAngularSpeed),
      peakAbsCoordinate: rounded(outcome.peakAbsCoordinate),
      lateRmsLinearSpeed: rounded(outcome.lateRmsLinearSpeed),
      lateRmsAngularSpeed: rounded(outcome.lateRmsAngularSpeed),
    },
  };
  disposePhysics(physics);
  return result;
}

async function runMassNormalizedPush(_seconds: number, realtime: boolean): Promise<ScenarioResult> {
  const started = performance.now();
  const physics = new PhysicsWorld(new THREE.Scene());
  physics.setQuality('high');
  const light = requireEntity(physics.spawn({ type: 'ball', position: { x: -4, y: 12, z: 0 } }), 'light push body');
  const heavy = requireEntity(physics.spawn({ type: 'heavy-ball', position: { x: 4, y: 12, z: 0 } }), 'heavy push body');
  const lightMass = light.body.mass();
  const heavyMass = heavy.body.mass();
  const lightBefore = light.body.linvel().x;
  const heavyBefore = heavy.body.linvel().x;
  const initial = snapshot(physics);
  physics.applyPush(light, new THREE.Vector3(1, 0, 0), 12);
  physics.applyPush(heavy, new THREE.Vector3(1, 0, 0), 12);
  const lightDeltaVelocity = light.body.linvel().x - lightBefore;
  const heavyDeltaVelocity = heavy.body.linvel().x - heavyBefore;
  const relativeDifference = Math.abs(lightDeltaVelocity - heavyDeltaVelocity)
    / Math.max(1e-6, Math.abs(lightDeltaVelocity), Math.abs(heavyDeltaVelocity));
  const failures = new Set<string>();
  const outcome = await simulate(physics, FIXED_STEP, realtime, failures, 20);

  const assertions = [
    assertion('push fixture has substantial mass ratio', heavyMass / lightMass >= 8, rounded(heavyMass / lightMass), '>= 8x'),
    assertion('light push produces useful delta-v', lightDeltaVelocity >= 0.5, rounded(lightDeltaVelocity), '>= 0.5 m/s'),
    assertion('heavy push produces useful delta-v', heavyDeltaVelocity >= 0.5, rounded(heavyDeltaVelocity), '>= 0.5 m/s'),
    assertion('light push delta-v is bounded', lightDeltaVelocity <= 12 + SPEED_EPSILON, rounded(lightDeltaVelocity), '<= 12 m/s'),
    assertion('heavy push delta-v is bounded', heavyDeltaVelocity <= 12 + SPEED_EPSILON, rounded(heavyDeltaVelocity), '<= 12 m/s'),
    assertion('push delta-v is mass-normalized', relativeDifference <= 0.02, rounded(relativeDifference), '<= 2% relative difference'),
    assertion('pushed bodies remain finite', outcome.final.nonFiniteBodyIds.length === 0, outcome.final.nonFiniteBodyIds.length, '0 invalid'),
  ];
  assertions.filter((item) => !item.pass).forEach((item) => failures.add(`${item.name}: got ${item.actual}, expected ${item.expected}`));

  const result: ScenarioResult = {
    name: 'mass-normalized push / light-vs-heavy regression',
    simulatedSeconds: FIXED_STEP,
    frames: 1,
    durationMs: rounded(performance.now() - started),
    pass: failures.size === 0,
    assertions,
    failures: [...failures].slice(0, 30),
    initial,
    final: outcome.final,
    observed: {
      peakLinearSpeed: rounded(outcome.peakLinearSpeed),
      peakAngularSpeed: rounded(outcome.peakAngularSpeed),
      peakAbsCoordinate: rounded(outcome.peakAbsCoordinate),
      lateRmsLinearSpeed: rounded(outcome.lateRmsLinearSpeed),
      lateRmsAngularSpeed: rounded(outcome.lateRmsAngularSpeed),
    },
  };
  disposePhysics(physics);
  return result;
}

async function runExplosionBookkeeping(_seconds: number, realtime: boolean): Promise<ScenarioResult> {
  const started = performance.now();
  let explosionEvents = 0;
  const brokenIds: number[] = [];
  const characterHitDamage: number[] = [];
  const physics = new PhysicsWorld(new THREE.Scene(), undefined, {
    onExplosion: () => { explosionEvents++; },
    onBreak: (entity) => { brokenIds.push(entity.id); },
    onCharacterHit: (_character, damage) => { characterHitDamage.push(damage); },
  });
  physics.setQuality('high');
  const source = requireEntity(physics.spawn({ type: 'bomb', position: { x: 0, y: 14, z: 0 } }), 'explosion source');
  const spawnedCharacter = physics.spawn({
    type: 'character',
    variant: 'dummy',
    position: { x: 1.2, y: 11.4, z: 0 },
  });
  if (!spawnedCharacter || !('parts' in spawnedCharacter)) throw new Error('Failed to spawn explosion character fixture.');
  const character = spawnedCharacter as Character;
  const healthBefore = character.health;
  const initial = snapshot(physics);
  let repeatRemovalThrew = false;
  physics.damageEntity(source, 999);
  const explosionEventsAfterBlast = explosionEvents;
  const brokenIdsAfterBlast = [...brokenIds];
  const hitDamageAfterBlast = [...characterHitDamage];
  const healthAfterBlast = character.health;
  const destructionAfterBlast = physics.destructionValue;
  try {
    // Repeating stale calls must be harmless: no second blast, break event, or
    // unrelated body removal should occur after the source has been deleted.
    physics.damageEntity(source, 999);
    physics.removeEntity(source);
    physics.removeEntity(source);
  } catch {
    repeatRemovalThrew = true;
  }
  let sourceStillValid = false;
  try {
    sourceStillValid = source.body.isValid();
  } catch {
    sourceStillValid = false;
  }
  const failures = new Set<string>();
  const outcome = await simulate(physics, FIXED_STEP, realtime, failures, 25);
  const appliedDamage = healthBefore - healthAfterBlast;
  const callbackDamage = hitDamageAfterBlast[0] ?? 0;

  const assertions = [
    assertion('explosive source initially tracked', initial.entities === 11, initial.entities, '11 (bomb + 10 character parts)'),
    assertion('one source produces one explosion', explosionEventsAfterBlast === 1, explosionEventsAfterBlast, '1'),
    assertion('one source produces one break callback', brokenIdsAfterBlast.length === 1 && brokenIdsAfterBlast[0] === source.id, brokenIdsAfterBlast.join(','), `${source.id}`),
    assertion('one blast damages one character once', hitDamageAfterBlast.length === 1, hitDamageAfterBlast.length, '1 callback for 14 body colliders'),
    assertion('character damage callback matches health delta', appliedDamage > 0 && Math.abs(appliedDamage - callbackDamage) <= 0.001, rounded(appliedDamage - callbackDamage), '0 difference and positive damage'),
    assertion('explosive source is removed before blast traversal', !sourceStillValid && !physics.entities.has(source.id), sourceStillValid || physics.entities.has(source.id), 'false'),
    assertion('stale source removal is idempotent', !repeatRemovalThrew, repeatRemovalThrew, 'false'),
    assertion('stale calls do not recurse', explosionEvents === 1 && brokenIds.length === 1, `${explosionEvents}/${brokenIds.length}`, '1 explosion / 1 break'),
    assertion('destruction is counted once', Math.abs(destructionAfterBlast - 10) <= 0.001 && Math.abs(physics.destructionValue - destructionAfterBlast) <= 0.001, rounded(physics.destructionValue), '10 once'),
    assertion('only source body was deleted', outcome.final.entities === 10 && outcome.final.rigidBodies === 11, `${outcome.final.entities}/${outcome.final.rigidBodies}`, '10 entities / 11 bodies including ground'),
    assertion('post-blast bodies remain finite', outcome.final.nonFiniteBodyIds.length === 0, outcome.final.nonFiniteBodyIds.length, '0 invalid'),
  ];
  assertions.filter((item) => !item.pass).forEach((item) => failures.add(`${item.name}: got ${item.actual}, expected ${item.expected}`));

  const result: ScenarioResult = {
    name: 'explosion recursion, deletion, and character-hit bookkeeping',
    simulatedSeconds: FIXED_STEP,
    frames: 1,
    durationMs: rounded(performance.now() - started),
    pass: failures.size === 0,
    assertions,
    failures: [...failures].slice(0, 30),
    initial,
    final: outcome.final,
    observed: {
      peakLinearSpeed: rounded(outcome.peakLinearSpeed),
      peakAngularSpeed: rounded(outcome.peakAngularSpeed),
      peakAbsCoordinate: rounded(outcome.peakAbsCoordinate),
      lateRmsLinearSpeed: rounded(outcome.lateRmsLinearSpeed),
      lateRmsAngularSpeed: rounded(outcome.lateRmsAngularSpeed),
    },
  };
  disposePhysics(physics);
  return result;
}

async function runDebrisBounds(seconds: number, realtime: boolean): Promise<ScenarioResult> {
  const started = performance.now();
  const physics = new PhysicsWorld(new THREE.Scene());
  physics.setQuality('high');
  const parent = requireEntity(physics.spawn({
    type: 'plank',
    position: { x: 0, y: 12, z: 0 },
    rotation: { x: 0.35, y: 0.62, z: 0.24 },
    scale: { x: 3, y: 1.2, z: 1 },
  }), 'debris parent');
  parent.body.setLinvel({ x: 45, y: 0, z: 0 }, true);
  parent.body.setAngvel({ x: 0, y: 30, z: 0 }, true);
  const parentRotationRaw = parent.body.rotation();
  const parentRotation = new THREE.Quaternion(
    parentRotationRaw.x,
    parentRotationRaw.y,
    parentRotationRaw.z,
    parentRotationRaw.w,
  );
  const splitAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(parentRotation).normalize();
  physics.damageEntity(parent, 999);
  const debris = [...physics.entities.values()].filter((entity) => entity.type === 'debris');
  const initial = snapshot(physics);
  let minimumProjectedGap = Number.POSITIVE_INFINITY;
  const shardAxisLength = parent.size.x * 0.3;
  for (let i = 0; i < debris.length; i++) {
    for (let j = i + 1; j < debris.length; j++) {
      const a = debris[i].body.translation();
      const b = debris[j].body.translation();
      const separation = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
      minimumProjectedGap = Math.min(minimumProjectedGap, Math.abs(separation.dot(splitAxis)) - shardAxisLength);
    }
  }
  let firstStepOverlapPairs = -1;
  const failures = new Set<string>();
  const duration = Math.max(FIXED_STEP, Math.min(seconds, 2));
  const outcome = await simulate(
    physics,
    duration,
    realtime,
    failures,
    35,
    undefined,
    (frame) => {
      if (frame !== 1) return;
      firstStepOverlapPairs = 0;
      for (let i = 0; i < debris.length; i++) {
        for (let j = i + 1; j < debris.length; j++) {
          const a = debris[i].collider;
          const b = debris[j].collider;
          if (a && b && physics.world.intersectionPair(a, b)) firstStepOverlapPairs++;
        }
      }
    },
  );

  const assertions = [
    assertion('one break creates finite debris count', initial.entities === 3 && debris.length === 3, `${initial.entities}/${debris.length}`, '3 entities / 3 debris'),
    assertion('debris cannot recursively shatter', debris.every((entity) => !entity.destructible), debris.every((entity) => !entity.destructible), 'true'),
    assertion('debris starts geometrically separated', minimumProjectedGap >= 0.05, rounded(minimumProjectedGap), '>= 0.05 m gap'),
    assertion('debris has no first-step collider overlap', firstStepOverlapPairs === 0, firstStepOverlapPairs, '0 pairs'),
    assertion('inherited debris linear speed is bounded', initial.maxLinearSpeed <= 24, rounded(initial.maxLinearSpeed), '<= 24 m/s'),
    assertion('inherited debris angular speed is bounded', initial.maxAngularSpeed <= 12 + SPEED_EPSILON, rounded(initial.maxAngularSpeed), '<= 12.05 rad/s'),
    assertion('debris count remains finite', outcome.final.entities === 3, outcome.final.entities, '3'),
    assertion('debris transforms stay finite', outcome.final.nonFiniteBodyIds.length === 0, outcome.final.nonFiniteBodyIds.length, '0 invalid'),
    assertion('debris motion remains scene-bounded', outcome.peakAbsCoordinate <= 35, rounded(outcome.peakAbsCoordinate), '<= 35 m'),
    assertion('debris linear velocity remains capped', outcome.peakLinearSpeed <= LINEAR_SPEED_CAP + SPEED_EPSILON, rounded(outcome.peakLinearSpeed), `<= ${LINEAR_SPEED_CAP}`),
    assertion('debris angular velocity remains capped', outcome.peakAngularSpeed <= ANGULAR_SPEED_CAP + SPEED_EPSILON, rounded(outcome.peakAngularSpeed), `<= ${ANGULAR_SPEED_CAP}`),
  ];
  assertions.filter((item) => !item.pass).forEach((item) => failures.add(`${item.name}: got ${item.actual}, expected ${item.expected}`));

  const result: ScenarioResult = {
    name: 'finite, separated, bounded debris regression',
    simulatedSeconds: duration,
    frames: Math.round(duration / FIXED_STEP),
    durationMs: rounded(performance.now() - started),
    pass: failures.size === 0,
    assertions,
    failures: [...failures].slice(0, 30),
    initial,
    final: outcome.final,
    observed: {
      peakLinearSpeed: rounded(outcome.peakLinearSpeed),
      peakAngularSpeed: rounded(outcome.peakAngularSpeed),
      peakAbsCoordinate: rounded(outcome.peakAbsCoordinate),
      lateRmsLinearSpeed: rounded(outcome.lateRmsLinearSpeed),
      lateRmsAngularSpeed: rounded(outcome.lateRmsAngularSpeed),
    },
  };
  disposePhysics(physics);
  return result;
}

async function runLooseBlockWall(_seconds: number, realtime: boolean): Promise<ScenarioResult> {
  const started = performance.now();
  const physics = new PhysicsWorld(new THREE.Scene());
  physics.setQuality('high');
  const blocks: Entity[] = [];
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 4; column++) {
      blocks.push(requireEntity(physics.spawn({
        type: 'wall-block',
        position: {
          x: (column - 1.5) * 1.22 + (row % 2) * 0.24,
          y: 0.375 + row * 0.77,
          z: 0,
        },
        scale: { x: 1.2, y: 0.75, z: 0.65 },
        material: 'wood',
        group: 'loose-wall-fixture',
      }), `loose wall block ${row}-${column}`));
    }
  }

  const initial = snapshot(physics);
  const failures = new Set<string>();
  const settled = await simulate(physics, 4, realtime, failures, 20);
  const target = blocks[5];
  let pushDeltaVelocity = 0;
  let pushedDistance = 0;
  let targetWasLive = false;
  if (target?.body.isValid() && physics.entities.get(target.id) === target) {
    targetWasLive = true;
    const beforeVelocity = target.body.linvel();
    const beforePosition = target.body.translation();
    physics.applyPush(target, new THREE.Vector3(1, 0.18, 0), 6);
    const afterVelocity = target.body.linvel();
    pushDeltaVelocity = new THREE.Vector3(
      afterVelocity.x - beforeVelocity.x,
      afterVelocity.y - beforeVelocity.y,
      afterVelocity.z - beforeVelocity.z,
    ).length();
    const pushed = await simulate(physics, 0.75, realtime, failures, 25);
    if (target.body.isValid()) {
      const afterPosition = target.body.translation();
      pushedDistance = Math.hypot(
        afterPosition.x - beforePosition.x,
        afterPosition.y - beforePosition.y,
        afterPosition.z - beforePosition.z,
      );
    }
    const assertions = [
      assertion('loose wall starts with twelve independent bodies', initial.entities === 12, initial.entities, '12'),
      assertion('loose wall starts with zero connectors', initial.connectors === 0 && initial.impulseJoints === 0, `${initial.connectors}/${initial.impulseJoints}`, '0 connectors / 0 joints'),
      assertion('loose wall survives idle settling', settled.final.entities === 12, settled.final.entities, '12 bodies'),
      assertion('loose wall settles without residual jitter', settled.lateRmsLinearSpeed <= 0.35, rounded(settled.lateRmsLinearSpeed), '<= 0.35 m/s RMS'),
      assertion('push target remains live after settling', targetWasLive, targetWasLive, 'true'),
      assertion('loose block receives a useful push delta-v', pushDeltaVelocity >= 1, rounded(pushDeltaVelocity), '>= 1 m/s'),
      assertion('loose block moves after push', pushedDistance >= 0.08, rounded(pushedDistance), '>= 0.08 m'),
      assertion('wall never gains implicit rigid joints', pushed.final.connectors === 0 && pushed.final.impulseJoints === 0, `${pushed.final.connectors}/${pushed.final.impulseJoints}`, '0 connectors / 0 joints'),
      assertion('loose wall remains finite after push', pushed.final.nonFiniteBodyIds.length === 0, pushed.final.nonFiniteBodyIds.length, '0 invalid'),
    ];
    assertions.filter((item) => !item.pass).forEach((item) => failures.add(`${item.name}: got ${item.actual}, expected ${item.expected}`));
    const result: ScenarioResult = {
      name: 'loose 4x3 block wall / no implicit joints',
      simulatedSeconds: 4.75,
      frames: Math.round(4.75 / FIXED_STEP),
      durationMs: rounded(performance.now() - started),
      pass: failures.size === 0,
      assertions,
      failures: [...failures].slice(0, 30),
      initial,
      final: pushed.final,
      observed: {
        peakLinearSpeed: rounded(Math.max(settled.peakLinearSpeed, pushed.peakLinearSpeed)),
        peakAngularSpeed: rounded(Math.max(settled.peakAngularSpeed, pushed.peakAngularSpeed)),
        peakAbsCoordinate: rounded(Math.max(settled.peakAbsCoordinate, pushed.peakAbsCoordinate)),
        lateRmsLinearSpeed: rounded(settled.lateRmsLinearSpeed),
        lateRmsAngularSpeed: rounded(settled.lateRmsAngularSpeed),
      },
    };
    disposePhysics(physics);
    return result;
  }

  const assertions = [
    assertion('loose wall starts with twelve independent bodies', initial.entities === 12, initial.entities, '12'),
    assertion('loose wall starts with zero connectors', initial.connectors === 0 && initial.impulseJoints === 0, `${initial.connectors}/${initial.impulseJoints}`, '0 connectors / 0 joints'),
    assertion('loose wall survives idle settling', settled.final.entities === 12, settled.final.entities, '12 bodies'),
    assertion('push target remains live after settling', targetWasLive, targetWasLive, 'true'),
  ];
  assertions.filter((item) => !item.pass).forEach((item) => failures.add(`${item.name}: got ${item.actual}, expected ${item.expected}`));
  const result: ScenarioResult = {
    name: 'loose 4x3 block wall / no implicit joints',
    simulatedSeconds: 4,
    frames: Math.round(4 / FIXED_STEP),
    durationMs: rounded(performance.now() - started),
    pass: false,
    assertions,
    failures: [...failures].slice(0, 30),
    initial,
    final: settled.final,
    observed: {
      peakLinearSpeed: rounded(settled.peakLinearSpeed),
      peakAngularSpeed: rounded(settled.peakAngularSpeed),
      peakAbsCoordinate: rounded(settled.peakAbsCoordinate),
      lateRmsLinearSpeed: rounded(settled.lateRmsLinearSpeed),
      lateRmsAngularSpeed: rounded(settled.lateRmsAngularSpeed),
    },
  };
  disposePhysics(physics);
  return result;
}

async function runConnectorCycleRejection(_seconds: number, realtime: boolean): Promise<ScenarioResult> {
  const started = performance.now();
  const physics = new PhysicsWorld(new THREE.Scene());
  physics.setQuality('high');

  const a = requireEntity(physics.spawn({ type: 'crate', position: { x: -6, y: 9, z: 0 } }), 'cycle prop A');
  const b = requireEntity(physics.spawn({ type: 'crate', position: { x: -4.5, y: 9, z: 0 } }), 'cycle prop B');
  const c = requireEntity(physics.spawn({ type: 'crate', position: { x: -3, y: 9, z: 0 } }), 'cycle prop C');
  const ab = physics.createConnector('rope', a, b);
  const bc = physics.createConnector('rope', b, c);
  const ca = physics.createConnector('rope', c, a);
  const duplicate = physics.createConnector('rope', a, b);

  const spawned = physics.spawn({ type: 'character', variant: 'dummy', position: { x: 4.5, y: 7, z: 0 } });
  if (!spawned || !('parts' in spawned)) throw new Error('Failed to spawn connector-cycle ragdoll fixture.');
  const character = spawned as Character;
  const leftArm = character.parts.find((part) => part.part === 'lower-arm-l')!;
  const rightArm = character.parts.find((part) => part.part === 'lower-arm-r')!;
  const sameRagdoll = physics.createConnector('rope', leftArm, rightArm);
  const external = requireEntity(physics.spawn({ type: 'crate', position: { x: 7, y: 8, z: 0 } }), 'external ragdoll prop');
  const firstLimbLink = physics.createConnector('rope', external, leftArm);
  const secondLimbLink = physics.createConnector('rope', external, rightArm);

  const initial = snapshot(physics);
  const failures = new Set<string>();
  const outcome = await simulate(physics, 1, realtime, failures, 25);
  const assertions = [
    assertion('first edge in prop tree is accepted', ab !== null, ab !== null, 'true'),
    assertion('second edge in prop tree is accepted', bc !== null, bc !== null, 'true'),
    assertion('closing edge in prop tree is rejected', ca === null, ca === null, 'true'),
    assertion('duplicate prop edge is rejected', duplicate === null, duplicate === null, 'true'),
    assertion('connector inside one ragdoll is rejected', sameRagdoll === null, sameRagdoll === null, 'true'),
    assertion('first prop-to-ragdoll edge is accepted', firstLimbLink !== null, firstLimbLink !== null, 'true'),
    assertion('prop-to-second-limb loop is rejected', secondLimbLink === null, secondLimbLink === null, 'true'),
    assertion('only sparse-tree connectors are registered', initial.connectors === 3, initial.connectors, '3'),
    assertion('registered joint count includes anatomy plus three connectors', initial.impulseJoints === 12, initial.impulseJoints, '12 (9 anatomical + 3 explicit)'),
    assertion('cycle-rejection fixture remains finite', outcome.final.nonFiniteBodyIds.length === 0, outcome.final.nonFiniteBodyIds.length, '0 invalid'),
    assertion('rejected cycles stay rejected after simulation', outcome.final.connectors === 3 && outcome.final.impulseJoints === 12, `${outcome.final.connectors}/${outcome.final.impulseJoints}`, '3 connectors / 12 joints'),
  ];
  assertions.filter((item) => !item.pass).forEach((item) => failures.add(`${item.name}: got ${item.actual}, expected ${item.expected}`));

  const result: ScenarioResult = {
    name: 'connector graph cycle rejection / ragdoll loop guard',
    simulatedSeconds: 1,
    frames: Math.round(1 / FIXED_STEP),
    durationMs: rounded(performance.now() - started),
    pass: failures.size === 0,
    assertions,
    failures: [...failures].slice(0, 30),
    initial,
    final: outcome.final,
    observed: {
      peakLinearSpeed: rounded(outcome.peakLinearSpeed),
      peakAngularSpeed: rounded(outcome.peakAngularSpeed),
      peakAbsCoordinate: rounded(outcome.peakAbsCoordinate),
      lateRmsLinearSpeed: rounded(outcome.lateRmsLinearSpeed),
      lateRmsAngularSpeed: rounded(outcome.lateRmsAngularSpeed),
    },
  };
  disposePhysics(physics);
  return result;
}

async function runRotatedRevoluteJoints(_seconds: number, realtime: boolean): Promise<ScenarioResult> {
  const started = performance.now();
  const physics = new PhysicsWorld(new THREE.Scene());
  physics.setQuality('high');
  const hingeAnchor = requireEntity(physics.spawn({
    type: 'crate', position: { x: -4.2, y: 8, z: 0 }, rotation: { x: 0.47, y: -0.61, z: 0.22 }, fixed: true,
  }), 'rotated hinge anchor');
  const hingePayload = requireEntity(physics.spawn({
    type: 'wheel', position: { x: -2.2, y: 8.35, z: 0.3 }, rotation: { x: -0.38, y: 0.72, z: 0.83 },
  }), 'rotated hinge payload');
  const motorAnchor = requireEntity(physics.spawn({
    type: 'crate', position: { x: 2.2, y: 8, z: 0 }, rotation: { x: -0.51, y: 0.34, z: -0.29 }, fixed: true,
  }), 'rotated motor anchor');
  const motorPayload = requireEntity(physics.spawn({
    type: 'wheel', position: { x: 4.3, y: 8.25, z: -0.35 }, rotation: { x: 0.69, y: -0.43, z: 0.57 },
  }), 'rotated motor payload');
  const hinge = physics.createConnector('hinge', hingeAnchor, hingePayload);
  const motor = physics.createConnector('motor', motorAnchor, motorPayload);
  const hingeStartRaw = hingePayload.body.translation();
  const motorStartRaw = motorPayload.body.translation();
  const hingeStart = new THREE.Vector3(hingeStartRaw.x, hingeStartRaw.y, hingeStartRaw.z);
  const motorStart = new THREE.Vector3(motorStartRaw.x, motorStartRaw.y, motorStartRaw.z);
  const initial = snapshot(physics);
  const failures = new Set<string>();
  let firstLinearSpeed = Number.POSITIVE_INFINITY;
  let firstAngularSpeed = Number.POSITIVE_INFINITY;
  let firstPositionSnap = Number.POSITIVE_INFINITY;
  const outcome = await simulate(
    physics,
    2,
    realtime,
    failures,
    25,
    undefined,
    (frame) => {
      if (frame !== 1) return;
      firstLinearSpeed = Math.max(magnitude(hingePayload.body.linvel()), magnitude(motorPayload.body.linvel()));
      firstAngularSpeed = Math.max(magnitude(hingePayload.body.angvel()), magnitude(motorPayload.body.angvel()));
      const hingePosition = hingePayload.body.translation();
      const motorPosition = motorPayload.body.translation();
      firstPositionSnap = Math.max(
        hingeStart.distanceTo(new THREE.Vector3(hingePosition.x, hingePosition.y, hingePosition.z)),
        motorStart.distanceTo(new THREE.Vector3(motorPosition.x, motorPosition.y, motorPosition.z)),
      );
    },
  );

  const assertions = [
    assertion('rotated hinge is created', hinge !== null, hinge !== null, 'true'),
    assertion('rotated motor is created', motor !== null, motor !== null, 'true'),
    assertion('rotated revolute joints register exactly twice', initial.connectors === 2 && initial.impulseJoints === 2, `${initial.connectors}/${initial.impulseJoints}`, '2 connectors / 2 joints'),
    assertion('rotated revolute joints have bounded first-step linear speed', firstLinearSpeed <= 2.5, rounded(firstLinearSpeed), '<= 2.5 m/s'),
    assertion('rotated revolute joints have bounded first-step angular speed', firstAngularSpeed <= 8, rounded(firstAngularSpeed), '<= 8 rad/s'),
    assertion('rotated revolute joints do not position-snap', firstPositionSnap <= 0.04, rounded(firstPositionSnap), '<= 0.04 m on first step'),
    assertion('rotated revolute fixture remains finite', outcome.final.nonFiniteBodyIds.length === 0, outcome.final.nonFiniteBodyIds.length, '0 invalid'),
    assertion('rotated revolute joints remain registered', outcome.final.connectors === 2 && outcome.final.impulseJoints === 2, `${outcome.final.connectors}/${outcome.final.impulseJoints}`, '2 connectors / 2 joints'),
  ];
  assertions.filter((item) => !item.pass).forEach((item) => failures.add(`${item.name}: got ${item.actual}, expected ${item.expected}`));

  const result: ScenarioResult = {
    name: 'rotated hinge and motor / bounded first-step correction',
    simulatedSeconds: 2,
    frames: Math.round(2 / FIXED_STEP),
    durationMs: rounded(performance.now() - started),
    pass: failures.size === 0,
    assertions,
    failures: [...failures].slice(0, 30),
    initial,
    final: outcome.final,
    observed: {
      peakLinearSpeed: rounded(outcome.peakLinearSpeed),
      peakAngularSpeed: rounded(outcome.peakAngularSpeed),
      peakAbsCoordinate: rounded(outcome.peakAbsCoordinate),
      lateRmsLinearSpeed: rounded(outcome.lateRmsLinearSpeed),
      lateRmsAngularSpeed: rounded(outcome.lateRmsAngularSpeed),
    },
  };
  disposePhysics(physics);
  return result;
}

async function runMalformedRopeLengths(_seconds: number, realtime: boolean): Promise<ScenarioResult> {
  const started = performance.now();
  const physics = new PhysicsWorld(new THREE.Scene());
  physics.setQuality('high');
  const malformedLengths = [Number.NaN, Number.POSITIVE_INFINITY, -5, 0, 0.001];
  const payloads: Entity[] = [];
  const measuredLengths: number[] = [];
  const connectors = malformedLengths.map((length, index) => {
    const z = (index - 2) * 3;
    const anchor = requireEntity(physics.spawn({
      type: 'rope-anchor',
      position: { x: -1.4, y: 8, z },
      fixed: true,
    }), `malformed-rope anchor ${index}`);
    const payload = requireEntity(physics.spawn({
      type: 'weight',
      position: { x: 1.4, y: 8, z },
    }), `malformed-rope payload ${index}`);
    payloads.push(payload);
    measuredLengths.push(anchor.object.position.distanceTo(payload.object.position));
    return physics.createConnector('rope', anchor, payload, length);
  });

  const starts = payloads.map((payload) => {
    const p = payload.body.translation();
    return new THREE.Vector3(p.x, p.y, p.z);
  });
  const initial = snapshot(physics);
  const failures = new Set<string>();
  let firstLinearSpeed = Number.POSITIVE_INFINITY;
  let firstPositionChange = Number.POSITIVE_INFINITY;
  const outcome = await simulate(
    physics,
    1.5,
    realtime,
    failures,
    25,
    undefined,
    (frame) => {
      if (frame !== 1) return;
      firstLinearSpeed = Math.max(...payloads.map((payload) => magnitude(payload.body.linvel())));
      firstPositionChange = Math.max(...payloads.map((payload, index) => {
        const p = payload.body.translation();
        return starts[index].distanceTo(new THREE.Vector3(p.x, p.y, p.z));
      }));
    },
  );

  const createdLengthsAreSafe = connectors.every((connector, index) => connector !== null
    && Number.isFinite(connector.restLength)
    && connector.restLength + 1e-6 >= measuredLengths[index]);
  const assertions = [
    assertion('all malformed rope fixtures create recoverable connectors', connectors.every(Boolean), connectors.filter(Boolean).length, `${malformedLengths.length}`),
    assertion('malformed rope lengths are clamped to the current span', createdLengthsAreSafe, createdLengthsAreSafe, 'true'),
    assertion('malformed rope fixture has exact connector count', initial.connectors === malformedLengths.length && initial.impulseJoints === malformedLengths.length, `${initial.connectors}/${initial.impulseJoints}`, `${malformedLengths.length} connectors / joints`),
    assertion('malformed ropes have bounded first-step speed', firstLinearSpeed <= 0.5, rounded(firstLinearSpeed), '<= 0.5 m/s'),
    assertion('malformed ropes do not first-step position-snap', firstPositionChange <= 0.02, rounded(firstPositionChange), '<= 0.02 m'),
    assertion('malformed rope fixture remains finite', outcome.final.nonFiniteBodyIds.length === 0, outcome.final.nonFiniteBodyIds.length, '0 invalid'),
    assertion('malformed ropes remain registered', outcome.final.connectors === malformedLengths.length && outcome.final.impulseJoints === malformedLengths.length, `${outcome.final.connectors}/${outcome.final.impulseJoints}`, `${malformedLengths.length} connectors / joints`),
  ];
  assertions.filter((item) => !item.pass).forEach((item) => failures.add(`${item.name}: got ${item.actual}, expected ${item.expected}`));

  const result: ScenarioResult = {
    name: 'malformed rope rest lengths / no creation snap',
    simulatedSeconds: 1.5,
    frames: Math.round(1.5 / FIXED_STEP),
    durationMs: rounded(performance.now() - started),
    pass: failures.size === 0,
    assertions,
    failures: [...failures].slice(0, 30),
    initial,
    final: outcome.final,
    observed: {
      peakLinearSpeed: rounded(outcome.peakLinearSpeed),
      peakAngularSpeed: rounded(outcome.peakAngularSpeed),
      peakAbsCoordinate: rounded(outcome.peakAbsCoordinate),
      lateRmsLinearSpeed: rounded(outcome.lateRmsLinearSpeed),
      lateRmsAngularSpeed: rounded(outcome.lateRmsAngularSpeed),
    },
  };
  disposePhysics(physics);
  return result;
}

async function runSimulationScaleTransitions(_seconds: number, realtime: boolean): Promise<ScenarioResult> {
  const started = performance.now();
  const physics = new PhysicsWorld(new THREE.Scene());
  physics.setQuality('high');
  const anchor = requireEntity(physics.spawn({
    type: 'crate',
    position: { x: -1, y: 8, z: 0 },
    rotation: { x: 0.34, y: -0.28, z: 0.19 },
    fixed: true,
  }), 'simulation-scale anchor');
  const payload = requireEntity(physics.spawn({
    type: 'plank',
    position: { x: 1.1, y: 8.25, z: 0.3 },
    rotation: { x: -0.27, y: 0.51, z: 0.62 },
  }), 'simulation-scale payload');
  const joint = physics.createConnector('hinge', anchor, payload);

  const anchorStart = anchor.body.translation();
  const payloadStart = payload.body.translation();
  const midpoint = new THREE.Vector3(
    (anchorStart.x + payloadStart.x) * 0.5,
    (anchorStart.y + payloadStart.y) * 0.5,
    (anchorStart.z + payloadStart.z) * 0.5,
  );
  const anchorRotationRaw = anchor.body.rotation();
  const payloadRotationRaw = payload.body.rotation();
  const anchorInverse = new THREE.Quaternion(
    anchorRotationRaw.x, anchorRotationRaw.y, anchorRotationRaw.z, anchorRotationRaw.w,
  ).invert();
  const payloadInverse = new THREE.Quaternion(
    payloadRotationRaw.x, payloadRotationRaw.y, payloadRotationRaw.z, payloadRotationRaw.w,
  ).invert();
  const localAnchorA = midpoint.clone()
    .sub(new THREE.Vector3(anchorStart.x, anchorStart.y, anchorStart.z))
    .applyQuaternion(anchorInverse);
  const localAnchorB = midpoint.clone()
    .sub(new THREE.Vector3(payloadStart.x, payloadStart.y, payloadStart.z))
    .applyQuaternion(payloadInverse);
  payload.body.setAngvel({ x: 0.7, y: 1.1, z: 1.6 }, true);

  const initial = snapshot(physics);
  const failures = new Set<string>();
  const scales = [0.18, 1, 0.32, 1] as const;
  let frame = 0;
  let timestepMismatches = 0;
  let maximumTimestepError = 0;
  let maximumJointAnchorError = 0;
  let peakLinearSpeed = 0;
  let peakAngularSpeed = 0;
  let peakAbsCoordinate = 0;
  let transitionPeakLinearSpeed = 0;
  let transitionPeakAngularSpeed = 0;

  for (const scale of scales) {
    physics.simulationScale = scale;
    for (let stageFrame = 0; stageFrame < 60; stageFrame++) {
      frame++;
      physics.update(FIXED_STEP);
      const timestepError = Math.abs(physics.world.timestep - FIXED_STEP);
      maximumTimestepError = Math.max(maximumTimestepError, timestepError);
      if (timestepError > 1e-8) timestepMismatches++;
      const sample = snapshot(physics);
      noteInvariantFailures(failures, sample, frame, 25);
      peakLinearSpeed = Math.max(peakLinearSpeed, sample.maxLinearSpeed);
      peakAngularSpeed = Math.max(peakAngularSpeed, sample.maxAngularSpeed);
      peakAbsCoordinate = Math.max(peakAbsCoordinate, sample.maxAbsCoordinate);
      if (stageFrame < 3) {
        transitionPeakLinearSpeed = Math.max(transitionPeakLinearSpeed, sample.maxLinearSpeed);
        transitionPeakAngularSpeed = Math.max(transitionPeakAngularSpeed, sample.maxAngularSpeed);
      }

      const aPosition = anchor.body.translation();
      const bPosition = payload.body.translation();
      const aRotation = anchor.body.rotation();
      const bRotation = payload.body.rotation();
      const worldAnchorA = localAnchorA.clone()
        .applyQuaternion(new THREE.Quaternion(aRotation.x, aRotation.y, aRotation.z, aRotation.w))
        .add(new THREE.Vector3(aPosition.x, aPosition.y, aPosition.z));
      const worldAnchorB = localAnchorB.clone()
        .applyQuaternion(new THREE.Quaternion(bRotation.x, bRotation.y, bRotation.z, bRotation.w))
        .add(new THREE.Vector3(bPosition.x, bPosition.y, bPosition.z));
      maximumJointAnchorError = Math.max(maximumJointAnchorError, worldAnchorA.distanceTo(worldAnchorB));
      if (realtime || frame % 30 === 0) await nextFrame(realtime);
    }
  }

  const final = snapshot(physics);
  const assertions = [
    assertion('scale-transition hinge is created', joint !== null, joint !== null, 'true'),
    assertion('solver timestep never follows simulationScale', timestepMismatches === 0, timestepMismatches, '0 mismatched input frames'),
    assertion('solver timestep stays at 1/60 within f32 precision', maximumTimestepError <= 1e-8, maximumTimestepError, '<= 1e-8 seconds error'),
    assertion('joint anchor remains coherent through scale transitions', maximumJointAnchorError <= 0.04, rounded(maximumJointAnchorError), '<= 0.04 m'),
    assertion('transition-window linear motion stays bounded', transitionPeakLinearSpeed <= 12, rounded(transitionPeakLinearSpeed), '<= 12 m/s'),
    assertion('transition-window angular motion stays bounded', transitionPeakAngularSpeed <= 20, rounded(transitionPeakAngularSpeed), '<= 20 rad/s'),
    assertion('scale-transition fixture remains finite', final.nonFiniteBodyIds.length === 0, final.nonFiniteBodyIds.length, '0 invalid'),
    assertion('joint survives all scale transitions', final.connectors === 1 && final.impulseJoints === 1, `${final.connectors}/${final.impulseJoints}`, '1 connector / 1 joint'),
  ];
  assertions.filter((item) => !item.pass).forEach((item) => failures.add(`${item.name}: got ${item.actual}, expected ${item.expected}`));

  const result: ScenarioResult = {
    name: 'simulationScale 0.18 -> 1 -> 0.32 -> 1 / invariant solver step',
    simulatedSeconds: scales.reduce((sum, scale) => sum + scale, 0),
    frames: frame,
    durationMs: rounded(performance.now() - started),
    pass: failures.size === 0,
    assertions,
    failures: [...failures].slice(0, 30),
    initial,
    final,
    observed: {
      peakLinearSpeed: rounded(peakLinearSpeed),
      peakAngularSpeed: rounded(peakAngularSpeed),
      peakAbsCoordinate: rounded(peakAbsCoordinate),
      lateRmsLinearSpeed: rounded(final.rmsLinearSpeed),
      lateRmsAngularSpeed: rounded(final.rmsAngularSpeed),
    },
  };
  disposePhysics(physics);
  return result;
}

function emptySnapshot(): PhysicsSnapshot {
  return {
    active: 0,
    sleeping: 0,
    entities: 0,
    characters: 0,
    connectors: 0,
    rigidBodies: 0,
    colliders: 0,
    impulseJoints: 0,
    maxLinearSpeed: 0,
    maxAngularSpeed: 0,
    rmsLinearSpeed: 0,
    rmsAngularSpeed: 0,
    maxAbsCoordinate: 0,
    invalidBodyIds: [],
    nonFiniteBodyIds: [],
  };
}

function accumulateSnapshot(total: PhysicsSnapshot, sample: PhysicsSnapshot): void {
  total.active += sample.active;
  total.sleeping += sample.sleeping;
  total.entities += sample.entities;
  total.characters += sample.characters;
  total.connectors += sample.connectors;
  total.rigidBodies += sample.rigidBodies;
  total.colliders += sample.colliders;
  total.impulseJoints += sample.impulseJoints;
  total.maxLinearSpeed = Math.max(total.maxLinearSpeed, sample.maxLinearSpeed);
  total.maxAngularSpeed = Math.max(total.maxAngularSpeed, sample.maxAngularSpeed);
  total.rmsLinearSpeed = Math.max(total.rmsLinearSpeed, sample.rmsLinearSpeed);
  total.rmsAngularSpeed = Math.max(total.rmsAngularSpeed, sample.rmsAngularSpeed);
  total.maxAbsCoordinate = Math.max(total.maxAbsCoordinate, sample.maxAbsCoordinate);
  total.invalidBodyIds.push(...sample.invalidBodyIds);
  total.nonFiniteBodyIds.push(...sample.nonFiniteBodyIds);
}

async function runAuthoredLevelIdleRegression(_seconds: number, realtime: boolean): Promise<ScenarioResult> {
  const started = performance.now();
  const failures = new Set<string>();
  const assertions: Assertion[] = [];
  const aggregateInitial = emptySnapshot();
  const aggregateFinal = emptySnapshot();
  let peakLinearSpeed = 0;
  let peakAngularSpeed = 0;
  let peakAbsCoordinate = 0;
  let maximumLateLinearSpeed = 0;
  let maximumLateAngularSpeed = 0;

  assertions.push(assertion('all authored campaign levels are included', LEVELS.length === 12, LEVELS.length, '12'));

  for (const level of LEVELS) {
    let explosionEvents = 0;
    const brokenExplosiveIds: number[] = [];
    const brokenExplosiveDetails: string[] = [];
    const latestExplosiveImpacts = new Map<number, string>();
    let levelFrame = 0;
    const physics = new PhysicsWorld(new THREE.Scene(), undefined, {
      onExplosion: () => { explosionEvents++; },
      onImpact: (entity, force, point) => {
        if (!entity.explosive) return;
        const velocity = entity.body.linvel();
        latestExplosiveImpacts.set(entity.id, `frame ${levelFrame}, impulse ${rounded(force)}, point (${rounded(point?.x ?? 0)},${rounded(point?.y ?? 0)},${rounded(point?.z ?? 0)}), velocity (${rounded(velocity.x)},${rounded(velocity.y)},${rounded(velocity.z)}), previous (${rounded(entity.previousVelocity.x)},${rounded(entity.previousVelocity.y)},${rounded(entity.previousVelocity.z)})`);
      },
      onBreak: (entity, force) => {
        if (!entity.explosive) return;
        brokenExplosiveIds.push(entity.id);
        const position = entity.body.translation();
        brokenExplosiveDetails.push(`id ${entity.id} ${entity.type} at (${rounded(position.x)},${rounded(position.y)},${rounded(position.z)}), break impulse ${rounded(force)}; ${latestExplosiveImpacts.get(entity.id) ?? 'no preceding onImpact record'}`);
      },
    });
    physics.setQuality('high');
    const groups = new Map<string, Entity[]>();
    let failedSpawnDefinitions = 0;
    for (const definition of level.objects) {
      const spawned = physics.spawn(definition, false);
      if (!spawned) {
        failedSpawnDefinitions++;
        continue;
      }
      if ('body' in spawned && definition.group) {
        const group = groups.get(definition.group) ?? [];
        group.push(spawned);
        groups.set(definition.group, group);
      }
    }

    let eligibleRopeGroups = 0;
    let createdRopes = 0;
    for (const [groupName, entities] of groups) {
      if (entities.length < 2 || (!groupName.includes('rope') && !groupName.includes('weight'))) continue;
      eligibleRopeGroups++;
      const anchor = entities.find((entity) => entity.type === 'rope-anchor') ?? entities[0];
      const weight = entities.find((entity) => entity.type === 'weight') ?? entities[entities.length - 1];
      if (anchor.id !== weight.id && physics.createConnector(
        'rope', anchor, weight, anchor.object.position.distanceTo(weight.object.position),
      )) createdRopes++;
    }

    const initial = snapshot(physics);
    accumulateSnapshot(aggregateInitial, initial);
    const explosiveIds = [...physics.entities.values()]
      .filter((entity) => entity.explosive)
      .map((entity) => entity.id);
    const localFailures = new Set<string>();
    const outcome = await simulate(physics, 5, realtime, localFailures, 80, () => { levelFrame++; });
    accumulateSnapshot(aggregateFinal, outcome.final);
    peakLinearSpeed = Math.max(peakLinearSpeed, outcome.peakLinearSpeed);
    peakAngularSpeed = Math.max(peakAngularSpeed, outcome.peakAngularSpeed);
    peakAbsCoordinate = Math.max(peakAbsCoordinate, outcome.peakAbsCoordinate);
    maximumLateLinearSpeed = Math.max(maximumLateLinearSpeed, outcome.lateRmsLinearSpeed);
    maximumLateAngularSpeed = Math.max(maximumLateAngularSpeed, outcome.lateRmsAngularSpeed);

    const explosiveIdsStillTracked = explosiveIds.every((id) => physics.entities.has(id));
    const onlyRopeConnectors = [...physics.connectors.values()].every((connector) => connector.type === 'rope');
    const levelAssertions = [
      assertion(`level ${level.id}: every authored definition spawned`, failedSpawnDefinitions === 0, failedSpawnDefinitions, '0 failed definitions'),
      assertion(`level ${level.id}: only rope/weight groups create connectors`, initial.connectors === eligibleRopeGroups && createdRopes === eligibleRopeGroups, `${initial.connectors}/${createdRopes}/${eligibleRopeGroups}`, 'registered/created/eligible counts equal'),
      assertion(`level ${level.id}: all authored connectors are ropes`, onlyRopeConnectors, onlyRopeConnectors, 'true'),
      assertion(`level ${level.id}: no idle explosion callback`, explosionEvents === 0, explosionEvents, '0'),
      assertion(`level ${level.id}: no explosive body breaks while idle`, brokenExplosiveIds.length === 0, brokenExplosiveDetails.join('; ') || 0, '0'),
      assertion(`level ${level.id}: no explosive body is removed while idle`, explosiveIdsStillTracked, explosiveIdsStillTracked, 'true'),
      assertion(`level ${level.id}: all transforms and velocities stay finite`, outcome.final.nonFiniteBodyIds.length === 0, outcome.final.nonFiniteBodyIds.length, '0 invalid'),
      assertion(`level ${level.id}: idle linear velocity stays bounded`, outcome.peakLinearSpeed <= LINEAR_SPEED_CAP + SPEED_EPSILON, rounded(outcome.peakLinearSpeed), `<= ${LINEAR_SPEED_CAP}`),
      assertion(`level ${level.id}: idle angular velocity stays bounded`, outcome.peakAngularSpeed <= ANGULAR_SPEED_CAP + SPEED_EPSILON, rounded(outcome.peakAngularSpeed), `<= ${ANGULAR_SPEED_CAP}`),
      assertion(`level ${level.id}: authored rope connectors survive idle`, outcome.final.connectors === eligibleRopeGroups, outcome.final.connectors, `${eligibleRopeGroups}`),
    ];
    assertions.push(...levelAssertions);
    levelAssertions.filter((item) => !item.pass).forEach((item) => failures.add(`${item.name}: got ${item.actual}, expected ${item.expected}`));
    localFailures.forEach((failure) => failures.add(`level ${level.id}: ${failure}`));
    disposePhysics(physics);
  }

  assertions.filter((item) => !item.pass).forEach((item) => failures.add(`${item.name}: got ${item.actual}, expected ${item.expected}`));
  const result: ScenarioResult = {
    name: 'all 12 authored levels / five-second idle stability',
    simulatedSeconds: LEVELS.length * 5,
    frames: LEVELS.length * Math.round(5 / FIXED_STEP),
    durationMs: rounded(performance.now() - started),
    pass: failures.size === 0,
    assertions,
    failures: [...failures].slice(0, 60),
    initial: aggregateInitial,
    final: aggregateFinal,
    observed: {
      peakLinearSpeed: rounded(peakLinearSpeed),
      peakAngularSpeed: rounded(peakAngularSpeed),
      peakAbsCoordinate: rounded(peakAbsCoordinate),
      lateRmsLinearSpeed: rounded(maximumLateLinearSpeed),
      lateRmsAngularSpeed: rounded(maximumLateAngularSpeed),
    },
  };
  return result;
}

function readOptions(): { seconds: number; realtime: boolean } {
  const params = new URLSearchParams(location.search);
  const requestedSeconds = Number(params.get('seconds') ?? DEFAULT_SECONDS);
  return {
    seconds: Number.isFinite(requestedSeconds) && requestedSeconds > 0 ? requestedSeconds : DEFAULT_SECONDS,
    realtime: params.get('realtime') === '1',
  };
}

async function main(): Promise<void> {
  const status = document.querySelector<HTMLElement>('#status')!;
  const output = document.querySelector<HTMLElement>('#report')!;
  const options = readOptions();
  status.textContent = options.realtime
    ? `Running seven physics regression scenarios (${options.seconds}-second stress windows)…`
    : `Running seven deterministic physics regression scenarios (${options.seconds}-second stress windows)…`;

  const scenarios: ScenarioResult[] = [];
  const tasks = [
    runLooseBlockWall,
    runConnectorCycleRejection,
    runRotatedRevoluteJoints,
    runMalformedRopeLengths,
    runSimulationScaleTransitions,
    runCompoundRagdollIntegrity,
    runHeldRagdoll,
    runRotatedWeld,
    runMassNormalizedPush,
    runExplosionBookkeeping,
    runDebrisBounds,
    runRagdollStress,
    runPropStress,
    runAuthoredLevelIdleRegression,
  ];
  status.textContent = status.textContent.replace('seven', String(tasks.length));
  for (const task of tasks) {
    scenarios.push(await task(options.seconds, options.realtime));
    output.textContent = JSON.stringify({ running: true, scenarios }, null, 2);
  }

  const report: RegressionReport = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'work/physics-tests/physics-regression.ts against src/game physics classes',
    pass: scenarios.every((scenario) => scenario.pass),
    scenarios,
  };
  window.__RATTLEWORKS_PHYSICS_REGRESSION__ = report;
  document.documentElement.dataset.testStatus = report.pass ? 'pass' : 'fail';
  status.textContent = report.pass ? 'PASS' : 'FAIL';
  status.className = report.pass ? 'pass' : 'fail';
  output.textContent = JSON.stringify(report, null, 2);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
  const status = document.querySelector<HTMLElement>('#status')!;
  status.textContent = 'HARNESS ERROR';
  status.className = 'fail';
  document.documentElement.dataset.testStatus = 'error';
  document.querySelector<HTMLElement>('#report')!.textContent = message;
});
