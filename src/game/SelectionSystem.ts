import * as THREE from 'three';
import type { Entity, ToolId } from './types';
import type { PhysicsWorld } from './PhysicsWorld';

export interface SelectionCallbacks {
  onSelection?: (entities: Entity[]) => void;
  onToolAction?: (tool: ToolId, point: THREE.Vector3, entity?: Entity) => void;
  isAimMode?: () => boolean;
  onAimMove?: (clientX: number, clientY: number, point: THREE.Vector3, entity?: Entity) => void;
  onAimFire?: (point: THREE.Vector3, entity?: Entity) => void;
  onContextUse?: (point: THREE.Vector3, entity?: Entity) => void;
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
const OUTLINE_UPDATE_INTERVAL = 1 / 30;

export class SelectionSystem {
  readonly selected = new Set<Entity>();
  tool: ToolId = 'grab';
  private readonly camera: THREE.Camera;
  private readonly dom: HTMLElement;
  private readonly physics: PhysicsWorld;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly raycastObjects: THREE.Object3D[] = [];
  private readonly raycastHits: THREE.Intersection[] = [];
  private readonly rayPoint = new THREE.Vector3();
  private readonly dragCurrent = new THREE.Vector3();
  private readonly dragWorldOffset = new THREE.Vector3();
  private readonly dragGrabPoint = new THREE.Vector3();
  private readonly dragBoundedTarget = new THREE.Vector3();
  private readonly dragError = new THREE.Vector3();
  private readonly dragBodyVelocity = new THREE.Vector3();
  private readonly dragPointVelocity = new THREE.Vector3();
  private readonly dragAcceleration = new THREE.Vector3();
  private readonly dragVelocityDelta = new THREE.Vector3();
  private readonly dragQuaternion = new THREE.Quaternion();
  private readonly smoothChange = new THREE.Vector3();
  private readonly smoothAdjustedTarget = new THREE.Vector3();
  private readonly smoothTemp = new THREE.Vector3();
  private readonly smoothOutput = new THREE.Vector3();
  private readonly smoothTargetDelta = new THREE.Vector3();
  private readonly smoothOutputDelta = new THREE.Vector3();
  private drag?: DragState;
  private connectorFirst?: Entity;
  private outline?: THREE.BoxHelper;
  private outlineTarget?: THREE.Object3D;
  private readonly outlinePosition = new THREE.Vector3();
  private readonly outlineQuaternion = new THREE.Quaternion();
  private readonly outlineScale = new THREE.Vector3();
  private callbacks: SelectionCallbacks;
  private down = new THREE.Vector2();
  private moved = false;
  private readonly aimPointers = new Set<number>();
  private aimPointerId?: number;
  private readonly aimDown = new THREE.Vector2();
  private aimMoved = false;
  private readonly activeTouchPointers = new Set<number>();
  private readonly gestureTouchPointers = new Set<number>();
  private secondaryPointerId?: number;
  private readonly secondaryDown = new THREE.Vector2();
  private secondaryMoved = false;
  private pendingAimMove = false;
  private pendingAimX = 0;
  private pendingAimY = 0;
  private outlineElapsed = 0;
  private boundsLeft = 0;
  private boundsTop = 0;
  private boundsWidth = 1;
  private boundsHeight = 1;
  private lastCursor = '';
  enabled = true;

  constructor(camera: THREE.Camera, dom: HTMLElement, physics: PhysicsWorld, callbacks: SelectionCallbacks = {}) {
    this.camera = camera;
    this.dom = dom;
    this.physics = physics;
    this.callbacks = callbacks;
    this.refreshBounds();
    this.bind();
  }

  get primary(): Entity | undefined {
    return this.selected.values().next().value;
  }

  setTool(tool: ToolId): void {
    this.endDrag();
    this.clearAimInteraction();
    this.tool = tool;
    this.connectorFirst = undefined;
    this.updateCursor();
  }

  clear(): void {
    this.clearSelectionState();
    this.updateOutline(true);
    this.callbacks.onSelection?.([]);
  }

