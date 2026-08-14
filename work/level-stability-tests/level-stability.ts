import * as THREE from 'three';
import { LEVELS } from '../../src/game/levels';
import { PhysicsWorld } from '../../src/game/PhysicsWorld';
import type { Entity, SpawnDefinition } from '../../src/game/types';

const FIXED_STEP = 1 / 60;
const DEFAULT_SECONDS = 10;
const STRUCTURAL_TYPES = new Set([
  'beam',
  'concrete-block',
  'glass',
  'metal-beam',
  'plank',
  'platform',
  'roof',
  'wall-block',
]);

interface TrackedPose {
  definitionIndex: number;
  definition: SpawnDefinition;
  entity: Entity;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
}

interface PoseDelta {
  definitionIndex: number;
  entityId: number;
  type: string;
  group: string;
  fixed: boolean;
  structural: boolean;
  displacement: number;
  horizontalDisplacement: number;
  drop: number;
  rotationDegrees: number;
  start: number[];
  final: number[];
}

interface BreakDetail {
  entityId: number;
  type: string;
  group: string;
  force: number;
  position: number[];
}

export interface LevelStabilityResult {
  id: number;
  name: string;
  definitions: number;
  trackedBodies: number;
  failedSpawns: number;
  peakLinearSpeed: number;
  peakAngularSpeed: number;
  peakActiveBodies: number;
  lateActiveBodies: number;
  explosionEvents: number;
  brokenEntities: number;
  breakDetails: BreakDetail[];
  removedEntities: number;
  structuralCollapses: number;
  maxStructuralDisplacement: number;
  maxStructuralHorizontalDisplacement: number;
  maxStructuralDrop: number;
  maxStructuralRotationDegrees: number;
  worst: PoseDelta[];
}

export interface LevelStabilityReport {
  seconds: number;
  framesPerLevel: number;
  pass: boolean;
  levels: LevelStabilityResult[];
}

const round = (value: number): number => Number(value.toFixed(4));

function entityPose(entity: Entity): { position: THREE.Vector3; rotation: THREE.Quaternion } {
  const position = entity.body.translation();
  const rotation = entity.body.rotation();
  return {
    position: new THREE.Vector3(position.x, position.y, position.z),
    rotation: new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
  };
}

function createAuthoredRopes(physics: PhysicsWorld, tracked: readonly TrackedPose[]): void {
  const groups = new Map<string, Entity[]>();
  for (const pose of tracked) {
    const group = pose.definition.group;
    if (!group) continue;
    const entities = groups.get(group) ?? [];
    entities.push(pose.entity);
    groups.set(group, entities);
  }
  for (const [groupName, entities] of groups) {
    if (entities.length < 2 || (!groupName.includes('rope') && !groupName.includes('weight'))) continue;
    const anchor = entities.find((entity) => entity.type === 'rope-anchor') ?? entities[0];
    const weight = entities.find((entity) => entity.type === 'weight') ?? entities[entities.length - 1];
    if (anchor.id !== weight.id) {
      physics.createConnector('rope', anchor, weight, anchor.object.position.distanceTo(weight.object.position));
    }
  }
}

