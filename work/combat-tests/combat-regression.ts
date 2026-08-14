import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d';
import { PhysicsWorld, type PhysicsEvents, type WeaponUseResult } from '../../src/game/PhysicsWorld';
import { ParticleSystem } from '../../src/game/ParticleSystem';
import type { Character, Entity, WeaponKind, WeaponMode } from '../../src/game/types';

const FIXED_STEP = 1 / 60;
const WEAPON_KINDS = ['pistol', 'shotgun', 'rifle', 'knife', 'machete', 'axe', 'spear'] as const;
const FIREARMS = ['pistol', 'shotgun', 'rifle'] as const;
const MELEE_WEAPONS = ['knife', 'machete', 'axe', 'spear'] as const;

const EXPECTED_WEAPON_STATE: Readonly<Record<WeaponKind, {
  mode: WeaponMode;
  magazineSize: number;
  reserveAmmo: number;
}>> = {
  pistol: { mode: 'firearm', magazineSize: 12, reserveAmmo: 48 },
  shotgun: { mode: 'firearm', magazineSize: 6, reserveAmmo: 24 },
  rifle: { mode: 'firearm', magazineSize: 24, reserveAmmo: 72 },
  knife: { mode: 'melee', magazineSize: 0, reserveAmmo: 0 },
  machete: { mode: 'melee', magazineSize: 0, reserveAmmo: 0 },
  axe: { mode: 'melee', magazineSize: 0, reserveAmmo: 0 },
  spear: { mode: 'melee', magazineSize: 0, reserveAmmo: 0 },
};

interface Assertion {
  name: string;
  pass: boolean;
  actual: unknown;
  expected: string;
}

interface ScenarioResult {
  name: string;
  pass: boolean;
  assertions: Assertion[];
  durationMs: number;
  details?: Record<string, unknown>;
}

interface CombatRegressionReport {
  version: 1;
  generatedAt: string;
  source: string;
  pass: boolean;
  scenarios: ScenarioResult[];
}

interface GoreInternals {
  droplets: unknown[];
  chunks: unknown[];
  flashes: unknown[];
  splats: unknown[];
  maxDroplets: number;
  maxChunks: number;
  maxFlashes: number;
  maxSplats: number;
}

interface PhysicsInternals {
  eventQueue: { free(): void };
}

declare global {
  interface Window {
    __RATTLEWORKS_COMBAT_REGRESSION__?: CombatRegressionReport;
  }
}

function assert(name: string, pass: boolean, actual: unknown, expected: string): Assertion {
  return { name, pass, actual, expected };
}

function rounded(value: number): number {
  return Number(value.toFixed(4));
}

function finiteVector(vector: { x: number; y: number; z: number }): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

function finiteBody(entity: Entity): boolean {
  if (!entity.body.isValid()) return false;
  const rotation = entity.body.rotation();
  return finiteVector(entity.body.translation())
    && finiteVector(entity.body.linvel())
    && finiteVector(entity.body.angvel())
    && [rotation.x, rotation.y, rotation.z, rotation.w].every(Number.isFinite);
}

function requireEntity(value: Entity | Character | null, fixture: string): Entity {
  if (!value || !('body' in value)) throw new Error(`Failed to spawn ${fixture}.`);
  return value;
}

function requireCharacter(value: Entity | Character | null, fixture: string): Character {
  if (!value || !('parts' in value)) throw new Error(`Failed to spawn ${fixture}.`);
  return value;
}

function bodyPoint(entity: Entity): THREE.Vector3 {
  const position = entity.body.translation();
  return new THREE.Vector3(position.x, position.y, position.z);
}

function step(physics: PhysicsWorld, frames: number, observe?: () => void): void {
  for (let frame = 0; frame < frames; frame++) {
    physics.update(FIXED_STEP);
    observe?.();
  }
}

