import * as THREE from 'three';
import type { Entity, ToolId } from './types';
import type { PhysicsWorld } from './PhysicsWorld';

export interface SelectionCallbacks {
  onSelection?: (entities: Entity[]) => void;
  onToolAction?: (tool: ToolId, point: THREE.Vector3, entity?: Entity) => void;
  isAimMode?: () => boolean;
  onAimMove?: (clientX: number, clientY: number, point: THREE.Vector3, entity?: Entity) => void;
  onAimFire?: (point: THREE.Vector3, entity?: Entity) => void;
}

interface DragState {
  entity: Entity;
  pointerId: number;
  depth: number;
  rawPoint: THREE.Vector3;
  point: THREE.Vector3;
  targetVelocity: THREE.Vector3;
  localOffset: THREE.Vector3;
  controlledMass: number;
  linearDamping: number;
  angularDamping: number;
  ccdEnabled: boolean;
}

const TARGET_SMOOTH_TIME = 0.09;
const MAX_TARGET_DISTANCE = 3.5;
const MAX_CONTROL_ERROR = 2.4;
const MAX_PROP_TARGET_SPEED = 18;
const MAX_RAGDOLL_TARGET_SPEED = 10;
const MAX_PROP_ACCELERATION = 52;
const MAX_RAGDOLL_ACCELERATION = 30;
const MAX_DRAG_FORCE = 1800;
const MAX_HELD_SPEED = 24;
const MAX_HELD_ANGULAR_SPEED = 14;

export class SelectionSystem {
  readonly selected = new Set<Entity>();
  tool: ToolId = 'grab';
  private readonly camera: THREE.Camera;
  private readonly dom: HTMLElement;
  private readonly physics: PhysicsWorld;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private drag?: DragState;
  private connectorFirst?: Entity;
  private outline?: THREE.BoxHelper;
  private outlineTarget?: THREE.Object3D;
  private callbacks: SelectionCallbacks;
  private down = new THREE.Vector2();
  private moved = false;
  private readonly aimPointers = new Set<number>();
  private aimPointerId?: number;
  private readonly aimDown = new THREE.Vector2();
  private aimMoved = false;
  enabled = true;

  constructor(camera: THREE.Camera, dom: HTMLElement, physics: PhysicsWorld, callbacks: SelectionCallbacks = {}) {
    this.camera = camera;
    this.dom = dom;
    this.physics = physics;
    this.callbacks = callbacks;
    this.bind();
  }

  setTool(tool: ToolId): void {
    this.endDrag();
    this.clearAimInteraction();
    this.tool = tool;
    this.connectorFirst = undefined;
    this.updateCursor();
  }

  clear(): void {
    this.endDrag();
    this.clearAimInteraction();
    for (const e of this.selected) e.selected = false;
    this.selected.clear();
    this.connectorFirst = undefined;
    this.updateOutline();
    this.callbacks.onSelection?.([]);
  }

  select(entity?: Entity, additive = false): void {
    if (!additive) this.clear();
    if (entity) {
      if (this.selected.has(entity) && additive) {
        entity.selected = false;
        this.selected.delete(entity);
      } else {
        entity.selected = true;
        this.selected.add(entity);
      }
    }
    this.updateOutline();
    this.callbacks.onSelection?.([...this.selected]);
  }

  duplicateSelected(): void {
    const originals = [...this.selected];
    this.clear();
    for (const entity of originals) {
      if (entity.characterId) continue;
      const p = entity.object.position;
      const copy = this.physics.spawn({
        type: entity.type, position: { x: p.x + 0.8, y: p.y + 0.4, z: p.z + 0.8 },
        scale: { x: entity.size.x, y: entity.size.y, z: entity.size.z },
        material: entity.material, fixed: entity.fixed,
      }, true);
      if (copy && 'body' in copy) {
        const q = entity.body.rotation();
        copy.body.setRotation(q, true);
        this.select(copy, true);
      }
    }
  }

  private defaultSize(type: string): THREE.Vector3 {
    const map: Record<string, [number, number, number]> = {
      beam: [0.42, 3.2, 0.42], plank: [2.4, 0.25, 0.7], 'wall-block': [1.4, 0.75, 0.55],
      'concrete-block': [1.35, 1.05, 1], crate: [1.05, 1.05, 1.05], platform: [3.2, 0.35, 1.8],
    };
    return new THREE.Vector3(...(map[type] ?? [1, 1, 1]));
  }

