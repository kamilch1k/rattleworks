import * as THREE from 'three';
import { LEVELS } from '../src/game/levels.ts';
import type { SpawnDefinition } from '../src/game/types.ts';

type Box = {
  def: SpawnDefinition;
  index: number;
  center: THREE.Vector3;
  half: THREE.Vector3;
  axes: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
};

const cylinderTypes = new Set(['barrel', 'explosive-barrel', 'wheel', 'motor', 'rocket']);

function boxFor(def: SpawnDefinition, index: number): Box | null {
  if (def.type === 'character' || !def.scale) return null;
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(def.rotation?.x ?? 0, def.rotation?.y ?? 0, def.rotation?.z ?? 0),
  );
  return {
    def,
    index,
    center: new THREE.Vector3(def.position.x, def.position.y, def.position.z),
    half: new THREE.Vector3(def.scale.x / 2, def.scale.y / 2, def.scale.z / 2),
    axes: [
      new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion),
      new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion),
      new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion),
    ],
  };
}

// Returns the smallest separation-axis overlap. Positive means the OBBs truly overlap.
function obbPenetration(a: Box, b: Box): number {
  const delta = b.center.clone().sub(a.center);
  const candidates: THREE.Vector3[] = [...a.axes, ...b.axes];
  for (const aa of a.axes) {
    for (const bb of b.axes) {
      const cross = new THREE.Vector3().crossVectors(aa, bb);
      if (cross.lengthSq() > 1e-10) candidates.push(cross.normalize());
    }
  }

  let depth = Number.POSITIVE_INFINITY;
  for (const axis of candidates) {
    const ra =
      a.half.x * Math.abs(axis.dot(a.axes[0])) +
      a.half.y * Math.abs(axis.dot(a.axes[1])) +
      a.half.z * Math.abs(axis.dot(a.axes[2]));
    const rb =
      b.half.x * Math.abs(axis.dot(b.axes[0])) +
      b.half.y * Math.abs(axis.dot(b.axes[1])) +
      b.half.z * Math.abs(axis.dot(b.axes[2]));
    const overlap = ra + rb - Math.abs(delta.dot(axis));
    if (overlap <= 0) return overlap;
    depth = Math.min(depth, overlap);
  }
  return depth;
}

const threshold = Number(process.argv[2] ?? 0.02);
let total = 0;
for (const level of LEVELS) {
  const boxes = level.objects.map(boxFor).filter((box): box is Box => Boolean(box));
  const overlaps: Array<{ a: Box; b: Box; depth: number }> = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const depth = obbPenetration(a, b);
      if (depth > threshold) overlaps.push({ a, b, depth });
    }
  }
  total += overlaps.length;
  console.log(`L${level.id}: ${overlaps.length}`);
  for (const { a, b, depth } of overlaps) {
    const cylinderNote = cylinderTypes.has(a.def.type) || cylinderTypes.has(b.def.type) ? ' [cylinder AABB candidate]' : '';
    console.log(
      `  #${a.index} ${a.def.type}/${a.def.group ?? '-'} <-> #${b.index} ${b.def.type}/${b.def.group ?? '-'} depth=${depth.toFixed(3)}${cylinderNote}`,
    );
  }
}
console.log(`TOTAL: ${total}`);
