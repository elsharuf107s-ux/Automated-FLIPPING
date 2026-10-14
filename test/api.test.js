import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDataDir } from './helpers.js';

await useTempDataDir();
delete process.env.OPENAI_API_KEY;
const { app } = await import('../server.js');

let server;
let base;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('health reports the focused OpenAI status', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.ai.provider, 'openai');
  assert.equal(body.ai.configured, false);
});

test('analyze returns a normalized fallback report without a key', async () => {
  const res = await fetch(`${base}/api/analyze`, json('POST', { title: 'Work jacket', purchasePrice: 20 }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.mode, 'demo');
  assert.ok(['BUY', 'WATCH', 'PASS'].includes(body.decision));
  assert.ok(body.score >= 0 && body.score <= 100);
  assert.ok(body.depop?.description);
});

test('analyze requires clothing info', async () => {
  const res = await fetch(`${base}/api/analyze`, json('POST', {}));
  assert.equal(res.status, 400);
});

test('settings persist without inventory endpoints', async () => {
  const saved = await (await fetch(`${base}/api/settings`, json('PATCH', {
    marketplaceFeePercent: 2,
    paymentFeePercent: 3.5,
    defaultOutboundShipping: 7,
    targetRoiPercent: 80
  }))).json();
  assert.equal(saved.defaultOutboundShipping, 7);
  const read = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(read.targetRoiPercent, 80);
  assert.equal((await fetch(`${base}/api/items`)).status, 404);
  assert.equal((await fetch(`${base}/api/finder/search`, json('POST', {}))).status, 404);
});

test('ai-config never leaks the OpenAI key', async () => {
  const key = 'sk-proj-supersecret-0123456789abcdef';
  const saved = await (await fetch(`${base}/api/ai-config`, json('PATCH', { openaiApiKey: key }))).text();
  assert.equal(saved.includes('supersecret'), false);
  const read = await (await fetch(`${base}/api/ai-config`)).text();
  assert.equal(read.includes('supersecret'), false);
  const health = await (await fetch(`${base}/api/health`)).text();
  assert.equal(health.includes('supersecret'), false);
});

test('bad input returns JSON errors', async () => {
  const bad = await fetch(`${base}/api/ai-config`, json('PATCH', { provider: 'ollama' }));
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /uses OpenAI/);

  const malformed = await fetch(`${base}/api/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{oops'
  });
  assert.equal(malformed.status, 400);

  const missing = await fetch(`${base}/api/does-not-exist`);
  assert.equal(missing.status, 404);
});

test('serves the lean app shell', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Hunt → Depop/);
  assert.doesNotMatch(html, /Inventory/);
  assert.doesNotMatch(html, /eBay connection/);
});
