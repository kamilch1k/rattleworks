import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CharacterKind, Entity } from './types';

export interface CharacterVisualPalette {
  skin: number;
  shirt: number;
  pants: number;
  accent: number;
}

export interface CharacterTextureSet {
  fabric: THREE.Texture;
  denim: THREE.Texture;
  metal: THREE.Texture;
  leather: THREE.Texture;
}

export interface CharacterVisualOptions {
  textures?: Partial<CharacterTextureSet>;
  texturePaths?: Partial<Record<keyof CharacterTextureSet, string>>;
  anisotropy?: number;
}

type TextureRole = keyof CharacterTextureSet | 'skin' | 'plain';
type PartMap = Map<string, Entity>;

interface Placement {
  position: readonly [number, number, number];
  scale: readonly [number, number, number];
  rotation?: readonly [number, number, number];
}

export const CHARACTER_TEXTURE_PATHS: Readonly<Record<keyof CharacterTextureSet, string>> = {
  fabric: '/textures/pixel/materials/fabric-pixel-v2.png',
  denim: '/textures/pixel/materials/denim-pixel-v2.png',
  metal: '/textures/pixel/materials/metal-pixel-v2.png',
  leather: '/textures/pixel/materials/leather-pixel-v2.png',
};

/**
 * Gives the physics ragdoll a clean, voxel-like humanoid silhouette. Render-only
 * additions stay deliberately compact so the visible character continues to
 * match the body that Rapier is solving. The rigid bodies, colliders, and joints
 * remain owned entirely by PhysicsWorld.
 */
export class CharacterVisuals {
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly textures: Partial<CharacterTextureSet>;
  private readonly placementDummy = new THREE.Object3D();

  constructor(options: CharacterVisualOptions = {}) {
    this.textures = { ...options.textures };
    const paths = { ...CHARACTER_TEXTURE_PATHS, ...options.texturePaths };
    const anisotropy = Math.max(1, options.anisotropy ?? 4);
    if (typeof document !== 'undefined') {
      const loader = new THREE.TextureLoader();
      for (const role of ['fabric', 'denim', 'metal', 'leather'] as const) {
        if (this.textures[role]) continue;
        let texture!: THREE.Texture;
        texture = loader.load(paths[role], undefined, undefined, () => {
          delete this.textures[role];
          for (const material of this.materials.values()) {
            if (material.map !== texture) continue;
            material.map = null;
            material.needsUpdate = true;
          }
          texture.dispose();
        });
        texture.name = `character-pixel-${role}`;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.MirroredRepeatWrapping;
        texture.wrapT = THREE.MirroredRepeatWrapping;
        texture.repeat.set(2, 2);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestMipmapNearestFilter;
        texture.generateMipmaps = true;
        // Pixel maps should retain hard texel boundaries at oblique angles.
        texture.anisotropy = Math.min(anisotropy, 1);
        this.textures[role] = texture;
      }
    }
  }

  decorate(parts: readonly Entity[], kind: CharacterKind, palette: CharacterVisualPalette): void {
    const byName: PartMap = new Map();
    for (const part of parts) if (part.part) byName.set(part.part, part);
    if (byName.size === 0 || parts.some((part) => part.object.userData.characterVisuals === true)) return;

    this.stylePhysicsMeshes(byName, kind, palette);
    this.addHandsAndFeet(byName, kind, palette);
    this.addFace(byName.get('head'), kind);
    this.addVariantCue(byName, kind, palette);

    for (const part of parts) part.object.userData.characterVisuals = true;
  }

