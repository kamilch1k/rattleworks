import './frontline.css';
import * as THREE from 'three';

type Team = 'red' | 'green';
type Ability = 'shell' | 'rocket';

interface Unit {
  team: Team;
  group: THREE.Group;
  limbs: THREE.Object3D[];
  hp: number;
  maxHp: number;
  speed: number;
  cooldown: number;
  hitFlash: number;
  phase: number;
  alive: boolean;
  x: number;
  z: number;
  knockX: number;
  knockZ: number;
  /** Short, physics-style knockdown after a heavy blast. */
  ragdollTimer: number;
  /** Survivors visibly push themselves upright before resuming combat. */
  recoveryTimer: number;
  /** Fallen enemies persist briefly instead of exploding into cube particles. */
  corpseTimer: number;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
}

interface StructurePart {
  team: Team;
  mesh: THREE.Mesh;
  hp: number;
  maxHp: number;
  radius: number;
  alive: boolean;
}

interface Debris {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

interface Projectile {
  mesh: THREE.Mesh;
  shadow: THREE.Mesh;
  start: THREE.Vector3;
  target: THREE.Vector3;
  elapsed: number;
  duration: number;
  power: number;
  radius: number;
  kind: Ability;
}

interface Blast {
  ring: THREE.Mesh;
  core: THREE.Mesh;
  life: number;
  maxLife: number;
}

interface Zone {
  id: string;
  row: number;
  lane: number;
  x: number;
  z: number;
  owner: Team | 'neutral';
  mesh: THREE.Mesh;
  border: THREE.LineSegments;
  marker: THREE.Mesh;
  label: THREE.Sprite;
  shrine: THREE.Group;
  shrineCore: THREE.Mesh;
  shrineFlag: THREE.Mesh;
  shrineHp: number;
  maxShrineHp: number;
  rebuildTimer: number;
}

const RED = 0xff4d46;
const RED_DARK = 0x7c1c2c;
const GREEN = 0x68d776;
const GREEN_DARK = 0x1c744a;
const GOLD = 0xffc85a;
const ARENA_HALF_WIDTH = 28;
const ARENA_HALF_LENGTH = 50;
const RED_BASE_Z = -40;
const GREEN_BASE_Z = 40;
const LANES = [-20, -10, 0, 10, 20];
const SECTOR_ROWS = [-28, -21, -14, -7, 0, 7, 14, 21, 28];

const app = document.querySelector<HTMLElement>('#frontline-app');
if (!app) throw new Error('Frontline prototype needs #frontline-app.');

class FrontlineGame {
  private readonly scene = new THREE.Scene();
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 110);
  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly units: Unit[] = [];
  private readonly structures: StructurePart[] = [];
  private readonly debris: Debris[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly blasts: Blast[] = [];
  private readonly trailDots: THREE.Mesh[] = [];
  private readonly zones: Zone[] = [];
  private readonly arena = new THREE.Group();
  private readonly redForce = new THREE.Group();
  private readonly greenForce = new THREE.Group();
  private readonly player = new THREE.Group();
  private readonly playerLimbs: THREE.Object3D[] = [];
  private readonly playerMove = new THREE.Vector3();
  private readonly playerTarget = new THREE.Vector3();
  private readonly cameraForward = new THREE.Vector3();
  private readonly cameraRight = new THREE.Vector3();
  private readonly playerKeys = new Set<string>();
  private readonly aimPoint = new THREE.Vector3();
  private readonly lastPointer = new THREE.Vector2();
  private readonly aimIndicator = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.62, 24),
    new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.88, side: THREE.DoubleSide, depthWrite: false }),
  );
  private readonly shellGeometry = new THREE.IcosahedronGeometry(0.35, 1);
  private readonly debrisGeometry = new THREE.BoxGeometry(0.55, 0.55, 0.55);
  private readonly unitBody = new THREE.DodecahedronGeometry(0.45, 0);
  private readonly unitHead = new THREE.SphereGeometry(0.35, 12, 8);
  private readonly unitLeg = new THREE.BoxGeometry(0.15, 0.27, 0.17);
  private readonly unitArm = new THREE.BoxGeometry(0.15, 0.33, 0.15);
  private readonly friendlyBody = new THREE.MeshStandardMaterial({ color: RED, roughness: 0.72 });
  private readonly friendlyTrim = new THREE.MeshStandardMaterial({ color: 0xffd2ba, roughness: 0.85 });
  private readonly enemyBody = new THREE.MeshStandardMaterial({ color: GREEN, roughness: 0.72 });
  private readonly enemyTrim = new THREE.MeshStandardMaterial({ color: 0xe1f0bd, roughness: 0.85 });
  private readonly gray = new THREE.MeshStandardMaterial({ color: 0x2d3947, roughness: 0.8 });
  private readonly faceMaterial = new THREE.MeshBasicMaterial({ color: 0x17212a });
  private readonly shellMaterial = new THREE.MeshStandardMaterial({ color: 0x293746, roughness: 0.52, metalness: 0.32 });
  private readonly rocketMaterial = new THREE.MeshStandardMaterial({ color: 0xffc85a, roughness: 0.36, metalness: 0.2, emissive: 0x7a3210, emissiveIntensity: 0.22 });
  private readonly tempVector = new THREE.Vector3();
  private readonly tempVectorB = new THREE.Vector3();
  private readonly tempColor = new THREE.Color();
  private readonly hud: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly redCastleHealth = { value: 760, max: 760 };
  private readonly greenCastleHealth = { value: 760, max: 760 };
  private supplies = 66;
  private wave = 1;
  private kills = 0;
  private ability: Ability = 'shell';
  private rocketCooldown = 0;
  private summonCooldown = 0;
  private enemySpawnTimer = 0.6;
  private elapsed = 0;
  private stopped = false;
  private speed = 1;
  private soundEnabled = false;
  private cameraYaw = 0.76;
  private cameraPitch = 0.82;
  private aimingAbility = false;
  private rotatingCamera = false;
  private audioContext?: AudioContext;

  constructor(private readonly root: HTMLElement) {
    this.root.innerHTML = this.uiMarkup();
    this.hud = this.root.querySelector<HTMLElement>('[data-hud]')!;
    this.feed = this.root.querySelector<HTMLElement>('[data-feed]')!;

    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.domElement.className = 'frontline-canvas';
    this.root.querySelector<HTMLElement>('[data-stage]')!.append(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x86b8d6);
    this.scene.fog = new THREE.FogExp2(0x8eb9cb, 0.024);
    // View from the red commander's side: friendly troops are in the foreground
    // while the enemy citadel and incoming green horde sit beyond the frontline.
    this.camera.position.set(0, 20.8, -22.5);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(this.arena, this.redForce, this.greenForce);

    this.createBattlefield();
    this.createLighting();
    this.createCastles();
    this.createCannon();
    this.createCommander();
    this.seedArmy('red', 38);
    this.seedArmy('green', 42);
    this.bindUi();
    this.resize();
    addEventListener('resize', () => this.resize());
    this.aimIndicator.rotation.x = -Math.PI / 2;
    this.aimIndicator.visible = false;
    this.scene.add(this.aimIndicator);
    this.renderer.domElement.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    this.renderer.domElement.addEventListener('pointermove', (event) => this.onPointerMove(event));
    this.renderer.domElement.addEventListener('pointerup', (event) => this.onPointerUp(event));
    this.renderer.domElement.addEventListener('pointercancel', (event) => this.onPointerUp(event));
    this.renderer.domElement.addEventListener('wheel', (event) => this.selectAbilityFromWheel(event), { passive: false });
    this.renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());
    this.addFeed('FRONTLINE ESTABLISHED', 'system');
    this.addFeed('CLICK THE FIELD TO FIRE', 'system');
    this.animate();
  }

  private uiMarkup(): string {
    return `
      <main class="frontline-shell">
        <section class="frontline-stage" data-stage aria-label="Frontline battlefield"></section>
        <div class="frontline-vignette"></div>
        <header class="top-hud" data-hud>
          <div class="brand-lockup"><span class="brand-mark">✦</span><div><b>FRONTLINE</b><span>SIEGE COMMAND</span></div></div>
          <div class="battle-status">
            <div class="base-card enemy"><span>ENEMY CITADEL</span><strong data-enemy-health>760</strong><i><em data-enemy-bar></em></i></div>
            <div class="versus"><span>WAVE</span><b data-wave>01</b></div>
            <div class="base-card friendly"><span>YOUR CITADEL</span><strong data-friendly-health>760</strong><i><em data-friendly-bar></em></i></div>
          </div>
          <div class="hud-actions"><button class="speed-toggle" data-sound title="Enable sound" aria-label="Enable sound">🔇</button><button class="speed-toggle" data-speed title="Toggle battle speed">1×</button></div>
        </header>
        <aside class="battle-feed" data-feed aria-live="polite"></aside>
        <div class="aim-hint"><span class="mouse-icon">⌖</span><b>COMMANDER ACTIVE</b><small>WASD move · MMB orbit · Hold/release LMB to cast · Wheel swaps ability</small></div>
        <footer class="command-deck">
          <section class="command-brief"><span>COMMAND POINTS</span><strong data-supplies>066</strong><small>+3 / sec</small></section>
          <div class="command-divider"></div>
          <button class="command-card selected" data-ability="shell">
            <span class="ability-icon shell-icon">●</span><span><b>HOWITZER</b><small>Precision shell · Click field</small></span><kbd>1</kbd>
          </button>
          <button class="command-card" data-ability="rocket">
            <span class="ability-icon rocket-icon">▲</span><span><b>FIRE ROCKET</b><small>Heavy blast · 22 points</small></span><kbd>2</kbd>
          </button>
          <button class="command-card summon" data-summon>
            <span class="ability-icon summon-icon">✚</span><span><b>DEPLOY SQUAD</b><small>12 troops · 35 points</small></span><kbd>Q</kbd>
          </button>
        </footer>
        <div class="prototype-badge">PROTOTYPE · PHYSICS FRONTLINE</div>
        <section class="result-panel" data-result hidden>
          <span data-result-kicker>MISSION COMPLETE</span><h1 data-result-title>THE LINE HOLDS</h1><p data-result-copy>Enemy citadel destroyed.</p><button data-restart>PLAY AGAIN</button>
        </section>
      </main>`;
  }

  private createLighting(): void {
    this.scene.add(new THREE.HemisphereLight(0xd7edff, 0x25351d, 2.25));
    const sun = new THREE.DirectionalLight(0xfff2ca, 3.2);
    sun.position.set(-12, 22, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -24;
    sun.shadow.camera.right = 24;
    sun.shadow.camera.top = 24;
    sun.shadow.camera.bottom = -24;
    this.scene.add(sun);
  }

  private createBattlefield(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_HALF_WIDTH * 2, ARENA_HALF_LENGTH * 2, 48, 88),
      new THREE.MeshStandardMaterial({ color: 0x62783c, roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.arena.add(ground);

    const grid = new THREE.GridHelper(ARENA_HALF_WIDTH * 2, 28, 0xbccf8e, 0x789060);
    grid.position.y = 0.018;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.08;
    this.arena.add(grid);

    // Five lanes and nine connected rows create a proper long Frontlines board.
    // Red begins in the bottom row, green in the top row, and both must break
    // an adjacent shrine to claim a neutral or enemy sector.
    SECTOR_ROWS.forEach((z, row) => LANES.forEach((x, lane) => {
      const owner: Team | 'neutral' = row === 0 ? 'red' : row === SECTOR_ROWS.length - 1 ? 'green' : 'neutral';
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(9.25, 6.2),
        new THREE.MeshStandardMaterial({ color: 0x5a6258, transparent: true, opacity: 0.38, roughness: 1 }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0.035, z);
      const border = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(9.25, 6.2)),
        new THREE.LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.58 }),
      );
      border.rotation.x = -Math.PI / 2;
      border.position.set(x, 0.055, z);
      const marker = new THREE.Mesh(
        new THREE.CircleGeometry(1.28, 24),
        new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.25, depthWrite: false }),
      );
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(x, 0.065, z);
      const shrine = new THREE.Group();
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.94, 0.32, 6), new THREE.MeshStandardMaterial({ color: 0x38434b, roughness: 0.9 }));
      plinth.position.y = 0.16;
      const shrineCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.48, 0), new THREE.MeshStandardMaterial({ color: 0xc2baa0, emissive: 0x3b3523, emissiveIntensity: 0.55, roughness: 0.38 }));
      shrineCore.position.y = 0.77;
      shrineCore.castShadow = true;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.65, 7), this.gray);
      pole.position.set(0.62, 0.87, 0);
      const shrineFlag = new THREE.Mesh(new THREE.PlaneGeometry(0.65, 0.38), new THREE.MeshBasicMaterial({ color: 0xc2baa0, side: THREE.DoubleSide }));
      shrineFlag.position.set(0.92, 1.32, 0);
      shrineFlag.rotation.y = Math.PI / 2;
      shrine.add(plinth, shrineCore, pole, shrineFlag);
      shrine.position.set(x, 0, z);
      const label = this.createSectorLabel(`S${row + 1}-${lane + 1}`);
      label.position.set(x, 0.12, z - 2.05);
      label.scale.set(2.8, 0.52, 1);
      this.arena.add(mesh, border, marker, shrine, label);
      this.zones.push({ id: `S${row + 1}-${lane + 1}`, row, lane, x, z, owner, mesh, border, marker, label, shrine, shrineCore, shrineFlag, shrineHp: 180, maxShrineHp: 180, rebuildTimer: 0 });
    }));
    this.refreshZoneVisuals();
  }

  private createSectorLabel(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 48;
    const context = canvas.getContext('2d')!;
    context.font = '800 24px system-ui';
    context.textAlign = 'center';
    context.fillStyle = '#f6f1cf';
    context.fillText(text, 128, 30);
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false }));
  }

  private neighboringZones(zone: Zone): Zone[] {
    return this.zones.filter((other) => Math.abs(other.row - zone.row) + Math.abs(other.lane - zone.lane) === 1);
  }

  private canCaptureZone(team: Team, zone: Zone): boolean {
    return zone.owner !== team && this.neighboringZones(zone).some((neighbor) => neighbor.owner === team);
  }

  private refreshZoneVisuals(): void {
    for (const zone of this.zones) {
      const ownerColor = zone.owner === 'red' ? RED : zone.owner === 'green' ? GREEN : 0x8b897c;
      const meshMaterial = zone.mesh.material as THREE.MeshStandardMaterial;
      meshMaterial.color.setHex(ownerColor);
      meshMaterial.opacity = zone.owner === 'neutral' ? 0.36 : 0.52;
      const redCanAttack = this.canCaptureZone('red', zone);
      const greenCanAttack = this.canCaptureZone('green', zone);
      const isFrontline = redCanAttack || greenCanAttack;
      const borderMaterial = zone.border.material as THREE.LineBasicMaterial;
      borderMaterial.color.setHex(isFrontline ? GOLD : ownerColor);
      borderMaterial.opacity = isFrontline ? 1 : 0.58;
      const markerMaterial = zone.marker.material as THREE.MeshBasicMaterial;
      markerMaterial.color.setHex(isFrontline ? GOLD : ownerColor);
      markerMaterial.opacity = isFrontline ? 0.76 : 0.3;
      (zone.label.material as THREE.SpriteMaterial).opacity = isFrontline ? 1 : 0.68;
      const coreMaterial = zone.shrineCore.material as THREE.MeshStandardMaterial;
      coreMaterial.color.setHex(ownerColor);
      coreMaterial.emissive.setHex(ownerColor);
      coreMaterial.emissiveIntensity = isFrontline ? 1.15 : 0.5;
      (zone.shrineFlag.material as THREE.MeshBasicMaterial).color.setHex(ownerColor);
    }
  }

  private updateZones(dt: number): void {
    for (const zone of this.zones) {
      zone.shrineCore.rotation.y += dt * 0.9;
      const borderMaterial = zone.border.material as THREE.LineBasicMaterial;
      if (borderMaterial.opacity > 0.5) borderMaterial.opacity = 0.67 + Math.sin(this.elapsed * 4 + zone.x) * 0.2;
      const markerPulse = this.canCaptureZone('red', zone) || this.canCaptureZone('green', zone)
        ? 1 + Math.sin(this.elapsed * 4 + zone.z) * 0.13
        : 1;
      zone.marker.scale.setScalar(markerPulse);
      if (zone.rebuildTimer <= 0) continue;
      zone.rebuildTimer = Math.max(0, zone.rebuildTimer - dt);
      if (zone.rebuildTimer <= 0) zone.shrine.visible = true;
    }
  }

  private damageShrine(zone: Zone, attackingTeam: Team, damage: number, source: THREE.Vector3): boolean {
    if (zone.rebuildTimer > 0 || !this.canCaptureZone(attackingTeam, zone)) return false;
    zone.shrineHp -= damage;
    zone.shrine.scale.setScalar(0.94 + Math.max(0, zone.shrineHp / zone.maxShrineHp) * 0.06);
    if (zone.shrineHp > 0) return true;
    const formerColor = zone.owner === 'red' ? RED : zone.owner === 'green' ? GREEN : 0x8b897c;
    this.spawnBodyDebris(zone.shrine.position, formerColor, 7, zone.shrine.position.clone().sub(source).normalize());
    zone.owner = attackingTeam;
    zone.shrineHp = zone.maxShrineHp;
    zone.rebuildTimer = 0.72;
    zone.shrine.visible = false;
    zone.shrine.scale.setScalar(1);
    this.refreshZoneVisuals();
    this.addFeed(`${attackingTeam === 'red' ? 'RED' : 'GREEN'} CAPTURED ${zone.id}`, attackingTeam === 'red' ? 'good' : 'warning');
    return true;
  }

  private shrineNear(team: Team, x: number, z: number, range: number): Zone | undefined {
    let closest: Zone | undefined;
    let closestDistance = range;
    for (const zone of this.zones) {
      if (!this.canCaptureZone(team, zone)) continue;
      const distance = Math.hypot(zone.x - x, zone.z - z);
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = zone;
      }
    }
    return closest;
  }

  private createCastles(): void {
    this.createFort('red', RED_BASE_Z);
    this.createFort('green', GREEN_BASE_Z);
  }

  private createFort(team: Team, z: number): void {
    const color = team === 'red' ? 0xd94a43 : 0x4ead68;
    const stone = new THREE.MeshStandardMaterial({ color, roughness: 0.82 });
    const darkStone = new THREE.MeshStandardMaterial({ color: team === 'red' ? RED_DARK : GREEN_DARK, roughness: 0.9 });
    const roof = new THREE.MeshStandardMaterial({ color: team === 'red' ? 0xffbf65 : 0xd3edaf, roughness: 0.78 });
    const direction = team === 'red' ? 1 : -1;
    const rows: Array<[number, number, number, number, number, number, THREE.Material, number]> = [
      [0, 0.85, z, 8.4, 1.5, 1.1, stone, 104],
      [-6.2, 1.4, z, 1.8, 2.8, 1.8, darkStone, 88],
      [6.2, 1.4, z, 1.8, 2.8, 1.8, darkStone, 88],
      [0, 2.35, z, 3.3, 1.8, 1.8, stone, 115],
      [-2.5, 1.9, z + direction * 0.2, 1.7, 2.1, 1.6, stone, 74],
      [2.5, 1.9, z + direction * 0.2, 1.7, 2.1, 1.6, stone, 74],
    ];
    rows.forEach(([x, y, partZ, width, height, depth, material, hp]) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(x, y, partZ);
      this.arena.add(mesh);
      this.structures.push({ team, mesh, hp, maxHp: hp, radius: Math.max(width, depth) * 0.58, alive: true });
    });
    for (const x of [-6.2, 6.2, 0]) {
      const roofMesh = new THREE.Mesh(new THREE.ConeGeometry(x === 0 ? 2.35 : 1.28, x === 0 ? 1.55 : 1.12, 4), roof);
      roofMesh.position.set(x, x === 0 ? 4.1 : 3.48, z);
      roofMesh.rotation.y = Math.PI / 4;
      roofMesh.castShadow = true;
      this.arena.add(roofMesh);
      this.structures.push({ team, mesh: roofMesh, hp: 48, maxHp: 48, radius: 1.45, alive: true });
    }
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.65, 0.86), new THREE.MeshBasicMaterial({ color: team === 'red' ? 0xff6653 : 0x8def81, side: THREE.DoubleSide }));
    flag.position.set(0.85, 5.25, z);
    this.arena.add(flag);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 8), this.gray);
    mast.position.set(0, 4.65, z);
    mast.castShadow = true;
    this.arena.add(mast);
  }

  private createCannon(): void {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.05, 0.42, 12), this.gray);
    base.position.set(0, 0.3, -36.2);
    base.castShadow = true;
    this.arena.add(base);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 2.9, 10), this.shellMaterial);
    barrel.rotation.x = Math.PI / 2.65;
    barrel.position.set(0, 1.34, -35.35);
    barrel.castShadow = true;
    this.arena.add(barrel);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.08, 8, 16), new THREE.MeshStandardMaterial({ color: GOLD, emissive: 0x734112, emissiveIntensity: 0.7 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 0.17, -36.2);
    this.arena.add(ring);
  }

  private createCommander(): void {
    const body = new THREE.Mesh(this.unitBody, this.friendlyBody);
    body.position.y = 0.9;
    body.scale.set(1.42, 1.02, 1.2);
    body.castShadow = true;
    this.player.add(body);

    const head = new THREE.Mesh(this.unitHead, this.friendlyTrim);
    head.position.y = 1.58;
    head.scale.setScalar(1.08);
    head.castShadow = true;
    this.player.add(head);

    const helmet = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.18, 10), this.friendlyBody);
    helmet.position.y = 1.94;
    helmet.castShadow = true;
    this.player.add(helmet);

    for (const eyeX of [-0.14, 0.14]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.04), this.faceMaterial);
      eye.position.set(eyeX, 1.59, 0.37);
      this.player.add(eye);
    }

    for (const sign of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.34, 0.2), this.gray);
      leg.position.set(sign * 0.18, 0.3, 0);
      leg.castShadow = true;
      this.player.add(leg);
      this.playerLimbs.push(leg);

      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.46, 0.18), this.friendlyBody);
      arm.position.set(sign * 0.5, 0.92, 0);
      arm.rotation.z = sign * 0.2;
      arm.castShadow = true;
      this.player.add(arm);
      this.playerLimbs.push(arm);
    }

    const bannerPole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.2, 8), this.gray);
    bannerPole.position.set(0.55, 2.35, 0);
    bannerPole.castShadow = true;
    this.player.add(bannerPole);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.42), new THREE.MeshBasicMaterial({ color: GOLD, side: THREE.DoubleSide }));
    banner.position.set(0.9, 2.88, 0);
    banner.rotation.y = Math.PI / 2;
    this.player.add(banner);

    const selectionRing = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.84, 24), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    selectionRing.rotation.x = -Math.PI / 2;
    selectionRing.position.y = 0.08;
    this.player.add(selectionRing);

    const commanderMarker = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.42, 4), new THREE.MeshBasicMaterial({ color: GOLD }));
    commanderMarker.position.set(0, 3.55, 0);
    commanderMarker.rotation.z = Math.PI;
    this.player.add(commanderMarker);

    const tagCanvas = document.createElement('canvas');
    tagCanvas.width = 256;
    tagCanvas.height = 64;
    const tagContext = tagCanvas.getContext('2d')!;
    tagContext.font = '900 28px system-ui';
    tagContext.textAlign = 'center';
    tagContext.fillStyle = '#fff0a8';
    tagContext.fillText('YOU', 128, 38);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(tagCanvas), transparent: true, depthTest: false }));
    tag.position.set(0, 4.05, 0);
    tag.scale.set(2.5, 0.62, 1);
    tag.renderOrder = 10;
    this.player.add(tag);
    this.player.add(new THREE.PointLight(GOLD, 1.1, 5.5, 2));

    this.player.position.set(0, 0.04, -33);
    this.player.rotation.y = 0;
    this.redForce.add(this.player);
  }

  private seedArmy(team: Team, count: number): void {
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / 9);
      const col = (i % 9) - 4;
      const x = col * 1.32 + (Math.random() - 0.5) * 0.42;
      const baseZ = team === 'red' ? -34 : 34;
      this.spawnUnit(team, x, baseZ + (team === 'red' ? -row * 0.9 : row * 0.9));
    }
  }

  private spawnUnit(team: Team, x: number, z: number): void {
    const group = new THREE.Group();
    const limbs: THREE.Object3D[] = [];
    const bodyMaterial = team === 'red' ? this.friendlyBody : this.enemyBody;
    const trimMaterial = team === 'red' ? this.friendlyTrim : this.enemyTrim;
    const body = new THREE.Mesh(this.unitBody, bodyMaterial);
    body.position.y = 0.72;
    body.scale.set(1.13, 0.8, 1.02);
    body.castShadow = true;
    group.add(body);
    const head = new THREE.Mesh(this.unitHead, trimMaterial);
    head.position.y = 1.22;
    head.castShadow = true;
    group.add(head);
    const helmet = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.39, 0.14, 10), bodyMaterial);
    helmet.position.y = 1.49;
    helmet.castShadow = true;
    group.add(helmet);
    for (const eyeX of [-0.12, 0.12]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.075, 0.035), this.faceMaterial);
      eye.position.set(eyeX, 1.24, 0.337);
      group.add(eye);
    }
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.035, 0.04), this.faceMaterial);
    brow.position.set(0, 1.35, 0.336);
    brow.rotation.z = team === 'green' ? 0.14 : -0.07;
    group.add(brow);
    for (const sign of [-1, 1]) {
      const leg = new THREE.Mesh(this.unitLeg, this.gray);
      leg.position.set(sign * 0.15, 0.19, 0);
      leg.castShadow = true;
      group.add(leg);
      limbs.push(leg);
      const arm = new THREE.Mesh(this.unitArm, bodyMaterial);
      arm.position.set(sign * 0.39, 0.74, 0);
      arm.rotation.z = sign * 0.16;
      arm.castShadow = true;
      group.add(arm);
      limbs.push(arm);
    }
    const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.62), this.gray);
    rifle.position.set(0.3, 0.77, team === 'red' ? 0.17 : -0.17);
    rifle.rotation.x = Math.PI / 7;
    group.add(rifle);
    group.position.set(x, 0, z);
    group.rotation.y = team === 'red' ? 0 : Math.PI;
    this[team === 'red' ? 'redForce' : 'greenForce'].add(group);
    this.units.push({
      team, group, limbs, hp: 100, maxHp: 100, speed: 1.05 + Math.random() * 0.45,
      cooldown: Math.random(), hitFlash: 0, phase: Math.random() * Math.PI * 2,
      alive: true, x, z, knockX: 0, knockZ: 0,
      ragdollTimer: 0, recoveryTimer: 0, corpseTimer: 0,
      velocity: new THREE.Vector3(), spin: new THREE.Vector3(),
    });
  }

  private updateCommander(dt: number): void {
    const horizontal = (this.playerKeys.has('KeyD') ? 1 : 0) - (this.playerKeys.has('KeyA') ? 1 : 0);
    const vertical = (this.playerKeys.has('KeyW') ? 1 : 0) - (this.playerKeys.has('KeyS') ? 1 : 0);
    // Read the camera's rendered direction, not the orbit math, so W is always
    // literally toward the top of the screen and A/D follow screen left/right.
    this.camera.getWorldDirection(this.cameraForward);
    this.cameraForward.y = 0;
    this.cameraForward.normalize();
    this.cameraRight.crossVectors(this.cameraForward, this.camera.up).normalize();
    this.playerMove.copy(this.cameraForward).multiplyScalar(vertical).addScaledVector(this.cameraRight, horizontal);
    const moving = this.playerMove.lengthSq() > 0;
    if (moving) {
      this.playerMove.normalize();
      const speed = this.playerKeys.has('ShiftLeft') || this.playerKeys.has('ShiftRight') ? 8.5 : 5.8;
      this.player.position.addScaledVector(this.playerMove, speed * dt);
      this.player.rotation.y = Math.atan2(this.playerMove.x, this.playerMove.z);
    }
    this.player.position.x = THREE.MathUtils.clamp(this.player.position.x, -ARENA_HALF_WIDTH + 1.2, ARENA_HALF_WIDTH - 1.2);
    this.player.position.z = THREE.MathUtils.clamp(this.player.position.z, -ARENA_HALF_LENGTH + 1.2, ARENA_HALF_LENGTH - 1.2);
    this.player.position.y = 0.04 + (moving ? Math.sin(this.elapsed * 11) * 0.035 : 0);
    this.playerLimbs.forEach((limb, index) => {
      limb.rotation.x = moving ? Math.sin(this.elapsed * 11 + index * Math.PI) * 0.5 : THREE.MathUtils.damp(limb.rotation.x, 0, 15, dt);
    });

    // Camera orbit is independent from commander facing: movement never twists the view.
    const distance = 17;
    const horizontalDistance = Math.cos(this.cameraPitch) * distance;
    const followOffset = new THREE.Vector3(
      Math.sin(this.cameraYaw) * horizontalDistance,
      Math.sin(this.cameraPitch) * distance,
      -Math.cos(this.cameraYaw) * horizontalDistance,
    );
    this.playerTarget.copy(this.player.position).add(new THREE.Vector3(0, 1.55, 0));
    this.camera.position.lerp(this.player.position.clone().add(followOffset), 1 - Math.pow(0.0005, dt));
    this.camera.lookAt(this.playerTarget);
  }

  private bindUi(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-ability]').forEach((button) => {
      button.addEventListener('click', () => {
        this.ability = button.dataset.ability as Ability;
        this.root.querySelectorAll('[data-ability]').forEach((item) => item.classList.toggle('selected', item === button));
        this.addFeed(this.ability === 'shell' ? 'HOWITZER SELECTED' : 'FIRE ROCKET SELECTED', 'system');
      });
    });
    this.root.querySelector<HTMLButtonElement>('[data-summon]')!.addEventListener('click', () => this.deploySquad());
    this.root.querySelector<HTMLButtonElement>('[data-speed]')!.addEventListener('click', () => {
      this.speed = this.speed === 1 ? 2 : 1;
      this.root.querySelector<HTMLButtonElement>('[data-speed]')!.textContent = `${this.speed}×`;
      this.addFeed(this.speed === 2 ? 'BATTLE SPEED ×2' : 'BATTLE SPEED ×1', 'system');
    });
    this.root.querySelector<HTMLButtonElement>('[data-sound]')!.addEventListener('click', () => {
      this.soundEnabled = !this.soundEnabled;
      const button = this.root.querySelector<HTMLButtonElement>('[data-sound]')!;
      button.textContent = this.soundEnabled ? '🔊' : '🔇';
      button.title = this.soundEnabled ? 'Mute sound' : 'Enable sound';
      button.setAttribute('aria-label', button.title);
      this.addFeed(this.soundEnabled ? 'SOUND ENABLED' : 'SOUND MUTED', 'system');
      if (this.soundEnabled) this.playSound('summon', 0.04);
    });
    this.root.querySelector<HTMLButtonElement>('[data-restart]')!.addEventListener('click', () => location.reload());
    addEventListener('keydown', (event) => {
      if (event.key === '1') this.selectAbility('shell');
      if (event.key === '2') this.selectAbility('rocket');
      if (event.key.toLowerCase() === 'q') this.deploySquad();
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
        const remap: Record<string, string> = { ArrowUp: 'KeyW', ArrowDown: 'KeyS', ArrowLeft: 'KeyA', ArrowRight: 'KeyD' };
        this.playerKeys.add(remap[event.code] ?? event.code);
        event.preventDefault();
      }
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') this.playerKeys.add(event.code);
    });
    addEventListener('keyup', (event) => {
      const remap: Record<string, string> = { ArrowUp: 'KeyW', ArrowDown: 'KeyS', ArrowLeft: 'KeyA', ArrowRight: 'KeyD' };
      this.playerKeys.delete(remap[event.code] ?? event.code);
    });
  }

  private selectAbility(ability: Ability): void {
    this.ability = ability;
    this.root.querySelectorAll<HTMLElement>('[data-ability]').forEach((item) => item.classList.toggle('selected', item.dataset.ability === ability));
  }

  private pointerToGround(event: PointerEvent, output: THREE.Vector3): boolean {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.ground, output)) return false;
    return Math.abs(output.x) <= ARENA_HALF_WIDTH && Math.abs(output.z) <= ARENA_HALF_LENGTH;
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.button === 1) {
      event.preventDefault();
      this.rotatingCamera = true;
      this.lastPointer.set(event.clientX, event.clientY);
      this.renderer.domElement.setPointerCapture(event.pointerId);
      return;
    }
    if (this.stopped || event.button !== 0 || !this.pointerToGround(event, this.aimPoint)) return;
    this.aimingAbility = true;
    this.aimIndicator.visible = true;
    this.aimIndicator.position.copy(this.aimPoint).setY(0.12);
    this.renderer.domElement.setPointerCapture(event.pointerId);
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.rotatingCamera) {
      const dx = event.clientX - this.lastPointer.x;
      const dy = event.clientY - this.lastPointer.y;
      this.lastPointer.set(event.clientX, event.clientY);
      // Standard third-person mouse look: right drag turns right, upward drag looks up.
      this.cameraYaw -= dx * 0.008;
      this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch + dy * 0.007, 0.43, 1.16);
      return;
    }
    if (!this.aimingAbility || !this.pointerToGround(event, this.aimPoint)) return;
    this.aimIndicator.position.copy(this.aimPoint).setY(0.12);
  }

  private onPointerUp(event: PointerEvent): void {
    if (event.button === 1) this.rotatingCamera = false;
    if (event.button !== 0 || !this.aimingAbility) return;
    this.aimingAbility = false;
    this.aimIndicator.visible = false;
    if (this.pointerToGround(event, this.aimPoint)) this.fireAtTarget(this.aimPoint);
  }

  private selectAbilityFromWheel(event: WheelEvent): void {
    event.preventDefault();
    const next = event.deltaY > 0 ? 'rocket' : 'shell';
    if (next === this.ability) return;
    this.selectAbility(next);
    this.addFeed(next === 'rocket' ? 'FIRE ROCKET SELECTED' : 'HOWITZER SELECTED', 'system');
  }

  private fireAtTarget(target: THREE.Vector3): void {
    if (this.stopped) return;
    if (this.ability === 'rocket') {
      if (this.supplies < 22 || this.rocketCooldown > 0) {
        this.addFeed(this.rocketCooldown > 0 ? 'ROCKET RELOADING' : 'NEED 22 COMMAND POINTS', 'warning');
        return;
      }
      this.supplies -= 22;
      this.rocketCooldown = 2.7;
      this.launchProjectile(target, 'rocket');
      this.addFeed('FIRE ROCKET AWAY!', 'good');
    } else {
      this.launchProjectile(target, 'shell');
    }
  }

  private launchProjectile(target: THREE.Vector3, kind: Ability): void {
    const mesh = new THREE.Mesh(kind === 'rocket' ? new THREE.ConeGeometry(0.23, 1.1, 8) : this.shellGeometry, kind === 'rocket' ? this.rocketMaterial : this.shellMaterial);
    mesh.castShadow = true;
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.45, 16), new THREE.MeshBasicMaterial({ color: 0x101418, transparent: true, opacity: 0.18, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    this.scene.add(mesh, shadow);
    const start = this.player.position.clone().add(new THREE.Vector3(0, 2.05, 0.65).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.player.rotation.y));
    const distance = start.distanceTo(target);
    this.projectiles.push({ mesh, shadow, start, target: target.clone(), elapsed: 0, duration: Math.max(0.48, distance / (kind === 'rocket' ? 31 : 22)), power: kind === 'rocket' ? 112 : 64, radius: kind === 'rocket' ? 4.8 : 3.05, kind });
    this.playSound(kind === 'rocket' ? 'rocket' : 'shot');
  }

  private deploySquad(): void {
    if (this.stopped) return;
    if (this.supplies < 35 || this.summonCooldown > 0) {
      this.addFeed(this.summonCooldown > 0 ? 'DROPSHIP EN ROUTE' : 'NEED 35 COMMAND POINTS', 'warning');
      return;
    }
    this.supplies -= 35;
    this.summonCooldown = 5;
    for (let i = 0; i < 12; i++) {
      setTimeout(() => {
        if (!this.stopped) this.spawnUnit('red', ((i % 6) - 2.5) * 1.2 + (Math.random() - 0.5) * 0.35, -35.4 - Math.floor(i / 6) * 0.65);
      }, i * 65);
    }
    this.addFeed('SQUAD DEPLOYED +12', 'good');
    this.playSound('summon');
  }

  private updateUnits(dt: number): void {
    const friendlies = this.units.filter((unit) => this.isCombatReady(unit) && unit.team === 'red');
    const enemies = this.units.filter((unit) => this.isCombatReady(unit) && unit.team === 'green');
    for (const unit of this.units) {
      if (unit.ragdollTimer > 0 || !unit.alive) {
        this.updateRagdoll(unit, dt);
        continue;
      }
      if (unit.recoveryTimer > 0) {
        unit.recoveryTimer = Math.max(0, unit.recoveryTimer - dt);
        const getUp = 1 - unit.recoveryTimer / 0.34;
        unit.group.position.y = THREE.MathUtils.lerp(unit.group.position.y, 0.03, getUp * 0.3);
        unit.group.rotation.x = THREE.MathUtils.damp(unit.group.rotation.x, 0, 14, dt);
        unit.group.rotation.z = THREE.MathUtils.damp(unit.group.rotation.z, 0, 14, dt);
        unit.group.rotation.y = THREE.MathUtils.damp(unit.group.rotation.y, unit.team === 'red' ? 0 : Math.PI, 14, dt);
        unit.limbs.forEach((limb) => { limb.rotation.x = THREE.MathUtils.damp(limb.rotation.x, 0, 14, dt); });
        continue;
      }
      unit.cooldown = Math.max(0, unit.cooldown - dt);
      unit.hitFlash = Math.max(0, unit.hitFlash - dt * 3.6);
      const enemiesForUnit = unit.team === 'red' ? enemies : friendlies;
      let target: Unit | undefined;
      let closest = 2.0;
      for (const candidate of enemiesForUnit) {
        const distanceSq = (candidate.x - unit.x) ** 2 + (candidate.z - unit.z) ** 2;
        if (distanceSq < closest * closest) {
          closest = Math.sqrt(distanceSq);
          target = candidate;
        }
      }
      const direction = unit.team === 'red' ? 1 : -1;
      if (target) {
        const dx = target.x - unit.x;
        const dz = target.z - unit.z;
        if (unit.cooldown <= 0) {
          this.damageUnit(target, 8 + Math.random() * 6, unit.x, unit.z, direction * 2.1);
          unit.cooldown = 0.55 + Math.random() * 0.26;
          this.playSound('hit', 0.045);
        }
        unit.knockX += Math.sign(-dx) * dt * 0.2;
        unit.knockZ += Math.sign(-dz) * dt * 0.2;
      } else {
        const shrine = this.shrineNear(unit.team, unit.x, unit.z, 2.1);
        if (shrine) {
          if (unit.cooldown <= 0) {
            this.damageShrine(shrine, unit.team, 7.5, new THREE.Vector3(unit.x, 0, unit.z));
            unit.cooldown = 0.62;
            this.playSound('hit', 0.05);
          }
        } else {
          const castleZ = unit.team === 'red' ? GREEN_BASE_Z : RED_BASE_Z;
          if (Math.abs(unit.z - castleZ) < 3.6) {
            const health = unit.team === 'red' ? this.greenCastleHealth : this.redCastleHealth;
            if (unit.cooldown <= 0) {
              health.value = Math.max(0, health.value - 3.3);
              this.damageNearestStructure(unit.team === 'red' ? 'green' : 'red', unit.x, castleZ, 4.5);
              unit.cooldown = 0.62;
              this.playSound('hit', 0.05);
            }
          } else {
            unit.z += direction * unit.speed * dt;
          }
        }
      }
      unit.x += unit.knockX * dt;
      unit.z += unit.knockZ * dt;
      unit.knockX *= Math.pow(0.002, dt);
      unit.knockZ *= Math.pow(0.002, dt);
      unit.x = THREE.MathUtils.clamp(unit.x, -ARENA_HALF_WIDTH + 1.2, ARENA_HALF_WIDTH - 1.2);
      unit.group.position.set(unit.x, 0.03 + Math.sin(this.elapsed * 4.4 + unit.phase) * 0.025, unit.z);
      const moving = !target && Math.abs(unit.z - (unit.team === 'red' ? GREEN_BASE_Z : RED_BASE_Z)) >= 3.6;
      unit.group.rotation.y = unit.team === 'red' ? 0 : Math.PI;
      unit.limbs.forEach((limb, index) => {
        limb.rotation.x = moving ? Math.sin(this.elapsed * 8 + unit.phase + index) * 0.56 : 0;
      });
    }
    this.units.splice(0, this.units.length, ...this.units.filter((unit) => unit.alive || unit.corpseTimer > 0));
  }

  private isCombatReady(unit: Unit): boolean {
    return unit.alive && unit.ragdollTimer <= 0 && unit.recoveryTimer <= 0;
  }

  /**
   * A light-weight ragdoll approximation: the whole toy soldier is launched,
   * bounces against the ground, spins, and flails its limbs. This keeps the
   * huge troop counts cheap while still giving explosions a physical result.
   */
  private toppleUnit(unit: Unit, directionX: number, directionZ: number, force: number, fatal: boolean): void {
    const directionLength = Math.hypot(directionX, directionZ) || 1;
    const launch = Math.max(2.4, force * (fatal ? 1.18 : 0.84));
    unit.velocity.set(
      (directionX / directionLength) * launch + (Math.random() - 0.5) * 2.1,
      2.25 + Math.min(4.6, launch * 0.58),
      (directionZ / directionLength) * launch + (Math.random() - 0.5) * 2.1,
    );
    unit.spin.set(
      (Math.random() - 0.5) * 15,
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 15,
    );
    unit.ragdollTimer = fatal ? 1.65 : THREE.MathUtils.clamp(0.7 + force * 0.1, 0.85, 1.45);
    unit.recoveryTimer = fatal ? 0 : 0.34;
    if (fatal) unit.corpseTimer = 4.1;
    unit.limbs.forEach((limb, index) => {
      limb.rotation.x = (Math.random() - 0.5) * 2.4 + index * 0.18;
      limb.rotation.z = (Math.random() - 0.5) * 1.5;
    });
  }

  private updateRagdoll(unit: Unit, dt: number): void {
    if (unit.ragdollTimer > 0) {
      unit.ragdollTimer = Math.max(0, unit.ragdollTimer - dt);
      unit.velocity.y -= 13 * dt;
      unit.group.position.addScaledVector(unit.velocity, dt);
      unit.x = unit.group.position.x;
      unit.z = unit.group.position.z;
      if (unit.group.position.y < 0.04) {
        unit.group.position.y = 0.04;
        unit.velocity.y *= -0.26;
        unit.velocity.x *= 0.79;
        unit.velocity.z *= 0.79;
      }
      unit.group.rotation.x += unit.spin.x * dt;
      unit.group.rotation.y += unit.spin.y * dt;
      unit.group.rotation.z += unit.spin.z * dt;
      unit.spin.multiplyScalar(Math.pow(0.014, dt));
      unit.limbs.forEach((limb, index) => {
        limb.rotation.x += Math.sin(this.elapsed * 17 + index * 2.1) * dt * 2.6;
        limb.rotation.z += Math.cos(this.elapsed * 14 + index * 1.7) * dt * 1.4;
      });
    }
    if (unit.alive && unit.ragdollTimer <= 0) {
      unit.velocity.set(0, 0, 0);
      unit.recoveryTimer = Math.max(unit.recoveryTimer, 0.34);
      return;
    }
    if (!unit.alive) {
      unit.corpseTimer -= dt;
      if (unit.corpseTimer <= 0) unit.group.removeFromParent();
    }
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      projectile.elapsed += dt;
      const t = Math.min(1, projectile.elapsed / projectile.duration);
      const height = (projectile.kind === 'rocket' ? 3.5 : 6.8) * Math.sin(Math.PI * t);
      projectile.mesh.position.lerpVectors(projectile.start, projectile.target, t);
      projectile.mesh.position.y += height;
      projectile.mesh.rotation.x += dt * 15;
      projectile.mesh.rotation.z += dt * 7;
      if (projectile.kind === 'rocket') projectile.mesh.lookAt(projectile.target.x, projectile.target.y + 0.1, projectile.target.z);
      projectile.shadow.position.set(projectile.mesh.position.x, 0.04, projectile.mesh.position.z);
      projectile.shadow.scale.setScalar(0.55 + height * 0.13);
      (projectile.shadow.material as THREE.MeshBasicMaterial).opacity = 0.2 * (1 - t * 0.3);
      if (Math.floor(projectile.elapsed * 24) > this.trailDots.length % 24 && projectile.kind === 'rocket') this.createTrail(projectile.mesh.position);
      if (t >= 1) {
        this.explode(projectile.target, projectile.radius, projectile.power, projectile.kind);
        this.scene.remove(projectile.mesh, projectile.shadow);
        projectile.mesh.geometry.dispose();
        this.projectiles.splice(i, 1);
      }
    }
  }

  private createTrail(position: THREE.Vector3): void {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.75, depthWrite: false }));
    dot.position.copy(position);
    this.scene.add(dot);
    this.trailDots.push(dot);
    if (this.trailDots.length > 28) {
      const old = this.trailDots.shift();
      if (old) this.scene.remove(old);
    }
  }

  private explode(point: THREE.Vector3, radius: number, power: number, kind: Ability): void {
    const blastColor = kind === 'rocket' ? 0xff6b2d : 0xffc452;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.34, 32), new THREE.MeshBasicMaterial({ color: blastColor, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(point).setY(0.09);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffedb0, transparent: true, opacity: 0.95 }));
    core.position.copy(point).setY(0.48);
    this.scene.add(ring, core);
    this.blasts.push({ ring, core, life: 0, maxLife: kind === 'rocket' ? 0.74 : 0.5 });
    let kills = 0;
    for (const unit of [...this.units]) {
      if (!unit.alive) continue;
      // This is a command-game power, not a friendly-fire simulation. It keeps
      // the click-to-bomb loop satisfying even when both sides meet at the line.
      if (unit.team === 'red') continue;
      const dx = unit.x - point.x;
      const dz = unit.z - point.z;
      const distance = Math.hypot(dx, dz);
      if (distance > radius) continue;
      const damage = power * (1 - distance / radius) + 12;
      if (this.damageUnit(unit, damage, point.x, point.z, 3.8)) kills++;
    }
    for (const zone of this.zones) {
      const distance = Math.hypot(zone.x - point.x, zone.z - point.z);
      if (distance < radius + 1.15) this.damageShrine(zone, 'red', power * (1 - Math.min(1, distance / (radius + 1.15))), point);
    }
    for (const structure of this.structures) {
      if (!structure.alive) continue;
      const dx = structure.mesh.position.x - point.x;
      const dz = structure.mesh.position.z - point.z;
      const distance = Math.hypot(dx, dz);
      if (distance < radius + structure.radius) this.damageStructure(structure, power * 0.74 * (1 - Math.min(1, distance / (radius + structure.radius))), point);
    }
    if (kills > 0) {
      this.kills += kills;
      this.supplies = Math.min(99, this.supplies + kills * 2);
      this.addFeed(`${kills} UNIT${kills > 1 ? 'S' : ''} ELIMINATED  +${kills * 2}`, 'kill');
    } else this.addFeed('IMPACT CONFIRMED', 'good');
    this.playSound('boom');
  }

  private damageUnit(unit: Unit, damage: number, sourceX: number, sourceZ: number, force: number): boolean {
    if (!unit.alive) return false;
    unit.hp -= damage;
    unit.hitFlash = 0.7;
    const dx = unit.x - sourceX;
    const dz = unit.z - sourceZ;
    const length = Math.hypot(dx, dz) || 1;
    unit.knockX += (dx / length) * force * (damage / 70);
    unit.knockZ += (dz / length) * force * (damage / 70);
    const fatal = unit.hp <= 0;
    // Small rifle hits only stagger. Heavy blast damage sends the entire
    // cartoon body airborne; living enemies recover and rejoin the advance.
    if (fatal || force >= 3) this.toppleUnit(unit, dx, dz, force + damage / 36, fatal);
    if (!fatal) return false;
    unit.alive = false;
    return true;
  }

  private damageNearestStructure(team: Team, x: number, z: number, range: number): void {
    let target: StructurePart | undefined;
    let closest = range;
    for (const part of this.structures) {
      if (!part.alive || part.team !== team) continue;
      const distance = Math.hypot(part.mesh.position.x - x, part.mesh.position.z - z);
      if (distance < closest) { closest = distance; target = part; }
    }
    if (target) this.damageStructure(target, 3.2, new THREE.Vector3(x, 0, z));
  }

  private damageStructure(part: StructurePart, damage: number, source: THREE.Vector3): void {
    if (!part.alive || damage <= 0) return;
    part.hp -= damage;
    const shake = Math.min(0.16, damage / 360);
    part.mesh.position.x += (Math.random() - 0.5) * shake;
    part.mesh.rotation.z += (Math.random() - 0.5) * shake;
    const castle = part.team === 'red' ? this.redCastleHealth : this.greenCastleHealth;
    castle.value = Math.max(0, castle.value - damage * 0.48);
    if (part.hp > 0) return;
    part.alive = false;
    const position = part.mesh.position.clone();
    const color = (part.mesh.material as THREE.MeshStandardMaterial).color.getHex();
    part.mesh.removeFromParent();
    this.spawnBodyDebris(position, color, 5, position.clone().sub(source).normalize());
    this.addFeed(part.team === 'green' ? 'ENEMY STRUCTURE DOWN' : 'CITADEL BREACH', part.team === 'green' ? 'good' : 'warning');
  }

  private spawnBodyDebris(position: THREE.Vector3, color: number, count: number, direction: THREE.Vector3): void {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.debrisGeometry, new THREE.MeshStandardMaterial({ color, roughness: 0.86 }));
      mesh.position.copy(position).add(new THREE.Vector3((Math.random() - 0.5) * 0.45, Math.random() * 0.55, (Math.random() - 0.5) * 0.45));
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.debris.push({ mesh, velocity: direction.clone().multiplyScalar(1.2 + Math.random() * 3.2).add(new THREE.Vector3((Math.random() - 0.5) * 2.3, 2 + Math.random() * 4, (Math.random() - 0.5) * 2.3)), spin: new THREE.Vector3(Math.random() * 11, Math.random() * 11, Math.random() * 11), life: 3.4 + Math.random() * 1.4 });
    }
  }

  private updateEffects(dt: number): void {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const debris = this.debris[i];
      debris.life -= dt;
      debris.velocity.y -= 14 * dt;
      debris.mesh.position.addScaledVector(debris.velocity, dt);
      debris.mesh.rotation.x += debris.spin.x * dt;
      debris.mesh.rotation.y += debris.spin.y * dt;
      if (debris.mesh.position.y < 0.23) {
        debris.mesh.position.y = 0.23;
        debris.velocity.y *= -0.27;
        debris.velocity.x *= 0.73;
        debris.velocity.z *= 0.73;
      }
      if (debris.life <= 0) {
        this.scene.remove(debris.mesh);
        (debris.mesh.material as THREE.Material).dispose();
        this.debris.splice(i, 1);
      }
    }
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const blast = this.blasts[i];
      blast.life += dt;
      const ratio = blast.life / blast.maxLife;
      blast.ring.scale.setScalar(1 + ratio * 20);
      (blast.ring.material as THREE.MeshBasicMaterial).opacity = (1 - ratio) * 0.92;
      blast.core.scale.setScalar(1 + ratio * 6);
      (blast.core.material as THREE.MeshBasicMaterial).opacity = (1 - ratio) * 0.78;
      if (ratio >= 1) {
        this.scene.remove(blast.ring, blast.core);
        blast.ring.geometry.dispose();
        blast.core.geometry.dispose();
        this.blasts.splice(i, 1);
      }
    }
    for (let i = this.trailDots.length - 1; i >= 0; i--) {
      const dot = this.trailDots[i];
      dot.scale.multiplyScalar(0.94);
      (dot.material as THREE.MeshBasicMaterial).opacity *= 0.9;
      if (dot.scale.x < 0.18) {
        this.scene.remove(dot);
        dot.geometry.dispose();
        (dot.material as THREE.Material).dispose();
        this.trailDots.splice(i, 1);
      }
    }
  }

  private updateEnemySpawns(dt: number): void {
    this.enemySpawnTimer -= dt;
    if (this.enemySpawnTimer > 0) return;
    const enemies = this.units.filter((unit) => unit.alive && unit.team === 'green').length;
    if (enemies < 65 + this.wave * 5) {
      const count = Math.min(5, 1 + Math.floor(this.wave / 2));
      for (let i = 0; i < count; i++) this.spawnUnit('green', (Math.random() - 0.5) * 20, 35.4 + Math.random() * 1.4);
      this.addFeed('ENEMY REINFORCEMENTS', 'warning');
    }
    this.enemySpawnTimer = Math.max(2.6, 5.3 - this.wave * 0.17);
    if (this.elapsed > this.wave * 19) {
      this.wave++;
      this.addFeed(`WAVE ${String(this.wave).padStart(2, '0')} INCOMING`, 'kill');
    }
  }

  private updateFrontline(dt: number): void {
    this.updateZones(dt);
  }

  private updateHud(dt: number): void {
    this.supplies = Math.min(99, this.supplies + dt * 3);
    this.rocketCooldown = Math.max(0, this.rocketCooldown - dt);
    this.summonCooldown = Math.max(0, this.summonCooldown - dt);
    this.root.querySelector<HTMLElement>('[data-supplies]')!.textContent = String(Math.floor(this.supplies)).padStart(3, '0');
    this.root.querySelector<HTMLElement>('[data-wave]')!.textContent = String(this.wave).padStart(2, '0');
    this.root.querySelector<HTMLElement>('[data-enemy-health]')!.textContent = String(Math.ceil(this.greenCastleHealth.value));
    this.root.querySelector<HTMLElement>('[data-friendly-health]')!.textContent = String(Math.ceil(this.redCastleHealth.value));
    (this.root.querySelector<HTMLElement>('[data-enemy-bar]')!).style.width = `${(this.greenCastleHealth.value / this.greenCastleHealth.max) * 100}%`;
    (this.root.querySelector<HTMLElement>('[data-friendly-bar]')!).style.width = `${(this.redCastleHealth.value / this.redCastleHealth.max) * 100}%`;
    const summon = this.root.querySelector<HTMLButtonElement>('[data-summon]')!;
    summon.classList.toggle('disabled', this.supplies < 35 || this.summonCooldown > 0);
    this.root.querySelector<HTMLButtonElement>('[data-ability="rocket"]')!.classList.toggle('disabled', this.supplies < 22 || this.rocketCooldown > 0);
  }

  private addFeed(message: string, type: 'system' | 'good' | 'warning' | 'kill'): void {
    const line = document.createElement('div');
    line.className = `feed-line ${type}`;
    line.textContent = message;
    this.feed.prepend(line);
    while (this.feed.children.length > 4) this.feed.lastElementChild?.remove();
    setTimeout(() => line.classList.add('out'), 2200);
    setTimeout(() => line.remove(), 2750);
  }

  private checkResult(): void {
    if (this.stopped || (this.greenCastleHealth.value > 0 && this.redCastleHealth.value > 0)) return;
    this.stopped = true;
    const win = this.greenCastleHealth.value <= 0;
    const panel = this.root.querySelector<HTMLElement>('[data-result]')!;
    panel.hidden = false;
    this.root.querySelector<HTMLElement>('[data-result-kicker]')!.textContent = win ? 'MISSION COMPLETE' : 'FRONTLINE COLLAPSED';
    this.root.querySelector<HTMLElement>('[data-result-title]')!.textContent = win ? 'THE CITADEL FALLS' : 'THE LINE BROKE';
    this.root.querySelector<HTMLElement>('[data-result-copy]')!.textContent = win ? `${this.kills} hostile units eliminated. The siege is yours.` : 'Reinforce your line and use artillery before the enemy reaches your fortress.';
    this.playSound(win ? 'win' : 'lose');
  }

  private resize(): void {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  private playSound(kind: 'shot' | 'rocket' | 'boom' | 'hit' | 'summon' | 'win' | 'lose', volume = 0.12): void {
    if (!this.soundEnabled) return;
    try {
      this.audioContext ??= new AudioContext();
      const context = this.audioContext;
      if (context.state === 'suspended') void context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      const profiles = {
        shot: [110, 42, 0.11], rocket: [180, 76, 0.18], boom: [72, 28, 0.28], hit: [210, 115, 0.06], summon: [320, 650, 0.18], win: [360, 760, 0.42], lose: [210, 65, 0.48],
      } as const;
      const [start, end, duration] = profiles[kind];
      oscillator.type = kind === 'hit' ? 'square' : kind === 'summon' || kind === 'win' ? 'sine' : 'triangle';
      oscillator.frequency.setValueAtTime(start, now);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(12, end), now + duration);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + duration);
    } catch { /* Audio is optional and requires a browser gesture. */ }
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.05) * this.speed;
    if (!this.stopped) {
      this.elapsed += dt;
      this.updateCommander(dt);
      this.updateUnits(dt);
      this.updateProjectiles(dt);
      this.updateEffects(dt);
      this.updateEnemySpawns(dt);
      this.updateFrontline(dt);
      this.updateHud(dt);
      this.checkResult();
    } else this.updateEffects(dt);
    this.renderer.render(this.scene, this.camera);
  };
}

new FrontlineGame(app);
