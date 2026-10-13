// A tiny stand-in for the eBay Browse API, used by tests and local UI checks.
// Run directly to serve it on a port: node test/fake-ebay.js 4010
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export const FAKE_CLIENT_ID = 'Test-FlipLab-PRD-123456789';
export const FAKE_CLIENT_SECRET = 'PRD-abcdef123456-7890';

const COLORS = ['#7b5b3a', '#2f4f6f', '#4a6b3d', '#8a2f2f', '#5b4a7a', '#2f6b66', '#7a6a2f', '#444'];

function svgImage(n) {
  const color = COLORS[n % COLORS.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#f3f3f0"/>
    <path d="M120 90 L170 70 Q200 95 230 70 L280 90 L330 150 L295 175 L280 160 L280 330 L120 330 L120 160 L105 175 L70 150 Z" fill="${color}"/>
    <text x="200" y="380" font-family="sans-serif" font-size="22" fill="#888" text-anchor="middle">photo ${n}</text></svg>`;
}

const BASE_ITEMS = [
  ['Vintage Carhartt Detroit Jacket Blanket Lined Brown Duck Size L', 34.99, 9.5, 'Pre-owned - Good', 'Carhartt', 'L'],
  ['Carhartt Detroit J97 Jacket Black Mens Large Workwear', 89, 0, 'Pre-owned - Excellent', 'Carhartt', 'L'],
  ['Carhartt Chore Coat Blanket Lined Tan Medium', 42, 12, 'Pre-owned - Good', 'Carhartt', 'M'],
  ['Vintage 90s Carhartt Detroit Jacket Faded Brown XL USA Made', 118, 0, 'Pre-owned - Fair', 'Carhartt', 'XL'],
  ['Carhartt Detroit Jacket Moss Green Size Small Rare Color', 27.5, 8, 'Pre-owned', 'Carhartt', 'S'],
  ['Carhartt WIP Detroit Jacket Navy New With Tags', 175, 0, 'New with tags', 'Carhartt WIP', 'M'],
  ['Carhartt Duck Detroit Jacket Distressed Thrashed 2XL', 55, 10, 'Pre-owned - Good', 'Carhartt', 'XXL'],
  ['Lot of 3 Carhartt Jackets Assorted Sizes', 64, 15, 'Pre-owned', 'Carhartt', 'Various']
];

export function fakeItems(base) {
  return BASE_ITEMS.map(([title, price, shipping, condition, brand, size], i) => ({
    itemId: `v1|11000${i}|0`,
    title,
    price: { value: price.toFixed(2), currency: 'USD' },
    shippingOptions: [{ shippingCostType: 'FIXED', shippingCost: { value: shipping.toFixed(2), currency: 'USD' } }],
    image: { imageUrl: `${base}/img/${i}.svg` },
    additionalImages: [1, 2, 3].map((k) => ({ imageUrl: `${base}/img/${i + k}.svg` })),
    itemWebUrl: `https://www.ebay.com/itm/11000${i}`,
    condition,
    buyingOptions: i === 4 ? ['AUCTION'] : ['FIXED_PRICE'],
    bidCount: i === 4 ? 3 : undefined,
    itemEndDate: new Date(Date.now() + (i + 2) * 3_600_000).toISOString(),
    seller: { username: `seller_${i}`, feedbackPercentage: (99.9 - i / 10).toFixed(1), feedbackScore: 1200 - i * 40 },
    itemLocation: { country: 'US' },
    categories: [{ categoryName: 'Coats, Jackets & Vests' }],
    _brand: brand,
    _size: size
  }));
}

export function startFakeEbay(port = 0) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const base = `http://${req.headers.host}`;
    calls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization, marketplace: req.headers['x-ebay-c-marketplace-id'] });
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };

    if (url.pathname.startsWith('/img/')) return send(200, svgImage(Number.parseInt(path.basename(url.pathname), 10) || 0), 'image/svg+xml');

    if (url.pathname === '/identity/v1/oauth2/token' && req.method === 'POST') {
      const expected = `Basic ${Buffer.from(`${FAKE_CLIENT_ID}:${FAKE_CLIENT_SECRET}`).toString('base64')}`;
      if (req.headers.authorization !== expected) return send(401, { error: 'invalid_client', error_description: 'client authentication failed' });
      return send(200, { access_token: 'fake-token', expires_in: 7200, token_type: 'Application Access Token' });
    }

    if (req.headers.authorization !== 'Bearer fake-token') return send(401, { errors: [{ message: 'Invalid access token' }] });

    if (url.pathname === '/buy/browse/v1/item_summary/search') {
      const items = fakeItems(base).map(({ _brand, _size, ...item }) => item);
      return send(200, { total: items.length, itemSummaries: items });
    }

    const match = url.pathname.match(/^\/buy\/browse\/v1\/item\/(.+)$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const item = fakeItems(base).find((entry) => entry.itemId === id);
      if (!item) return send(404, { errors: [{ message: 'Item not found' }] });
      const { _brand, _size, ...rest } = item;
      return send(200, {
        ...rest,
        brand: _brand,
        size: _size,
        color: 'Brown',
        categoryPath: 'Clothing, Shoes & Accessories|Men|Men\'s Clothing|Coats, Jackets & Vests',
        conditionDescription: 'Light fading on cuffs, small mark on back. No rips.',
        localizedAspects: [
          { type: 'STRING', name: 'Brand', value: _brand },
          { type: 'STRING', name: 'Size', value: _size },
          { type: 'STRING', name: 'Outer Shell Material', value: 'Cotton Duck' },
          { type: 'STRING', name: 'Department', value: 'Men' },
          { type: 'STRING', name: 'Style', value: 'Chore Coat' }
        ],
        description: '<div><p>Great vintage jacket.</p><p>Pit to pit 24&quot; &amp; length 28&quot;.</p><script>alert(1)</script></div>'
      });
    }
    return send(404, { errors: [{ message: 'Not found' }] });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((done) => server.close(done)) });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { url } = await startFakeEbay(Number(process.argv[2]) || 4010);
  console.log(`Fake eBay API on ${url}`);
}
