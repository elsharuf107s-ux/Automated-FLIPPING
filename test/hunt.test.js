import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedHuntUrl, normalizeHuntPrompt, HUNT_SOURCES } from '../lib/hunt.js';

test('AI Hunt exposes a broad default marketplace set', () => {
  const names = HUNT_SOURCES.map((source) => source.name);
  for (const expected of ['eBay', 'Depop', 'Poshmark', 'Mercari', 'ShopGoodwill']) {
    assert.ok(names.includes(expected));
  }
});

test('AI Hunt accepts direct URLs on supported marketplaces', () => {
  assert.equal(isAllowedHuntUrl('https://www.ebay.com/itm/123'), true);
  assert.equal(isAllowedHuntUrl('https://depop.com/products/example'), true);
  assert.equal(isAllowedHuntUrl('https://www.mercari.com/us/item/m123/'), true);
});

test('AI Hunt rejects lookalike and unrelated domains', () => {
  assert.equal(isAllowedHuntUrl('https://ebay.com.evil.example/item/1'), false);
  assert.equal(isAllowedHuntUrl('https://example.com/item/1'), false);
  assert.equal(isAllowedHuntUrl('file:///etc/passwd'), false);
});

test('AI Hunt normalizes ordinary language prompts', () => {
  assert.equal(
    normalizeHuntPrompt('  find   vintage Nike jackets   under $40  '),
    'find vintage Nike jackets under $40'
  );
  assert.throws(() => normalizeHuntPrompt('a'), /Tell AI Hunt/);
});
