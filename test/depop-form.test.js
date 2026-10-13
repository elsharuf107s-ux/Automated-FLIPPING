import test from 'node:test';
import assert from 'node:assert/strict';
import {
  completeDepopForm,
  depopPriceTargets,
  generateDepopSku,
  inferDepopAge,
  inferDepopSource,
  suggestPackageSize
} from '../public/js/depop-form.js';

test('Depop form helper fills quantity, SKU, shipping and pricing targets', () => {
  const form = completeDepopForm({
    description: 'Carhartt sherpa-lined hooded jacket, size L',
    brand: 'Carhartt',
    category: 'Jackets',
    size: 'L',
    listPrice: 49,
    minOfferPrice: 39,
    styleTags: ['Streetwear']
  });
  assert.equal(form.quantity, 1);
  assert.match(form.sku, /^CARHA-JACKE-L-/);
  assert.equal(form.packageSize, 'Extra large');
  assert.equal(form.shippingMethod, 'Depop Shipping (via USPS)');
  assert.deepEqual(
    [form.likelyToSellPrice, form.balancedPrice, form.lessLikelyPrice],
    [39, 49, 57]
  );
});

test('Depop helper only labels deadstock or an era when there is evidence', () => {
  assert.equal(inferDepopSource({ description: 'pre-owned workwear jacket' }), 'Not specified');
  assert.equal(inferDepopAge({ description: 'pre-owned workwear jacket' }), 'Not specified');
  assert.equal(inferDepopSource({ description: 'new old stock deadstock jacket' }), 'Deadstock');
  assert.equal(inferDepopAge({ description: '90s Carhartt chore coat' }), '90s');
  assert.equal(inferDepopAge({ styleTags: ['Y2K'] }), '2000s');
});

test('Depop package suggestions follow the item type', () => {
  assert.equal(suggestPackageSize({ description: 'heavy sherpa winter jacket' }), 'Extra large');
  assert.equal(suggestPackageSize({ category: 'T-Shirts' }), 'Medium');
  assert.equal(suggestPackageSize({ category: 'Hats' }), 'Small');
});

test('Depop SKU is stable for the same listing inputs', () => {
  const item = { brand: 'Nike', category: 'Jackets', size: 'M', description: 'black windbreaker' };
  assert.equal(generateDepopSku(item), generateDepopSku(item));
});

test('Depop price targets use list price as balanced and offer floor as likely-to-sell', () => {
  assert.deepEqual(depopPriceTargets({ listPrice: 50, minOfferPrice: 40 }), {
    likelyToSellPrice: 40,
    balancedPrice: 50,
    lessLikelyPrice: 58
  });
});
