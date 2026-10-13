// Turns an eBay listing into a FlipLab item and runs the flip analysis on it.
import { getListing } from './ebay.js';
import { analyzeItem } from './ai.js';
import { getSettings } from './store.js';

const CONDITION_MAP = [
  [/new with tags|new with box|brand new|^new$/i, 'New with tags'],
  [/new without tags|new without box|new with defects|like new/i, 'Like new'],
  [/excellent/i, 'Excellent'],
  [/fair|acceptable/i, 'Fair'],
  [/parts|not working/i, 'Needs repair'],
  [/pre-owned|used|good/i, 'Good']
];

export function mapCondition(text) {
  const match = CONDITION_MAP.find(([pattern]) => pattern.test(String(text || '')));
  return match ? match[1] : '';
}

export function listingToItem(listing, settings, market = {}) {
  const aspects = Object.entries(listing.aspects || {}).slice(0, 15).map(([name, value]) => `${name}: ${value}`).join('; ');
  const notes = [
    listing.conditionDescription && `Seller condition notes: ${listing.conditionDescription}`,
    aspects && `Item specifics: ${aspects}`,
    listing.description && `Listing description: ${listing.description.slice(0, 1200)}`,
    market.median && `Similar eBay listings currently ask a median of $${market.median} incl. shipping (asking prices, not sold prices).`
  ].filter(Boolean).join('\n');
  return {
    title: listing.title.slice(0, 140),
    brand: listing.brand,
    category: listing.category,
    size: listing.size,
    condition: mapCondition(listing.condition),
    source: 'eBay',
    sourceUrl: listing.url,
    externalId: listing.id,
    purchasePrice: listing.price,
    inboundShipping: listing.shipping ?? 0,
    repairCost: 0,
    outboundShipping: Number(settings.defaultOutboundShipping) || 0,
    marketplaceFeePercent: Number(settings.marketplaceFeePercent) || 0,
    paymentFeePercent: Number(settings.paymentFeePercent) || 0,
    notes: notes.slice(0, 4000),
    referenceImages: listing.images
  };
}

export async function analyzeListing(id, market = {}) {
  const [listing, settings] = await Promise.all([getListing(id), getSettings()]);
  const item = listingToItem(listing, settings, market);
  const analysis = await analyzeItem({ ...item, image: listing.image, images: listing.images.slice(1, 4), marketMedian: market.median });
  // Price the flip at the AI's suggested Depop price.
  item.targetPrice = analysis.depop?.listPrice || Math.round((analysis.estimatedSaleLow + analysis.estimatedSaleHigh) / 2);
  return { listing, item, analysis };
}