export function runLevelStabilityAudit(
  seconds = DEFAULT_SECONDS,
  includeCharacters = true,
  skippedLabels: ReadonlySet<string> = new Set(),
  onlyLevelId?: number,
): LevelStabilityReport {
  const frames = Math.max(1, Math.round(seconds / FIXED_STEP));
  const levels: LevelStabilityResult[] = [];

  for (const level of LEVELS) {
    if (onlyLevelId !== undefined && level.id !== onlyLevelId) continue;
    let explosionEvents = 0;
    let brokenEntities = 0;
    const breakDetails: BreakDetail[] = [];
    const physics = new PhysicsWorld(new THREE.Scene(), undefined, {
      onExplosion: () => { explosionEvents += 1; },
      onBreak: (entity, force) => {
        brokenEntities += 1;
        breakDetails.push({
          entityId: entity.id,
          type: entity.type,
          group: entity.group ?? '',
          force: round(force),
          position: entity.object.position.toArray().map(round),
        });
      },
    });
    physics.setQuality('high');

    const tracked: TrackedPose[] = [];
    let failedSpawns = 0;
    for (const [definitionIndex, definition] of level.objects.entries()) {
      if (!includeCharacters && definition.type === 'character') continue;
      if (definition.label && skippedLabels.has(definition.label)) continue;
      const spawned = physics.spawn(definition, false);
      if (!spawned) {
        failedSpawns += 1;
        continue;
      }
      if (!('body' in spawned)) continue;
      const pose = entityPose(spawned);
      tracked.push({ definitionIndex, definition, entity: spawned, ...pose });
    }
    createAuthoredRopes(physics, tracked);

    let peakLinearSpeed = 0;
    let peakAngularSpeed = 0;
    let peakActiveBodies = 0;
    let lateActiveBodies = 0;
    for (let frame = 0; frame < frames; frame += 1) {
      physics.update(FIXED_STEP);
      let activeBodies = 0;
      for (const entity of physics.entities.values()) {
        if (!entity.body.isValid() || entity.fixed) continue;
        const linear = entity.body.linvel();
        const angular = entity.body.angvel();
        peakLinearSpeed = Math.max(peakLinearSpeed, Math.hypot(linear.x, linear.y, linear.z));
        peakAngularSpeed = Math.max(peakAngularSpeed, Math.hypot(angular.x, angular.y, angular.z));
        if (!entity.body.isSleeping()) activeBodies += 1;
      }
      peakActiveBodies = Math.max(peakActiveBodies, activeBodies);
      if (frame >= Math.floor(frames * 0.8)) lateActiveBodies = Math.max(lateActiveBodies, activeBodies);
    }

    const deltas: PoseDelta[] = [];
    let removedEntities = 0;
    for (const pose of tracked) {
      if (!physics.entities.has(pose.entity.id) || !pose.entity.body.isValid()) {
        removedEntities += 1;
        continue;
      }
      const current = entityPose(pose.entity);
      const structural = STRUCTURAL_TYPES.has(pose.entity.type) && !pose.definition.fixed;
      const deltaX = current.position.x - pose.position.x;
      const deltaZ = current.position.z - pose.position.z;
      deltas.push({
        definitionIndex: pose.definitionIndex,
        entityId: pose.entity.id,
        type: pose.entity.type,
        group: pose.definition.group ?? '',
        fixed: Boolean(pose.definition.fixed),
        structural,
        displacement: round(current.position.distanceTo(pose.position)),
        horizontalDisplacement: round(Math.hypot(deltaX, deltaZ)),
        drop: round(pose.position.y - current.position.y),
        rotationDegrees: round(THREE.MathUtils.radToDeg(pose.rotation.angleTo(current.rotation))),
        start: pose.position.toArray().map(round),
        final: current.position.toArray().map(round),
      });
    }

    const structural = deltas.filter((delta) => delta.structural);
    const structuralCollapses = structural.filter((delta) => (
      delta.displacement > 0.3
      || delta.drop > 0.2
      || delta.rotationDegrees > 15
    ));
    const worst = [...deltas]
      .sort((a, b) => Math.max(b.displacement, b.rotationDegrees / 45) - Math.max(a.displacement, a.rotationDegrees / 45))
      .slice(0, 12);

    levels.push({
      id: level.id,
      name: level.name,
      definitions: level.objects.length,
      trackedBodies: tracked.length,
      failedSpawns,
      peakLinearSpeed: round(peakLinearSpeed),
      peakAngularSpeed: round(peakAngularSpeed),
      peakActiveBodies,
      lateActiveBodies,
      explosionEvents,
      brokenEntities,
      breakDetails,
      removedEntities,
      structuralCollapses: structuralCollapses.length,
      maxStructuralDisplacement: round(Math.max(0, ...structural.map((delta) => delta.displacement))),
      maxStructuralHorizontalDisplacement: round(Math.max(0, ...structural.map((delta) => delta.horizontalDisplacement))),
      maxStructuralDrop: round(Math.max(0, ...structural.map((delta) => delta.drop))),
      maxStructuralRotationDegrees: round(Math.max(0, ...structural.map((delta) => delta.rotationDegrees))),
      worst,
    });

    physics.clear();
  }

  return {
    seconds,
    framesPerLevel: frames,
    pass: levels.every((level) => (
      level.failedSpawns === 0
      && level.explosionEvents === 0
      && level.brokenEntities === 0
      && level.removedEntities === 0
      && level.structuralCollapses === 0
    )),
    levels,
  };
}
