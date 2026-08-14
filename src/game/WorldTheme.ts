import * as THREE from 'three';
import type { LevelDefinition } from './types';

export type EnvironmentKind = LevelDefinition['environment'];
export type PixelMapId = 'grass' | 'soil' | 'sand' | 'concrete' | 'factory' | 'night-grid';

export const PIXEL_MAP_URLS: Readonly<Record<PixelMapId, string>> = {
  grass: '/textures/pixel/maps/grass-pixel-v2.png',
  soil: '/textures/pixel/maps/soil-pixel-v2.png',
  sand: '/textures/pixel/maps/sand-pixel-v2.png',
  concrete: '/textures/pixel/maps/concrete-pixel-v2.png',
  factory: '/textures/pixel/maps/factory-pixel-v2.png',
  'night-grid': '/textures/pixel/maps/night-grid-pixel-v2.png',
};

export interface WorldThemeResult {
  sky: THREE.Color;
  fog: THREE.Fog;
  groundColor: THREE.Color;
  groundMap: THREE.Texture;
  pixelMaps: Readonly<Record<PixelMapId, THREE.Texture>>;
  dispose: () => void;
}

interface ThemePalette {
  sky: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  ground: number;
  groundMap: PixelMapId;
  wood: number;
  foliage: number;
  foliageDark: number;
  structure: number;
  structureDark: number;
  accent: number;
  glow: number;
}

interface Transform {
  position: [number, number, number];
  scale?: [number, number, number];
  rotation?: [number, number, number];
}

interface ThemeBuildContext {
  group: THREE.Group;
  maps: Record<PixelMapId, THREE.Texture>;
  palette: ThemePalette;
  box: THREE.BoxGeometry;
  cylinder: THREE.CylinderGeometry;
  rock: THREE.DodecahedronGeometry;
  materials: Set<THREE.Material>;
  geometries: Set<THREE.BufferGeometry>;
}

type ThemeMappedMaterial = THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;

const PALETTES: Record<EnvironmentKind, ThemePalette> = {
  backyard: {
    sky: 0x75c6d2,
    fog: 0xb7ddd0,
    fogNear: 36,
    fogFar: 78,
    ground: 0x8db45a,
    groundMap: 'grass',
    wood: 0xb86f3e,
    foliage: 0x79a944,
    foliageDark: 0x3e763e,
    structure: 0xe2bd72,
    structureDark: 0x76513a,
    accent: 0xffd052,
    glow: 0xffec8d,
  },
  yard: {
    sky: 0x76b6c2,
    fog: 0xadc8bd,
    fogNear: 34,
    fogFar: 74,
    ground: 0x99865d,
    groundMap: 'soil',
    wood: 0x95603d,
    foliage: 0x668b48,
    foliageDark: 0x3c6141,
    structure: 0xa8a48d,
    structureDark: 0x4c5b5d,
    accent: 0xe9b83f,
    glow: 0xffd85c,
  },
  workshop: {
    sky: 0x71858e,
    fog: 0x9da7a3,
    fogNear: 31,
    fogFar: 68,
    ground: 0x777b70,
    groundMap: 'concrete',
    wood: 0x9b623d,
    foliage: 0x6e8250,
    foliageDark: 0x43583b,
    structure: 0x849295,
    structureDark: 0x364447,
    accent: 0xf1b93c,
    glow: 0xffcf58,
  },
  factory: {
    sky: 0x65747e,
    fog: 0x8f9996,
    fogNear: 29,
    fogFar: 66,
    ground: 0x4d5853,
    groundMap: 'factory',
    wood: 0x785441,
    foliage: 0x5f714a,
    foliageDark: 0x394b3d,
    structure: 0x68777a,
    structureDark: 0x29373c,
    accent: 0xf2b735,
    glow: 0xff674a,
  },
  castle: {
    sky: 0x7589a8,
    fog: 0x9aa5b4,
    fogNear: 34,
    fogFar: 73,
    ground: 0x4c5960,
    groundMap: 'night-grid',
    wood: 0x77523c,
    foliage: 0x50694b,
    foliageDark: 0x34463c,
    structure: 0x879398,
    structureDark: 0x3d4b56,
    accent: 0xc84d55,
    glow: 0xffb84f,
  },
};