  private stylePhysicsMeshes(parts: PartMap, kind: CharacterKind, palette: CharacterVisualPalette): void {
    const armored = kind === 'knight' || kind === 'armored';
    for (const [name, part] of parts) {
      if (!(part.object instanceof THREE.Mesh)) continue;
      if (name === 'head') part.object.geometry = this.partGeometry('block-head', part.size);
      else if (name === 'torso') part.object.geometry = this.partGeometry('block-torso', part.size);
      else if (name.includes('arm') || name.includes('leg')) part.object.geometry = this.partGeometry('block-limb', part.size);

      let color = palette.skin;
      let role: TextureRole = 'skin';
      if (name === 'torso' || name.startsWith('upper-arm')) {
        color = palette.shirt;
        role = armored ? 'metal' : 'fabric';
      } else if (name.includes('leg')) {
        color = palette.pants;
        role = armored ? 'metal' : kind === 'heavy' ? 'leather' : 'denim';
      } else if (armored && name.startsWith('lower-arm')) {
        color = this.shift(palette.shirt, -0.08);
        role = 'metal';
      }
      part.object.material = this.material(`body-${role}`, color, role);
    }
  }

  /**
   * These proportions mirror the auxiliary colliders on the lower limbs.
   * Scale is recovered from the authored part dimensions, keeping heavy and
   * armored variants aligned without passing a second character scale around.
   */
  private addHandsAndFeet(parts: PartMap, kind: CharacterKind, palette: CharacterVisualPalette): void {
    const armored = kind === 'knight' || kind === 'armored';
    const shoeColor = armored
      ? this.shift(palette.shirt, -0.2)
      : kind === 'friendly'
        ? 0xf1eee5
        : 0x403a37;
    const shoeRole: TextureRole = armored ? 'metal' : 'leather';

    for (const side of ['l', 'r']) {
      const arm = parts.get(`lower-arm-${side}`);
      if (arm) {
        const scale = arm.size.y / 0.55;
        const diameter = 0.29 * scale;
        // The hand uses the exact same material as its lower arm. Bake the
        // disconnected cube into that render geometry so each arm remains one
        // draw submission while its collider and silhouette stay unchanged.
        if (arm.object instanceof THREE.Mesh) {
          arm.object.geometry = this.limbWithHandGeometry(
            arm.size,
            this.place(0, -0.3 * scale, 0.01 * scale, diameter, diameter, diameter),
          );
        }
      }

      const leg = parts.get(`lower-leg-${side}`);
      if (leg) {
        const scale = leg.size.y / 0.58;
        this.mesh(
          leg.object,
          'block',
          this.material('shoe', shoeColor, shoeRole),
          this.place(0, -0.245 * scale, 0.075 * scale, 0.32 * scale, 0.15 * scale, 0.46 * scale),
          'foot',
        );
      }
    }
  }

  private addFace(head: Entity | undefined, kind: CharacterKind): void {
    if (!head) return;
    const { x: width, y: height, z: depth } = head.size;
    const front = depth * 0.5 + 0.014;
    const inkColor = kind === 'monster' ? 0x1e281b : 0x263039;
    const ink = this.material('face-ink', inkColor, 'plain');

    this.instances(head.object, 'block', ink, [
      this.place(-width * 0.18, height * 0.1, front, width * 0.12, height * 0.17, 0.035),
      this.place(width * 0.18, height * 0.1, front, width * 0.12, height * 0.17, 0.035),
      this.place(0, -height * 0.19, front + 0.008, width * 0.22, height * 0.045, 0.025),
    ], 'face-pixels');
  }

  private addVariantCue(parts: PartMap, kind: CharacterKind, palette: CharacterVisualPalette): void {
    switch (kind) {
      case 'worker': this.addWorkerCue(parts, palette); break;
      case 'knight': this.addArmorCue(parts, palette, false); break;
      case 'armored': this.addArmorCue(parts, palette, true); break;
      case 'monster': this.addMonsterCue(parts, palette); break;
      case 'heavy': this.addHeavyCue(parts, palette); break;
      case 'friendly': this.addFriendlyCue(parts, palette); break;
      case 'dummy': this.addDummyCue(parts, palette); break;
      default: this.addHumanCue(parts, palette); break;
    }
  }

  private addHumanCue(parts: PartMap, palette: CharacterVisualPalette): void {
    const head = parts.get('head');
    if (!head) return;
    const { x: width, y: height, z: depth } = head.size;
    const cap = this.material('human-cap', this.shift(palette.accent, -0.28), 'fabric');
    this.instances(head.object, 'block', cap, [
      this.place(0, height * 0.43, 0, width * 0.96, height * 0.22, depth * 0.98),
      this.place(0, height * 0.37, depth * 0.5, width * 0.7, height * 0.08, depth * 0.3),
    ], 'cap');
  }

