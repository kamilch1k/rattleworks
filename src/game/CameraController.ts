import * as THREE from 'three';
import type { Entity, Vec3 } from './types';

const CAMERA_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  readonly dom: HTMLElement;
  target = new THREE.Vector3(0, 3, 0);
  private desiredTarget = new THREE.Vector3(0, 3, 0);
  private yaw = 0.72;
  private pitch = 0.38;
  private distance = 22;
  private desiredDistance = 22;
  private pointer = new THREE.Vector2();
  private lastPointer = new THREE.Vector2();
  private activePointers = new Map<number, THREE.Vector2>();
  private rotating = false;
  private panning = false;
  private keys = new Set<string>();
  private follow?: Entity;
  private followTimer = 0;
  private followReturnTarget = new THREE.Vector3();
  private followReturnDistance = 18;
  private shake = 0;
  private autoOrbitTimer = 0;
  private autoOrbitSpeed = 0;
  enabled = true;

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.camera = camera;
    this.dom = dom;
    this.bind();
    this.updateTransform(true);
  }

  setView(position: Vec3, target: Vec3, immediate = true): void {
    this.cancelAutoOrbit();
    this.follow = undefined;
    const p = new THREE.Vector3(position.x, position.y, position.z);
    this.target.set(target.x, target.y, target.z);
    this.desiredTarget.copy(this.target);
    const offset = p.sub(this.target);
    this.distance = this.desiredDistance = Math.max(3, offset.length());
    this.yaw = Math.atan2(offset.x, offset.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(offset.y / this.distance, -0.92, 0.92));
    this.updateTransform(immediate);
  }

  reset(position: Vec3, target: Vec3): void {
    this.follow = undefined;
    this.setView(position, target, false);
  }

  focus(entity: Entity): void {
    this.cancelAutoOrbit();
    this.follow = undefined;
    this.desiredTarget.copy(entity.object.position);
    this.desiredDistance = THREE.MathUtils.clamp(entity.size.length() * 3.2, 5, 14);
  }

  /** Slow showcase orbit for result screens; any user input cancels it. */
  autoOrbit(seconds = 7): void {
    if (seconds <= 0) return;
    this.follow = undefined;
    this.autoOrbitTimer = seconds;
    this.autoOrbitSpeed = 0.24;
  }

  cancelAutoOrbit(): void {
    this.autoOrbitTimer = 0;
  }

  followEntity(entity: Entity, seconds = 2.5): void {
    this.cancelAutoOrbit();
    this.followReturnTarget.copy(this.desiredTarget);
    this.followReturnDistance = this.desiredDistance;
    this.follow = entity;
    this.followTimer = seconds;
    this.desiredDistance = 9;
  }

  cancelFollow(): void {
    if (this.follow) {
      this.follow = undefined;
      this.desiredTarget.copy(this.followReturnTarget);
      this.desiredDistance = this.followReturnDistance;
    }
  }

  addShake(amount: number): void {
    this.shake = Math.min(1.5, this.shake + amount);
  }

  update(delta: number): void {
    if (!this.enabled) return;
    let followValid = false;
    if (this.follow) {
      try { followValid = this.follow.body.isValid(); } catch { followValid = false; }
      if (!followValid) this.cancelFollow();
    }
    if (this.follow && followValid) {
      this.followTimer -= delta;
      this.desiredTarget.lerp(this.follow.object.position, 1 - Math.exp(-delta * 8));
      if (this.followTimer <= 0 || this.follow.body.linvel().y < -30) {
        this.follow = undefined;
        this.desiredTarget.copy(this.followReturnTarget);
        this.desiredDistance = this.followReturnDistance;
      }
    }
    if (this.autoOrbitTimer > 0) {
      this.autoOrbitTimer -= delta;
      this.yaw += this.autoOrbitSpeed * delta;
      this.pitch = THREE.MathUtils.lerp(this.pitch, 0.34, 1 - Math.exp(-delta * 0.8));
      this.desiredDistance = THREE.MathUtils.clamp(this.desiredDistance * (1 + delta * 0.02), 5, 32);
    }
    const speed = delta * Math.max(5, this.distance * 0.45);
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.desiredTarget.addScaledVector(forward, speed);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.desiredTarget.addScaledVector(forward, -speed);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.desiredTarget.addScaledVector(right, -speed);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.desiredTarget.addScaledVector(right, speed);
    if (this.keys.has('KeyQ')) this.desiredTarget.y = Math.max(0, this.desiredTarget.y - speed);
    if (this.keys.has('KeyE')) this.desiredTarget.y = Math.min(25, this.desiredTarget.y + speed);
    this.target.lerp(this.desiredTarget, 1 - Math.exp(-delta * 9));
    this.distance = THREE.MathUtils.lerp(this.distance, this.desiredDistance, 1 - Math.exp(-delta * 8));
    this.shake *= Math.exp(-delta * 8);
    this.updateTransform(false);
  }

  private updateTransform(immediate: boolean): void {
    const cosPitch = Math.cos(this.pitch);
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * cosPitch * this.distance,
      Math.sin(this.pitch) * this.distance,
      Math.cos(this.yaw) * cosPitch * this.distance,
    );
    if (this.shake > 0.002) offset.add(new THREE.Vector3((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake));
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
  }

  private bind(): void {
    this.dom.addEventListener('contextmenu', (event) => event.preventDefault());
    this.dom.addEventListener('pointerdown', (event) => {
      this.cancelAutoOrbit();
      this.activePointers.set(event.pointerId, new THREE.Vector2(event.clientX, event.clientY));
      this.lastPointer.set(event.clientX, event.clientY);
      this.rotating = event.button === 2 || event.button === 1 || event.altKey;
      this.panning = event.button === 1 || event.shiftKey;
      if (this.rotating || this.panning) this.dom.setPointerCapture(event.pointerId);
    });
    this.dom.addEventListener('pointermove', (event) => {
      const current = new THREE.Vector2(event.clientX, event.clientY);
      this.activePointers.set(event.pointerId, current);
      const dx = current.x - this.lastPointer.x;
      const dy = current.y - this.lastPointer.y;
      if (this.activePointers.size >= 2) {
        const points = [...this.activePointers.values()];
        const distance = points[0].distanceTo(points[1]);
        const previous = this.pointer.x || distance;
        this.desiredDistance = THREE.MathUtils.clamp(this.desiredDistance - (distance - previous) * 0.03, 3, 48);
        this.pointer.x = distance;
        this.yaw -= dx * 0.003;
        this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.002, -0.15, 1.25);
      } else if (this.rotating) {
        this.yaw -= dx * 0.006;
        this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.005, -0.15, 1.25);
      } else if (this.panning) {
        const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        const up = new THREE.Vector3(0, 1, 0);
        this.desiredTarget.addScaledVector(right, -dx * this.distance * 0.0015);
        this.desiredTarget.addScaledVector(up, dy * this.distance * 0.0015);
      }
      this.lastPointer.copy(current);
    });
    const finish = (event: PointerEvent) => {
      this.activePointers.delete(event.pointerId);
      this.rotating = false;
      this.panning = false;
      this.pointer.x = 0;
    };
    this.dom.addEventListener('pointerup', finish);
    this.dom.addEventListener('pointercancel', finish);
    this.dom.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.cancelAutoOrbit();
      this.desiredDistance = THREE.MathUtils.clamp(this.desiredDistance * Math.exp(event.deltaY * 0.001), 3, 52);
    }, { passive: false });
    window.addEventListener('keydown', (event) => {
      if ((event.target as HTMLElement).matches('input, textarea')) return;
      if (CAMERA_KEYS.has(event.code)) this.cancelAutoOrbit();
      this.keys.add(event.code);
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
  }
}
