import * as THREE from 'three';
import { PhysicsWorld } from '../../src/game/PhysicsWorld';
import { CHARACTER_TEXTURE_PATHS } from '../../src/game/CharacterVisuals';
import type { Character, CharacterKind } from '../../src/game/types';

const CHARACTER_KINDS: readonly CharacterKind[] = [
  'human',
  'worker',
  'knight',
  'dummy',
  'monster',
  'heavy',
  'armored',
  'friendly',
];

interface ShowroomCharacter {
  kind: CharacterKind;
  character: Character;
  label: HTMLDivElement;
  labelAnchor: THREE.Vector3;
}

interface CharacterVisualQaReport {
  ready: boolean;
  variants: CharacterKind[];
  characterCount: number;
  partCount: number;
  sleepingPartCount: number;
  texturePaths: string[];
}

declare global {
  interface Window {
    __RATTLEWORKS_CHARACTER_VISUAL_QA__?: CharacterVisualQaReport;
  }
}

function loadImage(path: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`Failed to load production texture: ${path}`));
    image.src = path;
  });
}

function createLabel(kind: CharacterKind, name: string): HTMLDivElement {
  const label = document.createElement('div');
  label.className = 'character-label';
  const kindLine = document.createElement('strong');
  kindLine.textContent = kind;
  const nameLine = document.createElement('span');
  nameLine.textContent = name;
  label.append(kindLine, nameLine);
  return label;
}

function addStudioFloor(scene: THREE.Scene): void {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(28, 15),
    new THREE.MeshStandardMaterial({ color: 0x3c4742, roughness: 0.92, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.003;
  floor.receiveShadow = true;
  floor.userData.qaStudioFloor = true;
  scene.add(floor);

  const backWall = new THREE.Mesh(
    new THREE.PlaneGeometry(28, 12),
    new THREE.MeshStandardMaterial({ color: 0x263133, roughness: 1, metalness: 0 }),
  );
  backWall.position.set(0, 5.5, -5.7);
  backWall.receiveShadow = true;
  scene.add(backWall);

  for (const z of [-1.18, 2.16]) {
    const stripe = new THREE.Mesh(
      new THREE.PlaneGeometry(23.5, 0.032),
      new THREE.MeshBasicMaterial({ color: 0x8ea49b, transparent: true, opacity: 0.18 }),
    );
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(0, 0.009, z);
    scene.add(stripe);
  }
}

function addStudioLighting(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xdff4ed, 0x27302d, 1.65));

  const key = new THREE.DirectionalLight(0xfff0d4, 4.1);
  key.position.set(-6, 10, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -12;
  key.shadow.camera.right = 12;
  key.shadow.camera.top = 10;
  key.shadow.camera.bottom = -5;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.bias = -0.0002;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x78bcd2, 2.4);
  rim.position.set(8, 7, -6);
  scene.add(rim);

  const fill = new THREE.PointLight(0xffcf91, 34, 18, 2);
  fill.position.set(0, 4.5, 6);
  scene.add(fill);
}

function updateLabels(
  entries: readonly ShowroomCharacter[],
  camera: THREE.Camera,
  width: number,
  height: number,
): void {
  const projected = new THREE.Vector3();
  for (const entry of entries) {
    projected.copy(entry.labelAnchor).project(camera);
    const visible = projected.z > -1 && projected.z < 1;
    entry.label.hidden = !visible;
    if (!visible) continue;
    entry.label.style.left = `${(projected.x * 0.5 + 0.5) * width}px`;
    entry.label.style.top = `${(-projected.y * 0.5 + 0.5) * height}px`;
  }
}

async function main(): Promise<void> {
  const stage = document.querySelector<HTMLElement>('#stage');
  const labelLayer = document.querySelector<HTMLElement>('#labels');
  const status = document.querySelector<HTMLElement>('#status');
  if (!stage || !labelLayer || !status) throw new Error('Character QA harness markup is incomplete.');

  const texturePaths = Object.values(CHARACTER_TEXTURE_PATHS);
  await Promise.all(texturePaths.map(loadImage));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x172123);
  scene.fog = new THREE.Fog(0x172123, 18, 30);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  stage.prepend(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 60);
  camera.position.set(8.8, 7.35, 15.1);
  camera.lookAt(0, 1.6, -0.35);

  const physics = new PhysicsWorld(scene);
  scene.traverse((object) => {
    if (object.userData.ignorePick === true) object.visible = false;
  });
  addStudioFloor(scene);
  addStudioLighting(scene);

  const entries: ShowroomCharacter[] = [];
  const xPositions = [-5.1, -1.72, 1.72, 5.1];
  const zPositions = [1.9, -1.55];
  for (const [index, kind] of CHARACTER_KINDS.entries()) {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const at = new THREE.Vector3(xPositions[column], 0, zPositions[row]);
    const character = physics.spawnCharacter(kind, at, kind === 'friendly');
    for (const part of character.parts) part.body.sleep();
    const label = createLabel(kind, character.name);
    labelLayer.append(label);
    entries.push({
      kind,
      character,
      label,
      labelAnchor: at.clone().add(new THREE.Vector3(0, kind === 'heavy' ? 3.98 : 3.48, 0)),
    });
  }

  const resize = (): void => {
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    updateLabels(entries, camera, width, height);
  };
  window.addEventListener('resize', resize, { passive: true });
  resize();

  const render = (): void => {
    updateLabels(entries, camera, stage.clientWidth, stage.clientHeight);
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  };
  render();

  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const partCount = entries.reduce((total, entry) => total + entry.character.parts.length, 0);
  const sleepingPartCount = entries.reduce(
    (total, entry) => total + entry.character.parts.filter((part) => part.body.isSleeping()).length,
    0,
  );
  window.__RATTLEWORKS_CHARACTER_VISUAL_QA__ = {
    ready: true,
    variants: [...CHARACTER_KINDS],
    characterCount: entries.length,
    partCount,
    sleepingPartCount,
    texturePaths,
  };
  document.documentElement.dataset.testStatus = sleepingPartCount === partCount ? 'ready' : 'unstable';
  status.dataset.state = 'ready';
  status.textContent = `${entries.length}/8 variants ready · ${sleepingPartCount}/${partCount} parts sleeping`;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
  document.documentElement.dataset.testStatus = 'error';
  const status = document.querySelector<HTMLElement>('#status');
  if (status) {
    status.dataset.state = 'error';
    status.textContent = 'Harness error';
  }
  const card = document.createElement('pre');
  card.className = 'error-card';
  card.textContent = message;
  document.body.append(card);
});
