import * as THREE from 'three';
import {
  PhysicsWorld,
  type DismembermentEvent,
  type PhysicsEvents,
} from '../../src/game/PhysicsWorld';
import {
  buildWorldTheme,
  WORLD_THEME_ENTITY_GROUP_PREFIX,
  WORLD_THEME_FENCE_BODY_BUDGET,
  type EnvironmentKind,
} from '../../src/game/WorldTheme';
import type { AnatomicalJoint, Character, Entity } from '../../src/game/types';

const FIXED_STEP = 1 / 60;
const INITIAL_ANATOMICAL_JOINTS = 9;

interface Assertion {
  name: string;
  pass: boolean;
  actual: unknown;
  expected: string;
}

interface ScenarioResult {
  name: string;
  pass: boolean;
  durationMs: number;
  assertions: Assertion[];
  details: Record<string, unknown>;
}

interface DismembermentRegressionReport {
  version: 1;
  generatedAt: string;
  source: string;
  pass: boolean;
  scenarios: ScenarioResult[];
  totals: {
    scenarios: number;
    assertions: number;
    failures: number;
  };
}

interface PhysicsInternals {
  eventQueue: { free(): void };
}

declare global {
  interface Window {
    __RATTLEWORKS_DISMEMBERMENT_REGRESSION__?: DismembermentRegressionReport;
  }
}

function assertion(name: string, pass: boolean, actual: unknown, expected: string): Assertion {
  return { name, pass, actual, expected };
}

function rounded(value: number): number {
  return Number(value.toFixed(4));
}

function finiteVector(vector: { x: number; y: number; z: number }): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

function finiteEntity(entity: Entity): boolean {
  if (!entity.body.isValid()) return false;
  const rotation = entity.body.rotation();
  if (!finiteVector(entity.body.translation())
    || !finiteVector(entity.body.linvel())
    || !finiteVector(entity.body.angvel())
    || ![rotation.x, rotation.y, rotation.z, rotation.w].every(Number.isFinite)) return false;

  for (let index = 0; index < entity.body.numColliders(); index++) {
    const collider = entity.body.collider(index);
    if (!collider.isValid()) return false;
    const colliderRotation = collider.rotation();
    if (!finiteVector(collider.translation())
      || ![colliderRotation.x, colliderRotation.y, colliderRotation.z, colliderRotation.w].every(Number.isFinite)) return false;
  }
  return true;
}

function colliderOwnershipIsExact(physics: PhysicsWorld, entity: Entity): boolean {
  for (let index = 0; index < entity.body.numColliders(); index++) {
    if (physics.colliderToEntity.get(entity.body.collider(index).handle) !== entity.id) return false;
  }
  return true;
}

function requireCharacter(value: Entity | Character | null, name: string): Character {
  if (!value || !('parts' in value)) throw new Error(`Failed to spawn character fixture: ${name}`);
  return value;
}

function requireEntity(value: Entity | Character | null, name: string): Entity {
  if (!value || !('body' in value)) throw new Error(`Failed to spawn entity fixture: ${name}`);
  return value;
}

function spawnDummy(physics: PhysicsWorld, y = 2): Character {
  return requireCharacter(physics.spawn({
    type: 'character',
    variant: 'dummy',
    position: { x: 0, y, z: 0 },
  }), 'dummy');
}

function step(physics: PhysicsWorld, frames: number, observe?: () => void): void {
  for (let frame = 0; frame < frames; frame++) {
    physics.update(FIXED_STEP);
    observe?.();
  }
}

function stepUntil(physics: PhysicsWorld, maximumFrames: number, condition: () => boolean): number {
  for (let frame = 1; frame <= maximumFrames; frame++) {
    physics.update(FIXED_STEP);
    if (condition()) return frame;
  }
  return maximumFrames;
}

function detachedJoints(character: Character): AnatomicalJoint[] {
  return character.anatomicalJoints.filter((joint) => joint.detached);
}

function detachedEntities(physics: PhysicsWorld, character: Character): Entity[] {
  return [...character.detachedParts]
    .map((id) => physics.entities.get(id))
    .filter((entity): entity is Entity => Boolean(entity));
}

function wrapperIsInvalid(wrapper: NonNullable<AnatomicalJoint['joint']>): boolean {
  try {
    return !wrapper.isValid();
  } catch {
    return false;
  }
}

function disposePhysics(physics: PhysicsWorld): void {
  (physics as unknown as PhysicsInternals).eventQueue.free();
  physics.world.free();
}