function physicsCounts(physics: PhysicsWorld): { bodies: number; colliders: number; joints: number } {
  return {
    bodies: physics.world.bodies.len(),
    colliders: physics.world.colliders.len(),
    joints: physics.world.impulseJoints.len(),
  };
}

function disposePhysics(physics: PhysicsWorld): void {
  (physics as unknown as PhysicsInternals).eventQueue.free();
  physics.world.free();
}

function result(
  name: string,
  started: number,
  assertions: Assertion[],
  details?: Record<string, unknown>,
): ScenarioResult {
  return {
    name,
    pass: assertions.every((item) => item.pass),
    assertions,
    durationMs: rounded(performance.now() - started),
    details,
  };
}

async function runWeaponSpawnRegistry(): Promise<ScenarioResult> {
  const started = performance.now();
  const physics = new PhysicsWorld(new THREE.Scene());
  physics.setQuality('high');
  physics.world.gravity = { x: 0, y: 0, z: 0 };
  const spawned = [...WEAPON_KINDS, 'ammo-box' as const].map((kind, index) => requireEntity(physics.spawn({
    type: kind,
    position: { x: (index - 3.5) * 4, y: 5, z: 0 },
  }), kind));

  step(physics, 120);
  const assertions: Assertion[] = [];
  for (const entity of spawned) {
    const weaponKind = WEAPON_KINDS.find((kind) => kind === entity.type);
    assertions.push(
      assert(`${entity.type}: rigid body and transform remain finite`, finiteBody(entity), finiteBody(entity), 'true'),
      assert(`${entity.type}: exactly one owning collider`, entity.body.numColliders() === 1, entity.body.numColliders(), '1'),
      assert(
        `${entity.type}: collider lookup owns the entity`,
        Boolean(entity.collider && physics.colliderToEntity.get(entity.collider.handle) === entity.id),
        entity.collider ? physics.colliderToEntity.get(entity.collider.handle) : 'missing collider',
        String(entity.id),
      ),
    );
    if (weaponKind) {
      const expected = EXPECTED_WEAPON_STATE[weaponKind];
      assertions.push(
        assert(`${weaponKind}: weapon state exists`, Boolean(entity.weapon), Boolean(entity.weapon), 'true'),
        assert(`${weaponKind}: mode is registered`, entity.weapon?.mode === expected.mode, entity.weapon?.mode, expected.mode),
        assert(`${weaponKind}: magazine size is registered`, entity.weapon?.magazineSize === expected.magazineSize, entity.weapon?.magazineSize, String(expected.magazineSize)),
        assert(`${weaponKind}: initial ammo matches magazine`, entity.weapon?.ammo === expected.magazineSize, entity.weapon?.ammo, String(expected.magazineSize)),
        assert(`${weaponKind}: reserve ammo is registered`, entity.weapon?.reserveAmmo === expected.reserveAmmo, entity.weapon?.reserveAmmo, String(expected.reserveAmmo)),
        assert(`${weaponKind}: physical weapon uses CCD`, entity.body.isCcdEnabled(), entity.body.isCcdEnabled(), 'true'),
        assert(`${weaponKind}: weapon cannot fracture itself`, !entity.destructible && entity.health === 9999, `${entity.destructible}/${entity.health}`, 'false/9999'),
      );
    } else {
      assertions.push(assert('ammo-box: remains a physical prop, not a weapon', entity.weapon === undefined, Boolean(entity.weapon), 'false'));
    }
  }
  const counts = physicsCounts(physics);
  assertions.push(
    assert('weapon registry creates eight tracked entities', physics.entities.size === 8, physics.entities.size, '8'),
    assert('weapon registry body bookkeeping includes one ground', counts.bodies === 9, counts.bodies, '9'),
    assert('weapon registry collider bookkeeping includes one ground', counts.colliders === 9, counts.colliders, '9'),
    assert('physical weapons add no rigid-body joints', counts.joints === 0, counts.joints, '0'),
  );
  const report = result('seven physical weapon kinds plus ammo-box spawn/state', started, assertions, counts);
  disposePhysics(physics);
  return report;
}

