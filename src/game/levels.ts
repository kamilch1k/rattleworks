import type {
  CharacterKind,
  LevelDefinition,
  LevelResult,
  MaterialId,
  SpawnDefinition,
  Vec3,
} from './types';
import {
  createIndustrialTruck,
  createParkedCar,
  createParkedTank,
} from './VehiclePrefabs';

/**
 * Hand-authored campaign data.  Structures are deliberately assembled from
 * reusable bodies instead of single meshes so impacts can produce unscripted
 * collapses.  `group` names let the loader give related pieces matching
 * breakable-joint presets without putting level-specific logic in the loader.
 */

const COLOUR = {
  honeyWood: 0xc8873e,
  paleWood: 0xe3b86f,
  redWood: 0xb55442,
  darkWood: 0x70462f,
  concrete: 0xa8adb2,
  chalk: 0xd8d4c6,
  blueConcrete: 0x708aa8,
  castleStone: 0x8d8b9c,
  metal: 0x66727d,
  darkMetal: 0x3d4c55,
  yellowMetal: 0xe4b94f,
  redMetal: 0xb94f4f,
  glass: 0x8edbe2,
  rubber: 0x30343b,
  toyBlue: 0x4e8ed8,
  toyGreen: 0x67b66a,
  toyOrange: 0xe58b43,
  toyPurple: 0x8b68bb,
  dirt: 0x8b704e,
} as const;

/**
 * Stable public URLs for the twelve campaign illustrations. Keeping this
 * contract beside the authored level data lets art be generated or replaced
 * without coupling the menu to level geometry.
 */
export const LEVEL_THUMBNAIL_PATHS = {
  1: '/textures/pixel/levels/level-01-knock-knock-pixel-v1.png',
  2: '/textures/pixel/levels/level-02-bad-foundation-pixel-v1.png',
  3: '/textures/pixel/levels/level-03-barrel-trouble-pixel-v1.png',
  4: '/textures/pixel/levels/level-04-domino-house-pixel-v1.png',
  5: '/textures/pixel/levels/level-05-spring-cleaning-pixel-v1.png',
  6: '/textures/pixel/levels/level-06-wrecking-ball-pixel-v1.png',
  7: '/textures/pixel/levels/level-07-delivery-problem-pixel-v1.png',
  8: '/textures/pixel/levels/level-08-bridge-disaster-pixel-v1.png',
  9: '/textures/pixel/levels/level-09-castle-crash-pixel-v1.png',
  10: '/textures/pixel/levels/level-10-factory-accident-pixel-v1.png',
  11: '/textures/pixel/levels/level-11-tower-trouble-pixel-v1.png',
  12: '/textures/pixel/levels/level-12-everything-must-go-pixel-v1.png',
} as const;

type SpawnOptions = Partial<
  Pick<
    SpawnDefinition,
    'rotation' | 'fixed' | 'target' | 'friendly' | 'variant' | 'label' | 'group'
  >
>;

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

const offset = (origin: Vec3, x: number, y: number, z: number): Vec3 =>
  v(origin.x + x, origin.y + y, origin.z + z);

const body = (
  type: string,
  position: Vec3,
  scale: Vec3,
  material: MaterialId,
  color: number,
  options: SpawnOptions = {},
): SpawnDefinition => ({
  type,
  position,
  scale,
  material,
  color,
  ...options,
});

const enemy = (
  position: Vec3,
  variant: CharacterKind,
  label: string,
  group: string,
): SpawnDefinition => ({
  type: 'character',
  position,
  scale: v(1, 1, 1),
  material: 'toy',
  variant,
  target: true,
  friendly: false,
  label,
  // A unique group lets a character factory group its own ragdoll parts without
  // accidentally auto-welding two nearby enemies to one another.
  group: `${group}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
});

const friend = (position: Vec3, label: string, group: string): SpawnDefinition => ({
  type: 'character',
  position,
  scale: v(1, 1, 1),
  material: 'toy',
  variant: 'friendly',
  friendly: true,
  target: false,
  label,
  group: `${group}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
});

/** A 29-piece timber house with a doorway and a supported two-piece pitched roof. */
function house(
  origin: Vec3,
  group: string,
  wallColor = COLOUR.honeyWood,
  roofColor = COLOUR.redWood,
): SpawnDefinition[] {
  const result: SpawnDefinition[] = [];
  const width = 8;
  const depth = 5.6;
  const wallBottom = 0.32;
  const wallTop = 4.68;
  const fullWallHeight = wallTop - wallBottom;
  const wallCenter = wallBottom + fullWallHeight * 0.5;

  // Four independent floor strips.  The footprint extends beneath the full
  // corner-post cross section instead of leaving each post half unsupported.
  for (let column = 0; column < 4; column += 1) {
    result.push(
      body(
        'plank',
        offset(origin, -3.18 + column * 2.12, 0.16, 0),
        v(2.1, 0.3, depth + 0.44),
        'wood',
        COLOUR.darkWood,
        { group },
      ),
    );
  }

  // The back uses small panels so a projectile can punch through locally. Its
  // outer edges stop 1 cm short of the corner posts and its two courses have a
  // 2 cm settling seam, eliminating the old collider penetrations.
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      result.push(
        body(
          'wall-block',
          offset(origin, -2.8425 + column * 1.895, 1.405 + row * 2.19, -depth / 2),
          v(1.875, 2.17, 0.38),
          'wood',
          wallColor,
          { group },
        ),
      );
    }
  }

  // Three broad panels on each side fit between—not through—the corner posts.
  for (const side of [-1, 1]) {
    for (let section = 0; section < 3; section += 1) {
      result.push(
        body(
          'wall-block',
          offset(origin, side * width / 2, wallCenter, -1.733333 + section * 1.733333),
          v(0.38, fullWallHeight, 1.713333),
          'wood',
          wallColor,
          { group },
        ),
      );
    }
  }

  // The lintel now rests on top of the shorter door jambs. Previously all
  // three occupied the same vertical volume, so the solver ejected them.
  result.push(
    body('wall-block', offset(origin, -2.92, 2.21, depth / 2), v(1.72, 3.78, 0.38), 'wood', wallColor, { group }),
    body('wall-block', offset(origin, 2.92, 2.21, depth / 2), v(1.72, 3.78, 0.38), 'wood', wallColor, { group }),
    body('beam', offset(origin, 0, 4.39, depth / 2), v(4.28, 0.56, 0.38), 'wood', COLOUR.darkWood, { group }),
  );

  for (const x of [-width / 2, width / 2]) {
    for (const z of [-depth / 2, depth / 2]) {
      result.push(
        body('beam', offset(origin, x, wallCenter, z), v(0.42, fullWallHeight, 0.42), 'wood', COLOUR.darkWood, { group }),
      );
    }
  }

  // Short front/back king posts carry the ridge. They sit on the lintel and
  // rear wall rather than relying on the two sloped boxes to balance on one
  // another's corners.
  for (const z of [-depth / 2, depth / 2]) {
    result.push(
      body('beam', offset(origin, 0, 5.063, z), v(0.38, 0.746, 0.38), 'wood', COLOUR.darkWood, { group }),
    );
  }

  // The rectangular roof halves meet along their lower ridge edges without
  // overlapping. Their eaves bear on the 4.68 m wall tops with a 1 cm seam.
  result.push(
    body('roof-section', offset(origin, -2.099, 5.196, 0), v(4.22, 0.26, depth + 0.58), 'wood', roofColor, {
      group,
      rotation: { z: 0.18 },
    }),
    body('roof-section', offset(origin, 2.099, 5.196, 0), v(4.22, 0.26, depth + 0.58), 'wood', roofColor, {
      group,
      rotation: { z: -0.18 },
    }),
  );

  return result;
}

