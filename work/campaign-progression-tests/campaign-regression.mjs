import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  configFile: false,
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true },
  root: process.cwd(),
  server: { middlewareMode: true },
});

try {
  const saves = await server.ssrLoadModule('/src/game/SaveSystem.ts');
  const campaign = await server.ssrLoadModule('/src/game/levels.ts');

  const result = { stars: 2, time: 20, itemsUsed: 1, destruction: 50, bestScore: 1000 };
  assert.equal(saves.createDefaultSaveData().unlockedLevel, 1, 'fresh save starts at level 1');
  assert.equal(
    saves.normalizeSaveData({ saveVersion: 1, completed: {}, unlockedLevel: 12 }).unlockedLevel,
    1,
    'stale unlock-only save is treated as fresh',
  );
  assert.equal(
    saves.normalizeSaveData({ saveVersion: 1, completed: { 1: result }, unlockedLevel: 1 }).unlockedLevel,
    2,
    'earned completion infers the next level',
  );
  assert.equal(
    saves.normalizeSaveData({ saveVersion: 1, completed: { 1: result }, unlockedLevel: 5 }).unlockedLevel,
    2,
    'unearned stored markers cannot skip the campaign',
  );
  assert.equal(
    saves.normalizeSaveData({ saveVersion: 1, completed: { 4: result }, unlockedLevel: 1 }).unlockedLevel,
    5,
    'existing out-of-order earned progress preserves the next sensible level',
  );

  const level2 = campaign.getLevelById(2);
  assert.ok(level2, 'level 2 exists');
  assert.deepEqual(campaign.createCampaignLoadout(level2, {}), { 'concrete-block': 1 });
  assert.deepEqual(
    campaign.createCampaignLoadout(level2, { 1: result }),
    { 'concrete-block': 1, 'heavy-ball': 2 },
    'level 1 reward supplies fireable heavy balls in level 2',
  );

  const completedThroughFour = Object.fromEntries([1, 2, 3, 4].map((id) => [id, result]));
  const level5Kit = campaign.createCampaignLoadout(campaign.getLevelById(5), completedThroughFour);
  assert.equal(level5Kit['heavy-ball'], 2);
  assert.equal(level5Kit.pistol, 1);
  assert.equal(level5Kit.bomb, 1);
  assert.equal(level5Kit.knife, 1);
  assert.equal(campaign.LEVELS.length, 12);
  assert.ok(campaign.LEVELS.every((level) => Object.keys(level.reward.items).length > 0));

  const memorySave = new saves.SaveSystem('campaign-regression', null);
  memorySave.load();
  memorySave.recordLevelResult(1, result);
  memorySave.unlockItems(['heavy-ball', 'heavy-ball', 'pistol']);
  assert.equal(memorySave.data.unlockedLevel, 2);
  assert.deepEqual(memorySave.data.unlockedItems, ['heavy-ball', 'pistol']);

  console.log('campaign progression regression: PASS');
} finally {
  await server.close();
}