/**
 * Adds original, non-physical map dressing around the playable center of a level.
 * The returned colors/map are intended to be applied to the scene and ground mesh
 * by the caller. Pixel art comes exclusively from image assets; this module only
 * composes ordinary low-poly geometry.
 */
export function buildWorldTheme(group: THREE.Group, kind: EnvironmentKind): WorldThemeResult {
  const previousDispose = group.userData.worldThemeDispose;
  if (typeof previousDispose === 'function') previousDispose();

  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  const loader = new THREE.TextureLoader();
  const maps = {} as Record<PixelMapId, THREE.Texture>;

  for (const id of Object.keys(PIXEL_MAP_URLS) as PixelMapId[]) {
    maps[id] = loadPixelMap(loader, PIXEL_MAP_URLS[id], 2, textures);
  }

  // Ground uses its own transform so prop materials retain chunky, readable texels.
  const palette = PALETTES[kind];
  const groundMap = loadPixelMap(loader, PIXEL_MAP_URLS[palette.groundMap], 18, textures);
  groundMap.name = `pixel-ground-${kind}`;

  const box = ownGeometry(new THREE.BoxGeometry(1, 1, 1), geometries);
  const cylinder = ownGeometry(new THREE.CylinderGeometry(1, 1, 1, 8, 1, false), geometries);
  const rock = ownGeometry(new THREE.DodecahedronGeometry(1, 0), geometries);
  const context: ThemeBuildContext = { group, maps, palette, box, cylinder, rock, materials, geometries };

  group.name ||= `world-theme-${kind}`;
  group.userData.ignorePick = true;

  if (kind === 'backyard') buildBackyard(context);
  if (kind === 'yard') buildYard(context);
  if (kind === 'workshop') buildWorkshop(context);
  if (kind === 'factory') buildFactory(context);
  if (kind === 'castle') buildCastle(context);

  const dispose = (): void => {
    if (group.userData.worldThemeDisposed) return;
    group.userData.worldThemeDisposed = true;
    group.clear();
    geometries.forEach((geometry) => geometry.dispose());
    // Detach shared users (notably PhysicsWorld's ground material) before the
    // texture is disposed. A late image-load callback must never put an old
    // level's map back onto a material that already belongs to the next level.
    textures.forEach((texture) => {
      texture.userData.pixelMapDisposed = true;
      const users = texture.userData.pixelMapUsers as Set<ThemeMappedMaterial> | undefined;
      users?.forEach((user) => {
        if (user.map !== texture) return;
        user.map = null;
        user.needsUpdate = true;
      });
      users?.clear();
      texture.dispose();
    });
    materials.forEach((material) => material.dispose());
    delete group.userData.worldThemeDispose;
  };
  group.userData.worldThemeDisposed = false;
  group.userData.worldThemeDispose = dispose;

  return {
    sky: new THREE.Color(palette.sky),
    fog: new THREE.Fog(palette.fog, palette.fogNear, palette.fogFar),
    groundColor: new THREE.Color(palette.ground),
    groundMap,
    pixelMaps: maps,
    dispose,
  };
}

