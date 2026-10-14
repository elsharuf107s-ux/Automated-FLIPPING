import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAllowedSupplierUrl,
  supplierSourceForUrl,
  supplierSearchOnly,
  normalizeSupplierMatches,
  attachSupplierMatches
} from '../lib/suppliers.js';

test('supplier matcher accepts AliExpress, DHgate, and Temu product domains only', () => {
  assert.equal(isAllowedSupplierUrl('https://www.aliexpress.com/item/100500123.html'), true);
  assert.equal(isAllowedSupplierUrl('https://www.aliexpress.us/item/100500123.html'), true);
  assert.equal(isAllowedSupplierUrl('https://www.dhgate.com/product/example/123.html'), true);
  assert.equal(isAllowedSupplierUrl('https://www.temu.com/example-g-123.html'), true);
  assert.equal(isAllowedSupplierUrl('https://temu.com.evil.example/item/1'), false);
  assert.equal(isAllowedSupplierUrl('https://example.com/item/1'), false);
});

test('supplier matcher identifies sources and keeps Temu search-only', () => {
  assert.equal(supplierSourceForUrl('https://www.aliexpress.com/item/1.html'), 'AliExpress');
  assert.equal(supplierSourceForUrl('https://m.dhgate.com/product/thing/1.html'), 'DHgate');
  assert.equal(supplierSourceForUrl('https://www.temu.com/item-g-1.html'), 'Temu');
  assert.equal(supplierSearchOnly('Temu'), true);
  assert.equal(supplierSearchOnly('AliExpress'), false);
});

test('supplier matcher keeps cheaper clothing matches and computes savings', () => {
  const targets = [{
    url: 'https://www.ebay.com/itm/123',
    title: 'Work jacket',
    price: 40,
    shipping: 5
  }];
  const matches = normalizeSupplierMatches([
    {
      targetUrl: targets[0].url,
      title: 'Canvas work jacket',
      url: 'https://www.aliexpress.com/item/1005001.html',
      source: 'AliExpress',
      price: 14,
      currency: 'USD',
      shipping: 3,
      matchType: 'similar',
      matchConfidence: 86,
      why: 'Similar canvas chore-jacket cut.',
      differences: ['No visible brand', 'Different pocket layout'],
      garmentType: 'Work jacket',
      color: 'Brown',
      material: 'Canvas',
      sizeRange: 'S-XXL',
      brandStatus: 'unbranded'
    },
    {
      targetUrl: targets[0].url,
      title: 'Expensive jacket',
      url: 'https://www.dhgate.com/product/example/2.html',
      source: 'DHgate',
      price: 49,
      currency: 'USD',
      shipping: 0,
      matchType: 'similar',
      matchConfidence: 90,
      why: 'Similar jacket.',
      differences: [],
      garmentType: 'Jacket',
      color: '',
      material: '',
      sizeRange: '',
      brandStatus: 'unknown'
    }
  ], targets);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].landedCost, 17);
  assert.equal(matches[0].referenceCost, 45);
  assert.equal(matches[0].savings, 28);
  assert.equal(matches[0].brandSafety, 'list-as-generic');
});

test('supplier matcher attaches the best cheaper option to its resale target', () => {
  const items = [{ url: 'https://www.ebay.com/itm/123', title: 'Jacket' }];
  const matches = [
    { targetUrl: items[0].url, source: 'AliExpress', matchConfidence: 88 },
    { targetUrl: items[0].url, source: 'DHgate', matchConfidence: 70 }
  ];
  const result = attachSupplierMatches(items, matches);
  assert.equal(result[0].supplierMatches.length, 2);
  assert.equal(result[0].bestSupplier.source, 'AliExpress');
});