  private addWorkerCue(parts: PartMap, palette: CharacterVisualPalette): void {
    const head = parts.get('head');
    const torso = parts.get('torso');
    if (head) {
      const { x: width, y: height, z: depth } = head.size;
      const hat = this.material('hardhat', palette.accent, 'plain');
      this.instances(head.object, 'block', hat, [
        this.place(0, height * 0.43, 0, width * 0.9, height * 0.24, depth * 0.92),
        this.place(0, height * 0.35, depth * 0.04, width * 1.14, height * 0.075, depth * 1.1),
      ], 'hardhat');
    }
    if (torso) {
      const { x: width, y: height, z: depth } = torso.size;
      const front = depth * 0.5 + 0.024;
      this.mesh(
        torso.object,
        'block',
        this.material('worker-vest', 0xe8792e, 'fabric'),
        this.place(0, 0, front, width * 0.72, height * 0.62, 0.045),
        'worker-vest',
      );
      this.mesh(
        torso.object,
        'block',
        this.material('worker-stripe', 0xf2e8a4, 'plain', true),
        this.place(0, -height * 0.08, front + 0.03, width * 0.66, height * 0.075, 0.018),
        'worker-stripe',
      );
    }
  }

  private addArmorCue(parts: PartMap, palette: CharacterVisualPalette, closed: boolean): void {
    const head = parts.get('head');
    const torso = parts.get('torso');
    const plate = this.material('armor', this.shift(palette.shirt, 0.08), 'metal');
    if (head) {
      const { x: width, y: height, z: depth } = head.size;
      const front = depth * 0.5 + 0.025;
      this.mesh(
        head.object,
        'block',
        plate,
        this.place(0, height * 0.28, 0, width * 1.06, height * 0.48, depth * 1.08),
        'helmet',
      );
      this.mesh(
        head.object,
        'block',
        this.material('helmet-band', palette.accent, 'metal'),
        this.place(0, height * 0.31, 0, width * 1.04, height * 0.08, depth * 1.07),
        'helmet-band',
      );
      if (closed) {
        this.mesh(
          head.object,
          'block',
          this.material('visor', this.shift(palette.shirt, -0.24), 'metal'),
          this.place(0, height * 0.06, front, width * 0.68, height * 0.11, 0.045),
          'visor',
        );
      }
    }
    if (torso) {
      const { x: width, y: height, z: depth } = torso.size;
      this.mesh(
        torso.object,
        'block',
        plate,
        this.place(0, height * 0.03, depth * 0.5 + 0.032, width * 0.76, height * 0.62, 0.065),
        'chest-plate',
      );
    }
  }

  private addMonsterCue(parts: PartMap, palette: CharacterVisualPalette): void {
    const head = parts.get('head');
    if (!head) return;
    const { x: width, y: height, z: depth } = head.size;
    const front = depth * 0.5 + 0.04;
    this.instances(head.object, 'block', this.material('horn', 0xd8cb94, 'plain'), [
      this.place(-width * 0.31, height * 0.52, 0, width * 0.15, height * 0.34, depth * 0.14, 0, 0, 0.24),
      this.place(width * 0.31, height * 0.52, 0, width * 0.15, height * 0.34, depth * 0.14, 0, 0, -0.24),
    ], 'horns');
    this.instances(head.object, 'block', this.material('fang', 0xfff0be, 'plain'), [
      this.place(-width * 0.12, -height * 0.22, front, 0.055, 0.11, 0.055),
      this.place(width * 0.12, -height * 0.22, front, 0.055, 0.11, 0.055),
    ], 'fangs');
    void palette;
  }