/** A compact 15-piece shed/frame, useful in chain-reaction scenes. */
function frameBuilding(
  origin: Vec3,
  group: string,
  material: MaterialId,
  color: number,
): SpawnDefinition[] {
  const beamType = material === 'metal' ? 'metal-beam' : 'beam';
  const result: SpawnDefinition[] = [
    body('platform', offset(origin, -1.5, 0.18, 0), v(2.98, 0.36, 4.18), material, color, { group }),
    body('platform', offset(origin, 1.5, 0.18, 0), v(2.98, 0.36, 4.18), material, color, { group }),
  ];

  for (const x of [-2.75, 2.75]) {
    for (const z of [-1.9, 1.9]) {
      result.push(body(beamType, offset(origin, x, 2.485, z), v(0.3, 4.23, 0.3), material, color, { group }));
    }
  }

  result.push(
    body(beamType, offset(origin, 0, 4.76, -1.9), v(5.78, 0.3, 0.3), material, color, { group }),
    body(beamType, offset(origin, 0, 4.76, 1.9), v(5.78, 0.3, 0.3), material, color, { group }),
    // The rear infill shares the post plane but stops short of the posts and
    // rests on the floor. The old panels intersected both by up to 16 cm.
    body('wall-block', offset(origin, -1.733, 2.485, -1.9), v(1.706, 4.23, 0.26), material, color, { group }),
    body('wall-block', offset(origin, 0, 2.485, -1.9), v(1.706, 4.23, 0.26), material, color, { group }),
    body('wall-block', offset(origin, 1.733, 2.485, -1.9), v(1.706, 4.23, 0.26), material, color, { group }),
    // Raising the roof clears the upper beams while preserving the pitched
    // centre seam. Previously both halves began embedded in their supports.
    body('roof-section', offset(origin, -1.5, 5.16, 0), v(2.98, 0.24, 4.46), material, color, {
      group,
      rotation: { z: 0.08 },
    }),
    body('roof-section', offset(origin, 1.5, 5.16, 0), v(2.98, 0.24, 4.46), material, color, {
      group,
      rotation: { z: -0.08 },
    }),
  );

  // Stout king blocks give the pitched halves a second genuine contact point.
  // Their broad faces carry the roof without the deep contact compression of
  // the old 30 cm pegs, while keeping the two roof halves independently loose.
  for (const z of [-1.9, 1.9]) {
    result.push(body(beamType, offset(origin, 0, 5.035, z), v(0.62, 0.24, 0.62), material, color, { group }));
  }

  return result;
}

/** Seven loose bodies per storey plus four brittle footings. */
function tower(
  origin: Vec3,
  storeys: number,
  group: string,
  material: MaterialId,
  color: number,
): SpawnDefinition[] {
  const beamType = material === 'metal' ? 'metal-beam' : 'beam';
  const result: SpawnDefinition[] = [];
  const storeyHeight = 4;

  for (const x of [-2.05, 2.05]) {
    for (const z of [-2.05, 2.05]) {
      result.push(body('support-block', offset(origin, x, 0.28, z), v(0.68, 0.56, 0.68), material, color, { group }));
    }
  }

  for (let storey = 0; storey < storeys; storey += 1) {
    const floorY = storey * storeyHeight;
    // A thin deck bears directly on all four posts. The previous load path
    // stacked deck -> two headers -> four posts at every level; under a seven-
    // storey metal tower that accumulated enough contact compression to look
    // like a collapse before the player touched anything.
    result.push(body('platform', offset(origin, 0, floorY + 0.686, 0), v(4.68, 0.24, 4.68), material, color, { group }));

    for (const x of [-2, 2]) {
      for (const z of [-2, 2]) {
        result.push(body(beamType, offset(origin, x, floorY + 2.686, z), v(0.26, 3.748, 0.26), material, color, { group }));
      }
    }

    // Short floor rails preserve the open-frame silhouette and remain separate
    // physics pieces. They sit between (not through) the posts, so they do not
    // form an over-constrained collision stack.
    result.push(
      body(beamType, offset(origin, 0, floorY + 0.932, -2), v(3.7, 0.24, 0.24), material, color, { group }),
      body(beamType, offset(origin, 0, floorY + 0.932, 2), v(3.7, 0.24, 0.24), material, color, { group }),
    );
  }

  // A final roof deck rests on the last four posts. This also gives short towers
  // a real upper platform instead of leaving their top targets in mid-air.
  result.push(body('platform', offset(origin, 0, storeys * storeyHeight + 0.686, 0), v(4.68, 0.24, 4.68), material, color, { group }));

  return result;
}

function blockWall(
  origin: Vec3,
  columns: number,
  rows: number,
  group: string,
  material: MaterialId,
  color: number,
  blockWidth = 1.45,
): SpawnDefinition[] {
  const result: SpawnDefinition[] = [];
  for (let row = 0; row < rows; row += 1) {
    // Odd courses use one fewer full block, centred over the joints below.
    // Keeping the old block count created a half-block unsupported overhang at
    // both ends and made the top course peel away before play began.
    const rowColumns = row === 0 ? columns : Math.max(1, columns - 1);
    for (let column = 0; column < rowColumns; column += 1) {
      result.push(
        body(
          material === 'concrete' ? 'concrete-block' : 'wall-block',
          offset(origin, (column - (rowColumns - 1) / 2) * blockWidth, 0.51 + row * 1.01, 0),
          v(blockWidth - 0.08, 1, 0.7),
          material,
          color,
          { group },
        ),
      );
    }
  }
  return result;
}

/**
 * A small, readable chain-reaction target. The lintel has real contact support
 * and the volatile drum has an air gap on every side, so the setup remains
 * inert until the player hits it.
 */
function blastPocket(
  origin: Vec3,
  group: string,
  material: MaterialId = 'wood',
  color: number = COLOUR.honeyWood,
): SpawnDefinition[] {
  const supportType = material === 'metal' ? 'metal-beam' : material === 'concrete' ? 'concrete-block' : 'beam';
  const lintelType = material === 'concrete' ? 'concrete-block' : material === 'metal' ? 'metal-beam' : 'beam';
  return [
    body(supportType, offset(origin, -1.02, 0.76, 0), v(0.38, 1.52, 1.42), material, color, { group }),
    body(supportType, offset(origin, 1.02, 0.76, 0), v(0.38, 1.52, 1.42), material, color, { group }),
    body(lintelType, offset(origin, 0, 1.69, 0), v(2.42, 0.32, 1.42), material, color, { group }),
    body('explosive-barrel', offset(origin, 0, 0.66, 0), v(0.88, 1.3, 0.88), 'metal', COLOUR.redMetal, {
      group: `${group}-volatile`,
      label: 'Blast pocket',
    }),
  ];
}

/** Three loose crates arranged as a stable triangular pile. */
function cargoPile(origin: Vec3, group: string, color: number = COLOUR.honeyWood): SpawnDefinition[] {
  return [
    body('crate', offset(origin, -0.57, 0.53, 0), v(1.08, 1.06, 1.08), 'wood', color, { group }),
    body('crate', offset(origin, 0.57, 0.53, 0), v(1.08, 1.06, 1.08), 'wood', color, { group }),
    body('crate', offset(origin, 0, 1.6, 0), v(1.08, 1.06, 1.08), 'wood', color, { group }),
  ];
}