  update(delta: number): void {
    const drag = this.drag;
    if (!drag) return;
    const entity = drag.entity;
    if (!this.enabled || this.physics.paused || this.physics.simulationScale <= 0 || entity.fixed || !this.isLive(entity)) {
      this.endDrag(false);
      return;
    }

    const body = entity.body;
    // Rapier's user force is persistent. Replace our force every frame instead
    // of accumulating another spring force on top of all the previous frames.
    body.resetForces(false);
    body.resetTorques(false);

    const position = body.translation();
    const rotation = body.rotation();
    const velocity = body.linvel();
    if (![position.x, position.y, position.z, rotation.x, rotation.y, rotation.z, rotation.w,
      velocity.x, velocity.y, velocity.z].every(Number.isFinite)) {
      this.endDrag();
      return;
    }

    const ragdoll = entity.characterId !== undefined;
    const maxTargetSpeed = ragdoll ? MAX_RAGDOLL_TARGET_SPEED : MAX_PROP_TARGET_SPEED;
    const maxAcceleration = ragdoll ? MAX_RAGDOLL_ACCELERATION : MAX_PROP_ACCELERATION;
    const dt = Number.isFinite(delta) ? THREE.MathUtils.clamp(delta, 0, 1 / 30) : 0;
    const current = new THREE.Vector3(position.x, position.y, position.z);
    const worldOffset = drag.localOffset.clone().applyQuaternion(
      new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
    );
    const currentGrabPoint = current.clone().add(worldOffset);

    // A lost pointer, camera jump, or very fast swipe cannot place the spring
    // an arbitrary distance away from the body in one frame.
    const boundedRawPoint = drag.rawPoint.clone();
    const rawDistance = boundedRawPoint.distanceTo(currentGrabPoint);
    if (rawDistance > MAX_TARGET_DISTANCE) {
      boundedRawPoint.sub(currentGrabPoint).setLength(MAX_TARGET_DISTANCE).add(currentGrabPoint);
    }
    this.smoothTarget(drag, boundedRawPoint, dt, maxTargetSpeed);

    const error = drag.point.clone().sub(currentGrabPoint);
    if (error.length() > MAX_CONTROL_ERROR) error.setLength(MAX_CONTROL_ERROR);
    const bodyVelocity = new THREE.Vector3(velocity.x, velocity.y, velocity.z);
    const pointVelocityRaw = body.velocityAtPoint({
      x: currentGrabPoint.x,
      y: currentGrabPoint.y,
      z: currentGrabPoint.z,
    });
    const pointVelocity = new THREE.Vector3(pointVelocityRaw.x, pointVelocityRaw.y, pointVelocityRaw.z);
    if (bodyVelocity.length() > MAX_HELD_SPEED) {
      bodyVelocity.setLength(MAX_HELD_SPEED);
      body.setLinvel({ x: bodyVelocity.x, y: bodyVelocity.y, z: bodyVelocity.z }, true);
    }
    this.clampAngularVelocity(entity, MAX_HELD_ANGULAR_SPEED);

    // F = m(w^2*x + 2w*(targetVelocity - velocity)) is a critically damped
    // PD controller. Character mass includes the linked ragdoll so an arm does
    // not receive tuning intended for a loose half-kilogram prop.
    const response = ragdoll ? 7.5 : 9.5;
    const acceleration = error.clone().multiplyScalar(response * response)
      .add(drag.targetVelocity.clone().sub(pointVelocity).multiplyScalar(2 * response));
    if (acceleration.length() > maxAcceleration) acceleration.setLength(maxAcceleration);

    const force = acceleration.multiplyScalar(drag.controlledMass);
    const massScaledForceLimit = Math.min(MAX_DRAG_FORCE, drag.controlledMass * maxAcceleration);
    if (force.length() > massScaledForceLimit) force.setLength(massScaledForceLimit);
    if (![force.x, force.y, force.z].every(Number.isFinite)) return;

    const moving = error.lengthSq() > 0.0004 || drag.targetVelocity.lengthSq() > 0.0025;
    if (moving && body.isSleeping()) body.wakeUp();
    const gravity = this.physics.world.gravity;
    if ([gravity.x, gravity.y, gravity.z].every(Number.isFinite)) {
      // Gravity support acts through the center of mass. Folding it into the
      // picked-point force created a constant twisting moment whenever the
      // cursor was holding the edge of a limb or prop.
      body.addForce({
        x: -gravity.x * drag.controlledMass,
        y: -gravity.y * drag.controlledMass,
        z: -gravity.z * drag.controlledMass,
      }, false);
    }
    body.addForceAtPoint(
      { x: force.x, y: force.y, z: force.z },
      { x: currentGrabPoint.x, y: currentGrabPoint.y, z: currentGrabPoint.z },
      false,
    );
    this.updateOutline();
  }