interface FirearmFixtureResult {
  kind: typeof FIREARMS[number];
  result: WeaponUseResult;
  callbackCount: number;
  healthBefore: number;
  healthAfter: number;
  ammoBefore: number;
  ammoAfter: number;
  characterImpactCount: number;
}

function fireAtSleepingCharacter(kind: typeof FIREARMS[number]): FirearmFixtureResult {
  let callbackCount = 0;
  const physics = new PhysicsWorld(new THREE.Scene(), undefined, {
    onCharacterHit: () => { callbackCount++; },
  });
  physics.setQuality('high');
  physics.world.gravity = { x: 0, y: 0, z: 0 };
  const weapon = requireEntity(physics.spawn({ type: kind, position: { x: -2, y: 1.85, z: 0 }, fixed: true }), kind);
  const character = requireCharacter(physics.spawn({ type: 'character', variant: 'dummy', position: { x: 0, y: 0, z: 0 } }), `${kind} target`);
  const torso = character.parts.find((part) => part.part === 'torso')!;
  // Rapier's spatial-query pipeline is refreshed by a world step. Gameplay
  // naturally does this before input; the isolated fixture must do it too.
  step(physics, 1);
  const healthBefore = character.health;
  const ammoBefore = weapon.weapon!.ammo;
  const useResult = physics.useWeapon(weapon, bodyPoint(torso));
  const characterImpactCount = useResult.impacts.filter((impact) => impact.entity?.characterId === character.id).length;
  const fixture: FirearmFixtureResult = {
    kind,
    result: useResult,
    callbackCount,
    healthBefore,
    healthAfter: character.health,
    ammoBefore,
    ammoAfter: weapon.weapon!.ammo,
    characterImpactCount,
  };
  disposePhysics(physics);
  return fixture;
}

async function runFirearmRaycastAndReload(): Promise<ScenarioResult> {
  const started = performance.now();
  const fixtures = FIREARMS.map(fireAtSleepingCharacter);
  const assertions: Assertion[] = [];
  for (const fixture of fixtures) {
    assertions.push(
      assert(`${fixture.kind}: click-to-world use fires`, fixture.result.used, fixture.result.used, 'true'),
      assert(`${fixture.kind}: reports firearm mode`, fixture.result.mode === 'firearm', fixture.result.mode, 'firearm'),
      assert(`${fixture.kind}: exact ray intersects a character collider`, fixture.characterImpactCount >= 1, fixture.characterImpactCount, '>= 1'),
      assert(`${fixture.kind}: one trigger consumes one round`, fixture.ammoAfter === fixture.ammoBefore - 1, `${fixture.ammoBefore} -> ${fixture.ammoAfter}`, `decrease by 1`),
      assert(`${fixture.kind}: ray damage lowers health`, fixture.healthAfter < fixture.healthBefore, `${rounded(fixture.healthBefore)} -> ${rounded(fixture.healthAfter)}`, 'health decreases'),
      assert(`${fixture.kind}: one trigger emits one character hit callback`, fixture.callbackCount === 1, fixture.callbackCount, '1'),
    );
  }

  let reloadHitCallbacks = 0;
  const physics = new PhysicsWorld(new THREE.Scene(), undefined, {
    onCharacterHit: () => { reloadHitCallbacks++; },
  });
  physics.world.gravity = { x: 0, y: 0, z: 0 };
  const pistol = requireEntity(physics.spawn({ type: 'pistol', position: { x: -2, y: 1.85, z: 0 }, fixed: true }), 'reload pistol');
  const character = requireCharacter(physics.spawn({ type: 'character', variant: 'heavy', position: { x: 0, y: 0, z: 0 } }), 'reload target');
  const torso = character.parts.find((part) => part.part === 'torso')!;
  step(physics, 1);
  pistol.weapon!.ammo = 1;
  const reserveBefore = pistol.weapon!.reserveAmmo;
  const finalRound = physics.useWeapon(pistol, bodyPoint(torso));
  step(physics, 15);
  const emptyAttempt = physics.useWeapon(pistol, bodyPoint(torso));
  const reloaded = physics.reloadWeapon(pistol);
  assertions.push(
    assert('pistol final chambered round fires', finalRound.used && pistol.weapon!.ammo === pistol.weapon!.magazineSize, `${finalRound.used}/${pistol.weapon!.ammo}`, 'shot used, then full after reload'),
    assert('empty firearm rejects click after cooldown', !emptyAttempt.used && emptyAttempt.reason === 'empty', `${emptyAttempt.used}/${emptyAttempt.reason}`, 'false/empty'),
    assert('reload succeeds from reserve', reloaded, reloaded, 'true'),
    assert('reload fills the magazine', pistol.weapon!.ammo === pistol.weapon!.magazineSize, pistol.weapon!.ammo, String(pistol.weapon!.magazineSize)),
    assert('reload transfers exactly one magazine from reserve', pistol.weapon!.reserveAmmo === reserveBefore - pistol.weapon!.magazineSize, `${reserveBefore} -> ${pistol.weapon!.reserveAmmo}`, `decrease by ${pistol.weapon!.magazineSize}`),
    assert('an empty click emits no extra character callback', reloadHitCallbacks === 1, reloadHitCallbacks, '1 callback from final round only'),
  );
  const report = result('firearm screen-to-world ray damage, ammo, empty state, and reload', started, assertions, {
    firearmFixtures: fixtures.map((fixture) => ({
      kind: fixture.kind,
      impacts: fixture.result.impacts.length,
      characterImpacts: fixture.characterImpactCount,
      damage: rounded(fixture.healthBefore - fixture.healthAfter),
    })),
  });
  disposePhysics(physics);
  return report;
}