function loadPixelMap(
  loader: THREE.TextureLoader,
  url: string,
  repeat: number,
  textures: Set<THREE.Texture>,
): THREE.Texture {
  const texture = loader.load(
    url,
    (loaded) => {
      if (loaded.userData.pixelMapDisposed === true) {
        loaded.dispose();
        return;
      }
      loaded.userData.loadFailed = false;
      loaded.needsUpdate = true;
      const users = loaded.userData.pixelMapUsers as Set<ThemeMappedMaterial> | undefined;
      users?.forEach((user) => {
        user.map = loaded;
        user.needsUpdate = true;
      });
    },
    undefined,
    () => {
      if (texture.userData.pixelMapDisposed === true) return;
      // Mesh base colors remain a deliberate, readable fallback if an asset is absent.
      texture.userData.loadFailed = true;
      const users = texture.userData.pixelMapUsers as Set<ThemeMappedMaterial> | undefined;
      users?.forEach((user) => {
        user.map = null;
        user.needsUpdate = true;
      });
    },
  );
  texture.name = url.split('/').pop() ?? 'pixel-map';
  texture.colorSpace = THREE.SRGBColorSpace;
  // The generated art is intentionally used as-is. Mirrored sampling joins
  // opposite copies at the same edge pixel, hiding non-tileable borders
  // without synthesizing, blending, or stretching a replacement texture.
  texture.wrapS = THREE.MirroredRepeatWrapping;
  texture.wrapT = THREE.MirroredRepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  // Nearest mip levels retain pixel blocks while preventing the high-repeat
  // ground maps from sparkling as they recede from the camera.
  texture.minFilter = THREE.NearestMipmapNearestFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 1;
  texture.repeat.set(repeat, repeat);
  texture.userData.pixelMapUsers = new Set<ThemeMappedMaterial>();
  texture.userData.pixelMapDisposed = false;
  textures.add(texture);
  return texture;
}

function ownGeometry<T extends THREE.BufferGeometry>(geometry: T, owned: Set<THREE.BufferGeometry>): T {
  owned.add(geometry);
  return geometry;
}

function material(
  context: ThemeBuildContext,
  color: number,
  map?: THREE.Texture,
  options: { emissive?: number; metalness?: number; roughness?: number; transparent?: boolean; opacity?: number } = {},
): THREE.MeshStandardMaterial {
  const value = new THREE.MeshStandardMaterial({
    color,
    // Begin with the authored base color, then reveal the image-generated map
    // once it is ready. A failed request therefore never turns scenery black.
    map: map?.image ? map : null,
    flatShading: true,
    roughness: options.roughness ?? 0.9,
    metalness: options.metalness ?? 0.02,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissive ? 1.45 : 0,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
  });
  if (map) (map.userData.pixelMapUsers as Set<ThemeMappedMaterial>).add(value);
  context.materials.add(value);
  return value;
}

function addInstances(
  context: ThemeBuildContext,
  name: string,
  geometry: THREE.BufferGeometry,
  meshMaterial: THREE.Material,
  transforms: Transform[],
  shadows: 'none' | 'receive' | 'full' = 'receive',
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, meshMaterial, transforms.length);
  const dummy = new THREE.Object3D();
  transforms.forEach((transform, index) => {
    dummy.position.set(...transform.position);
    dummy.scale.set(...(transform.scale ?? [1, 1, 1]));
    dummy.rotation.set(...(transform.rotation ?? [0, 0, 0]));
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  });
  mesh.name = name;
  mesh.userData.ignorePick = true;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.castShadow = shadows === 'full';
  mesh.receiveShadow = shadows !== 'none';
  mesh.computeBoundingSphere();
  context.group.add(mesh);
  return mesh;
}

function addBlock(
  context: ThemeBuildContext,
  name: string,
  meshMaterial: THREE.Material,
  transform: Transform,
  shadows: 'none' | 'receive' | 'full' = 'receive',
): THREE.Mesh {
  const mesh = new THREE.Mesh(context.box, meshMaterial);
  mesh.name = name;
  mesh.position.set(...transform.position);
  mesh.scale.set(...(transform.scale ?? [1, 1, 1]));
  mesh.rotation.set(...(transform.rotation ?? [0, 0, 0]));
  mesh.userData.ignorePick = true;
  mesh.castShadow = shadows === 'full';
  mesh.receiveShadow = shadows !== 'none';
  context.group.add(mesh);
  return mesh;
}

