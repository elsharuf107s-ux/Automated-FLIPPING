import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempDataDir } from './helpers.js';

await useTempDataDir();
delete process.env.OPENAI_API_KEY;

const {
  supplierBrowserPolicy,
  createSupplierVerificationTask,
  getBrowserAgentTask,
  heartbeatBrowserBridge,
  claimBrowserAgentTask,
  completeBrowserAgentTask,
  browserAgentStatus
} = await import('../lib/browser-agent.js');

const waitFor = async (fn, timeout = 1200) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  return null;
};

test('browser policy only allows supported supplier pages', () => {
  assert.equal(supplierBrowserPolicy('https://www.aliexpress.com/item/123.html').allowed, true);
  assert.equal(supplierBrowserPolicy('https://m.dhgate.com/product/example/123.html').allowed, true);
  assert.equal(supplierBrowserPolicy('https://www.temu.com/example.html').allowed, false);
  assert.match(supplierBrowserPolicy('https://www.temu.com/example.html').reason, /search-only/i);
  assert.equal(supplierBrowserPolicy('https://www.depop.com/products/example/').allowed, false);
  assert.match(supplierBrowserPolicy('https://www.depop.com/products/example/').reason, /never controlled/i);
  assert.equal(supplierBrowserPolicy('https://example.com/product').allowed, false);
});

test('local bridge claims a task and deterministic fallback structures browser data', async () => {
  const task = createSupplierVerificationTask({
    supplier: {
      source: 'AliExpress',
      title: 'Canvas work jacket',
      url: 'https://www.aliexpress.com/item/100500123.html',
      price: 14,
      shipping: 3,
      currency: 'USD'
    },
    reference: { title: 'Work jacket', price: 42, source: 'eBay' }
  });
  assert.equal(task.status, 'queued');

  const heartbeat = heartbeatBrowserBridge({ bridgeId: 'test-bridge', mode: 'playwright-headed', version: 'test' });
  assert.equal(heartbeat.bridge.connected, true);

  const claimed = claimBrowserAgentTask({ bridgeId: 'test-bridge', mode: 'playwright-headed', version: 'test' });
  assert.equal(claimed.id, task.id);
  assert.equal(claimed.status, 'running');
  assert.ok(claimed.claimToken);
  assert.equal(claimed.payload.policy.noDepop, true);
  assert.equal(claimed.payload.policy.noPurchases, true);

  assert.throws(() => completeBrowserAgentTask(task.id, {
    bridgeId: 'test-bridge',
    claimToken: 'wrong-token',
    observation: {}
  }), /claim does not match/i);

  const processing = completeBrowserAgentTask(task.id, {
    bridgeId: 'test-bridge',
    claimToken: claimed.claimToken,
    observation: {
      finalUrl: claimed.url,
      title: 'Canvas Work Jacket - Supplier',
      visibleText: 'Canvas Work Jacket. In stock. Brown.',
      jsonLd: [{
        '@type': 'Product',
        name: 'Canvas Work Jacket',
        color: 'Brown',
        material: 'Cotton canvas',
        image: ['https://ae01.alicdn.com/example.jpg'],
        offers: { price: '12.50', priceCurrency: 'USD', availability: 'https://schema.org/InStock' }
      }]
    }
  });
  assert.equal(processing.status, 'processing');

  const completed = await waitFor(() => {
    const current = getBrowserAgentTask(task.id);
    return current?.status === 'completed' ? current : null;
  });
  assert.ok(completed);
  assert.equal(completed.result.price, 12.5);
  assert.equal(completed.result.shipping, 3);
  assert.equal(completed.result.totalCost, 15.5);
  assert.equal(completed.result.inStock, true);
  assert.deepEqual(completed.result.colors, ['Brown']);
  assert.equal(completed.result.material, 'Cotton canvas');
  assert.match(completed.result.warnings.join(' '), /fallback/i);

  const status = browserAgentStatus();
  assert.equal(status.bridge.connected, true);
  assert.ok(status.tasks.some((entry) => entry.id === task.id && entry.status === 'completed'));
});