async function runShotgunAggregation(): Promise<ScenarioResult> {
  const started = performance.now();
  let callbackCount = 0;
  let defeatedCount = 0;
  const physics = new PhysicsWorld(new THREE.Scene(), undefined, {
    onCharacterHit: () => { callbackCount++; },
    onCharacterDefeated: () => { defeatedCount++; },
  });
  physics.setQuality('high');
  physics.world.gravity = { x: 0, y: 0, z: 0 };
  const shotgun = requireEntity(physics.spawn({ type: 'shotgun', position: { x: -2, y: 1.85, z: 0 }, fixed: true }), 'aggregation shotgun');
  const character = requireCharacter(physics.spawn({ type: 'character', variant: 'dummy', position: { x: 0, y: 0, z: 0 } }), 'aggregation target');
  const torso = character.parts.find((part) => part.part === 'torso')!;
  step(physics, 1);
  const before = character.health;
  const useResult = physics.useWeapon(shotgun, bodyPoint(torso));
  const characterImpacts = useResult.impacts.filter((impact) => impact.entity?.characterId === character.id).length;
  const assertions = [
    assert('shotgun trigger fires', useResult.used, useResult.used, 'true'),
    assert('close-range spread resolves several pellet intersections', characterImpacts >= 4, characterImpacts, '>= 4 character intersections'),
    assert('all pellets aggregate to at most one hit callback', callbackCount <= 1, callbackCount, '<= 1'),
    assert('a damaging shotgun trigger still emits one hit callback', callbackCount === 1, callbackCount, '1'),
    assert('aggregated shotgun damage changes health', character.health < before, `${rounded(before)} -> ${rounded(character.health)}`, 'health decreases'),
    assert('one trigger can emit at most one defeat callback', defeatedCount <= 1, defeatedCount, '<= 1'),
    assert('one shotgun trigger consumes one shell', shotgun.weapon?.ammo === 5, shotgun.weapon?.ammo, '5'),
  ];
  const report = result('shotgun pellet aggregation per character and trigger', started, assertions, {
    totalImpacts: useResult.impacts.length,
    characterImpacts,
    callbacks: callbackCount,
    defeatedCallbacks: defeatedCount,
    damage: rounded(before - character.health),
  });
  disposePhysics(physics);
  return report;
}

