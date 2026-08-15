import * as THREE from 'three';
import type { Quality } from './types';
import { assetUrl } from './assets';

/**
 * Original, stylized pixel-gore assets. The texture bank deliberately keeps a
 * tiny embedded mask as a loading/error fallback so a missing optional bitmap
 * can never turn a hit into a WebGL error or an opaque rectangle.
 */
export const GORE_TEXTURE_PATHS = {
  droplet: assetUrl('textures/pixel/gore/blood-droplet-pixel-v2.png'),
  splatA: assetUrl('textures/pixel/gore/blood-splat-a-pixel-v2.png'),
  splatB: assetUrl('textures/pixel/gore/blood-splat-b-pixel-v2.png'),
  splatC: assetUrl('textures/pixel/gore/blood-splat-c-pixel-v2.png'),
  chunk: assetUrl('textures/pixel/gore/blood-chunk-pixel-v2.png'),
  flash: assetUrl('textures/pixel/gore/hit-flash-pixel-v2.png'),
} as const;

type GoreTextureRole = keyof typeof GORE_TEXTURE_PATHS;

export interface GorePalette {
  /** Primary blood tint. Defaults to a deep crimson. */
  blood?: THREE.ColorRepresentation;
  /** Dark pixels and settled pools. Derived from blood when omitted. */
  darkBlood?: THREE.ColorRepresentation;
  /** Small bright pixels used at the instant of impact. */
  highlight?: THREE.ColorRepresentation;
  /** Optional character-specific tint on a minority of blocky fragments. */
  accent?: THREE.ColorRepresentation;
}

export interface GoreEvent {
  /** World-space impact or character-center point. */
  point: THREE.Vector3;
  /** World-space direction away from the source of the hit. */
  direction?: THREE.Vector3;
  /** Suggested range is 0.25..3. Larger values are safely clamped. */
  severity?: number;
  /** Convenience override for palette.blood. */
  bloodColor?: THREE.ColorRepresentation;
  palette?: GorePalette;
  /** Top of the visual ground. Rattleworks' default floor is y=0. */
  groundY?: number;
}

interface GoreColors {
  blood: THREE.Color;
  dark: THREE.Color;
  highlight: THREE.Color;
  accent: THREE.Color;
}

interface Droplet {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  groundY: number;
  projects: boolean;
  blood: THREE.Color;
  dark: THREE.Color;
}

interface Chunk {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  groundY: number;
}

interface Flash {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  size: number;
}

interface FloorSplat {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
  sizeX: number;
  sizeY: number;
}

interface TextureSlot {
  fallback: THREE.DataTexture;
  loaded?: THREE.Texture;
  failed: boolean;
  users: Set<THREE.Material & { map: THREE.Texture | null }>;
}

const FALLBACK_MASKS: Readonly<Record<GoreTextureRole, readonly string[]>> = {
  droplet: [
    '...##...', '..####..', '..####..', '.######.', '.######.', '..####..', '...##...', '........',
  ],
  splatA: [
    '..#.....', '.###..#.', '######..', '.######.', '#######.', '..####..', '.#..###.', '.....#..',
  ],
  splatB: [
    '.....#..', '..####..', '.######.', '########', '.######.', '#######.', '..###.#.', '.#......',
  ],
  splatC: [
    '.#......', '..###...', '.#######', '########', '..#####.', '.######.', '...###..', '......#.',
  ],
  chunk: [
    '........', '..####..', '.######.', '.######.', '.######.', '.######.', '..####..', '........',
  ],
  flash: [
    '...##...', '#..##..#', '.######.', '..####..', '########', '..####..', '.##..##.', '#......#',
  ],
};

class GoreTextureBank {
  private readonly loader = new THREE.TextureLoader();
  private readonly slots = new Map<GoreTextureRole, TextureSlot>();
  private readonly rolesByMaterial = new Map<THREE.Material & { map: THREE.Texture | null }, GoreTextureRole>();
  private disposed = false;

  bind(role: GoreTextureRole, material: THREE.Material & { map: THREE.Texture | null }): void {
    if (this.disposed) return;
    const previousRole = this.rolesByMaterial.get(material);
    if (previousRole && previousRole !== role) this.slots.get(previousRole)?.users.delete(material);
    const slot = this.slot(role);
    slot.users.add(material);
    this.rolesByMaterial.set(material, role);
    material.map = slot.loaded ?? slot.fallback;
    material.needsUpdate = true;
  }