function fenceTransforms(z: number, fromX = -17.5, count = 15, spacing = 2.5): { posts: Transform[]; rails: Transform[] } {
  const posts: Transform[] = [];
  const rails: Transform[] = [];
  for (let i = 0; i < count; i++) {
    const x = fromX + i * spacing;
    posts.push({ position: [x, 1.1 + (i % 4 === 0 ? 0.08 : 0), z], scale: [0.22, 2.2, 0.22], rotation: [0, 0, ((i % 3) - 1) * 0.025] });
    if (i < count - 1) {
      rails.push({ position: [x + spacing * 0.5, 0.75, z + 0.02], scale: [spacing + 0.08, 0.18, 0.16] });
      rails.push({ position: [x + spacing * 0.5, 1.55, z + 0.02], scale: [spacing + 0.08, 0.18, 0.16] });
    }
  }
  return { posts, rails };
}

function treeTransforms(points: Array<[number, number, number]>): { trunks: Transform[]; leaves: Transform[] } {
  const trunks: Transform[] = [];
  const leaves: Transform[] = [];
  const crownOffsets: Array<[number, number, number, number]> = [
    [0, 0, 0, 1.9], [-1.15, -0.15, 0.05, 1.25], [1.1, -0.05, 0.2, 1.35],
    [0.15, 0.65, -0.15, 1.35], [0.25, -0.15, 1.0, 1.05], [-0.65, 0.15, -0.9, 1.0],
  ];
  points.forEach(([x, z, height], treeIndex) => {
    trunks.push({ position: [x, height * 0.5, z], scale: [0.72, height, 0.72], rotation: [0, 0, treeIndex % 2 ? 0.025 : -0.018] });
    crownOffsets.forEach(([dx, dy, dz, size], index) => {
      leaves.push({
        position: [x + dx, height + 0.45 + dy, z + dz],
        scale: [size, size * (index === 0 ? 1.05 : 0.86), size],
        rotation: [0, (index + treeIndex) * 0.17, 0],
      });
    });
  });
  return { trunks, leaves };
}

function buildBackyard(context: ThemeBuildContext): void {
  const { palette, maps } = context;
  const wood = material(context, palette.wood, maps.soil);
  const leaf = material(context, palette.foliage, maps.grass);
  const leafDark = material(context, palette.foliageDark, maps.grass);
  const soil = material(context, 0xd0a45f, maps.soil);
  const sign = material(context, palette.structure, maps.sand);
  const accent = material(context, palette.accent);

  const fence = fenceTransforms(-11.8);
  addInstances(context, 'backyard-fence-posts', context.box, wood, fence.posts, 'full');
  addInstances(context, 'backyard-fence-rails', context.box, wood, fence.rails, 'receive');

  const trees = treeTransforms([[-15.5, -7.8, 4.0], [15.8, -8.4, 4.4], [-16.5, 9.5, 3.8], [16.8, 9.3, 4.2]]);
  addInstances(context, 'backyard-tree-trunks', context.box, wood, trees.trunks, 'full');
  addInstances(context, 'backyard-tree-crowns', context.box, leaf, trees.leaves, 'full');

  const shrubs: Transform[] = [];
  for (const [x, z] of [[-13.5, 8.6], [-11.6, 9.4], [12.8, 9.2], [14.8, 8.2], [-15, -3.4], [15.8, -3.2]] as Array<[number, number]>) {
    shrubs.push({ position: [x, 0.62, z], scale: [1.25, 1.05, 1.1], rotation: [0, x * 0.06, 0] });
    shrubs.push({ position: [x + 0.72, 0.45, z + 0.42], scale: [0.85, 0.7, 0.82] });
  }
  addInstances(context, 'backyard-shrubs', context.box, leafDark, shrubs, 'receive');

  const pavers: Transform[] = [];
  for (let i = 0; i < 8; i++) pavers.push({ position: [-14.4 + (i % 2) * 0.35, 0.025, 7.2 - i * 1.45], scale: [1.2, 0.05, 0.85], rotation: [0, ((i % 3) - 1) * 0.08, 0] });
  addInstances(context, 'backyard-pixel-pavers', context.box, soil, pavers, 'receive');

  addBlock(context, 'backyard-sign-panel', sign, { position: [-12.6, 2.35, -10.85], scale: [3.3, 1.25, 0.2], rotation: [0, -0.04, 0] }, 'full');
  addBlock(context, 'backyard-sign-arrow-shaft', accent, { position: [-12.65, 2.38, -10.7], scale: [1.45, 0.18, 0.08] }, 'none');
  addBlock(context, 'backyard-sign-arrow-head-a', accent, { position: [-11.92, 2.62, -10.7], scale: [0.18, 0.65, 0.08], rotation: [0, 0, -0.72] }, 'none');
  addBlock(context, 'backyard-sign-arrow-head-b', accent, { position: [-11.92, 2.14, -10.7], scale: [0.18, 0.65, 0.08], rotation: [0, 0, 0.72] }, 'none');
}

