import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { useTempDataDir, PIXEL_PNG } from './helpers.js';

const dir = await useTempDataDir();
const store = await import('../lib/store.js');

test('createItem applies defaults and sanitizes input', async () => {
  const item = await store.createItem({ title: '  Carhartt jacket  ', purchasePrice: '12.345', bogus: 'x', id: 'hijack' });
  assert.equal(item.title, 'Carhartt jacket');
  assert.equal(item.purchasePrice, 12.35);
  assert.equal(item.status, 'watching');
  assert.equal(item.paymentFeePercent, 3.3);
  assert.notEqual(item.id, 'hijack');
  assert.equal('bogus' in item, false);
});

test('rejects unknown statuses and non-http source URLs', async () => {
  await assert.rejects(store.createItem({ status: 'stolen' }), /Unknown status/);
  await assert.rejects(store.createItem({ sourceUrl: 'javascript:alert(1)' }), /http/);
});

test('photos are stored as files, replaced and cleaned up', async () => {
  const item = await store.createItem({ title: 'With photo', image: PIXEL_PNG });
  assert.match(item.image, /^\/uploads\/.+\.png$/);
  const first = path.join(dir, 'uploads', path.basename(item.image));
  await fs.access(first);

  const updated = await store.updateItem(item.id, { image: PIXEL_PNG });
  assert.notEqual(updated.image, item.image);
  await assert.rejects(fs.access(first), 'old photo should be deleted');

  assert.match(await store.imageAsDataUrl(updated.image), /^data:image\/png;base64,/);
  await store.deleteItem(item.id);
  await assert.rejects(fs.access(path.join(dir, 'uploads', path.basename(updated.image))));
});

test('status changes stamp their timestamp once', async () => {
  const item = await store.createItem({ title: 'Stamp me' });
  const bought = await store.updateItem(item.id, { status: 'bought' });
  assert.ok(bought.boughtAt);
  const listed = await store.updateItem(item.id, { status: 'listed' });
  assert.equal(listed.boughtAt, bought.boughtAt);
  assert.ok(listed.listedAt);
});

test('concurrent writes do not lose updates', async () => {
  const item = await store.createItem({ title: 'Race' });
  await Promise.all([
    store.updateItem(item.id, { brand: 'A' }),
    store.updateItem(item.id, { size: 'M' }),
    store.updateItem(item.id, { notes: 'n' }),
    store.createItem({ title: 'Other' })
  ]);
  const saved = await store.getItem(item.id);
  assert.equal(saved.brand, 'A');
  assert.equal(saved.size, 'M');
  assert.equal(saved.notes, 'n');
  const onDisk = JSON.parse(await fs.readFile(path.join(dir, 'db.json'), 'utf8'));
  assert.equal(onDisk.items.find((x) => x.id === item.id).size, 'M');
});

test('returned objects cannot mutate the cache', async () => {
  const [first] = await store.listItems();
  first.title = 'mutated';
  const fresh = await store.getItem(first.id);
  assert.notEqual(fresh.title, 'mutated');
});

test('settings are clamped to sane numbers', async () => {
  const settings = await store.saveSettings({ paymentFeePercent: 250, targetRoiPercent: '80', unknown: 1 });
  assert.equal(settings.paymentFeePercent, 100);
  assert.equal(settings.targetRoiPercent, 80);
  assert.equal('unknown' in settings, false);
});
