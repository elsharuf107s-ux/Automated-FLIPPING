import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempDataDir } from './helpers.js';

await useTempDataDir();
const {
  createBrowserScoutTask,
  browserScoutStatus,
  claimBrowserScoutTask,
  completeBrowserScoutTask
} = await import('../lib/browser-scout.js');

async function finish(task, bridgeId = 'test-bridge') {
  const claimed = claimBrowserScoutTask({ bridgeId });
  assert.equal(claimed.id, task.id);
  const accepted = completeBrowserScoutTask(task.id, {
    bridgeId,
    claimToken: claimed.claimToken,
    report: { searches: [], products: [], warnings: [] }
  });
  assert.equal(accepted.status, 'processing');
  await new Promise((resolve) => setImmediate(resolve));
  return browserScoutStatus().find((entry) => entry.id === task.id);
}

test('Browser Scout creates a fallback search mission without an OpenAI key', async () => {
  const task = await createBrowserScoutTask({ goal: 'Find oversized washed hoodies under $15 landed' });
  assert.equal(task.type, 'scout_suppliers');
  assert.equal(task.status, 'queued');
  assert.ok(task.plan.queries.length >= 1);
  const finished = await finish(task, 'bridge-a');
  assert.equal(finished.status, 'completed');
});

test('Browser Scout can be claimed and completed by the local bridge', async () => {
  const task = await createBrowserScoutTask({ goal: 'Find black work jackets' });
  const claimed = claimBrowserScoutTask({ bridgeId: 'bridge-b' });
  assert.equal(claimed.id, task.id);
  assert.equal(claimed.status, 'running');
  assert.equal(claimed.payload.sites.includes('AliExpress'), true);
  assert.equal(claimed.payload.sites.includes('DHgate'), true);

  const accepted = completeBrowserScoutTask(task.id, {
    bridgeId: 'bridge-b',
    claimToken: claimed.claimToken,
    report: {
      searches: [{ site: 'AliExpress', query: 'black work jacket', resultCount: 3 }],
      products: [{ source: 'AliExpress', url: 'https://www.aliexpress.us/item/100500.html', title: 'Work jacket' }],
      warnings: []
    }
  });
  assert.equal(accepted.status, 'processing');
  await new Promise((resolve) => setImmediate(resolve));
  const finished = browserScoutStatus().find((entry) => entry.id === task.id);
  assert.equal(finished.status, 'completed');
  assert.equal(finished.result.bestMatches.length, 1);
});