function buildYard(context: ThemeBuildContext): void {
  const { palette, maps } = context;
  const fenceMetal = material(context, palette.structureDark, maps.factory, { metalness: 0.48, roughness: 0.62 });
  const weatheredWood = material(context, palette.wood, maps.soil);
  const crateFace = material(context, 0xc78b4d, maps.sand);
  const shrub = material(context, palette.foliageDark, maps.grass);
  const caution = material(context, palette.accent, maps.factory);
  const rubber = material(context, 0x252c2e, maps['night-grid'], { roughness: 0.98 });

  const backFence = fenceTransforms(-12.5, -18, 13, 3);
  addInstances(context, 'yard-perimeter-posts', context.box, fenceMetal, backFence.posts, 'full');
  addInstances(context, 'yard-perimeter-rails', context.box, fenceMetal, backFence.rails, 'receive');

  const crates: Transform[] = [
    { position: [-15.8, 0.75, 5.8], scale: [2.2, 1.5, 1.7] },
    { position: [-13.7, 0.58, 7.0], scale: [1.7, 1.15, 1.35], rotation: [0, 0.08, 0] },
    { position: [-15.6, 2.05, 5.9], scale: [1.45, 1.1, 1.25], rotation: [0, -0.07, 0] },
    { position: [15.8, 0.65, 6.7], scale: [1.8, 1.3, 1.5] },
    { position: [14.6, 1.78, 6.5], scale: [1.35, 0.95, 1.2], rotation: [0, 0.11, 0] },
  ];
  addInstances(context, 'yard-crate-stack', context.box, crateFace, crates, 'full');

  const crateBraces: Transform[] = [];
  crates.forEach(({ position, scale = [1, 1, 1] }) => {
    crateBraces.push({ position: [position[0], position[1], position[2] + scale[2] * 0.505], scale: [scale[0] * 0.9, 0.11, 0.08], rotation: [0, 0, 0.58] });
    crateBraces.push({ position: [position[0], position[1], position[2] + scale[2] * 0.51], scale: [scale[0] * 0.9, 0.11, 0.08], rotation: [0, 0, -0.58] });
  });
  addInstances(context, 'yard-crate-pixel-braces', context.box, weatheredWood, crateBraces, 'none');

  const tires: Transform[] = [];
  for (let i = 0; i < 5; i++) tires.push({ position: [16.6, 0.34 + i * 0.38, -4.6 + (i % 2) * 0.14], scale: [0.78, 0.26, 0.78], rotation: [Math.PI * 0.5, 0, 0] });
  addInstances(context, 'yard-rubber-rings', context.cylinder, rubber, tires, 'receive');

  const scrub: Transform[] = [];
  for (const [x, z] of [[-16, -5], [-14.7, -6], [14.5, -7], [16.1, -6.3]] as Array<[number, number]>) {
    scrub.push({ position: [x, 0.42, z], scale: [0.95, 0.75, 0.9], rotation: [0, x * 0.1, 0] });
  }
  addInstances(context, 'yard-edge-scrub', context.box, shrub, scrub, 'receive');

  const stripes: Transform[] = [];
  for (let i = 0; i < 9; i++) stripes.push({ position: [-12 + i * 3, 0.028, 10.8], scale: [1.55, 0.045, 0.5], rotation: [0, i % 2 ? -0.38 : 0.38, 0] });
  addInstances(context, 'yard-caution-edge', context.box, caution, stripes, 'none');
}