  private bind(): void {
    this.dom.addEventListener('pointerdown', (event) => {
      if (!this.enabled || event.altKey) return;
      if (event.button === 0 && this.callbacks.isAimMode?.()) {
        this.aimPointers.add(event.pointerId);
        if (this.aimPointers.size === 1) {
          this.aimPointerId = event.pointerId;
          this.aimDown.set(event.clientX, event.clientY);
          this.aimMoved = false;
          this.emitAimMove(event.clientX, event.clientY);
        } else {
          // A second touch belongs to the camera gesture. Cancel the shot so a
          // pinch or two-finger orbit can never accidentally launch an item.
          this.aimPointerId = undefined;
          this.aimMoved = true;
        }
        return;
      }
      if (event.button !== 0) return;
      this.down.set(event.clientX, event.clientY);
      this.moved = false;
      const hit = this.pick(event.clientX, event.clientY);
      if (this.tool === 'grab' && hit?.entity && !hit.entity.fixed) {
        this.select(hit.entity, event.shiftKey);
        const entity = hit.entity;
        if (!this.isLive(entity)) return;
        const body = entity.body;
        const position = body.translation();
        const rotation = body.rotation();
        const inverseRotation = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w).invert();
        const center = new THREE.Vector3(position.x, position.y, position.z);
        const localOffset = hit.point.clone().sub(center).applyQuaternion(inverseRotation);
        const maxOffset = Math.max(0.25, entity.size.length() * 0.7);
        if (localOffset.length() > maxOffset) localOffset.setLength(maxOffset);
        const linearDamping = body.linearDamping();
        const angularDamping = body.angularDamping();
        const ccdEnabled = body.isCcdEnabled();
        const ragdoll = entity.characterId !== undefined;
        body.resetForces(false);
        body.resetTorques(false);
        body.enableCcd(true);
        body.setLinearDamping(Math.max(linearDamping, ragdoll ? 1.4 : 0.85));
        body.setAngularDamping(Math.max(angularDamping, ragdoll ? 2.4 : 1.35));
        body.wakeUp();
        this.drag = {
          entity,
          pointerId: event.pointerId,
          depth: THREE.MathUtils.clamp(this.raycaster.ray.origin.distanceTo(hit.point), 0.25, 120),
          rawPoint: hit.point.clone(),
          point: hit.point.clone(),
          targetVelocity: new THREE.Vector3(),
          localOffset,
          controlledMass: this.controlledMass(entity),
          linearDamping,
          angularDamping,
          ccdEnabled,
        };
        try {
          this.dom.setPointerCapture(event.pointerId);
        } catch {
          // Pointer capture can fail if the browser cancels the pointer during setup.
        }
        this.updateCursor();
      }
    });
    this.dom.addEventListener('pointermove', (event) => {
      if (!this.enabled) {
        this.endDrag(false);
        return;
      }
      if (this.callbacks.isAimMode?.()) {
        if (this.aimPointerId === event.pointerId) {
          if (this.aimDown.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 7) this.aimMoved = true;
          this.emitAimMove(event.clientX, event.clientY);
        } else if (this.aimPointers.size === 0 && event.pointerType === 'mouse') {
          this.emitAimMove(event.clientX, event.clientY);
        }
        return;
      }
      if (this.down.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 5) this.moved = true;
      if (this.drag?.pointerId === event.pointerId) {
        this.updatePointer(event.clientX, event.clientY);
        this.raycaster.setFromCamera(this.pointer, this.camera);
        this.drag.rawPoint.copy(this.raycaster.ray.at(this.drag.depth, new THREE.Vector3()));
      }
    });
    this.dom.addEventListener('pointerup', (event) => {
      if (event.button !== 0) return;
      if (this.aimPointers.has(event.pointerId)) {
        const fire = this.aimPointerId === event.pointerId && !this.aimMoved && this.enabled && this.callbacks.isAimMode?.();
        const hit = fire ? this.pick(event.clientX, event.clientY) : undefined;
        const point = hit?.point ?? (fire ? this.groundPoint(event.clientX, event.clientY) : undefined);
        this.aimPointers.delete(event.pointerId);
        this.aimPointerId = undefined;
        this.aimMoved = false;
        if (fire && point) this.callbacks.onAimFire?.(point, hit?.entity);
        return;
      }
      if (this.drag?.pointerId === event.pointerId) {
        this.endDrag();
        return;
      }
      if (!this.enabled) return;
      const hit = this.pick(event.clientX, event.clientY);
      if (this.moved) return;
      if (this.tool === 'grab') {
        this.select(hit?.entity, event.shiftKey);
        return;
      }
      const point = hit?.point ?? this.groundPoint(event.clientX, event.clientY);
      if (['connect', 'rope', 'spring', 'hinge', 'motor'].includes(this.tool) && hit?.entity) {
        if (!this.connectorFirst) {
          this.connectorFirst = hit.entity;
          this.select(hit.entity);
        } else if (this.connectorFirst.id !== hit.entity.id) {
          const type = this.tool === 'connect' ? 'weld' : this.tool;
          this.physics.createConnector(type as 'weld' | 'rope' | 'spring' | 'hinge' | 'motor', this.connectorFirst, hit.entity);
          this.connectorFirst = undefined;
          this.select(hit.entity);
        }
      } else {
        this.callbacks.onToolAction?.(this.tool, point, hit?.entity);
      }
    });
    this.dom.addEventListener('pointercancel', (event) => {
      if (this.aimPointers.has(event.pointerId)) this.clearAimInteraction();
      if (this.drag?.pointerId === event.pointerId) this.endDrag();
    });
    this.dom.addEventListener('lostpointercapture', (event) => {
      if (this.aimPointers.has(event.pointerId)) this.clearAimInteraction();
      if (this.drag?.pointerId === event.pointerId) this.endDrag();
    });
    window.addEventListener('blur', () => {
      this.clearAimInteraction();
      this.endDrag();
    });
  }

  private smoothTarget(drag: DragState, target: THREE.Vector3, delta: number, maxSpeed: number): void {
    if (delta <= 0 || ![target.x, target.y, target.z].every(Number.isFinite)) return;
    const omega = 2 / TARGET_SMOOTH_TIME;
    const change = drag.point.clone().sub(target);
    const maxChange = maxSpeed * TARGET_SMOOTH_TIME;
    if (change.length() > maxChange) change.setLength(maxChange);
    const adjustedTarget = drag.point.clone().sub(change);
    const decay = Math.exp(-omega * delta);
    const temp = drag.targetVelocity.clone().addScaledVector(change, omega).multiplyScalar(delta);
    drag.targetVelocity.addScaledVector(temp, -omega).multiplyScalar(decay);
    if (drag.targetVelocity.length() > maxSpeed) drag.targetVelocity.setLength(maxSpeed);
    const output = adjustedTarget.add(change.add(temp).multiplyScalar(decay));

    // Prevent residual smoothing velocity from overshooting after a sharp
    // reversal of the mouse direction.
    if (target.clone().sub(drag.point).dot(output.clone().sub(target)) > 0) {
      drag.point.copy(target);
      drag.targetVelocity.set(0, 0, 0);
    } else {
      drag.point.copy(output);
    }
  }

  private controlledMass(entity: Entity): number {
    let mass = entity.body.mass();
    if (entity.characterId !== undefined) {
      const selectedPartMass = Number.isFinite(mass) && mass > 0 ? mass : 1;
      const character = this.physics.characters.get(entity.characterId);
      if (character) {
        const aggregate = character.parts.reduce((total, part) => {
          if (!this.isLive(part)) return total;
          const partMass = part.body.mass();
          return total + (Number.isFinite(partMass) && partMass > 0 ? partMass : 0);
        }, 0);
        if (aggregate > 0) mass = Math.min(aggregate, Math.max(1.8, selectedPartMass * 3.5));
      }
    }
    return THREE.MathUtils.clamp(Number.isFinite(mass) && mass > 0 ? mass : 1, 0.1, 35);
  }

  private isLive(entity: Entity): boolean {
    if (this.physics.entities.get(entity.id) !== entity) return false;
    try {
      return entity.body.isValid();
    } catch {
      return false;
    }
  }

  private clampAngularVelocity(entity: Entity, maximum: number): void {
    const angular = entity.body.angvel();
    if (![angular.x, angular.y, angular.z].every(Number.isFinite)) return;
    const speed = Math.hypot(angular.x, angular.y, angular.z);
    if (speed <= maximum) return;
    const scale = maximum / speed;
    entity.body.setAngvel({ x: angular.x * scale, y: angular.y * scale, z: angular.z * scale }, true);
  }

  private endDrag(clampMotion = true): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = undefined;

    if (this.isLive(drag.entity)) {
      const body = drag.entity.body;
      body.resetForces(false);
      body.resetTorques(false);
      body.setLinearDamping(drag.linearDamping);
      body.setAngularDamping(drag.angularDamping);
      body.enableCcd(drag.ccdEnabled);
      if (clampMotion) {
        const velocity = body.linvel();
        const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
        if (Number.isFinite(speed) && speed > MAX_HELD_SPEED) {
          const scale = MAX_HELD_SPEED / speed;
          body.setLinvel({ x: velocity.x * scale, y: velocity.y * scale, z: velocity.z * scale }, true);
        }
        this.clampAngularVelocity(drag.entity, MAX_HELD_ANGULAR_SPEED);
      }
    }

    try {
      if (this.dom.hasPointerCapture(drag.pointerId)) this.dom.releasePointerCapture(drag.pointerId);
    } catch {
      // The browser may already have released capture after pointerup/cancel.
    }
    this.updateCursor();
  }

  refreshCursor(): void {
    this.updateCursor();
  }

  private updateCursor(): void {
    this.dom.style.cursor = !this.enabled
      ? 'default'
      : this.callbacks.isAimMode?.()
        ? 'crosshair'
      : this.drag
        ? 'grabbing'
        : this.tool === 'grab'
          ? 'grab'
          : this.tool === 'delete'
            ? 'not-allowed'
            : 'crosshair';
  }

  private emitAimMove(clientX: number, clientY: number): void {
    const hit = this.pick(clientX, clientY);
    this.callbacks.onAimMove?.(clientX, clientY, hit?.point ?? this.groundPoint(clientX, clientY), hit?.entity);
  }

  private clearAimInteraction(): void {
    this.aimPointers.clear();
    this.aimPointerId = undefined;
    this.aimMoved = false;
  }

  private pick(clientX: number, clientY: number): { entity?: Entity; point: THREE.Vector3 } | undefined {
    this.updatePointer(clientX, clientY);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const objects = [...this.physics.entities.values()].map((e) => e.object);
    const hits = this.raycaster.intersectObjects(objects, true);
    for (const hit of hits) {
      let object: THREE.Object3D | null = hit.object;
      while (object && !object.userData.entityId) object = object.parent;
      const entity = object ? this.physics.entities.get(object.userData.entityId) : undefined;
      if (entity) return { entity, point: hit.point };
    }
    return undefined;
  }

  private groundPoint(clientX: number, clientY: number): THREE.Vector3 {
    this.updatePointer(clientX, clientY);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.ray.intersectPlane(this.plane, new THREE.Vector3())
      ?? this.raycaster.ray.at(35, new THREE.Vector3());
  }

  private updatePointer(clientX: number, clientY: number): void {
    const rect = this.dom.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  private updateOutline(): void {
    const primary = [...this.selected][0];
    if (!primary || this.physics.entities.get(primary.id) !== primary) {
      if (this.outline) this.outline.visible = false;
      this.outlineTarget = undefined;
      return;
    }

    if (!this.outline) {
      this.outline = new THREE.BoxHelper(primary.object, 0xffd84f);
      (this.outline.material as THREE.LineBasicMaterial).depthTest = false;
      (this.outline.material as THREE.LineBasicMaterial).transparent = true;
      (this.outline.material as THREE.LineBasicMaterial).opacity = 0.9;
      this.outline.renderOrder = 100;
      this.physics.scene.add(this.outline);
      this.outlineTarget = primary.object;
      return;
    }

    this.outline.visible = true;
    if (this.outline.parent !== this.physics.scene) this.physics.scene.add(this.outline);
    if (this.outlineTarget !== primary.object) {
      this.outline.setFromObject(primary.object);
      this.outlineTarget = primary.object;
    } else {
      this.outline.update();
    }
  }
}