  unbind(material: THREE.Material & { map: THREE.Texture | null }): void {
    const role = this.rolesByMaterial.get(material);
    if (!role) return;
    this.slots.get(role)?.users.delete(material);
    this.rolesByMaterial.delete(material);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots.values()) {
      slot.loaded?.dispose();
      slot.fallback.dispose();
      slot.users.clear();
    }
    this.rolesByMaterial.clear();
    this.slots.clear();
  }

  private slot(role: GoreTextureRole): TextureSlot {
    const cached = this.slots.get(role);
    if (cached) return cached;

    const fallback = this.fallbackTexture(role);
    const slot: TextureSlot = { fallback, failed: false, users: new Set() };
    this.slots.set(role, slot);

    if (typeof document !== 'undefined') {
      this.loader.load(
        GORE_TEXTURE_PATHS[role],
        (texture) => {
          // TextureLoader callbacks can outlive a scene teardown. Do not retain
          // or rebind a texture after the effect bank has been disposed.
          if (this.disposed) {
            texture.dispose();
            return;
          }
          this.configure(texture, `pixel-gore-${role}`);
          slot.loaded = texture;
          for (const material of slot.users) {
            material.map = texture;
            material.needsUpdate = true;
          }
        },
        undefined,
        () => {
          slot.failed = true;
          // Keep the fixed pixel mask. Missing optional art is intentionally
          // non-fatal and does not create a solid square in the scene.
          for (const material of slot.users) {
            material.map = fallback;
            material.needsUpdate = true;
          }
        },
      );
    }

    return slot;
  }

  private fallbackTexture(role: GoreTextureRole): THREE.DataTexture {
    const mask = FALLBACK_MASKS[role];
    const pixels = new Uint8Array(8 * 8 * 4);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const offset = (y * 8 + x) * 4;
        const visible = mask[y]?.[x] === '#';
        pixels[offset] = 255;
        pixels[offset + 1] = 255;
        pixels[offset + 2] = 255;
        pixels[offset + 3] = visible ? 255 : 0;
      }
    }
    const texture = new THREE.DataTexture(pixels, 8, 8, THREE.RGBAFormat);
    this.configure(texture, `pixel-gore-${role}-fallback`);
    texture.needsUpdate = true;
    return texture;
  }

  private configure(texture: THREE.Texture, name: string): void {
    texture.name = name;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
  }
}

/**
 * Render-only gore feedback. Nothing in this class creates a Rapier body,
 * collider, joint, force, or impulse, which keeps larger bursts independent of
 * gameplay physics stability.
 */
export class GoreEffects {
  private readonly scene: THREE.Scene;
  private readonly textures = new GoreTextureBank();
  private readonly chunkGeometry = new THREE.BoxGeometry(0.11, 0.11, 0.11);
  private readonly splatGeometry = new THREE.PlaneGeometry(1, 1);

  private readonly droplets: Droplet[] = [];
  private readonly dropletPool: THREE.Sprite[] = [];
  private readonly chunks: Chunk[] = [];
  private readonly chunkPool: Array<THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>> = [];
  private readonly flashes: Flash[] = [];
  private readonly flashPool: THREE.Sprite[] = [];
  private readonly splats: FloorSplat[] = [];
  private readonly splatPool: Array<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>> = [];

  private density = 0.8;
  private maxDroplets = 76;
  private maxChunks = 30;
  private maxFlashes = 8;
  private maxSplats = 46;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Airborne/flash effects must keep settling even if gameplay is paused. */
  get hasActiveTransients(): boolean {
    return this.droplets.length > 0 || this.chunks.length > 0 || this.flashes.length > 0;
  }

  setQuality(quality: Quality): void {
    this.density = quality === 'low' ? 0.5 : quality === 'medium' ? 0.8 : 1;
    this.maxDroplets = quality === 'low' ? 38 : quality === 'medium' ? 76 : 128;
    this.maxChunks = quality === 'low' ? 14 : quality === 'medium' ? 30 : 52;
    this.maxFlashes = quality === 'low' ? 5 : quality === 'medium' ? 8 : 12;
    this.maxSplats = quality === 'low' ? 20 : quality === 'medium' ? 46 : 76;

    while (this.droplets.length > this.maxDroplets) this.recycleDroplet(0);
    while (this.chunks.length > this.maxChunks) this.recycleChunk(0);
    while (this.flashes.length > this.maxFlashes) this.recycleFlash(0);
    while (this.splats.length > this.maxSplats) this.recycleSplat(0);
    this.trimPools();
  }