async function runMeleeUseAndContact(): Promise<ScenarioResult> {
  const started = performance.now();
  const assertions: Assertion[] = [];
  const deliberateDetails: Array<Record<string, unknown>> = [];

  for (const kind of MELEE_WEAPONS) {
    let callbackCount = 0;
    const physics = new PhysicsWorld(new THREE.Scene(), undefined, {
      onCharacterHit: () => { callbackCount++; },
    });
    physics.setQuality('high');
    physics.world.gravity = { x: 0, y: 0, z: 0 };
    const weapon = requireEntity(physics.spawn({ type: kind, position: { x: -1.8, y: 1.85, z: 0 }, fixed: true }), `${kind} use fixture`);
    const character = requireCharacter(physics.spawn({ type: 'character', variant: 'heavy', position: { x: 0.3, y: 0, z: 0 } }), `${kind} use target`);
    const torso = character.parts.find((part) => part.part === 'torso')!;
    const before = character.health;
    const useResult = physics.useWeapon(weapon, bodyPoint(torso));
    const characterImpacts = useResult.impacts.filter((impact) => impact.entity?.characterId === character.id).length;
    assertions.push(
      assert(`${kind}: deliberate world-point swing is used`, useResult.used, useResult.used, 'true'),
      assert(`${kind}: deliberate swing reports melee mode`, useResult.mode === 'melee', useResult.mode, 'melee'),
      assert(`${kind}: deliberate sweep reaches a character part`, characterImpacts === 1, characterImpacts, '1'),
      assert(`${kind}: deliberate swing damages the character`, character.health < before, `${rounded(before)} -> ${rounded(character.health)}`, 'health decreases'),
      assert(`${kind}: deliberate swing emits one hit callback`, callbackCount === 1, callbackCount, '1'),
    );
    deliberateDetails.push({ kind, damage: rounded(before - character.health), characterImpacts, callbackCount });
    disposePhysics(physics);
  }

  let contactCallbacks = 0;
  const contactPoints: THREE.Vector3[] = [];
  const contactPhysics = new PhysicsWorld(new THREE.Scene(), undefined, {
    onCharacterHit: (_character, _damage, point) => {
      contactCallbacks++;
      contactPoints.push(point.clone());
    },
  });
  contactPhysics.setQuality('high');
  contactPhysics.world.gravity = { x: 0, y: 0, z: 0 };
  const axe = requireEntity(contactPhysics.spawn({ type: 'axe', position: { x: -3, y: 1.85, z: 0 } }), 'contact axe');
  const contactCharacter = requireCharacter(contactPhysics.spawn({ type: 'character', variant: 'heavy', position: { x: 0, y: 0, z: 0 } }), 'contact character');
  const contactHealthBefore = contactCharacter.health;
  axe.body.setLinvel({ x: 17, y: 0, z: 0 }, true);
  step(contactPhysics, 60);
  assertions.push(
    assert('physical melee collision invokes contact damage', contactCallbacks >= 1, contactCallbacks, '>= 1'),
    assert('physical melee collision lowers character health', contactCharacter.health < contactHealthBefore, `${rounded(contactHealthBefore)} -> ${rounded(contactCharacter.health)}`, 'health decreases'),
    assert('melee contact callbacks have finite world points', contactPoints.every(finiteVector), contactPoints.every(finiteVector), 'true'),
    assert('melee contact fixture remains finite after impact', [...contactPhysics.entities.values()].every(finiteBody), [...contactPhysics.entities.values()].filter((entity) => !finiteBody(entity)).map((entity) => entity.id), 'all finite'),
  );
  const report = result('deliberate melee use and physical contact damage', started, assertions, {
    deliberate: deliberateDetails,
    contactCallbacks,
    contactDamage: rounded(contactHealthBefore - contactCharacter.health),
  });
  disposePhysics(contactPhysics);
  return report;
}

