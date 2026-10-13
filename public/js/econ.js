// Unit economics shared by the browser and the server (CSV export).

export const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

export function feeRate(item, settings = {}) {
  const marketplace = item.marketplaceFeePercent ?? settings.marketplaceFeePercent;
  const payment = item.paymentFeePercent ?? settings.paymentFeePercent;
  return (num(marketplace) + num(payment)) / 100;
}

export function calc(item, settings = {}) {
  const landed = num(item.purchasePrice) + num(item.inboundShipping) + num(item.repairCost);
  const target = num(item.targetPrice);
  const sold = item.status === 'sold';
  const salePrice = sold && num(item.soldPrice) > 0 ? num(item.soldPrice) : target;
  const rate = feeRate(item, settings);
  const outbound = num(item.outboundShipping);
  const fees = salePrice * rate;
  const profit = salePrice - landed - outbound - fees;
  const roi = landed > 0 ? (profit / landed) * 100 : null;
  // Lowest sale price that still covers every cost after fees.
  const breakEven = rate < 1 ? (landed + outbound) / (1 - rate) : null;
  // Highest item cost that still hits the target ROI at the target price.
  const targetRoi = num(settings.targetRoiPercent) / 100;
  const maxBuy = target > 0
    ? Math.max(0, (target - outbound - target * rate) / (1 + targetRoi) - num(item.inboundShipping) - num(item.repairCost))
    : null;
  const daysToSell = sold && item.soldAt && (item.boughtAt || item.createdAt)
    ? Math.max(0, Math.round((new Date(item.soldAt) - new Date(item.boughtAt || item.createdAt)) / 86_400_000))
    : null;
  return { landed, target, salePrice, fees, profit, roi, breakEven, maxBuy, sold, daysToSell, hasPrice: salePrice > 0 };
}