function buildWorkshop(context: ThemeBuildContext): void {
  const { palette, maps } = context;
  const wall = material(context, palette.structure, maps.concrete, { roughness: 0.93 });
  const darkMetal = material(context, palette.structureDark, maps.factory, { metalness: 0.52, roughness: 0.58 });
  const wood = material(context, palette.wood, maps.soil);
  const crate = material(context, 0xc88443, maps.sand);
  const yellow = material(context, palette.accent, maps.factory);
  const glow = material(context, 0xffd67a, undefined, { emissive: palette.glow, roughness: 0.5 });

  const wallPanels: Transform[] = [];
  for (let i = 0; i < 12; i++) wallPanels.push({ position: [-16.5 + i * 3, 3.8, -14.5], scale: [2.94, 7.6, 0.35] });
  addInstances(context, 'workshop-back-wall-panels', context.box, wall, wallPanels, 'receive');

  const seams: Transform[] = [];
  for (let i = 0; i < 13; i++) seams.push({ position: [-18 + i * 3, 3.8, -14.28], scale: [0.08, 7.15, 0.06] });
  addInstances(context, 'workshop-panel-seams', context.box, darkMetal, seams, 'none');

  const shelfFrames: Transform[] = [];
  const shelfBoards: Transform[] = [];
  for (const x of [-15, 14.5]) {
    for (const side of [-1, 1]) shelfFrames.push({ position: [x + side * 2.1, 2.25, -10.7], scale: [0.16, 4.5, 0.55] });
    for (let level = 0; level < 4; level++) shelfBoards.push({ position: [x, 0.55 + level * 1.2, -10.7], scale: [4.35, 0.17, 1.4] });
  }
  addInstances(context, 'workshop-shelf-frames', context.box, darkMetal, shelfFrames, 'full');
  addInstances(context, 'workshop-shelf-boards', context.box, wood, shelfBoards, 'receive');

  const boxes: Transform[] = [
    { position: [-15.8, 1.13, -10.7], scale: [1.15, 0.9, 1.0] },
    { position: [-14.2, 2.25, -10.7], scale: [1.35, 0.88, 1.0] },
    { position: [-15.5, 3.52, -10.7], scale: [1.55, 0.92, 1.0] },
    { position: [13.7, 1.13, -10.7], scale: [1.3, 0.9, 1.0] },
    { position: [15.2, 2.25, -10.7], scale: [1.15, 0.85, 1.0] },
    { position: [14.3, 3.5, -10.7], scale: [1.6, 0.9, 1.0] },
  ];
  addInstances(context, 'workshop-shelf-crates', context.box, crate, boxes, 'full');

  const ceilingDucts: Transform[] = [
    { position: [-12, 6.7, -12.9], scale: [8.5, 0.72, 0.72], rotation: [0, 0, Math.PI * 0.5] },
    { position: [12.5, 6.7, -12.9], scale: [8.5, 0.72, 0.72], rotation: [0, 0, Math.PI * 0.5] },
    { position: [0, 8.2, -12.9], scale: [0.72, 24.5, 0.72], rotation: [0, 0, Math.PI * 0.5] },
  ];
  addInstances(context, 'workshop-chunky-ducts', context.cylinder, darkMetal, ceilingDucts, 'receive');

  const warningTiles: Transform[] = [];
  for (let i = 0; i < 14; i++) warningTiles.push({ position: [-16.25 + i * 2.5, 0.027, 11.8], scale: [1.35, 0.045, 0.42], rotation: [0, i % 2 ? -0.42 : 0.42, 0] });
  addInstances(context, 'workshop-warning-line', context.box, yellow, warningTiles, 'none');

  const lamps: Transform[] = [-9, 0, 9].map((x) => ({ position: [x, 7.5, -14.05], scale: [1.8, 0.22, 0.14] }));
  addInstances(context, 'workshop-pixel-strip-lights', context.box, glow, lamps, 'none');
}