async function runRepeatedCombatStability(): Promise<ScenarioResult> {
  const started = performance.now();
  let axeImpactEvents = 0;
  let axeId = -1;
  const events: PhysicsEvents = {
    onImpact: (entity) => {
      if (entity.id === axeId) axeImpactEvents++;
    },
  };
  const physics = new PhysicsWorld(new THREE.Scene(), undefined, events);
  physics.setQuality('high');
  physics.world.gravity = { x: 0, y: 0, z: 0 };
  const rifle = requireEntity(physics.spawn({ type: 'rifle', position: { x: -6, y: 4, z: 0 } }), 'recoil rifle');
  const wall = requireEntity(physics.spawn({
    type: 'concrete-block',
    position: { x: 4, y: 4, z: 0 },
    scale: { x: 2, y: 10, z: 10 },
    fixed: true,
  }), 'fixed impact wall');
  const target = bodyPoint(wall);
  let shotsUsed = 0;
  let reloads = 0;
  let maxRifleLinearSpeed = 0;
  let maxRifleAngularSpeed = 0;
  let maxAnyLinearSpeed = 0;
  let maxAnyAngularSpeed = 0;
  let finite = true;
  const observe = () => {
    for (const entity of physics.entities.values()) {
      finite = finite && finiteBody(entity);
      const linear = entity.body.linvel();
      const angular = entity.body.angvel();
      const linearSpeed = Math.hypot(linear.x, linear.y, linear.z);
      const angularSpeed = Math.hypot(angular.x, angular.y, angular.z);
      maxAnyLinearSpeed = Math.max(maxAnyLinearSpeed, linearSpeed);
      maxAnyAngularSpeed = Math.max(maxAnyAngularSpeed, angularSpeed);
      if (entity.id === rifle.id) {
        maxRifleLinearSpeed = Math.max(maxRifleLinearSpeed, linearSpeed);
        maxRifleAngularSpeed = Math.max(maxRifleAngularSpeed, angularSpeed);
      }
    }
  };

  for (let shot = 0; shot < 60; shot++) {
    if (rifle.weapon!.ammo === 0) {
      if (physics.reloadWeapon(rifle)) reloads++;
    }
    const useResult = physics.useWeapon(rifle, target);
    if (useResult.used) shotsUsed++;
    step(physics, 8, observe);
  }

  const axe = requireEntity(physics.spawn({ type: 'axe', position: { x: -4, y: 4, z: 2 } }), 'repeated impact axe');
  axeId = axe.id;
  for (let impact = 0; impact < 16; impact++) {
    axe.body.setTranslation({ x: -4, y: 4, z: 2 }, true);
    axe.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    axe.body.setLinvel({ x: 22, y: 0, z: 0 }, true);
    axe.body.setAngvel({ x: 0, y: 0, z: impact % 2 ? 3 : -3 }, true);
    step(physics, 28, observe);
  }

  const counts = physicsCounts(physics);
  const assertions = [
    assert('sixty repeated rifle triggers all fire after cooldown steps', shotsUsed === 60, shotsUsed, '60'),
    assert('repeated rifle firing reloads exactly when magazines empty', reloads === 2, reloads, '2'),
    assert('repeated recoil stays below a deliberate gameplay bound', maxRifleLinearSpeed <= 12, rounded(maxRifleLinearSpeed), '<= 12 m/s'),
    assert('repeated recoil angular speed stays controlled', maxRifleAngularSpeed <= 8, rounded(maxRifleAngularSpeed), '<= 8 rad/s'),
    assert('sixteen deliberate physical axe launches reach the wall', axeImpactEvents >= 16, axeImpactEvents, '>= 16 impact events'),
    assert('all repeated-fire and impact transforms remain finite', finite, finite, 'true'),
    assert('global linear velocity cap survives repeated combat', maxAnyLinearSpeed <= 45.05, rounded(maxAnyLinearSpeed), '<= 45.05 m/s'),
    assert('global angular velocity cap survives repeated combat', maxAnyAngularSpeed <= 25.05, rounded(maxAnyAngularSpeed), '<= 25.05 rad/s'),
    assert('combat stress does not create or lose rigid bodies', counts.bodies === physics.entities.size + 1, `${counts.bodies}/${physics.entities.size}`, 'tracked entities + one ground'),
    assert('combat stress does not create joints', counts.joints === 0, counts.joints, '0'),
  ];
  const report = result('repeated firearm recoil and physical melee impact stability', started, assertions, {
    shotsUsed,
    reloads,
    axeImpactEvents,
    maxRifleLinearSpeed: rounded(maxRifleLinearSpeed),
    maxRifleAngularSpeed: rounded(maxRifleAngularSpeed),
    maxAnyLinearSpeed: rounded(maxAnyLinearSpeed),
    maxAnyAngularSpeed: rounded(maxAnyAngularSpeed),
    counts,
  });
  disposePhysics(physics);
  return report;
}

