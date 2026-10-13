import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicUrl, isBlockedAddress } from '../lib/scraper.js';

test('blocks private and loopback IP ranges', () => {
  for (const address of ['127.0.0.1', '10.0.0.2', '172.16.0.1', '192.168.1.1', '169.254.1.1', '::1', 'fd00::1', 'fe80::1']) {
    assert.equal(isBlockedAddress(address), true, address);
  }
  assert.equal(isBlockedAddress('8.8.8.8'), false);
  assert.equal(isBlockedAddress('2606:4700:4700::1111'), false);
});

test('rejects local URLs and non-http schemes', async () => {
  await assert.rejects(() => assertPublicUrl('http://127.0.0.1:3000/private'));
  await assert.rejects(() => assertPublicUrl('http://localhost:3000/private'));
  await assert.rejects(() => assertPublicUrl('file:///etc/passwd'));
});
