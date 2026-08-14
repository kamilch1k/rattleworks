import * as THREE from 'three';
import { PhysicsWorld } from '../../src/game/PhysicsWorld';
import { LEVELS } from '../../src/game/levels';
import type { Entity } from '../../src/game/types';

interface StartPose {
  entity: Entity;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
}

const physics = new PhysicsWorld(new THREE.Scene());
physics.setQuality('high');
const level = LEVELS[0];
const shack: StartPose[] = [];

for (const definition of level.objects) {
  const spawned = physics.spawn(definition, false);
  if (spawned && 'body' in spawned && definition.group === 'l1-hut') {
    const rotation = spawned.body.rotation();
    shack.push({
      entity: spawned,
      position: new THREE.Vector3(spawned.body.translation().x, spawned.body.translation().y, spawned.body.translation().z),
      rotation: new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
    });
  }
}

let peakSpeed = 0;
for (let step = 0; step < 600; step += 1) {
  physics.update(1 / 60);
  for (const pose of shack) {
    const velocity = pose.entity.body.linvel();
    peakSpeed = Math.max(peakSpeed, Math.hypot(velocity.x, velocity.y, velocity.z));
  }
}

const bodies = shack.map((pose, index) => {
  const translation = pose.entity.body.translation();
  const rotation = pose.entity.body.rotation();
  const position = new THREE.Vector3(translation.x, translation.y, translation.z);
  const quaternion = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
  return {
    index,
    type: pose.entity.type,
    displacement: position.distanceTo(pose.position),
    drop: pose.position.y - position.y,
    rotationDelta: pose.rotation.angleTo(quaternion),
    sleeping: pose.entity.body.isSleeping(),
    final: position.toArray(),
  };
});

const report = {
  pieces: bodies.length,
  peakSpeed,
  maxDisplacement: Math.max(...bodies.map((body) => body.displacement)),
  maxDrop: Math.max(...bodies.map((body) => body.drop)),
  maxRotationDelta: Math.max(...bodies.map((body) => body.rotationDelta)),
  displacedOver10cm: bodies.filter((body) => body.displacement > 0.1).length,
  tippedOver10deg: bodies.filter((body) => body.rotationDelta > THREE.MathUtils.degToRad(10)).length,
  worst: [...bodies].sort((a, b) => b.displacement - a.displacement).slice(0, 12),
};

document.querySelector('#report')!.textContent = JSON.stringify(report, null, 2);
(window as Window & { __LEVEL1_SHACK__?: typeof report }).__LEVEL1_SHACK__ = report;