/** A 40-piece bridge: separate deck, rail, pier and under-beam bodies. */
function bridge(origin: Vec3, group: string): SpawnDefinition[] {
  const result: SpawnDefinition[] = [];
  const spans = 9;

  for (let span = 0; span < spans; span += 1) {
    const x = (span - 4) * 1.6;
    result.push(body('bridge-deck', offset(origin, x, 4.3, 0), v(1.5, 0.34, 4), 'wood', COLOUR.paleWood, { group }));
    if (span % 2 === 0) {
      for (const z of [-1.82, 1.82]) {
        result.push(body('beam', offset(origin, x, 5.105, z), v(0.22, 1.25, 0.22), 'wood', COLOUR.darkWood, { group }));
      }
    }
  }

  for (const z of [-1.82, 1.82]) {
    for (let segment = 0; segment < 3; segment += 1) {
      result.push(
        body('beam', offset(origin, -4.8 + segment * 4.8, 5.85, z), v(4.7, 0.22, 0.22), 'wood', COLOUR.redWood, { group }),
      );
    }
  }

  // Three balanced pier caps support three independent pairs of longitudinal
  // under-beams. Every deck tile now has a real load path to the ground.
  for (const x of [-4.8, 0, 4.8]) {
    result.push(
      body('support-block', offset(origin, x, 1.8, -1.2), v(0.75, 3.6, 0.75), 'concrete', COLOUR.concrete, { group }),
      body('support-block', offset(origin, x, 1.8, 1.2), v(0.75, 3.6, 0.75), 'concrete', COLOUR.concrete, { group }),
      body('concrete-block', offset(origin, x, 3.77, 0), v(2.2, 0.32, 3.4), 'concrete', COLOUR.concrete, { group }),
    );
  }

  for (const z of [-1.4, 1.4]) {
    for (let segment = 0; segment < 3; segment += 1) {
      result.push(body('metal-beam', offset(origin, -4.8 + segment * 4.8, 4.03, z), v(4.7, 0.18, 0.28), 'metal', COLOUR.metal, { group }));
    }
  }

  return result;
}

function springRange(origin: Vec3, group: string): SpawnDefinition[] {
  const result: SpawnDefinition[] = [
    body('platform', offset(origin, -7, 0.25, 0), v(5.5, 0.5, 5), 'metal', COLOUR.metal, { group, fixed: true }),
    body('ramp', offset(origin, -4.6, 1.05, 0), v(4.2, 0.35, 3.2), 'metal', COLOUR.yellowMetal, {
      group,
      fixed: true,
      rotation: { z: -0.3 },
    }),
    body('beam', offset(origin, -6.8, 0.75, -2), v(5, 0.25, 0.25), 'metal', COLOUR.darkMetal, { group, fixed: true }),
    body('beam', offset(origin, -6.8, 0.75, 2), v(5, 0.25, 0.25), 'metal', COLOUR.darkMetal, { group, fixed: true }),
  ];

  // Keep the backstop beyond the final stand. Its old centre at x=6 placed
  // several wall blocks directly through the second and third platforms.
  result.push(...blockWall(offset(origin, 13, 0, 0), 5, 2, `${group}-backstop`, 'wood', COLOUR.redWood));

  for (let stand = 0; stand < 3; stand += 1) {
    const x = 1.4 + stand * 3.1;
    const height = 1.2 + stand * 0.8;
    result.push(
      body('platform', offset(origin, x, height + 0.2, 0), v(2.3, 0.35, 2.5), 'wood', COLOUR.paleWood, { group }),
      body('beam', offset(origin, x - 0.8, height / 2, 0), v(0.3, height, 0.7), 'wood', COLOUR.darkWood, { group }),
      body('beam', offset(origin, x + 0.8, height / 2, 0), v(0.3, height, 0.7), 'wood', COLOUR.darkWood, { group }),
      body('spring-pad', offset(origin, -7.4 + stand * 1.1, 0.72, 0), v(0.8, 0.4, 0.8), 'metal', COLOUR.toyBlue, {
        group,
        fixed: true,
        label: `Spring socket ${stand + 1}`,
      }),
    );
  }

  for (const z of [-2.2, 2.2]) {
    result.push(
      body('rubber-bumper', offset(origin, 2.5, 0.65, z), v(1.1, 1.1, 0.6), 'rubber', COLOUR.rubber, { group }),
      body('rubber-bumper', offset(origin, 5.5, 1.05, z), v(1.1, 1.9, 0.6), 'rubber', COLOUR.rubber, { group }),
    );
  }

  return result;
}

function wreckingRig(origin: Vec3, group: string): SpawnDefinition[] {
  const result: SpawnDefinition[] = [];
  for (const x of [-3.5, 3.5]) {
    for (const z of [-2, 2]) {
      // Posts stand on the two concrete pads rather than beginning inside them.
      result.push(body('metal-beam', offset(origin, x, 3.81, z), v(0.42, 6.8, 0.42), 'metal', COLOUR.darkMetal, { group }));
    }
  }
  result.push(
    body('metal-beam', offset(origin, 0, 7.43, -2), v(7.5, 0.42, 0.42), 'metal', COLOUR.yellowMetal, { group }),
    body('metal-beam', offset(origin, 0, 7.43, 2), v(7.5, 0.42, 0.42), 'metal', COLOUR.yellowMetal, { group }),
    // The centre cross-member is stacked above the side headers instead of
    // occupying the same collider volume at all four intersections.
    body('metal-beam', offset(origin, 0, 7.85, 0), v(0.42, 0.42, 4.4), 'metal', COLOUR.yellowMetal, { group }),
    body('rope-anchor', offset(origin, 0, 7.2, 0), v(0.42, 0.42, 0.42), 'metal', COLOUR.redMetal, {
      group: `${group}-rope`,
      fixed: true,
      label: 'Cut or pull this rope',
    }),
    body('heavy-weight', offset(origin, -0.2, 3.2, 0), v(2.1, 2.1, 2.1), 'metal', COLOUR.darkMetal, {
      group: `${group}-rope`,
      label: 'Wrecking weight',
    }),
    body('platform', offset(origin, -3.5, 0.2, 0), v(3.4, 0.4, 4.8), 'concrete', COLOUR.concrete, { group, fixed: true }),
    body('platform', offset(origin, 3.5, 0.2, 0), v(3.4, 0.4, 4.8), 'concrete', COLOUR.concrete, { group, fixed: true }),
  );
  return result;
}

