import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDataDir, PIXEL_PNG } from './helpers.js';

await useTempDataDir();
process.env.AI_PROVIDER = 'demo';
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

test('health reports AI status', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.ai.provider, 'demo');
});

test('analyze returns a normalized demo report', async () => {
  const res = await fetch(`${base}/api/analyze`, json('POST', { title: 'Jacket', brand: 'Carhartt', purchasePrice: 20 }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.mode, 'demo');
  assert.ok(['BUY', 'WATCH', 'PASS'].includes(body.decision));
  assert.ok(body.score >= 0 && body.score <= 100);
  assert.ok(body.estimatedSaleHigh >= body.estimatedSaleLow);
});

test('analyze requires some item info', async () => {
  const res = await fetch(`${base}/api/analyze`, json('POST', {}));
  assert.equal(res.status, 400);
});

test('item CRUD, re-analysis, photo serving and CSV export', async () => {
  const created = await (await fetch(`${base}/api/items`, json('POST', { title: '=HYPERLINK("x")', purchasePrice: 10, targetPrice: 50, image: PIXEL_PNG }))).json();
  assert.ok(created.id);

  const photo = await fetch(`${base}${created.image}`);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('content-type'), 'image/png');

  const patched = await (await fetch(`${base}/api/items/${created.id}`, json('PATCH', { status: 'sold', soldPrice: 60 }))).json();
  assert.equal(patched.status, 'sold');
  assert.ok(patched.soldAt);

  const analyzed = await (await fetch(`${base}/api/items/${created.id}/analyze`, { method: 'POST' })).json();
  assert.equal(analyzed.ai.mode, 'demo');

  const csv = await (await fetch(`${base}/api/export.csv`)).text();
  assert.match(csv, /title,brand/);
  assert.match(csv, /'=HYPERLINK/, 'formula-like cells are escaped');

  assert.equal((await fetch(`${base}/api/items/${created.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await fetch(`${base}/api/items/${created.id}`)).status, 404);
});

test('ai-config never leaks the key', async () => {
  const key = 'sk-proj-supersecret-0123456789abcdef';
  const saved = await (await fetch(`${base}/api/ai-config`, json('PATCH', { openaiApiKey: key }))).text();
  assert.equal(saved.includes('supersecret'), false);
  const read = await (await fetch(`${base}/api/ai-config`)).text();
  assert.equal(read.includes('supersecret'), false);
  const health = await (await fetch(`${base}/api/health`)).text();
  assert.equal(health.includes('supersecret'), false);
});

test('bad input returns JSON errors', async () => {
  const bad = await fetch(`${base}/api/ai-config`, json('PATCH', { provider: 'nope' }));
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /Unknown AI provider/);

  const malformed = await fetch(`${base}/api/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
  assert.equal(malformed.status, 400);

  const missing = await fetch(`${base}/api/does-not-exist`);
  assert.equal(missing.status, 404);
});

test('serves the app shell', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /FlipLab/);
});
