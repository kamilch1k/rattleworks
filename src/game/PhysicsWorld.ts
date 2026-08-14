import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import RAPIER from '@dimforge/rapier3d';
import type { AnatomicalJoint, AnatomicalJointId, Character, CharacterKind, Connector, Entity, MaterialId, Quality, SpawnDefinition, Vec3, WeaponKind, WeaponMode } from './types';
import type { AudioSystem } from './AudioSystem';
import { decorateCharacter } from './CharacterVisuals';

export interface MaterialProfile {
  density: number;
  friction: number;
  restitution: number;
  breakResistance: number;
  color: number;
}

export const MATERIALS: Record<MaterialId, MaterialProfile> = {
  wood: { density: 0.55, friction: 0.72, restitution: 0.04, breakResistance: 38, color: 0xb86d38 },
  metal: { density: 2.6, friction: 0.48, restitution: 0.08, breakResistance: 120, color: 0x72818c },
  concrete: { density: 1.8, friction: 0.8, restitution: 0.01, breakResistance: 85, color: 0x9b9a90 },
  glass: { density: 0.7, friction: 0.38, restitution: 0.05, breakResistance: 15, color: 0x9edce3 },
  rubber: { density: 0.85, friction: 1.1, restitution: 0.55, breakResistance: 70, color: 0x252b33 },
  plastic: { density: 0.65, friction: 0.62, restitution: 0.08, breakResistance: 45, color: 0xe9b93c },
  dirt: { density: 1.3, friction: 1.0, restitution: 0, breakResistance: 1000, color: 0x7a5536 },
  toy: { density: 0.75, friction: 0.68, restitution: 0.03, breakResistance: 55, color: 0xf0a13b },
};

export interface PhysicsEvents {
  onImpact?: (entity: Entity, force: number, point?: THREE.Vector3) => void;
  onCharacterHit?: (character: Character, damage: number, point: THREE.Vector3) => void;
  onCharacterDefeated?: (character: Character) => void;
  onDismemberment?: (event: DismembermentEvent) => void;
  onBreak?: (entity: Entity, force: number) => void;
  onExplosion?: (point: THREE.Vector3, radius: number) => void;
}

export interface DismembermentEvent {
  character: Character;
  proximal: Entity;
  detachedRoot: Entity;
  joint: AnatomicalJointId;
  point: THREE.Vector3;
  direction: THREE.Vector3;
  severity: number;
}

interface ContactImpact {
  a?: Entity;
  b?: Entity;
  impulse: number;
  closingSpeed: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

interface CharacterContactImpact {
  character: Character;
  struck: Entity;
  source?: Entity;
  impulse: number;
  closingSpeed: number;
  energy: number;
  rawDamage: number;
  point: THREE.Vector3;
}

interface WeaponProfile {
  mode: WeaponMode;
  size: [number, number, number];
  mass: number;
  damage: number;
  impulse: number;
  cooldown: number;
  range: number;
  magazineSize: number;
  reserveAmmo: number;
  pellets: number;
  spread: number;
  color: number;
}

export interface WeaponImpact {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  entity?: Entity;
}

export interface WeaponUseResult {
  used: boolean;
  reason?: 'invalid' | 'cooldown' | 'empty';
  kind?: WeaponKind;
  mode?: WeaponMode;
  muzzle?: THREE.Vector3;
  end?: THREE.Vector3;
  impacts: WeaponImpact[];
  ammo?: number;
  reserveAmmo?: number;
}

const WEAPON_PROFILES: Readonly<Record<WeaponKind, WeaponProfile>> = {
  pistol: {
    mode: 'firearm', size: [1.18, 0.48, 0.24], mass: 1.05, damage: 40, impulse: 0.9,
    cooldown: 0.2, range: 58, magazineSize: 12, reserveAmmo: 48, pellets: 1, spread: 0.006, color: 0x3e4a53,
  },
  shotgun: {
    mode: 'firearm', size: [2.35, 0.4, 0.28], mass: 3.2, damage: 18, impulse: 0.72,
    cooldown: 0.72, range: 34, magazineSize: 6, reserveAmmo: 24, pellets: 8, spread: 0.055, color: 0x614836,
  },
  rifle: {
    mode: 'firearm', size: [2.55, 0.42, 0.28], mass: 3.5, damage: 43, impulse: 1.05,
    cooldown: 0.12, range: 72, magazineSize: 24, reserveAmmo: 72, pellets: 1, spread: 0.0035, color: 0x405249,
  },
  knife: {
    mode: 'melee', size: [1.28, 0.2, 0.11], mass: 0.55, damage: 34, impulse: 2.25,
    cooldown: 0.32, range: 2.25, magazineSize: 0, reserveAmmo: 0, pellets: 0, spread: 0, color: 0xc8d3d7,
  },
  machete: {
    mode: 'melee', size: [1.82, 0.29, 0.13], mass: 1.35, damage: 46, impulse: 3.1,
    cooldown: 0.48, range: 3.05, magazineSize: 0, reserveAmmo: 0, pellets: 0, spread: 0, color: 0x9eaaad,
  },
  axe: {
    mode: 'melee', size: [1.72, 0.58, 0.16], mass: 2.25, damage: 54, impulse: 3.55,
    cooldown: 0.58, range: 3.35, magazineSize: 0, reserveAmmo: 0, pellets: 0, spread: 0, color: 0x76543a,
  },
  spear: {
    mode: 'melee', size: [2.9, 0.16, 0.16], mass: 1.7, damage: 51, impulse: 3.8,
    cooldown: 0.62, range: 4.35, magazineSize: 0, reserveAmmo: 0, pellets: 0, spread: 0, color: 0x8c6543,
  },
};

const WEAPON_KINDS = new Set<string>(Object.keys(WEAPON_PROFILES));

const isWeaponKind = (value: string): value is WeaponKind => WEAPON_KINDS.has(value);

const vec = (v: THREE.Vector3 | Vec3) => ({ x: v.x, y: v.y, z: v.z });

type PixelTextureRole = MaterialId
  | 'fabric'
  | 'denim'
  | 'leather'
  | 'stone'
  | 'brick'
  | 'hazard'
  | 'factory'
  | 'grass'
  | 'snow';

const PIXEL_TEXTURE_PATHS: Readonly<Record<PixelTextureRole, string>> = {
  wood: '/textures/pixel/materials/wood-pixel-v2.png',
  metal: '/textures/pixel/materials/metal-pixel-v2.png',
  concrete: '/textures/pixel/materials/concrete-pixel-v2.png',
  glass: '/textures/pixel/materials/glass-pixel-v2.png',
  rubber: '/textures/pixel/materials/rubber-pixel-v2.png',
  plastic: '/textures/pixel/materials/plastic-pixel-v2.png',
  dirt: '/textures/pixel/materials/dirt-pixel-v2.png',
  toy: '/textures/pixel/materials/toy-pixel-v2.png',
  fabric: '/textures/pixel/materials/fabric-pixel-v2.png',
  denim: '/textures/pixel/materials/denim-pixel-v2.png',
  leather: '/textures/pixel/materials/leather-pixel-v2.png',
  stone: '/textures/pixel/materials/stone-pixel-v2.png',
  brick: '/textures/pixel/materials/brick-pixel-v2.png',
  hazard: '/textures/pixel/materials/hazard-pixel-v2.png',
  factory: '/textures/pixel/materials/factory-pixel-v2.png',
  grass: '/textures/pixel/materials/grass-pixel-v2.png',
  snow: '/textures/pixel/materials/snow-pixel-v2.png',
};

const PIXEL_MATERIAL_SURFACE: Readonly<Record<PixelTextureRole, { roughness: number; metalness: number }>> = {
  wood: { roughness: 0.88, metalness: 0 },
  metal: { roughness: 0.43, metalness: 0.72 },
  concrete: { roughness: 0.98, metalness: 0 },
  glass: { roughness: 0.16, metalness: 0.08 },
  rubber: { roughness: 0.9, metalness: 0 },
  plastic: { roughness: 0.62, metalness: 0.03 },
  dirt: { roughness: 1, metalness: 0 },
  toy: { roughness: 0.73, metalness: 0.02 },
  fabric: { roughness: 0.96, metalness: 0 },
  denim: { roughness: 0.94, metalness: 0 },
  leather: { roughness: 0.78, metalness: 0 },
  stone: { roughness: 0.99, metalness: 0 },
  brick: { roughness: 0.98, metalness: 0 },
  hazard: { roughness: 0.68, metalness: 0.2 },
  factory: { roughness: 0.6, metalness: 0.48 },
  grass: { roughness: 1, metalness: 0 },
  snow: { roughness: 0.92, metalness: 0 },
};

export class PhysicsWorld {
  readonly scene: THREE.Scene;
  world: RAPIER.World;
  readonly entities = new Map<number, Entity>();
  readonly characters = new Map<number, Character>();
  readonly connectors = new Map<number, Connector>();
  readonly colliderToEntity = new Map<number, number>();
  readonly events: PhysicsEvents;
  private eventQueue: RAPIER.EventQueue;
  private nextEntityId = 1;
  private nextCharacterId = 1;
  private nextConnectorId = 1;
  private geometries = new Map<string, THREE.BufferGeometry>();
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  private pixelTextures = new Map<PixelTextureRole, THREE.Texture>();
  private failedPixelTextures = new Set<PixelTextureRole>();
  private weaponMaterials = new Map<string, THREE.MeshStandardMaterial>();
  private groundMesh?: THREE.Mesh;
  private accumulator = 0;
  private readonly fixedStep = 1 / 60;
  private maxFrameSubsteps = 3;
  private quality: Quality = 'medium';
  private simulationTime = 0;
  private machineClock = 0;
  private machineCooldowns = new Map<string, number>();
  private characterImpactTimes = new Map<number, number>();
  /**
   * Contact-force events can repeat while two bodies separate. Keying the
   * gameplay cooldown by victim + source prevents one resting body from
   * dealing damage every solver step without suppressing a new projectile.
   */
  private characterSourceImpactTimes = new Map<string, number>();
  private characterSourceDismembermentTimes = new Map<string, number>();
  private exploding = new Set<number>();
  private readonly machineCandidates: Entity[] = [];
  private readonly machineCandidateIds = new Set<number>();
  private readonly machineQueryCenter: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly machineQueryHalfExtents: Vec3 = { x: 0, y: 0, z: 0 };
  private machineQueryExcludeId = -1;
  private readonly collectMachineCandidate = (collider: RAPIER.Collider): boolean => {
    const id = this.colliderToEntity.get(collider.handle);
    if (id === undefined || id === this.machineQueryExcludeId || this.machineCandidateIds.has(id)) return true;
    const entity = this.entities.get(id);
    if (!entity) return true;
    this.machineCandidateIds.add(id);
    this.machineCandidates.push(entity);
    return true;
  };
  private audio?: AudioSystem;
  simulationScale = 1;
  paused = false;
  destructionValue = 0;
  maxBodies = 260;
  private readonly physicsHooks: RAPIER.PhysicsHooks = {
    // Joint-adjacent character parts disable their own contacts on the joint.
    // Non-adjacent parts must still collide so arms, hands, and legs can brace
    // against the torso instead of ghosting through the whole ragdoll.
    filterContactPair: () => RAPIER.SolverFlags.COMPUTE_IMPULSE,
    filterIntersectionPair: () => true,
  };

  constructor(scene: THREE.Scene, audio?: AudioSystem, events: PhysicsEvents = {}) {
    this.scene = scene;
    this.audio = audio;
    this.events = events;
    this.world = this.createWorld();
    this.eventQueue = new RAPIER.EventQueue(true);
    this.createGround();
  }

  private createWorld(): RAPIER.World {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = this.fixedStep;
    world.integrationParameters.contact_natural_frequency = 30;
    world.integrationParameters.normalizedAllowedLinearError = 0.0025;
    world.integrationParameters.normalizedPredictionDistance = 0.004;
    this.configureWorld(world);
    return world;
  }

  private configureWorld(world: RAPIER.World): void {
    world.numSolverIterations = this.quality === 'low' ? 6 : this.quality === 'medium' ? 9 : 12;
    world.numInternalPgsIterations = this.quality === 'low' ? 2 : this.quality === 'medium' ? 3 : 4;
    world.maxCcdSubsteps = this.quality === 'high' ? 4 : this.quality === 'medium' ? 3 : 2;
  }