function scenario(
  name: string,
  started: number,
  assertions: Assertion[],
  details: Record<string, unknown>,
): ScenarioResult {
  return {
    name,
    pass: assertions.every((item) => item.pass),
    durationMs: rounded(performance.now() - started),
    assertions,
    details,
  };
}

function jointAccounting(physics: PhysicsWorld, character: Character): {
  detachedMetadata: number;
  removedWorldJoints: number;
  liveWorldJoints: number;
  dismembermentCount: number;
} {
  const detachedMetadata = detachedJoints(character).length;
  const liveWorldJoints = physics.world.impulseJoints.len();
  return {
    detachedMetadata,
    removedWorldJoints: INITIAL_ANATOMICAL_JOINTS - liveWorldJoints,
    liveWorldJoints,
    dismembermentCount: character.dismembermentCount,
  };
}

async function runExplosionBoundAndIntegrity(): Promise<ScenarioResult> {
  const started = performance.now();
  const events: DismembermentEvent[] = [];
  const physics = new PhysicsWorld(new THREE.Scene(), undefined, {
    onDismemberment: (event) => events.push(event),
  });
  physics.setQuality('high');
  physics.world.gravity = { x: 0, y: 0, z: 0 };
  const character = spawnDummy(physics);
  const originalWrappers = new Map(character.anatomicalJoints.map((joint) => [joint.id, joint.joint]));

  physics.explode(new THREE.Vector3(-0.8, 3.45, 0), 5.5, 92);
  step(physics, 12);

  const detached = detachedJoints(character);
  const detachedBodies = detachedEntities(physics, character);
  const accounting = jointAccounting(physics, character);
  const wrappersCleared = detached.every((joint) => joint.joint === undefined);
  const originalWrappersInvalid = detached.every((joint) => {
    const wrapper = originalWrappers.get(joint.id);
    return Boolean(wrapper && wrapperIsInvalid(wrapper));
  });
  const allDetachedBodiesValid = detachedBodies.length > 0 && detachedBodies.every((entity) => (
    physics.entities.get(entity.id) === entity
    && finiteEntity(entity)
    && entity.body.numColliders() >= 1
    && colliderOwnershipIsExact(physics, entity)
    && entity.detachedFromCharacter === true
  ));
  const eventIds = events.map((event) => event.joint);
  const uniqueEventIds = new Set(eventIds);
  const assertions = [
    assertion('one strong blast detaches at least one anatomical joint', detached.length >= 1, detached.length, '>= 1'),
    assertion('one strong blast detaches at most two joints from one character', detached.length <= 2, detached.length, '<= 2'),
    assertion('world joint removal exactly matches detached metadata', accounting.removedWorldJoints === accounting.detachedMetadata, accounting, 'removedWorldJoints === detachedMetadata'),
    assertion('dismemberment counter exactly matches detached metadata', accounting.dismembermentCount === accounting.detachedMetadata, accounting, 'dismembermentCount === detachedMetadata'),
    assertion('one event is emitted for each unique severed joint', events.length === detached.length && uniqueEventIds.size === events.length, eventIds, 'one unique event per detached joint'),
    assertion('detached joint metadata drops every live wrapper reference', wrappersCleared, wrappersCleared, 'true'),
    assertion('Rapier invalidates each removed original joint wrapper', originalWrappersInvalid, originalWrappersInvalid, 'true'),
    assertion('detachment marks at least one body as disconnected', character.detachedParts.size >= 1, character.detachedParts.size, '>= 1'),
    assertion('all detached bodies and compound colliders remain finite and owned', allDetachedBodiesValid, allDetachedBodiesValid, 'true'),
    assertion('all ten character body entities remain tracked after severing', character.parts.every((part) => physics.entities.get(part.id) === part), character.parts.filter((part) => physics.entities.get(part.id) !== part).map((part) => part.id), 'all ten tracked'),
  ];
  const result = scenario('explosion detachment bound, joint accounting, and detached-body integrity', started, assertions, {
    accounting,
    eventIds,
    detachedPartIds: [...character.detachedParts],
    detachedBodyColliderCounts: detachedBodies.map((entity) => ({ id: entity.id, part: entity.part, colliders: entity.body.numColliders() })),
    health: rounded(character.health),
  });
  disposePhysics(physics);
  return result;
}

