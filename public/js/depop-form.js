function clean(value, max = 120) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function combinedText(depop = {}) {
  return [
    depop.description,
    depop.category,
    depop.brand,
    depop.material,
    ...(Array.isArray(depop.styleTags) ? depop.styleTags : []),
    ...(Array.isArray(depop.hashtags) ? depop.hashtags : [])
  ].filter(Boolean).join(' ').toLowerCase();
}

export function inferDepopAge(depop = {}) {
  if (clean(depop.age)) return clean(depop.age, 40);
  const text = combinedText(depop);
  const direct = text.match(/\b(40s|50s|60s|70s|80s|90s|2000s|2010s|2020s)\b/i);
  if (direct) return direct[1];
  if (/\b(y2k|00s|2000's|early 2000s)\b/i.test(text)) return '2000s';
  if (/\b(nineties|1990s)\b/i.test(text)) return '90s';
  if (/\b(eighties|1980s)\b/i.test(text)) return '80s';
  if (/\b(seventies|1970s)\b/i.test(text)) return '70s';
  return 'Not specified';
}

export function inferDepopSource(depop = {}) {
  if (clean(depop.source)) return clean(depop.source, 60);
  const text = combinedText(depop);
  if (/\b(deadstock|new old stock|\bnos\b)\b/i.test(text)) return 'Deadstock';
  if (/\b(handmade|hand made|handcrafted)\b/i.test(text)) return 'Handmade';
  return 'Not specified';
}

export function suggestPackageSize(depop = {}) {
  if (clean(depop.packageSize)) return clean(depop.packageSize, 60);
  const text = combinedText(depop);
  if (/\b(puffer|sherpa|heavy coat|winter coat|parka|boots|blanket|bulky)\b/i.test(text)) return 'Extra large';
  if (/\b(jacket|hoodie|sweatshirt|sweater|jeans|pants|trousers|shoes|sneakers)\b/i.test(text)) return 'Large';
  if (/\b(t-?shirt|shirt|blouse|dress|skirt|shorts|top)\b/i.test(text)) return 'Medium';
  if (/\b(hat|cap|scarf|belt|jewelry|jewellery|wallet|accessor)\b/i.test(text)) return 'Small';
  return 'Check packaged weight';
}

function tinyHash(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().slice(0, 4).padStart(4, '0');
}

function skuPart(value, fallback) {
  const part = clean(value, 30).toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 5);
  return part || fallback;
}

export function generateDepopSku(depop = {}) {
  if (clean(depop.sku)) return clean(depop.sku, 50);
  const brand = skuPart(depop.brand, 'ITEM');
  const category = skuPart(String(depop.category || '').split('>').pop(), 'GEN');
  const size = skuPart(depop.size, 'OS');
  const fingerprint = tinyHash([depop.brand, depop.category, depop.size, depop.description].join('|'));
  return `${brand}-${category}-${size}-${fingerprint}`;
}

export function completeDepopForm(depop = {}) {
  const quantity = Math.max(1, Math.min(99, Math.round(Number(depop.quantity) || 1)));
  return {
    ...depop,
    quantity,
    sku: generateDepopSku(depop),
    source: inferDepopSource(depop),
    age: inferDepopAge(depop),
    shippingMethod: clean(depop.shippingMethod, 80) || 'Depop Shipping (via USPS)',
    packageSize: suggestPackageSize(depop),
    shippingAddress: clean(depop.shippingAddress, 160) || 'Use your saved Depop seller address',
    sourceNeedsReview: inferDepopSource(depop) === 'Not specified',
    ageNeedsReview: inferDepopAge(depop) === 'Not specified',
    packageNeedsReview: suggestPackageSize(depop) === 'Check packaged weight'
  };
}