/** Fortress shell with a visible gate and four vulnerable corner towers. */
function castle(origin: Vec3, group: string): SpawnDefinition[] {
  const result: SpawnDefinition[] = [];
  const width = 12.6;
  const depth = 9;

  // The front wall stops before the tower columns. Four lower blocks form the
  // gate jambs; a broad upper lintel actually bears on both inner jambs.
  for (const x of [-3.6, -1.8, 1.8, 3.6]) {
    result.push(body('castle-block', offset(origin, x, 0.72, depth / 2), v(1.7, 1.42, 0.8), 'concrete', COLOUR.castleStone, { group }));
  }
  result.push(
    body('castle-block', offset(origin, -3.6, 2.15, depth / 2), v(1.7, 1.42, 0.8), 'concrete', COLOUR.castleStone, { group }),
    body('castle-block', offset(origin, 0, 2.15, depth / 2), v(5.2, 1.42, 0.8), 'concrete', COLOUR.castleStone, { group }),
    body('castle-block', offset(origin, 3.6, 2.15, depth / 2), v(1.7, 1.42, 0.8), 'concrete', COLOUR.castleStone, { group }),
  );

  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      result.push(
        body('castle-block', offset(origin, -3.6 + column * 1.8, 0.72 + row * 1.43, -depth / 2), v(1.7, 1.42, 0.8), 'concrete', COLOUR.castleStone, { group }),
      );
    }
  }

  for (const x of [-width / 2, width / 2]) {
    for (let section = 0; section < 3; section += 1) {
      result.push(
        body('castle-block', offset(origin, x, 1.45, -3 + section * 3), v(0.8, 2.8, 2.8), 'concrete', COLOUR.castleStone, { group }),
      );
    }
  }

  for (const x of [-width / 2, width / 2]) {
    for (const z of [-depth / 2, depth / 2]) {
      result.push(
        body('tower-platform', offset(origin, x, 3.635, z), v(3.2, 0.45, 3.2), 'concrete', COLOUR.blueConcrete, { group }),
      );
      for (const dx of [-1, 1]) {
        result.push(
          body('castle-column', offset(origin, x + dx, 1.705, z), v(0.65, 3.4, 0.65), 'concrete', COLOUR.castleStone, { group }),
        );
      }
      result.push(
        // The third support faces outward so it does not intersect the side wall.
        body('castle-column', offset(origin, x, 1.705, z + (z > 0 ? 1 : -1)), v(0.65, 3.4, 0.65), 'concrete', COLOUR.castleStone, { group }),
        body('parapet', offset(origin, x, 4.195, z), v(3.5, 0.65, 0.5), 'concrete', COLOUR.chalk, { group }),
      );
    }
  }

  return result;
}

function conveyorLine(origin: Vec3, count: number, group: string): SpawnDefinition[] {
  const result: SpawnDefinition[] = [];
  for (let index = 0; index < count; index += 1) {
    const x = (index - (count - 1) / 2) * 1.55;
    result.push(body('conveyor', offset(origin, x, 1.695, 0), v(1.48, 0.35, 2.2), 'metal', COLOUR.toyBlue, { group }));
    for (const z of [-0.8, 0.8]) {
      result.push(body('metal-beam', offset(origin, x, 0.96, z), v(0.22, 1.1, 0.22), 'metal', COLOUR.darkMetal, { group }));
    }
  }
  return result;
}

function factory(origin: Vec3, group: string): SpawnDefinition[] {
  const result: SpawnDefinition[] = [];

  for (let slab = 0; slab < 6; slab += 1) {
    result.push(
      body('platform', offset(origin, -6.25 + slab * 2.5, 0.2, 0), v(2.4, 0.4, 7), 'concrete', COLOUR.concrete, {
        group,
        // These are the factory foundation, not loose payload. Repeated piston
        // cycles used to fatigue the four middle slabs until the entire idle
        // machine line lost its ground support several seconds after loading.
        fixed: true,
      }),
    );
  }

  for (let bay = 0; bay < 4; bay += 1) {
    const x = -6 + bay * 4;
    for (const z of [-3, 3]) {
      result.push(body('metal-beam', offset(origin, x, 3.41, z), v(0.36, 6, 0.36), 'metal', COLOUR.darkMetal, { group }));
    }
    result.push(body('metal-beam', offset(origin, x, 6.6, 0), v(0.36, 0.36, 6.4), 'metal', COLOUR.yellowMetal, { group }));
  }

  result.push(...conveyorLine(offset(origin, 0, 0, 0), 7, `${group}-conveyor`));

  for (let index = 0; index < 3; index += 1) {
    result.push(
      body('piston', offset(origin, -4 + index * 4, 1.01, -2.05), v(1.2, 1.2, 2), 'metal', COLOUR.redMetal, {
        group: `${group}-pistons`,
        label: `Chain piston ${index + 1}`,
      }),
    );
  }

  for (let index = 0; index < 4; index += 1) {
    result.push(
      body('explosive-barrel', offset(origin, -4.5 + index * 3, 1.41, 2.15), v(1.1, 2, 1.1), 'metal', COLOUR.redMetal, {
        group: `${group}-barrels`,
        label: 'Volatile drum',
      }),
    );
  }

  for (const x of [-3.8, 3.8]) {
    result.push(
      body('rope-anchor', offset(origin, x, 6.05, 0), v(0.35, 0.35, 0.35), 'metal', COLOUR.yellowMetal, {
        group: `${group}-weight-${x}`,
        fixed: true,
      }),
      body('heavy-weight', offset(origin, x, 4.2, 0), v(1.45, 1.45, 1.45), 'metal', COLOUR.darkMetal, {
        group: `${group}-weight-${x}`,
      }),
    );
  }

  for (let panel = 0; panel < 3; panel += 1) {
    result.push(
      body('glass', offset(origin, -3 + panel * 3, 1.71, 3.08), v(2.65, 2.6, 0.16), 'glass', COLOUR.glass, { group }),
    );
  }

  return result;
}

function deliveryFort(origin: Vec3, group: string): SpawnDefinition[] {
  const result: SpawnDefinition[] = [];

  // A broad road points straight at a breakable depot gate. Keeping the gate
  // in the YZ plane makes the parked truck an immediately legible battering
  // ram instead of asking the player to construct one from tiny parts.
  for (let section = 0; section < 7; section += 1) {
    result.push(
      body('road-platform', offset(origin, -18 + section * 3, 0.12, 0), v(2.94, 0.24, 3.6), 'dirt', COLOUR.dirt, {
        group: `${group}-road`,
        fixed: true,
      }),
    );
  }

  for (const z of [-2.7, 2.7]) {
    for (let row = 0; row < 2; row += 1) {
      result.push(
        body('concrete-block', offset(origin, 0, 0.71 + row * 1.42, z), v(0.9, 1.4, 1.55), 'concrete', COLOUR.blueConcrete, { group }),
      );
    }
  }
  result.push(body('concrete-block', offset(origin, 0, 3.29, 0), v(0.9, 0.9, 4.95), 'concrete', COLOUR.chalk, { group }));

  // Side wings and cargo give the gate a readable silhouette and two alternate
  // collapse routes without closing the launch lane through the centre.
  for (const z of [-5.05, 5.05]) {
    for (let row = 0; row < 2; row += 1) {
      result.push(body('concrete-block', offset(origin, 0, 0.71 + row * 1.42, z), v(0.9, 1.4, 2.85), 'concrete', COLOUR.concrete, { group }));
    }
  }
  result.push(...cargoPile(offset(origin, 2.2, 0, -3.8), `${group}-cargo-a`, COLOUR.toyOrange));
  result.push(...cargoPile(offset(origin, 3.2, 0, 3.7), `${group}-cargo-b`, COLOUR.paleWood));
  return result;
}