async function runRepeatedBlastIdempotence(): Promise<ScenarioResult> {
  const started = performance.now();
  const events: DismembermentEvent[] = [];
  const physics = new PhysicsWorld(new THREE.Scene(), undefined, {
    onDismemberment: (event) => events.push(event),
  });
  physics.setQuality('high');
  physics.world.gravity = { x: 0, y: 0, z: 0 };
  const character = spawnDummy(physics);
  const wrappers = new Map(character.anatomicalJoints.map((joint) => [joint.id, joint.joint]));
  const detachCounts: number[] = [];
  let repeatError = '';

  try {
    for (let blast = 0; blast < 3; blast++) {
      physics.explode(new THREE.Vector3(-0.8, 3.45, 0), 5.5, 92);
      detachCounts.push(detachedJoints(character).length);
    }
    step(physics, 12);
  } catch (error) {
    repeatError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }

  const detached = detachedJoints(character);
  const eventIds = events.map((event) => event.joint);
  const uniqueEventIds = new Set(eventIds);
  const increments = detachCounts.map((count, index) => count - (detachCounts[index - 1] ?? 0));
  const everyRemovedWrapperInvalid = detached.every((joint) => {
    const wrapper = wrappers.get(joint.id);
    return joint.joint === undefined && Boolean(wrapper && wrapperIsInvalid(wrapper));
  });
  const accounting = jointAccounting(physics, character);
  const assertions = [
    assertion('three repeated blasts complete without a freed-wrapper exception', repeatError === '', repeatError || 'none', 'none'),
    assertion('each individual blast remains capped to two new detachments', increments.every((increment) => increment >= 0 && increment <= 2), increments, 'every increment in [0, 2]'),
    assertion('repeated blasts never emit the same severed joint twice', uniqueEventIds.size === eventIds.length, eventIds, 'all unique'),
    assertion('event count matches final detached metadata after repeated blasts', events.length === detached.length, `${events.length}/${detached.length}`, 'equal'),
    assertion('repeat blasts leave removed wrapper fields empty and original wrappers invalid', everyRemovedWrapperInvalid, everyRemovedWrapperInvalid, 'true'),
    assertion('repeat-blast world joint count matches metadata exactly', accounting.removedWorldJoints === accounting.detachedMetadata, accounting, 'removedWorldJoints === detachedMetadata'),
    assertion('repeat blasts cannot detach more than six joints across three calls', detached.length <= 6, detached.length, '<= 6'),
    assertion('all surviving and detached body wrappers remain finite', character.parts.every(finiteEntity), character.parts.filter((part) => !finiteEntity(part)).map((part) => part.id), 'all finite'),
  ];
  const result = scenario('repeated blast idempotence and no double-free of anatomical wrappers', started, assertions, {
    detachCounts,
    increments,
    eventIds,
    accounting,
  });
  disposePhysics(physics);
  return result;
}

interface RockFixture {
  physics: PhysicsWorld;
  character: Character;
  rock: Entity;
  events: DismembermentEvent[];
  impactCount: number;
  maxImpact: number;
}

function createRockFixture(speed: number): RockFixture {
  const events: DismembermentEvent[] = [];
  let impactCount = 0;
  let maxImpact = 0;
  const callbacks: PhysicsEvents = {
    onDismemberment: (event) => events.push(event),
    onImpact: (_entity, force) => {
      impactCount++;
      maxImpact = Math.max(maxImpact, force);
    },
  };
  const physics = new PhysicsWorld(new THREE.Scene(), undefined, callbacks);
  physics.setQuality('high');
  physics.world.gravity = { x: 0, y: 0, z: 0 };
  const character = spawnDummy(physics);
  const rock = requireEntity(physics.spawn({
    type: 'heavy-ball',
    position: { x: -3.4, y: 3.47, z: 0 },
  }), 'heavy ball');
  rock.body.setLinvel({ x: speed, y: 0, z: 0 }, true);
  return {
    physics,
    character,
    rock,
    events,
    get impactCount() { return impactCount; },
    get maxImpact() { return maxImpact; },
  };
}

