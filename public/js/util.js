export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const currencyWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export const money = (value) => currency.format(Number(value) || 0);

// Whole dollars for big tiles; compact once it gets long ($12.9K).
export function moneyShort(value) {
  const n = Number(value) || 0;
  if (Math.abs(n) >= 10_000) return `${n < 0 ? '-' : ''}$${compact.format(Math.abs(n))}`;
  return currencyWhole.format(n);
}

export const signedMoney = (value) => `${value > 0 ? '+' : ''}${money(value)}`;
export const pct = (value) => (value == null || !Number.isFinite(value) ? '—' : `${Math.round(value)}%`);

export function esc(value = '') {
  return String(value ?? '').replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

export function timeAgo(iso) {
  if (!iso) return '';
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return 'just now';
  const units = [[60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month'], [Infinity, 'year']];
  let value = seconds / 60;
  for (const [step, unit] of units) {
    if (value < step) {
      const n = Math.floor(value);
      return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
    }
    value /= step;
  }
  return '';
}

export function shortDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function debounce(fn, wait = 150) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

// Resize + re-encode in the browser so uploads stay small and fast.
export function compressImage(file, max = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith('image/')) {
      reject(new Error('That file is not an image.'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image.'));
    };
    img.src = url;
  });
}

export function compsUrl(engine, query) {
  const q = encodeURIComponent(String(query || '').trim());
  if (engine === 'poshmark') return `https://poshmark.com/search?query=${q}&availability=sold_out`;
  if (engine === 'depop') return `https://www.depop.com/search/?q=${q}`;
  return `https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1`;
}

export const itemQuery = (item) => [item.brand, item.title || item.category, item.size].filter(Boolean).join(' ');

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context; fall back for plain-http previews.
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

export function listingText(ai) {
  const tags = (ai.keywords || []).map((k) => `#${String(k).replace(/\s+/g, '')}`).join(' ');
  return [ai.suggestedTitle, ai.suggestedDescription, tags].filter(Boolean).join('\n\n');
}
