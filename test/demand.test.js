import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buyerInterestText,
  demandSignalScore,
  mergeBuyerInterest,
  normalizeBuyerInterest,
  normalizeGenericOpportunity,
  opportunityScore,
  publicInterestFromText
} from '../lib/demand.js';

test('public buyer-interest counts are normalized and scored', () => {
  const value = normalizeBuyerInterest({ offers: 2, bids: 4, watchers: 10, likes: 25, carts: 1, evidence: ['4 bids'] });
  assert.equal(value.offers, 2);
  assert.equal(value.bids, 4);
  assert.equal(value.hasPublicSignal, true);
  assert.ok(value.score > 0);
  assert.match(buyerInterestText(value), /2 offers/);
});

test('a Make Offer button is not treated as proof of existing offers', () => {
  const value = publicInterestFromText('<button>Make Offer</button><p>Offers accepted</p>');
  assert.equal(value.offers, null);
  assert.equal(value.hasPublicSignal, false);
});

test('visible activity phrases are extracted conservatively', () => {
  const value = publicInterestFromText('<main><span>7 bids</span><span>18 watchers</span><span>4 likes</span></main>');
  assert.equal(value.bids, 7);
  assert.equal(value.watchers, 18);
  assert.equal(value.likes, 4);
  assert.ok(value.evidence.some((entry) => /7 bids/i.test(entry)));
});

test('merged signals keep the strongest public counts without inventing missing data', () => {
  const merged = mergeBuyerInterest(
    { bids: 3, watchers: null, evidence: ['3 bids'] },
    { bids: 5, watchers: 9, evidence: ['5 bids', '9 watchers'] }
  );
  assert.equal(merged.bids, 5);
  assert.equal(merged.watchers, 9);
  assert.equal(merged.offers, null);
});

test('generic opportunities get a small ranking bonus but demand still matters', () => {
  const generic = normalizeGenericOpportunity({ isGeneric: true, reason: 'Title only says work jacket' });
  const plain = opportunityScore(80, {}, {});
  const hiddenGem = opportunityScore(80, {}, generic);
  const active = opportunityScore(80, { bids: 5, watchers: 10 }, {});
  assert.ok(hiddenGem > plain);
  assert.ok(active > plain);
  assert.ok(demandSignalScore({ bids: 5, watchers: 10 }) > 0);
});