async function runStrongRockDetachment(): Promise<ScenarioResult> {
  const started = performance.now();
  const fixture = createRockFixture(30);
  const framesToDetach = stepUntil(fixture.physics, 90, () => fixture.events.length > 0);
  const detached = detachedJoints(fixture.character);
  const detachedBodies = detachedEntities(fixture.physics, fixture.character);
  const accounting = jointAccounting(fixture.physics, fixture.character);
  const assertions = [
    assertion('strong heavy-ball collision reaches the contact-impact path', fixture.impactCount >= 1, fixture.impactCount, '>= 1'),
    assertion('strong heavy-ball collision detaches an anatomical joint', detached.length >= 1, detached.length, '>= 1'),
    assertion('one collision step emits one rock dismemberment event', fixture.events.length === 1, fixture.events.map((event) => event.joint), 'exactly 1'),
    assertion('rock collision removes exactly the metadata-counted joint', accounting.removedWorldJoints === accounting.detachedMetadata, accounting, 'removedWorldJoints === detachedMetadata'),
    assertion('heavy ball remains a valid finite projectile after impact', finiteEntity(fixture.rock), finiteEntity(fixture.rock), 'true'),
    assertion('rock-detached limb bodies and colliders remain finite', detachedBodies.length > 0 && detachedBodies.every((entity) => finiteEntity(entity) && colliderOwnershipIsExact(fixture.physics, entity)), detachedBodies.map((entity) => ({ id: entity.id, finite: finiteEntity(entity) })), 'all finite and owned'),
  ];
  const result = scenario('strong physical heavy-ball impact detaches a limb', started, assertions, {
    framesToDetach,
    maxImpact: rounded(fixture.maxImpact),
    detachedJoints: detached.map((joint) => joint.id),
    detachedParts: detachedBodies.map((entity) => entity.part),
    accounting,
  });
  disposePhysics(fixture.physics);
  return result;
}

async function runWeakRockNegativeCase(): Promise<ScenarioResult> {
  const started = performance.now();
  const fixture = createRockFixture(6);
  const initialHealth = fixture.character.health;
  step(fixture.physics, 120);
  const accounting = jointAccounting(fixture.physics, fixture.character);
  const assertions = [
    assertion('weak heavy-ball fixture still produces an external contact callback', fixture.impactCount >= 1, fixture.impactCount, '>= 1'),
    assertion('weak collision remains below dismemberment behavior', fixture.events.length === 0 && accounting.detachedMetadata === 0, `${fixture.events.length}/${accounting.detachedMetadata}`, '0/0'),
    assertion('weak collision removes no anatomical joint wrappers', accounting.liveWorldJoints === INITIAL_ANATOMICAL_JOINTS, accounting.liveWorldJoints, String(INITIAL_ANATOMICAL_JOINTS)),
    assertion('weak collision leaves all anatomical metadata live', fixture.character.anatomicalJoints.every((joint) => !joint.detached && Boolean(joint.joint?.isValid())), fixture.character.anatomicalJoints.map((joint) => `${joint.id}:${joint.detached}/${joint.joint?.isValid()}`), 'all false/true'),
    assertion('weak collision keeps every ragdoll body finite', fixture.character.parts.every(finiteEntity), fixture.character.parts.filter((part) => !finiteEntity(part)).map((part) => part.id), 'all finite'),
  ];
  const result = scenario('weak physical collision does not detach anatomy', started, assertions, {
    impactCount: fixture.impactCount,
    maxImpact: rounded(fixture.maxImpact),
    healthDelta: rounded(initialHealth - fixture.character.health),
    accounting,
  });
  disposePhysics(fixture.physics);
  return result;
}

interface PropImpactFixture {
  physics: PhysicsWorld;
  character: Character;
  prop: Entity;
  hitCallbacks: number;
  defeatCallbacks: number;
}

function createPropImpactFixture(downwardSpeed: number): PropImpactFixture {
  let hitCallbacks = 0;
  let defeatCallbacks = 0;
  const physics = new PhysicsWorld(new THREE.Scene(), undefined, {
    onCharacterHit: () => { hitCallbacks++; },
    onCharacterDefeated: () => { defeatCallbacks++; },
  });
  physics.setQuality('high');
  // An explicit downward velocity makes the closing speed deterministic and
  // isolates contact damage from fall-distance and frame-pacing differences.
  physics.world.gravity = { x: 0, y: 0, z: 0 };
  const character = spawnDummy(physics, 0);
  const prop = requireEntity(physics.spawn({
    type: 'weight',
    position: { x: 0, y: 4.1, z: 0 },
  }), '25 kg falling weight');
  prop.body.setLinvel({ x: 0, y: -downwardSpeed, z: 0 }, true);
  return {
    physics,
    character,
    prop,
    get hitCallbacks() { return hitCallbacks; },
    get defeatCallbacks() { return defeatCallbacks; },
  };
}