  private createGround(): void {
    if (this.groundMesh) this.scene.remove(this.groundMesh);
    const geometry = this.geometry('ground', () => new RoundedBoxGeometry(80, 1, 80, 2, 0.08));
    const material = this.material('ground', 0x657a4f, false, 'grass');
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, -0.5, 0);
    mesh.receiveShadow = true;
    mesh.userData.ignorePick = true;
    this.scene.add(mesh);
    this.groundMesh = mesh;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(40, 0.5, 40).setFriction(1), body);
  }

  clear(): void {
    for (const connector of this.connectors.values()) {
      if (connector.line) this.scene.remove(connector.line);
    }
    for (const entity of this.entities.values()) this.scene.remove(entity.object);
    this.entities.clear();
    this.characters.clear();
    this.connectors.clear();
    this.colliderToEntity.clear();
    this.eventQueue.free();
    this.world.free();
    this.world = this.createWorld();
    this.eventQueue = new RAPIER.EventQueue(true);
    this.nextEntityId = 1;
    this.nextCharacterId = 1;
    this.nextConnectorId = 1;
    this.accumulator = 0;
    this.simulationTime = 0;
    this.machineClock = 0;
    this.machineCooldowns.clear();
    this.characterImpactTimes.clear();
    this.characterSourceImpactTimes.clear();
    this.characterSourceDismembermentTimes.clear();
    this.exploding.clear();
    this.destructionValue = 0;
    this.createGround();
  }

  setQuality(quality: Quality): void {
    this.quality = quality;
    this.maxBodies = quality === 'low' ? 140 : quality === 'medium' ? 220 : 320;
    // Bound catch-up work after a hitch. Normal 60 Hz play remains one fixed
    // step, so joint stiffness and impact thresholds stay invariant.
    this.maxFrameSubsteps = quality === 'low' ? 2 : quality === 'medium' ? 3 : 4;
    this.configureWorld(this.world);
  }

  private geometry(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let value = this.geometries.get(key);
    if (!value) {
      value = factory();
      this.geometries.set(key, value);
    }
    return value;
  }

  private pixelTexture(role: PixelTextureRole): THREE.Texture | null {
    if (this.failedPixelTextures.has(role) || typeof document === 'undefined') return null;
    const cached = this.pixelTextures.get(role);
    if (cached) return cached;

    let texture!: THREE.Texture;
    texture = new THREE.TextureLoader().load(
      PIXEL_TEXTURE_PATHS[role],
      undefined,
      undefined,
      () => {
        this.failedPixelTextures.add(role);
        this.pixelTextures.delete(role);
        for (const material of this.materials.values()) {
          if (material.map !== texture) continue;
          material.map = null;
          material.needsUpdate = true;
        }
        texture.dispose();
      },
    );
    texture.name = `pixel-${role}`;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.MirroredRepeatWrapping;
    texture.wrapT = THREE.MirroredRepeatWrapping;
    texture.repeat.set(2, 2);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestMipmapNearestFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 1;
    this.pixelTextures.set(role, texture);
    return texture;
  }

  private visualTextureRole(type: string, material: MaterialId): PixelTextureRole {
    if (type === 'castle-block' || type === 'castle-column' || type === 'parapet') return 'stone';
    if ((type === 'wall' || type === 'roof-section') && material === 'concrete') return 'brick';
    // Vehicle wheels/treads keep the destructible plastic physics profile but
    // should read visually as dark rubber instead of inheriting orange toy
    // plastic from the shared pixel map.
    if (type === 'vehicle-wheel' || type === 'vehicle-tread') return 'rubber';
    if (type === 'explosive-barrel' || type === 'explosive-projectile' || type === 'bomb' || type === 'rocket') return 'hazard';
    if (type === 'motor' || type === 'piston' || type === 'conveyor' || type === 'cannon' || type === 'fan' || type === 'magnet') return 'factory';
    return material;
  }

  private material(key: string, color: number, transparent = false, textureRole: PixelTextureRole = 'toy'): THREE.MeshStandardMaterial {
    const id = `${key}-${color}-${transparent}-${textureRole}`;
    let value = this.materials.get(id);
    if (!value) {
      const surface = PIXEL_MATERIAL_SURFACE[textureRole];
      // AI-authored maps contain their own palette. A softened tint preserves
      // gameplay color coding without crushing the texture into muddy tones.
      const tint = new THREE.Color(color).lerp(new THREE.Color(0xffffff), textureRole === 'metal' || textureRole === 'factory' ? 0.68 : 0.52);
      value = new THREE.MeshStandardMaterial({
        color: tint,
        map: this.pixelTexture(textureRole),
        transparent,
        opacity: transparent ? 0.48 : 1,
        depthWrite: !transparent,
        flatShading: true,
        roughness: surface.roughness,
        metalness: surface.metalness,
        alphaTest: transparent ? 0.04 : 0,
      });
      this.materials.set(id, value);
    }
    return value;
  }

  private weaponMaterial(kind: WeaponKind, part: string, color: number, metalness = 0.45): THREE.MeshStandardMaterial {
    const key = `${kind}-${part}-${color}-${metalness}`;
    let material = this.weaponMaterials.get(key);
    if (!material) {
      const organicPart = /grip|handle|stock|pump|shaft|butt|wrap/.test(part)
        || (part === 'core' && (kind === 'shotgun' || kind === 'axe' || kind === 'spear'));
      const textureRole: PixelTextureRole = organicPart
        ? (/grip|handle|wrap/.test(part) ? 'leather' : 'wood')
        : 'metal';
      const surface = PIXEL_MATERIAL_SURFACE[textureRole];
      material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.22),
        map: this.pixelTexture(textureRole),
        roughness: surface.roughness,
        metalness: organicPart ? Math.min(metalness, 0.08) : Math.max(metalness, surface.metalness),
        flatShading: true,
      });
      this.weaponMaterials.set(key, material);
    }
    return material;
  }

  spawn(def: SpawnDefinition, spawnedByPlayer = false): Entity | Character | null {
    if (this.entities.size >= this.maxBodies) return null;
    if (def.type === 'character') {
      return this.spawnCharacter(def.variant ?? 'dummy', new THREE.Vector3(def.position.x, def.position.y, def.position.z), Boolean(def.friendly), def.label);
    }
    const rotation = new THREE.Euler(def.rotation?.x ?? 0, def.rotation?.y ?? 0, def.rotation?.z ?? 0);
    const scale = new THREE.Vector3(def.scale?.x ?? 1, def.scale?.y ?? 1, def.scale?.z ?? 1);
    const authoredType = def.type;
    const type = this.normalizeType(authoredType);
    const defaults = this.defaults(type);
    // Level definitions use explicit world-space dimensions. Player-spawned
    // definitions omit scale and therefore use the registry's canonical size.
    const size = def.scale ? scale : defaults.size.clone();
    const material = def.material ?? defaults.material;
    const fixed = Boolean(def.fixed ?? defaults.fixed);
    const entity = isWeaponKind(type)
      ? this.createWeapon(type, def.position, size, material, def.color ?? defaults.color, fixed, spawnedByPlayer)
      : defaults.shape === 'sphere'
        ? this.createSphere(type, def.position, size.x * 0.5, material, def.color ?? defaults.color, fixed, spawnedByPlayer, authoredType)
        : defaults.shape === 'cylinder'
          ? this.createCylinder(type, def.position, size, material, def.color ?? defaults.color, fixed, spawnedByPlayer, authoredType)
          : this.createBox(type, def.position, size, material, def.color ?? defaults.color, fixed, spawnedByPlayer, authoredType);
    if (!entity) return null;
    const q = new THREE.Quaternion().setFromEuler(rotation);
    entity.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    entity.object.quaternion.copy(q);
    entity.explosive = defaults.explosive;
    entity.projectile = defaults.projectile;
    entity.motor = defaults.motor;
    entity.group = def.group;
    if (defaults.ccd) entity.body.enableCcd(true);
    if (defaults.mass && entity.collider) entity.collider.setMass(defaults.mass);
    if (isWeaponKind(type)) {
      const profile = WEAPON_PROFILES[type];
      entity.weapon = {
        kind: type,
        mode: profile.mode,
        ammo: profile.magazineSize,
        magazineSize: profile.magazineSize,
        reserveAmmo: profile.reserveAmmo,
        lastUseAt: Number.NEGATIVE_INFINITY,
        lastContactAt: Number.NEGATIVE_INFINITY,
      };
      entity.destructible = false;
      entity.health = entity.maxHealth = 9999;
      entity.body.enableCcd(true);
      entity.body.setSoftCcdPrediction(0.18);
      entity.body.setLinearDamping(0.34);
      entity.body.setAngularDamping(0.72);
      entity.body.setAdditionalSolverIterations(2);
      this.addWeaponVisual(entity, type);
    }
    if (type === 'spring') this.addSpringVisual(entity.object);
    if (type === 'cannon') this.addCannonVisual(entity.object);
    if (type === 'piston') this.addPistonVisual(entity.object);
    if (type === 'conveyor') this.addConveyorVisual(entity.object);
    if (type === 'explosive-barrel' || type === 'barrel') this.addBarrelBands(entity.object);
    if (type === 'crate') this.addCrateBraces(entity.object);
    return entity;
  }

  private normalizeType(type: string): string {
    const aliases: Record<string, string> = {
      beam: 'beam', plank: 'plank', 'wall-block': 'wall-block', wall: 'wall-block',
      'concrete-block': 'concrete-block', glass: 'glass', crate: 'crate', barrel: 'barrel',
      'explosive-barrel': 'explosive-barrel', 'heavy-ball': 'heavy-ball', ball: 'ball',
      'small-ball': 'ball', 'metal-ball': 'metal-ball', 'explosive-projectile': 'explosive-projectile',
      weight: 'weight', platform: 'platform', wheel: 'wheel', motor: 'motor', piston: 'piston',
      'vehicle-wheel': 'vehicle-wheel',
      conveyor: 'conveyor', spring: 'spring', 'rope-anchor': 'rope-anchor', cannon: 'cannon',
      roof: 'roof', floor: 'platform', chair: 'chair', table: 'table', 'metal-beam': 'metal-beam',
      'roof-section': 'roof', 'support-block': 'concrete-block', 'bridge-deck': 'plank',
      'castle-block': 'concrete-block', 'tower-platform': 'platform', 'castle-column': 'concrete-block',
      parapet: 'concrete-block', 'road-platform': 'platform', 'heavy-weight': 'weight',
      'spring-pad': 'spring', ramp: 'platform', 'rubber-bumper': 'concrete-block',
      bomb: 'bomb', fan: 'fan', magnet: 'magnet', rocket: 'rocket', 'giant-hammer': 'giant-hammer',
      pistol: 'pistol', shotgun: 'shotgun', rifle: 'rifle', knife: 'knife', machete: 'machete', axe: 'axe', spear: 'spear',
      'ammo-box': 'ammo-box',
    };
    return aliases[type] ?? type;
  }

  private defaults(type: string): {
    size: THREE.Vector3; material: MaterialId; color: number; fixed: boolean; shape: 'box' | 'sphere' | 'cylinder';
    explosive?: boolean; projectile?: boolean; ccd?: boolean; mass?: number; motor?: boolean;
  } {
    const d = (size: [number, number, number], material: MaterialId, color: number, shape: 'box' | 'sphere' | 'cylinder' = 'box') => ({ size: new THREE.Vector3(...size), material, color, shape, fixed: false });
    const all: Record<string, ReturnType<typeof d> & { explosive?: boolean; projectile?: boolean; ccd?: boolean; mass?: number; motor?: boolean }> = {
      beam: d([0.42, 3.2, 0.42], 'wood', 0xa95f32),
      plank: d([2.4, 0.25, 0.7], 'wood', 0xc87b43),
      'wall-block': d([1.4, 0.75, 0.55], 'wood', 0xd18b50),
      'concrete-block': d([1.35, 1.05, 1.0], 'concrete', 0xa4a197),
      glass: d([1.4, 1.25, 0.12], 'glass', 0x99dfe6),
      crate: d([1.05, 1.05, 1.05], 'wood', 0xa96835),
      barrel: d([0.82, 1.25, 0.82], 'metal', 0x4b7691, 'cylinder'),
      'explosive-barrel': { ...d([0.85, 1.3, 0.85], 'metal', 0xe04c3f, 'cylinder'), explosive: true },
      ball: { ...d([0.65, 0.65, 0.65], 'rubber', 0xe7c746, 'sphere'), projectile: true, ccd: true, mass: 1.2 },
      'heavy-ball': { ...d([1.1, 1.1, 1.1], 'concrete', 0x4f5961, 'sphere'), projectile: true, ccd: true, mass: 12 },
      'metal-ball': { ...d([0.9, 0.9, 0.9], 'metal', 0x65737c, 'sphere'), projectile: true, ccd: true, mass: 9 },
      'explosive-projectile': { ...d([0.72, 0.72, 0.72], 'metal', 0xea6a3a, 'sphere'), projectile: true, ccd: true, explosive: true, mass: 4 },
      weight: { ...d([1.4, 1.4, 1.4], 'concrete', 0x6b6f70), mass: 25 },
      platform: d([3.2, 0.35, 1.8], 'wood', 0x9a673b),
      wheel: { ...d([1.15, 0.42, 1.15], 'rubber', 0x29313a, 'cylinder'), motor: true },
      // Campaign vehicle tires are ordinary destructible props. Unlike the
      // sandbox machine wheel, they receive no perpetual motor torque.
      'vehicle-wheel': d([0.86, 0.34, 0.86], 'plastic', 0x252a2e, 'cylinder'),
      motor: { ...d([0.85, 0.85, 0.85], 'metal', 0xe2a33c, 'cylinder'), motor: true },
      piston: { ...d([0.85, 1.8, 0.85], 'metal', 0x5a8296), motor: true },
      conveyor: { ...d([3.5, 0.4, 1.5], 'metal', 0x51616d), motor: true },
      spring: { ...d([0.65, 1.2, 0.65], 'metal', 0xe0bd3f), motor: true },
      'rope-anchor': { ...d([0.45, 0.45, 0.45], 'metal', 0x4b5358, 'sphere'), fixed: true },
      cannon: { ...d([1.6, 1.1, 1.2], 'metal', 0x455a67), fixed: true },
      roof: d([2.8, 0.32, 1.6], 'wood', 0x8e4930),
      chair: d([0.85, 1.2, 0.85], 'wood', 0xb2753f),
      table: d([1.8, 0.85, 1.2], 'wood', 0x9d6234),
      'metal-beam': d([0.42, 3.2, 0.42], 'metal', 0x657783),
      bomb: { ...d([0.85, 0.85, 0.85], 'metal', 0x30343b, 'sphere'), explosive: true },
      fan: { ...d([1.5, 1.5, 0.45], 'metal', 0x69a1ac), motor: true },
      magnet: { ...d([1.1, 1.1, 0.45], 'metal', 0xd94c4c), motor: true },
      rocket: { ...d([0.65, 1.8, 0.65], 'metal', 0xd15b3e, 'cylinder'), projectile: true, ccd: true, explosive: true },
      'giant-hammer': { ...d([2.4, 1.4, 1.3], 'metal', 0x5d6670), mass: 30 },
      pistol: { ...d(WEAPON_PROFILES.pistol.size, 'metal', WEAPON_PROFILES.pistol.color), mass: WEAPON_PROFILES.pistol.mass, ccd: true },
      shotgun: { ...d(WEAPON_PROFILES.shotgun.size, 'wood', WEAPON_PROFILES.shotgun.color), mass: WEAPON_PROFILES.shotgun.mass, ccd: true },
      rifle: { ...d(WEAPON_PROFILES.rifle.size, 'metal', WEAPON_PROFILES.rifle.color), mass: WEAPON_PROFILES.rifle.mass, ccd: true },
      knife: { ...d(WEAPON_PROFILES.knife.size, 'metal', WEAPON_PROFILES.knife.color), mass: WEAPON_PROFILES.knife.mass, ccd: true },
      machete: { ...d(WEAPON_PROFILES.machete.size, 'metal', WEAPON_PROFILES.machete.color), mass: WEAPON_PROFILES.machete.mass, ccd: true },
      axe: { ...d(WEAPON_PROFILES.axe.size, 'wood', WEAPON_PROFILES.axe.color), mass: WEAPON_PROFILES.axe.mass, ccd: true },
      spear: { ...d(WEAPON_PROFILES.spear.size, 'wood', WEAPON_PROFILES.spear.color), mass: WEAPON_PROFILES.spear.mass, ccd: true },
      'ammo-box': { ...d([0.82, 0.48, 0.58], 'metal', 0x526553), mass: 2.4 },
    };
    return all[type] ?? d([1, 1, 1], 'plastic', 0xe6a842);
  }

  private createBox(type: string, position: Vec3, size: THREE.Vector3, materialId: MaterialId, color: number, fixed: boolean, spawnedByPlayer: boolean, visualType = type): Entity | null {
    const bevel = Math.min(0.075, Math.min(size.x, size.y, size.z) * 0.12);
    const geometry = this.geometry(`rounded-box-${size.x.toFixed(2)}-${size.y.toFixed(2)}-${size.z.toFixed(2)}-${bevel.toFixed(3)}`, () => (
      new RoundedBoxGeometry(size.x, size.y, size.z, 2, bevel)
    ));
    const transparent = materialId === 'glass';
    const mesh = new THREE.Mesh(geometry, this.material(materialId, color, transparent, this.visualTextureRole(visualType, materialId)));
    return this.createEntity(type, mesh, position, size, materialId, fixed, spawnedByPlayer, RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2));
  }

  private createWeapon(kind: WeaponKind, position: Vec3, size: THREE.Vector3, materialId: MaterialId, color: number, fixed: boolean, spawnedByPlayer: boolean): Entity {
    const coreSizes: Readonly<Record<WeaponKind, [number, number, number]>> = {
      pistol: [0.82, 0.25, 0.2],
      shotgun: [1.62, 0.18, 0.19],
      rifle: [1.7, 0.22, 0.2],
      knife: [0.78, 0.13, 0.07],
      machete: [1.22, 0.19, 0.08],
      axe: [1.32, 0.13, 0.13],
      spear: [2.5, 0.1, 0.1],
    };
    const core = coreSizes[kind];
    const geometry = this.geometry(`weapon-core-${kind}`, () => new THREE.BoxGeometry(core[0], core[1], core[2]));
    const mesh = new THREE.Mesh(geometry, this.weaponMaterial(kind, 'core', color, kind === 'shotgun' || kind === 'spear' ? 0.12 : 0.62));
    return this.createEntity(
      kind,
      mesh,
      position,
      size,
      materialId,
      fixed,
      spawnedByPlayer,
      RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2),
    );
  }

  private addWeaponVisual(entity: Entity, kind: WeaponKind): void {
    const addBox = (
      key: string,
      dimensions: [number, number, number],
      position: [number, number, number],
      color: number,
      metalness = 0.45,
      rotationZ = 0,
    ) => {
      const geometry = this.geometry(`weapon-${kind}-${key}`, () => new THREE.BoxGeometry(...dimensions));
      const part = new THREE.Mesh(geometry, this.weaponMaterial(kind, key, color, metalness));
      part.position.set(...position);
      part.rotation.z = rotationZ;
      part.castShadow = true;
      part.receiveShadow = true;
      entity.object.add(part);
      return part;
    };

    if (kind === 'pistol') {
      addBox('slide', [0.88, 0.14, 0.18], [0.08, 0.13, 0], 0x2f3942, 0.74);
      addBox('muzzle', [0.2, 0.22, 0.21], [0.5, 0.08, 0], 0x59656b, 0.78);
      addBox('grip', [0.3, 0.52, 0.2], [-0.23, -0.25, 0], 0x6a4934, 0.08, -0.16);
      addBox('trigger', [0.18, 0.08, 0.08], [0.04, -0.12, 0], 0xd3ad4f, 0.48);
    } else if (kind === 'shotgun') {
      addBox('barrel', [1.48, 0.12, 0.12], [0.47, 0.11, 0], 0x303a40, 0.78);
      addBox('stock', [0.62, 0.38, 0.25], [-0.91, -0.03, 0], 0x704b32, 0.05, -0.12);
      addBox('pump', [0.44, 0.3, 0.27], [0.42, -0.09, 0], 0x8a5a36, 0.04);
      addBox('sight', [0.1, 0.08, 0.08], [0.96, 0.2, 0], 0xd8b657, 0.36);
    } else if (kind === 'rifle') {
      addBox('barrel', [1.18, 0.11, 0.11], [0.77, 0.1, 0], 0x26353a, 0.78);
      addBox('stock', [0.65, 0.36, 0.24], [-0.99, -0.05, 0], 0x4b643c, 0.1, -0.12);
      addBox('magazine', [0.32, 0.52, 0.19], [-0.04, -0.32, 0], 0x2f373a, 0.65, 0.14);
      addBox('sight', [0.46, 0.14, 0.14], [0.05, 0.23, 0], 0x59686b, 0.66);
      addBox('muzzle', [0.15, 0.2, 0.16], [1.24, 0.1, 0], 0x272e32, 0.82);
    } else if (kind === 'knife') {
      addBox('blade', [0.78, 0.18, 0.055], [0.34, 0.04, 0], 0xc8d5d8, 0.88);
      addBox('handle', [0.48, 0.25, 0.11], [-0.49, -0.02, 0], 0x403b34, 0.08);
      addBox('guard', [0.1, 0.38, 0.13], [-0.2, 0, 0], 0xd3a84d, 0.62);
    } else if (kind === 'machete') {
      addBox('blade', [1.22, 0.28, 0.075], [0.38, 0.06, 0], 0xaebcbe, 0.86, 0.04);
      addBox('tip', [0.28, 0.36, 0.075], [0.99, 0.09, 0], 0x9eabad, 0.86, 0.16);
      addBox('handle', [0.58, 0.28, 0.13], [-0.69, -0.04, 0], 0x4b372b, 0.05);
      addBox('guard', [0.1, 0.42, 0.14], [-0.38, 0, 0], 0xc79b42, 0.58);
    } else if (kind === 'axe') {
      addBox('handle', [1.46, 0.13, 0.13], [-0.14, -0.02, 0], 0x7a5133, 0.04);
      addBox('head', [0.44, 0.63, 0.15], [0.62, 0.18, 0], 0x8e9b9e, 0.82);
      addBox('bit', [0.28, 0.48, 0.13], [0.91, 0.2, 0], 0xb9c5c6, 0.88, -0.1);
      addBox('grip', [0.42, 0.19, 0.18], [-0.65, -0.02, 0], 0x48372c, 0.03);
    } else {
      addBox('shaft', [2.55, 0.1, 0.1], [-0.12, 0, 0], 0x855a37, 0.04);
      addBox('head', [0.42, 0.3, 0.1], [1.32, 0, 0], 0xb7c6c8, 0.86, -0.08);
      addBox('butt', [0.24, 0.18, 0.14], [-1.36, 0, 0], 0x51402f, 0.22);
      addBox('wrap', [0.44, 0.16, 0.15], [-0.68, 0, 0], 0x6b3740, 0.03);
    }
  }

  private createSphere(type: string, position: Vec3, radius: number, materialId: MaterialId, color: number, fixed: boolean, spawnedByPlayer: boolean, visualType = type): Entity | null {
    const geometry = this.geometry(`sphere-${radius.toFixed(2)}`, () => new THREE.SphereGeometry(radius, 12, 8));
    const mesh = new THREE.Mesh(geometry, this.material(materialId, color, false, this.visualTextureRole(visualType, materialId)));
    return this.createEntity(type, mesh, position, new THREE.Vector3(radius * 2, radius * 2, radius * 2), materialId, fixed, spawnedByPlayer, RAPIER.ColliderDesc.ball(radius));
  }

  private createCylinder(type: string, position: Vec3, size: THREE.Vector3, materialId: MaterialId, color: number, fixed: boolean, spawnedByPlayer: boolean, visualType = type): Entity | null {
    const radius = size.x / 2;
    const geometry = this.geometry(`cylinder-${radius.toFixed(2)}-${size.y.toFixed(2)}`, () => new THREE.CylinderGeometry(radius, radius, size.y, 10, 1, false));
    const mesh = new THREE.Mesh(geometry, this.material(materialId, color, false, this.visualTextureRole(visualType, materialId)));
    return this.createEntity(type, mesh, position, size, materialId, fixed, spawnedByPlayer, RAPIER.ColliderDesc.cylinder(size.y / 2, radius));
  }

  private createEntity(type: string, object: THREE.Mesh, position: Vec3, size: THREE.Vector3, materialId: MaterialId, fixed: boolean, spawnedByPlayer: boolean, colliderDesc: RAPIER.ColliderDesc): Entity {
    const profile = MATERIALS[materialId];
    object.position.set(position.x, position.y, position.z);
    object.castShadow = materialId !== 'glass';
    object.receiveShadow = true;
    const id = this.nextEntityId++;
    object.userData.entityId = id;
    this.scene.add(object);
    const bodyDesc = (fixed ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic())
      .setTranslation(position.x, position.y, position.z)
      .setLinearDamping(fixed ? 0 : 0.18)
      .setAngularDamping(fixed ? 0 : 0.38)
      .setSoftCcdPrediction(fixed ? 0 : 0.1)
      .setCanSleep(true);
    const body = this.world.createRigidBody(bodyDesc);
    body.userData = { entityId: id };
    const collider = this.world.createCollider(colliderDesc
      .setDensity(profile.density)
      .setFriction(profile.friction)
      .setRestitution(profile.restitution)
      .setContactSkin(fixed ? 0 : 0.003)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(90), body);
    const entity: Entity = {
      id, type, object, body, collider, size: size.clone(), material: materialId,
      health: profile.breakResistance, maxHealth: profile.breakResistance,
      breakThreshold: profile.breakResistance * 0.45, destructible: !fixed && materialId !== 'rubber', fixed,
      selected: false, spawnedByPlayer, previousVelocity: new THREE.Vector3(), lastImpactAt: Number.NEGATIVE_INFINITY,
    };
    this.entities.set(id, entity);
    this.colliderToEntity.set(collider.handle, id);
    return entity;
  }

  spawnCharacter(kind: CharacterKind, at: THREE.Vector3, friendly = false, label?: string): Character {
    const id = this.nextCharacterId++;
    const palettes: Record<CharacterKind, { skin: number; shirt: number; pants: number; accent: number; juice: number; armor: number; hp: number; tolerance: number }> = {
      human: { skin: 0xf2b784, shirt: 0x52a7a1, pants: 0x324a60, accent: 0xf4ca4f, juice: 0xff8fb1, armor: 0, hp: 100, tolerance: 11 },
      worker: { skin: 0xd99a67, shirt: 0xe5a537, pants: 0x35485c, accent: 0xf4d05f, juice: 0xffa95b, armor: 0.06, hp: 105, tolerance: 12 },
      knight: { skin: 0xe4aa7c, shirt: 0x758898, pants: 0x4c5966, accent: 0xd8c166, juice: 0xa6d8ff, armor: 0.32, hp: 145, tolerance: 16 },
      dummy: { skin: 0xf1ba78, shirt: 0xd85d54, pants: 0x44516a, accent: 0xf3da58, juice: 0xffdd55, armor: 0, hp: 90, tolerance: 10 },
      monster: { skin: 0x7cab5c, shirt: 0x684c83, pants: 0x3c4553, accent: 0xe1c75d, juice: 0x80e36a, armor: 0.04, hp: 115, tolerance: 12 },
      heavy: { skin: 0xc98664, shirt: 0x76517e, pants: 0x3f3b49, accent: 0xe2a94c, juice: 0xc987e8, armor: 0.18, hp: 175, tolerance: 20 },
      armored: { skin: 0xc9916d, shirt: 0x596b73, pants: 0x3d454c, accent: 0xd49b3a, juice: 0x77c8dd, armor: 0.45, hp: 190, tolerance: 22 },
      friendly: { skin: 0xf0b98a, shirt: 0x3f9c7a, pants: 0x394f64, accent: 0xffffff, juice: 0x68e5bb, armor: 0, hp: 100, tolerance: 12 },
    };
    const p = palettes[kind];
    const scale = kind === 'heavy' ? 1.2 : kind === 'armored' ? 1.08 : 1;
    const parts: Entity[] = [];
    const anatomicalJoints: AnatomicalJoint[] = [];
    const part = (name: string, offset: THREE.Vector3, size: THREE.Vector3, color: number, mass: number) => {
      const scaledOffset = offset.clone().multiplyScalar(scale);
      const scaledSize = size.clone().multiplyScalar(scale);
      const ent = this.createBox(`ragdoll-${name}`, {
        x: at.x + scaledOffset.x,
        y: at.y + scaledOffset.y,
        z: at.z + scaledOffset.z,
      }, scaledSize, 'toy', color, false, false)!;
      ent.characterId = id;
      ent.part = name;
      ent.health = 9999;
      ent.maxHealth = 9999;
      ent.destructible = false;
      if (ent.collider) {
        ent.collider.setMass(mass * scale);
        ent.collider.setFriction(0.68);
        ent.collider.setRestitution(0);
        ent.collider.setContactSkin(0.006);
        ent.collider.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
      }
      ent.body.setLinearDamping(1.05);
      ent.body.setAngularDamping(2.6);
      ent.body.setAdditionalSolverIterations(name === 'torso' ? 6 : 4);
      ent.body.setSoftCcdPrediction(0.16);
      parts.push(ent);
      return ent;
    };
    const torso = part('torso', new THREE.Vector3(0, 1.85, 0), new THREE.Vector3(0.72, 0.9, 0.42), p.shirt, 3);
    const head = part('head', new THREE.Vector3(0, 2.7, 0), new THREE.Vector3(0.68, 0.64, 0.62), p.skin, 1.2);
    const ual = part('upper-arm-l', new THREE.Vector3(-0.54, 2.02, 0), new THREE.Vector3(0.3, 0.62, 0.3), p.shirt, 0.8);
    const uar = part('upper-arm-r', new THREE.Vector3(0.54, 2.02, 0), new THREE.Vector3(0.3, 0.62, 0.3), p.shirt, 0.8);
    const lal = part('lower-arm-l', new THREE.Vector3(-0.57, 1.47, 0), new THREE.Vector3(0.27, 0.55, 0.27), p.skin, 0.65);
    const lar = part('lower-arm-r', new THREE.Vector3(0.57, 1.47, 0), new THREE.Vector3(0.27, 0.55, 0.27), p.skin, 0.65);
    const ull = part('upper-leg-l', new THREE.Vector3(-0.22, 1.02, 0), new THREE.Vector3(0.32, 0.65, 0.38), p.pants, 1.35);
    const ulr = part('upper-leg-r', new THREE.Vector3(0.22, 1.02, 0), new THREE.Vector3(0.32, 0.65, 0.38), p.pants, 1.35);
    const lll = part('lower-leg-l', new THREE.Vector3(-0.22, 0.43, 0), new THREE.Vector3(0.3, 0.58, 0.36), p.pants, 1);
    const llr = part('lower-leg-r', new THREE.Vector3(0.22, 0.43, 0), new THREE.Vector3(0.3, 0.58, 0.36), p.pants, 1);

    // Hands and shoes are compound colliders on the existing limb bodies. This
    // gives the visible extremities real contact and grab surfaces without four
    // extra rigid bodies or joints that would make the ragdoll less stable.
    const addExtremityCollider = (entity: Entity, description: RAPIER.ColliderDesc) => {
      const collider = this.world.createCollider(description
        .setFriction(0.74)
        .setRestitution(0)
        .setContactSkin(0.006)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(90)
        .setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS), entity.body);
      this.colliderToEntity.set(collider.handle, entity.id);
    };
    const handRadius = 0.145 * scale;
    for (const arm of [lal, lar]) {
      addExtremityCollider(arm, RAPIER.ColliderDesc.ball(handRadius)
        .setTranslation(0, -0.30 * scale, 0.01 * scale)
        .setMass(0.22 * scale));
    }
    for (const leg of [lll, llr]) {
      addExtremityCollider(leg, RAPIER.ColliderDesc.cuboid(0.16 * scale, 0.075 * scale, 0.23 * scale)
        .setTranslation(0, -0.245 * scale, 0.075 * scale)
        .setMass(0.34 * scale));
    }

    const worldJointPoint = (x: number, y: number, z = 0) => new THREE.Vector3(
      at.x + x * scale,
      at.y + y * scale,
      at.z + z * scale,
    );
    const localAnchor = (entity: Entity, point: THREE.Vector3): Vec3 => {
      const bodyPosition = entity.body.translation();
      const bodyRotation = entity.body.rotation();
      const inverseRotation = new THREE.Quaternion(bodyRotation.x, bodyRotation.y, bodyRotation.z, bodyRotation.w).invert();
      return vec(point.clone().sub(new THREE.Vector3(bodyPosition.x, bodyPosition.y, bodyPosition.z)).applyQuaternion(inverseRotation));
    };
    const bodyJoint = (
      id: AnatomicalJointId,
      a: Entity,
      b: Entity,
      point: THREE.Vector3,
      limits: [number, number],
      stiffness: number,
      damping: number,
    ) => {
      const axis = { x: 0, y: 0, z: 1 };
      const localAnchorProximal = localAnchor(a, point);
      const localAnchorDistal = localAnchor(b, point);
      const data = RAPIER.JointData.revolute(localAnchorProximal, localAnchorDistal, axis);
      const created = this.world.createImpulseJoint(data, a.body, b.body, true) as RAPIER.RevoluteImpulseJoint;
      created.setContactsEnabled(false);
      created.setLimits(limits[0], limits[1]);
      created.configureMotorModel(RAPIER.MotorModel.AccelerationBased);
      created.configureMotorPosition(0, stiffness, damping);
      anatomicalJoints.push({
        id,
        proximal: a.id,
        distal: b.id,
        localAnchorProximal,
        localAnchorDistal,
        detached: false,
        joint: created,
      });
      return created;
    };

    // Every pair is anchored to one shared world point, so waking never starts
    // with a hidden correction. Restrained Z-axis joints keep the silhouette
    // readable and add modest pose resistance while preserving knockdown play.
    bodyJoint('neck', torso, head, worldJointPoint(0, 2.34), [-0.45, 0.45], 12, 4);
    bodyJoint('shoulder-l', torso, ual, worldJointPoint(-0.375, 2.15), [-1.9, 1.9], 7, 2.8);
    bodyJoint('shoulder-r', torso, uar, worldJointPoint(0.375, 2.15), [-1.9, 1.9], 7, 2.8);
    bodyJoint('elbow-l', ual, lal, worldJointPoint(-0.555, 1.7275), [-2.2, 0.08], 8, 3);
    bodyJoint('elbow-r', uar, lar, worldJointPoint(0.555, 1.7275), [-0.08, 2.2], 8, 3);
    bodyJoint('hip-l', torso, ull, worldJointPoint(-0.22, 1.3725), [-0.95, 0.95], 11, 3.6);
    bodyJoint('hip-r', torso, ulr, worldJointPoint(0.22, 1.3725), [-0.95, 0.95], 11, 3.6);
    bodyJoint('knee-l', ull, lll, worldJointPoint(-0.22, 0.7075), [-0.05, 1.7], 12, 3.8);
    bodyJoint('knee-r', ulr, llr, worldJointPoint(0.22, 0.7075), [-1.7, 0.05], 12, 3.8);
    decorateCharacter(parts, kind, p);
    const character: Character = {
      id, kind, parts, health: p.hp, maxHealth: p.hp, armor: p.armor, tolerance: p.tolerance,
      juice: p.juice, unconscious: false, unconsciousTime: 0, defeated: false,
      friendly: friendly || kind === 'friendly', name: label ?? this.characterName(kind, id),
      anatomicalJoints, detachedParts: new Set(), dismembermentCount: 0,
    };
    this.characters.set(id, character);
    // Begin in a stable toy pose. Rapier wakes the linked bodies naturally as
    // soon as debris, a projectile, or a moving floor disturbs them.
    for (const piece of parts) piece.body.sleep();
    return character;
  }

  private characterName(kind: CharacterKind, id: number): string {
    const names: Record<CharacterKind, string[]> = {
      human: ['Pip', 'Tess'], worker: ['Bolt', 'Nails'], knight: ['Sir Bonk', 'Dame Clank'], dummy: ['Bop', 'Thunk', 'Wobble'],
      monster: ['Muck', 'Gloop'], heavy: ['Big Unit', 'Chunk'], armored: ['Tinhead', 'Rivet'], friendly: ['Buddy', 'Scout'],
    };
    const list = names[kind];
    return list[(id - 1) % list.length];
  }

  private anatomicalWorldPoint(entity: Entity, localAnchor: Vec3): THREE.Vector3 {
    if (!entity.body.isValid()) return entity.object.position.clone();
    const position = entity.body.translation();
    const rotation = entity.body.rotation();
    return new THREE.Vector3(localAnchor.x, localAnchor.y, localAnchor.z)
      .applyQuaternion(new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w))
      .add(new THREE.Vector3(position.x, position.y, position.z));
  }

  /** Remove one live anatomical constraint, then immediately drop its WASM wrapper. */
  private releaseAnatomicalJoint(joint: AnatomicalJoint): boolean {
    if (joint.detached) return false;
    const wrapper = joint.joint;
    joint.joint = undefined;
    joint.detached = true;
    if (!wrapper || !wrapper.isValid()) return false;
    this.world.removeImpulseJoint(wrapper, true);
    return true;
  }

  private refreshDetachedParts(character: Character): void {
    const torso = character.parts.find((part) => part.part === 'torso');
    const connected = new Set<number>(torso ? [torso.id] : []);
    let changed = true;
    while (changed) {
      changed = false;
      for (const joint of character.anatomicalJoints) {
        if (joint.detached || !connected.has(joint.proximal) || connected.has(joint.distal)) continue;
        connected.add(joint.distal);
        changed = true;
      }
    }
    character.detachedParts.clear();
    for (const part of character.parts) {
      part.detachedFromCharacter = !connected.has(part.id);
      if (part.detachedFromCharacter) character.detachedParts.add(part.id);
    }
  }

  private addAnatomicalStump(entity: Entity, anchor: Vec3, jointId: AnatomicalJointId, side: 'proximal' | 'distal'): void {
    const key = `stump-${jointId}-${side}`;
    if (entity.object.children.some((child) => child.userData.anatomicalStump === key)) return;
    let material = this.materials.get('anatomical-stump-deep-red');
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        color: 0x4a0008,
        emissive: 0x170002,
        emissiveIntensity: 0.32,
        roughness: 0.94,
        metalness: 0,
        flatShading: true,
      });
      this.materials.set('anatomical-stump-deep-red', material);
    }
    const cap = new THREE.Mesh(
      this.geometry('anatomical-stump-block', () => new RoundedBoxGeometry(1, 1, 1, 1, 0.16)),
      material,
    );
    const capSize = THREE.MathUtils.clamp(Math.min(entity.size.x, entity.size.y, entity.size.z) * 0.48, 0.12, 0.24);
    cap.position.set(anchor.x, anchor.y, anchor.z);
    cap.scale.setScalar(capSize);
    cap.castShadow = true;
    cap.userData.ignorePick = true;
    cap.userData.anatomicalStump = key;
    entity.object.add(cap);
  }

  private severAnatomicalJoint(
    character: Character,
    joint: AnatomicalJoint,
    direction: THREE.Vector3,
    severity: number,
    emit = true,
  ): boolean {
    if (this.characters.get(character.id) !== character || joint.detached) return false;
    const proximal = this.entities.get(joint.proximal);
    const detachedRoot = this.entities.get(joint.distal);
    if (!proximal || !detachedRoot || proximal.characterId !== character.id || detachedRoot.characterId !== character.id) return false;
    const point = this.anatomicalWorldPoint(proximal, joint.localAnchorProximal);
    if (!this.releaseAnatomicalJoint(joint)) return false;

    this.addAnatomicalStump(proximal, joint.localAnchorProximal, joint.id, 'proximal');
    this.addAnatomicalStump(detachedRoot, joint.localAnchorDistal, joint.id, 'distal');
    this.refreshDetachedParts(character);
    character.dismembermentCount++;
    for (const partId of character.detachedParts) this.entities.get(partId)?.body.wakeUp();

    if (emit) {
      const sprayDirection = direction.lengthSq() > 1e-8
        ? direction.clone().normalize()
        : detachedRoot.object.position.clone().sub(proximal.object.position).normalize();
      this.events.onDismemberment?.({
        character,
        proximal,
        detachedRoot,
        joint: joint.id,
        point,
        direction: sprayDirection,
        severity: THREE.MathUtils.clamp(severity, 1.25, 3),
      });
    }
    return true;
  }

  private closestLiveAnatomicalJoint(character: Character, struck: Entity, point: THREE.Vector3): AnatomicalJoint | undefined {
    // A limb collider always owns one anatomical root. Do not let a hit on an
    // already detached forearm choose an unrelated live shoulder across the
    // torso; before detachment, this gives hands/elbows/knees deterministic
    // local sever points even when the contact manifold is near an edge.
    const directRoot = character.anatomicalJoints.find((joint) => joint.distal === struck.id);
    if (directRoot) return directRoot.detached ? undefined : directRoot;
    const torso = character.parts.find((part) => part.part === 'torso');
    if (!torso || struck.id !== torso.id) return undefined;
    let closest: AnatomicalJoint | undefined;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const joint of character.anatomicalJoints) {
      // Torso hits may tear only one of its five root joints: neck, either
      // shoulder, or either hip. Distal elbows/knees are not plausible choices.
      if (joint.detached || joint.proximal !== torso.id) continue;
      const proximal = this.entities.get(joint.proximal);
      if (!proximal) continue;
      const distance = this.anatomicalWorldPoint(proximal, joint.localAnchorProximal).distanceToSquared(point);
      if (distance < closestDistance) {
        closest = joint;
        closestDistance = distance;
      }
    }
    // Torso hits can tear a nearby root joint, but never a remote limb.
    return closestDistance <= 1.05 * 1.05 ? closest : undefined;
  }

  private explosionJointResistance(character: Character, joint: AnatomicalJoint): number {
    const base = joint.id === 'neck'
      ? 32
      : joint.id.startsWith('shoulder') || joint.id.startsWith('hip')
        ? 28
        : 22;
    return base * (1 + character.armor * 0.82) + character.tolerance * 0.12;
  }

  private tryRockDismemberment(
    character: Character,
    struck: Entity,
    rock: Entity,
    point: THREE.Vector3,
    impulse: number,
    closingSpeed: number,
    impactEnergy: number,
  ): boolean {
    if (
      this.entities.get(rock.id) !== rock
      || !rock.body.isValid()
      || !rock.projectile
      || !['ball', 'heavy-ball', 'metal-ball'].includes(rock.type)
    ) return false;
    const joint = this.closestLiveAnatomicalJoint(character, struck, point);
    if (!joint) return false;
    // Energy handles the common case where a fast, massive projectile transfers
    // a modest solver impulse to one light limb. A minimum closing speed keeps a
    // heavy ball resting/rolling against a ragdoll from tearing it apart.
    const minimumSpeed = rock.type === 'heavy-ball' ? 7.5 : rock.type === 'metal-ball' ? 8.5 : 10.5;
    if (closingSpeed < minimumSpeed || impulse < 3.1) return false;
    const baseEnergy = joint.id === 'neck'
      ? 210
      : joint.id.startsWith('shoulder') || joint.id.startsWith('hip')
        ? 175
        : 100;
    const projectileModifier = rock.type === 'heavy-ball' ? 0.7 : rock.type === 'metal-ball' ? 0.78 : 1;
    const threshold = (baseEnergy + character.tolerance * 2.2) * (1 + character.armor * 1.1) * projectileModifier;
    if (impactEnergy < threshold) return false;
    const direction = rock.previousVelocity.clone().sub(struck.previousVelocity);
    if (direction.lengthSq() < 1e-8) direction.copy(struck.object.position).sub(rock.object.position);
    return this.severAnatomicalJoint(character, joint, direction, 1.4 + impactEnergy / Math.max(180, threshold * 2.2));
  }

  private contactImpactEnergy(struck: Entity, source: Entity | undefined, closingSpeed: number): number {
    if (!Number.isFinite(closingSpeed) || closingSpeed <= 0) return 0;
    let impactMass = struck.body.isValid() ? struck.body.mass() : 0;
    if (source && !source.fixed && source.body.isValid()) impactMass = source.body.mass();
    impactMass = THREE.MathUtils.clamp(Number.isFinite(impactMass) ? impactMass : 0, 0.08, 45);
    return 0.5 * impactMass * closingSpeed * closingSpeed;
  }

  private contactImpactDamage(source: Entity | undefined, impulse: number, closingSpeed: number, energy: number): number {
    if (closingSpeed < 2.35 || impulse < 2.2 || energy <= 0) return 0;
    const projectileMultiplier = source?.type === 'heavy-ball'
      ? 1.12
      : source?.type === 'metal-ball'
        ? 1.08
        : 1;
    // Impulse covers dense low-speed crushing while sqrt(energy) makes a fast
    // projectile or a massive falling prop count even when it strikes one light
    // limb and Rapier reports only the momentum transferred to that limb.
    return THREE.MathUtils.clamp(
      Math.max(impulse * 2.05, Math.sqrt(energy) * 3.2 * projectileMultiplier),
      0,
      165,
    );
  }

  private contactSourceKey(characterId: number, source: Entity | undefined): string {
    return `${characterId}:${source?.id ?? 'world'}`;
  }

  private pruneContactCooldowns(): void {
    const maximumEntries = Math.max(320, this.maxBodies * 3);
    const cutoff = this.simulationTime - 2;
    for (const cooldowns of [this.characterSourceImpactTimes, this.characterSourceDismembermentTimes]) {
      if (cooldowns.size <= maximumEntries) continue;
      for (const [key, time] of cooldowns) if (time < cutoff) cooldowns.delete(key);
    }
  }

  /** Restore optional serialized injury state without replaying sounds or gore. */
  restoreCharacterState(
    character: Character,
    state: { health: number; unconscious: boolean; defeated: boolean; severedJoints: AnatomicalJointId[] },
  ): void {
    if (this.characters.get(character.id) !== character) return;
    const severed = new Set(state.severedJoints);
    for (const joint of character.anatomicalJoints) {
      if (!severed.has(joint.id)) continue;
      const proximal = this.entities.get(joint.proximal);
      const distal = this.entities.get(joint.distal);
      const direction = proximal && distal
        ? distal.object.position.clone().sub(proximal.object.position)
        : new THREE.Vector3(0, 1, 0);
      this.severAnatomicalJoint(character, joint, direction, 1.5, false);
    }
    character.health = THREE.MathUtils.clamp(state.health, 0, character.maxHealth);
    character.unconscious = Boolean(state.unconscious || state.defeated);
    character.defeated = Boolean(state.defeated);
    character.unconsciousTime = character.defeated ? 999 : character.unconscious ? Math.max(character.unconsciousTime, 2.5) : 0;
  }

  private addBarrelBands(object: THREE.Object3D): void {
    const group = new THREE.Group();
    const geo = this.geometry('barrel-band', () => new THREE.TorusGeometry(0.42, 0.04, 4, 10));
    const mat = this.material('band', 0x2f3942, false, 'metal');
    for (const y of [-0.38, 0.38]) {
      const band = new THREE.Mesh(geo, mat);
      band.rotation.x = Math.PI / 2;
      band.position.y = y;
      group.add(band);
    }
    object.add(group);
  }

  private addCrateBraces(object: THREE.Object3D): void {
    const mat = this.material('crate-brace', 0x6f4126, false, 'wood');
    for (const z of [-0.531, 0.531]) {
      const brace = new THREE.Mesh(this.geometry('crate-brace', () => new RoundedBoxGeometry(1.22, 0.12, 0.035, 1, 0.015)), mat);
      brace.position.z = z;
      brace.rotation.z = Math.PI / 4;
      object.add(brace);
    }
  }

  private addSpringVisual(object: THREE.Object3D): void {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      points.push(new THREE.Vector3(Math.sin(t * Math.PI * 8) * 0.22, t * 1.05 - 0.52, Math.cos(t * Math.PI * 8) * 0.22));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xffe169 }));
    object.add(line);
  }

  private addCannonVisual(object: THREE.Object3D): void {
    const tube = new THREE.Mesh(
      this.geometry('cannon-tube', () => new THREE.CylinderGeometry(0.28, 0.4, 1.8, 10)),
      this.material('cannon-tube', 0x2b3640, false, 'factory'),
    );
    tube.rotation.z = Math.PI / 2;
    tube.position.set(0.7, 0.35, 0);
    object.add(tube);
  }

  private addPistonVisual(object: THREE.Object3D): void {
    const cap = new THREE.Mesh(
      this.geometry('piston-cap', () => new RoundedBoxGeometry(1.25, 0.2, 1.25, 2, 0.045)),
      this.material('piston-cap', 0xd7a634, false, 'hazard'),
    );
    cap.position.y = 1;
    object.add(cap);
  }

  private addConveyorVisual(object: THREE.Object3D): void {
    const mat = this.material('conveyor-stripe', 0xe1ac35, false, 'hazard');
    for (let x = -1.4; x <= 1.4; x += 0.55) {
      const stripe = new THREE.Mesh(this.geometry('conveyor-stripe', () => new RoundedBoxGeometry(0.22, 0.04, 1.4, 1, 0.012)), mat);
      stripe.position.set(x, 0.23, 0);
      object.add(stripe);
    }
  }

  private hasConnectorPath(startId: number, targetId: number): boolean {
    const pending = [startId];
    const visited = new Set<number>();
    while (pending.length) {
      const current = pending.pop()!;
      if (current === targetId) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      // Anatomical joints aren't listed in `connectors`, so treat every part
      // of one ragdoll as the same connected component. This prevents a user
      // from closing a solver loop through two different limbs.
      const currentCharacterId = this.entities.get(current)?.characterId;
      if (currentCharacterId !== undefined) {
        const character = this.characters.get(currentCharacterId);
        for (const part of character?.parts ?? []) if (!visited.has(part.id)) pending.push(part.id);
      }
      for (const connector of this.connectors.values()) {
        if (connector.a === current && !visited.has(connector.b)) pending.push(connector.b);
        else if (connector.b === current && !visited.has(connector.a)) pending.push(connector.a);
      }
    }
    return false;
  }

  createConnector(type: Connector['type'], a: Entity, b: Entity, restLength?: number): Connector | null {
    if (
      a.id === b.id
      || (a.fixed && b.fixed)
      || this.entities.get(a.id) !== a
      || this.entities.get(b.id) !== b
      // Constraint loops are exceptionally easy to overconstrain once their
      // bodies also touch. Keep explicit connector assemblies as sparse trees.
      || this.hasConnectorPath(a.id, b.id)
    ) return null;
    const measuredDistance = a.object.position.distanceTo(b.object.position);
    const requestedLength = Number.isFinite(restLength) && restLength! > 0 ? restLength! : measuredDistance;
    // A rope is allowed to start slack, but never shorter than its current span:
    // restoring a malformed/old save must not catapult two distant bodies together.
    // Springs retain some authored preload, bounded to a safe correction range.
    const distance = type === 'rope'
      ? Math.max(0.05, measuredDistance, requestedLength)
      : type === 'spring'
        ? THREE.MathUtils.clamp(requestedLength, Math.max(0.05, measuredDistance * 0.82), Math.max(0.05, measuredDistance * 1.5 + 0.5))
        : requestedLength;
    const pa = a.body.translation();
    const pb = b.body.translation();
    const midpoint = new THREE.Vector3((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, (pa.z + pb.z) / 2);
    const qaRaw = a.body.rotation();
    const qbRaw = b.body.rotation();
    const inverseA = new THREE.Quaternion(qaRaw.x, qaRaw.y, qaRaw.z, qaRaw.w).invert();
    const inverseB = new THREE.Quaternion(qbRaw.x, qbRaw.y, qbRaw.z, qbRaw.w).invert();
    const localA = midpoint.clone().sub(new THREE.Vector3(pa.x, pa.y, pa.z)).applyQuaternion(inverseA);
    const localB = midpoint.clone().sub(new THREE.Vector3(pb.x, pb.y, pb.z)).applyQuaternion(inverseB);
    let data: RAPIER.JointData;
    let springStiffness = 35;
    let springDamping = 3.5;
    if (type === 'rope') data = RAPIER.JointData.rope(distance, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    else if (type === 'spring') {
      const massA = Math.max(0.05, a.body.mass());
      const massB = Math.max(0.05, b.body.mass());
      const effectiveMass = THREE.MathUtils.clamp(
        a.fixed ? massB : b.fixed ? massA : massA * massB / (massA + massB),
        0.25,
        12,
      );
      const angularFrequency = Math.PI * 2 * 1.8;
      springStiffness = effectiveMass * angularFrequency * angularFrequency;
      springDamping = 2 * 0.95 * effectiveMass * angularFrequency;
      data = RAPIER.JointData.spring(distance, springStiffness, springDamping, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    }
    else if (type === 'hinge' || type === 'motor') {
      // Rapier's revolute descriptor uses one local axis for both bodies. For
      // differently rotated bodies, the relative rotation's eigen-axis is the
      // only local vector that resolves to the same world axis on both sides.
      // Using body A's local world-Z for both made body B snap on creation.
      const relative = inverseA.clone().multiply(new THREE.Quaternion(qbRaw.x, qbRaw.y, qbRaw.z, qbRaw.w));
      const localAxis = new THREE.Vector3(relative.x, relative.y, relative.z);
      if (localAxis.lengthSq() < 1e-10) localAxis.set(0, 0, 1).applyQuaternion(inverseA);
      localAxis.normalize();
      data = RAPIER.JointData.revolute(vec(localA), vec(localB), vec(localAxis));
    } else {
      // Both local frames resolve to the same identity frame in world space.
      // UNIT_Q/UNIT_Q was only valid for equally-rotated bodies and made every
      // rotated auto-weld snap violently on its first solver iteration.
      data = RAPIER.JointData.fixed(vec(localA), {
        x: inverseA.x, y: inverseA.y, z: inverseA.z, w: inverseA.w,
      }, vec(localB), {
        x: inverseB.x, y: inverseB.y, z: inverseB.z, w: inverseB.w,
      });
    }
    const joint = this.world.createImpulseJoint(data, a.body, b.body, true);
    joint.setContactsEnabled(false);
    if (type === 'motor' && 'configureMotorVelocity' in joint) {
      const motor = joint as RAPIER.RevoluteImpulseJoint;
      motor.configureMotorModel(RAPIER.MotorModel.AccelerationBased);
      motor.configureMotorVelocity(4.5, 0.45);
    }
    const line = this.createConnectorLine(type);
    this.scene.add(line);
    const connector: Connector = {
      id: this.nextConnectorId++, type, a: a.id, b: b.id, joint,
      restLength: distance, stiffness: springStiffness, damping: springDamping,
      breakForce: type === 'weld' ? 140 : type === 'hinge' ? 110 : 85, line,
    };
    this.connectors.set(connector.id, connector);
    this.audio?.play(type === 'spring' ? 'spring' : 'ui');
    return connector;
  }

  private createConnectorLine(type: Connector['type']): THREE.Line {
    const colors = { weld: 0xf3c94b, rope: 0xd89c61, spring: 0x6ed2e1, hinge: 0xef7c5b, motor: 0x75da7b };
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: colors[type], linewidth: 2 }));
  }

  removeConnector(id: number): void {
    const c = this.connectors.get(id);
    if (!c) return;
    if (c.joint?.isValid()) this.world.removeImpulseJoint(c.joint, true);
    if (c.line) this.scene.remove(c.line);
    this.connectors.delete(id);
  }

  removeEntity(entityOrId: Entity | number): void {
    const entity = typeof entityOrId === 'number' ? this.entities.get(entityOrId) : entityOrId;
    if (!entity) return;
    for (const c of [...this.connectors.values()]) if (c.a === entity.id || c.b === entity.id) this.removeConnector(c.id);
    const owningCharacter = entity.characterId !== undefined ? this.characters.get(entity.characterId) : undefined;
    if (owningCharacter) {
      // Explicitly release anatomy before removing its rigid body. Rapier also
      // removes attached joints, but doing it here prevents any retained JS
      // wrapper from being queried after the body has been freed.
      for (const joint of owningCharacter.anatomicalJoints) {
        if (!joint.detached && (joint.proximal === entity.id || joint.distal === entity.id)) this.releaseAnatomicalJoint(joint);
      }
    }
    this.scene.remove(entity.object);
    if (entity.body.isValid()) {
      // Character hands and feet are additional colliders on the same body.
      // Clear every handle so delayed contact events cannot resolve to a dead
      // entity after the body is removed.
      for (let i = 0; i < entity.body.numColliders(); i++) {
        this.colliderToEntity.delete(entity.body.collider(i).handle);
      }
      this.world.removeRigidBody(entity.body);
    }
    this.entities.delete(entity.id);
    if (entity.characterId !== undefined) {
      const character = this.characters.get(entity.characterId);
      if (character) {
        character.parts = character.parts.filter((p) => p.id !== entity.id);
        character.detachedParts.delete(entity.id);
        if (!character.parts.length) this.characters.delete(character.id);
        else this.refreshDetachedParts(character);
      }
    }
  }

  setFixed(entity: Entity, fixed: boolean): void {
    if (entity.characterId !== undefined || [...this.connectors.values()].some((connector) => connector.a === entity.id || connector.b === entity.id)) return;
    entity.body.setBodyType(fixed ? RAPIER.RigidBodyType.Fixed : RAPIER.RigidBodyType.Dynamic, true);
    entity.fixed = fixed;
  }

  rotateEntity(entity: Entity, axis = 'y', amount = Math.PI / 8): void {
    if (entity.characterId !== undefined || [...this.connectors.values()].some((connector) => connector.a === entity.id || connector.b === entity.id)) return;
    const q = entity.body.rotation();
    const current = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    const delta = new THREE.Quaternion().setFromAxisAngle(axis === 'x' ? new THREE.Vector3(1, 0, 0) : axis === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0), amount);
    current.multiply(delta);
    entity.body.setRotation({ x: current.x, y: current.y, z: current.z, w: current.w }, true);
  }

  applyPush(entity: Entity, direction: THREE.Vector3, strength = 12): void {
    if (entity.fixed || this.entities.get(entity.id) !== entity || direction.lengthSq() < 1e-8) return;
    const mass = THREE.MathUtils.clamp(entity.body.mass(), 0.05, 16);
    const targetDeltaVelocity = THREE.MathUtils.clamp(strength * 0.68, 0, 12);
    entity.body.applyImpulse(vec(direction.clone().normalize().multiplyScalar(mass * targetDeltaVelocity)), true);
    this.audio?.play('impact');
  }

  reloadWeapon(entity: Entity): boolean {
    const weapon = entity.weapon;
    if (!weapon || weapon.mode !== 'firearm' || this.entities.get(entity.id) !== entity) return false;
    const needed = weapon.magazineSize - weapon.ammo;
    if (needed <= 0 || weapon.reserveAmmo <= 0) return false;
    const loaded = Math.min(needed, weapon.reserveAmmo);
    weapon.ammo += loaded;
    weapon.reserveAmmo -= loaded;
    this.audio?.play('metal', 0.45);
    return true;
  }

  restockWeapon(entity: Entity): boolean {
    const weapon = entity.weapon;
    if (!weapon || weapon.mode !== 'firearm' || this.entities.get(entity.id) !== entity) return false;
    const beforeAmmo = weapon.ammo;
    const beforeReserve = weapon.reserveAmmo;
    weapon.reserveAmmo = Math.min(weapon.magazineSize * 8, weapon.reserveAmmo + weapon.magazineSize * 3);
    if (weapon.ammo === 0) this.reloadWeapon(entity);
    return weapon.ammo !== beforeAmmo || weapon.reserveAmmo !== beforeReserve;
  }

  useWeapon(entity: Entity, target: THREE.Vector3): WeaponUseResult {
    const weapon = entity.weapon;
    if (
      !weapon
      || this.entities.get(entity.id) !== entity
      || !entity.body.isValid()
      || ![target.x, target.y, target.z].every(Number.isFinite)
    ) return { used: false, reason: 'invalid', impacts: [] };

    const profile = WEAPON_PROFILES[weapon.kind];
    if (this.simulationTime - weapon.lastUseAt < profile.cooldown) {
      return {
        used: false, reason: 'cooldown', kind: weapon.kind, mode: weapon.mode, impacts: [],
        ammo: weapon.ammo, reserveAmmo: weapon.reserveAmmo,
      };
    }
    if (weapon.mode === 'firearm' && weapon.ammo <= 0) {
      return {
        used: false, reason: 'empty', kind: weapon.kind, mode: weapon.mode, impacts: [],
        ammo: weapon.ammo, reserveAmmo: weapon.reserveAmmo,
      };
    }

    weapon.lastUseAt = this.simulationTime;
    return weapon.mode === 'firearm'
      ? this.firePhysicalWeapon(entity, target, profile)
      : this.swingPhysicalWeapon(entity, target, profile);
  }

  private firePhysicalWeapon(entity: Entity, target: THREE.Vector3, profile: WeaponProfile): WeaponUseResult {
    const weapon = entity.weapon!;
    weapon.ammo = Math.max(0, weapon.ammo - 1);
    const position = entity.body.translation();
    const rotation = entity.body.rotation();
    const quaternion = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    const origin = new THREE.Vector3(position.x, position.y, position.z).add(
      new THREE.Vector3(entity.size.x * 0.52 + 0.06, entity.size.y * 0.12, 0).applyQuaternion(quaternion),
    );
    const aimDirection = target.clone().sub(origin);
    if (aimDirection.lengthSq() < 1e-8) aimDirection.set(1, 0, 0).applyQuaternion(quaternion);
    aimDirection.normalize();
    const impacts: WeaponImpact[] = [];
    const characterHits = new Map<number, {
      entity: Entity;
      rawDamage: number;
      point: THREE.Vector3;
      direction: THREE.Vector3;
      pellets: number;
      strongestPellet: number;
    }>();
    let centralEnd = origin.clone().addScaledVector(aimDirection, profile.range);

    const right = new THREE.Vector3().crossVectors(aimDirection, new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() < 1e-8) right.crossVectors(aimDirection, new THREE.Vector3(0, 0, 1));
    right.normalize();
    const up = new THREE.Vector3().crossVectors(right, aimDirection).normalize();
    // Raycaster consumes Object3D.matrixWorld. The renderer normally refreshes
    // it, but a newly spawned weapon can be fired before the next render (and
    // deterministic physics tests intentionally run without a renderer).
    this.scene.updateMatrixWorld(true);
    for (let pellet = 0; pellet < profile.pellets; pellet++) {
      const direction = aimDirection.clone();
      if (profile.spread > 0) {
        direction
          .addScaledVector(right, (Math.random() * 2 - 1) * profile.spread)
          .addScaledVector(up, (Math.random() * 2 - 1) * profile.spread)
          .normalize();
      }
      // Keep hitscan queries render-side. Querying Rapier and then mutating a
      // hit body from the same pointer callback can retain a WASM scene-query
      // borrow until the next frame on some browsers. Three's scene ray is
      // exact for these visible box-built weapons/targets and cannot lock the
      // physics world.
      const raycaster = new THREE.Raycaster(origin, direction, 0, profile.range);
      let visualHit: THREE.Intersection | undefined;
      let hitEntity: Entity | undefined;
      for (const intersection of raycaster.intersectObjects([...this.entities.values()].map((candidate) => candidate.object), true)) {
        let hitObject: THREE.Object3D | null = intersection.object;
        while (hitObject && !hitObject.userData.entityId) hitObject = hitObject.parent;
        const candidate = hitObject ? this.entities.get(hitObject.userData.entityId) : undefined;
        if (!candidate || candidate.id === entity.id) continue;
        visualHit = intersection;
        hitEntity = candidate;
        break;
      }
      if (!visualHit) continue;
      const point = visualHit.point.clone();
      const normal = hitEntity
        ? point.clone().sub(hitEntity.object.position).normalize()
        : direction.clone().negate();
      impacts.push({ point, normal, entity: hitEntity });
      if (pellet === 0) centralEnd = point.clone();
      if (hitEntity && hitEntity.id !== entity.id) {
        if (hitEntity.characterId !== undefined) {
          const localizedDamage = this.localizedWeaponDamage(hitEntity, profile.damage);
          const existing = characterHits.get(hitEntity.characterId);
          if (existing) {
            existing.rawDamage = Math.min(profile.damage * 4.8, existing.rawDamage + localizedDamage);
            existing.pellets++;
            if (localizedDamage > existing.strongestPellet) {
              existing.strongestPellet = localizedDamage;
              existing.entity = hitEntity;
              existing.point.copy(point);
              existing.direction.copy(direction);
            }
          } else {
            characterHits.set(hitEntity.characterId, {
              entity: hitEntity,
              rawDamage: localizedDamage,
              point: point.clone(),
              direction: direction.clone(),
              pellets: 1,
              strongestPellet: localizedDamage,
            });
          }
        } else {
          this.applyWeaponHit(hitEntity, profile.damage, point, direction, profile.impulse);
        }
      }
    }

    // A scattergun may intersect several limbs, but it is one trigger event.
    // Aggregate per character so armor/tolerance and gore callbacks run once,
    // with a hard cap that prevents eight solver-safe pellets becoming eight
    // independent ragdoll impulses.
    for (const hit of characterHits.values()) {
      const aggregateImpulse = profile.impulse * THREE.MathUtils.clamp(Math.sqrt(hit.pellets), 1, 2);
      this.applyWeaponHit(hit.entity, hit.rawDamage, hit.point, hit.direction, aggregateImpulse, true);
    }

    if (!entity.fixed) {
      const mass = THREE.MathUtils.clamp(entity.body.mass(), 0.2, 8);
      const recoilDeltaVelocity = weapon.kind === 'shotgun' ? 0.72 : weapon.kind === 'rifle' ? 0.38 : 0.28;
      entity.body.applyImpulse(vec(aimDirection.clone().multiplyScalar(-mass * recoilDeltaVelocity)), true);
      const side = new THREE.Vector3().crossVectors(aimDirection, new THREE.Vector3(0, 1, 0));
      if (side.lengthSq() > 1e-8) {
        side.normalize().multiplyScalar(weapon.kind === 'shotgun' ? 0.22 : 0.09);
        entity.body.applyTorqueImpulse(vec(side), true);
      }
    }

    return {
      used: true,
      kind: weapon.kind,
      mode: weapon.mode,
      muzzle: origin,
      end: centralEnd,
      impacts,
      ammo: weapon.ammo,
      reserveAmmo: weapon.reserveAmmo,
    };
  }

  private swingPhysicalWeapon(entity: Entity, target: THREE.Vector3, profile: WeaponProfile): WeaponUseResult {
    const weapon = entity.weapon!;
    const position = entity.body.translation();
    const origin = new THREE.Vector3(position.x, position.y, position.z);
    const direction = target.clone().sub(origin);
    if (direction.lengthSq() < 1e-8) {
      const rotation = entity.body.rotation();
      direction.set(1, 0, 0).applyQuaternion(new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w));
    }
    direction.normalize();
    const end = origin.clone().addScaledVector(direction, profile.range);
    let best: { entity: Entity; point: THREE.Vector3; score: number } | undefined;

    for (const candidate of this.entities.values()) {
      if (
        candidate.id === entity.id
        || this.entities.get(candidate.id) !== candidate
        || !candidate.body.isValid()
        || (!candidate.characterId && !candidate.destructible)
      ) continue;
      const candidatePosition = candidate.body.translation();
      const center = new THREE.Vector3(candidatePosition.x, candidatePosition.y, candidatePosition.z);
      const along = THREE.MathUtils.clamp(center.clone().sub(origin).dot(direction), 0, profile.range);
      const point = origin.clone().addScaledVector(direction, along);
      const hitRadius = THREE.MathUtils.clamp(candidate.size.length() * 0.26, 0.18, 0.9) + 0.22;
      const distance = center.distanceTo(point);
      if (distance > hitRadius) continue;
      const score = along + distance * 0.45;
      if (!best || score < best.score) best = { entity: candidate, point, score };
    }

    const impacts: WeaponImpact[] = [];
    if (best) {
      const normal = best.entity.object.position.clone().sub(best.point);
      if (normal.lengthSq() < 1e-8) normal.copy(direction).negate();
      normal.normalize();
      this.applyWeaponHit(best.entity, profile.damage, best.point, direction, profile.impulse);
      // The directed sweep is the melee strike. Suppress the immediate
      // follow-through contact from charging the same target a second time.
      weapon.lastContactAt = this.simulationTime;
      if (best.entity.characterId !== undefined) {
        this.characterImpactTimes.set(best.entity.characterId, this.simulationTime);
      }
      impacts.push({ point: best.point, normal, entity: best.entity });
    }

    if (!entity.fixed) {
      const mass = THREE.MathUtils.clamp(entity.body.mass(), 0.2, 6);
      entity.body.applyImpulse(vec(direction.clone().multiplyScalar(mass * 0.55)), true);
      const torqueAxis = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0));
      if (torqueAxis.lengthSq() > 1e-8) {
        torqueAxis.normalize().multiplyScalar(weapon.kind === 'spear' ? 0.14 : 0.24);
        entity.body.applyTorqueImpulse(vec(torqueAxis), true);
      }
    }

    return {
      used: true,
      kind: weapon.kind,
      mode: weapon.mode,
      muzzle: origin,
      end: best?.point ?? end,
      impacts,
      ammo: weapon.ammo,
      reserveAmmo: weapon.reserveAmmo,
    };
  }

  private localizedWeaponDamage(entity: Entity, rawDamage: number): number {
    const partMultiplier = entity.part === 'head'
      ? 1.62
      : entity.part === 'torso'
        ? 1.08
        : entity.part?.includes('upper')
          ? 0.82
          : 0.7;
    return rawDamage * partMultiplier;
  }

  private applyWeaponHit(entity: Entity, rawDamage: number, point: THREE.Vector3, direction: THREE.Vector3, impulseStrength: number, localized = false): void {
    if (this.entities.get(entity.id) !== entity || !entity.body.isValid()) return;
    // Apply momentum while the body is still live. Destructive damage below
    // may synchronously remove/free it (and explosive props always do).
    // Impulse-first also lets subsequently spawned shards inherit the hit.
    if (!entity.fixed) {
      const mass = THREE.MathUtils.clamp(entity.body.mass(), 0.08, entity.characterId ? 6 : 18);
      const deltaVelocity = THREE.MathUtils.clamp(impulseStrength, 0.2, entity.characterId ? 3.8 : 3);
      const impulseDirection = direction.lengthSq() > 1e-8 ? direction.clone().normalize() : new THREE.Vector3(0, 0.15, 0);
      const impulse = impulseDirection.multiplyScalar(mass * deltaVelocity);
      entity.body.applyImpulseAtPoint(vec(impulse), vec(point), true);
    }
    if (entity.characterId !== undefined) {
      this.damageCharacter(entity.characterId, localized ? rawDamage : this.localizedWeaponDamage(entity, rawDamage), point);
    } else if (entity.destructible) {
      this.damageEntity(entity, rawDamage * 0.78);
    }
  }

  explode(center: THREE.Vector3, radius = 5, strength = 58, source?: Entity): void {
    // Remove a detonating source before applying blast damage. Leaving it in
    // the snapshot allowed damageEntity -> breakEntity -> explode recursion and
    // a delayed timeout could later delete a new entity that reused its ID.
    if (source && this.entities.get(source.id) === source) this.removeEntity(source);
    this.audio?.play('explosion');
    this.events.onExplosion?.(center, radius);
    const characterHits = new Map<number, {
      damage: number;
      point: THREE.Vector3;
      candidates: Array<{ entity: Entity; effective: number }>;
    }>();
    for (const entity of [...this.entities.values()]) {
      if (this.entities.get(entity.id) !== entity || entity.fixed || !entity.body.isValid()) continue;
      const p = entity.body.translation();
      const offset = new THREE.Vector3(p.x - center.x, p.y - center.y, p.z - center.z);
      const distance = Math.max(0.35, offset.length());
      if (distance > radius) continue;
      const falloff = Math.pow(1 - distance / radius, 1.35);
      offset.normalize().add(new THREE.Vector3(0, 0.24, 0)).normalize();
      const maxDeltaVelocity = entity.characterId ? 9 : entity.projectile ? 20 : 16;
      const deltaVelocity = Math.min(maxDeltaVelocity, strength * falloff * 0.28);
      const mass = THREE.MathUtils.clamp(entity.body.mass(), 0.05, 30);
      const impulse = offset.multiplyScalar(mass * deltaVelocity);
      entity.body.applyImpulse(vec(impulse), true);
      const effective = strength * falloff;
      if (entity.characterId) {
        const hit = characterHits.get(entity.characterId);
        if (!hit || effective > hit.damage) {
          characterHits.set(entity.characterId, {
            damage: effective,
            point: new THREE.Vector3(p.x, p.y, p.z),
            candidates: hit?.candidates ?? [{ entity, effective }],
          });
        }
        const updated = characterHits.get(entity.characterId);
        if (updated && !updated.candidates.some((candidate) => candidate.entity.id === entity.id)) {
          updated.candidates.push({ entity, effective });
        }
      } else if (entity.destructible) {
        this.damageEntity(entity, effective * 0.85);
      }
    }
    // A character has ten colliders, but a blast is one gameplay event.
    // Dismemberment is additionally bounded both per character and globally so
    // a crowded blast cannot remove an unbounded number of solver constraints.
    let remainingDetachments = 8;
    for (const [characterId, hit] of characterHits) {
      const character = this.characters.get(characterId);
      if (!character) continue;
      this.damageCharacter(characterId, hit.damage * 1.25, hit.point);
      if (remainingDetachments <= 0) continue;
      let characterDetachments = 0;
      hit.candidates.sort((a, b) => b.effective - a.effective);
      for (const candidate of hit.candidates) {
        if (characterDetachments >= 2 || remainingDetachments <= 0) break;
        const joint = this.closestLiveAnatomicalJoint(character, candidate.entity, candidate.entity.object.position);
        if (!joint || candidate.effective < this.explosionJointResistance(character, joint)) continue;
        const proximal = this.entities.get(joint.proximal);
        if (!proximal) continue;
        const jointPoint = this.anatomicalWorldPoint(proximal, joint.localAnchorProximal);
        const direction = jointPoint.clone().sub(center);
        if (direction.lengthSq() < 1e-8) direction.set(0, 1, 0);
        if (this.severAnatomicalJoint(character, joint, direction, 1.55 + candidate.effective / 34)) {
          characterDetachments++;
          remainingDetachments--;
        }
      }
    }
  }

  damageCharacter(id: number, rawDamage: number, point: THREE.Vector3): void {
    const character = this.characters.get(id);
    if (!character || character.defeated) return;
    const damage = Math.max(0, rawDamage - character.tolerance) * (1 - character.armor);
    if (damage < 1.2) return;
    character.health -= damage;
    character.unconscious = character.unconscious || damage > 7;
    character.unconsciousTime = Math.max(character.unconsciousTime, damage > 28 ? 5.5 : 2.5 + damage * 0.055);
    this.audio?.play(damage > 18 ? 'juice' : 'character');
    this.events.onCharacterHit?.(character, damage, point);
    if (character.health <= 0 || damage > 62) this.defeatCharacter(character);
  }

  defeatCharacter(character: Character): void {
    if (character.defeated) return;
    character.defeated = true;
    character.unconscious = true;
    character.unconsciousTime = 999;
    this.events.onCharacterDefeated?.(character);
  }

  damageEntity(entity: Entity, amount: number): void {
    if (!entity.destructible || amount < entity.breakThreshold * 0.12) return;
    entity.health -= amount;
    if (entity.health <= 0 || amount > entity.breakThreshold * 1.35) this.breakEntity(entity, amount);
  }

  private breakEntity(entity: Entity, force: number): void {
    if (this.entities.get(entity.id) !== entity) return;
    if (entity.explosive) {
      if (this.exploding.has(entity.id)) return;
      this.exploding.add(entity.id);
      const p = entity.body.translation();
      this.destructionValue += Math.max(1, entity.maxHealth / 12);
      this.events.onBreak?.(entity, force);
      try {
        this.explode(new THREE.Vector3(p.x, p.y, p.z), entity.type === 'bomb' ? 6.5 : 5, entity.type === 'bomb' ? 78 : 62, entity);
      } finally {
        this.exploding.delete(entity.id);
      }
      return;
    }
    this.destructionValue += Math.max(1, entity.maxHealth / 12);
    this.events.onBreak?.(entity, force);
    this.audio?.play(entity.material === 'glass' ? 'glassBreak' : 'crack', Math.min(2, force / 30));
    const p = entity.body.translation();
    const q = entity.body.rotation();
    const linearVelocity = entity.body.linvel();
    const angularVelocity = entity.body.angvel();
    const parentSize = entity.size.clone();
    const shardSize = parentSize.clone().multiplyScalar(0.3);
    const material = entity.material;
    const meshMaterial = (entity.object as THREE.Mesh).material;
    const color = meshMaterial instanceof THREE.MeshLambertMaterial || meshMaterial instanceof THREE.MeshStandardMaterial
      ? meshMaterial.color.getHex()
      : MATERIALS[material].color;
    this.removeEntity(entity);
    if (this.entities.size < this.maxBodies - 3 && Math.max(shardSize.x, shardSize.y, shardSize.z) > 0.18) {
      const localAxis = parentSize.x >= parentSize.y && parentSize.x >= parentSize.z
        ? new THREE.Vector3(1, 0, 0)
        : parentSize.y >= parentSize.z
          ? new THREE.Vector3(0, 1, 0)
          : new THREE.Vector3(0, 0, 1);
      const parentRotation = new THREE.Quaternion(q.x, q.y, q.z, q.w);
      const worldAxis = localAxis.clone().applyQuaternion(parentRotation).normalize();
      const parentExtent = localAxis.x ? parentSize.x : localAxis.y ? parentSize.y : parentSize.z;
      const inheritedLinear = new THREE.Vector3(linearVelocity.x, linearVelocity.y, linearVelocity.z);
      if (inheritedLinear.length() > 20) inheritedLinear.setLength(20);
      const inheritedAngular = new THREE.Vector3(angularVelocity.x, angularVelocity.y, angularVelocity.z);
      if (inheritedAngular.length() > 12) inheritedAngular.setLength(12);
      for (let i = 0; i < 3; i++) {
        const offset = worldAxis.clone().multiplyScalar((i - 1) * parentExtent * 0.34);
        const shard = this.createBox('debris', {
          x: p.x + offset.x,
          y: p.y + offset.y,
          z: p.z + offset.z,
        }, shardSize, material, color, false, false);
        if (shard) {
          shard.destructible = false;
          shard.health = shard.maxHealth = 1;
          shard.body.setRotation(q, true);
          shard.object.quaternion.copy(parentRotation);
          if (shard.collider && shard.body.mass() < 0.16) shard.collider.setMass(0.16);
          shard.body.setSoftCcdPrediction(0.18);
          shard.body.setLinearDamping(0.32);
          shard.body.setAngularDamping(0.75);
          const separation = worldAxis.clone().multiplyScalar((i - 1) * 1.8);
          shard.body.setLinvel(vec(inheritedLinear.clone().add(separation).add(new THREE.Vector3(0, 0.6, 0))), true);
          shard.body.setAngvel(vec(inheritedAngular), true);
        }
      }
    }
  }

  update(delta: number): void {
    let simulatedTime = 0;
    if (!this.paused && this.simulationScale > 0) {
      this.accumulator = Math.min(
        this.accumulator + Math.min(delta, 0.05) * this.simulationScale,
        this.fixedStep * (this.maxFrameSubsteps + 1),
      );
      let substeps = 0;
      while (this.accumulator >= this.fixedStep && substeps < this.maxFrameSubsteps) {
        // Keep the solver on one invariant timestep. Slow motion changes how
        // often we step, not the constraint stiffness/warm-start scale.
        const stepTime = this.fixedStep;
        this.world.timestep = stepTime;
        this.simulationTime += stepTime;
        this.machineClock += stepTime;
        this.stabilizeVelocities();
        this.updateMachines(stepTime);
        this.snapshotVelocities();
        this.world.step(this.eventQueue, this.physicsHooks);
        this.handleEvents(stepTime);
        this.accumulator -= this.fixedStep;
        simulatedTime += stepTime;
        substeps++;
      }
    }
    this.syncTransforms();
    this.updateCharacters(simulatedTime);
    this.updateConnectors();
  }

  private handleEvents(stepTime: number): void {
    const strongestPairContacts = new Map<string, ContactImpact>();
    this.eventQueue.drainContactForceEvents((event) => {
      const impulse = event.totalForceMagnitude() * stepTime;
      if (impulse < 2.2) return;
      const a = this.entities.get(this.colliderToEntity.get(event.collider1()) ?? -1);
      const b = this.entities.get(this.colliderToEntity.get(event.collider2()) ?? -1);
      if (!a && !b) return;
      // Self-contact now physically supports a character, but it must never
      // count as an attack, emit hit juice, or damage that same character.
      if (a?.characterId !== undefined && a.characterId === b?.characterId) return;
      const relativePreviousVelocity = a?.previousVelocity.clone() ?? new THREE.Vector3();
      if (b) relativePreviousVelocity.sub(b.previousVelocity);
      const impactPoint = new THREE.Vector3();
      const contactNormal = new THREE.Vector3();
      let contactPointCount = 0;
      const colliderA = this.world.getCollider(event.collider1());
      const colliderB = this.world.getCollider(event.collider2());
      if (colliderA?.isValid() && colliderB?.isValid()) {
        this.world.contactPair(colliderA, colliderB, (manifold, flipped) => {
          const rawNormal = manifold.normal();
          const normal = new THREE.Vector3(rawNormal.x, rawNormal.y, rawNormal.z);
          if (flipped) normal.negate();
          const colliderAPosition = colliderA.translation();
          const colliderBPosition = colliderB.translation();
          const aToB = new THREE.Vector3(
            colliderBPosition.x - colliderAPosition.x,
            colliderBPosition.y - colliderAPosition.y,
            colliderBPosition.z - colliderAPosition.z,
          );
          if (normal.dot(aToB) < 0) normal.negate();
          if (normal.lengthSq() > 1e-10) contactNormal.add(normal.normalize());
          for (let i = 0; i < manifold.numSolverContacts(); i++) {
            const point = manifold.solverContactPoint(i);
            if (![point.x, point.y, point.z].every(Number.isFinite)) continue;
            impactPoint.add(new THREE.Vector3(point.x, point.y, point.z));
            contactPointCount++;
          }
        });
      }
      if (contactNormal.lengthSq() < 1e-10) {
        const pa = colliderA?.translation();
        const pb = colliderB?.translation();
        if (pa && pb) contactNormal.set(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z);
      }
      const closingSpeed = contactNormal.lengthSq() > 1e-10
        ? relativePreviousVelocity.dot(contactNormal.normalize())
        : relativePreviousVelocity.length();
      // Positional correction from an authored overlap points outward. It may
      // produce a large solver impulse, but it is not a hit and must never
      // damage a body or detonate an explosive.
      if (closingSpeed < 0.45) return;
      if (contactPointCount) impactPoint.multiplyScalar(1 / contactPointCount);
      else {
        const ap = a?.body.translation();
        const bp = b?.body.translation();
        const ax = ap?.x ?? bp?.x ?? 0;
        const ay = ap?.y ?? bp?.y ?? 0;
        const az = ap?.z ?? bp?.z ?? 0;
        const bx = bp?.x ?? ap?.x ?? 0;
        const by = bp?.y ?? ap?.y ?? 0;
        const bz = bp?.z ?? ap?.z ?? 0;
        impactPoint.set(
          (ax + bx) * 0.5,
          (ay + by) * 0.5,
          (az + bz) * 0.5,
        );
      }

      // Compound hands/feet may emit more than one collider-pair force event
      // for the same two gameplay entities. Retain the strongest one so a
      // small solver contact cannot consume the cooldown before the real hit.
      const lowId = Math.min(a?.id ?? 0, b?.id ?? 0);
      const highId = Math.max(a?.id ?? 0, b?.id ?? 0);
      const key = `${lowId}:${highId}`;
      const contact = { a, b, impulse, closingSpeed, point: impactPoint, normal: contactNormal };
      const previous = strongestPairContacts.get(key);
      const score = impulse * Math.max(1, closingSpeed);
      const previousScore = previous ? previous.impulse * Math.max(1, previous.closingSpeed) : -1;
      if (!previous || score > previousScore) strongestPairContacts.set(key, contact);
    });

    if (!strongestPairContacts.size) return;
    const contacts = [...strongestPairContacts.values()];
    // Resolve direct projectile/character hits before incidental contacts with
    // nearby debris or the ground can remove a source body in the same step.
    const priority = (contact: ContactImpact): number => {
      const projectileCharacter = Boolean(
        (contact.a?.characterId !== undefined && contact.b?.projectile)
        || (contact.b?.characterId !== undefined && contact.a?.projectile),
      );
      const dynamicCharacter = Boolean(
        (contact.a?.characterId !== undefined && contact.b && !contact.b.fixed)
        || (contact.b?.characterId !== undefined && contact.a && !contact.a.fixed),
      );
      return (projectileCharacter ? 2 : dynamicCharacter ? 1 : 0) * 100000
        + contact.impulse * Math.max(1, contact.closingSpeed);
    };
    contacts.sort((left, right) => priority(right) - priority(left));

    const characterImpacts = new Map<number, CharacterContactImpact>();
    const rockImpacts = new Map<number, CharacterContactImpact>();
    const effectImpacts = new Map<number, { entity: Entity; impulse: number; point: THREE.Vector3 }>();
    const destructibleImpacts = new Map<number, { entity: Entity; impulse: number }>();
    let loudestImpact: ContactImpact | undefined;

    for (const contact of contacts) {
      const { a, b, impulse, closingSpeed, point: impactPoint, normal: contactNormal } = contact;
      const relativePreviousVelocity = a?.previousVelocity.clone() ?? new THREE.Vector3();
      if (b) relativePreviousVelocity.sub(b.previousVelocity);
      const meleeWeapon = a?.weapon?.mode === 'melee' ? a : b?.weapon?.mode === 'melee' ? b : undefined;
      const meleeVictim = meleeWeapon === a ? b : meleeWeapon === b ? a : undefined;
      let specializedMeleeHit = false;
      if (
        meleeWeapon?.weapon
        && meleeVictim
        && (meleeVictim.characterId !== undefined || meleeVictim.destructible)
        && impulse > 3.4
        && this.simulationTime - meleeWeapon.weapon.lastContactAt >= 0.16
      ) {
        const profile = WEAPON_PROFILES[meleeWeapon.weapon.kind];
        const direction = meleeWeapon === a ? relativePreviousVelocity.clone() : relativePreviousVelocity.clone().negate();
        if (direction.lengthSq() < 1e-8) {
          direction.copy(contactNormal);
          if (meleeWeapon === b) direction.negate();
        }
        if (direction.lengthSq() > 1e-8) {
          direction.normalize();
          const contactDamage = profile.damage * THREE.MathUtils.clamp(0.42 + impulse / 18, 0.55, 1.35);
          this.applyWeaponHit(meleeVictim, contactDamage, impactPoint.clone(), direction, Math.min(profile.impulse, 2.4));
          meleeWeapon.weapon.lastContactAt = this.simulationTime;
          if (meleeVictim.characterId !== undefined) {
            this.characterImpactTimes.set(meleeVictim.characterId, this.simulationTime);
          }
          specializedMeleeHit = true;
        }
      }

      for (const entity of [a, b]) {
        if (!entity || this.entities.get(entity.id) !== entity || !entity.body.isValid()) continue;
        const point = impactPoint.clone();
        const existingEffect = effectImpacts.get(entity.id);
        if (!existingEffect || impulse > existingEffect.impulse) {
          effectImpacts.set(entity.id, { entity, impulse, point });
        }

        if (entity.characterId !== undefined && !(specializedMeleeHit && entity === meleeVictim)) {
          const character = this.characters.get(entity.characterId);
          const source = entity === a ? b : a;
          // Detonating bodies apply their single, radius-aggregated character
          // event in explode(); adding contact damage here would double-charge.
          if (!character || source?.explosive) continue;
          const energy = this.contactImpactEnergy(entity, source, closingSpeed);
          const rawDamage = this.contactImpactDamage(source, impulse, closingSpeed, energy);
          const candidate: CharacterContactImpact = {
            character,
            struck: entity,
            source,
            impulse,
            closingSpeed,
            energy,
            rawDamage,
            point,
          };
          const current = characterImpacts.get(character.id);
          if (rawDamage > (current?.rawDamage ?? 0)) characterImpacts.set(character.id, candidate);
          if (source?.projectile && ['ball', 'heavy-ball', 'metal-ball'].includes(source.type)) {
            const currentRock = rockImpacts.get(character.id);
            if (!currentRock || energy > currentRock.energy) rockImpacts.set(character.id, candidate);
          }
        } else if (
          entity.explosive
          && impulse > (entity.projectile ? 8 : entity.type === 'explosive-barrel' ? 32 : 26)
          && closingSpeed > (entity.projectile ? 1 : 2.2)
        ) {
          this.breakEntity(entity, impulse);
        } else if (entity.destructible && !(specializedMeleeHit && entity === meleeVictim) && impulse > entity.breakThreshold * 0.35) {
          // A ball can touch several colliders of one ragdoll in the same
          // solver step. Aggregate structural damage and resolve it after the
          // character hit, otherwise the concrete projectile can fracture and
          // disappear before its valid severing contact is processed.
          const existing = destructibleImpacts.get(entity.id);
          if (
            this.simulationTime - entity.lastImpactAt >= 0.085
            && (!existing || impulse > existing.impulse)
          ) destructibleImpacts.set(entity.id, { entity, impulse });
        }
      }

      if (!loudestImpact || impulse > loudestImpact.impulse) loudestImpact = contact;
    }

    // Visual/audio impact cooldowns are deliberately separate from gameplay
    // damage. A recent ground thud may suppress duplicate dust, never a new hit.
    for (const { entity, impulse, point } of effectImpacts.values()) {
      if (this.entities.get(entity.id) !== entity || this.simulationTime - entity.lastImpactAt < 0.085) continue;
      entity.lastImpactAt = this.simulationTime;
      this.events.onImpact?.(entity, impulse, point);
    }

    // Aggregate all colliders of one ragdoll into one strongest gameplay hit per
    // solver step. The source-specific cooldown stops resting/crush chatter but
    // allows two different projectiles to land on consecutive frames.
    for (const impact of characterImpacts.values()) {
      if (
        impact.rawDamage <= 0
        || this.characters.get(impact.character.id) !== impact.character
        || this.entities.get(impact.struck.id) !== impact.struck
      ) continue;
      const key = this.contactSourceKey(impact.character.id, impact.source);
      const previous = this.characterSourceImpactTimes.get(key) ?? Number.NEGATIVE_INFINITY;
      if (this.simulationTime - previous < 0.14) continue;
      this.characterSourceImpactTimes.set(key, this.simulationTime);
      this.characterImpactTimes.set(impact.character.id, this.simulationTime);
      this.damageCharacter(impact.character.id, impact.rawDamage, impact.point);
    }

    // Dismemberment is checked independently from health-damage cooldowns. One
    // hard contact can sever at most one joint for a character, but an earlier
    // harmless thud can no longer make a new ball pass through with no result.
    for (const impact of rockImpacts.values()) {
      const source = impact.source;
      if (
        !source
        || this.characters.get(impact.character.id) !== impact.character
        || this.entities.get(impact.struck.id) !== impact.struck
        || this.entities.get(source.id) !== source
      ) continue;
      const key = this.contactSourceKey(impact.character.id, source);
      const previous = this.characterSourceDismembermentTimes.get(key) ?? Number.NEGATIVE_INFINITY;
      if (this.simulationTime - previous < 0.16) continue;
      if (this.tryRockDismemberment(
        impact.character,
        impact.struck,
        source,
        impact.point,
        impact.impulse,
        impact.closingSpeed,
        impact.energy,
      )) this.characterSourceDismembermentTimes.set(key, this.simulationTime);
    }

    // Structural damage comes last so a destructible projectile always gets to
    // deliver the character impact that physically caused its own fracture.
    // One strongest value per entity also avoids multiplying damage by a
    // ragdoll's compound hand/foot and adjacent body colliders.
    for (const { entity, impulse } of destructibleImpacts.values()) {
      if (this.entities.get(entity.id) !== entity) continue;
      this.damageEntity(entity, impulse * 0.52);
    }

    if (loudestImpact && loudestImpact.impulse > 8) {
      this.audio?.impact(
        loudestImpact.a?.material ?? loudestImpact.b?.material ?? 'wood',
        Math.min(1.6, loudestImpact.impulse / 35),
      );
    }
    this.pruneContactCooldowns();
  }

  private stabilizeVelocities(): void {
    for (const entity of this.entities.values()) {
      if (entity.fixed || !entity.body.isValid() || entity.body.isSleeping()) continue;
      const linear = entity.body.linvel();
      const angular = entity.body.angvel();
      if (!Number.isFinite(linear.x) || !Number.isFinite(linear.y) || !Number.isFinite(linear.z)) {
        entity.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      } else {
        const speed = Math.hypot(linear.x, linear.y, linear.z);
        const maximum = entity.projectile ? 70 : entity.characterId ? 30 : entity.type === 'debris' ? 32 : 45;
        if (speed > maximum) entity.body.setLinvel({
          x: linear.x / speed * maximum,
          y: linear.y / speed * maximum,
          z: linear.z / speed * maximum,
        }, true);
      }
      if (!Number.isFinite(angular.x) || !Number.isFinite(angular.y) || !Number.isFinite(angular.z)) {
        entity.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      } else {
        const speed = Math.hypot(angular.x, angular.y, angular.z);
        const maximum = entity.characterId ? 18 : 25;
        if (speed > maximum) entity.body.setAngvel({
          x: angular.x / speed * maximum,
          y: angular.y / speed * maximum,
          z: angular.z / speed * maximum,
        }, true);
      }
    }
  }

  private snapshotVelocities(): void {
    for (const entity of this.entities.values()) {
      if (entity.fixed || !entity.body.isValid() || entity.body.isSleeping()) continue;
      const velocity = entity.body.linvel();
      entity.previousVelocity.set(velocity.x, velocity.y, velocity.z);
    }
  }

  private syncTransforms(): void {
    for (const entity of this.entities.values()) {
      // Fixed bodies still need a cheap transform sync: Rotate and blueprint
      // restore can move them directly even though they never wake or solve.
      if (!entity.body.isValid() || (!entity.fixed && entity.body.isSleeping())) continue;
      const p = entity.body.translation();
      const q = entity.body.rotation();
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)
        || !Number.isFinite(q.x) || !Number.isFinite(q.y) || !Number.isFinite(q.z) || !Number.isFinite(q.w)
        || p.y < -30) {
        this.removeEntity(entity);
        continue;
      }
      entity.object.position.set(p.x, p.y, p.z);
      entity.object.quaternion.set(q.x, q.y, q.z, q.w);
      const velocity = entity.body.linvel();
      const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
      const maximum = entity.projectile ? 70 : entity.characterId ? 30 : entity.type === 'debris' ? 32 : 45;
      if (speed > maximum) entity.body.setLinvel({ x: velocity.x / speed * maximum, y: velocity.y / speed * maximum, z: velocity.z / speed * maximum }, true);
      const angular = entity.body.angvel();
      const as = Math.hypot(angular.x, angular.y, angular.z);
      const angularMaximum = entity.characterId ? 18 : 25;
      if (as > angularMaximum) entity.body.setAngvel({ x: angular.x / as * angularMaximum, y: angular.y / as * angularMaximum, z: angular.z / as * angularMaximum }, true);
    }
  }

  private updateCharacters(delta: number): void {
    for (const character of this.characters.values()) {
      if (!character.unconscious || character.defeated) continue;
      character.unconsciousTime -= delta;
      if (character.unconsciousTime <= 0) {
        this.defeatCharacter(character);
      } else if (character.unconsciousTime > 4 && character.health < character.maxHealth * 0.35) {
        this.defeatCharacter(character);
      }
    }
  }

  private updateConnectors(): void {
    for (const c of this.connectors.values()) {
      const a = this.entities.get(c.a);
      const b = this.entities.get(c.b);
      if (!a || !b || !a.body.isValid() || !b.body.isValid()) {
        this.removeConnector(c.id);
        continue;
      }
      if (c.line) {
        const attr = c.line.geometry.getAttribute('position') as THREE.BufferAttribute;
        const pa = a.object.position;
        const pb = b.object.position;
        attr.setXYZ(0, pa.x, pa.y, pa.z);
        attr.setXYZ(1, pb.x, pb.y, pb.z);
        attr.needsUpdate = true;
      }
      const distance = a.object.position.distanceTo(b.object.position);
      if (distance > c.restLength * (c.type === 'rope' ? 2.7 : 3.8) + 2) {
        this.audio?.play('crack');
        this.removeConnector(c.id);
      }
    }
  }

  private updateMachines(delta: number): void {
    for (const [key, value] of this.machineCooldowns) {
      const remaining = value - delta;
      if (remaining <= 0) this.machineCooldowns.delete(key);
      else this.machineCooldowns.set(key, remaining);
    }

    for (const entity of this.entities.values()) {
      if (!entity.motor || !entity.body.isValid()) continue;
      const ep = entity.body.translation();
      if (entity.type === 'wheel' || entity.type === 'motor') {
        if (!entity.fixed) entity.body.applyTorqueImpulse({ x: 0, y: 0, z: 2.2 * delta }, true);
      }
      else if (entity.type === 'piston') {
        const key = `piston:${entity.id}`;
        const pulse = Math.max(0, Math.sin(this.machineClock * 3.5));
        if (!entity.fixed && pulse > 0.97 && !this.machineCooldowns.has(key)) {
          const mass = THREE.MathUtils.clamp(entity.body.mass(), 0.05, 30);
          entity.body.applyImpulse({ x: 0, y: mass * 4.5, z: 0 }, true);
          this.machineCooldowns.set(key, 0.55);
        }
      } else if (entity.type === 'conveyor') {
        for (const other of this.collectMachineCandidates(entity, ep.x, ep.y + 0.7, ep.z, entity.size.x / 2 + 0.8, 1.1, entity.size.z / 2 + 0.8)) {
          if (other.fixed || !other.body.isValid()) continue;
          const op = other.body.translation();
          if (Math.abs(op.x - ep.x) < entity.size.x / 2
            && Math.abs(op.z - ep.z) < entity.size.z / 2
            && op.y > ep.y
            && op.y - ep.y < 1.4) {
            const mass = THREE.MathUtils.clamp(other.body.mass(), 0.05, 30);
            other.body.applyImpulse({ x: mass * 3.3 * delta, y: 0, z: 0 }, true);
          }
        }
      } else if (entity.type === 'spring') {
        for (const other of this.collectMachineCandidates(entity, ep.x, ep.y, ep.z, 1.15, 1.15, 1.15)) {
          if (other.fixed || !other.body.isValid()) continue;
          const key = `spring:${entity.id}:${other.id}`;
          if (this.machineCooldowns.has(key)) continue;
          const op = other.body.translation();
          const distance = Math.hypot(op.x - ep.x, op.y - ep.y, op.z - ep.z);
          if (distance < 1.15 && op.y > ep.y) {
            const velocity = other.body.linvel();
            const deltaVelocity = Math.max(0, 7.5 - velocity.y);
            if (deltaVelocity > 0.1) {
              const mass = THREE.MathUtils.clamp(other.body.mass(), 0.05, 30);
              other.body.applyImpulse({ x: 0, y: mass * deltaVelocity, z: 0 }, true);
              this.machineCooldowns.set(key, 0.55);
            }
          }
        }
      } else if (entity.type === 'fan') {
        for (const other of this.collectMachineCandidates(entity, ep.x, ep.y, ep.z, 5, 5, 5)) {
          if (other.fixed || !other.body.isValid()) continue;
          const op = other.body.translation();
          const distance = Math.hypot(op.x - ep.x, op.y - ep.y, op.z - ep.z);
          if (distance < 5) {
            const falloff = 1 - distance / 5;
            const mass = THREE.MathUtils.clamp(other.body.mass(), 0.05, 30);
            other.body.applyImpulse({
              x: mass * 5.5 * falloff * delta,
              y: mass * 1.1 * falloff * delta,
              z: 0,
            }, true);
          }
        }
      } else if (entity.type === 'magnet') {
        for (const other of this.collectMachineCandidates(entity, ep.x, ep.y, ep.z, 6, 6, 6)) {
          if (other.material !== 'metal' || other.fixed || !other.body.isValid()) continue;
          const op = other.body.translation();
          const directionX = ep.x - op.x;
          const directionY = ep.y - op.y;
          const directionZ = ep.z - op.z;
          const distance = Math.hypot(directionX, directionY, directionZ);
          if (distance > 0.2 && distance < 6) {
            const falloff = 1 - distance / 6;
            const mass = THREE.MathUtils.clamp(other.body.mass(), 0.05, 30);
            const impulse = mass * 9 * falloff * delta / distance;
            other.body.applyImpulse({
              x: directionX * impulse,
              y: directionY * impulse,
              z: directionZ * impulse,
            }, true);
          }
        }
      }
    }
  }

  private collectMachineCandidates(
    machine: Entity,
    x: number,
    y: number,
    z: number,
    halfX: number,
    halfY: number,
    halfZ: number,
  ): readonly Entity[] {
    this.machineCandidates.length = 0;
    this.machineCandidateIds.clear();
    this.machineQueryExcludeId = machine.id;
    this.machineQueryCenter.x = x;
    this.machineQueryCenter.y = y;
    this.machineQueryCenter.z = z;
    this.machineQueryHalfExtents.x = halfX;
    this.machineQueryHalfExtents.y = halfY;
    this.machineQueryHalfExtents.z = halfZ;
    this.world.collidersWithAabbIntersectingAabb(
      this.machineQueryCenter,
      this.machineQueryHalfExtents,
      this.collectMachineCandidate,
    );
    return this.machineCandidates;
  }

  nearestEntity(point: THREE.Vector3, maxDistance = 2): Entity | undefined {
    let result: Entity | undefined;
    let best = maxDistance;
    for (const e of this.entities.values()) {
      const d = e.object.position.distanceTo(point);
      if (d < best) { best = d; result = e; }
    }
    return result;
  }

  get targetsRemaining(): number {
    let count = 0;
    for (const c of this.characters.values()) if (!c.friendly && !c.defeated) count++;
    return count;
  }

  get friendliesAlive(): number {
    let count = 0;
    for (const c of this.characters.values()) if (c.friendly && !c.defeated) count++;
    return count;
  }

  get bodyStats(): { total: number; active: number; sleeping: number } {
    let active = 0;
    let sleeping = 0;
    for (const e of this.entities.values()) e.body.isSleeping() ? sleeping++ : active++;
    return { total: this.entities.size, active, sleeping };
  }
}