  select(entity?: Entity, additive = false): void {
    if (!additive) {
      const unchanged = Boolean(entity && this.selected.size === 1 && this.selected.has(entity));
      this.clearSelectionState();
      if (unchanged && entity) {
        entity.selected = true;
        this.selected.add(entity);
        this.updateOutline(true);
        return;
      }
    }
    if (entity) {
      if (this.selected.has(entity) && additive) {
        entity.selected = false;
        this.selected.delete(entity);
      } else {
        entity.selected = true;
        this.selected.add(entity);
      }
    }
    this.updateOutline(true);
    this.callbacks.onSelection?.([...this.selected]);
  }

  duplicateSelected(): void {
    const originals = [...this.selected];
    this.clearSelectionState();
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
        copy.selected = true;
        this.selected.add(copy);
      }
    }
    this.updateOutline(true);
    this.callbacks.onSelection?.([...this.selected]);
  }

  update(delta: number): void {
    this.flushAimMove();
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
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)
      || !Number.isFinite(rotation.x) || !Number.isFinite(rotation.y) || !Number.isFinite(rotation.z) || !Number.isFinite(rotation.w)
      || !Number.isFinite(velocity.x) || !Number.isFinite(velocity.y) || !Number.isFinite(velocity.z)) {
      this.endDrag();
      return;
    }

    const ragdoll = entity.characterId !== undefined;
    const maxTargetSpeed = ragdoll ? MAX_RAGDOLL_TARGET_SPEED : MAX_PROP_TARGET_SPEED;
    const maxAcceleration = ragdoll ? MAX_RAGDOLL_ACCELERATION : MAX_PROP_ACCELERATION;
    const dt = Number.isFinite(delta) ? THREE.MathUtils.clamp(delta, 0, 1 / 30) : 0;
    const current = this.dragCurrent.set(position.x, position.y, position.z);
    const worldOffset = this.dragWorldOffset.copy(drag.localOffset).applyQuaternion(
      this.dragQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w),
    );
    const currentGrabPoint = this.dragGrabPoint.copy(current).add(worldOffset);

    // A lost pointer, camera jump, or very fast swipe cannot place the spring
    // an arbitrary distance away from the body in one frame.
    const boundedRawPoint = this.dragBoundedTarget.copy(drag.rawPoint);
    const rawDistanceSq = boundedRawPoint.distanceToSquared(currentGrabPoint);
    if (rawDistanceSq > MAX_TARGET_DISTANCE * MAX_TARGET_DISTANCE) {
      boundedRawPoint.sub(currentGrabPoint).setLength(MAX_TARGET_DISTANCE).add(currentGrabPoint);
    }
    this.smoothTarget(drag, boundedRawPoint, dt, maxTargetSpeed);

    const error = this.dragError.copy(drag.point).sub(currentGrabPoint);
    if (error.lengthSq() > MAX_CONTROL_ERROR * MAX_CONTROL_ERROR) error.setLength(MAX_CONTROL_ERROR);
    const bodyVelocity = this.dragBodyVelocity.set(velocity.x, velocity.y, velocity.z);
    const pointVelocityRaw = body.velocityAtPoint({
      x: currentGrabPoint.x,
      y: currentGrabPoint.y,
      z: currentGrabPoint.z,
    });
    const pointVelocity = this.dragPointVelocity.set(pointVelocityRaw.x, pointVelocityRaw.y, pointVelocityRaw.z);
    if (bodyVelocity.lengthSq() > MAX_HELD_SPEED * MAX_HELD_SPEED) {
      bodyVelocity.setLength(MAX_HELD_SPEED);
      body.setLinvel({ x: bodyVelocity.x, y: bodyVelocity.y, z: bodyVelocity.z }, true);
    }
    this.clampAngularVelocity(entity, MAX_HELD_ANGULAR_SPEED);

    // F = m(w^2*x + 2w*(targetVelocity - velocity)) is a critically damped
    // PD controller. Character mass includes the linked ragdoll so an arm does
    // not receive tuning intended for a loose half-kilogram prop.
    const response = ragdoll ? 7.5 : 9.5;
    const acceleration = this.dragAcceleration.copy(error).multiplyScalar(response * response)
      .add(this.dragVelocityDelta.copy(drag.targetVelocity).sub(pointVelocity).multiplyScalar(2 * response));
    if (acceleration.lengthSq() > maxAcceleration * maxAcceleration) acceleration.setLength(maxAcceleration);

    const force = acceleration.multiplyScalar(drag.controlledMass);
    const massScaledForceLimit = Math.min(MAX_DRAG_FORCE, drag.controlledMass * maxAcceleration);
    if (force.lengthSq() > massScaledForceLimit * massScaledForceLimit) force.setLength(massScaledForceLimit);
    if (!Number.isFinite(force.x) || !Number.isFinite(force.y) || !Number.isFinite(force.z)) return;

    const moving = error.lengthSq() > 0.0004 || drag.targetVelocity.lengthSq() > 0.0025;
    if (moving && body.isSleeping()) body.wakeUp();
    const gravity = this.physics.world.gravity;
    if (Number.isFinite(gravity.x) && Number.isFinite(gravity.y) && Number.isFinite(gravity.z)) {
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
  }

  private bind(): void {
    this.dom.addEventListener('pointerdown', (event) => {
      if (!this.enabled) return;
      if (event.pointerType === 'touch') {
        this.activeTouchPointers.add(event.pointerId);
        if (this.activeTouchPointers.size > 1) {
          // Once a second finger lands, the whole gesture belongs to the camera.
          // Suppress the later taps from selecting or firing when the pinch ends.
          for (const pointerId of this.activeTouchPointers) this.gestureTouchPointers.add(pointerId);
          this.clearAimInteraction();
          this.endDrag(false);
          return;
        }
      }
      if (event.button === 2) {
        this.secondaryPointerId = event.pointerId;
        this.secondaryDown.set(event.clientX, event.clientY);
        this.secondaryMoved = false;
        return;
      }
      if (event.altKey) return;
      if (event.button === 0 && this.callbacks.isAimMode?.()) {
        this.aimPointers.add(event.pointerId);
        if (this.aimPointers.size === 1) {
          this.aimPointerId = event.pointerId;
          this.aimDown.set(event.clientX, event.clientY);
          this.aimMoved = false;
          this.queueAimMove(event.clientX, event.clientY);
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
      if (this.secondaryPointerId === event.pointerId) {
        if (this.movedBeyond(this.secondaryDown, event.clientX, event.clientY, 6)) this.secondaryMoved = true;
        return;
      }
      if (this.gestureTouchPointers.has(event.pointerId)) return;
      if (this.callbacks.isAimMode?.()) {
        if (this.aimPointerId === event.pointerId) {
          if (this.movedBeyond(this.aimDown, event.clientX, event.clientY, 7)) this.aimMoved = true;
          this.queueAimMove(event.clientX, event.clientY);
        } else if (this.aimPointers.size === 0 && event.pointerType === 'mouse') {
          this.queueAimMove(event.clientX, event.clientY);
        }
        return;
      }
      if (this.movedBeyond(this.down, event.clientX, event.clientY, 5)) this.moved = true;
      if (this.drag?.pointerId === event.pointerId) {
        this.updatePointer(event.clientX, event.clientY);
        this.raycaster.setFromCamera(this.pointer, this.camera);
        this.drag.rawPoint.copy(this.raycaster.ray.at(this.drag.depth, this.rayPoint));
      }
    });
    this.dom.addEventListener('pointerup', (event) => {
      const cameraGesture = this.gestureTouchPointers.has(event.pointerId);
      if (event.pointerType === 'touch') {
        this.activeTouchPointers.delete(event.pointerId);
        this.gestureTouchPointers.delete(event.pointerId);
        if (this.activeTouchPointers.size === 0) this.gestureTouchPointers.clear();
      }
      if (cameraGesture) return;
      if (event.button === 2 && this.secondaryPointerId === event.pointerId) {
        const useContext = this.enabled && !this.secondaryMoved;
        this.secondaryPointerId = undefined;
        this.secondaryMoved = false;
        if (useContext) {
          const hit = this.pick(event.clientX, event.clientY);
          const point = hit?.point ?? this.groundPoint(event.clientX, event.clientY);
          // A quick right click is contextual; a right drag remains camera orbit.
          // Keep the current weapon selected while aim mode is being cancelled.
          if (!this.callbacks.isAimMode?.()) this.select(hit?.entity);
          this.callbacks.onContextUse?.(point, hit?.entity);
        }
        return;
      }
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
      this.releaseTouchPointer(event.pointerId);
      if (this.secondaryPointerId === event.pointerId) this.clearSecondaryInteraction();
      if (this.aimPointers.has(event.pointerId)) this.clearAimInteraction();
      if (this.drag?.pointerId === event.pointerId) this.endDrag();
    });
    this.dom.addEventListener('lostpointercapture', (event) => {
      if (this.secondaryPointerId === event.pointerId) this.clearSecondaryInteraction();
      if (this.aimPointers.has(event.pointerId)) this.clearAimInteraction();
      if (this.drag?.pointerId === event.pointerId) this.endDrag();
    });
    window.addEventListener('blur', () => {
      this.activeTouchPointers.clear();
      this.gestureTouchPointers.clear();
      this.clearSecondaryInteraction();
      this.clearAimInteraction();
      this.endDrag();
    });
  }

  private smoothTarget(drag: DragState, target: THREE.Vector3, delta: number, maxSpeed: number): void {
    if (delta <= 0 || !Number.isFinite(target.x) || !Number.isFinite(target.y) || !Number.isFinite(target.z)) return;
    const omega = 2 / TARGET_SMOOTH_TIME;
    const change = this.smoothChange.copy(drag.point).sub(target);
    const maxChange = maxSpeed * TARGET_SMOOTH_TIME;
    if (change.lengthSq() > maxChange * maxChange) change.setLength(maxChange);
    const adjustedTarget = this.smoothAdjustedTarget.copy(drag.point).sub(change);
    const decay = Math.exp(-omega * delta);
    const temp = this.smoothTemp.copy(drag.targetVelocity).addScaledVector(change, omega).multiplyScalar(delta);
    drag.targetVelocity.addScaledVector(temp, -omega).multiplyScalar(decay);
    if (drag.targetVelocity.lengthSq() > maxSpeed * maxSpeed) drag.targetVelocity.setLength(maxSpeed);
    const output = this.smoothOutput.copy(adjustedTarget).add(change.add(temp).multiplyScalar(decay));

    // Prevent residual smoothing velocity from overshooting after a sharp
    // reversal of the mouse direction.
    if (this.smoothTargetDelta.copy(target).sub(drag.point).dot(this.smoothOutputDelta.copy(output).sub(target)) > 0) {
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
    if (!Number.isFinite(angular.x) || !Number.isFinite(angular.y) || !Number.isFinite(angular.z)) return;
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

  suspend(): void {
    this.activeTouchPointers.clear();
    this.gestureTouchPointers.clear();
    this.clearSecondaryInteraction();
    this.clearAimInteraction();
    this.endDrag(false);
  }

  refreshBounds(): void {
    const rect = this.dom.getBoundingClientRect();
    this.boundsLeft = rect.left;
    this.boundsTop = rect.top;
    this.boundsWidth = Math.max(1, rect.width);
    this.boundsHeight = Math.max(1, rect.height);
  }

  updateVisuals(delta: number): void {
    if (!this.outline?.visible || !this.outlineTarget) return;
    this.outlineElapsed += Math.max(0, Math.min(delta, 0.05));
    if (this.outlineElapsed < OUTLINE_UPDATE_INTERVAL) return;
    this.outlineElapsed %= OUTLINE_UPDATE_INTERVAL;
    this.updateOutline();
  }

  private updateCursor(): void {
    const cursor = !this.enabled
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
    if (cursor === this.lastCursor) return;
    this.lastCursor = cursor;
    this.dom.style.cursor = cursor;
  }

  private emitAimMove(clientX: number, clientY: number): void {
    const hit = this.pick(clientX, clientY);
    this.callbacks.onAimMove?.(clientX, clientY, hit?.point ?? this.groundPoint(clientX, clientY), hit?.entity);
  }

  private queueAimMove(clientX: number, clientY: number): void {
    this.pendingAimX = clientX;
    this.pendingAimY = clientY;
    this.pendingAimMove = true;
  }

  private flushAimMove(): void {
    if (!this.pendingAimMove) return;
    this.pendingAimMove = false;
    if (!this.enabled || this.physics.paused || !this.callbacks.isAimMode?.()) return;
    this.emitAimMove(this.pendingAimX, this.pendingAimY);
  }

  private clearAimInteraction(): void {
    this.aimPointers.clear();
    this.aimPointerId = undefined;
    this.aimMoved = false;
    this.pendingAimMove = false;
  }

  private clearSecondaryInteraction(): void {
    this.secondaryPointerId = undefined;
    this.secondaryMoved = false;
  }

  private releaseTouchPointer(pointerId: number): void {
    this.activeTouchPointers.delete(pointerId);
    this.gestureTouchPointers.delete(pointerId);
    if (this.activeTouchPointers.size === 0) this.gestureTouchPointers.clear();
  }

  private movedBeyond(origin: THREE.Vector2, clientX: number, clientY: number, threshold: number): boolean {
    const dx = clientX - origin.x;
    const dy = clientY - origin.y;
    return dx * dx + dy * dy > threshold * threshold;
  }

  private clearSelectionState(): void {
    this.endDrag();
    this.clearAimInteraction();
    for (const entity of this.selected) entity.selected = false;
    this.selected.clear();
    this.connectorFirst = undefined;
  }

  private pick(clientX: number, clientY: number): { entity?: Entity; point: THREE.Vector3 } | undefined {
    this.updatePointer(clientX, clientY);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.raycastObjects.length = 0;
    for (const entity of this.physics.entities.values()) this.raycastObjects.push(entity.object);
    this.raycastHits.length = 0;
    this.raycaster.intersectObjects(this.raycastObjects, true, this.raycastHits);
    for (const hit of this.raycastHits) {
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
    return this.raycaster.ray.intersectPlane(this.plane, this.rayPoint)
      ?? this.raycaster.ray.at(35, this.rayPoint);
  }

  private updatePointer(clientX: number, clientY: number): void {
    this.pointer.x = ((clientX - this.boundsLeft) / this.boundsWidth) * 2 - 1;
    this.pointer.y = -((clientY - this.boundsTop) / this.boundsHeight) * 2 + 1;
  }

  private updateOutline(force = false): void {
    const primary = this.primary;
    if (!primary || this.physics.entities.get(primary.id) !== primary) {
      if (this.outline) this.outline.visible = false;
      this.outlineTarget = undefined;
      this.outlineElapsed = 0;
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
      this.rememberOutlineTransform(primary.object);
      this.outlineElapsed = 0;
      return;
    }

    this.outline.visible = true;
    if (this.outline.parent !== this.physics.scene) this.physics.scene.add(this.outline);
    if (this.outlineTarget !== primary.object) {
      this.outline.setFromObject(primary.object);
      this.outlineTarget = primary.object;
      this.rememberOutlineTransform(primary.object);
      this.outlineElapsed = 0;
    } else if (force || this.outlineTransformChanged(primary.object)) {
      this.outline.update();
      this.rememberOutlineTransform(primary.object);
    }
  }

  private outlineTransformChanged(object: THREE.Object3D): boolean {
    return !this.outlinePosition.equals(object.position)
      || !this.outlineQuaternion.equals(object.quaternion)
      || !this.outlineScale.equals(object.scale);
  }

  private rememberOutlineTransform(object: THREE.Object3D): void {
    this.outlinePosition.copy(object.position);
    this.outlineQuaternion.copy(object.quaternion);
    this.outlineScale.copy(object.scale);
  }
}