async function runMassivePropImpactDamage(): Promise<ScenarioResult> {
  const started = performance.now();
  const hard = createPropImpactFixture(10);
  const hardFrames = stepUntil(hard.physics, 90, () => hard.character.defeated);
  const hardOutcome = {
    defeated: hard.character.defeated,
    health: rounded(hard.character.health),
    hitCallbacks: hard.hitCallbacks,
    defeatCallbacks: hard.defeatCallbacks,
    targetsRemaining: hard.physics.targetsRemaining,
    propMass: rounded(hard.prop.body.mass()),
    propFinite: finiteEntity(hard.prop),
    ragdollFinite: hard.character.parts.every(finiteEntity),
    frames: hardFrames,
  };

  const gentle = createPropImpactFixture(1.1);
  const gentleInitialHealth = gentle.character.health;
  step(gentle.physics, 180);
  const gentleOutcome = {
    defeated: gentle.character.defeated,
    healthDelta: rounded(gentleInitialHealth - gentle.character.health),
    hitCallbacks: gentle.hitCallbacks,
    defeatCallbacks: gentle.defeatCallbacks,
    detachedJoints: detachedJoints(gentle.character).length,
    propMass: rounded(gentle.prop.body.mass()),
    propFinite: finiteEntity(gentle.prop),
    ragdollFinite: gentle.character.parts.every(finiteEntity),
  };

  const assertions = [
    assertion('hard-impact fixture uses a genuinely massive dynamic prop', !hard.prop.fixed && hardOutcome.propMass >= 24, hardOutcome.propMass, 'dynamic and >= 24 kg'),
    assertion('hard 25 kg prop impact defeats the ragdoll', hardOutcome.defeated && hardOutcome.targetsRemaining === 0, hardOutcome, 'defeated with 0 targets remaining'),
    assertion('hard prop impact emits character damage and one defeat callback', hardOutcome.hitCallbacks >= 1 && hardOutcome.defeatCallbacks === 1, `${hardOutcome.hitCallbacks}/${hardOutcome.defeatCallbacks}`, '>= 1 hit / exactly 1 defeat'),
    assertion('hard prop impact leaves the prop and ragdoll bodies finite', hardOutcome.propFinite && hardOutcome.ragdollFinite, `${hardOutcome.propFinite}/${hardOutcome.ragdollFinite}`, 'true/true'),
    assertion('gentle contact from the same 25 kg prop is nonlethal', !gentleOutcome.defeated && gentleOutcome.defeatCallbacks === 0, gentleOutcome, 'not defeated / 0 defeat callbacks'),
    assertion('gentle prop contact causes no health or anatomy damage', gentleOutcome.healthDelta === 0 && gentleOutcome.hitCallbacks === 0 && gentleOutcome.detachedJoints === 0, gentleOutcome, '0 health / 0 hits / 0 detached joints'),
    assertion('gentle fixture also remains finite', gentleOutcome.propFinite && gentleOutcome.ragdollFinite, `${gentleOutcome.propFinite}/${gentleOutcome.ragdollFinite}`, 'true/true'),
  ];
  const result = scenario('massive falling-prop impact is lethal only at hard closing speed', started, assertions, {
    hard: hardOutcome,
    gentle: gentleOutcome,
  });
  disposePhysics(hard.physics);
  disposePhysics(gentle.physics);
  return result;
}

