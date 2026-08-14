import * as THREE from 'three';
import type { Quality } from './types';
import { GoreEffects, type GoreEvent } from './GoreEffects';

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  gravity: number;
  spin: THREE.Vector3;
  size: number;
}

interface Splat {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  size: number;
}

export class ParticleSystem {
  private readonly scene: THREE.Scene;
  private readonly particles: Particle[] = [];
  private readonly particlePool: THREE.Mesh[] = [];
  private readonly splats: Splat[] = [];
  private readonly splatPool: THREE.Sprite[] = [];
  private readonly geometry = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  private readonly materials = new Map<number, THREE.MeshBasicMaterial>();
  private readonly splatTexture: THREE.CanvasTexture;
  /** Render-only character gore, kept separate from general dust/juice. */
  readonly gore: GoreEffects;
  private maxParticles = 450;
  private maxSplats = 28;
  private disposed = false;
  multiplier = 0.75;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.splatTexture = this.createSplatTexture();
    this.gore = new GoreEffects(scene);
  }

  setQuality(quality: Quality): void {
    this.multiplier = quality === 'low' ? 0.45 : quality === 'medium' ? 0.75 : 1;
    this.maxParticles = quality === 'low' ? 240 : quality === 'medium' ? 450 : 700;
    this.maxSplats = quality === 'low' ? 14 : quality === 'medium' ? 28 : 44;
    while (this.particles.length > this.maxParticles) this.recycleParticle(0);
    while (this.splats.length > this.maxSplats) this.recycleSplat(0);
    this.trimPools();
    this.gore.setQuality(quality);
  }

  burst(position: THREE.Vector3, color: number, count = 12, speed = 5, size = 1, gravity = 10): void {
    count = Math.min(
      Math.max(1, Math.floor(count * this.multiplier)),
      Math.max(0, this.maxParticles - this.particles.length),
    );
    for (let i = 0; i < count; i++) {
      const mesh = this.particlePool.pop() ?? new THREE.Mesh(this.geometry, this.getMaterial(color));
      mesh.material = this.getMaterial(color);
      mesh.position.copy(position).add(new THREE.Vector3((Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.25));
      const particleSize = size * (0.55 + Math.random() * 1.1);
      mesh.scale.setScalar(particleSize);
      mesh.visible = true;
      this.scene.add(mesh);
      const direction = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.2, Math.random() - 0.5).normalize();
      const life = 0.45 + Math.random() * 0.55;
      this.particles.push({
        mesh,
        velocity: direction.multiplyScalar(speed * (0.45 + Math.random() * 0.8)),
        life,
        maxLife: life,
        gravity,
        spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
        size: particleSize,
      });
    }
  }

  dust(position: THREE.Vector3, material: string, amount = 10): void {
    const color = material === 'wood' ? 0xc99b6c : material === 'metal' ? 0xf5d262 : material === 'glass' ? 0xa9ecf1 : 0xb8ad95;
    this.burst(position, color, amount, material === 'metal' ? 7 : 3.5, material === 'metal' ? 0.55 : 1.2, material === 'metal' ? 7 : 4);
  }

  explosion(position: THREE.Vector3): void {
    this.burst(position, 0xffd34f, 24, 10, 1.5, 5);
    this.burst(position, 0xe95e3e, 18, 8, 1.25, 6);
    this.burst(position, 0x4a4540, 12, 5, 1.8, 2);
  }

  juice(position: THREE.Vector3, color: number, amount = 16, severity = 1): void {
    const clampedSeverity = THREE.MathUtils.clamp(severity, 0.35, 2.25);
    const highlight = new THREE.Color(color).offsetHSL(0, -0.08, 0.16).getHex();
    this.burst(position, color, amount, 5.3 + clampedSeverity * 1.5, 0.9 + clampedSeverity * 0.28, 11.5);
    this.burst(position, highlight, Math.max(2, Math.floor(amount / 4)), 3.8 + clampedSeverity, 0.62, 9);
    const splatCount = clampedSeverity >= 1.6 ? 3 : clampedSeverity >= 0.8 ? 2 : 1;
    for (let i = 0; i < splatCount; i++) this.addSplat(position, color, clampedSeverity, i);
  }

  /** Substantial crimson hit feedback. No rigid bodies or physics forces. */
  goreHit(event: GoreEvent): void {
    this.gore.hit(event);
  }

  /** Concentrated deep-crimson spray at an anatomical separation point. */
  goreDismemberment(event: GoreEvent): void {
    this.gore.dismember(event);
  }

  /** Larger defeat spray plus a long-lived, capped floor pool. */
  goreDefeat(event: GoreEvent): void {
    this.gore.defeat(event);
  }

  update(delta: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= delta;
      if (p.life <= 0) {
        this.recycleParticle(i);
        continue;
      }
      p.velocity.y -= p.gravity * delta;
      p.mesh.position.addScaledVector(p.velocity, delta);
      p.mesh.rotation.x += p.spin.x * delta;
      p.mesh.rotation.y += p.spin.y * delta;
      p.mesh.rotation.z += p.spin.z * delta;
      // Derive scale from lifetime instead of multiplying once per rendered
      // frame, so the effect looks the same at 30, 60, and 144 Hz.
      const remaining = THREE.MathUtils.clamp(p.life / p.maxLife, 0, 1);
      p.mesh.scale.setScalar(p.size * (0.2 + 0.8 * Math.min(1, remaining * 1.5)));
    }

    for (let i = this.splats.length - 1; i >= 0; i--) {
      const splat = this.splats[i];
      splat.life -= delta;
      if (splat.life <= 0) {
        this.recycleSplat(i);
        continue;
      }
      const remaining = THREE.MathUtils.clamp(splat.life / splat.maxLife, 0, 1);
      const material = splat.sprite.material;
      material.opacity = Math.min(1, remaining * 2.4) * 0.88;
      const growth = 1 + (1 - remaining) * 0.14;
      splat.sprite.scale.setScalar(splat.size * growth);
    }

    this.gore.update(delta);
  }

  clear(): void {
    while (this.particles.length) this.recycleParticle(this.particles.length - 1);
    while (this.splats.length) this.recycleSplat(this.splats.length - 1);
    this.trimPools();
    this.gore.clear();
  }

  /** Release the render-only pools when the owning game scene is torn down. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    this.particlePool.length = 0;
    for (const sprite of this.splatPool) sprite.material.dispose();
    this.splatPool.length = 0;
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.geometry.dispose();
    this.splatTexture.dispose();
    this.gore.dispose();
  }

  private addSplat(position: THREE.Vector3, color: number, severity: number, index: number): void {
    if (this.maxSplats <= 0) return;
    while (this.splats.length >= this.maxSplats) this.recycleSplat(0);
    const sprite = this.splatPool.pop() ?? new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.splatTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.88,
    }));
    sprite.material.color.setHex(color);
    sprite.material.opacity = 0.88;
    sprite.material.rotation = Math.random() * Math.PI * 2;
    sprite.position.copy(position).add(new THREE.Vector3(
      (Math.random() - 0.5) * (0.18 + severity * 0.08),
      (Math.random() - 0.5) * (0.16 + severity * 0.06),
      (Math.random() - 0.5) * (0.18 + severity * 0.08),
    ));
    const size = (0.28 + Math.random() * 0.24 + severity * 0.16) * (index ? 0.72 : 1);
    const life = 4.5 + Math.random() * 3.5;
    sprite.scale.setScalar(size);
    sprite.renderOrder = 3;
    sprite.visible = true;
    this.scene.add(sprite);
    this.splats.push({ sprite, life, maxLife: life, size });
  }

  private recycleParticle(index: number): void {
    const [particle] = this.particles.splice(index, 1);
    if (!particle) return;
    particle.mesh.visible = false;
    this.scene.remove(particle.mesh);
    this.particlePool.push(particle.mesh);
  }

  private recycleSplat(index: number): void {
    const [splat] = this.splats.splice(index, 1);
    if (!splat) return;
    splat.sprite.visible = false;
    this.scene.remove(splat.sprite);
    this.splatPool.push(splat.sprite);
  }

  private trimPools(): void {
    // Particle meshes share geometry/materials, so dropping excess mesh
    // wrappers is sufficient. Splat sprites own their materials individually.
    const particleCapacity = Math.max(0, this.maxParticles - this.particles.length);
    const splatCapacity = Math.max(0, this.maxSplats - this.splats.length);
    if (this.particlePool.length > particleCapacity) this.particlePool.length = particleCapacity;
    while (this.splatPool.length > splatCapacity) this.splatPool.pop()?.material.dispose();
  }

  private getMaterial(color: number): THREE.MeshBasicMaterial {
    let material = this.materials.get(color);
    if (!material) {
      // Shared materials remain fully opaque; per-particle opacity previously
      // made every same-colored particle flicker when one particle faded.
      material = new THREE.MeshBasicMaterial({ color });
      this.materials.set(color, material);
    }
    return material;
  }

  private createSplatTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d')!;
    context.translate(32, 32);
    context.fillStyle = '#ffffff';
    context.beginPath();
    for (let i = 0; i < 20; i++) {
      const angle = i / 20 * Math.PI * 2;
      const radius = i % 2 ? 20 : 26;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
    context.fill();
    for (const [x, y, radius] of [[6, -23, 4], [-22, 13, 3], [23, 15, 3]] as Array<[number, number, number]>) {
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }
}
