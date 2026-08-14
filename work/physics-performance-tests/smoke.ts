import * as THREE from 'three';
import { PhysicsWorld } from '../../src/game/PhysicsWorld';

function require(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

export function runPhysicsPerformanceSmoke(): Record<string, unknown> {
  const physics = new PhysicsWorld(new THREE.Scene());
  physics.setQuality('medium');

  for (let index = 0; index < 100; index++) {
    physics.spawn({
      type: 'crate',
      position: { x: (index % 10) * 1.3 - 5.85, y: 0.8 + Math.floor(index / 10) * 1.1, z: 0 },
    });
  }
  physics.spawn({ type: 'fan', position: { x: -3, y: 1, z: 0 }, fixed: true });
  physics.spawn({ type: 'magnet', position: { x: 3, y: 1, z: 0 }, fixed: true });

  const started = performance.now();
  for (let frame = 0; frame < 180; frame++) physics.update(1 / 60);
  const elapsedMs = performance.now() - started;
  const props = physics.bodyStats;
  require(props.total === 102, `expected 102 entities, got ${props.total}`);
  require(props.active + props.sleeping === props.total, 'active/sleeping bookkeeping mismatch');
  for (const entity of physics.entities.values()) {
    const position = entity.body.translation();
    require(Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z), `non-finite entity ${entity.id}`);
  }

  physics.clear();
  const character = physics.spawnCharacter('dummy', new THREE.Vector3(0, 2, 0));
  physics.explode(new THREE.Vector3(-0.8, 3.45, 0), 5.5, 92);
  for (let frame = 0; frame < 30; frame++) physics.update(1 / 60);
  require(character.dismembermentCount >= 1 && character.dismembermentCount <= 2, `unexpected detach count ${character.dismembermentCount}`);
  require(physics.world.impulseJoints.len() === 9 - character.dismembermentCount, 'joint accounting mismatch');

  const result = {
    pass: true,
    propScene: { ...props, simulatedFrames: 180, elapsedMs: Number(elapsedMs.toFixed(2)) },
    dismemberment: {
      detachedJoints: character.dismembermentCount,
      liveJoints: physics.world.impulseJoints.len(),
      bodies: physics.world.bodies.len(),
      colliders: physics.world.colliders.len(),
    },
  };
  physics.clear();
  physics.world.free();
  return result;
}
