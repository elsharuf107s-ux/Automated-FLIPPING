import test from 'node:test';
import assert from 'node:assert/strict';
import { hasEligibleVerificationSupplier, selectVerificationCandidates } from '../public/js/agent-queue.js';

const item = (overrides = {}) => ({
  url: 'https://example.com/reference',
  opportunityScore: 80,
  matchScore: 85,
  supplierMatches: [],
  ...overrides
});

const supplier = (url, overrides = {}) => ({
  url,
  matchConfidence: 80,
  savingsPercent: 40,
  searchOnly: false,
  ...overrides
});

test('browser queue looks through all supplier matches instead of only bestSupplier', () => {
  const temu = supplier('https://www.temu.com/product.html', { source: 'Temu', searchOnly: true, matchConfidence: 95 });
  const ali = supplier('https://www.aliexpress.com/item/123.html', { source: 'AliExpress', matchConfidence: 82 });
  const candidate = item({ bestSupplier: temu, supplierMatches: [temu, ali] });
  const selected = selectVerificationCandidates([candidate]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].supplier.url, ali.url);
});

test('browser queue supports DHgate and ignores unrelated or search-only domains', () => {
  const candidates = selectVerificationCandidates([
    item({ supplierMatches: [supplier('https://www.dhgate.com/product/x.html')] }),
    item({ supplierMatches: [supplier('https://www.temu.com/x.html', { searchOnly: true })] }),
    item({ supplierMatches: [supplier('https://example.com/x.html')] })
  ]);
  assert.equal(candidates.length, 1);
  assert.match(candidates[0].supplier.url, /dhgate/);
});

test('browser queue deduplicates and skips already queued or verified URLs', () => {
  const url = 'https://www.aliexpress.com/item/777.html';
  const selected = selectVerificationCandidates([
    item({ supplierMatches: [supplier(url)] }),
    item({ supplierMatches: [supplier(url)] }),
    item({ supplierMatches: [supplier('https://www.dhgate.com/product/ok.html')] })
  ], { isDone: (value) => value === url });
  assert.equal(selected.length, 1);
  assert.match(selected[0].supplier.url, /dhgate/);
});

test('browser queue ranks stronger opportunities before weaker ones', () => {
  const weaker = item({ opportunityScore: 25, supplierMatches: [supplier('https://www.aliexpress.com/item/weak.html', { matchConfidence: 70 })] });
  const stronger = item({ opportunityScore: 92, supplierMatches: [supplier('https://www.dhgate.com/product/strong.html', { matchConfidence: 90 })] });
  const selected = selectVerificationCandidates([weaker, stronger], { limit: 1 });
  assert.match(selected[0].supplier.url, /strong/);
});

test('eligibility helper reports when a Hunt has something the local browser can verify', () => {
  assert.equal(hasEligibleVerificationSupplier([item({ supplierMatches: [supplier('https://www.temu.com/x', { searchOnly: true })] })]), false);
  assert.equal(hasEligibleVerificationSupplier([item({ supplierMatches: [supplier('https://www.aliexpress.us/item/1.html')] })]), true);
});