function goreState(particles: ParticleSystem): Record<keyof GoreInternals, number> {
  const gore = particles.gore as unknown as GoreInternals;
  return {
    droplets: gore.droplets.length,
    chunks: gore.chunks.length,
    flashes: gore.flashes.length,
    splats: gore.splats.length,
    maxDroplets: gore.maxDroplets,
    maxChunks: gore.maxChunks,
    maxFlashes: gore.maxFlashes,
    maxSplats: gore.maxSplats,
  };
}

async function runGoreCapsAndClear(): Promise<ScenarioResult> {
  const started = performance.now();
  const scene = new THREE.Scene();
  const physics = new PhysicsWorld(scene);
  physics.setQuality('high');
  const particles = new ParticleSystem(scene);
  particles.setQuality('high');
  const beforeCounts = physicsCounts(physics);
  const baselineSceneChildren = scene.children.length;

  for (let index = 0; index < 220; index++) {
    particles.goreHit({
      point: new THREE.Vector3((index % 11) * 0.08, 1.2 + (index % 3) * 0.06, (index % 7) * 0.06),
      direction: new THREE.Vector3(0.8, 0.3, (index % 5 - 2) * 0.1),
      severity: 3,
      groundY: 0,
    });
  }
  for (let index = 0; index < 90; index++) {
    particles.goreDefeat({
      point: new THREE.Vector3((index % 9) * 0.1, 1.6, (index % 6) * 0.08),
      severity: 3,
      groundY: 0,
    });
  }
  const saturated = goreState(particles);
  const afterBurstCounts = physicsCounts(physics);
  for (let frame = 0; frame < 240; frame++) particles.update(FIXED_STEP);
  const settled = goreState(particles);
  const afterUpdateCounts = physicsCounts(physics);
  particles.setQuality('low');
  const downgraded = goreState(particles);
  particles.clear();
  const cleared = goreState(particles);
  const afterClearCounts = physicsCounts(physics);
  const assertions = [
    assert('high-quality droplets saturate but do not exceed cap', saturated.droplets === saturated.maxDroplets && saturated.droplets === 128, `${saturated.droplets}/${saturated.maxDroplets}`, '128/128'),
    assert('high-quality chunks saturate but do not exceed cap', saturated.chunks === saturated.maxChunks && saturated.chunks === 52, `${saturated.chunks}/${saturated.maxChunks}`, '52/52'),
    assert('high-quality flashes saturate but do not exceed cap', saturated.flashes === saturated.maxFlashes && saturated.flashes === 12, `${saturated.flashes}/${saturated.maxFlashes}`, '12/12'),
    assert('long-lived splats saturate but do not exceed cap', saturated.splats === saturated.maxSplats && saturated.splats === 76, `${saturated.splats}/${saturated.maxSplats}`, '76/76'),
    assert('short-lived gore recycles after four seconds', settled.droplets === 0 && settled.chunks === 0 && settled.flashes === 0, `${settled.droplets}/${settled.chunks}/${settled.flashes}`, '0/0/0'),
    assert('settled blood pools remain within high-quality cap', settled.splats > 0 && settled.splats <= settled.maxSplats, `${settled.splats}/${settled.maxSplats}`, '1..76'),
    assert('quality downgrade trims persistent splats immediately', downgraded.splats <= 20 && downgraded.maxSplats === 20, `${downgraded.splats}/${downgraded.maxSplats}`, '<= 20/20'),
    assert('gore clear empties every active effect list', cleared.droplets + cleared.chunks + cleared.flashes + cleared.splats === 0, JSON.stringify(cleared), 'all active counts 0'),
    assert('gore clear removes all gore scene objects', scene.children.length === baselineSceneChildren, `${baselineSceneChildren} -> ${scene.children.length}`, 'returns to baseline'),
    assert('gore bursts do not create physics bodies', afterBurstCounts.bodies === beforeCounts.bodies && afterUpdateCounts.bodies === beforeCounts.bodies && afterClearCounts.bodies === beforeCounts.bodies, `${beforeCounts.bodies}/${afterBurstCounts.bodies}/${afterUpdateCounts.bodies}/${afterClearCounts.bodies}`, 'unchanged'),
    assert('gore bursts do not create colliders', afterBurstCounts.colliders === beforeCounts.colliders && afterUpdateCounts.colliders === beforeCounts.colliders && afterClearCounts.colliders === beforeCounts.colliders, `${beforeCounts.colliders}/${afterBurstCounts.colliders}/${afterUpdateCounts.colliders}/${afterClearCounts.colliders}`, 'unchanged'),
    assert('gore bursts do not create joints', afterBurstCounts.joints === beforeCounts.joints && afterUpdateCounts.joints === beforeCounts.joints && afterClearCounts.joints === beforeCounts.joints, `${beforeCounts.joints}/${afterBurstCounts.joints}/${afterUpdateCounts.joints}/${afterClearCounts.joints}`, 'unchanged'),
  ];
  const report = result('render-only gore caps, settling, quality trim, and clear', started, assertions, {
    saturated,
    settled,
    downgraded,
    cleared,
    physicsCounts: { before: beforeCounts, afterBurst: afterBurstCounts, afterUpdate: afterUpdateCounts, afterClear: afterClearCounts },
  });
  particles.dispose();
  disposePhysics(physics);
  return report;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

async function main(): Promise<void> {
  const status = document.querySelector<HTMLElement>('#status')!;
  const output = document.querySelector<HTMLElement>('#report')!;
  const originalRandom = Math.random;
  Math.random = seededRandom(0x52415454);
  status.textContent = 'Running six deterministic combat regression scenarios...';
  const tasks = [
    runWeaponSpawnRegistry,
    runFirearmRaycastAndReload,
    runShotgunAggregation,
    runMeleeUseAndContact,
    runRepeatedCombatStability,
    runGoreCapsAndClear,
  ];
  const scenarios: ScenarioResult[] = [];

  try {
    for (const task of tasks) {
      const scenario = await task();
      scenarios.push(scenario);
      output.textContent = JSON.stringify({ running: true, scenarios }, null, 2);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  } finally {
    Math.random = originalRandom;
  }

  const report: CombatRegressionReport = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'work/combat-tests/combat-regression.ts against production PhysicsWorld and ParticleSystem',
    pass: scenarios.every((scenario) => scenario.pass),
    scenarios,
  };
  window.__RATTLEWORKS_COMBAT_REGRESSION__ = report;
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