function buildFactory(context: ThemeBuildContext): void {
  const { palette, maps } = context;
  const metal = material(context, palette.structure, maps.factory, { metalness: 0.58, roughness: 0.53 });
  const darkMetal = material(context, palette.structureDark, maps['night-grid'], { metalness: 0.64, roughness: 0.46 });
  const caution = material(context, palette.accent, maps.factory, { metalness: 0.16 });
  const redGlow = material(context, 0xff5a45, undefined, { emissive: palette.glow, roughness: 0.4 });
  const concrete = material(context, 0x7e817b, maps.concrete);

  const stacks: Transform[] = [
    { position: [-16, 4.5, -13.4], scale: [0.86, 9, 0.86] },
    { position: [-11.5, 3.8, -14.2], scale: [0.72, 7.6, 0.72] },
    { position: [11.8, 4.2, -14.1], scale: [0.78, 8.4, 0.78] },
    { position: [16.2, 5.1, -13.2], scale: [0.92, 10.2, 0.92] },
  ];
  addInstances(context, 'factory-perimeter-stacks', context.cylinder, metal, stacks, 'full');

  const stackBands: Transform[] = [];
  stacks.forEach(({ position, scale = [1, 1, 1] }) => {
    for (const fraction of [0.22, 0.58, 0.88]) {
      stackBands.push({ position: [position[0], scale[1] * fraction, position[2]], scale: [scale[0] * 1.11, 0.16, scale[2] * 1.11] });
    }
  });
  addInstances(context, 'factory-stack-bands', context.cylinder, darkMetal, stackBands, 'receive');

  const ducts: Transform[] = [
    { position: [-13.8, 6.3, -12.9], scale: [0.7, 7.6, 0.7], rotation: [0, 0, Math.PI * 0.5] },
    { position: [13.8, 7.2, -12.8], scale: [0.82, 7.2, 0.82], rotation: [0, 0, Math.PI * 0.5] },
    { position: [-17.1, 2.1, -8.5], scale: [0.62, 8.8, 0.62] },
    { position: [17.1, 2.4, -8.0], scale: [0.65, 8.2, 0.65] },
  ];
  addInstances(context, 'factory-duct-network', context.cylinder, darkMetal, ducts, 'full');

  const machineBases: Transform[] = [
    { position: [-16.1, 1.2, 3.4], scale: [3.2, 2.4, 3.1] },
    { position: [16.1, 1.45, 2.4], scale: [3.4, 2.9, 2.8] },
    { position: [-15.3, 0.9, 9.5], scale: [3.8, 1.8, 2.3] },
    { position: [15.5, 0.95, 9.4], scale: [3.7, 1.9, 2.2] },
  ];
  addInstances(context, 'factory-edge-machines', context.box, concrete, machineBases, 'full');

  const machinePanels: Transform[] = machineBases.map(({ position, scale = [1, 1, 1] }) => ({
    position: [position[0], position[1] + 0.1, position[2] - scale[2] * 0.51],
    scale: [scale[0] * 0.58, scale[1] * 0.5, 0.08],
  }));
  addInstances(context, 'factory-machine-panels', context.box, darkMetal, machinePanels, 'none');

  const warningLights: Transform[] = stacks.map(({ position, scale = [1, 1, 1] }) => ({
    position: [position[0], scale[1] + 0.28, position[2]],
    scale: [0.23, 0.23, 0.23],
  }));
  addInstances(context, 'factory-warning-lights', context.box, redGlow, warningLights, 'none');

  const cautionStripes: Transform[] = [];
  for (let i = 0; i < 12; i++) {
    cautionStripes.push({ position: [-16.5 + i * 3, 0.03, 11.6], scale: [1.55, 0.05, 0.55], rotation: [0, i % 2 ? -0.43 : 0.43, 0] });
  }
  addInstances(context, 'factory-caution-boundary', context.box, caution, cautionStripes, 'none');
}