  private addHeavyCue(parts: PartMap, palette: CharacterVisualPalette): void {
    const head = parts.get('head');
    const torso = parts.get('torso');
    if (head) {
      const { x: width, y: height, z: depth } = head.size;
      this.mesh(
        head.object,
        'block',
        this.material('bandana', palette.accent, 'fabric'),
        this.place(0, height * 0.28, 0, width * 1.04, height * 0.13, depth * 1.05),
        'bandana',
      );
    }
    if (torso) {
      const { x: width, y: height, z: depth } = torso.size;
      const front = depth * 0.5 + 0.025;
      const straps = this.material('heavy-straps', this.shift(palette.pants, -0.22), 'leather');
      this.instances(torso.object, 'block', straps, [
        this.place(-width * 0.23, 0, front, width * 0.1, height * 0.7, 0.045),
        this.place(width * 0.23, 0, front, width * 0.1, height * 0.7, 0.045),
      ], 'straps');
    }
  }

  private addFriendlyCue(parts: PartMap, palette: CharacterVisualPalette): void {
    const torso = parts.get('torso');
    if (!torso) return;
    const { x: width, y: height, z: depth } = torso.size;
    const scarf = this.material('friendly-scarf', palette.accent, 'fabric');
    this.mesh(
      torso.object,
      'block',
      scarf,
      this.place(0, height * 0.39, 0, width * 0.82, height * 0.11, depth * 1.07),
      'scarf',
    );
    const heart = this.material('heart', 0xff727d, 'plain', true);
    const pixel = Math.min(width, height) * 0.055;
    this.instances(torso.object, 'block', heart, [
      this.place(-width * 0.23, height * 0.13, depth * 0.5 + 0.037, pixel, pixel, 0.035),
      this.place(-width * 0.13, height * 0.13, depth * 0.5 + 0.037, pixel, pixel, 0.035),
      this.place(-width * 0.18, height * 0.075, depth * 0.5 + 0.037, pixel * 1.7, pixel, 0.035),
      this.place(-width * 0.18, height * 0.02, depth * 0.5 + 0.037, pixel, pixel, 0.035),
    ], 'pixel-heart');
  }

  private addDummyCue(parts: PartMap, palette: CharacterVisualPalette): void {
    const torso = parts.get('torso');
    if (!torso) return;
    const { x: width, y: height, z: depth } = torso.size;
    const front = depth * 0.5 + 0.034;
    const mark = this.material('dummy-target', palette.accent, 'plain');
    const targetSize = width * 0.38;
    const edge = width * 0.065;
    this.instances(torso.object, 'block', mark, [
      this.place(0, height * 0.06 + targetSize * 0.5, front, targetSize + edge, edge, 0.03),
      this.place(0, height * 0.06 - targetSize * 0.5, front, targetSize + edge, edge, 0.03),
      this.place(-targetSize * 0.5, height * 0.06, front, edge, targetSize - edge, 0.03),
      this.place(targetSize * 0.5, height * 0.06, front, edge, targetSize - edge, 0.03),
      this.place(0, height * 0.06, front + 0.018, width * 0.095, width * 0.095, 0.02),
    ], 'target');
  }

