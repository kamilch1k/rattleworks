import * as THREE from 'three';
import type { Blueprint, Character, Entity, GameMode, LevelDefinition, LevelResult, Phase, Quality, SaveData, SnapshotEntity, ToolId, WorldSnapshot } from './types';
import { LEVELS, CHAPTERS, createCampaignLoadout, getLevelById } from './levels';
import { PhysicsWorld, type DismembermentEvent, type WeaponUseResult } from './PhysicsWorld';
import { CameraController } from './CameraController';
import { SelectionSystem } from './SelectionSystem';
import { ParticleSystem } from './ParticleSystem';
import { audioSystem } from './AudioSystem';
import { saveSystem } from './SaveSystem';
import { platformService } from './PlatformService';
import { buildWorldTheme, WORLD_THEME_ENTITY_GROUP_PREFIX } from './WorldTheme';

interface SpawnCatalogItem {
  id: string;
  name: string;
  icon: string;
  category: string;
  description: string;
  iconPath?: string;
  lockedAfter?: number;
  character?: string;
}

interface HistoryEntry {
  world: WorldSnapshot;
  campaign?: {
    loadout: Record<string, number>;
    activeItem?: string;
    projectileAimArmed: boolean;
  };
}

const TOOL_INFO: Record<ToolId, { icon: string; name: string; tip: string }> = {
  grab: { icon: '✋', name: 'Grab', tip: 'Drag objects with a physical spring' },
  delete: { icon: '✕', name: 'Delete', tip: 'Remove an object' },
  freeze: { icon: '❄', name: 'Freeze', tip: 'Pin an object in place' },
  unfreeze: { icon: '◌', name: 'Unfreeze', tip: 'Return an object to physics' },
  rotate: { icon: '↻', name: 'Rotate', tip: 'Rotate the selected object' },
  push: { icon: '➜', name: 'Push', tip: 'Give an object a firm shove' },
  explosion: { icon: '✹', name: 'Blast', tip: 'Detonate a powerful radial blast at the cursor' },
  connect: { icon: '▰', name: 'Weld', tip: 'Select two objects to weld them' },
  rope: { icon: '⌁', name: 'Rope', tip: 'Select two objects to tie them' },
  spring: { icon: '≋', name: 'Spring', tip: 'Select two objects with an elastic link' },
  hinge: { icon: '⊙', name: 'Hinge', tip: 'Select two objects to make a pivot' },
  motor: { icon: '⚙', name: 'Motor', tip: 'Select two objects for a powered hinge' },
  duplicate: { icon: '⧉', name: 'Duplicate', tip: 'Copy selected objects' },
};

const ITEM_INFO: Record<string, { name: string; icon: string; projectile?: boolean }> = {
  'heavy-ball': { name: 'Heavy Ball', icon: '●', projectile: true },
  'metal-ball': { name: 'Metal Ball', icon: '◉', projectile: true },
  'small-ball': { name: 'Bouncy Ball', icon: '•', projectile: true },
  ball: { name: 'Bouncy Ball', icon: '•', projectile: true },
  'explosive-projectile': { name: 'Boom Shell', icon: '✦', projectile: true },
  rocket: { name: 'Rocket', icon: '▲', projectile: true },
  bomb: { name: 'Toy Bomb', icon: '✹' },
  'explosive-barrel': { name: 'Boom Barrel', icon: '▥' },
  'concrete-block': { name: 'Concrete Block', icon: '◆' },
  'metal-beam': { name: 'Metal Beam', icon: '┃' },
  spring: { name: 'Power Spring', icon: '≋' },
  rope: { name: 'Rope', icon: '⌁' },
  platform: { name: 'Platform', icon: '▬' },
  wheel: { name: 'Wheel', icon: '◉' },
  motor: { name: 'Motor', icon: '⚙' },
  crate: { name: 'Crate', icon: '▣' },
  magnet: { name: 'Magnet', icon: '∩' },
  pistol: { name: 'Block Pistol', icon: '⌐' },
  shotgun: { name: 'Scattergun', icon: '═' },
  rifle: { name: 'Workshop Rifle', icon: '╾' },
  knife: { name: 'Utility Knife', icon: '▰' },
  machete: { name: 'Block Machete', icon: '▬' },
  axe: { name: 'Fire Axe', icon: '┫' },
  spear: { name: 'Yard Spear', icon: '➤' },
  'ammo-box': { name: 'Ammo Box', icon: '▤' },
};

const TOOL_HOTKEYS: Partial<Record<ToolId, string>> = {
  grab: '1',
  delete: '2',
  freeze: '3',
  rotate: '4',
  push: '5',
  explosion: '6',
};

const TOOL_KEY_BINDINGS: Partial<Record<string, ToolId>> = {
  Digit1: 'grab',
  Digit2: 'delete',
  Digit3: 'freeze',
  Digit4: 'rotate',
  Digit5: 'push',
  Digit6: 'explosion',
};

const CATALOG: SpawnCatalogItem[] = [
  { id: 'human', name: 'Human', icon: '☺', category: 'Characters', description: 'A cheerful floppy citizen.', character: 'human' },
  { id: 'worker', name: 'Worker', icon: '♟', category: 'Characters', description: 'Hard hat, soft landing.', character: 'worker' },
  { id: 'knight', name: 'Knight', icon: '♜', category: 'Characters', description: 'Clanky toy armor.', character: 'knight' },
  { id: 'dummy', name: 'Dummy', icon: '♙', category: 'Characters', description: 'Classic impact volunteer.', character: 'dummy' },
  { id: 'monster', name: 'Zombie Troll', icon: '☹', category: 'Characters', description: 'Green, furious, snaggle-toothed, and surprisingly bouncy.', character: 'monster' },
  { id: 'heavy', name: 'Heavy', icon: '♚', category: 'Characters', description: 'More toy per toy.', character: 'heavy', lockedAfter: 4 },
  { id: 'armored', name: 'Armored Dummy', icon: '♛', category: 'Characters', description: 'A stubborn tin target.', character: 'armored', lockedAfter: 8 },
  { id: 'friendly', name: 'Friendly NPC', icon: '♥', category: 'Characters', description: 'Protect this little pal.', character: 'friendly' },
  { id: 'wall-block', name: 'Wood Wall', icon: '▦', category: 'Structures', description: 'Breakable timber panel.' },
  { id: 'concrete-block', name: 'Concrete Block', icon: '◆', category: 'Structures', description: 'Heavy and brittle.', lockedAfter: 1 },
  { id: 'platform', name: 'Platform', icon: '▬', category: 'Structures', description: 'A useful flat foundation.' },
  { id: 'roof', name: 'Roof Piece', icon: '⌂', category: 'Structures', description: 'A roof asking to fall.' },
  { id: 'beam', name: 'Wood Beam', icon: '┃', category: 'Structures', description: 'Structural, until it is not.' },
  { id: 'metal-beam', name: 'Metal Beam', icon: '║', category: 'Structures', description: 'Strong machine framing.' },
  { id: 'glass', name: 'Glass Panel', icon: '◇', category: 'Structures', description: 'See-through and smashable.' },
  { id: 'crate', name: 'Crate', icon: '▣', category: 'Props', description: 'The universal physics prop.' },
  { id: 'barrel', name: 'Barrel', icon: '▥', category: 'Props', description: 'Blue, round-ish, rollable.' },
  { id: 'plank', name: 'Plank', icon: '━', category: 'Props', description: 'Build, bridge, or bonk.' },
  { id: 'ball', name: 'Bouncy Ball', icon: '●', category: 'Props', description: 'Rubber with ambition.' },
  { id: 'heavy-ball', name: 'Heavy Ball', icon: '◉', category: 'Props', description: 'A portable bad decision.', lockedAfter: 1 },
  { id: 'weight', name: 'Heavy Weight', icon: '⬟', category: 'Props', description: 'Best enjoyed from below.', lockedAfter: 6 },
  { id: 'chair', name: 'Chair', icon: '▱', category: 'Props', description: 'Technically furniture.' },
  { id: 'table', name: 'Table', icon: '╦', category: 'Props', description: 'Four legs, many outcomes.' },
  { id: 'knife', name: 'Utility Knife', icon: '▰', iconPath: '/textures/pixel/weapons/knife-pixel-v2.png', category: 'Props', description: 'Compact physical blade. Select it, press F, then click to strike.', lockedAfter: 4 },
  { id: 'machete', name: 'Block Machete', icon: '▬', iconPath: '/textures/pixel/weapons/machete-pixel-v2.png', category: 'Props', description: 'A heavy pixel blade with reach and real contact damage.', lockedAfter: 7 },
  { id: 'axe', name: 'Fire Axe', icon: '┫', iconPath: '/textures/pixel/weapons/axe-pixel-v2.png', category: 'Props', description: 'Heavy directional chop with a physical box-built head and handle.', lockedAfter: 10 },
  { id: 'spear', name: 'Yard Spear', icon: '➤', iconPath: '/textures/pixel/weapons/spear-pixel-v2.png', category: 'Props', description: 'Long reach, directional thrust, stable box collider.', lockedAfter: 11 },
  { id: 'ammo-box', name: 'Ammo Box', icon: '▤', iconPath: '/textures/pixel/weapons/ammo-box-pixel-v2.png', category: 'Props', description: 'A stable physical supply crate for the firing line.', lockedAfter: 12 },
  { id: 'wheel', name: 'Wheel', icon: '◎', category: 'Machines', description: 'For cars and stranger things.' },
  { id: 'motor', name: 'Motor', icon: '⚙', category: 'Machines', description: 'Powered rotational trouble.', lockedAfter: 7 },
  { id: 'piston', name: 'Piston', icon: '↥', category: 'Machines', description: 'Pushes things on a beat.', lockedAfter: 10 },
  { id: 'spring', name: 'Power Spring', icon: '≋', category: 'Machines', description: 'Stores and returns chaos.', lockedAfter: 5 },
  { id: 'fan', name: 'Fan', icon: '✣', category: 'Machines', description: 'A steady sideways shove.', lockedAfter: 5 },
  { id: 'magnet', name: 'Magnet', icon: '∩', category: 'Machines', description: 'Pulls nearby metal toys.', lockedAfter: 8 },
  { id: 'conveyor', name: 'Conveyor', icon: '▰', category: 'Machines', description: 'Moves props to their destiny.', lockedAfter: 10 },
  { id: 'cannon', name: 'Cannon', icon: '◄', category: 'Machines', description: 'A handsome launcher.', lockedAfter: 9 },
  { id: 'explosive-barrel', name: 'Boom Barrel', icon: '⚠', category: 'Destruction', description: 'Red means entertaining.', lockedAfter: 3 },
  { id: 'bomb', name: 'Toy Bomb', icon: '✹', category: 'Destruction', description: 'A larger comic blast.', lockedAfter: 3 },
  { id: 'explosive-projectile', name: 'Boom Shell', icon: '✦', category: 'Destruction', description: 'A compact launchable explosive shell.', lockedAfter: 6 },
  { id: 'rocket', name: 'Rocket', icon: '▲', category: 'Destruction', description: 'Fast, loud, direction-ish.', lockedAfter: 9 },
  { id: 'giant-hammer', name: 'Giant Hammer', icon: 'Τ', category: 'Destruction', description: 'Subtlety sold separately.', lockedAfter: 2 },
  { id: 'pistol', name: 'Block Pistol', icon: '⌐', iconPath: '/textures/pixel/weapons/pistol-pixel-v2.png', category: 'Destruction', description: '12-round physical sidearm. Select, press F, click a world point.', lockedAfter: 2 },
  { id: 'shotgun', name: 'Scattergun', icon: '═', iconPath: '/textures/pixel/weapons/shotgun-pixel-v2.png', category: 'Destruction', description: 'Eight-pellet spread with restrained physical recoil.', lockedAfter: 5 },
  { id: 'rifle', name: 'Workshop Rifle', icon: '╾', iconPath: '/textures/pixel/weapons/rifle-pixel-v2.png', category: 'Destruction', description: 'Fast, accurate semi-auto physics rifle.', lockedAfter: 8 },
];

const clamp = THREE.MathUtils.clamp;