function buildCastle(context: ThemeBuildContext): void {
  const { palette, maps } = context;
  const stone = material(context, palette.structure, maps.concrete);
  const stoneDark = material(context, palette.structureDark, maps['night-grid']);
  const banner = material(context, palette.accent, maps['night-grid'], { roughness: 0.96 });
  const gold = material(context, 0xf1c55c, maps.sand, { metalness: 0.2 });
  const moss = material(context, palette.foliageDark, maps.grass);
  const fire = material(context, 0xffb94c, undefined, { emissive: palette.glow, roughness: 0.42 });

  const wallBlocks: Transform[] = [];
  for (let i = 0; i < 18; i++) {
    wallBlocks.push({ position: [-17 + i * 2, 2.15, -14.2], scale: [1.92, 4.3, 1.3] });
  }
  addInstances(context, 'castle-back-wall', context.box, stone, wallBlocks, 'full');

  const battlements: Transform[] = [];
  for (let i = 0; i < 18; i += 2) battlements.push({ position: [-17 + i * 2, 4.8, -14.2], scale: [1.75, 1.1, 1.45] });
  addInstances(context, 'castle-battlements', context.box, stoneDark, battlements, 'full');

  const towerBlocks: Transform[] = [];
  for (const x of [-16.2, 16.2]) {
    towerBlocks.push({ position: [x, 2.75, -10.7], scale: [4.3, 5.5, 4.1] });
    towerBlocks.push({ position: [x, 5.8, -10.7], scale: [4.75, 0.6, 4.5] });
    for (const dx of [-1.55, 0, 1.55]) towerBlocks.push({ position: [x + dx, 6.55, -10.7], scale: [0.85, 1.25, 4.35] });
  }
  addInstances(context, 'castle-block-towers', context.box, stone, towerBlocks, 'full');

  const banners: Transform[] = [
    { position: [-8, 3.05, -13.48], scale: [2.15, 2.75, 0.09] },
    { position: [0, 3.05, -13.48], scale: [2.15, 2.75, 0.09] },
    { position: [8, 3.05, -13.48], scale: [2.15, 2.75, 0.09] },
  ];
  addInstances(context, 'castle-pixel-banners', context.box, banner, banners, 'none');

  const emblems: Transform[] = [];
  for (const x of [-8, 0, 8]) {
    emblems.push({ position: [x, 3.05, -13.37], scale: [0.26, 1.25, 0.08] });
    emblems.push({ position: [x, 3.18, -13.36], scale: [1.05, 0.26, 0.08] });
  }
  addInstances(context, 'castle-banner-emblems', context.box, gold, emblems, 'none');

  const rocks: Transform[] = [];
  for (let i = 0; i < 14; i++) {
    const side = i % 2 ? 1 : -1;
    rocks.push({
      position: [side * (13.5 + (i % 3) * 1.35), 0.45 + (i % 3) * 0.16, -6 + Math.floor(i / 2) * 2.4],
      scale: [0.75 + (i % 3) * 0.2, 0.62 + (i % 2) * 0.22, 0.8 + ((i + 1) % 3) * 0.18],
      rotation: [i * 0.23, i * 0.47, i * 0.12],
    });
  }
  addInstances(context, 'castle-edge-rocks', context.rock, stoneDark, rocks, 'receive');

  const mossPatches: Transform[] = [
    { position: [-15.5, 0.12, 7.8], scale: [2.8, 0.18, 2.1] },
    { position: [15.2, 0.1, 8.4], scale: [2.5, 0.16, 2.5] },
    { position: [-16.8, 0.1, -4.4], scale: [2.1, 0.16, 2.7] },
  ];
  addInstances(context, 'castle-moss-patches', context.box, moss, mossPatches, 'receive');

  const torches: Transform[] = [-11, -4, 4, 11].map((x) => ({ position: [x, 3.4, -13.25], scale: [0.28, 0.55, 0.25] }));
  addInstances(context, 'castle-torch-pixels', context.box, fire, torches, 'none');
}