  hit(event: GoreEvent): void {
    const severity = THREE.MathUtils.clamp(event.severity ?? 1, 0.2, 3);
    const colors = this.resolveColors(event);
    const direction = this.resolveDirection(event.direction);
    const groundY = event.groundY ?? 0;

    this.addFlash(event.point, colors.highlight, 0.42 + severity * 0.22);

    // Ordinary hits need to read clearly even on medium quality. These remain
    // pooled render-only sprites, so a denser spray does not add physics work.
    const droplets = Math.max(3, Math.round((10 + severity * 9) * this.density));
    for (let i = 0; i < droplets; i++) {
      this.addDroplet(event.point, direction, colors, severity, groundY, i / droplets < 0.72);
    }

    const chunks = Math.max(1, Math.round((2 + severity * 2.6) * this.density));
    for (let i = 0; i < chunks; i++) {
      const color = i === 0 && event.palette?.accent ? colors.accent : (i % 3 ? colors.blood : colors.dark);
      this.addChunk(event.point, direction, color, severity, groundY);
    }

    // Leave readable evidence of meaningful impacts. Keeping these render-only
    // avoids feeding extra bodies back into an already violent physics event.
    if (severity >= 0.55) {
      this.addFloorSplat(
        new THREE.Vector3(event.point.x, groundY + 0.014, event.point.z),
        severity > 1.25 ? colors.blood : colors.dark,
        THREE.MathUtils.clamp(0.28 + severity * 0.2, 0.34, 0.78),
        severity > 1.45 ? 'splatB' : 'splatA',
      );
      if (severity >= 1.05) {
        // A second, smaller mark follows the horizontal hit direction. It is
        // explicitly projected to groundY instead of remaining at wound height.
        this.addFloorSplat(
          new THREE.Vector3(
            event.point.x + direction.x * (0.2 + severity * 0.08),
            groundY + 0.016,
            event.point.z + direction.z * (0.2 + severity * 0.08),
          ),
          colors.blood,
          THREE.MathUtils.clamp(0.22 + severity * 0.14, 0.3, 0.58),
          'splatC',
        );
      }
    }
  }

  /** A concentrated, two-sided spray emitted exactly where anatomy separates. */
  dismember(event: GoreEvent): void {
    const severity = THREE.MathUtils.clamp(Math.max(1.25, event.severity ?? 1.8), 1.25, 3);
    const colors = this.resolveColors(event);
    const direction = this.resolveDirection(event.direction);
    const groundY = event.groundY ?? 0;

    this.addFlash(event.point, colors.highlight, 0.72 + severity * 0.3);
    const droplets = Math.round((16 + severity * 9) * this.density);
    for (let i = 0; i < droplets; i++) {
      const side = i % 3 === 0 ? -0.48 : 1;
      const spray = direction.clone().multiplyScalar(side).add(new THREE.Vector3(
        (Math.random() - 0.5) * 0.52,
        0.16 + Math.random() * 0.58,
        (Math.random() - 0.5) * 0.52,
      )).normalize();
      this.addDroplet(event.point, spray, colors, severity, groundY, i % 5 !== 0);
    }

    const chunks = Math.round((4 + severity * 2.6) * this.density);
    for (let i = 0; i < chunks; i++) {
      const spray = direction.clone().multiplyScalar(i % 2 ? 0.8 : -0.35).add(new THREE.Vector3(
        Math.random() - 0.5,
        0.25 + Math.random() * 0.7,
        Math.random() - 0.5,
      )).normalize();
      this.addChunk(event.point, spray, i % 3 ? colors.blood : colors.dark, severity, groundY);
    }

    // A severed joint should stay visually obvious after the airborne spray
    // has settled, so place two overlapping pixel pools beneath the wound.
    this.addFloorSplat(
      new THREE.Vector3(event.point.x, groundY + 0.016, event.point.z),
      colors.blood,
      THREE.MathUtils.clamp(0.68 + severity * 0.3, 0.85, 1.55),
      'splatC',
    );
    this.addFloorSplat(
      new THREE.Vector3(
        event.point.x + direction.x * 0.22,
        groundY + 0.018,
        event.point.z + direction.z * 0.22,
      ),
      colors.dark,
      THREE.MathUtils.clamp(0.42 + severity * 0.2, 0.55, 1.05),
      'splatA',
    );
  }