  private mesh(
    parent: THREE.Object3D,
    geometry: string,
    material: THREE.Material,
    placement: Placement,
    name: string,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry(geometry), material);
    mesh.name = `character-visual-${name}`;
    mesh.position.set(...placement.position);
    mesh.scale.set(...placement.scale);
    if (placement.rotation) mesh.rotation.set(...placement.rotation);
    // Core physics meshes already cast the character shadow. Rendering every
    // tiny overlay into every shadow-map pass nearly doubles character draw
    // calls, while contributing only sub-pixel shadow detail.
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData.renderOnly = true;
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    parent.add(mesh);
    return mesh;
  }

  private instances(
    parent: THREE.Object3D,
    geometry: string,
    material: THREE.Material,
    placements: readonly Placement[],
    name: string,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry(geometry), material, placements.length);
    mesh.name = `character-visual-${name}`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData.renderOnly = true;
    placements.forEach((placement, index) => {
      this.placementDummy.position.set(...placement.position);
      this.placementDummy.scale.set(...placement.scale);
      this.placementDummy.rotation.set(0, 0, 0);
      if (placement.rotation) this.placementDummy.rotation.set(...placement.rotation);
      this.placementDummy.updateMatrix();
      mesh.setMatrixAt(index, this.placementDummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    parent.add(mesh);
    return mesh;
  }

  private place(
    x: number, y: number, z: number,
    sx: number, sy: number, sz: number,
    rx = 0, ry = 0, rz = 0,
  ): Placement {
    return { position: [x, y, z], scale: [sx, sy, sz], rotation: [rx, ry, rz] };
  }

  private geometry(key: string): THREE.BufferGeometry {
    const cached = this.geometries.get(key);
    if (cached) return cached;
    let geometry: THREE.BufferGeometry;
    switch (key) {
      case 'block': geometry = new THREE.BoxGeometry(1, 1, 1); break;
      default: geometry = new THREE.BoxGeometry(1, 1, 1); break;
    }
    this.geometries.set(key, geometry);
    return geometry;
  }

  private partGeometry(shape: 'block-head' | 'block-torso' | 'block-limb', size: THREE.Vector3): THREE.BufferGeometry {
    const key = `${shape}-${size.x.toFixed(3)}-${size.y.toFixed(3)}-${size.z.toFixed(3)}`;
    const cached = this.geometries.get(key);
    if (cached) return cached;
    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
    this.geometries.set(key, geometry);
    return geometry;
  }

  private limbWithHandGeometry(size: THREE.Vector3, hand: Placement): THREE.BufferGeometry {
    const key = `block-limb-hand-${size.x.toFixed(3)}-${size.y.toFixed(3)}-${size.z.toFixed(3)}`;
    const cached = this.geometries.get(key);
    if (cached) return cached;

    const attachment = this.geometry('block').clone();
    this.placementDummy.position.set(...hand.position);
    this.placementDummy.scale.set(...hand.scale);
    this.placementDummy.rotation.set(0, 0, 0);
    if (hand.rotation) this.placementDummy.rotation.set(...hand.rotation);
    this.placementDummy.updateMatrix();
    attachment.applyMatrix4(this.placementDummy.matrix);
    const geometry = mergeGeometries([
      this.partGeometry('block-limb', size),
      attachment,
    ], false);
    attachment.dispose();
    if (!geometry) return this.partGeometry('block-limb', size);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    this.geometries.set(key, geometry);
    return geometry;
  }

  private material(key: string, color: number, role: TextureRole, emissive = false): THREE.MeshStandardMaterial {
    const id = `${key}-${color.toString(16)}-${role}-${emissive}`;
    const cached = this.materials.get(id);
    if (cached) return cached;
    const isMetal = role === 'metal';
    const textured = role !== 'skin' && role !== 'plain';
    const tint = textured
      ? new THREE.Color(color).lerp(new THREE.Color(0xffffff), isMetal ? 0.68 : 0.5)
      : new THREE.Color(color);
    const material = new THREE.MeshStandardMaterial({
      // Preserve each character's readable palette while allowing the
      // AI-authored textile/metal texels to remain crisp and visible.
      color: tint,
      map: role === 'skin' || role === 'plain' ? null : this.textures[role] ?? null,
      flatShading: true,
      roughness: isMetal ? 0.48 : role === 'leather' ? 0.72 : 0.88,
      metalness: isMetal ? 0.62 : 0,
      emissive: emissive ? new THREE.Color(color).multiplyScalar(0.14) : new THREE.Color(0x000000),
      emissiveIntensity: emissive ? 0.75 : 0,
    });
    this.materials.set(id, material);
    return material;
  }

  private shift(color: number, lightnessDelta: number): number {
    const value = new THREE.Color(color);
    value.offsetHSL(0, 0, lightnessDelta);
    return value.getHex();
  }
}

let sharedCharacterVisuals: CharacterVisuals | undefined;

/** Convenience entry point for PhysicsWorld; resources stay shared across characters. */
export function decorateCharacter(
  parts: readonly Entity[],
  kind: CharacterKind,
  palette: CharacterVisualPalette,
): void {
  sharedCharacterVisuals ??= new CharacterVisuals();
  sharedCharacterVisuals.decorate(parts, kind, palette);
}
