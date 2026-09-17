import * as THREE from 'three';

const POOL_SIZE = 12;
const LIFETIME = 900;

export type CombatPopupKind = 'damage' | 'prop' | 'kill';

interface PopupSlot {
  element: HTMLElement;
  timer: number;
}

/**
 * Pooled floating combat text. Slots are created once, projected from world
 * space at spawn time, and recycled through a rolling cursor so a busy scene
 * never grows the DOM.
 */
export class CombatPopups {
  private readonly container: HTMLElement;
  private readonly slots: PopupSlot[] = [];
  private readonly projection = new THREE.Vector3();
  private cursor = 0;

  constructor(root: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'combat-popups';
    this.container.setAttribute('aria-hidden', 'true');
    root.appendChild(this.container);
  }

  /** Re-attach after a UI render pass replaced the root children. */
  mount(root: HTMLElement): void {
    if (!this.container.isConnected) root.appendChild(this.container);
  }

  clear(): void {
    for (const slot of this.slots) {
      window.clearTimeout(slot.timer);
      slot.timer = 0;
      slot.element.className = 'combat-popup';
      slot.element.textContent = '';
    }
  }

  spawn(point: THREE.Vector3, text: string, kind: CombatPopupKind, camera: THREE.Camera): void {
    if (!this.container.isConnected) return;
    this.projection.copy(point).project(camera);
    if (!Number.isFinite(this.projection.x) || this.projection.z > 1) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width < 1 || height < 1) return;
    const slot = this.acquire();
    const element = slot.element;
    element.textContent = text;
    element.style.left = `${(this.projection.x * 0.5 + 0.5) * width}px`;
    element.style.top = `${(-this.projection.y * 0.5 + 0.5) * height}px`;
    element.className = 'combat-popup';
    void element.offsetWidth;
    element.className = `combat-popup is-${kind} is-live`;
    window.clearTimeout(slot.timer);
    slot.timer = window.setTimeout(() => {
      slot.timer = 0;
      element.className = 'combat-popup';
      element.textContent = '';
    }, LIFETIME);
  }

  private acquire(): PopupSlot {
    for (const slot of this.slots) {
      if (!slot.timer) return slot;
    }
    if (this.slots.length < POOL_SIZE) {
      const element = document.createElement('div');
      element.className = 'combat-popup';
      this.container.appendChild(element);
      const slot: PopupSlot = { element, timer: 0 };
      this.slots.push(slot);
      return slot;
    }
    const slot = this.slots[this.cursor % this.slots.length];
    this.cursor = (this.cursor + 1) % this.slots.length;
    window.clearTimeout(slot.timer);
    slot.timer = 0;
    return slot;
  }
}