  defeat(event: GoreEvent): void {
    const severity = THREE.MathUtils.clamp(Math.max(1.45, event.severity ?? 2), 1.45, 3);
    const colors = this.resolveColors(event);
    const direction = this.resolveDirection(event.direction);
    const groundY = event.groundY ?? 0;

    this.addFlash(event.point, colors.highlight, 0.82 + severity * 0.28);
    // A defeated character gets a wider, still stylized spray plus a small
    // settled pool. This remains visual feedback, never physical debris.
    const droplets = Math.round((18 + severity * 11) * this.density);
    for (let i = 0; i < droplets; i++) {
      const radial = direction.clone().multiplyScalar(0.8).add(new THREE.Vector3(
        Math.cos(i / droplets * Math.PI * 2) * 0.55,
        0.3 + Math.random() * 0.55,
        Math.sin(i / droplets * Math.PI * 2) * 0.55,
      )).normalize();
      this.addDroplet(event.point, radial, colors, severity, groundY, i % 4 !== 0);
    }

    const chunks = Math.round((4 + severity * 3.2) * this.density);
    for (let i = 0; i < chunks; i++) {
      const radial = new THREE.Vector3(Math.random() - 0.5, 0.35 + Math.random(), Math.random() - 0.5).normalize();
      this.addChunk(event.point, radial, i % 3 ? colors.dark : colors.blood, severity, groundY);
    }

    this.addFloorSplat(
      new THREE.Vector3(event.point.x, groundY + 0.012, event.point.z),
      colors.blood,
      THREE.MathUtils.clamp(1.08 + severity * 0.46, 1.25, 2.35),
      severity > 2.3 ? 'splatC' : 'splatB',
    );
    this.addFloorSplat(
      new THREE.Vector3(
        event.point.x - direction.x * 0.28,
        groundY + 0.014,
        event.point.z - direction.z * 0.28,
      ),
      colors.dark,
      THREE.MathUtils.clamp(0.58 + severity * 0.26, 0.75, 1.35),
      'splatA',
    );
  }

  update(delta: number): void {
    const dt = Math.min(Math.max(delta, 0), 0.05);

    for (let i = this.droplets.length - 1; i >= 0; i--) {
      const droplet = this.droplets[i];
      droplet.life -= dt;
      if (droplet.life <= 0) {
        this.recycleDroplet(i);
        continue;
      }

      droplet.velocity.y -= 12.8 * dt;
      droplet.sprite.position.addScaledVector(droplet.velocity, dt);
      if (droplet.sprite.position.y <= droplet.groundY + 0.025 && droplet.velocity.y < 0) {
        if (droplet.projects) {
          const impactSpeed = THREE.MathUtils.clamp(droplet.velocity.length() / 9, 0.5, 1.15);
          this.addFloorSplat(
            new THREE.Vector3(droplet.sprite.position.x, droplet.groundY + 0.012, droplet.sprite.position.z),
            Math.random() > 0.28 ? droplet.blood : droplet.dark,
            droplet.size * (2.2 + impactSpeed * 1.8),
            this.randomSplatRole(),
          );
        }
        this.recycleDroplet(i);
        continue;
      }

      const remaining = THREE.MathUtils.clamp(droplet.life / droplet.maxLife, 0, 1);
      droplet.sprite.material.opacity = Math.min(1, remaining * 3.5) * 0.96;
      const stretch = 1 + THREE.MathUtils.clamp(droplet.velocity.length() / 12, 0, 0.8);
      droplet.sprite.scale.set(droplet.size * 0.72, droplet.size * stretch, 1);
    }

    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const chunk = this.chunks[i];
      chunk.life -= dt;
      if (chunk.life <= 0) {
        this.recycleChunk(i);
        continue;
      }

      chunk.velocity.y -= 11.5 * dt;
      chunk.mesh.position.addScaledVector(chunk.velocity, dt);
      chunk.mesh.rotation.x += chunk.spin.x * dt;
      chunk.mesh.rotation.y += chunk.spin.y * dt;
      chunk.mesh.rotation.z += chunk.spin.z * dt;
      // The shared cube is 0.11 units tall; `size` is a visual scale factor,
      // not a world-space radius. Chunks are airborne-only evidence: once one
      // reaches the floor it becomes an optional grounded decal and is
      // recycled immediately. Keeping a zero-velocity cube alive was easy to
      // read as blood frozen a few centimetres above uneven scenery.
      const floorHeight = chunk.groundY + 0.055 * chunk.mesh.scale.y;
      if (chunk.mesh.position.y <= floorHeight && chunk.velocity.y < 0) {
        if (Math.random() < 0.42) {
          this.addFloorSplat(
            new THREE.Vector3(chunk.mesh.position.x, chunk.groundY + 0.013, chunk.mesh.position.z),
            chunk.mesh.material.color,
            THREE.MathUtils.clamp(chunk.size * 0.2, 0.15, 0.31),
            this.randomSplatRole(),
          );
        }
        this.recycleChunk(i);
        continue;
      }
      const remaining = THREE.MathUtils.clamp(chunk.life / chunk.maxLife, 0, 1);
      chunk.mesh.material.opacity = Math.min(1, remaining * 2.8);
      chunk.mesh.scale.setScalar(chunk.size * (0.45 + Math.min(1, remaining * 2) * 0.55));
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const flash = this.flashes[i];
      flash.life -= dt;
      if (flash.life <= 0) {
        this.recycleFlash(i);
        continue;
      }
      const remaining = THREE.MathUtils.clamp(flash.life / flash.maxLife, 0, 1);
      flash.sprite.material.opacity = remaining * remaining * 0.92;
      flash.sprite.scale.setScalar(flash.size * (1 + (1 - remaining) * 0.85));
    }

