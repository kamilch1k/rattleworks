import type { MaterialId, SpawnDefinition, Vec3 } from './types';

/**
 * Stable campaign vehicle kits.
 *
 * Every prefab is assembled from loose, collision-matched bodies. A broad,
 * visible keel or pair of treads carries the shell, so the vehicles do not
 * need rigid joints and do not balance their full mass on round wheels. Hard
 * hits can therefore peel the parked vehicle apart without an idle constraint
 * loop injecting energy into the scene.
 */

export interface VehiclePrefabOptions {
  /** Rotation around the ground normal, in radians. Local forward is +X. */
  yaw?: number;
  color?: number;
  accentColor?: number;
}

export interface IndustrialTruckPrefabOptions extends VehiclePrefabOptions {
  /** Adds four upright explosive drums inside the cargo bed. */
  hazardousCargo?: boolean;
}

export interface VehiclePrefabBounds {
  x: number;
  y: number;
  z: number;
}

/** Conservative placement bounds, including wheels and protruding barrels. */
export const VEHICLE_PREFAB_BOUNDS = {
  car: { x: 4.8, y: 1.75, z: 2.7 },
  tank: { x: 6.6, y: 2.4, z: 3 },
  industrialTruck: { x: 6.4, y: 2.25, z: 2.8 },
} as const satisfies Readonly<Record<string, VehiclePrefabBounds>>;

const COLOR = {
  tire: 0x252a2e,
  undercarriage: 0x343d42,
  car: 0xb84e43,
  carAccent: 0xe5c35c,
  glass: 0x79bdc8,
  tank: 0x66784f,
  tankAccent: 0xa5a65d,
  truck: 0xd28b3f,
  truckAccent: 0x496f7d,
  cargo: 0x626e73,
  hazard: 0xc94b3e,
} as const;

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

function rotateGroundOffset(origin: Vec3, local: Vec3, yaw: number): Vec3 {
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  return {
    x: origin.x + local.x * cosine + local.z * sine,
    y: origin.y + local.y,
    z: origin.z - local.x * sine + local.z * cosine,
  };
}

interface PieceOptions {
  material?: MaterialId;
  color: number;
  yaw: number;
  /** Cylinders use their local Y axis, so tires need a compound world rotation. */
  tire?: boolean;
}

function piece(
  type: string,
  origin: Vec3,
  localPosition: Vec3,
  scale: Vec3,
  group: string,
  options: PieceOptions,
): SpawnDefinition {
  return {
    type,
    position: rotateGroundOffset(origin, localPosition, options.yaw),
    scale,
    material: options.material ?? 'metal',
    color: options.color,
    group,
    rotation: options.tire
      // This Euler order maps the cylinder axis onto local Z, then turns that
      // axle with the vehicle yaw. `x + y` would leave it stuck on world Z.
      ? { x: Math.PI / 2, z: -options.yaw }
      : { y: options.yaw },
  };
}

function tire(
  origin: Vec3,
  x: number,
  y: number,
  z: number,
  diameter: number,
  width: number,
  group: string,
  yaw: number,
): SpawnDefinition {
  return piece('vehicle-wheel', origin, v(x, y, z), v(diameter, width, diameter), group, {
    material: 'plastic',
    color: COLOR.tire,
    yaw,
    tire: true,
  });
}

/**
 * Seven-piece shell plus four free wheels. The low metal keel supports the
 * body directly; tires are collision-correct details rather than load-bearing
 * joints, so a parked car settles without rolling itself apart.
 */
export function createParkedCar(
  origin: Vec3,
  group: string,
  options: VehiclePrefabOptions = {},
): SpawnDefinition[] {
  const yaw = options.yaw ?? 0;
  const shell = options.color ?? COLOR.car;
  const accent = options.accentColor ?? COLOR.carAccent;
  const result: SpawnDefinition[] = [
    piece('vehicle-keel', origin, v(0, 0.16, 0), v(3.5, 0.32, 1.55), group, {
      color: COLOR.undercarriage,
      yaw,
    }),
    piece('vehicle-body', origin, v(0, 0.615, 0), v(4.5, 0.57, 1.85), group, {
      color: shell,
      yaw,
    }),
    piece('vehicle-trunk', origin, v(-1.7, 1.025, 0), v(0.85, 0.25, 1.78), group, {
      color: accent,
      yaw,
    }),
    piece('vehicle-cabin', origin, v(-0.3, 1.175, 0), v(1.65, 0.55, 1.58), group, {
      material: 'glass',
      color: COLOR.glass,
      yaw,
    }),
    piece('vehicle-hood', origin, v(1.4, 1.05, 0), v(1.45, 0.3, 1.78), group, {
      color: shell,
      yaw,
    }),
    piece('vehicle-roof', origin, v(-0.3, 1.54, 0), v(1.85, 0.18, 1.75), group, {
      color: accent,
      yaw,
    }),
  ];

  for (const x of [-1.45, 1.45]) {
    for (const z of [-1.13, 1.13]) result.push(tire(origin, x, 0.44, z, 0.86, 0.34, group, yaw));
  }
  return result;
}

