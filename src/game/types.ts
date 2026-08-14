import type * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d';

export type GameMode = 'menu' | 'campaign-select' | 'campaign' | 'sandbox';
export type Phase = 'build' | 'play' | 'paused' | 'complete' | 'failed';
export type Quality = 'low' | 'medium' | 'high';
export type MaterialId = 'wood' | 'metal' | 'concrete' | 'glass' | 'rubber' | 'plastic' | 'dirt' | 'toy';
export type CharacterKind = 'human' | 'worker' | 'knight' | 'dummy' | 'monster' | 'heavy' | 'armored' | 'friendly';
export type WeaponKind = 'pistol' | 'shotgun' | 'rifle' | 'knife' | 'machete' | 'axe' | 'spear';
export type WeaponMode = 'firearm' | 'melee';
export type AnatomicalJointId = 'neck' | 'shoulder-l' | 'shoulder-r' | 'elbow-l' | 'elbow-r' | 'hip-l' | 'hip-r' | 'knee-l' | 'knee-r';
export type ToolId = 'grab' | 'delete' | 'freeze' | 'unfreeze' | 'rotate' | 'push' | 'explosion' | 'connect' | 'rope' | 'spring' | 'hinge' | 'motor' | 'duplicate';

export interface WeaponState {
  kind: WeaponKind;
  mode: WeaponMode;
  ammo: number;
  magazineSize: number;
  reserveAmmo: number;
  lastUseAt: number;
  lastContactAt: number;
}

export interface Vec3 { x: number; y: number; z: number }
export interface Euler3 { x?: number; y?: number; z?: number }

export interface SpawnDefinition {
  type: string;
  position: Vec3;
  rotation?: Euler3;
  scale?: Vec3;
  color?: number;
  material?: MaterialId;
  fixed?: boolean;
  target?: boolean;
  friendly?: boolean;
  variant?: CharacterKind;
  label?: string;
  group?: string;
}

export interface LevelDefinition {
  id: number;
  chapter: number;
  chapterName: string;
  name: string;
  subtitle: string;
  description: string;
  environment: 'backyard' | 'workshop' | 'castle' | 'factory' | 'yard';
  phase: 'live' | 'build';
  objects: SpawnDefinition[];
  loadout: Record<string, number>;
  tools: ToolId[];
  star2: { kind: 'items' | 'time' | 'friendly'; value: number; label: string };
  star3: { kind: 'items' | 'time' | 'friendly' | 'destruction'; value: number; label: string };
  camera: { position: Vec3; target: Vec3 };
  hint: string;
  unlock: string;
}

export interface Entity {
  id: number;
  type: string;
  object: THREE.Object3D;
  body: RAPIER.RigidBody;
  collider?: RAPIER.Collider;
  size: THREE.Vector3;
  material: MaterialId;
  health: number;
  maxHealth: number;
  breakThreshold: number;
  destructible: boolean;
  fixed: boolean;
  selected: boolean;
  spawnedByPlayer: boolean;
  characterId?: number;
  part?: string;
  /** True once this body is no longer connected to its character's torso. */
  detachedFromCharacter?: boolean;
  projectile?: boolean;
  explosive?: boolean;
  motor?: boolean;
  weapon?: WeaponState;
  previousVelocity: THREE.Vector3;
  lastImpactAt: number;
  group?: string;
}

/** Runtime-only metadata for one ragdoll constraint. */
export interface AnatomicalJoint {
  id: AnatomicalJointId;
  proximal: number;
  distal: number;
  localAnchorProximal: Vec3;
  localAnchorDistal: Vec3;
  detached: boolean;
  /** Cleared immediately when Rapier frees the constraint wrapper. */
  joint?: RAPIER.ImpulseJoint;
}

export interface Character {
  id: number;
  kind: CharacterKind;
  parts: Entity[];
  health: number;
  maxHealth: number;
  armor: number;
  tolerance: number;
  juice: number;
  unconscious: boolean;
  unconsciousTime: number;
  defeated: boolean;
  friendly: boolean;
  name: string;
  anatomicalJoints: AnatomicalJoint[];
  detachedParts: Set<number>;
  dismembermentCount: number;
}

export interface Connector {
  id: number;
  type: 'weld' | 'rope' | 'spring' | 'hinge' | 'motor';
  a: number;
  b: number;
  joint?: RAPIER.ImpulseJoint;
  restLength: number;
  stiffness: number;
  damping: number;
  breakForce: number;
  line?: THREE.Line;
}

export interface LevelResult {
  stars: number;
  time: number;
  itemsUsed: number;
  destruction: number;
  bestScore: number;
}

export interface SaveData {
  saveVersion: 1;
  completed: Record<number, LevelResult>;
  unlockedLevel: number;
  unlockedItems: string[];
  settings: { quality: Quality; volume: number; cameraShake: boolean };
  favorites: string[];
  recent: string[];
  blueprints: Blueprint[];
  sandboxWorlds: Record<string, WorldSnapshot>;
}

export interface SnapshotEntity {
  type: string;
  position: Vec3;
  rotation: { x: number; y: number; z: number; w: number };
  scale: Vec3;
  material: MaterialId;
  color?: number;
  fixed: boolean;
  variant?: CharacterKind;
  weapon?: {
    ammo: number;
    reserveAmmo: number;
  };
  character?: {
    health: number;
    unconscious: boolean;
    defeated: boolean;
    severedJoints: AnatomicalJointId[];
  };
}

export interface SnapshotConnector {
  type: Connector['type'];
  a: number;
  b: number;
  restLength: number;
}

export interface WorldSnapshot {
  version: 1;
  name: string;
  createdAt: number;
  entities: SnapshotEntity[];
  connectors: SnapshotConnector[];
}

export interface Blueprint extends WorldSnapshot {
  id: string;
  icon: string;
}
