import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDataDir } from './helpers.js';
import { startFakeEbay, FAKE_CLIENT_ID, FAKE_CLIENT_SECRET } from './fake-ebay.js';

await useTempDataDir();
process.env.AI_PROVIDER = 'demo';
const fake = await startFakeEbay();
process.env.EBAY_API_BASE = fake.url;

const { app } = await import('../server.js');
const { htmlToText } = await import('../lib/ebay.js');
const { mapCondition } = await import('../lib/finder.js');

let server;
let base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await fake.close();
});

const post = (path, body, method = 'POST') => fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('search explains that eBay keys are needed', async () => {
  const res = await post('/api/finder/search', { query: 'carhartt' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /eBay Client ID/);
});

test('connection test reports bad and good keys', async () => {
  const bad = await (await post('/api/ai-config/test', { target: 'ebay', ebayClientId: FAKE_CLIENT_ID, ebayClientSecret: 'PRD-wrong-secret-000' })).json();
  assert.equal(bad.ok, false);
  assert.match(bad.message, /rejected/);
  const good = await (await post('/api/ai-config/test', { target: 'ebay', ebayClientId: FAKE_CLIENT_ID, ebayClientSecret: FAKE_CLIENT_SECRET })).json();
  assert.equal(good.ok, true);
});

test('eBay keys save from the app and the secret never comes back', async () => {
  const res = await post('/api/ai-config', { ebayClientId: FAKE_CLIENT_ID, ebayClientSecret: FAKE_CLIENT_SECRET }, 'PATCH');
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.equal(text.includes(FAKE_CLIENT_SECRET), false);
  assert.equal(JSON.parse(text).ebay.configured, true);
});

test('search returns normalized, price-checked listings ranked against the market', async () => {
  const res = await post('/api/finder/search', { query: 'carhartt detroit jacket', maxPrice: 60, condition: 'used' });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.ok(body.listings.length > 0);
  assert.ok(body.listings.every((l) => l.price <= 60), 'max price is enforced even if eBay ignores it');
  assert.ok(body.market.median > 0);
  const pcts = body.listings.map((l) => l.belowMarketPct);
  assert.deepEqual(pcts, [...pcts].sort((a, b) => b - a), 'best deals first');
  const first = body.listings[0];
  assert.ok(first.id && first.title && first.url && first.image);
  assert.equal(first.total, Math.round((first.price + first.shipping) * 100) / 100);

  const searchCall = fake.calls.find((c) => c.path.endsWith('/item_summary/search') && c.query.filter.includes('price:'));
  assert.match(searchCall.query.filter, /price:\[\.\.60\]/);
  assert.match(searchCall.query.filter, /priceCurrency:USD/);
  assert.match(searchCall.query.filter, /conditions:\{USED\}/);
  assert.match(searchCall.query.filter, /buyingOptions:\{FIXED_PRICE\|AUCTION\}/);
  assert.match(searchCall.query.filter, /deliveryCountry:US/);
  assert.equal(searchCall.marketplace, 'EBAY_US');
});

test('search validates input', async () => {
  assert.equal((await post('/api/finder/search', { query: 'a' })).status, 400);
  assert.equal((await post('/api/finder/search', { query: 'jacket', minPrice: 50, maxPrice: 10 })).status, 400);
});

test('listing details include specifics and a safe text description', async () => {
  const res = await fetch(`${base}/api/finder/listings/${encodeURIComponent('v1|110000|0')}`);
  const listing = await res.json();
  assert.equal(listing.brand, 'Carhartt');
  assert.equal(listing.size, 'L');
  assert.equal(listing.aspects['Outer Shell Material'], 'Cotton Duck');
  assert.equal(listing.description.includes('<'), false);
  assert.equal(listing.description.includes('alert'), false);
  assert.equal(listing.images.length, 4);
  assert.equal((await fetch(`${base}/api/finder/listings/${encodeURIComponent('v1|999|0')}`)).status, 404);
});

test('analyzing a listing returns pricing and a full Depop listing', async () => {
  const res = await post('/api/finder/analyze', { id: 'v1|110000|0', market: { median: 80 } });
  const { listing, item, analysis } = await res.json();
  assert.equal(res.status, 200);
  assert.equal(listing.id, 'v1|110000|0');
  assert.equal(item.externalId, 'v1|110000|0');
  assert.equal(item.purchasePrice, 34.99);
  assert.equal(item.inboundShipping, 9.5);
  assert.equal(item.condition, 'Good');
  assert.equal(item.source, 'eBay');
  assert.match(item.notes, /median of \$80/);
  const depop = analysis.depop;
  assert.ok(depop.description.length > 10);
  assert.ok(depop.listPrice > 0);
  assert.ok(depop.minOfferPrice <= depop.listPrice);
  assert.ok(depop.hashtags.length <= 5);
  assert.ok(['Brand new', 'Like new', 'Used - Excellent', 'Used - Good', 'Used - Fair'].includes(depop.condition));
  assert.equal(item.targetPrice, depop.listPrice);

  const saved = await (await post('/api/items', { ...item, ai: analysis, status: 'bought' })).json();
  assert.equal(saved.externalId, 'v1|110000|0');
  assert.equal(saved.status, 'bought');
  assert.deepEqual(saved.referenceImages, [], 'non-https photo URLs are dropped');
  assert.equal(saved.ai.depop.listPrice, depop.listPrice);
});

test('saved searches can be created, listed and deleted', async () => {
  const created = await (await post('/api/finder/searches', { query: 'patagonia synchilla', maxPrice: 40, sort: 'newest', format: 'bogus' })).json();
  assert.equal(created.name, 'patagonia synchilla');
  assert.equal(created.format, 'all');
  assert.equal(created.sort, 'newest');
  const list = await (await fetch(`${base}/api/finder/searches`)).json();
  assert.equal(list.length, 1);
  assert.equal((await fetch(`${base}/api/finder/searches/${created.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await fetch(`${base}/api/finder/searches/${created.id}`, { method: 'DELETE' })).status, 404);
});

test('helpers: eBay condition mapping and HTML stripping', () => {
  assert.equal(mapCondition('New with tags'), 'New with tags');
  assert.equal(mapCondition('New without tags'), 'Like new');
  assert.equal(mapCondition('Pre-owned - Excellent'), 'Excellent');
  assert.equal(mapCondition('Pre-owned'), 'Good');
  assert.equal(mapCondition('For parts or not working'), 'Needs repair');
  assert.equal(htmlToText('<p>A &amp; B</p><style>x{}</style><br>C'), 'A & B\nC');
});