    for (let i = this.splats.length - 1; i >= 0; i--) {
      const splat = this.splats[i];
      splat.life -= dt;
      if (splat.life <= 0) {
        this.recycleSplat(i);
        continue;
      }
      const remaining = THREE.MathUtils.clamp(splat.life / splat.maxLife, 0, 1);
      // Pools stay fully readable for most of their long life, then fade near
      // expiry so capped recycling never pops conspicuously.
      splat.mesh.material.opacity = Math.min(0.92, remaining * 3.2);
      const settle = 1 + (1 - Math.min(1, remaining * 8)) * 0.08;
      splat.mesh.scale.set(splat.sizeX * settle, splat.sizeY * settle, 1);
    }
  }

  clear(): void {
    while (this.droplets.length) this.recycleDroplet(this.droplets.length - 1);
    while (this.chunks.length) this.recycleChunk(this.chunks.length - 1);
    while (this.flashes.length) this.recycleFlash(this.flashes.length - 1);
    while (this.splats.length) this.recycleSplat(this.splats.length - 1);
    this.trimPools();
  }

  dispose(): void {
    this.clear();
    for (const sprite of this.dropletPool) sprite.material.dispose();
    for (const mesh of this.chunkPool) mesh.material.dispose();
    for (const sprite of this.flashPool) sprite.material.dispose();
    for (const mesh of this.splatPool) mesh.material.dispose();
    this.dropletPool.length = 0;
    this.chunkPool.length = 0;
    this.flashPool.length = 0;
    this.splatPool.length = 0;
    this.chunkGeometry.dispose();
    this.splatGeometry.dispose();
    this.textures.dispose();
  }

  private addDroplet(
    point: THREE.Vector3,
    direction: THREE.Vector3,
    colors: GoreColors,
    severity: number,
    groundY: number,
    projects: boolean,
  ): void {
    if (this.maxDroplets <= 0) return;
    while (this.droplets.length >= this.maxDroplets) this.recycleDroplet(0);

    const sprite = this.dropletPool.pop() ?? this.createDropletSprite();
    const color = Math.random() < 0.22 ? colors.dark : colors.blood;
    sprite.material.color.copy(color);
    sprite.material.opacity = 0.96;
    sprite.material.rotation = Math.random() * Math.PI * 2;
    sprite.position.copy(point).add(new THREE.Vector3(
      (Math.random() - 0.5) * 0.16,
      (Math.random() - 0.25) * 0.14,
      (Math.random() - 0.5) * 0.16,
    ));

    const jitter = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.85 + 0.12, Math.random() - 0.5);
    const launchDirection = direction.clone().multiplyScalar(1.25 + severity * 0.18).add(jitter).normalize();
    const velocity = launchDirection.multiplyScalar((3.8 + severity * 2.2) * (0.52 + Math.random() * 0.72));
    velocity.y += 1.15 + Math.random() * (1.2 + severity * 0.42);
    const size = (0.1 + Math.random() * 0.085) * (0.8 + severity * 0.16);
    const life = 1.3 + Math.random() * 1.15;
    sprite.scale.set(size, size * 1.4, 1);
    sprite.visible = true;
    sprite.renderOrder = 7;
    this.scene.add(sprite);
    this.droplets.push({
      sprite,
      velocity,
      life,
      maxLife: life,
      size,
      groundY,
      projects,
      blood: colors.blood.clone(),
      dark: colors.dark.clone(),
    });
  }

  private addChunk(
    point: THREE.Vector3,
    direction: THREE.Vector3,
    color: THREE.Color,
    severity: number,
    groundY: number,
  ): void {
    if (this.maxChunks <= 0) return;
    while (this.chunks.length >= this.maxChunks) this.recycleChunk(0);
    const mesh = this.chunkPool.pop() ?? this.createChunkMesh();
    mesh.material.color.copy(color);
    mesh.material.opacity = 1;
    mesh.position.copy(point).add(new THREE.Vector3(
      (Math.random() - 0.5) * 0.18,
      (Math.random() - 0.35) * 0.16,
      (Math.random() - 0.5) * 0.18,
    ));
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    const size = 0.68 + Math.random() * 0.72;
    mesh.scale.setScalar(size);
    mesh.visible = true;
    mesh.renderOrder = 6;
    this.scene.add(mesh);

    const velocity = direction.clone().multiplyScalar(2 + severity * 1.1).add(new THREE.Vector3(
      (Math.random() - 0.5) * 3.1,
      1.2 + Math.random() * 2.8,
      (Math.random() - 0.5) * 3.1,
    ));
    const life = 1.25 + Math.random() * 1.15;
    this.chunks.push({
      mesh,
      velocity,
      spin: new THREE.Vector3(Math.random() * 11 - 5.5, Math.random() * 11 - 5.5, Math.random() * 11 - 5.5),
      life,
      maxLife: life,
      size,
      groundY,
    });
  }

  private addFlash(point: THREE.Vector3, color: THREE.Color, size: number): void {
    if (this.maxFlashes <= 0) return;
    while (this.flashes.length >= this.maxFlashes) this.recycleFlash(0);
    const sprite = this.flashPool.pop() ?? this.createFlashSprite();
    sprite.position.copy(point);
    sprite.material.color.copy(color);
    sprite.material.opacity = 0.92;
    sprite.material.rotation = Math.random() * Math.PI * 2;
    sprite.scale.setScalar(size);
    sprite.visible = true;
    sprite.renderOrder = 9;
    this.scene.add(sprite);
    const life = 0.09 + Math.random() * 0.045;
    this.flashes.push({ sprite, life, maxLife: life, size });
  }

  private addFloorSplat(
    point: THREE.Vector3,
    color: THREE.Color,
    size: number,
    role: 'splatA' | 'splatB' | 'splatC',
  ): void {
    if (this.maxSplats <= 0) return;
    while (this.splats.length >= this.maxSplats) this.recycleSplat(0);
    const mesh = this.splatPool.pop() ?? this.createSplatMesh();
    this.textures.bind(role, mesh.material);
    mesh.material.color.copy(color);
    mesh.material.opacity = 0.92;
    mesh.position.copy(point);
    mesh.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
    const sizeX = THREE.MathUtils.clamp(size * (0.82 + Math.random() * 0.46), 0.14, 1.8);
    const sizeY = THREE.MathUtils.clamp(size * (0.62 + Math.random() * 0.4), 0.11, 1.45);
    mesh.scale.set(sizeX, sizeY, 1);
    mesh.visible = true;
    mesh.renderOrder = 4;
    this.scene.add(mesh);
    const life = 28 + Math.random() * 26;
    this.splats.push({ mesh, life, maxLife: life, sizeX, sizeY });
  }

  private createDropletSprite(): THREE.Sprite {
    const material = new THREE.SpriteMaterial({
      transparent: true,
      depthWrite: false,
      alphaTest: 0.16,
      opacity: 0.96,
    });
    this.textures.bind('droplet', material);
    return new THREE.Sprite(material);
  }

  private createChunkMesh(): THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> {
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 1,
      alphaTest: 0.12,
    });
    this.textures.bind('chunk', material);
    return new THREE.Mesh(this.chunkGeometry, material);
  }

  private createFlashSprite(): THREE.Sprite {
    const material = new THREE.SpriteMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      alphaTest: 0.08,
      opacity: 0.92,
    });
    this.textures.bind('flash', material);
    return new THREE.Sprite(material);
  }

  private createSplatMesh(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      alphaTest: 0.1,
      opacity: 0.84,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.textures.bind('splatA', material);
    return new THREE.Mesh(this.splatGeometry, material);
  }

  private recycleDroplet(index: number): void {
    const [droplet] = this.droplets.splice(index, 1);
    if (!droplet) return;
    droplet.sprite.visible = false;
    this.scene.remove(droplet.sprite);
    this.dropletPool.push(droplet.sprite);
  }

  private recycleChunk(index: number): void {
    const [chunk] = this.chunks.splice(index, 1);
    if (!chunk) return;
    chunk.mesh.visible = false;
    this.scene.remove(chunk.mesh);
    this.chunkPool.push(chunk.mesh);
  }

  private recycleFlash(index: number): void {
    const [flash] = this.flashes.splice(index, 1);
    if (!flash) return;
    flash.sprite.visible = false;
    this.scene.remove(flash.sprite);
    this.flashPool.push(flash.sprite);
  }

  private recycleSplat(index: number): void {
    const [splat] = this.splats.splice(index, 1);
    if (!splat) return;
    splat.mesh.visible = false;
    this.scene.remove(splat.mesh);
    this.splatPool.push(splat.mesh);
  }

  private trimPools(): void {
    // Bound live plus pooled wrappers to the quality budget. This matters when
    // lowering quality while effects are active: capping each list separately
    // would otherwise retain as many as twice the requested budget.
    const dropletCapacity = Math.max(0, this.maxDroplets - this.droplets.length);
    const chunkCapacity = Math.max(0, this.maxChunks - this.chunks.length);
    const flashCapacity = Math.max(0, this.maxFlashes - this.flashes.length);
    const splatCapacity = Math.max(0, this.maxSplats - this.splats.length);
    while (this.dropletPool.length > dropletCapacity) {
      const sprite = this.dropletPool.pop();
      if (!sprite) break;
      this.textures.unbind(sprite.material);
      sprite.material.dispose();
    }
    while (this.chunkPool.length > chunkCapacity) {
      const mesh = this.chunkPool.pop();
      if (!mesh) break;
      this.textures.unbind(mesh.material);
      mesh.material.dispose();
    }
    while (this.flashPool.length > flashCapacity) {
      const sprite = this.flashPool.pop();
      if (!sprite) break;
      this.textures.unbind(sprite.material);
      sprite.material.dispose();
    }
    while (this.splatPool.length > splatCapacity) {
      const mesh = this.splatPool.pop();
      if (!mesh) break;
      this.textures.unbind(mesh.material);
      mesh.material.dispose();
    }
  }

  private resolveColors(event: GoreEvent): GoreColors {
    const blood = new THREE.Color(event.bloodColor ?? event.palette?.blood ?? 0xa20f2d);
    const dark = event.palette?.darkBlood
      ? new THREE.Color(event.palette.darkBlood)
      : blood.clone().multiplyScalar(0.48).offsetHSL(-0.01, 0.04, -0.025);
    const highlight = event.palette?.highlight
      ? new THREE.Color(event.palette.highlight)
      : blood.clone().offsetHSL(-0.015, -0.08, 0.24);
    const accent = new THREE.Color(event.palette?.accent ?? blood).lerp(blood, 0.42);
    return { blood, dark, highlight, accent };
  }

  private resolveDirection(direction?: THREE.Vector3): THREE.Vector3 {
    if (!direction || direction.lengthSq() < 0.0001) return new THREE.Vector3(0, 0.72, 0.25).normalize();
    return direction.clone().normalize();
  }

  private randomSplatRole(): 'splatA' | 'splatB' | 'splatC' {
    const roll = Math.random();
    return roll < 0.4 ? 'splatA' : roll < 0.78 ? 'splatB' : 'splatC';
  }
}