export class Game {
  readonly root: HTMLElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(52, 1, 0.1, 180);
  readonly physics: PhysicsWorld;
  readonly cameraController: CameraController;
  readonly selection: SelectionSystem;
  readonly particles: ParticleSystem;
  private environment = new THREE.Group();
  private sun?: THREE.DirectionalLight;
  private mode: GameMode = 'menu';
  private phase: Phase = 'paused';
  private level?: LevelDefinition;
  private loadout: Record<string, number> = {};
  private initialLoadout = 0;
  private activeItem?: string;
  private projectileAimArmed = false;
  private armedWeaponId?: number;
  private power = 72;
  private startTime = 0;
  private elapsed = 0;
  private initialDestructibles = 1;
  private resultPending = 0;
  private failurePending = 0;
  private clock = new THREE.Clock();
  private uiTimer = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 60;
  private debugVisible = false;
  private history: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private recentToast?: number;
  private spawnCategory = 'Characters';
  private spawnSearch = '';
  private spawnCollection: 'category' | 'favorites' | 'recent' = 'category';
  private selectedSpawnId = 'human';
  private selectedBlueprintId?: string;
  private slowTimer = 0;
  private renderStart = 0;
  private pageVisible = !document.hidden;
  private renderDirty = true;
  private resizePending = false;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private viewportRatio = 0;
  private appliedQuality?: Quality;
  private statTargets?: HTMLElement;
  private statTime?: HTMLElement;
  private statBodies?: HTMLElement;
  private debugPanel?: HTMLElement;
  private aimReticle?: HTMLElement;
  private aimReticleLabel?: HTMLElement;
  private useItemButton?: HTMLButtonElement;
  private rootLeft = 0;
  private rootTop = 0;
  private lastAimClientX = Number.NaN;
  private lastAimClientY = Number.NaN;
  private lastAimOverTarget?: boolean;
  private readonly loadoutCountElements = new Map<string, HTMLElement>();
  private readonly loadoutButtons = new Map<string, HTMLButtonElement>();
  private readonly localQA = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') && new URLSearchParams(location.search).has('qa');

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.innerHTML = '<div class="loading-screen"><div class="brand-mark">RW</div><div class="brand-kicker">OPENING THE TOY CRATE</div><div class="loading-bar"><div class="loading-fill"></div></div></div>';
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.domElement.id = 'game-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'Rattleworks 3D physics playground');
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.root.prepend(this.renderer.domElement);
    audioSystem.attachUnlock();
    const save = saveSystem.load();
    audioSystem.setVolume(save.settings.volume);
    this.physics = new PhysicsWorld(this.scene, audioSystem, {
      onImpact: (entity, force, point) => this.onImpact(entity, force, point),
      onCharacterHit: (character, damage, point) => this.onCharacterHit(character, damage, point),
      onCharacterDefeated: (character) => this.onCharacterDefeated(character),
      onDismemberment: (event) => this.onDismemberment(event),
      onBreak: (entity) => this.particles.dust(entity.object.position, entity.material, entity.material === 'glass' ? 16 : 10),
      onExplosion: (point) => this.onExplosion(point),
    });
    this.particles = new ParticleSystem(this.scene);
    this.cameraController = new CameraController(this.camera, this.renderer.domElement);
    this.selection = new SelectionSystem(this.camera, this.renderer.domElement, this.physics, {
      onSelection: (entities) => {
        this.updateInspector(entities);
        this.syncInteractionStatus();
      },
      onToolAction: (tool, point, entity) => this.handleTool(tool, point, entity),
      isAimMode: () => this.isWorldAimMode(),
      onAimMove: (clientX, clientY, point, entity) => this.updateAimReticle(clientX, clientY, point, entity),
      onAimFire: (point) => this.resolveAimFire(point),
      onContextUse: (point, entity) => this.handleContextUse(point, entity),
    });
    this.setupScene();
    this.applyQuality(save.settings.quality);
    this.bindGlobal();
    this.resize();
    void this.initialize();
    this.animate();
  }

  private async initialize(): Promise<void> {
    await platformService.initialize();
    const cloudSave = await platformService.loadData<SaveData>();
    if (cloudSave?.saveVersion === 1) {
      saveSystem.save(cloudSave);
      audioSystem.setVolume(cloudSave.settings.volume);
      this.applyQuality(cloudSave.settings.quality);
    }
    platformService.bindLifecycle();
    window.setTimeout(() => {
      const requestedLevel = Number(new URLSearchParams(location.search).get('level'));
      const stress = new URLSearchParams(location.search).get('stress');
      if (this.localQA && stress) this.runLocalStress(stress);
      else if (this.localQA && Number.isInteger(requestedLevel) && getLevelById(requestedLevel)) this.startLevel(requestedLevel);
      else this.showMainMenu();
      void platformService.loadingComplete();
    }, 500);
  }

  private setupScene(): void {
    this.scene.background = new THREE.Color(0x8cc4c9);
    this.scene.fog = new THREE.Fog(0x8cc4c9, 34, 82);
    const hemi = new THREE.HemisphereLight(0xc8eef0, 0x536141, 1.45);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffefd0, 2.2);
    sun.position.set(-12, 22, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -28;
    sun.shadow.camera.right = 28;
    sun.shadow.camera.top = 28;
    sun.shadow.camera.bottom = -22;
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 70;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
    this.sun = sun;
    this.scene.add(this.environment);
  }

  private bindGlobal(): void {
    window.addEventListener('resize', () => this.queueResize(), { passive: true });
    document.addEventListener('visibilitychange', () => {
      this.pageVisible = !document.hidden;
      this.clock.getDelta();
      if (!this.pageVisible) {
        this.selection.suspend();
        return;
      }
      this.renderDirty = true;
      this.queueResize();
    });
    window.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement;
      if (target.matches('input, textarea, select')) {
        if (event.code === 'Escape') {
          event.preventDefault();
          target.blur();
          this.handleEscape();
        }
        return;
      }
      if (target.closest('button, [role="button"]') && (event.code === 'Space' || event.code === 'Enter')) return;
      if (event.code === 'F3') {
        event.preventDefault();
        this.debugVisible = !this.debugVisible;
        this.debugPanel?.classList.toggle('hidden', !this.debugVisible);
      }
      if (event.code === 'KeyR' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); this.resetCurrent(); }
      if (event.code === 'KeyR' && !event.ctrlKey && !event.metaKey && (this.mode === 'sandbox' || this.mode === 'campaign')) {
        event.preventDefault();
        this.reloadSelectedWeapon();
      }
      if (event.code === 'Space' && this.mode !== 'menu' && this.mode !== 'campaign-select') { event.preventDefault(); this.togglePause(); }
      if (event.code === 'KeyF') {
        if (event.repeat) return;
        if (this.mode === 'sandbox' || (this.mode === 'campaign' && this.selectedWeapon())) this.armSelectedWeapon();
        else if (this.activeItem) this.useActiveItem();
      }
      if (event.code === 'Delete' && this.mode === 'sandbox') this.deleteSelected();
      const hotkeyTool = TOOL_KEY_BINDINGS[event.code];
      if (hotkeyTool && !event.repeat && (this.mode === 'campaign' || this.mode === 'sandbox')) {
        event.preventDefault();
        this.activateTool(hotkeyTool);
      }
      if (event.code === 'KeyB' && !event.repeat && this.mode === 'sandbox') {
        event.preventDefault();
        this.toggleShop();
      }
      if (event.code === 'Enter' && !event.repeat && this.mode === 'sandbox') {
        event.preventDefault();
        this.spawnSelectedShopEntry();
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') { event.preventDefault(); event.shiftKey ? this.redo() : this.undo(); }
      if (event.code === 'Escape') this.handleEscape();
    });
  }

  private queueResize(): void {
    if (this.resizePending) return;
    this.resizePending = true;
    requestAnimationFrame(() => {
      this.resizePending = false;
      this.resize();
    });
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const quality = saveSystem.data.settings.quality;
    const ratio = quality === 'low' ? 0.8 : quality === 'medium' ? Math.min(devicePixelRatio, 1.35) : Math.min(devicePixelRatio, 1.8);
    const sizeChanged = width !== this.viewportWidth || height !== this.viewportHeight;
    const ratioChanged = Math.abs(ratio - this.viewportRatio) > 0.001;
    if (ratioChanged) {
      this.viewportRatio = ratio;
      this.renderer.setPixelRatio(ratio);
    }
    if (sizeChanged) {
      this.viewportWidth = width;
      this.viewportHeight = height;
      this.camera.aspect = width / Math.max(1, height);
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height, false);
    }
    if (sizeChanged || ratioChanged) this.renderDirty = true;
    const rootRect = this.root.getBoundingClientRect();
    this.rootLeft = rootRect.left;
    this.rootTop = rootRect.top;
    this.selection.refreshBounds();
  }

  private applyQuality(quality: Quality): void {
    if (this.appliedQuality === quality) return;
    this.appliedQuality = quality;
    this.physics.setQuality(quality);
    this.particles.setQuality(quality);
    this.renderer.shadowMap.enabled = quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const shadowSize = quality === 'high' ? 2048 : quality === 'medium' ? 1024 : 512;
    if (this.sun && this.sun.shadow.mapSize.x !== shadowSize) {
      this.sun.shadow.mapSize.set(shadowSize, shadowSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.renderer.shadowMap.needsUpdate = true;
    this.renderDirty = true;
    this.resize();
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.05);
    if (!this.pageVisible) return;
    const worldActive = !this.physics.paused && (this.mode === 'campaign' || this.mode === 'sandbox');
    if (!worldActive) {
      if (this.renderDirty) {
        this.renderer.render(this.scene, this.camera);
        this.renderDirty = false;
      }
      return;
    }
    const measureFrame = this.debugVisible;
    if (measureFrame) this.renderStart = performance.now();
    if (this.slowTimer > 0) {
      this.slowTimer -= delta;
      this.physics.simulationScale = this.slowTimer > 0 ? 0.32 : 1;
    }
    this.cameraController.update(delta);
    this.selection.update(delta);
    this.physics.update(delta);
    this.selection.updateVisuals(delta);
    this.particles.update(delta);
    if (this.mode === 'campaign' && this.phase === 'play') this.updateCampaign(delta);
    this.renderer.render(this.scene, this.camera);
    this.renderDirty = false;
    this.updateMetrics(delta, measureFrame ? performance.now() - this.renderStart : 0);
  };

  private updateMetrics(delta: number, renderMs: number): void {
    if (this.debugVisible) {
      this.fpsFrames++;
      this.fpsTime += delta;
    } else {
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    this.uiTimer += delta;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    if (this.uiTimer < 0.12) return;
    this.uiTimer = 0;
    if (this.mode === 'campaign') {
      this.setText(this.statTargets, String(this.physics.targetsRemaining));
      this.setText(this.statTime, this.formatTime(this.elapsed));
    }
    if (!this.statBodies && !this.debugVisible) return;
    const stats = this.physics.bodyStats;
    this.setText(this.statBodies, String(stats.total));
    if (this.debugVisible && this.debugPanel) {
      const html = `<b>RATTLEWORKS LAB</b><span>FPS ${this.fps}</span><span>DRAW ${this.renderer.info.render.calls}</span><span>BODIES ${stats.total}</span><span>ACTIVE ${stats.active}</span><span>SLEEP ${stats.sleeping}</span><span>TRIS ${this.renderer.info.render.triangles.toLocaleString()}</span><span>FRAME ${renderMs.toFixed(1)}ms</span>`;
      if (this.debugPanel.innerHTML !== html) this.debugPanel.innerHTML = html;
    }
  }

  private updateCampaign(delta: number): void {
    this.elapsed = (performance.now() - this.startTime) / 1000;
    if (this.failurePending > 0) {
      this.failurePending -= delta;
      if (this.failurePending <= 0) this.failLevel('FRIEND DOWN', 'That little green pal needed to make it through.');
      return;
    }
    if (this.resultPending > 0) {
      this.resultPending -= delta;
      if (this.resultPending <= 0) this.finishLevel();
      return;
    }
    const hasFriendly = this.level?.objects.some((o) => o.friendly);
    if (hasFriendly && this.physics.friendliesAlive === 0) {
      this.failurePending = 0.6;
      return;
    }
    if (this.physics.targetsRemaining === 0 && this.physics.characters.size > 0) {
      this.resultPending = 1.65;
      this.slowTimer = 0.78;
    }
  }

  private showMainMenu(): void {
    this.projectileAimArmed = false;
    this.armedWeaponId = undefined;
    this.mode = 'menu';
    this.phase = 'paused';
    this.physics.paused = true;
    this.selection.enabled = false;
    this.cameraController.enabled = false;
    void platformService.gameplayStop();
    const save = saveSystem.data;
    const stars = Object.values(save.completed).reduce((sum, result) => sum + result.stars, 0);
    this.renderUI(`
      <section class="screen menu-screen" aria-label="Main menu">
        <div class="brand">
          <div class="brand-kicker">A TOY-BOX DESTRUCTION GAME</div>
          <h1>RATTLE<span>WORKS</span></h1>
          <p class="brand-subtitle">Build it. Bonk it. Watch it fall apart beautifully.</p>
          <div class="progress-strip"><span>${stars} / 36 STARS</span><i style="--progress:${stars / 36}"></i></div>
        </div>
        <div class="menu-card">
          <div class="menu-actions">
            <button class="primary-button" data-action="campaign"><span>▶</span><b>CAMPAIGN</b><small>12 handcrafted disasters</small></button>
            <button class="secondary-button" data-action="sandbox"><span>✣</span><b>SANDBOX</b><small>Unlimited toy-box chaos</small></button>
            <button class="secondary-button compact-button" data-action="settings"><span>⚙</span><b>SETTINGS</b></button>
          </div>
          <div class="menu-footer"><span>Drag with left mouse</span><span>Orbit with right mouse</span><span>WASD to move</span></div>
        </div>
        <div class="version-chip">v1.0 · ${platformService.name}</div>
      </section>
    `);
    this.root.querySelector('[data-action="campaign"]')?.addEventListener('click', () => this.showLevelSelect());
    this.root.querySelector('[data-action="sandbox"]')?.addEventListener('click', () => this.startSandbox());
    this.root.querySelector('[data-action="settings"]')?.addEventListener('click', () => this.showSettings());
  }

  private showLevelSelect(): void {
    this.projectileAimArmed = false;
    this.armedWeaponId = undefined;
    this.mode = 'campaign-select';
    this.physics.paused = true;
    this.selection.enabled = false;
    this.cameraController.enabled = false;
    const save = saveSystem.data;
    const cards = CHAPTERS.map((chapter) => `
      <section class="chapter-section">
        <div class="chapter-header"><span>CHAPTER ${chapter.id}</span><h2>${chapter.name}</h2><small>${chapter.levels.reduce((sum, l) => sum + (save.completed[l.id]?.stars ?? 0), 0)} / 12 ★</small></div>
        <div class="level-grid">
          ${chapter.levels.map((level) => {
            const locked = level.id > save.unlockedLevel;
            const result = save.completed[level.id];
            const earnedStars = result?.stars ?? 0;
            const status = locked ? 'Locked' : result ? `Best ${this.formatTime(result.time)}` : 'New';
            const id = `level-${level.id}`;
            return `<button type="button" class="level-card ${locked ? 'locked' : ''}" data-level="${level.id}"
              aria-labelledby="${id}-number ${id}-name"
              aria-describedby="${id}-thumbnail ${id}-subtitle ${id}-stars ${id}-status"
              ${locked ? 'disabled aria-disabled="true"' : ''}>
              <span class="level-thumbnail" id="${id}-thumbnail" role="img" aria-label="${level.thumbnail.alt}" data-thumbnail-state="pending" data-environment="${level.environment}">
                <span class="level-thumbnail-placeholder" aria-hidden="true"><b>${chapter.id}.${level.id - (chapter.id - 1) * 4}</b><small>PREVIEW PENDING</small></span>
                <img class="level-thumbnail-image" src="${level.thumbnail.src}" alt="" width="512" height="288" loading="lazy" decoding="async" fetchpriority="low" draggable="false">
                ${locked ? '<span class="lock-mark" aria-hidden="true">LOCKED</span>' : ''}
              </span>
              <span class="level-number" id="${id}-number" aria-label="Level ${level.id}">${String(level.id).padStart(2, '0')}</span>
              <span class="level-card-copy">
                <strong class="level-name" id="${id}-name">${level.name}</strong>
                <span class="level-subtitle" id="${id}-subtitle">${level.subtitle} · REWARD: ${level.reward.label}</span>
              </span>
              <span class="level-card-footer">
                <span class="level-stars" id="${id}-stars" aria-label="${earnedStars} of 3 stars">${[1, 2, 3].map((star) => `<i class="${earnedStars >= star ? 'earned' : ''}" aria-hidden="true">★</i>`).join('')}</span>
                <span class="best-time" id="${id}-status">${status}</span>
              </span>
            </button>`;
          }).join('')}
        </div>
      </section>`).join('');
    this.renderUI(`
      <section class="screen level-select-screen">
        <header class="screen-title"><button class="back-button" data-action="back">←</button><div><span>THE RATTLEWORKS TOUR</span><h1>CAMPAIGN</h1></div><button class="secondary-button compact-button" data-action="sandbox">SANDBOX</button></header>
        <main class="campaign-map">${cards}</main>
      </section>
    `);
    this.bindLevelThumbnailFallbacks();
    this.root.querySelector('[data-action="back"]')?.addEventListener('click', () => this.showMainMenu());
    this.root.querySelector('[data-action="sandbox"]')?.addEventListener('click', () => this.startSandbox());
    this.root.querySelectorAll<HTMLElement>('[data-level]').forEach((button) => button.addEventListener('click', () => this.startLevel(Number(button.dataset.level))));
  }

  private bindLevelThumbnailFallbacks(): void {
    this.root.querySelectorAll<HTMLImageElement>('.level-thumbnail-image').forEach((image) => {
      const thumbnail = image.closest<HTMLElement>('.level-thumbnail');
      if (!thumbnail) return;
      let settled = false;
      const settle = (loaded: boolean): void => {
        if (settled) return;
        settled = true;
        thumbnail.dataset.thumbnailState = loaded ? 'loaded' : 'failed';
        if (!loaded) image.hidden = true;
      };
      image.addEventListener('load', () => settle(image.naturalWidth > 0), { once: true });
      image.addEventListener('error', () => settle(false), { once: true });
      if (image.complete) settle(image.naturalWidth > 0);
    });
  }

  private startLevel(id: number): void {
    const level = getLevelById(id);
    if (!level || (id > saveSystem.data.unlockedLevel && !this.localQA)) return;
    audioSystem.play('ui');
    this.mode = 'campaign';
    this.level = level;
    this.phase = level.phase === 'build' ? 'build' : 'play';
    this.loadout = createCampaignLoadout(level, saveSystem.data.completed);
    this.initialLoadout = Object.values(this.loadout).reduce((sum, count) => sum + count, 0);
    this.activeItem = Object.keys(this.loadout).find((itemId) => this.isProjectileItem(itemId) && this.loadout[itemId] > 0)
      ?? Object.keys(this.loadout).find((itemId) => this.loadout[itemId] > 0);
    this.projectileAimArmed = false;
    this.armedWeaponId = undefined;
    this.elapsed = 0;
    this.resultPending = 0;
    this.failurePending = 0;
    this.history = [];
    this.future = [];
    this.slowTimer = 0;
    this.loadWorldDefinition(level);
    this.startTime = performance.now();
    this.physics.simulationScale = level.phase === 'build' ? 0.18 : 1;
    this.physics.paused = false;
    this.selection.enabled = true;
    this.cameraController.enabled = true;
    this.selection.setTool('grab');
    this.cameraController.setView(level.camera.position, level.camera.target, true);
    this.initialDestructibles = [...this.physics.entities.values()].filter((e) => (
      e.destructible
      && !e.characterId
      && !e.group?.startsWith(WORLD_THEME_ENTITY_GROUP_PREFIX)
    )).length || 1;
    this.renderCampaignHUD();
    this.setProjectileAimArmed(this.isProjectileItem(this.activeItem), false);
    void platformService.gameplayStart();
    this.toast(level.id === 1 ? 'POINT AT THE SHACK AND CLICK TO LAUNCH' : level.hint, 4300);
  }

  private loadWorldDefinition(level: LevelDefinition): void {
    this.cameraController.cancelFollow();
    this.selection.clear();
    this.particles.clear();
    this.physics.clear();
    this.createEnvironment(level.environment);
    const groups = new Map<string, Entity[]>();
    for (const def of level.objects) {
      const spawned = this.physics.spawn(def, false);
      if (spawned && 'body' in spawned && def.group) {
        const list = groups.get(def.group) ?? [];
        list.push(spawned);
        groups.set(def.group, list);
      }
    }
    this.autoConnectGroups(groups);
  }

  private autoConnectGroups(groups: Map<string, Entity[]>): void {
    for (const [group, entities] of groups) {
      if (entities.length < 2) continue;
      if (group.includes('rope') || group.includes('weight')) {
        const anchor = entities.find((e) => e.type === 'rope-anchor') ?? entities[0];
        const weight = entities.find((e) => e.type === 'weight') ?? entities[entities.length - 1];
        if (anchor.id !== weight.id) this.physics.createConnector('rope', anchor, weight, anchor.object.position.distanceTo(weight.object.position));
      }
    }
  }

  private renderCampaignHUD(): void {
    const level = this.level!;
    const itemButtons = Object.entries(this.loadout).map(([id, count]) => {
      const info = ITEM_INFO[id] ?? { name: this.pretty(id), icon: '◆' };
      const active = this.activeItem === id;
      return `<button class="ammo-card ${active ? 'active' : ''} ${count <= 0 ? 'spent' : ''}" data-item="${id}" aria-pressed="${active}" ${count <= 0 ? 'disabled' : ''}><span class="item-icon">${info.icon}</span><b>${info.name}</b><small>LEFT <span class="item-count" data-count="${id}">${count}</span></small></button>`;
    }).join('');
    const toolButtons = level.tools.map((id) => {
      const info = TOOL_INFO[id];
      const active = !this.projectileAimArmed && id === 'grab';
      const hotkey = TOOL_HOTKEYS[id];
      return `<button class="tool-button ${active ? 'active' : ''}" data-tool="${id}" aria-label="${info.name}" aria-pressed="${active}" ${hotkey ? `aria-keyshortcuts="${hotkey}"` : ''} title="${info.tip}${hotkey ? ` [${hotkey}]` : ''}"><span class="tool-icon">${info.icon}</span><small>${info.name}</small>${hotkey ? `<kbd>${hotkey}</kbd>` : ''}</button>`;
    }).join('');
    this.renderUI(`
      <div class="hud campaign-hud ${this.projectileAimArmed ? 'aiming' : ''}">
        <header class="topbar">
          <div class="topbar-left">
            <button class="icon-button" data-action="exit" aria-label="Level select">←</button>
            <div class="level-meta"><span>LEVEL ${level.id} · CHAPTER ${level.chapter}</span><b>${level.name}</b></div>
          </div>
          <div class="topbar-status">
            <div class="stat-pill targets"><span class="target-icon">♟</span><b data-stat="targets">${this.physics.targetsRemaining}</b><small>TARGETS</small></div>
            <div class="stat-pill"><b data-stat="time">0:00</b><small>TIME</small></div>
          </div>
          <div class="topbar-right">
            <button class="icon-button" data-action="camera" aria-label="Reset camera">⌂</button>
            <button class="icon-button" data-action="reset" aria-label="Reset level">↺</button>
            <button class="icon-button" data-action="pause" aria-label="Pause">Ⅱ</button>
          </div>
        </header>
        <aside class="objective-card mission-chip"><span>MISSION</span><b>KNOCK OUT EVERY TARGET</b><small>${level.description}</small></aside>
        <div class="interaction-status" data-interaction-status role="status" aria-live="polite"><span data-interaction-mode>GRAB</span><b data-interaction-copy>Click or drag any object</b></div>
        <div class="game-dock">
          <div class="toolbelt" aria-label="Physics tools">${toolButtons}</div>
          <aside class="loadout">
            <div class="panel-header"><span>LAUNCH KIT</span><small>${level.phase === 'build' ? 'BUILD, CONNECT, THEN START' : 'PICK AMMO · CLICK THE WORLD'}</small></div>
            <div class="loadout-items">${itemButtons}</div>
            <label class="power-meter"><span>POWER</span><input type="range" min="35" max="100" value="${this.power}" data-action="power" aria-label="Launch power"/><b>${this.power}%</b></label>
            <button class="primary-button fire-button" data-action="use-item" aria-keyshortcuts="F" aria-pressed="${this.projectileAimArmed}">${this.isProjectileItem(this.activeItem) ? 'AIM' : 'PLACE'} <span>F</span></button>
          </aside>
        </div>
        ${this.phase === 'build' ? '<button class="primary-button start-button" data-action="start">START THE MACHINE ▶</button>' : ''}
        <div class="object-actions hidden" data-inspector></div>
        <div class="aim-reticle ${this.projectileAimArmed ? '' : 'hidden'}" aria-hidden="true"><i></i><span>CLICK TO LAUNCH</span></div>
        <div class="input-legend" aria-label="Controls"><span class="desktop-hint"><kbd>LMB</kbd> aim / select</span><span class="desktop-hint"><kbd>RMB</kbd> orbit / quick use</span><span class="desktop-hint"><kbd>F</kbd> arm item</span><span class="touch-hint">Tap a world point to use · two fingers move camera</span></div>
        <div class="tutorial-chip hidden"></div>
        <div class="toast hidden"></div>
        <div class="debug-panel hidden"></div>
      </div>
    `);
    this.bindHUDCommon();
    this.root.querySelectorAll<HTMLElement>('[data-item]').forEach((button) => button.addEventListener('click', () => {
      if ((this.loadout[button.dataset.item!] ?? 0) <= 0) return;
      // A kit-card click explicitly switches away from a selected physical
      // weapon, so the HUD, F key, and next world click all share one intent.
      this.disarmWeaponAim();
      this.selection.clear();
      this.activeItem = button.dataset.item;
      const aim = this.isProjectileItem(this.activeItem);
      this.setProjectileAimArmed(aim, aim);
      this.root.querySelectorAll<HTMLElement>('[data-item]').forEach((b) => {
        const active = b.dataset.item === this.activeItem;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      });
      this.updateUseButton();
      audioSystem.play('ui');
    }));
    this.root.querySelector('[data-action="use-item"]')?.addEventListener('click', () => this.useActiveItem());
    const power = this.root.querySelector<HTMLInputElement>('[data-action="power"]');
    power?.addEventListener('input', () => {
      this.power = Number(power.value);
      power.parentElement?.querySelector('b')?.replaceChildren(`${this.power}%`);
    });
    this.root.querySelector('[data-action="start"]')?.addEventListener('click', () => this.startMachine());
    this.setProjectileAimArmed(this.projectileAimArmed, false);
    this.syncInteractionStatus();
  }

  private bindHUDCommon(): void {
    this.root.querySelector('[data-action="exit"]')?.addEventListener('click', () => this.mode === 'campaign' ? this.showLevelSelect() : this.showMainMenu());
    this.root.querySelector('[data-action="reset"]')?.addEventListener('click', () => this.resetCurrent());
    this.root.querySelector('[data-action="camera"]')?.addEventListener('click', () => this.resetCamera());
    this.root.querySelector('[data-action="pause"]')?.addEventListener('click', () => this.togglePause());
    this.root.querySelectorAll<HTMLElement>('[data-tool]').forEach((button) => button.addEventListener('click', () => this.activateTool(button.dataset.tool as ToolId)));
  }

  private activateTool(tool: ToolId, announce = true): void {
    const button = this.root.querySelector<HTMLElement>(`[data-tool="${tool}"]`);
    if (!button || this.physics.paused) return;
    this.setProjectileAimArmed(false, false);
    this.disarmWeaponAim();
    if (tool === 'duplicate') {
      this.captureHistory();
      this.selection.duplicateSelected();
      audioSystem.play('ui');
      if (announce) this.toast('SELECTION DUPLICATED', 1100);
      this.syncInteractionStatus();
      return;
    }
    this.selection.setTool(tool);
    this.root.querySelectorAll<HTMLElement>('[data-tool]').forEach((candidate) => {
      const active = candidate === button;
      candidate.classList.toggle('active', active);
      candidate.setAttribute('aria-pressed', String(active));
    });
    audioSystem.play('ui');
    if (announce) this.toast(TOOL_INFO[tool].tip.toUpperCase(), 1350);
    this.syncInteractionStatus();
  }

  private useActiveItem(): void {
    const id = this.activeItem;
    if (!id || (this.loadout[id] ?? 0) <= 0 || this.phase === 'paused') return;
    if (this.isProjectileItem(id)) {
      if (this.mode === 'campaign' && this.phase === 'build') {
        this.toast('PRESS START THE MACHINE BEFORE FIRING', 1700);
        return;
      }
      this.setProjectileAimArmed(true, true);
      return;
    }
    this.captureHistory();
    const placed = this.placeItem(id);
    if (!placed) {
      this.history.pop();
      this.toast('NO ROOM TO PLACE THAT ITEM', 1400);
      return;
    }
    this.consumeLoadoutItem(id);
    if (placed.weapon) this.armSelectedWeapon();
  }

  private fireActiveProjectile(target: THREE.Vector3): void {
    const id = this.activeItem;
    if (!id || !this.isProjectileAimMode() || ![target.x, target.y, target.z].every(Number.isFinite)) return;
    this.captureHistory();
    if (!this.fireProjectile(id, target)) {
      // The world may be at its body cap. Do not charge ammo for a shot that
      // never existed, and discard the otherwise empty undo checkpoint.
      this.history.pop();
      this.toast('NO ROOM FOR ANOTHER PROJECTILE', 1500);
      return;
    }
    this.consumeLoadoutItem(id);
  }

  private resolveAimFire(target: THREE.Vector3): void {
    if (this.armedWeaponId !== undefined) {
      this.useSelectedWeaponAt(target);
      return;
    }
    this.fireActiveProjectile(target);
  }

  private handleContextUse(_point: THREE.Vector3, entity?: Entity): void {
    if (this.isProjectileAimMode()) {
      this.setProjectileAimArmed(false, false);
      this.toast('LAUNCH AIM CANCELLED', 850);
      return;
    }
    if (this.armedWeaponId !== undefined) {
      this.disarmWeaponAim();
      this.updateInspector([...this.selection.selected]);
      this.toast('WEAPON LOWERED', 850);
      return;
    }
    if ((this.mode === 'sandbox' || this.mode === 'campaign') && entity?.weapon) {
      // SelectionSystem selects the quick-clicked object before this callback.
      // A right drag still orbits, while a stationary right click raises it.
      this.armSelectedWeapon(true);
      return;
    }
    this.syncInteractionStatus();
  }

  private selectedWeapon(): Entity | undefined {
    const selected = [...this.selection.selected].find((entity) => entity.weapon);
    return selected && this.physics.entities.get(selected.id) === selected ? selected : undefined;
  }

  private armSelectedWeapon(toggle = false): void {
    if ((this.mode !== 'sandbox' && this.mode !== 'campaign') || this.physics.paused) return;
    if (this.mode === 'campaign' && this.phase === 'build') {
      this.toast('PRESS START THE MACHINE BEFORE FIRING', 1700);
      return;
    }
    const weapon = this.selectedWeapon();
    if (!weapon?.weapon) {
      this.toast('SELECT A GUN OR BLADE FIRST', 1400);
      return;
    }
    if (toggle && this.armedWeaponId === weapon.id) {
      this.disarmWeaponAim();
      this.updateInspector([...this.selection.selected]);
      this.toast('WEAPON AIM CANCELLED', 900);
      return;
    }
    this.setProjectileAimArmed(false, false);
    this.armedWeaponId = weapon.id;
    this.root.querySelector<HTMLElement>('.sandbox-hud, .campaign-hud')?.classList.add('aiming');
    this.aimReticle?.classList.remove('hidden');
    this.selection.refreshCursor();
    this.updateInspector([...this.selection.selected]);
    const action = weapon.weapon.mode === 'firearm' ? 'FIRE' : 'STRIKE';
    this.toast(`CLICK A WORLD POINT TO ${action} · ESC CANCELS`, 1900);
    this.syncInteractionStatus();
  }

  private disarmWeaponAim(): void {
    if (this.armedWeaponId === undefined) return;
    this.armedWeaponId = undefined;
    this.root.querySelector<HTMLElement>('.sandbox-hud, .campaign-hud')?.classList.remove('aiming');
    this.aimReticle?.classList.add('hidden');
    this.selection.refreshCursor();
    this.syncInteractionStatus();
  }

  private reloadSelectedWeapon(): void {
    const entity = this.selectedWeapon();
    if (!entity?.weapon || entity.weapon.mode !== 'firearm') {
      this.toast('SELECT A FIREARM TO RELOAD', 1200);
      return;
    }
    if (this.physics.reloadWeapon(entity)) {
      this.updateInspector([...this.selection.selected]);
      this.toast(`${this.pretty(entity.type).toUpperCase()} RELOADED · ${entity.weapon.ammo}/${entity.weapon.reserveAmmo}`, 1300);
    } else {
      const message = entity.weapon.ammo >= entity.weapon.magazineSize ? 'MAGAZINE ALREADY FULL' : 'NO RESERVE AMMO';
      this.toast(message, 1100);
    }
  }

  private useAmmoBox(box: Entity): void {
    if (box.type !== 'ammo-box' || this.physics.entities.get(box.id) !== box) return;
    const selectedFirearm = [...this.selection.selected].find((entity) => entity.weapon?.mode === 'firearm');
    const nearbyFirearm = [...this.physics.entities.values()]
      .filter((entity) => entity.weapon?.mode === 'firearm')
      .sort((a, b) => a.object.position.distanceToSquared(box.object.position) - b.object.position.distanceToSquared(box.object.position))[0];
    const firearm = selectedFirearm ?? nearbyFirearm;
    if (!firearm?.weapon || firearm.object.position.distanceTo(box.object.position) > 8) {
      this.toast('MOVE AN AMMO BOX WITHIN 8M OF A FIREARM', 1500);
      return;
    }
    if (
      firearm.weapon.ammo >= firearm.weapon.magazineSize
      && firearm.weapon.reserveAmmo >= firearm.weapon.magazineSize * 8
    ) {
      this.toast('FIREARM IS ALREADY FULLY STOCKED', 1300);
      return;
    }
    this.captureHistory();
    if (!this.physics.restockWeapon(firearm)) {
      this.history.pop();
      this.toast('AMMO BOX COULD NOT RESTOCK THAT FIREARM', 1300);
      return;
    }
    this.physics.removeEntity(box);
    this.selection.select(firearm);
    this.toast(`${this.pretty(firearm.type).toUpperCase()} RESTOCKED - ${firearm.weapon.ammo}/${firearm.weapon.reserveAmmo}`, 1500);
    audioSystem.play('metal', 0.6);
  }

  private useSelectedWeaponAt(target: THREE.Vector3): void {
    const entity = this.physics.entities.get(this.armedWeaponId ?? -1);
    if (!entity?.weapon || !this.isWorldAimMode()) {
      this.disarmWeaponAim();
      return;
    }
    const result = this.physics.useWeapon(entity, target);
    if (!result.used) {
      if (result.reason === 'empty') this.toast(entity.weapon.reserveAmmo > 0 ? 'EMPTY · PRESS R TO RELOAD' : 'OUT OF AMMO', 1200);
      return;
    }
    this.emitWeaponFeedback(result);
    this.updateInspector([...this.selection.selected]);
    const reticleLabel = this.aimReticleLabel;
    if (reticleLabel) {
      reticleLabel.textContent = entity.weapon.mode === 'firearm'
        ? `CLICK TO FIRE - ${entity.weapon.ammo}/${entity.weapon.reserveAmmo}`
        : 'CLICK TO STRIKE';
    }
    if (result.mode === 'firearm' && result.ammo === 0) {
      this.toast(result.reserveAmmo ? 'MAGAZINE EMPTY · PRESS R' : 'WEAPON EMPTY', 1300);
    }
  }

  private emitWeaponFeedback(result: WeaponUseResult): void {
    if (!result.muzzle || !result.end || !result.kind || !result.mode) return;
    if (result.mode === 'firearm') {
      const count = result.kind === 'shotgun' ? 12 : result.kind === 'rifle' ? 7 : 6;
      this.particles.burst(result.muzzle, 0xffd66b, count, 4.8, 0.48, 1.5);
      this.particles.burst(result.muzzle, 0xf47b42, Math.max(2, Math.floor(count / 3)), 3.2, 0.34, 2);
      this.showTracer(result.muzzle, result.end, result.kind === 'rifle' ? 0xffef9a : 0xffc863);
      audioSystem.play('cannon', result.kind === 'shotgun' ? 0.82 : result.kind === 'rifle' ? 0.48 : 0.38);
      if (saveSystem.data.settings.cameraShake) this.cameraController.addShake(result.kind === 'shotgun' ? 0.15 : 0.075);
    } else {
      audioSystem.play(result.impacts.length ? 'juice' : 'metal', result.impacts.length ? 0.7 : 0.42);
    }
    for (const impact of result.impacts) {
      if (impact.entity?.characterId !== undefined) continue;
      this.particles.dust(impact.point, impact.entity?.material ?? 'concrete', result.kind === 'shotgun' ? 3 : 6);
    }
  }

  private showTracer(start: THREE.Vector3, end: THREE.Vector3, color: number): void {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.78, depthWrite: false });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 20;
    this.scene.add(line);
    window.setTimeout(() => {
      this.scene.remove(line);
      geometry.dispose();
      material.dispose();
    }, 72);
  }

  private fireProjectile(type: string, target: THREE.Vector3): boolean {
    const cameraSide = this.camera.position.clone().sub(target).setY(0);
    if (cameraSide.lengthSq() < 0.1) cameraSide.set(-1, 0, 1);
    cameraSide.normalize();
    const origin = target.clone().addScaledVector(cameraSide, 12.5);
    origin.y = Math.max(1.7, target.y + 2.2 + (this.power - 65) * 0.025);
    const projectile = this.physics.spawn({ type, position: { x: origin.x, y: origin.y, z: origin.z } }, true);
    if (!projectile || !('body' in projectile)) return false;
    const speed = 15 + this.power * 0.22;
    const toTarget = target.clone().sub(origin);
    const horizontal = new THREE.Vector3(toTarget.x, 0, toTarget.z);
    const distance = horizontal.length();
    const gravity = Math.abs(this.physics.world.gravity.y) || 9.81;
    const speed2 = speed * speed;
    const discriminant = speed2 * speed2 - gravity * (gravity * distance * distance + 2 * toTarget.y * speed2);
    const velocity = new THREE.Vector3();
    if (distance > 0.01 && discriminant >= 0) {
      // Low ballistic solution: the projectile crosses the exact clicked world
      // point under gravity instead of merely pointing at an object's center.
      const tangent = (speed2 - Math.sqrt(discriminant)) / (gravity * distance);
      const cosine = 1 / Math.sqrt(1 + tangent * tangent);
      horizontal.multiplyScalar(1 / distance);
      velocity.copy(horizontal).multiplyScalar(speed * cosine);
      velocity.y = speed * tangent * cosine;
    } else {
      velocity.copy(toTarget).normalize().multiplyScalar(speed);
    }
    projectile.body.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
    const spin = cameraSide.clone().cross(new THREE.Vector3(0, 1, 0)).multiplyScalar(1.4);
    projectile.body.applyTorqueImpulse({ x: spin.x, y: 0.6, z: spin.z }, true);
    this.cameraController.followEntity(projectile, 2.2);
    audioSystem.play(type === 'rocket' ? 'explosion' : 'cannon');
    this.cameraController.addShake(0.18);
    return true;
  }

  private placeItem(type: string): Entity | undefined {
    const target = this.cameraController.target.clone();
    const selected = this.selection.primary;
    if (selected) target.copy(selected.object.position).add(new THREE.Vector3(0, selected.size.y * 0.7 + 1.2, 0));
    else target.y = Math.max(1, target.y + 2.2);
    const spawned = this.physics.spawn({ type, position: { x: target.x, y: target.y, z: target.z } }, true);
    if (spawned && 'body' in spawned) {
      this.selection.select(spawned);
      this.cameraController.focus(spawned);
      audioSystem.play(type === 'spring' ? 'spring' : 'ui');
      return spawned;
    }
    return undefined;
  }

  private updateUseButton(): void {
    const button = this.useItemButton;
    if (!button) return;
    const projectile = this.isProjectileItem(this.activeItem);
    const label = projectile ? (this.projectileAimArmed ? 'AIMING' : 'AIM') : 'PLACE';
    if (button.dataset.label !== label) {
      button.dataset.label = label;
      button.innerHTML = `${label} <span>F</span>`;
    }
    const pressed = String(projectile && this.projectileAimArmed);
    if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
    const disabled = !this.activeItem;
    if (button.disabled !== disabled) button.disabled = disabled;
  }

  private refreshLoadoutCounts(): void {
    for (const [id, count] of Object.entries(this.loadout)) {
      this.setText(this.loadoutCountElements.get(id), String(count));
      const button = this.loadoutButtons.get(id);
      if (button) {
        const spent = count <= 0;
        button.classList.toggle('spent', spent);
        if (button.disabled !== spent) button.disabled = spent;
      }
    }
  }

  private consumeLoadoutItem(id: string): void {
    this.loadout[id] = Math.max(0, (this.loadout[id] ?? 0) - 1);
    if (this.loadout[id] <= 0) {
      this.activeItem = Object.keys(this.loadout).find((key) => this.loadout[key] > 0);
      this.projectileAimArmed = this.isProjectileItem(this.activeItem);
    }
    this.root.querySelectorAll<HTMLElement>('[data-item]').forEach((button) => {
      const active = button.dataset.item === this.activeItem;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    this.refreshLoadoutCounts();
    this.setProjectileAimArmed(this.projectileAimArmed, false);
    this.updateUseButton();
  }

  private isProjectileItem(id?: string): boolean {
    return Boolean(id && (ITEM_INFO[id]?.projectile
      || ['heavy-ball', 'metal-ball', 'small-ball', 'ball', 'explosive-projectile', 'rocket'].includes(id)));
  }

  private isProjectileAimMode(): boolean {
    return this.mode === 'campaign'
      && this.phase === 'play'
      && !this.physics.paused
      && this.projectileAimArmed
      && this.isProjectileItem(this.activeItem)
      && (this.loadout[this.activeItem ?? ''] ?? 0) > 0;
  }

  private isWorldAimMode(): boolean {
    if (this.isProjectileAimMode()) return true;
    if ((this.mode !== 'sandbox' && this.mode !== 'campaign') || this.physics.paused || this.armedWeaponId === undefined) return false;
    if (this.mode === 'campaign' && this.phase !== 'play') return false;
    const entity = this.physics.entities.get(this.armedWeaponId);
    return Boolean(entity?.weapon && this.selection.selected.has(entity));
  }

  private setProjectileAimArmed(armed: boolean, announce: boolean): void {
    if (armed) this.disarmWeaponAim();
    this.projectileAimArmed = Boolean(armed && this.isProjectileItem(this.activeItem)
      && (this.mode !== 'campaign' || this.phase === 'play')
      && (this.loadout[this.activeItem ?? ''] ?? 0) > 0);
    const hud = this.root.querySelector<HTMLElement>('.campaign-hud');
    hud?.classList.toggle('aiming', this.projectileAimArmed);
    this.aimReticle?.classList.toggle('hidden', !this.projectileAimArmed);
    if (this.projectileAimArmed) {
      this.root.querySelectorAll<HTMLElement>('[data-tool]').forEach((button) => {
        button.classList.remove('active');
        button.setAttribute('aria-pressed', 'false');
      });
    }
    this.selection.refreshCursor();
    this.updateUseButton();
    if (announce && this.projectileAimArmed) this.toast('CLICK OR TAP ANY POINT IN THE WORLD TO LAUNCH', 2200);
    this.syncInteractionStatus();
  }

  private syncInteractionStatus(): void {
    const status = this.root.querySelector<HTMLElement>('[data-interaction-status]');
    const mode = status?.querySelector<HTMLElement>('[data-interaction-mode]');
    const copy = status?.querySelector<HTMLElement>('[data-interaction-copy]');
    if (!status || !mode || !copy) return;

    let state = 'tool';
    let label = TOOL_INFO[this.selection.tool]?.name.toUpperCase() ?? 'SELECT';
    let detail = TOOL_INFO[this.selection.tool]?.tip ?? 'Choose an object';
    if (this.isProjectileAimMode()) {
      state = 'aim';
      label = 'LAUNCH';
      detail = 'Click or tap the exact world point';
    } else if (this.armedWeaponId !== undefined) {
      const entity = this.physics.entities.get(this.armedWeaponId);
      const weapon = entity?.weapon;
      state = 'fire';
      label = weapon?.mode === 'firearm' ? 'FIRE' : 'STRIKE';
      detail = weapon?.mode === 'firearm'
        ? `Click world point · ${weapon.ammo}/${weapon.reserveAmmo} ammo · Esc lowers`
        : 'Click world point · Esc lowers';
    } else {
      const selected = this.selection.primary;
      if (selected) {
        state = 'selected';
        label = selected.weapon ? 'READY' : 'SELECTED';
        detail = selected.weapon
          ? `${this.pretty(selected.type)} · F or quick right-click to use`
          : `${selected.characterId ? selected.part ?? 'body' : this.pretty(selected.type)} · drag to move${this.selection.selected.size > 1 ? ` · ${this.selection.selected.size} total` : ''}`;
      } else if (this.selection.tool === 'grab') {
        label = 'GRAB';
        detail = 'Click to select · drag directly to move';
      }
    }
    status.dataset.state = state;
    mode.textContent = label;
    copy.textContent = detail;
  }

  private updateAimReticle(clientX: number, clientY: number, point: THREE.Vector3, entity?: Entity): void {
    if (!this.isWorldAimMode()) return;
    void point;
    const reticle = this.aimReticle;
    if (!reticle) return;
    if (clientX !== this.lastAimClientX || clientY !== this.lastAimClientY) {
      this.lastAimClientX = clientX;
      this.lastAimClientY = clientY;
      reticle.style.left = `${clientX - this.rootLeft}px`;
      reticle.style.top = `${clientY - this.rootTop}px`;
    }
    const overTarget = entity?.characterId !== undefined;
    if (overTarget !== this.lastAimOverTarget) {
      this.lastAimOverTarget = overTarget;
      reticle.classList.toggle('over-target', overTarget);
    }
    const label = this.aimReticleLabel;
    if (label) {
      const weapon = this.physics.entities.get(this.armedWeaponId ?? -1)?.weapon;
      let text: string;
      if (weapon) {
        const targetLabel = entity?.characterId !== undefined ? `${(entity.part ?? 'BODY').toUpperCase()} - ` : '';
        text = weapon.mode === 'firearm'
          ? `${targetLabel}CLICK TO FIRE - ${weapon.ammo}/${weapon.reserveAmmo}`
          : `${targetLabel}CLICK TO STRIKE`;
      } else {
        text = entity?.characterId !== undefined ? 'TARGET - CLICK TO LAUNCH' : 'CLICK TO LAUNCH HERE';
      }
      this.setText(label, text);
    }
  }

  private startMachine(): void {
    if (this.phase !== 'build') return;
    this.phase = 'play';
    this.startTime = performance.now();
    this.physics.simulationScale = 1;
    document.querySelector('[data-action="start"]')?.remove();
    this.setProjectileAimArmed(this.isProjectileItem(this.activeItem), false);
    this.toast('PHYSICS LIVE — LET IT RATTLE!', 2100);
    audioSystem.play('spring');
  }

  private finishLevel(): void {
    if (this.phase === 'complete' || !this.level) return;
    this.phase = 'complete';
    const itemsUsed = this.initialLoadout - Object.values(this.loadout).reduce((sum, count) => sum + count, 0);
    const destruction = clamp(Math.round((this.physics.destructionValue / (this.initialDestructibles * 6)) * 100), 0, 100);
    const condition = (rule: LevelDefinition['star2'] | LevelDefinition['star3']) => {
      if (rule.kind === 'time') return this.elapsed <= rule.value;
      if (rule.kind === 'items') return itemsUsed <= rule.value;
      if (rule.kind === 'friendly') return this.physics.friendliesAlive >= rule.value;
      return destruction >= rule.value;
    };
    const stars = 1 + Number(condition(this.level.star2)) + Number(condition(this.level.star3));
    const score = Math.round(10000 + stars * 5000 + Math.max(0, 6000 - this.elapsed * 45) + destruction * 40 - itemsUsed * 150);
    const result: LevelResult = { stars, time: this.elapsed, itemsUsed, destruction, bestScore: score };
    saveSystem.recordLevelResult(this.level.id, result);
    saveSystem.unlockItems(Object.keys(this.level.reward.items));
    void platformService.saveData(saveSystem.data);
    void platformService.happyTime();
    void platformService.submitScore('rattleworks-score', score);
    audioSystem.play('victory');
    const starMarkup = [1, 2, 3].map((s) => `<span class="${stars >= s ? 'earned' : ''}" style="--delay:${s * 0.12}s">★</span>`).join('');
    this.openModal(`
      <div class="complete-card">
        <div class="result-kicker">LEVEL ${this.level.id} COMPLETE</div>
        <h2>${stars === 3 ? 'BEAUTIFUL MESS!' : stars === 2 ? 'SOLID RATTLE!' : 'JOB DONE!'}</h2>
        <div class="stars">${starMarkup}</div>
        <div class="result-stats">
          <div><b>${this.formatTime(this.elapsed)}</b><small>TIME</small></div>
          <div><b>${itemsUsed}</b><small>ITEMS USED</small></div>
          <div><b>${destruction}%</b><small>DESTRUCTION</small></div>
          <div><b>${score.toLocaleString()}</b><small>SCORE</small></div>
        </div>
        <div class="challenge-list"><span class="complete">✓ Complete the level</span><span class="${condition(this.level.star2) ? 'complete' : ''}">${condition(this.level.star2) ? '✓' : '○'} ${this.level.star2.label}</span><span class="${condition(this.level.star3) ? 'complete' : ''}">${condition(this.level.star3) ? '✓' : '○'} ${this.level.star3.label}</span></div>
        <div class="reward-chip"><span>CAMPAIGN KIT + SANDBOX</span><b>${this.level.reward.label} · ${this.level.unlock}</b></div>
        <div class="modal-actions">
          <button class="secondary-button" data-result="retry">RETRY</button>
          <button class="secondary-button" data-result="select">LEVELS</button>
          ${this.level.id < 12 ? '<button class="primary-button" data-result="next">NEXT LEVEL →</button>' : '<button class="primary-button" data-result="sandbox">OPEN SANDBOX →</button>'}
        </div>
      </div>
    `);
    this.root.querySelector('[data-result="retry"]')?.addEventListener('click', () => this.startLevel(this.level!.id));
    this.root.querySelector('[data-result="select"]')?.addEventListener('click', () => this.showLevelSelect());
    this.root.querySelector('[data-result="next"]')?.addEventListener('click', () => this.startLevel(this.level!.id + 1));
    this.root.querySelector('[data-result="sandbox"]')?.addEventListener('click', () => this.startSandbox());
  }

  private failLevel(title: string, message: string): void {
    if (this.phase === 'failed') return;
    this.phase = 'failed';
    audioSystem.play('failure');
    this.openModal(`<div class="complete-card failure-card"><div class="result-kicker">ATTEMPT OVER</div><h2>${title}</h2><p>${message}</p><div class="modal-actions"><button class="secondary-button" data-result="select">LEVELS</button><button class="primary-button" data-result="retry">RETRY NOW ↺</button></div></div>`);
    this.root.querySelector('[data-result="retry"]')?.addEventListener('click', () => this.startLevel(this.level!.id));
    this.root.querySelector('[data-result="select"]')?.addEventListener('click', () => this.showLevelSelect());
  }

  private startSandbox(): void {
    this.projectileAimArmed = false;
    this.armedWeaponId = undefined;
    this.mode = 'sandbox';
    this.phase = 'play';
    this.level = undefined;
    this.cameraController.cancelFollow();
    this.selection.clear();
    this.particles.clear();
    this.physics.clear();
    this.createEnvironment('yard');
    this.physics.paused = false;
    this.physics.simulationScale = 1;
    this.selection.enabled = true;
    this.cameraController.enabled = true;
    this.cameraController.setView({ x: -14, y: 10, z: 16 }, { x: 0, y: 2, z: 0 }, true);
    this.spawnCategory = 'Characters';
    this.spawnSearch = '';
    this.spawnCollection = 'category';
    this.selectedSpawnId = 'human';
    this.selectedBlueprintId = undefined;
    this.history = [];
    this.future = [];
    this.seedSandbox();
    this.renderSandboxHUD();
    void platformService.gameplayStart();
    this.toast('WELCOME TO THE WORKSHOP — SPAWN SOMETHING RIDICULOUS', 3600);
  }

  private seedSandbox(): void {
    const base = this.physics.spawn({ type: 'platform', position: { x: 3, y: 0.2, z: 0 }, scale: { x: 5, y: 0.4, z: 4 }, material: 'wood' });
    for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
      this.physics.spawn({ type: 'wall-block', position: { x: 1.1 + col * 1.25, y: 0.7 + row * 0.78, z: -1 }, scale: { x: 1.2, y: 0.72, z: 0.5 }, material: 'wood' });
    }
    this.physics.spawn({ type: 'character', variant: 'dummy', position: { x: 3, y: 0.7, z: 0.5 }, target: true });
    if (base && 'body' in base) base.object.updateMatrixWorld(true);
  }

  private runLocalStress(kind: string): void {
    this.startSandbox();
    this.physics.clear();
    this.createEnvironment('yard');
    if (kind === 'ragdolls') {
      for (let i = 0; i < 20; i++) {
        const character = this.physics.spawn({
          type: 'character',
          variant: (['dummy', 'worker', 'monster', 'knight'] as const)[i % 4],
          position: { x: (i % 5) * 2.2 - 4.4, y: 0.2 + Math.floor(i / 5) * 1.4, z: (Math.floor(i / 5) % 2) * 2 - 1 },
        });
        if (character && 'parts' in character) character.parts.forEach((part) => part.body.wakeUp());
      }
    } else {
      for (let i = 0; i < 100; i++) {
        const type = (['crate', 'barrel', 'concrete-block', 'plank'] as const)[i % 4];
        this.physics.spawn({ type, position: { x: (i % 10) * 1.35 - 6, y: 1 + Math.floor(i / 10) * 1.2, z: (i % 5) * 1.5 - 3 } });
      }
    }
    this.cameraController.setView({ x: -20, y: 15, z: 22 }, { x: 0, y: 4, z: 0 }, true);
    this.toast(kind === 'ragdolls' ? 'LOCAL QA · 20 ACTIVE RAGDOLLS' : 'LOCAL QA · 100 ACTIVE PROPS', 3500);
  }

  private renderSandboxHUD(): void {
    this.renderUI(`
      <div class="hud sandbox-hud">
        <header class="topbar">
          <button class="icon-button" data-action="exit" aria-label="Main menu">←</button>
          <div class="level-meta"><span>UNLIMITED MODE</span><b>THE WORKSHOP</b></div>
          <div class="stat-pill"><b data-stat="bodies">${this.physics.bodyStats.total}</b><small>BODIES</small></div>
          <button class="icon-button" data-action="undo" title="Undo">↶</button>
          <button class="icon-button" data-action="redo" title="Redo">↷</button>
          <button class="icon-button" data-action="pause" title="Pause">Ⅱ</button>
          <button class="icon-button" data-action="slow" title="Slow motion">½</button>
          <button class="icon-button" data-action="camera" title="Reset camera">⌂</button>
        </header>
        <div class="interaction-status" data-interaction-status role="status" aria-live="polite"><span data-interaction-mode>GRAB</span><b data-interaction-copy>Click to select · drag directly to move</b></div>
        <aside class="sandbox-panel side-panel shop-panel" id="sandbox-item-shop" aria-label="Sandbox item shop">
          <div class="shop-header">
            <div class="shop-brand"><span>INFINITE STOCK</span><strong>ITEM SHOP</strong></div>
            <div class="shop-count" aria-live="polite"><b data-shop-count>0</b><small>ITEMS</small></div>
            <button class="icon-button shop-close" data-action="close-panel" aria-label="Close item shop">×</button>
          </div>
          <label class="shop-search"><span aria-hidden="true">&#8981;</span><input class="search-input" type="search" placeholder="Search the shelves..." value="${this.spawnSearch}" aria-label="Search sandbox objects" autocomplete="off" /></label>
          <nav class="shop-categories" role="tablist" aria-label="Item categories">
            ${[
              ['Characters', '&#9786;'], ['Structures', '&#9638;'], ['Props', '&#9632;'],
              ['Machines', '&#9881;'], ['Destruction', '&#9888;'], ['Blueprints', '&#9998;'],
            ].map(([cat, fallback], index) => `<button role="tab" class="shop-category cat-${index} ${this.spawnCollection === 'category' && cat === this.spawnCategory ? 'active' : ''}" data-category="${cat}" aria-selected="${this.spawnCollection === 'category' && cat === this.spawnCategory}"><span class="shop-category-icon" aria-hidden="true"><i>${fallback}</i></span><b>${cat}</b><small data-category-count="${cat}">0</small></button>`).join('')}
          </nav>
          <div class="shop-shortcuts" aria-label="Item shortcuts">
            <button data-shop-view="favorites" aria-pressed="${this.spawnCollection === 'favorites'}"><span aria-hidden="true">&#9733;</span><b>FAVORITES</b><small data-shortcut-count="favorites">0</small></button>
            <button data-shop-view="recent" aria-pressed="${this.spawnCollection === 'recent'}"><span aria-hidden="true">&#8634;</span><b>RECENT</b><small data-shortcut-count="recent">0</small></button>
          </div>
          <div class="shop-shelf-label"><span data-shop-shelf>${this.spawnCategory}</span><small>SELECT &middot; DOUBLE-CLICK OR ENTER TO DROP</small></div>
          <div class="spawn-grid" role="listbox" aria-label="Available sandbox items"></div>
          <div class="shop-selection" data-shop-detail>
            <div class="shop-selected-icon" data-shop-selected-icon aria-hidden="true">?</div>
            <div class="shop-selected-copy"><span data-shop-selected-kind>SELECT AN ITEM</span><b data-shop-selected-name>THE SHELF IS READY</b><p data-shop-selected-description>Pick something to inspect it before dropping it into the world.</p></div>
            <div class="shop-selected-meta" data-shop-selected-meta>INFINITE</div>
            <button class="shop-spawn-button" data-action="spawn-selected" disabled><span>SPAWN / DROP</span><small>AT CAMERA TARGET</small></button>
          </div>
        </aside>
        <div class="shop-quickbar hidden" data-shop-quickbar>
          <button class="primary-button spawn-toggle" data-action="open-panel" aria-controls="sandbox-item-shop" aria-expanded="false"><kbd>B</kbd><span>ITEMS</span></button>
          <button class="quick-spawn" data-action="quick-spawn" aria-label="Drop selected shop item"><span data-quick-spawn-icon aria-hidden="true">☺</span><b data-quick-spawn-name>HUMAN</b><small>DROP <kbd>↵</kbd></small></button>
        </div>
        <div class="toolbelt sandbox-tools">${(['grab', 'delete', 'freeze', 'unfreeze', 'rotate', 'push', 'explosion', 'connect', 'rope', 'spring', 'hinge', 'motor', 'duplicate'] as ToolId[]).map((id) => { const hotkey = TOOL_HOTKEYS[id]; return `<button class="tool-button ${id === 'grab' ? 'active' : ''}" data-tool="${id}" aria-label="${TOOL_INFO[id].name}" aria-pressed="${id === 'grab'}" ${hotkey ? `aria-keyshortcuts="${hotkey}"` : ''} title="${TOOL_INFO[id].tip}${hotkey ? ` [${hotkey}]` : ''}"><span>${TOOL_INFO[id].icon}</span><small>${TOOL_INFO[id].name}</small>${hotkey ? `<kbd>${hotkey}</kbd>` : ''}</button>`; }).join('')}</div>
        <div class="world-actions">
          <button data-action="save-world">SAVE</button><button data-action="load-world">LOAD</button><button data-action="blueprint">BLUEPRINT</button><button class="danger" data-action="clear-world">CLEAR</button>
        </div>
        <div class="object-actions hidden" data-inspector></div>
        <div class="aim-reticle hidden" aria-hidden="true"><i></i><span>CLICK TO USE WEAPON</span></div>
        <div class="input-legend" aria-label="Controls"><span class="desktop-hint"><kbd>LMB</kbd> select / drag</span><span class="desktop-hint"><kbd>RMB</kbd> orbit / quick use</span><span class="desktop-hint"><kbd>1–6</kbd> tools</span><span class="desktop-hint"><kbd>F</kbd> weapon</span><span class="desktop-hint"><kbd>B</kbd> items</span><span class="touch-hint">Tap or drag objects · two fingers move camera</span></div>
        <div class="toast hidden"></div>
        <div class="debug-panel hidden"></div>
      </div>
    `);
    this.bindHUDCommon();
    this.selection.setTool('grab');
    this.bindSandboxControls();
    this.refreshSpawnGrid();
    this.syncInteractionStatus();
  }

  private bindSandboxControls(): void {
    this.root.querySelector('[data-action="undo"]')?.addEventListener('click', () => this.undo());
    this.root.querySelector('[data-action="redo"]')?.addEventListener('click', () => this.redo());
    this.root.querySelector('[data-action="slow"]')?.addEventListener('click', (event) => {
      const active = this.physics.simulationScale === 0.3;
      this.physics.simulationScale = active ? 1 : 0.3;
      (event.currentTarget as HTMLElement).classList.toggle('active', !active);
      this.toast(active ? 'NORMAL TIME' : 'SLOW MOTION 0.3×', 1200);
    });
    this.root.querySelector('[data-action="close-panel"]')?.addEventListener('click', () => this.setShopOpen(false));
    this.root.querySelector('[data-action="open-panel"]')?.addEventListener('click', () => this.setShopOpen(true));
    this.root.querySelectorAll<HTMLElement>('[data-category]').forEach((button) => button.addEventListener('click', () => {
      this.spawnCategory = button.dataset.category!;
      this.spawnCollection = 'category';
      this.refreshSpawnGrid();
    }));
    this.root.querySelectorAll<HTMLElement>('[data-shop-view]').forEach((button) => button.addEventListener('click', () => {
      const requested = button.dataset.shopView as 'favorites' | 'recent';
      this.spawnCollection = this.spawnCollection === requested ? 'category' : requested;
      this.refreshSpawnGrid();
    }));
    const search = this.root.querySelector<HTMLInputElement>('.search-input');
    search?.addEventListener('input', () => { this.spawnSearch = search.value; this.refreshSpawnGrid(); });
    this.root.querySelector<HTMLButtonElement>('[data-action="spawn-selected"]')?.addEventListener('click', () => this.spawnSelectedShopEntry());
    this.root.querySelector<HTMLButtonElement>('[data-action="quick-spawn"]')?.addEventListener('click', () => this.spawnSelectedShopEntry());
    this.root.querySelector('[data-action="save-world"]')?.addEventListener('click', () => this.saveSandbox());
    this.root.querySelector('[data-action="load-world"]')?.addEventListener('click', () => this.loadSandbox());
    this.root.querySelector('[data-action="blueprint"]')?.addEventListener('click', () => this.saveBlueprint());
    this.root.querySelector('[data-action="clear-world"]')?.addEventListener('click', () => { this.captureHistory(); this.physics.clear(); this.particles.clear(); this.selection.clear(); this.createEnvironment('yard'); this.toast('WORKSHOP CLEARED', 1400); });
  }

  private setShopOpen(open: boolean): void {
    if (this.mode !== 'sandbox') return;
    const panel = this.root.querySelector<HTMLElement>('.shop-panel');
    const quickbar = this.root.querySelector<HTMLElement>('[data-shop-quickbar]');
    panel?.classList.toggle('hidden', !open);
    quickbar?.classList.toggle('hidden', open);
    this.root.querySelector('[data-action="open-panel"]')?.setAttribute('aria-expanded', String(open));
    if (open) window.setTimeout(() => this.root.querySelector<HTMLInputElement>('.shop-search .search-input')?.focus(), 0);
  }

  private toggleShop(): void {
    if (this.mode !== 'sandbox' || this.physics.paused) return;
    const panel = this.root.querySelector<HTMLElement>('.shop-panel');
    if (!panel) return;
    this.setShopOpen(panel.classList.contains('hidden'));
  }

  private spawnSelectedShopEntry(): void {
    if (this.mode !== 'sandbox' || this.physics.paused) return;
    const button = this.root.querySelector<HTMLButtonElement>('[data-action="spawn-selected"]');
    if (!button || button.disabled) return;
    if (button.dataset.blueprintId) this.spawnBlueprint(button.dataset.blueprintId);
    else if (button.dataset.spawnId) this.spawnSandboxItem(button.dataset.spawnId);
    // On small or touch screens, return the world immediately and leave a
    // compact repeat-drop control instead of keeping the full shelf in front.
    if (matchMedia('(max-width: 700px), (pointer: coarse)').matches) this.setShopOpen(false);
  }

  private isCatalogItemLocked(item: SpawnCatalogItem, completed = Object.keys(saveSystem.data.completed).length): boolean {
    return Boolean(item.lockedAfter
      && completed < item.lockedAfter
      && !saveSystem.data.unlockedItems.includes(item.id));
  }

  private refreshSpawnGrid(): void {
    const grid = this.root.querySelector<HTMLElement>('.spawn-grid');
    if (!grid) return;
    const completed = Object.keys(saveSystem.data.completed).length;
    const query = this.spawnSearch.trim().toLowerCase();
    const favoriteIds = saveSystem.data.favorites.filter((id) => CATALOG.some((item) => item.id === id));
    const recentIds = saveSystem.data.recent.filter((id) => CATALOG.some((item) => item.id === id));
    const blueprints = saveSystem.data.blueprints;

    this.root.querySelectorAll<HTMLButtonElement>('[data-category]').forEach((button) => {
      const active = this.spawnCollection === 'category' && button.dataset.category === this.spawnCategory;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      const count = button.dataset.category === 'Blueprints' ? blueprints.length : CATALOG.filter((item) => item.category === button.dataset.category).length;
      const badge = button.querySelector<HTMLElement>('[data-category-count]');
      if (badge) badge.textContent = String(count);
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-shop-view]').forEach((button) => {
      const active = button.dataset.shopView === this.spawnCollection;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const favoriteCount = this.root.querySelector<HTMLElement>('[data-shortcut-count="favorites"]');
    const recentCount = this.root.querySelector<HTMLElement>('[data-shortcut-count="recent"]');
    if (favoriteCount) favoriteCount.textContent = String(favoriteIds.length);
    if (recentCount) recentCount.textContent = String(recentIds.length);

    const shelf = this.root.querySelector<HTMLElement>('[data-shop-shelf]');
    if (shelf) shelf.textContent = this.spawnCollection === 'favorites' ? 'FAVORITE ITEMS' : this.spawnCollection === 'recent' ? 'RECENTLY DROPPED' : this.spawnCategory.toUpperCase();

    if (this.spawnCollection === 'category' && this.spawnCategory === 'Blueprints') {
      const matches = blueprints.filter((bp) => !query || `${bp.name} ${bp.entities.length} pieces`.toLowerCase().includes(query));
      if (!matches.some((bp) => bp.id === this.selectedBlueprintId)) this.selectedBlueprintId = matches[0]?.id;
      const selected = matches.find((bp) => bp.id === this.selectedBlueprintId);
      const count = this.root.querySelector<HTMLElement>('[data-shop-count]');
      if (count) count.textContent = String(matches.length);
      grid.innerHTML = matches.length ? matches.map((bp) => `
        <article class="spawn-card blueprint-card ${bp.id === this.selectedBlueprintId ? 'active' : ''}" data-shop-blueprint-card="${bp.id}">
          <button class="spawn-card-main" data-blueprint="${bp.id}" role="option" aria-selected="${bp.id === this.selectedBlueprintId}">
            <span class="spawn-icon blueprint-icon" aria-hidden="true">${bp.icon}</span>
            <b>${bp.name}</b><small>${bp.entities.length} PCS</small>
          </button>
        </article>`).join('') : '<div class="empty-state shop-empty"><span aria-hidden="true">&#9998;</span><b>NO BLUEPRINTS YET</b><small>Select connected pieces and press BLUEPRINT to stock this shelf.</small></div>';
      grid.querySelectorAll<HTMLElement>('[data-blueprint]').forEach((button) => {
        button.addEventListener('click', () => {
          this.selectedBlueprintId = button.dataset.blueprint!;
          this.selectedSpawnId = '';
          grid.querySelectorAll('.spawn-card').forEach((card) => card.classList.toggle('active', (card as HTMLElement).dataset.shopBlueprintCard === this.selectedBlueprintId));
          grid.querySelectorAll<HTMLElement>('[data-blueprint]').forEach((option) => option.setAttribute('aria-selected', String(option.dataset.blueprint === this.selectedBlueprintId)));
          this.updateShopSelection(undefined, blueprints.find((bp) => bp.id === this.selectedBlueprintId));
        });
        button.addEventListener('dblclick', () => this.spawnBlueprint(button.dataset.blueprint!));
      });
      this.updateShopSelection(undefined, selected);
      return;
    }

    let source = CATALOG.filter((item) => item.category === this.spawnCategory);
    if (this.spawnCollection === 'favorites') source = favoriteIds.map((id) => CATALOG.find((item) => item.id === id)).filter(Boolean) as SpawnCatalogItem[];
    if (this.spawnCollection === 'recent') source = recentIds.map((id) => CATALOG.find((item) => item.id === id)).filter(Boolean) as SpawnCatalogItem[];
    const items = source.filter((item) => !query || `${item.name} ${item.description} ${item.category}`.toLowerCase().includes(query));
    if (!items.some((item) => item.id === this.selectedSpawnId)) this.selectedSpawnId = items.find((item) => !this.isCatalogItemLocked(item, completed))?.id ?? items[0]?.id ?? '';
    const selected = items.find((item) => item.id === this.selectedSpawnId);
    const count = this.root.querySelector<HTMLElement>('[data-shop-count]');
    if (count) count.textContent = String(items.length);
    grid.innerHTML = items.length ? items.map((item) => {
      const locked = this.isCatalogItemLocked(item, completed);
      const favorite = favoriteIds.includes(item.id);
      return `
        <article class="spawn-card ${locked ? 'locked' : ''} ${item.id === this.selectedSpawnId ? 'active' : ''}" data-shop-card="${item.id}">
          <button class="spawn-card-main" data-spawn="${item.id}" role="option" aria-selected="${item.id === this.selectedSpawnId}" aria-disabled="${locked}">
            <span class="spawn-icon" aria-hidden="true" style="position:relative;overflow:hidden">${item.icon}${item.iconPath ? `<img data-shop-weapon-icon src="${item.iconPath}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;image-rendering:pixelated"/>` : ''}</span>
            <b>${item.name}</b><small>${locked ? `LV.${item.lockedAfter}` : item.category.slice(0, 5)}</small>
          </button>
          <button class="shop-favorite ${favorite ? 'active' : ''}" data-favorite="${item.id}" aria-label="${favorite ? 'Remove' : 'Add'} ${item.name} ${favorite ? 'from' : 'to'} favorites" aria-pressed="${favorite}">${favorite ? '&#9733;' : '&#9734;'}</button>
        </article>`;
    }).join('') : `<div class="empty-state shop-empty"><span aria-hidden="true">${this.spawnCollection === 'favorites' ? '&#9734;' : this.spawnCollection === 'recent' ? '&#8634;' : '&#8981;'}</span><b>${this.spawnCollection === 'favorites' ? 'NO FAVORITES YET' : this.spawnCollection === 'recent' ? 'NOTHING DROPPED YET' : 'NO MATCHES'}</b><small>${this.spawnCollection === 'favorites' ? 'Tap a star on any item to pin it here.' : this.spawnCollection === 'recent' ? 'Spawn an item and it will appear here.' : 'Try a broader search.'}</small></div>`;
    grid.querySelectorAll<HTMLImageElement>('[data-shop-weapon-icon]').forEach((image) => {
      image.addEventListener('error', () => image.remove(), { once: true });
    });
    grid.querySelectorAll<HTMLElement>('[data-spawn]').forEach((button) => {
      const selectItem = () => {
        this.selectedSpawnId = button.dataset.spawn!;
        this.selectedBlueprintId = undefined;
        grid.querySelectorAll('.spawn-card').forEach((card) => card.classList.toggle('active', (card as HTMLElement).dataset.shopCard === this.selectedSpawnId));
        grid.querySelectorAll<HTMLElement>('[data-spawn]').forEach((option) => option.setAttribute('aria-selected', String(option.dataset.spawn === this.selectedSpawnId)));
        this.updateShopSelection(CATALOG.find((item) => item.id === this.selectedSpawnId));
      };
      button.addEventListener('click', selectItem);
      button.addEventListener('dblclick', () => {
        const item = CATALOG.find((entry) => entry.id === button.dataset.spawn);
        if (item && this.isCatalogItemLocked(item, completed)) { this.toast(`COMPLETE LEVEL ${item.lockedAfter} TO UNLOCK`, 1500); return; }
        if (item) this.spawnSandboxItem(item.id);
      });
    });
    grid.querySelectorAll<HTMLElement>('[data-favorite]').forEach((star) => star.addEventListener('click', (event) => {
      event.stopPropagation();
      const id = star.dataset.favorite!;
      const active = saveSystem.data.favorites.includes(id);
      saveSystem.setFavorite(id, !active);
      this.refreshSpawnGrid();
    }));
    this.updateShopSelection(selected);
  }

  private updateShopSelection(item?: SpawnCatalogItem, blueprint?: Blueprint): void {
    const icon = this.root.querySelector<HTMLElement>('[data-shop-selected-icon]');
    const kind = this.root.querySelector<HTMLElement>('[data-shop-selected-kind]');
    const name = this.root.querySelector<HTMLElement>('[data-shop-selected-name]');
    const description = this.root.querySelector<HTMLElement>('[data-shop-selected-description]');
    const meta = this.root.querySelector<HTMLElement>('[data-shop-selected-meta]');
    const button = this.root.querySelector<HTMLButtonElement>('[data-action="spawn-selected"]');
    const detail = this.root.querySelector<HTMLElement>('[data-shop-detail]');
    if (!icon || !kind || !name || !description || !meta || !button || !detail) return;
    delete button.dataset.spawnId;
    delete button.dataset.blueprintId;
    const buttonLabel = button.querySelector<HTMLElement>('span');
    const buttonHint = button.querySelector<HTMLElement>('small');
    if (blueprint) {
      this.syncQuickSpawn(blueprint.icon, blueprint.name, false);
      icon.textContent = blueprint.icon;
      kind.textContent = 'SAVED BLUEPRINT';
      name.textContent = blueprint.name;
      description.textContent = 'Drop this saved contraption into the workshop as one assembled build.';
      meta.textContent = `${blueprint.entities.length} PIECES`;
      button.dataset.blueprintId = blueprint.id;
      button.disabled = false;
      detail.classList.remove('locked', 'empty');
      if (buttonLabel) buttonLabel.textContent = 'SPAWN / DROP';
      if (buttonHint) buttonHint.textContent = 'ASSEMBLED AT TARGET';
      return;
    }
    if (item) {
      const locked = this.isCatalogItemLocked(item);
      this.syncQuickSpawn(item.icon, item.name, locked);
      const weaponItem = ['pistol', 'shotgun', 'rifle', 'knife', 'machete', 'axe', 'spear'].includes(item.id);
      icon.style.position = 'relative';
      icon.innerHTML = `${item.icon}${item.iconPath ? `<img src="${item.iconPath}" alt="" style="position:absolute;inset:5%;width:90%;height:90%;object-fit:contain;image-rendering:pixelated"/>` : ''}`;
      const detailIcon = icon.querySelector('img');
      detailIcon?.addEventListener('error', () => detailIcon.remove(), { once: true });
      kind.textContent = item.category.toUpperCase();
      name.textContent = item.name;
      description.textContent = locked ? `${item.description} Complete level ${item.lockedAfter} to unlock it.` : item.description;
      meta.textContent = locked ? `LOCKED · LV.${item.lockedAfter}` : item.character ? 'RAGDOLL · INFINITE' : weaponItem ? 'PHYSICAL WEAPON · INFINITE' : 'PHYSICS ITEM · INFINITE';
      button.dataset.spawnId = item.id;
      button.disabled = locked;
      detail.classList.toggle('locked', locked);
      detail.classList.remove('empty');
      if (buttonLabel) buttonLabel.textContent = locked ? 'LOCKED' : 'SPAWN / DROP';
      if (buttonHint) buttonHint.textContent = locked ? `FINISH LEVEL ${item.lockedAfter}` : weaponItem ? 'THEN SELECT + PRESS F' : 'AT CAMERA TARGET';
      return;
    }
    icon.textContent = '?';
    this.syncQuickSpawn('?', 'NO ITEM', true);
    kind.textContent = 'EMPTY SHELF';
    name.textContent = 'NO ITEM SELECTED';
    description.textContent = 'Choose another category or clear the search to find something to drop.';
    meta.textContent = '0 ITEMS';
    button.disabled = true;
    detail.classList.add('empty');
    detail.classList.remove('locked');
    if (buttonLabel) buttonLabel.textContent = 'SPAWN / DROP';
    if (buttonHint) buttonHint.textContent = 'SELECT AN ITEM FIRST';
  }

  private syncQuickSpawn(icon: string, name: string, disabled: boolean): void {
    const quick = this.root.querySelector<HTMLButtonElement>('[data-action="quick-spawn"]');
    const quickIcon = this.root.querySelector<HTMLElement>('[data-quick-spawn-icon]');
    const quickName = this.root.querySelector<HTMLElement>('[data-quick-spawn-name]');
    if (quick) quick.disabled = disabled;
    if (quickIcon) quickIcon.textContent = icon;
    if (quickName) quickName.textContent = name.toUpperCase();
  }

  private spawnSandboxItem(id: string): void {
    const item = CATALOG.find((entry) => entry.id === id);
    if (!item) return;
    this.captureHistory();
    const target = this.cameraController.target.clone();
    target.y = Math.max(1.2, target.y + 2.2);
    const def = item.character
      ? { type: 'character', variant: item.character as any, position: { x: target.x, y: target.y, z: target.z }, friendly: item.character === 'friendly' }
      : { type: item.id, position: { x: target.x, y: target.y, z: target.z } };
    const spawned = this.physics.spawn(def, true);
    if (spawned && 'body' in spawned) this.selection.select(spawned);
    else if (spawned && 'parts' in spawned) this.selection.select(spawned.parts.find((p) => p.part === 'torso'));
    this.selectedSpawnId = id;
    this.selectedBlueprintId = undefined;
    saveSystem.rememberRecent(id);
    this.refreshSpawnGrid();
    audioSystem.play(id === 'spring' ? 'spring' : 'ui');
    this.toast(`${item.name.toUpperCase()} ADDED`, 1100);
  }

  private handleTool(tool: ToolId, point: THREE.Vector3, entity?: Entity): void {
    if (!entity && tool !== 'explosion') return;
    if (['delete', 'freeze', 'unfreeze', 'rotate', 'push', 'explosion'].includes(tool)) this.captureHistory();
    switch (tool) {
      case 'delete': if (entity) this.deleteEntityOrCharacter(entity); break;
      case 'freeze': if (entity) this.forEntityOrCharacter(entity, (e) => this.physics.setFixed(e, true)); break;
      case 'unfreeze': if (entity) this.forEntityOrCharacter(entity, (e) => this.physics.setFixed(e, false)); break;
      case 'rotate': if (entity) this.physics.rotateEntity(entity, 'y'); break;
      case 'push': if (entity) this.physics.applyPush(entity, entity.object.position.clone().sub(this.camera.position).normalize(), 14); break;
      case 'explosion': this.physics.explode(point, 4.8, 55); break;
      case 'duplicate': this.selection.duplicateSelected(); break;
      default: break;
    }
  }

  private forEntityOrCharacter(entity: Entity, action: (entity: Entity) => void): void {
    if (entity.characterId) {
      const character = this.physics.characters.get(entity.characterId);
      if (character) character.parts.forEach(action);
    } else action(entity);
  }

  private deleteEntityOrCharacter(entity: Entity): void {
    if (entity.characterId) {
      const character = this.physics.characters.get(entity.characterId);
      if (character) for (const part of [...character.parts]) this.physics.removeEntity(part);
    } else this.physics.removeEntity(entity);
    this.selection.clear();
  }

  private deleteSelected(): void {
    if (!this.selection.selected.size) return;
    this.captureHistory();
    const selected = [...this.selection.selected];
    for (const entity of selected) if (this.physics.entities.has(entity.id)) this.deleteEntityOrCharacter(entity);
  }

  private onImpact(entity: Entity, force: number, point?: THREE.Vector3): void {
    if (force > 38 && point) this.particles.dust(point, entity.material, Math.min(12, Math.floor(force / 8)));
    if (force > 55 && saveSystem.data.settings.cameraShake) this.cameraController.addShake(Math.min(0.38, force / 300));
  }

  private onCharacterHit(character: Character, damage: number, point: THREE.Vector3): void {
    const severity = THREE.MathUtils.clamp(damage / 22, 0.35, 2.25);
    const torso = character.parts.find((part) => part.part === 'torso');
    const source = this.physics.entities.get(this.armedWeaponId ?? -1)?.object.position ?? torso?.object.position;
    const direction = source ? point.clone().sub(source) : new THREE.Vector3(0, 1, 0);
    if (direction.lengthSq() < 1e-8) direction.set(0, 1, 0);
    direction.normalize();
    // Every damaging hit bleeds. Lethal hits intentionally receive this local
    // spray before the broader defeat effect, rather than disappearing behind
    // a health/damage guard.
    this.particles.goreHit({
      point,
      direction,
      severity,
      bloodColor: 0xb81427,
      palette: { blood: 0xb81427, darkBlood: 0x65000c, highlight: 0xff4f5f, accent: character.juice },
    });
    this.particles.juice(point, character.juice, Math.min(7, 2 + Math.floor(damage * 0.12)), severity * 0.55);
    if (damage > 20 && saveSystem.data.settings.cameraShake) this.cameraController.addShake(0.16);
  }

  private onDismemberment(event: DismembermentEvent): void {
    this.particles.goreDismemberment({
      point: event.point,
      direction: event.direction,
      severity: event.severity,
      bloodColor: 0xa50b1d,
      palette: { blood: 0xa50b1d, darkBlood: 0x560007, highlight: 0xff4053, accent: event.character.juice },
    });
    this.particles.juice(event.point, 0x72000c, 8, Math.min(2.2, event.severity));
    if (saveSystem.data.settings.cameraShake) this.cameraController.addShake(Math.min(0.34, 0.14 + event.severity * 0.06));
  }

  private onCharacterDefeated(character: Character): void {
    const torso = character.parts.find((p) => p.part === 'torso');
    if (torso) {
      const velocity = torso.body.linvel();
      const direction = new THREE.Vector3(velocity.x, Math.max(0.35, velocity.y), velocity.z);
      if (direction.lengthSq() < 1e-8) direction.set(0, 1, 0);
      this.particles.goreDefeat({
        point: torso.object.position.clone(),
        direction: direction.normalize(),
        severity: 2.35,
        bloodColor: 0xb20f24,
        palette: { blood: 0xb20f24, darkBlood: 0x5a0009, highlight: 0xff5261, accent: character.juice },
      });
    }
    this.toast(character.friendly ? `${character.name.toUpperCase()} IS DOWN!` : `${character.name.toUpperCase()} KNOCKED OUT!`, 1200);
  }

  private onExplosion(point: THREE.Vector3): void {
    this.particles.explosion(point);
    if (saveSystem.data.settings.cameraShake) this.cameraController.addShake(0.75);
    this.slowTimer = Math.max(this.slowTimer, 0.35);
  }

  private captureHistory(): void {
    if (this.mode !== 'sandbox' && this.mode !== 'campaign') return;
    this.history.push(this.createHistoryEntry('Undo point'));
    if (this.history.length > 24) this.history.shift();
    this.future = [];
  }

  private createHistoryEntry(name: string): HistoryEntry {
    const entry: HistoryEntry = { world: this.snapshotWorld(name) };
    if (this.mode === 'campaign') {
      entry.campaign = {
        loadout: { ...this.loadout },
        activeItem: this.activeItem,
        projectileAimArmed: this.projectileAimArmed,
      };
    }
    return entry;
  }

  private restoreHistoryEntry(entry: HistoryEntry): void {
    this.restoreWorld(entry.world);
    if (this.mode !== 'campaign' || !entry.campaign) return;
    this.loadout = { ...entry.campaign.loadout };
    this.activeItem = entry.campaign.activeItem && (this.loadout[entry.campaign.activeItem] ?? 0) > 0
      ? entry.campaign.activeItem
      : Object.keys(this.loadout).find((id) => this.loadout[id] > 0);
    this.root.querySelectorAll<HTMLElement>('[data-item]').forEach((button) => {
      const active = button.dataset.item === this.activeItem;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    this.refreshLoadoutCounts();
    this.setProjectileAimArmed(entry.campaign.projectileAimArmed, false);
    this.updateUseButton();
  }

  private undo(): void {
    const entry = this.history.pop();
    if (!entry) { this.toast('NOTHING TO UNDO', 1000); return; }
    this.future.push(this.createHistoryEntry('Redo point'));
    this.restoreHistoryEntry(entry);
    this.toast('UNDONE', 900);
  }

  private redo(): void {
    const entry = this.future.pop();
    if (!entry) { this.toast('NOTHING TO REDO', 1000); return; }
    this.history.push(this.createHistoryEntry('Undo point'));
    this.restoreHistoryEntry(entry);
    this.toast('REDONE', 900);
  }

  private snapshotWorld(name: string, subset?: Set<number>, relative = false): WorldSnapshot {
    const entities: SnapshotEntity[] = [];
    const idToIndex = new Map<number, number>();
    const characterHandled = new Set<number>();
    const chosen = (subset
      ? [...subset].map((id) => this.physics.entities.get(id)).filter(Boolean) as Entity[]
      : [...this.physics.entities.values()]
    ).filter((entity) => !entity.group?.startsWith(WORLD_THEME_ENTITY_GROUP_PREFIX));
    const center = relative && chosen.length ? chosen.reduce((sum, e) => sum.add(e.object.position), new THREE.Vector3()).multiplyScalar(1 / chosen.length) : new THREE.Vector3();
    for (const entity of chosen) {
      if (entity.characterId) {
        if (characterHandled.has(entity.characterId)) continue;
        characterHandled.add(entity.characterId);
        const character = this.physics.characters.get(entity.characterId);
        const torso = character?.parts.find((p) => p.part === 'torso');
        if (!character || !torso) continue;
        const pos = torso.object.position.clone().sub(center).add(new THREE.Vector3(0, -1.85, 0));
        entities.push({
          type: 'character',
          variant: character.kind,
          position: { x: pos.x, y: pos.y, z: pos.z },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
          material: 'toy',
          fixed: false,
          character: {
            health: character.health,
            unconscious: character.unconscious,
            defeated: character.defeated,
            severedJoints: character.anatomicalJoints.filter((joint) => joint.detached).map((joint) => joint.id),
          },
        });
        continue;
      }
      const p = entity.object.position.clone().sub(center);
      const q = entity.object.quaternion;
      const meshMaterial = (entity.object as THREE.Mesh).material;
      const color = meshMaterial instanceof THREE.Material && 'color' in meshMaterial ? (meshMaterial as THREE.MeshLambertMaterial).color.getHex() : undefined;
      idToIndex.set(entity.id, entities.length);
      entities.push({
        type: entity.type,
        position: { x: p.x, y: p.y, z: p.z },
        rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
        scale: { x: entity.size.x, y: entity.size.y, z: entity.size.z },
        material: entity.material,
        color,
        fixed: entity.fixed,
        ...(entity.weapon ? { weapon: { ammo: entity.weapon.ammo, reserveAmmo: entity.weapon.reserveAmmo } } : {}),
      });
    }
    const connectors = [...this.physics.connectors.values()].filter((c) => idToIndex.has(c.a) && idToIndex.has(c.b)).map((c) => ({ type: c.type, a: idToIndex.get(c.a)!, b: idToIndex.get(c.b)!, restLength: c.restLength }));
    return { version: 1, name, createdAt: Date.now(), entities, connectors };
  }

  private restoreWorld(snapshot: WorldSnapshot, offset = new THREE.Vector3()): void {
    this.cameraController.cancelFollow();
    this.disarmWeaponAim();
    this.selection.clear();
    this.physics.clear();
    this.particles.clear();
    this.createEnvironment(this.mode === 'campaign' ? this.level?.environment ?? 'yard' : 'yard');
    const spawned: Array<Entity | undefined> = [];
    for (const def of snapshot.entities) {
      const p = new THREE.Vector3(def.position.x, def.position.y, def.position.z).add(offset);
      const spawnedEntity = this.physics.spawn({ type: def.type, variant: def.variant, position: { x: p.x, y: p.y, z: p.z }, scale: def.scale, material: def.material, color: def.color, fixed: def.fixed, friendly: def.variant === 'friendly' }, true);
      if (spawnedEntity && 'body' in spawnedEntity) {
        spawnedEntity.body.setRotation(def.rotation, true);
        if (spawnedEntity.weapon && def.weapon) {
          spawnedEntity.weapon.ammo = Math.min(spawnedEntity.weapon.magazineSize, Math.max(0, Math.floor(def.weapon.ammo)));
          spawnedEntity.weapon.reserveAmmo = Math.min(spawnedEntity.weapon.magazineSize * 8, Math.max(0, Math.floor(def.weapon.reserveAmmo)));
        }
        spawned.push(spawnedEntity);
      } else {
        if (spawnedEntity && 'parts' in spawnedEntity && def.character) this.physics.restoreCharacterState(spawnedEntity, def.character);
        // Character bodies are intentionally not addressable by workshop
        // connectors, matching the snapshot writer's anti-loop behavior.
        spawned.push(undefined);
      }
    }
    for (const c of snapshot.connectors) {
      const a = spawned[c.a];
      const b = spawned[c.b];
      if (a && b) this.physics.createConnector(c.type, a, b, c.restLength);
    }
  }

  private saveSandbox(): void {
    const snapshot = this.snapshotWorld('Workshop Slot');
    saveSystem.saveWorld('workshop-slot', snapshot);
    void platformService.saveData(saveSystem.data);
    this.toast(`WORLD SAVED · ${snapshot.entities.length} OBJECTS`, 1900);
    audioSystem.play('victory');
  }

  private loadSandbox(): void {
    const snapshot = saveSystem.loadWorld('workshop-slot');
    if (!snapshot) { this.toast('NO SAVED WORKSHOP YET', 1500); return; }
    this.captureHistory();
    this.restoreWorld(snapshot);
    this.toast('WORLD LOADED', 1500);
  }

  private saveBlueprint(): void {
    if (!this.selection.selected.size) { this.toast('SELECT A CONNECTED CONTRAPTION FIRST', 1700); return; }
    const ids = new Set([...this.selection.selected].map((e) => e.id));
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of this.physics.connectors.values()) {
        if (ids.has(c.a) && !ids.has(c.b)) { ids.add(c.b); changed = true; }
        if (ids.has(c.b) && !ids.has(c.a)) { ids.add(c.a); changed = true; }
      }
    }
    const count = saveSystem.data.blueprints.length + 1;
    const snapshot = this.snapshotWorld(`Contraption ${count}`, ids, true);
    const blueprint: Blueprint = { ...snapshot, id: `bp-${Date.now().toString(36)}`, icon: count % 2 ? '⚙' : '✣' };
    saveSystem.saveBlueprint(blueprint);
    this.spawnCategory = 'Blueprints';
    this.spawnCollection = 'category';
    this.selectedBlueprintId = blueprint.id;
    this.selectedSpawnId = '';
    this.refreshSpawnGrid();
    this.toast(`BLUEPRINT SAVED · ${snapshot.entities.length} PIECES`, 1800);
  }

  private spawnBlueprint(id: string): void {
    const blueprint = saveSystem.data.blueprints.find((bp) => bp.id === id);
    if (!blueprint) return;
    this.captureHistory();
    const existing = this.snapshotWorld('Existing workshop');
    const target = this.cameraController.target.clone();
    // Spawn additively instead of replacing the current workshop.
    const spawned: Array<Entity | undefined> = [];
    for (const def of blueprint.entities) {
      const p = new THREE.Vector3(def.position.x, def.position.y, def.position.z).add(target).add(new THREE.Vector3(0, 1, 0));
      const item = this.physics.spawn({ type: def.type, variant: def.variant, position: { x: p.x, y: p.y, z: p.z }, scale: def.scale, material: def.material, color: def.color, fixed: def.fixed }, true);
      if (item && 'body' in item) { item.body.setRotation(def.rotation, true); spawned.push(item); }
      else spawned.push(undefined);
    }
    for (const c of blueprint.connectors) {
      const a = spawned[c.a];
      const b = spawned[c.b];
      if (a && b) this.physics.createConnector(c.type, a, b, c.restLength);
    }
    this.toast(`${blueprint.name.toUpperCase()} SPAWNED`, 1300);
  }

  private updateInspector(entities: Entity[]): void {
    const inspector = this.root.querySelector<HTMLElement>('[data-inspector]');
    if (!inspector) return;
    if (!entities.length) {
      this.disarmWeaponAim();
      inspector.classList.add('hidden');
      return;
    }
    if (this.armedWeaponId !== undefined && !entities.some((entity) => entity.id === this.armedWeaponId)) this.disarmWeaponAim();
    const entity = entities[0];
    const character = entity.characterId ? this.physics.characters.get(entity.characterId) : undefined;
    const weaponEntity = entities.find((candidate) => candidate.weapon);
    const weapon = weaponEntity?.weapon;
    const ammoBox = entities.find((candidate) => candidate.type === 'ammo-box');
    const meta = character
      ? `${Math.max(0, Math.round(character.health))} HP - ${entity.part}`
      : weapon
        ? weapon.mode === 'firearm'
          ? `${weapon.ammo}/${weapon.reserveAmmo} AMMO - ${weaponEntity!.body.mass().toFixed(1)} kg`
          : `MELEE - ${weaponEntity!.body.mass().toFixed(1)} kg`
        : `${entity.material} - ${entity.body.mass().toFixed(1)} kg`;
    const weaponControls = (this.mode === 'sandbox' || this.mode === 'campaign') && weapon
      ? `<button data-inspect="use-weapon">${this.armedWeaponId === weaponEntity!.id ? 'CANCEL AIM' : weapon.mode === 'firearm' ? 'AIM / FIRE - F' : 'AIM / STRIKE - F'}</button>${weapon.mode === 'firearm' ? '<button data-inspect="reload">RELOAD - R</button>' : ''}`
      : '';
    const ammoControl = (this.mode === 'sandbox' || this.mode === 'campaign') && ammoBox ? '<button data-inspect="restock">RESTOCK NEAREST</button>' : '';
    inspector.classList.remove('hidden');
    inspector.innerHTML = `<div><span>${entities.length > 1 ? `${entities.length} SELECTED` : character ? character.name : this.pretty(entity.type)}</span><small>${meta}</small></div>${weaponControls}${ammoControl}<button data-inspect="focus">◎</button>${this.mode === 'sandbox' ? '<button data-inspect="copy">⧉</button><button data-inspect="delete">×</button>' : ''}`;
    inspector.querySelector('[data-inspect="use-weapon"]')?.addEventListener('click', () => this.armSelectedWeapon(true));
    inspector.querySelector('[data-inspect="reload"]')?.addEventListener('click', () => this.reloadSelectedWeapon());
    inspector.querySelector('[data-inspect="restock"]')?.addEventListener('click', () => ammoBox && this.useAmmoBox(ammoBox));
    inspector.querySelector('[data-inspect="focus"]')?.addEventListener('click', () => this.cameraController.focus(entity));
    inspector.querySelector('[data-inspect="copy"]')?.addEventListener('click', () => { this.captureHistory(); this.selection.duplicateSelected(); });
    inspector.querySelector('[data-inspect="delete"]')?.addEventListener('click', () => this.deleteSelected());
  }

  private togglePause(): void {
    if (this.phase === 'complete' || this.phase === 'failed') return;
    const paused = !this.physics.paused;
    this.physics.paused = paused;
    if (paused) {
      this.selection.suspend();
      this.disarmWeaponAim();
      this.phase = 'paused';
      this.openModal(`<div class="pause-panel"><span>THE DUST IS HANGING</span><h2>PAUSED</h2><p>Take a breath. The tower will still be falling when you return.</p><div class="modal-actions"><button class="secondary-button" data-pause="exit">${this.mode === 'campaign' ? 'LEVELS' : 'MENU'}</button><button class="secondary-button" data-pause="reset">RESET</button><button class="primary-button" data-pause="resume">RESUME ▶</button></div></div>`);
      void platformService.gameplayStop();
      this.root.querySelector('[data-pause="resume"]')?.addEventListener('click', () => this.resume());
      this.root.querySelector('[data-pause="reset"]')?.addEventListener('click', () => this.resetCurrent());
      this.root.querySelector('[data-pause="exit"]')?.addEventListener('click', () => this.mode === 'campaign' ? this.showLevelSelect() : this.showMainMenu());
    } else this.resume();
  }

  private resume(): void {
    this.root.querySelector('.modal')?.remove();
    this.physics.paused = false;
    this.phase = this.mode === 'campaign' && this.level?.phase === 'build' && !document.querySelector('[data-action="start"]') ? 'play' : this.mode === 'campaign' && this.level?.phase === 'build' ? 'build' : 'play';
    void platformService.gameplayStart();
  }

  private resetCurrent(): void {
    if (this.mode === 'campaign' && this.level) this.startLevel(this.level.id);
    else if (this.mode === 'sandbox') this.startSandbox();
  }

  private resetCamera(): void {
    if (this.level) this.cameraController.reset(this.level.camera.position, this.level.camera.target);
    else this.cameraController.reset({ x: -14, y: 10, z: 16 }, { x: 0, y: 2, z: 0 });
  }

  private handleEscape(): void {
    if (this.projectileAimArmed) {
      this.setProjectileAimArmed(false, false);
      this.toast('LAUNCH AIM CANCELLED', 850);
      return;
    }
    if (this.armedWeaponId !== undefined) {
      this.disarmWeaponAim();
      this.updateInspector([...this.selection.selected]);
      return;
    }
    const shop = this.root.querySelector<HTMLElement>('.shop-panel');
    if (this.mode === 'sandbox' && shop && !shop.classList.contains('hidden')) {
      this.setShopOpen(false);
      return;
    }
    if (this.root.querySelector('.settings-modal')) { this.root.querySelector('.modal')?.remove(); return; }
    if (this.phase === 'paused') { this.resume(); return; }
    if (this.mode === 'campaign' || this.mode === 'sandbox') this.togglePause();
    else if (this.mode === 'campaign-select') this.showMainMenu();
  }

  private showSettings(): void {
    const settings = saveSystem.data.settings;
    this.openModal(`<div class="settings-modal"><div class="panel-header"><div><span>RATTLEWORKS OPTIONS</span><h2>SETTINGS</h2></div><button class="icon-button" data-settings="close">×</button></div><div class="panel-section"><span>QUALITY</span><div class="quality-grid">${(['low', 'medium', 'high'] as Quality[]).map((q) => `<button class="${settings.quality === q ? 'active' : ''}" data-quality="${q}"><b>${q.toUpperCase()}</b><small>${q === 'low' ? 'Fastest' : q === 'medium' ? 'Balanced' : 'Best shadows'}</small></button>`).join('')}</div></div><label class="setting-row"><div><b>MASTER VOLUME</b><small>Procedural impacts, rattles and booms</small></div><input type="range" min="0" max="100" value="${settings.volume * 100}" data-settings="volume"></label><label class="setting-row"><div><b>CAMERA SHAKE</b><small>Reaction to heavy hits and explosions</small></div><input class="switch" type="checkbox" ${settings.cameraShake ? 'checked' : ''} data-settings="shake"></label><div class="controls-card"><b>CONTROLS</b><span>Left drag · grab body parts</span><span>Right drag · orbit</span><span>Middle / Shift drag · pan</span><span>Wheel / pinch · zoom</span><span>WASD · move focus</span><span>F · fire or place</span><span>Space · pause</span><span>F3 · lab stats</span></div></div>`);
    this.root.querySelector('[data-settings="close"]')?.addEventListener('click', () => this.root.querySelector('.modal')?.remove());
    this.root.querySelectorAll<HTMLElement>('[data-quality]').forEach((button) => button.addEventListener('click', () => {
      const quality = button.dataset.quality as Quality;
      saveSystem.setSettings({ quality });
      this.applyQuality(quality);
      this.root.querySelectorAll('[data-quality]').forEach((b) => b.classList.toggle('active', b === button));
    }));
    const volume = this.root.querySelector<HTMLInputElement>('[data-settings="volume"]');
    volume?.addEventListener('input', () => { const value = Number(volume.value) / 100; audioSystem.setVolume(value); saveSystem.setSettings({ volume: value }); });
    const shake = this.root.querySelector<HTMLInputElement>('[data-settings="shake"]');
    shake?.addEventListener('change', () => saveSystem.setSettings({ cameraShake: shake.checked }));
  }

  private createEnvironment(kind: LevelDefinition['environment']): void {
    const disposePreviousTheme = this.environment.userData.worldThemeDispose;
    if (typeof disposePreviousTheme === 'function') disposePreviousTheme();
    this.scene.remove(this.environment);
    this.environment = new THREE.Group();
    this.environment.name = 'environment-decoration';
    this.scene.add(this.environment);
    const theme = buildWorldTheme(this.environment, kind);
    this.scene.background = theme.sky;
    this.scene.fog = theme.fog;

    for (const prop of theme.gameplayProps) {
      const spawned = this.physics.spawn(prop.definition, false);
      if (spawned && 'body' in spawned) prop.decorate?.(spawned.object);
    }

    const groundVisual = this.scene.children.find(
      (object): object is THREE.Mesh => object instanceof THREE.Mesh && object.userData.ignorePick === true,
    );
    if (groundVisual) {
      const groundMaterials = Array.isArray(groundVisual.material) ? groundVisual.material : [groundVisual.material];
      for (const groundMaterial of groundMaterials) {
        if (groundMaterial instanceof THREE.MeshStandardMaterial || groundMaterial instanceof THREE.MeshLambertMaterial) {
          groundMaterial.color.copy(theme.groundColor);
          groundMaterial.map = theme.groundMap;
          groundMaterial.needsUpdate = true;
          const mapUsers = theme.groundMap.userData.pixelMapUsers as Set<typeof groundMaterial> | undefined;
          mapUsers?.add(groundMaterial);
        }
      }
    }
  }

  private openModal(inner: string): void {
    this.root.querySelector('.modal')?.remove();
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = inner;
    this.root.appendChild(modal);
  }

  private renderUI(html: string): void {
    this.root.querySelectorAll(':scope > :not(canvas)').forEach((node) => node.remove());
    const layer = document.createElement('div');
    layer.className = 'ui-layer';
    layer.innerHTML = html;
    this.root.appendChild(layer);
    this.cacheUIReferences();
    this.renderDirty = true;
  }

  private cacheUIReferences(): void {
    this.statTargets = this.root.querySelector<HTMLElement>('[data-stat="targets"]') ?? undefined;
    this.statTime = this.root.querySelector<HTMLElement>('[data-stat="time"]') ?? undefined;
    this.statBodies = this.root.querySelector<HTMLElement>('[data-stat="bodies"]') ?? undefined;
    this.debugPanel = this.root.querySelector<HTMLElement>('.debug-panel') ?? undefined;
    this.aimReticle = this.root.querySelector<HTMLElement>('.aim-reticle') ?? undefined;
    this.aimReticleLabel = this.aimReticle?.querySelector<HTMLElement>('span') ?? undefined;
    this.useItemButton = this.root.querySelector<HTMLButtonElement>('[data-action="use-item"]') ?? undefined;
    this.lastAimClientX = Number.NaN;
    this.lastAimClientY = Number.NaN;
    this.lastAimOverTarget = undefined;
    this.loadoutCountElements.clear();
    this.loadoutButtons.clear();
    this.root.querySelectorAll<HTMLElement>('[data-count]').forEach((element) => {
      if (element.dataset.count) this.loadoutCountElements.set(element.dataset.count, element);
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-item]').forEach((button) => {
      if (button.dataset.item) this.loadoutButtons.set(button.dataset.item, button);
    });
  }

  private setText(element: HTMLElement | undefined, value: string): void {
    if (element && element.textContent !== value) element.textContent = value;
  }

  private toast(message: string, duration = 1800): void {
    const element = this.root.querySelector<HTMLElement>('.toast');
    if (!element) return;
    element.textContent = message;
    element.classList.remove('hidden');
    if (this.recentToast) window.clearTimeout(this.recentToast);
    this.recentToast = window.setTimeout(() => element.classList.add('hidden'), duration);
  }

  private formatTime(seconds: number): string {
    const whole = Math.max(0, Math.floor(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  }

  private pretty(id: string): string {
    return id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