async function runClearAfterDetachment(): Promise<ScenarioResult> {
  const started = performance.now();
  const physics = new PhysicsWorld(new THREE.Scene());
  physics.setQuality('high');
  physics.world.gravity = { x: 0, y: 0, z: 0 };
  const first = spawnDummy(physics);
  physics.explode(new THREE.Vector3(-0.8, 3.45, 0), 5.5, 92);
  const detachedBeforeClear = detachedJoints(first).length;
  let clearError = '';
  try {
    physics.clear();
  } catch (error) {
    clearError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }

  const clearedCounts = {
    entities: physics.entities.size,
    characters: physics.characters.size,
    bodies: physics.world.bodies.len(),
    colliders: physics.world.colliders.len(),
    joints: physics.world.impulseJoints.len(),
  };
  physics.world.gravity = { x: 0, y: 0, z: 0 };
  const fresh = spawnDummy(physics, 4);
  step(physics, 12);
  const freshCounts = {
    entities: physics.entities.size,
    characters: physics.characters.size,
    bodies: physics.world.bodies.len(),
    colliders: physics.world.colliders.len(),
    joints: physics.world.impulseJoints.len(),
  };
  const assertions = [
    assertion('reset fixture actually severs before clear', detachedBeforeClear >= 1, detachedBeforeClear, '>= 1'),
    assertion('clear after detachment completes without wrapper errors', clearError === '', clearError || 'none', 'none'),
    assertion('clear leaves only the new ground body/collider', clearedCounts.entities === 0 && clearedCounts.characters === 0 && clearedCounts.bodies === 1 && clearedCounts.colliders === 1 && clearedCounts.joints === 0, clearedCounts, '0 entities / 0 characters / 1 body / 1 collider / 0 joints'),
    assertion('fresh character recreates exactly nine valid anatomical joints', fresh.anatomicalJoints.length === INITIAL_ANATOMICAL_JOINTS && fresh.anatomicalJoints.every((joint) => !joint.detached && Boolean(joint.joint?.isValid())), fresh.anatomicalJoints.map((joint) => `${joint.id}:${joint.detached}/${joint.joint?.isValid()}`), '9 live valid joints'),
    assertion('fresh world bookkeeping is exact after reset', freshCounts.entities === 10 && freshCounts.characters === 1 && freshCounts.bodies === 11 && freshCounts.colliders === 15 && freshCounts.joints === 9, freshCounts, '10 entities / 1 character / 11 bodies / 15 colliders / 9 joints'),
    assertion('fresh ragdoll remains finite after reset', fresh.parts.every(finiteEntity), fresh.parts.filter((part) => !finiteEntity(part)).map((part) => part.id), 'all finite'),
  ];
  const result = scenario('clear/reset after detachment safely rebuilds Rapier anatomy', started, assertions, {
    detachedBeforeClear,
    clearedCounts,
    freshCounts,
  });
  disposePhysics(physics);
  return result;
}

function collectSelfContacts(physics: PhysicsWorld, character: Character, observed: Set<string>): void {
  for (const part of character.parts) {
    for (let index = 0; index < part.body.numColliders(); index++) {
      const collider = part.body.collider(index);
      physics.world.contactPairsWith(collider, (other) => {
        const otherId = physics.colliderToEntity.get(other.handle);
        const otherPart = otherId === undefined ? undefined : physics.entities.get(otherId);
        if (otherPart?.characterId !== character.id || otherPart.id === part.id) return;
        const low = Math.min(collider.handle, other.handle);
        const high = Math.max(collider.handle, other.handle);
        observed.add(`${low}:${high}`);
      });
    }
  }
}

async function runSelfContactNegativeCase(): Promise<ScenarioResult> {
  const started = performance.now();
  let hitCallbacks = 0;
  let impactCallbacks = 0;
  let dismembermentCallbacks = 0;
  const physics = new PhysicsWorld(new THREE.Scene(), undefined, {
    onCharacterHit: () => { hitCallbacks++; },
    onImpact: () => { impactCallbacks++; },
    onDismemberment: () => { dismembermentCallbacks++; },
  });
  physics.setQuality('high');
  physics.world.gravity = { x: 0, y: 0, z: 0 };
  const character = spawnDummy(physics, 4);
  const initialHealth = character.health;
  const compoundExtremities = new Set(['lower-arm-l', 'lower-arm-r', 'lower-leg-l', 'lower-leg-r']);
  for (const part of character.parts) {
    if (!compoundExtremities.has(part.part ?? '')) continue;
    const position = part.body.translation();
    const left = part.part?.endsWith('-l') ?? false;
    const arm = part.part?.startsWith('lower-arm') ?? false;
    part.body.setTranslation({ x: position.x + (left ? 0.12 : -0.12), y: position.y, z: position.z }, false);
    part.body.setAngvel({ x: 0, y: 0, z: (left ? 1 : -1) * (arm ? 5.5 : 4.5) }, false);
  }
  character.parts.forEach((part) => part.body.wakeUp());
  const selfContacts = new Set<string>();
  step(physics, 360, () => collectSelfContacts(physics, character, selfContacts));

  const accounting = jointAccounting(physics, character);
  const assertions = [
    assertion('folded ragdoll produces actual non-adjacent same-character contacts', selfContacts.size >= 1, selfContacts.size, '>= 1 unique contact pair'),
    assertion('same-character contacts emit no character hit callbacks', hitCallbacks === 0, hitCallbacks, '0'),
    assertion('same-character contacts are filtered before impact callbacks', impactCallbacks === 0, impactCallbacks, '0'),
    assertion('same-character contacts emit no dismemberment callbacks', dismembermentCallbacks === 0, dismembermentCallbacks, '0'),
    assertion('same-character contacts leave health unchanged', Math.abs(character.health - initialHealth) <= 1e-6, rounded(character.health - initialHealth), '0 health delta'),
    assertion('same-character contacts remove no anatomical joints', accounting.detachedMetadata === 0 && accounting.liveWorldJoints === INITIAL_ANATOMICAL_JOINTS, accounting, '0 detached / 9 live'),
    assertion('self-contact stress leaves all ragdoll bodies finite', character.parts.every(finiteEntity), character.parts.filter((part) => !finiteEntity(part)).map((part) => part.id), 'all finite'),
  ];
  const result = scenario('same-character self-contact is physical but never damaging', started, assertions, {
    uniqueContactPairs: selfContacts.size,
    hitCallbacks,
    impactCallbacks,
    dismembermentCallbacks,
    healthDelta: rounded(character.health - initialHealth),
    accounting,
  });
  disposePhysics(physics);
  return result;
}

