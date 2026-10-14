function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function eligibleSupplier(supplier) {
  if (!supplier?.url || supplier.searchOnly) return false;
  try {
    const host = new URL(supplier.url).hostname.toLowerCase();
    return host === 'aliexpress.com' || host.endsWith('.aliexpress.com') ||
      host === 'aliexpress.us' || host.endsWith('.aliexpress.us') ||
      host === 'dhgate.com' || host.endsWith('.dhgate.com');
  } catch {
    return false;
  }
}

export function selectVerificationCandidates(items = [], { limit = 3, isDone = () => false } = {}) {
  const candidates = [];
  const seen = new Set();

  for (const item of Array.isArray(items) ? items : []) {
    const suppliers = Array.isArray(item?.supplierMatches) && item.supplierMatches.length
      ? item.supplierMatches
      : item?.bestSupplier ? [item.bestSupplier] : [];

    for (const supplier of suppliers) {
      if (!eligibleSupplier(supplier) || seen.has(supplier.url) || isDone(supplier.url)) continue;
      seen.add(supplier.url);
      const score =
        num(item?.opportunityScore) * 2 +
        num(item?.matchScore) * 0.5 +
        num(supplier?.matchConfidence) +
        Math.max(0, num(supplier?.savingsPercent));
      candidates.push({ supplier, reference: item, score });
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, Math.floor(num(limit, 3))));
}

export function hasEligibleVerificationSupplier(items = []) {
  return selectVerificationCandidates(items, { limit: 1 }).length > 0;
}
