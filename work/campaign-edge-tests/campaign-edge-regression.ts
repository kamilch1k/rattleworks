import * as THREE from 'three';
import '../../src/styles.css';
import { Game } from '../../src/game/Game';
import { LEVELS } from '../../src/game/levels';
import { createDefaultSaveData, saveSystem } from '../../src/game/SaveSystem';
import type { Character, Entity, GameMode, LevelResult, Phase, SaveData } from '../../src/game/types';

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
  campaignKillCount: number;
  startLevel(id: number): void;
  startSandbox(): void;
  useActiveItem(): void;
  fireActiveProjectile(target: THREE.Vector3): void;
  armSelectedWeapon(toggle?: boolean): void;
  useSelectedWeaponAt(target: THREE.Vector3): void;
  undo(): void;
  redo(): void;
  refreshSpawnGrid(): void;
  isProjectileItem(id?: string): boolean;
  isProjectileAimMode(): boolean;
  isWorldAimMode(): boolean;
  setProjectileAimArmed(armed: boolean, announce: boolean): void;
  isCatalogItemLocked(item: CatalogFixture, completed?: number): boolean;
  onEntityDamaged(entity: Entity, damage: number): void;
  onCharacterDefeated(character: Character): void;
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

function requireCharacter(value: Entity | Character | null, fixture: string): Character {
  if (!value || !('parts' in value)) throw new Error(`Failed to spawn ${fixture}.`);
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
      check('successful fire keeps the equipped shot armed', internals.isProjectileAimMode(), internals.isProjectileAimMode(), 'true');

      internals.undo();
      check('undo restores the in-memory loadout count', internals.loadout['heavy-ball'] === initialCount, internals.loadout['heavy-ball'], String(initialCount));
      check('undo restores the HUD loadout count', countText(fixture, 'heavy-ball') === String(initialCount), countText(fixture, 'heavy-ball'), String(initialCount));
      check('undo restores the pre-shot world', game.physics.entities.size === initialBodies, game.physics.entities.size, String(initialBodies));
      check('undo creates one redo point', internals.future.length === 1, internals.future.length, '1');
      check('undo restores the armed pre-shot state', internals.isProjectileAimMode(), internals.isProjectileAimMode(), 'true');

      internals.redo();
      check('redo reapplies the consumed count', internals.loadout['heavy-ball'] === initialCount - 1, internals.loadout['heavy-ball'], String(initialCount - 1));
      check('redo reapplies the HUD count', countText(fixture, 'heavy-ball') === String(initialCount - 1), countText(fixture, 'heavy-ball'), String(initialCount - 1));
      check('redo restores the post-shot world', game.physics.entities.size === initialBodies + 1, game.physics.entities.size, String(initialBodies + 1));
      check('redo preserves continuous aiming', internals.isProjectileAimMode(), internals.isProjectileAimMode(), 'true');
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

    scenarios.push(await scenario('every campaign level is launch-ready and keeps shots equipped', (check) => {
      saveSystem.save(saveWithProgress(12));
      for (const level of LEVELS) {
        internals.startLevel(level.id);
        const prefix = `level ${level.id}`;
        const itemId = internals.activeItem;
        const countBefore = itemId ? internals.loadout[itemId] : undefined;
        const grabButton = fixture.querySelector<HTMLButtonElement>('[data-tool="grab"]');
        const shotCard = itemId ? fixture.querySelector<HTMLButtonElement>(`[data-item="${itemId}"]`) : null;

        check(`${prefix} starts in live play`, internals.phase === 'play', internals.phase, 'play');
        check(`${prefix} has no START gate`, !fixture.querySelector('[data-action="start"]'), Boolean(fixture.querySelector('[data-action="start"]')), 'false');
        check(`${prefix} exposes Grab`, Boolean(grabButton) && grabButton?.disabled === false, Boolean(grabButton) && grabButton?.disabled === false, 'true');
        check(`${prefix} removes the redundant SHOT header`, !fixture.querySelector('.campaign-hud .loadout .panel-header'), Boolean(fixture.querySelector('.campaign-hud .loadout .panel-header')), 'false');
        check(`${prefix} selects an available shot`, Boolean(itemId) && typeof countBefore === 'number' && countBefore > 0, { itemId, countBefore }, 'a selected item with positive ammo');
        check(`${prefix} begins in world-point launch mode`, internals.isProjectileAimMode(), internals.isProjectileAimMode(), 'true');
        if (level.id === 1) {
          check('completed saves cannot leak later rewards into level 1', Object.keys(internals.loadout).length === 1 && internals.loadout['heavy-ball'] === 4, internals.loadout, '{ heavy-ball: 4 }');
          check('level 1 contains no ammo-box card', !fixture.querySelector('[data-item="ammo-box"]'), Boolean(fixture.querySelector('[data-item="ammo-box"]')), 'false');
        }

        if (!itemId || countBefore === undefined) continue;
        internals.fireActiveProjectile(new THREE.Vector3(level.camera.target.x, level.camera.target.y, level.camera.target.z));
        check(`${prefix} launch consumes exactly one shot`, internals.loadout[itemId] === countBefore - 1, internals.loadout[itemId], String(countBefore - 1));
        check(`${prefix} launch keeps world-point aiming armed`, internals.projectileAimArmed && internals.isProjectileAimMode(), `${internals.projectileAimArmed}/${internals.isProjectileAimMode()}`, 'true/true');
        check(`${prefix} keeps Grab available but visually inactive while aiming`, game.selection.tool === 'grab' && grabButton?.classList.contains('active') === false, `${game.selection.tool}/${grabButton?.className}`, 'grab/not active');
        check(`${prefix} keeps the equipped projectile card highlighted`, shotCard?.classList.contains('active') === true, shotCard?.className, 'contains active');
        check(`${prefix} keeps the equipped projectile card pressed`, shotCard?.getAttribute('aria-pressed') === 'true', shotCard?.getAttribute('aria-pressed'), 'true');

        if (level.id === 1 && shotCard && internals.loadout[itemId] > 0) {
          internals.setProjectileAimArmed(false, false);
          document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', bubbles: true }));
          check('F re-arms the available projectile', internals.isProjectileAimMode(), internals.isProjectileAimMode(), 'true');
          check('F restores the projectile-card highlight', shotCard.classList.contains('active'), shotCard.className, 'contains active');
          check('F restores the projectile-card pressed state', shotCard.getAttribute('aria-pressed') === 'true', shotCard.getAttribute('aria-pressed'), 'true');

          internals.setProjectileAimArmed(false, false);
          shotCard.click();
          check('clicking the available card re-arms the projectile', internals.isProjectileAimMode(), internals.isProjectileAimMode(), 'true');
          check('card click restores its highlight', shotCard.classList.contains('active'), shotCard.className, 'contains active');
          check('card click restores its pressed state', shotCard.getAttribute('aria-pressed') === 'true', shotCard.getAttribute('aria-pressed'), 'true');
          internals.setProjectileAimArmed(false, false);
        }
      }
    }));

    scenarios.push(await scenario('campaign progression exposes an unambiguous aimed kit', (check) => {
      saveSystem.save(saveWithProgress(12));
      internals.startLevel(2);
      check('level 2 receives only its base kit and the earlier level 1 reward', Object.keys(internals.loadout).length === 2 && internals.loadout['heavy-ball'] === 5 && internals.loadout['concrete-block'] === 1, internals.loadout, '{ heavy-ball: 5, concrete-block: 1 }');

      const launch = (itemId: string): Entity | undefined => {
        const before = new Set(game.physics.entities.keys());
        fixture.querySelector<HTMLButtonElement>(`[data-item="${itemId}"]`)?.click();
        internals.fireActiveProjectile(new THREE.Vector3(3, 2.2, 0));
        return [...game.physics.entities.values()].find((entity) => !before.has(entity.id) && entity.type === itemId);
      };

      const concrete = launch('concrete-block');
      const concreteSpeed = concrete?.body.linvel();
      check('concrete card throws an actual concrete body', concrete?.type === 'concrete-block', concrete?.type, 'concrete-block');
      check('concrete chunk receives aimed launch velocity', Boolean(concreteSpeed) && Math.hypot(concreteSpeed!.x, concreteSpeed!.y, concreteSpeed!.z) > 10, concreteSpeed, 'speed above 10 m/s');
      check('concrete chunk is CCD impact-ready', concrete?.projectile === true, concrete?.projectile, 'true');

      saveSystem.save(saveWithProgress(11));
      internals.startLevel(12);
      const aimedKit = [
        'heavy-ball', 'pistol', 'bomb', 'knife', 'shotgun',
        'explosive-projectile', 'machete', 'rifle', 'rocket', 'axe', 'spear',
      ];

      check('ammo box is absent from the campaign kit', !fixture.querySelector('[data-item="ammo-box"]'), Boolean(fixture.querySelector('[data-item="ammo-box"]')), 'false');
      check('the explosive campaign round is presented as a Tank Shell', fixture.querySelector('[data-item="explosive-projectile"] b')?.textContent === 'Tank Shell', fixture.querySelector('[data-item="explosive-projectile"] b')?.textContent, 'Tank Shell');

      for (const itemId of aimedKit) {
        const card = fixture.querySelector<HTMLButtonElement>(`[data-item="${itemId}"]`);
        check(`${itemId} has an earned loadout card`, Boolean(card), Boolean(card), 'true');
        card?.click();
        check(`${itemId} card arms a world-point reticle`, internals.isProjectileAimMode(), internals.isProjectileAimMode(), 'true');
        const actionLabel = ['pistol', 'shotgun', 'rifle'].includes(itemId) ? 'FIRE' : 'LAUNCH';
        check(`${itemId} exposes its aimed action instead of an ambiguous DROP`, fixture.querySelector<HTMLButtonElement>('[data-action="use-item"]')?.textContent?.includes(actionLabel) === true, fixture.querySelector<HTMLButtonElement>('[data-action="use-item"]')?.textContent, `contains ${actionLabel}`);
        internals.setProjectileAimArmed(false, false);
      }

      const knife = launch('knife');
      const knifeSpeed = knife?.body.linvel();
      check('knife remains a physical melee weapon after throwing', knife?.weapon?.mode === 'melee', knife?.weapon?.mode, 'melee');
      check('knife is thrown toward the clicked world point', Boolean(knifeSpeed) && Math.hypot(knifeSpeed!.x, knifeSpeed!.y, knifeSpeed!.z) > 10, knifeSpeed, 'speed above 10 m/s');

      for (const firearmId of ['pistol', 'shotgun', 'rifle'] as const) {
        const roundsBefore = internals.loadout[firearmId] ?? 0;
        const ids = Object.keys(internals.loadout);
        const currentIndex = ids.indexOf(firearmId);
        const ring = ids.map((_, offset) => ids[(currentIndex + 1 + offset) % ids.length]);
        const expectedNext = ring.find((id) => id !== firearmId && (internals.loadout[id] ?? 0) > 0 && internals.isProjectileItem(id));
        const entityIdsBefore = new Set(game.physics.entities.keys());
        const bodiesBefore = game.physics.bodyStats.total;
        const aimedPoint = new THREE.Vector3(1.5, 32, -0.75);
        fixture.querySelector<HTMLButtonElement>(`[data-item="${firearmId}"]`)?.click();
        internals.fireActiveProjectile(aimedPoint);
        const looseGun = [...game.physics.entities.values()].find((entity) => !entityIdsBefore.has(entity.id) && entity.type === firearmId);
        check(`${firearmId} card does not leave a loose gun in the world`, looseGun === undefined, looseGun?.type, 'undefined');
        check(`${firearmId} card consumes exactly one aimed round`, internals.loadout[firearmId] === roundsBefore - 1, internals.loadout[firearmId], String(roundsBefore - 1));
        check(`${firearmId} direct shot creates no physics body`, game.physics.bodyStats.total === bodiesBefore, game.physics.bodyStats.total, String(bodiesBefore));
        if (internals.loadout[firearmId] === 0) {
          const nextCard = expectedNext ? fixture.querySelector<HTMLButtonElement>(`[data-item="${expectedNext}"]`) : null;
          check(`${firearmId} depletion selects the next available ability`, internals.activeItem === expectedNext, internals.activeItem, String(expectedNext));
          check(`${firearmId} depletion leaves the replacement visibly selected`, nextCard?.classList.contains('selected') === true && nextCard?.getAttribute('aria-current') === 'true', `${nextCard?.className}/${nextCard?.getAttribute('aria-current')}`, 'selected/true');
          check(`${firearmId} depletion automatically arms the replacement`, internals.isProjectileAimMode() && nextCard?.classList.contains('active') === true && nextCard?.getAttribute('aria-pressed') === 'true', `${internals.isProjectileAimMode()}/${nextCard?.className}/${nextCard?.getAttribute('aria-pressed')}`, 'true/active/true');
        }
      }
    }));

    scenarios.push(await scenario('transparent combat readout counts campaign kills', async (check) => {
      saveSystem.save(saveWithProgress(12));
      internals.startLevel(1);
      const first = requireCharacter(game.physics.spawn({ type: 'character', variant: 'dummy', position: { x: -7, y: 0.21, z: -5 } }, true), 'first score target');
      const second = requireCharacter(game.physics.spawn({ type: 'character', variant: 'dummy', position: { x: -4, y: 0.21, z: -5 } }, true), 'second score target');
      internals.onCharacterDefeated(first);
      internals.onCharacterDefeated(second);
      const killRows = [...fixture.querySelectorAll<HTMLElement>('.combat-feed-entry.is-kill:not([hidden])')];
      const latestKill = killRows.find((row) => row.textContent?.includes('2 KILLS'));
      const killStyle = latestKill ? getComputedStyle(latestKill) : undefined;
      check('enemy defeats advance the cumulative kill amount', internals.campaignKillCount === 2 && Boolean(latestKill), `${internals.campaignKillCount}/${latestKill?.textContent}`, '2/contains 2 KILLS');
      check('kill label has no panel background or border', killStyle?.backgroundImage === 'none' && killStyle.backgroundColor === 'rgba(0, 0, 0, 0)' && killStyle.borderTopWidth === '0px', `${killStyle?.backgroundImage}/${killStyle?.backgroundColor}/${killStyle?.borderTopWidth}`, 'none/transparent/0px');
      check('kill label uses large red readable type', Boolean(killStyle) && Number.parseFloat(killStyle!.fontSize) >= 24 && Number.parseInt(killStyle!.color.match(/\d+/)?.[0] ?? '0', 10) >= 200, `${killStyle?.fontSize}/${killStyle?.color}`, '>=24px/red');

      const prop = requireEntity(game.physics.spawn({ type: 'crate', position: { x: -2, y: 2, z: -5 } }, true), 'score prop');
      internals.onEntityDamaged(prop, 18);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 140));
      const propRow = [...fixture.querySelectorAll<HTMLElement>('.combat-feed-entry.is-prop:not([hidden])')].find((row) => row.textContent?.includes('PROP DAMAGE'));
      const propStyle = propRow ? getComputedStyle(propRow) : undefined;
      check('prop damage is emitted as visible white text', Boolean(propRow) && propStyle?.color === 'rgb(255, 255, 255)', `${propRow?.textContent}/${propStyle?.color}`, 'PROP DAMAGE/rgb(255, 255, 255)');
      check('damage text has no panel background or border', propStyle?.backgroundImage === 'none' && propStyle.backgroundColor === 'rgba(0, 0, 0, 0)' && propStyle.borderTopWidth === '0px', `${propStyle?.backgroundImage}/${propStyle?.backgroundColor}/${propStyle?.borderTopWidth}`, 'none/transparent/0px');
    }));
  } finally {
    saveSystem.save(originalSave);
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'work/campaign-edge-tests/campaign-edge-regression.ts',
    pass: scenarios.length === 6 && scenarios.every((item) => item.pass),
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