async function runManagedThemePropValidation(): Promise<ScenarioResult> {
  const started = performance.now();
  const kinds: EnvironmentKind[] = ['backyard', 'yard', 'workshop', 'factory', 'castle'];
  const expectedCounts: Record<EnvironmentKind, number> = {
    backyard: 33,
    yard: 31,
    workshop: 0,
    factory: 4,
    castle: 2,
  };
  const propCounts = {} as Record<EnvironmentKind, number>;
  const spawnedCounts = {} as Record<EnvironmentKind, number>;
  let allDefinitionsManaged = true;
  let allSpawnedPropsDestructible = true;
  let allSpawnedPropsFinite = true;
  let treeDefinitions = 0;
  let treeOwners = 0;
  let fenceDefinitions = 0;
  let fenceOwners = 0;
  let allFenceGeometryIsPhysical = true;
  const managedGroupIds = new Set<string>();
  let managedGroupIdsAreUnique = true;

  for (const kind of kinds) {
    const group = new THREE.Group();
    const theme = buildWorldTheme(group, kind);
    propCounts[kind] = theme.gameplayProps.length;
    const physics = new PhysicsWorld(new THREE.Scene());
    physics.setQuality('high');
    physics.world.gravity = { x: 0, y: 0, z: 0 };
    let spawnedCount = 0;

    for (const prop of theme.gameplayProps) {
      allDefinitionsManaged = allDefinitionsManaged
        && Boolean(prop.definition.group?.startsWith(WORLD_THEME_ENTITY_GROUP_PREFIX))
        && prop.definition.fixed !== true;
      const groupId = prop.definition.group ?? '';
      managedGroupIdsAreUnique = managedGroupIdsAreUnique && !managedGroupIds.has(groupId);
      managedGroupIds.add(groupId);
      if (prop.definition.group?.includes(':tree:')) treeDefinitions++;
      if (prop.definition.group?.includes(':fence:')) {
        fenceDefinitions++;
        const scale = prop.definition.scale;
        allFenceGeometryIsPhysical = allFenceGeometryIsPhysical
          && prop.decorate === undefined
          && Boolean(scale && scale.x > 0 && scale.y > 0 && scale.z > 0)
          && Boolean(scale && Math.abs(prop.definition.position.y - scale.y * 0.5) <= 1e-6);
      }
      const entity = requireEntity(physics.spawn(prop.definition, false), `${kind} theme prop`);
      prop.decorate?.(entity.object);
      spawnedCount++;
      allSpawnedPropsDestructible = allSpawnedPropsDestructible && entity.destructible;
      allSpawnedPropsFinite = allSpawnedPropsFinite
        && finiteEntity(entity)
        && Boolean(entity.collider?.isValid())
        && colliderOwnershipIsExact(physics, entity);
      if (entity.group?.includes(':tree:') && entity.material === 'wood' && entity.destructible) treeOwners++;
      if (entity.group?.includes(':fence:') && entity.destructible) fenceOwners++;
    }
    spawnedCounts[kind] = spawnedCount;
    physics.clear();
    theme.dispose();
    theme.dispose();
    disposePhysics(physics);
  }

  const countsExact = kinds.every((kind) => propCounts[kind] === expectedCounts[kind]);
  const totalProps = Object.values(propCounts).reduce((sum, count) => sum + count, 0);
  const maximumProps = Math.max(...Object.values(propCounts));
  const assertions = [
    assertion('theme gameplay prop counts remain exact and bounded', countsExact && totalProps === 70 && maximumProps <= WORLD_THEME_FENCE_BODY_BUDGET + 4, { propCounts, totalProps, maximumProps }, '33/31/0/4/2, total 70, max <= fence budget + 4'),
    assertion('every managed theme definition has a world-theme group and dynamic owner', allDefinitionsManaged, allDefinitionsManaged, 'true'),
    assertion('every managed theme definition has a unique group id', managedGroupIdsAreUnique, managedGroupIds.size, String(totalProps)),
    assertion('every managed theme definition spawns exactly once', kinds.every((kind) => spawnedCounts[kind] === propCounts[kind]), spawnedCounts, 'matches propCounts'),
    assertion('all managed theme owners use the production destructible pipeline', allSpawnedPropsDestructible, allSpawnedPropsDestructible, 'true'),
    assertion('all managed theme owners have finite owned colliders', allSpawnedPropsFinite, allSpawnedPropsFinite, 'true'),
    assertion('backyard exports exactly four managed tree definitions', treeDefinitions === 4, treeDefinitions, '4'),
    assertion('all four tree definitions spawn as destructible wood owners', treeOwners === 4, treeOwners, '4'),
    assertion('backyard and yard export exactly 54 bounded fence bodies', fenceDefinitions === 54, fenceDefinitions, '29 backyard + 25 yard'),
    assertion('every fence body spawns through the destructible production path', fenceOwners === fenceDefinitions, `${fenceOwners}/${fenceDefinitions}`, '54/54'),
    assertion('every visible fence piece is its aligned collider owner with no collider-less decoration', allFenceGeometryIsPhysical, allFenceGeometryIsPhysical, 'true'),
  ];
  return scenario('managed environment props are bounded and trees are destructible owners', started, assertions, {
    propCounts,
    spawnedCounts,
    totalProps,
    maximumProps,
    treeDefinitions,
    treeOwners,
    fenceDefinitions,
    fenceOwners,
    fenceBodyBudget: WORLD_THEME_FENCE_BODY_BUDGET,
  });
}

