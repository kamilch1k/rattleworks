import * as THREE from 'three';
import { Game } from '../../src/game/Game';
import { createDefaultSaveData, saveSystem } from '../../src/game/SaveSystem';
import type { Entity, GameMode, LevelResult, Phase, SaveData } from '../../src/game/types';

interface Assertion {
  name: string;
  pass: boolean;
  actual: unknown;
  expected: string;
}

interface ScenarioResult {
  name: string;
  pass: boolean;
  assertions: Assertion[];
  durationMs: number;
}

interface CampaignEdgeReport {
  version: 1;
  generatedAt: string;
  source: string;
  pass: boolean;
  scenarios: ScenarioResult[];
}

interface CatalogFixture {
  id: string;
  name: string;
  icon: string;
  category: string;
  description: string;
  lockedAfter?: number;
}

interface GameInternals {
  mode: GameMode;
  phase: Phase;
  loadout: Record<string, number>;
  activeItem?: string;
  projectileAimArmed: boolean;
  armedWeaponId?: number;
  spawnCategory: string;
  selectedSpawnId: string;
  history: unknown[];
  future: unknown[];
  startLevel(id: number): void;
  startSandbox(): void;
  startMachine(): void;
  useActiveItem(): void;
  fireActiveProjectile(target: THREE.Vector3): void;
  armSelectedWeapon(toggle?: boolean): void;
  useSelectedWeaponAt(target: THREE.Vector3): void;
  undo(): void;
  redo(): void;
  refreshSpawnGrid(): void;
  isProjectileAimMode(): boolean;
  isWorldAimMode(): boolean;
  isCatalogItemLocked(item: CatalogFixture, completed?: number): boolean;
}

declare global {
  interface Window {
    __RATTLEWORKS_CAMPAIGN_EDGE_REGRESSION__?: CampaignEdgeReport;
  }
}

const RESULT: LevelResult = {
  stars: 2,
  time: 25,
  itemsUsed: 1,
  destruction: 60,
  bestScore: 1200,
};

function cloneSave(data: SaveData): SaveData {
  return structuredClone(data);
}

function saveWithProgress(completedCount: number, unlockedItems: string[] = []): SaveData {
  const data = createDefaultSaveData();
  for (let id = 1; id <= completedCount; id++) data.completed[id] = { ...RESULT };
  data.unlockedLevel = Math.min(12, completedCount + 1);
  data.unlockedItems = [...unlockedItems];
  return data;
}

function requireEntity(value: Entity | { parts: Entity[] } | null, fixture: string): Entity {
  if (!value || !('body' in value)) throw new Error(`Failed to spawn ${fixture}.`);
  return value;
}

function countText(root: HTMLElement, itemId: string): string | null {
  return root.querySelector<HTMLElement>(`[data-count="${itemId}"]`)?.textContent ?? null;
}

function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const check = (): void => {
      if (predicate()) {
        resolve();
        return;
      }
      if (performance.now() - started >= timeoutMs) {
        reject(new Error(`Fixture did not become ready within ${timeoutMs} ms.`));
        return;
      }
      window.setTimeout(check, 25);
    };
    check();
  });
}

async function scenario(
  name: string,
  run: (check: (name: string, pass: boolean, actual: unknown, expected: string) => void) => void | Promise<void>,
): Promise<ScenarioResult> {
  const started = performance.now();
  const assertions: Assertion[] = [];
  const check = (assertionName: string, pass: boolean, actual: unknown, expected: string): void => {
    assertions.push({ name: assertionName, pass, actual, expected });
  };
  try {
    await run(check);
  } catch (error) {
    assertions.push({
      name: 'scenario completes without an exception',
      pass: false,
      actual: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      expected: 'no exception',
    });
  }
  return {
    name,
    pass: assertions.length > 0 && assertions.every((assertion) => assertion.pass),
    assertions,
    durationMs: Number((performance.now() - started).toFixed(2)),
  };
}