/** A compact finale sampler that links two structures without exceeding low-quality body budgets. */
function finalArena(origin: Vec3, group: string): SpawnDefinition[] {
  const result: SpawnDefinition[] = [
    ...frameBuilding(offset(origin, -7, 0, -2), `${group}-house`, 'wood', COLOUR.toyOrange),
    ...tower(offset(origin, 7, 0, -2), 2, `${group}-tower`, 'metal', COLOUR.toyPurple),
  ];

  // Four broad, independently supported skywalk tiles make the link readable
  // while costing half as many bodies as the old seven-tile trestle.
  const skywalkSpans = [
    { x: -3.5, width: 2.58 },
    { x: -0.85, width: 2.58 },
    { x: 1.8, width: 2.58 },
    // A short landing stops before the tower deck instead of occupying the
    // same collider volume and being ejected upward at load.
    { x: 3.85, width: 1.42 },
  ];
  for (const [span, { x, width }] of skywalkSpans.entries()) {
    result.push(
      body('bridge-deck', offset(origin, x, 4.7, -2), v(width, 0.28, 2), 'wood', COLOUR.paleWood, {
        group: `${group}-skywalk`,
      }),
    );
    // Every tile has a real two-post load path and no hidden connector.
    const supportBottom = 0.01;
    const supportTop = 4.55;
    for (const z of [-2.65, -1.35]) {
      result.push(body('beam', offset(origin, x, (supportBottom + supportTop) * 0.5, z), v(0.24, supportTop - supportBottom, 0.24), 'wood', COLOUR.darkWood, {
        group: `${group}-skywalk`,
      }));
    }
    if (span === 1 || span === 3) {
      result.push(
        body('beam', offset(origin, x, 5.35, -2.85), v(0.24, 1, 0.24), 'wood', COLOUR.redWood, {
          group: `${group}-skywalk`,
        }),
      );
    }
  }

  result.push(
    body('piston', offset(origin, -2, 0.71, 5), v(1.4, 1.4, 2), 'metal', COLOUR.redMetal, { group: `${group}-machine` }),
    body('conveyor', offset(origin, 0, 0.21, 5), v(2.4, 0.4, 2), 'metal', COLOUR.toyBlue, { group: `${group}-machine` }),
    body('conveyor', offset(origin, 2.4, 0.21, 5), v(2.4, 0.4, 2), 'metal', COLOUR.toyBlue, { group: `${group}-machine` }),
    body('explosive-barrel', offset(origin, 2.2, 1.32, 5), v(1, 1.8, 1), 'metal', COLOUR.redMetal, { group: `${group}-machine` }),
    body('rope-anchor', offset(origin, 0, 7.5, 2), v(0.35, 0.35, 0.35), 'metal', COLOUR.yellowMetal, {
      group: `${group}-weight`,
      fixed: true,
    }),
    body('heavy-weight', offset(origin, 0, 4.5, 2), v(2, 2, 2), 'metal', COLOUR.darkMetal, { group: `${group}-weight` }),
  );
  return result;
}