/**
 * A loose-body tracked tank: two broad tread slabs support the lower hull,
 * then the upper hull, turret, and balanced barrel stack on real faces. The
 * barrel's centre of mass stays over the turret even though its muzzle extends
 * forward, preventing the idle droop/explosion common to constrained barrels.
 */
export function createParkedTank(
  origin: Vec3,
  group: string,
  options: VehiclePrefabOptions = {},
): SpawnDefinition[] {
  const yaw = options.yaw ?? 0;
  const shell = options.color ?? COLOR.tank;
  const accent = options.accentColor ?? COLOR.tankAccent;
  return [
    piece('vehicle-keel', origin, v(0, 0.23, 0), v(4.2, 0.46, 1.2), group, {
      color: COLOR.undercarriage,
      yaw,
    }),
    piece('vehicle-tread', origin, v(0, 0.29, -1.15), v(4.8, 0.58, 0.62), group, {
      material: 'plastic',
      color: COLOR.tire,
      yaw,
    }),
    piece('vehicle-tread', origin, v(0, 0.29, 1.15), v(4.8, 0.58, 0.62), group, {
      material: 'plastic',
      color: COLOR.tire,
      yaw,
    }),
    piece('vehicle-tank-hull', origin, v(0, 0.9, 0), v(4.5, 0.62, 2), group, {
      color: shell,
      yaw,
    }),
    piece('vehicle-tank-upper', origin, v(-0.2, 1.435, 0), v(3.45, 0.45, 1.65), group, {
      color: accent,
      yaw,
    }),
    piece('vehicle-turret', origin, v(-0.35, 1.9, 0), v(1.85, 0.48, 1.45), group, {
      color: shell,
      yaw,
    }),
    piece('vehicle-tank-barrel', origin, v(0.27, 2.26, 0), v(2.7, 0.24, 0.26), group, {
      color: COLOR.undercarriage,
      yaw,
    }),
  ];
}

/**
 * A boxy industrial flatbed truck. The broad chassis—not its six wheels—takes
 * the static load. Optional drums are fully contained by the bed and provide a
 * deliberate chain-reaction target without touching at spawn time.
 */
export function createIndustrialTruck(
  origin: Vec3,
  group: string,
  options: IndustrialTruckPrefabOptions = {},
): SpawnDefinition[] {
  const yaw = options.yaw ?? 0;
  const shell = options.color ?? COLOR.truck;
  const accent = options.accentColor ?? COLOR.truckAccent;
  const result: SpawnDefinition[] = [
    piece('vehicle-keel', origin, v(0, 0.17, 0), v(4.9, 0.34, 1.55), group, {
      color: COLOR.undercarriage,
      yaw,
    }),
    piece('vehicle-chassis', origin, v(0, 0.53, 0), v(5.6, 0.38, 1.85), group, {
      color: COLOR.cargo,
      yaw,
    }),
    piece('vehicle-truck-cab', origin, v(1.9, 1.045, 0), v(1.45, 0.65, 1.75), group, {
      color: shell,
      yaw,
    }),
    piece('vehicle-truck-window', origin, v(1.9, 1.645, 0), v(1.25, 0.55, 1.55), group, {
      material: 'glass',
      color: COLOR.glass,
      yaw,
    }),
    piece('vehicle-truck-roof', origin, v(1.9, 2.02, 0), v(1.5, 0.2, 1.75), group, {
      color: accent,
      yaw,
    }),
    piece('vehicle-cargo-floor', origin, v(-0.9, 0.83, 0), v(3.15, 0.22, 1.95), group, {
      color: COLOR.cargo,
      yaw,
    }),
    piece('vehicle-cargo-side', origin, v(-0.9, 1.29, -0.89), v(2.9, 0.7, 0.16), group, {
      color: accent,
      yaw,
    }),
    piece('vehicle-cargo-side', origin, v(-0.9, 1.29, 0.89), v(2.9, 0.7, 0.16), group, {
      color: accent,
      yaw,
    }),
    piece('vehicle-tailgate', origin, v(-2.385, 1.29, 0), v(0.18, 0.7, 1.62), group, {
      color: accent,
      yaw,
    }),
  ];

  for (const x of [-1.75, 0.25, 2]) {
    for (const z of [-1.13, 1.13]) result.push(tire(origin, x, 0.44, z, 0.86, 0.34, group, yaw));
  }

  if (options.hazardousCargo) {
    for (const x of [-1.45, -0.55]) {
      for (const z of [-0.42, 0.42]) {
        result.push(piece('explosive-barrel', origin, v(x, 1.36, z), v(0.62, 0.82, 0.62), group, {
          color: COLOR.hazard,
          yaw,
        }));
      }
    }
  }
  return result;
}