export async function runDismembermentRegression(
  onScenario?: (scenarios: ScenarioResult[]) => void,
): Promise<DismembermentRegressionReport> {
  const tasks: Array<() => Promise<ScenarioResult>> = [
    runExplosionBoundAndIntegrity,
    runRepeatedBlastIdempotence,
    runStrongRockDetachment,
    runWeakRockNegativeCase,
    runMassivePropImpactDamage,
    runClearAfterDetachment,
    runSelfContactNegativeCase,
    runManagedThemePropValidation,
  ];
  const scenarios: ScenarioResult[] = [];

  for (const task of tasks) {
    const result = await task();
    scenarios.push(result);
    onScenario?.(scenarios);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  const assertions = scenarios.flatMap((result) => result.assertions);
  const failures = assertions.filter((item) => !item.pass).length;
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'work/dismemberment-tests/dismemberment-regression.ts against production PhysicsWorld and WorldTheme',
    pass: failures === 0,
    scenarios,
    totals: {
      scenarios: scenarios.length,
      assertions: assertions.length,
      failures,
    },
  };
}

async function main(): Promise<void> {
  const status = document.querySelector<HTMLElement>('#status')!;
  const output = document.querySelector<HTMLElement>('#report')!;
  status.textContent = 'Running 8 production dismemberment scenarios...';
  const report = await runDismembermentRegression((scenarios) => {
    output.textContent = JSON.stringify({ running: true, scenarios }, null, 2);
  });
  window.__RATTLEWORKS_DISMEMBERMENT_REGRESSION__ = report;
  document.documentElement.dataset.testStatus = report.pass ? 'pass' : 'fail';
  status.textContent = report.pass ? 'PASS' : 'FAIL';
  status.className = report.pass ? 'pass' : 'fail';
  output.textContent = JSON.stringify(report, null, 2);
}

if (typeof document !== 'undefined') {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
    const status = document.querySelector<HTMLElement>('#status')!;
    status.textContent = 'HARNESS ERROR';
    status.className = 'fail';
    document.documentElement.dataset.testStatus = 'error';
    document.querySelector<HTMLElement>('#report')!.textContent = message;
  });
}