async function run(): Promise<CampaignEdgeReport> {
  const fixture = document.querySelector<HTMLElement>('#fixture');
  if (!fixture) throw new Error('Missing #fixture root.');
  const originalSave = cloneSave(saveSystem.load());
  saveSystem.save(createDefaultSaveData());
  const game = new Game(fixture);
  const internals = game as unknown as GameInternals;
  await waitFor(() => Boolean(fixture.querySelector('[data-action="campaign"]')));

  const scenarios: ScenarioResult[] = [];
  try {
    scenarios.push(await scenario('loadout card clears physical-weapon aim intent', (check) => {
      saveSystem.save(createDefaultSaveData());
      internals.startLevel(1);
      const pistol = requireEntity(game.physics.spawn({
        type: 'pistol',
        position: { x: -4, y: 3, z: 0 },
        fixed: true,
      }, true), 'campaign pistol');
      game.selection.select(pistol);
      internals.armSelectedWeapon();
      check('weapon is armed before the loadout switch', internals.armedWeaponId === pistol.id, internals.armedWeaponId, String(pistol.id));
      check('weapon aim owns world aim before the switch', internals.isWorldAimMode(), internals.isWorldAimMode(), 'true');

      const card = fixture.querySelector<HTMLButtonElement>('[data-item="heavy-ball"]');
      check('live loadout card exists', Boolean(card), Boolean(card), 'true');
      card?.click();

      check('card click clears armed weapon id', internals.armedWeaponId === undefined, internals.armedWeaponId, 'undefined');
      check('card click clears weapon selection', game.selection.selected.size === 0, game.selection.selected.size, '0');
      check('card click restores projectile intent', internals.projectileAimArmed, internals.projectileAimArmed, 'true');
      check('the clicked kit item becomes active', internals.activeItem === 'heavy-ball', internals.activeItem, 'heavy-ball');
      check('world aim remains valid through the projectile, not stale weapon state', internals.isProjectileAimMode(), internals.isProjectileAimMode(), 'true');
    }));

    scenarios.push(await scenario('campaign undo and redo restore loadout counts', (check) => {
      saveSystem.save(createDefaultSaveData());
      internals.startLevel(1);
      const initialCount = internals.loadout['heavy-ball'];
      const initialBodies = game.physics.entities.size;
      internals.fireActiveProjectile(new THREE.Vector3(0, 2, 0));

      check('firing consumes exactly one loadout item', internals.loadout['heavy-ball'] === initialCount - 1, internals.loadout['heavy-ball'], String(initialCount - 1));
      check('the HUD count reflects consumption', countText(fixture, 'heavy-ball') === String(initialCount - 1), countText(fixture, 'heavy-ball'), String(initialCount - 1));
      check('the fired projectile exists in the world', game.physics.entities.size === initialBodies + 1, game.physics.entities.size, String(initialBodies + 1));
      check('firing creates one undo point', internals.history.length === 1, internals.history.length, '1');

      internals.undo();
      check('undo restores the in-memory loadout count', internals.loadout['heavy-ball'] === initialCount, internals.loadout['heavy-ball'], String(initialCount));
      check('undo restores the HUD loadout count', countText(fixture, 'heavy-ball') === String(initialCount), countText(fixture, 'heavy-ball'), String(initialCount));
      check('undo restores the pre-shot world', game.physics.entities.size === initialBodies, game.physics.entities.size, String(initialBodies));
      check('undo creates one redo point', internals.future.length === 1, internals.future.length, '1');

      internals.redo();
      check('redo reapplies the consumed count', internals.loadout['heavy-ball'] === initialCount - 1, internals.loadout['heavy-ball'], String(initialCount - 1));
      check('redo reapplies the HUD count', countText(fixture, 'heavy-ball') === String(initialCount - 1), countText(fixture, 'heavy-ball'), String(initialCount - 1));
      check('redo restores the post-shot world', game.physics.entities.size === initialBodies + 1, game.physics.entities.size, String(initialBodies + 1));
    }));

    scenarios.push(await scenario('sandbox catalog honors explicit and staged unlocks', (check) => {
      const pistolFixture: CatalogFixture = {
        id: 'pistol',
        name: 'Block Pistol',
        icon: 'P',
        category: 'Destruction',
        description: 'Test fixture matching the production reward threshold.',
        lockedAfter: 2,
      };

      saveSystem.save(saveWithProgress(0));
      internals.startSandbox();
      internals.spawnCategory = 'Destruction';
      internals.selectedSpawnId = 'pistol';
      internals.refreshSpawnGrid();
      const freshCard = fixture.querySelector<HTMLElement>('[data-shop-card="pistol"]');
      check('fresh staged reward is locked by predicate', internals.isCatalogItemLocked(pistolFixture, 0), internals.isCatalogItemLocked(pistolFixture, 0), 'true');
      check('fresh staged reward is visibly locked in the shop', freshCard?.classList.contains('locked') === true, freshCard?.className, 'contains locked');

      saveSystem.save(saveWithProgress(0, ['pistol']));
      internals.refreshSpawnGrid();
      const explicitCard = fixture.querySelector<HTMLElement>('[data-shop-card="pistol"]');
      check('unlockedItems bypasses the stage gate', !internals.isCatalogItemLocked(pistolFixture, 0), internals.isCatalogItemLocked(pistolFixture, 0), 'false');
      check('explicit reward becomes usable in the real shop', explicitCard?.classList.contains('locked') === false, explicitCard?.className, 'does not contain locked');
      check('explicit reward option reports enabled', explicitCard?.querySelector('[data-spawn="pistol"]')?.getAttribute('aria-disabled') === 'false', explicitCard?.querySelector('[data-spawn="pistol"]')?.getAttribute('aria-disabled'), 'false');

      saveSystem.save(saveWithProgress(1));
      internals.refreshSpawnGrid();
      const oneLevelCard = fixture.querySelector<HTMLElement>('[data-shop-card="pistol"]');
      check('one completion is still below lockedAfter 2', oneLevelCard?.classList.contains('locked') === true, oneLevelCard?.className, 'contains locked');

      saveSystem.save(saveWithProgress(2));
      internals.refreshSpawnGrid();
      const stagedCard = fixture.querySelector<HTMLElement>('[data-shop-card="pistol"]');
      check('two completions satisfy lockedAfter 2', !internals.isCatalogItemLocked(pistolFixture, 2), internals.isCatalogItemLocked(pistolFixture, 2), 'false');
      check('staged reward becomes usable in the real shop', stagedCard?.classList.contains('locked') === false, stagedCard?.className, 'does not contain locked');
      check('staged reward option reports enabled', stagedCard?.querySelector('[data-spawn="pistol"]')?.getAttribute('aria-disabled') === 'false', stagedCard?.querySelector('[data-spawn="pistol"]')?.getAttribute('aria-disabled'), 'false');
    }));

    scenarios.push(await scenario('build phase gates both projectile and weapon firing until START', (check) => {
      saveSystem.save(createDefaultSaveData());
      internals.startLevel(4);
      check('level 4 starts in build phase', internals.phase === 'build', internals.phase, 'build');
      check('build phase begins with a projectile selected', internals.activeItem === 'heavy-ball', internals.activeItem, 'heavy-ball');
      const preStartCount = internals.loadout['heavy-ball'];
      internals.useActiveItem();
      check('F/use cannot arm a projectile during build', !internals.projectileAimArmed, internals.projectileAimArmed, 'false');
      check('build-phase projectile use consumes no ammo', internals.loadout['heavy-ball'] === preStartCount, internals.loadout['heavy-ball'], String(preStartCount));
      check('build phase rejects projectile world aim', !internals.isProjectileAimMode(), internals.isProjectileAimMode(), 'false');

      const pistol = requireEntity(game.physics.spawn({
        type: 'pistol',
        position: { x: -4, y: 4, z: 0 },
        fixed: true,
      }, true), 'build-phase pistol');
      game.selection.select(pistol);
      const preStartAmmo = pistol.weapon?.ammo ?? -1;
      internals.armSelectedWeapon();
      check('F/use cannot arm a weapon during build', internals.armedWeaponId === undefined, internals.armedWeaponId, 'undefined');
      internals.armedWeaponId = pistol.id;
      internals.useSelectedWeaponAt(new THREE.Vector3(18, 5, 0));
      check('a stale armed id still cannot fire during build', pistol.weapon?.ammo === preStartAmmo, pistol.weapon?.ammo, String(preStartAmmo));
      check('blocked stale weapon intent is cleared', internals.armedWeaponId === undefined, internals.armedWeaponId, 'undefined');

      internals.startMachine();
      check('START switches build to live play', internals.phase === 'play', internals.phase, 'play');
      check('START enables projectile world aim', internals.isProjectileAimMode(), internals.isProjectileAimMode(), 'true');
      internals.fireActiveProjectile(new THREE.Vector3(0, 3, 0));
      check('projectile firing consumes ammo after START', internals.loadout['heavy-ball'] === preStartCount - 1, internals.loadout['heavy-ball'], String(preStartCount - 1));

      game.selection.select(pistol);
      internals.armSelectedWeapon();
      check('weapon can arm after START', internals.armedWeaponId === pistol.id, internals.armedWeaponId, String(pistol.id));
      check('weapon owns live world aim after START', internals.isWorldAimMode(), internals.isWorldAimMode(), 'true');
      internals.useSelectedWeaponAt(new THREE.Vector3(18, 5, 0));
      check('weapon fire consumes one round after START', pistol.weapon?.ammo === preStartAmmo - 1, pistol.weapon?.ammo, String(preStartAmmo - 1));
    }));
  } finally {
    saveSystem.save(originalSave);
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'work/campaign-edge-tests/campaign-edge-regression.ts',
    pass: scenarios.length === 4 && scenarios.every((item) => item.pass),
    scenarios,
  };
}

const status = document.querySelector<HTMLElement>('#status');
const reportNode = document.querySelector<HTMLElement>('#report');

try {
  const report = await run();
  window.__RATTLEWORKS_CAMPAIGN_EDGE_REGRESSION__ = report;
  if (status) {
    status.textContent = report.pass ? 'PASS — all campaign edge scenarios are green.' : 'FAIL — inspect the report below.';
    status.className = report.pass ? 'pass' : 'fail';
  }
  if (reportNode) reportNode.textContent = JSON.stringify(report, null, 2);
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
  if (status) {
    status.textContent = 'FAIL — the regression harness could not complete.';
    status.className = 'fail';
  }
  if (reportNode) reportNode.textContent = message;
  window.__RATTLEWORKS_CAMPAIGN_EDGE_REGRESSION__ = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'work/campaign-edge-tests/campaign-edge-regression.ts',
    pass: false,
    scenarios: [{
      name: 'harness boot',
      pass: false,
      assertions: [{ name: 'harness completes', pass: false, actual: message, expected: 'no exception' }],
      durationMs: 0,
    }],
  };
}