export const LEVELS: LevelDefinition[] = [
  {
    id: 1,
    chapter: 1,
    chapterName: 'Backyard Mayhem',
    name: 'Knock Knock',
    subtitle: 'Three targets. Four stones. One flimsy hut.',
    description: 'Punch through the doorway, clip a corner post, or drop the roof onto every target.',
    thumbnail: {
      src: LEVEL_THUMBNAIL_PATHS[1],
      alt: 'Three blocky dummies wait inside a flimsy timber hut as a heavy ball flies toward the doorway.',
    },
    environment: 'backyard',
    phase: 'live',
    objects: [
      ...house(v(3, 0, 0), 'l1-hut'),
      enemy(v(1.2, 0.21, -1.2), 'dummy', 'Nod', 'l1-enemies'),
      enemy(v(3.2, 0.21, 1), 'dummy', 'Bonk', 'l1-enemies'),
      enemy(v(5.1, 0.21, -0.6), 'dummy', 'Clunk', 'l1-enemies'),
    ],
    loadout: { 'heavy-ball': 4 },
    tools: ['grab', 'rotate'],
    star2: { kind: 'items', value: 2, label: 'Use no more than 2 heavy balls' },
    star3: { kind: 'time', value: 35, label: 'Finish in 35 seconds' },
    camera: { position: v(-14, 9, 15), target: v(3, 2.2, 0) },
    hint: 'Aim low for a support or straight through the doorway.',
    reward: { label: 'Heavy Ball Pair', items: { 'heavy-ball': 2 } },
    unlock: 'Sandbox + Concrete Block',
  },
  {
    id: 2,
    chapter: 1,
    chapterName: 'Backyard Mayhem',
    name: 'Bad Foundation',
    subtitle: 'A tall stack with two very obvious bad ideas.',
    description: 'Break a footing directly or hit either red blast pocket to fold the occupied tower sideways.',
    thumbnail: {
      src: LEVEL_THUMBNAIL_PATHS[2],
      alt: 'A tall wooden tower leans above tiny supports while a concrete block charges its base.',
    },
    environment: 'backyard',
    phase: 'live',
    objects: [
      ...tower(v(4, 0, 0), 3, 'l2-tower', 'wood', COLOUR.paleWood),
      ...blastPocket(v(0.4, 0, 0), 'l2-blast-left', 'wood', COLOUR.redWood),
      ...blastPocket(v(7.6, 0, 0), 'l2-blast-right', 'wood', COLOUR.redWood),
      enemy(v(2.7, 4.73, -0.8), 'worker', 'Foreman Flip', 'l2-enemies'),
      enemy(v(5.2, 4.73, 0.8), 'dummy', 'Brace', 'l2-enemies'),
      enemy(v(2.8, 8.73, 1), 'dummy', 'Joist', 'l2-enemies'),
      enemy(v(5, 8.71, -1), 'heavy', 'Big Timber', 'l2-enemies'),
    ],
    loadout: { 'heavy-ball': 3, 'concrete-block': 1 },
    tools: ['grab', 'push', 'rotate'],
    star2: { kind: 'time', value: 50, label: 'Topple the tower in 50 seconds' },
    star3: { kind: 'destruction', value: 55, label: 'Break at least 55% of the tower' },
    camera: { position: v(-14, 10, 17), target: v(4, 4.2, 0) },
    hint: 'The red pockets flank the weak feet; either side can start the fall.',
    reward: { label: 'Block Pistol', items: { pistol: 1 } },
    unlock: 'Giant Hammer',
  },
  {
    id: 3,
    chapter: 1,
    chapterName: 'Backyard Mayhem',
    name: 'Barrel Trouble',
    subtitle: 'A wall, two drums, and a parked battering ram.',
    description: 'Detonate a front drum, drive the loose car into the screen, or punch a clean hole through the blocks.',
    thumbnail: {
      src: LEVEL_THUMBNAIL_PATHS[3],
      alt: 'Red explosive barrels erupt beside a concrete wall with startled characters behind it.',
    },
    environment: 'yard',
    phase: 'live',
    objects: [
      ...blockWall(v(3, 0, 0), 6, 3, 'l3-wall', 'concrete', COLOUR.chalk),
      body('support-block', v(-2, 1.25, 0), v(0.8, 2.5, 1.8), 'concrete', COLOUR.blueConcrete, { group: 'l3-wall' }),
      body('support-block', v(8, 1.25, 0), v(0.8, 2.5, 1.8), 'concrete', COLOUR.blueConcrete, { group: 'l3-wall' }),
      body('explosive-barrel', v(0.1, 0.66, 1.2), v(0.88, 1.3, 0.88), 'metal', COLOUR.redMetal, { group: 'l3-blast-left', label: 'Left breach drum' }),
      body('explosive-barrel', v(5.9, 0.66, 1.2), v(0.88, 1.3, 0.88), 'metal', COLOUR.redMetal, { group: 'l3-blast-right', label: 'Right breach drum' }),
      ...createParkedCar(v(3, 0, 6), 'l3-battering-car', { yaw: Math.PI / 2, color: COLOUR.toyBlue, accentColor: COLOUR.yellowMetal }),
      enemy(v(0.8, 0.65, -2.3), 'dummy', 'Tin Hat', 'l3-enemies'),
      enemy(v(2.8, 0.65, -2.5), 'armored', 'Shieldy', 'l3-enemies'),
      enemy(v(5, 0.65, -2.2), 'dummy', 'Fuse', 'l3-enemies'),
      enemy(v(7, 0.65, -2.6), 'worker', 'Drum', 'l3-enemies'),
    ],
    loadout: { 'explosive-projectile': 2, 'heavy-ball': 2 },
    tools: ['grab', 'rotate', 'push'],
    star2: { kind: 'items', value: 2, label: 'Use at most 2 items' },
    star3: { kind: 'time', value: 40, label: 'Clear the wall in 40 seconds' },
    camera: { position: v(-12, 8, 16), target: v(3, 1.8, 0.6) },
    hint: 'Shoot a drum for a breach, or hit the car squarely and let mass do it.',
    reward: { label: 'Toy Bomb', items: { bomb: 1 } },
    unlock: 'Explosive Barrel',
  },
  {
    id: 4,
    chapter: 1,
    chapterName: 'Backyard Mayhem',
    name: 'Domino House',
    subtitle: 'Three frames, one car, and a chain-reaction pocket.',
    description: 'Launch the parked car into the first frame or blow the shared gap so the row collapses in either direction.',
    thumbnail: {
      src: LEVEL_THUMBNAIL_PATHS[4],
      alt: 'Three colorful narrow houses topple into one another like giant dominoes.',
    },
    environment: 'backyard',
    phase: 'live',
    objects: [
      ...frameBuilding(v(-4.5, 0, 0), 'l4-house-a', 'wood', COLOUR.honeyWood),
      ...frameBuilding(v(2, 0, 0), 'l4-house-b', 'wood', COLOUR.redWood),
      ...frameBuilding(v(8.5, 0, 0), 'l4-house-c', 'wood', COLOUR.toyOrange),
      ...createParkedCar(v(-11.5, 0, 0), 'l4-domino-car', { color: COLOUR.toyGreen, accentColor: COLOUR.paleWood }),
      ...blastPocket(v(5.25, 0, 3.1), 'l4-shared-blast', 'wood', COLOUR.darkWood),
      enemy(v(-4.5, 0.7, 0.8), 'dummy', 'Lefty', 'l4-enemies'),
      enemy(v(1.3, 0.7, -0.8), 'worker', 'Middle Management', 'l4-enemies'),
      enemy(v(3, 0.7, 0.8), 'dummy', 'Other Middle', 'l4-enemies'),
      enemy(v(7.8, 0.7, -0.7), 'heavy', 'Last One', 'l4-enemies'),
      enemy(v(9.2, 0.7, 0.8), 'dummy', 'Almost Last', 'l4-enemies'),
    ],
    loadout: { 'heavy-ball': 2, 'explosive-projectile': 1, 'concrete-block': 1 },
    tools: ['grab', 'rotate', 'push'],
    star2: { kind: 'items', value: 1, label: 'Start the chain with only 1 item' },
    star3: { kind: 'time', value: 45, label: 'Finish in 45 seconds' },
    camera: { position: v(-18, 11, 20), target: v(1, 2.3, 0.5) },
    hint: 'The car starts the left-to-right route; the red pocket starts in the middle.',
    reward: { label: 'Utility Knife', items: { knife: 1 } },
    unlock: 'Power Spring',
  },
  {
    id: 5,
    chapter: 2,
    chapterName: 'Machine Trouble',
    name: 'Spring Cleaning',
    subtitle: 'A stepped ricochet range with a red finish line.',
    description: 'Bank metal and rubber balls through the three stands, or detonate the drum beside the backstop.',
    thumbnail: {
      src: LEVEL_THUMBNAIL_PATHS[5],
      alt: 'Metal balls bounce from bright springs toward characters on a stepped workshop range.',
    },
    environment: 'workshop',
    phase: 'live',
    objects: [
      ...springRange(v(0, 0, 0), 'l5-range'),
      body('explosive-barrel', v(13, 0.66, 1.15), v(0.88, 1.3, 0.88), 'metal', COLOUR.redMetal, {
        group: 'l5-backstop-blast',
        label: 'Backstop drum',
      }),
      ...cargoPile(v(10.2, 0, -2.8), 'l5-range-cargo', COLOUR.toyBlue),
      enemy(v(1.4, 1.47, 0), 'dummy', 'Short Hop', 'l5-enemies'),
      enemy(v(4.5, 2.27, 0), 'worker', 'Double Bounce', 'l5-enemies'),
      enemy(v(7.6, 3.07, 0), 'armored', 'Backstop', 'l5-enemies'),
      enemy(v(0, -0.1, -2.5), 'dummy', 'Ricochet', 'l5-enemies'),
    ],
    loadout: { 'metal-ball': 4, ball: 2, spring: 1 },
    tools: ['grab', 'rotate', 'push'],
    star2: { kind: 'items', value: 5, label: 'Use no more than 5 pieces' },
    star3: { kind: 'time', value: 60, label: 'Clean the range in 60 seconds' },
    camera: { position: v(-15, 10, 17), target: v(0.5, 2, 0) },
    hint: 'The yellow ramp gives a low bank shot; the red drum clears the high end.',
    reward: { label: 'Scattergun', items: { shotgun: 1 } },
    unlock: 'Powerful Spring',
  },
  {
    id: 6,
    chapter: 2,
    chapterName: 'Machine Trouble',
    name: 'Wrecking Ball',
    subtitle: 'One hanging weight, one workshop, one loaded truck.',
    description: 'Drive a shot into the weight, the frame supports, or the truck cargo and follow the aftermath by hand.',
    thumbnail: {
      src: LEVEL_THUMBNAIL_PATHS[6],
      alt: 'A huge hanging wrecking ball swings toward an occupied wooden workshop frame.',
    },
    environment: 'workshop',
    phase: 'live',
    objects: [
      ...wreckingRig(v(-4, 0, 0), 'l6-rig'),
      ...frameBuilding(v(5.5, 0, 0), 'l6-workshop', 'wood', COLOUR.toyGreen),
      ...createIndustrialTruck(v(11.8, 0, 4.6), 'l6-yard-truck', {
        color: COLOUR.toyOrange,
        accentColor: COLOUR.yellowMetal,
        hazardousCargo: true,
      }),
      enemy(v(4.1, 0.7, -0.8), 'worker', 'Hard Hat Hal', 'l6-enemies'),
      enemy(v(6.7, 0.7, 0.8), 'dummy', 'Pendulum Pete', 'l6-enemies'),
      enemy(v(4.4, 5.21, 0.7), 'dummy', 'Rafter', 'l6-enemies'),
      // One lightweight roof target is stable; the heavy belongs on the slab.
      // Two sleeping ragdolls on opposite pitched halves woke each other after
      // several seconds and slowly walked the loose roof off its supports.
      enemy(v(6.6, 0.26, -0.7), 'heavy', 'Counterweight', 'l6-enemies'),
      enemy(v(10.2, 0.05, 2.6), 'worker', 'Truck Spotter', 'l6-enemies'),
    ],
    loadout: { 'explosive-projectile': 2, 'heavy-ball': 2 },
    tools: ['grab', 'rotate', 'push'],
    star2: { kind: 'items', value: 1, label: 'Use only 1 loadout item' },
    star3: { kind: 'time', value: 45, label: 'Land the swing in 45 seconds' },
    camera: { position: v(-18, 12, 21), target: v(2, 3.6, 1) },
    hint: 'Hit the weight off-centre for a swing, or light the drums in the truck bed.',
    reward: { label: 'Boom Shell', items: { 'explosive-projectile': 1 } },
    unlock: 'Heavy Weight',
  },
  {
    id: 7,
    chapter: 2,
    chapterName: 'Machine Trouble',
    name: 'Delivery Problem',
    subtitle: 'The truck is built. The depot gate is not ready.',
    description: 'Launch the parked truck through the gate, pop its cargo, or break either gatepost with a direct shot.',
    thumbnail: {
      src: LEVEL_THUMBNAIL_PATHS[7],
      alt: 'A homemade powered cart barrels toward a depot wall and a stack of packages.',
    },
    environment: 'yard',
    phase: 'live',
    objects: [
      ...deliveryFort(v(5, 0, 0), 'l7-depot'),
      ...createIndustrialTruck(v(-7, 0.24, 0), 'l7-delivery-truck', {
        color: COLOUR.yellowMetal,
        accentColor: COLOUR.toyBlue,
        hazardousCargo: true,
      }),
      enemy(v(7.1, 0.05, -1.6), 'worker', 'Receiver', 'l7-enemies'),
      enemy(v(8.7, 0.05, 1.6), 'armored', 'Returns Desk', 'l7-enemies'),
      enemy(v(7.1, 2.06, -3.8), 'dummy', 'Signature', 'l7-enemies'),
      enemy(v(10.2, 0.05, 0), 'heavy', 'Fragile', 'l7-enemies'),
    ],
    loadout: { 'heavy-ball': 3, 'explosive-projectile': 1 },
    tools: ['grab', 'rotate', 'push'],
    star2: { kind: 'items', value: 3, label: 'Make the delivery in at most 3 shots' },
    star3: { kind: 'time', value: 65, label: 'Clear the depot in 65 seconds' },
    camera: { position: v(-19, 10, 18), target: v(-1, 1.7, 0) },
    hint: 'A square hit on the cab sends the whole loose truck toward the gate.',
    reward: { label: 'Block Machete', items: { machete: 1 } },
    unlock: 'Motor + Giant Wheel',
  },
  {
    id: 8,
    chapter: 2,
    chapterName: 'Machine Trouble',
    name: 'Bridge Disaster',
    subtitle: 'Traffic report: a car is parked over two blastable piers.',
    description: 'Drop a chosen span, use the loose car as a ram, and keep the tourist outside the collapse zone.',
    thumbnail: {
      src: LEVEL_THUMBNAIL_PATHS[8],
      alt: 'A cracked bridge folds around block characters while a tourist watches from a safe distance.',
    },
    environment: 'yard',
    phase: 'live',
    objects: [
      ...bridge(v(2, 0, 0), 'l8-bridge'),
      ...createParkedCar(v(2, 4.48, 0), 'l8-bridge-car', { color: COLOUR.redMetal, accentColor: COLOUR.chalk }),
      body('explosive-barrel', v(-2.8, 0.66, 0), v(0.88, 1.3, 0.88), 'metal', COLOUR.redMetal, { group: 'l8-west-pier-blast', label: 'West pier drum' }),
      body('explosive-barrel', v(6.8, 0.66, 0), v(0.88, 1.3, 0.88), 'metal', COLOUR.redMetal, { group: 'l8-east-pier-blast', label: 'East pier drum' }),
      enemy(v(-3.8, 4.37, 0), 'worker', 'Westbound', 'l8-enemies'),
      enemy(v(7.2, 4.37, -0.4), 'armored', 'Eastbound', 'l8-enemies'),
      enemy(v(-1.5, 0.05, -0.7), 'monster', 'Under Troll', 'l8-enemies'),
      enemy(v(10.5, 0.05, 0.2), 'heavy', 'Pier Pressure', 'l8-enemies'),
      friend(v(-7.8, 0.05, 3), 'Lost Tourist', 'l8-friendly'),
    ],
    loadout: { 'heavy-ball': 3, 'explosive-projectile': 1 },
    tools: ['grab', 'push', 'rotate', 'rope'],
    star2: { kind: 'friendly', value: 1, label: 'Keep the tourist safe' },
    star3: { kind: 'items', value: 2, label: 'Use no more than 2 items' },
    camera: { position: v(-17, 12, 21), target: v(2, 3, 0) },
    hint: 'The red drums sit between each pier pair; choose which half drops.',
    reward: { label: 'Workshop Rifle', items: { rifle: 1 } },
    unlock: 'Magnet',
  },
  {
    id: 9,
    chapter: 3,
    chapterName: 'Big Mess',
    name: 'Castle Crash',
    subtitle: 'A loose tank faces a fortress full of powder.',
    description: 'Drive shots through the tank, gate, corner towers, or courtyard drums and choose where the fortress opens.',
    thumbnail: {
      src: LEVEL_THUMBNAIL_PATHS[9],
      alt: 'A blocky tank fires toward a moonlit castle defended by toy knights and explosive powder drums.',
    },
    environment: 'castle',
    phase: 'live',
    objects: [
      ...castle(v(4, 0, 0), 'l9-castle'),
      ...createParkedTank(v(-10.7, 0, 2), 'l9-siege-tank', { color: COLOUR.toyGreen, accentColor: COLOUR.yellowMetal }),
      body('explosive-barrel', v(2.1, 0.66, -0.4), v(0.88, 1.3, 0.88), 'metal', COLOUR.redMetal, { group: 'l9-powder-left', label: 'West powder drum' }),
      body('explosive-barrel', v(6.2, 0.66, 0.3), v(0.88, 1.3, 0.88), 'metal', COLOUR.redMetal, { group: 'l9-powder-right', label: 'East powder drum' }),
      enemy(v(4, 0.65, 1.8), 'knight', 'Gate Guard', 'l9-enemies'),
      enemy(v(0, 0.65, -2), 'knight', 'Left Knight', 'l9-enemies'),
      enemy(v(8, 0.65, -2), 'armored', 'Right Knight', 'l9-enemies'),
      // Stand behind the parapets instead of spawning the ragdoll feet inside
      // their brittle top blocks. The tower decks have ample depth here.
      enemy(v(-2.2, 3.76, 5.35), 'dummy', 'West Lookout', 'l9-enemies'),
      enemy(v(10.2, 3.76, 5.35), 'knight', 'East Lookout', 'l9-enemies'),
      enemy(v(10.2, 3.73, -5.35), 'heavy', 'The Castellan', 'l9-enemies'),
    ],
    loadout: { 'explosive-projectile': 3, 'metal-ball': 3 },
    tools: ['grab', 'push', 'rotate'],
    star2: { kind: 'items', value: 4, label: 'Win with at most 4 shots' },
    star3: { kind: 'destruction', value: 60, label: 'Demolish 60% of the fortress' },
    camera: { position: v(-21, 13, 23), target: v(2, 2.2, 0.8) },
    hint: 'The tank is loose cover; the two courtyard drums split the fortress into left and right routes.',
    reward: { label: 'Rocket', items: { rocket: 1 } },
    unlock: 'Cannon',
  },
  {
    id: 10,
    chapter: 3,
    chapterName: 'Big Mess',
    name: 'Factory Accident',
    subtitle: 'A loaded machine line with a truck parked in front.',
    description: 'Hit a piston, belt drum, hanging weight, or the loose truck and let the factory chain reaction develop.',
    thumbnail: {
      src: LEVEL_THUMBNAIL_PATHS[10],
      alt: 'Conveyors, pistons, explosive drums, and hanging weights trigger a chaotic factory chain reaction.',
    },
    environment: 'factory',
    phase: 'live',
    objects: [
      ...factory(v(2, 0, 0), 'l10-factory'),
      ...createIndustrialTruck(v(-9, 0, 5.8), 'l10-shift-truck', {
        color: COLOUR.toyBlue,
        accentColor: COLOUR.yellowMetal,
      }),
      // The belts are intentionally live machinery, so sleeping actors on top
      // of them wake and kick the unsupported machine line apart at load. Keep
      // the shift crew staged in the clear yard beside the factory instead.
      enemy(v(-2, 0.05, 4.8), 'worker', 'Belt Inspector', 'l10-enemies'),
      enemy(v(2, 0.65, -4.7), 'armored', 'Safety Officer', 'l10-enemies'),
      enemy(v(6, 0.05, 4.8), 'worker', 'Night Shift', 'l10-enemies'),
      // Keep the heavy's compound feet clear of the fourth volatile drum. The
      // old pose overlapped it at load and could detonate the factory at idle.
      enemy(v(8.2, 0.28, 1.8), 'heavy', 'Forklift Frank', 'l10-enemies'),
      enemy(v(9.5, 0.65, -4.7), 'monster', 'Breakroom Thing', 'l10-enemies'),
    ],
    loadout: { 'explosive-projectile': 3, 'heavy-ball': 2 },
    tools: ['grab', 'push', 'rotate'],
    star2: { kind: 'items', value: 2, label: 'Start the accident with 2 items' },
    star3: { kind: 'time', value: 75, label: 'Shut down the shift in 75 seconds' },
    camera: { position: v(-20, 13, 22), target: v(1, 2.8, 1.2) },
    hint: 'The red drums and hanging weights offer separate left, centre, and right chain reactions.',
    reward: { label: 'Fire Axe', items: { axe: 1 } },
    unlock: 'Piston + Conveyor',
  },
  {
    id: 11,
    chapter: 3,
    chapterName: 'Big Mess',
    name: 'Tower Trouble',
    subtitle: 'Seven storeys, four feet, and a tank at street level.',
    description: 'Use the tank as cover or debris, light either flank drum, or attack a repeating tower bay directly.',
    thumbnail: {
      src: LEVEL_THUMBNAIL_PATHS[11],
      alt: 'A seven-storey metal tower buckles at its tiny feet with characters stranded on upper floors.',
    },
    environment: 'yard',
    phase: 'live',
    objects: [
      ...tower(v(3, 0, 0), 7, 'l11-tower', 'metal', COLOUR.blueConcrete),
      ...createParkedTank(v(-4.3, 0, 0), 'l11-yard-tank', { color: COLOUR.darkMetal, accentColor: COLOUR.redMetal }),
      body('explosive-barrel', v(1, 0.66, 3.1), v(0.88, 1.3, 0.88), 'metal', COLOUR.redMetal, { group: 'l11-south-charge', label: 'South footing charge' }),
      body('explosive-barrel', v(5, 0.66, -3.1), v(0.88, 1.3, 0.88), 'metal', COLOUR.redMetal, { group: 'l11-north-charge', label: 'North footing charge' }),
      enemy(v(2, 4.73, -0.8), 'dummy', 'Third Floor', 'l11-enemies'),
      enemy(v(4, 8.73, 0.8), 'worker', 'Fifth Floor', 'l11-enemies'),
      enemy(v(2, 12.72, 0.8), 'armored', 'Middle Manager', 'l11-enemies'),
      enemy(v(4, 16.73, -0.8), 'dummy', 'Upper Middle', 'l11-enemies'),
      // The heavy needs the open roof deck; its 1.2x head otherwise clips the
      // next storey and kicks the entire dry stack sideways on the first step.
      enemy(v(3, 28.71, 0), 'heavy', 'Penthouse', 'l11-enemies'),
      enemy(v(4, 24.73, 0.8), 'monster', 'Roof Creature', 'l11-enemies'),
    ],
    loadout: { rocket: 2, 'heavy-ball': 2 },
    tools: ['grab', 'rotate', 'push'],
    star2: { kind: 'items', value: 3, label: 'Use no more than 3 items' },
    star3: { kind: 'destruction', value: 65, label: 'Collapse 65% of the tower' },
    camera: { position: v(-22, 20, 28), target: v(2, 11, 0) },
    hint: 'A low rocket into either red drum removes a different pair of feet.',
    reward: { label: 'Yard Spear', items: { spear: 1 } },
    unlock: 'Rockets',
  },
  {
    id: 12,
    chapter: 3,
    chapterName: 'Big Mess',
    name: 'EVERYTHING MUST GO',
    subtitle: 'House, tower, skywalk, machines, tank, car. Pick a route.',
    description: 'Start from either vehicle, the hanging weight, the skywalk, or the machine drum and finish the compact yard your way.',
    thumbnail: {
      src: LEVEL_THUMBNAIL_PATHS[12],
      alt: 'A sprawling house, tower, skywalk, and factory machine line collapse together in a spectacular finale.',
    },
    environment: 'factory',
    phase: 'live',
    objects: [
      ...finalArena(v(2, 0, 0), 'l12-arena'),
      ...createParkedTank(v(-11, 0, 5), 'l12-finale-tank', { color: COLOUR.toyGreen, accentColor: COLOUR.yellowMetal }),
      ...createParkedCar(v(11, 0, 3.2), 'l12-finale-car', { color: COLOUR.toyPurple, accentColor: COLOUR.chalk }),
      enemy(v(-5, 0.28, -1.2), 'worker', 'House Guest', 'l12-enemies'),
      enemy(v(7.8, 4.72, -2.8), 'armored', 'Tower Guard', 'l12-enemies'),
      enemy(v(9, 8.71, -1.2), 'heavy', 'Top Shelf', 'l12-enemies'),
      enemy(v(2, 0.05, 7), 'monster', 'Belt Gremlin', 'l12-enemies'),
      enemy(v(6.8, 0.05, 4), 'knight', 'Final Boss-ish', 'l12-enemies'),
      friend(v(-11.5, 0.05, -3.5), 'Clipboard Kid', 'l12-friendly'),
    ],
    loadout: {
      rocket: 2,
      'explosive-projectile': 2,
      'heavy-ball': 2,
    },
    tools: ['grab', 'rotate', 'push'],
    star2: { kind: 'friendly', value: 1, label: 'Keep Clipboard Kid standing' },
    star3: { kind: 'time', value: 90, label: 'Finish the big mess in 90 seconds' },
    camera: { position: v(-24, 15, 27), target: v(1, 3.5, 1) },
    hint: 'Vehicles frame the sides; the hanging weight and red machine drum control the centre.',
    reward: { label: 'Victory Ammo Cache', items: { 'ammo-box': 1 } },
    unlock: 'All Toys + Golden Wrecker Skin',
  },
];

export const CAMPAIGN_LEVELS = LEVELS;

/** Combines mission supplies with each persistent reward already earned. */
export function createCampaignLoadout(
  level: LevelDefinition,
  completed: Readonly<Record<number, LevelResult>>,
): Record<string, number> {
  const loadout = { ...level.loadout };
  for (const completedLevel of LEVELS) {
    if ((completed[completedLevel.id]?.stars ?? 0) <= 0) continue;
    for (const [itemId, count] of Object.entries(completedLevel.reward.items)) {
      const supply = Math.max(0, Math.floor(count));
      if (supply > 0) loadout[itemId] = (loadout[itemId] ?? 0) + supply;
    }
  }
  return loadout;
}

export const CHAPTERS = [
  { id: 1, name: 'Backyard Mayhem', levels: LEVELS.slice(0, 4) },
  { id: 2, name: 'Machine Trouble', levels: LEVELS.slice(4, 8) },
  { id: 3, name: 'Big Mess', levels: LEVELS.slice(8, 12) },
] as const;

export function getLevelById(id: number): LevelDefinition | undefined {
  return LEVELS.find((level) => level.id === id);
}

export default LEVELS;
