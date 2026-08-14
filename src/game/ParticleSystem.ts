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

export class ParticleSystem {
  private readonly scene: THREE.Scene;
  private readonly particles: Particle[] = [];
  private readonly particlePool: THREE.Mesh[] = [];
  private readonly geometry = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  private readonly materials = new Map<number, THREE.MeshBasicMaterial>();
  /** Render-only character gore, kept separate from general dust/juice. */
  readonly gore: GoreEffects;
  private maxParticles = 450;
  private disposed = false;
  multiplier = 0.75;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.gore = new GoreEffects(scene);
  }

  /** Short-lived effects that should finish rather than freeze in mid-air. */
  get hasActiveTransients(): boolean {
    return this.particles.length > 0 || this.gore.hasActiveTransients;
  }

  setQuality(quality: Quality): void {
    this.multiplier = quality === 'low' ? 0.45 : quality === 'medium' ? 0.75 : 1;
    this.maxParticles = quality === 'low' ? 240 : quality === 'medium' ? 450 : 700;
    while (this.particles.length > this.maxParticles) this.recycleParticle(0);
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
    // Persistent hit evidence belongs to GoreEffects, where it is projected
    // onto the floor. The old billboard splats stayed at wound height for up
    // to eight seconds and looked like blood frozen in mid-air.
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

    this.gore.update(delta);
  }

  clear(): void {
    while (this.particles.length) this.recycleParticle(this.particles.length - 1);
    this.trimPools();
    this.gore.clear();
  }

  /** Release the render-only pools when the owning game scene is torn down. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    this.particlePool.length = 0;
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.geometry.dispose();
    this.gore.dispose();
  }

  private recycleParticle(index: number): void {
    const [particle] = this.particles.splice(index, 1);
    if (!particle) return;
    particle.mesh.visible = false;
    this.scene.remove(particle.mesh);
    this.particlePool.push(particle.mesh);
  }

  private trimPools(): void {
    // Particle meshes share geometry/materials, so dropping excess mesh
    // wrappers is sufficient.
    const particleCapacity = Math.max(0, this.maxParticles - this.particles.length);
    if (this.particlePool.length > particleCapacity) this.particlePool.length = particleCapacity;
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

}
