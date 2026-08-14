import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const server = await createServer({
  appType: 'custom',
  server: { middlewareMode: true },
  logLevel: 'error',
  resolve: {
    alias: {
      '@dimforge/rapier3d': fileURLToPath(new URL('../../node_modules/@dimforge/rapier3d/rapier.js', import.meta.url)),
    },
  },
});

try {
  const module = await server.ssrLoadModule('/work/level-stability-tests/level-stability.ts');
  const requestedSeconds = Number(process.argv.slice(2).find((argument) => !argument.startsWith('--')) ?? 10);
  const seconds = Number.isFinite(requestedSeconds) && requestedSeconds > 0 ? requestedSeconds : 10;
  const requestedLevel = Number(process.argv.find((argument) => argument.startsWith('--level='))?.split('=')[1]);
  const onlyLevelId = Number.isFinite(requestedLevel) ? requestedLevel : undefined;
  const skippedLabels = new Set(process.argv.filter((argument) => argument.startsWith('--skip=')).map((argument) => argument.slice('--skip='.length)));
  const report = module.runLevelStabilityAudit(seconds, !process.argv.includes('--structures-only'), skippedLabels, onlyLevelId);
  const selectedLevels = Number.isFinite(requestedLevel)
    ? report.levels.filter((level) => level.id === requestedLevel)
    : report.levels;
  const output = process.argv.includes('--summary')
    ? {
        seconds: report.seconds,
        pass: report.pass,
        levels: selectedLevels.map((level) => ({
          id: level.id,
          definitions: level.definitions,
          expandedBodies: level.expandedBodies,
          targets: level.targetCharacters,
          friendlies: level.friendlyCharacters,
          peakLinearSpeed: level.peakLinearSpeed,
          peakAngularSpeed: level.peakAngularSpeed,
          lateActiveBodies: level.lateActiveBodies,
          explosions: level.explosionEvents,
          breaks: level.brokenEntities,
          breakDetails: process.argv.includes('--terse') ? undefined : level.breakDetails,
          removed: level.removedEntities,
          damagedCharacters: level.damagedCharacters,
          spontaneousTargetDefeats: level.spontaneousTargetDefeats,
          spontaneousFriendlyDefeats: level.spontaneousFriendlyDefeats,
          collapses: level.structuralCollapses,
          maxDisplacement: level.maxStructuralDisplacement,
          maxHorizontalDisplacement: level.maxStructuralHorizontalDisplacement,
          maxDrop: level.maxStructuralDrop,
          maxRotation: level.maxStructuralRotationDegrees,
          worst: process.argv.includes('--terse') ? undefined : level.worst.slice(0, 3),
        })),
      }
    : report;
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} finally {
  await server.close();
}
