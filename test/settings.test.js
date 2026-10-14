import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { useTempDataDir } from './helpers.js';

const dir = await useTempDataDir();
const settings = await import('../lib/settings.js');

test('settings start with sensible defaults', async () => {
  const value = await settings.getSettings();
  assert.equal(value.paymentFeePercent, 3.3);
  assert.equal(value.targetRoiPercent, 75);
});

test('settings save only supported numeric fields', async () => {
  const value = await settings.saveSettings({
    marketplaceFeePercent: 4.25,
    defaultOutboundShipping: 8.5,
    randomJunk: 999
  });
  assert.equal(value.marketplaceFeePercent, 4.25);
  assert.equal(value.defaultOutboundShipping, 8.5);
  assert.equal('randomJunk' in value, false);

  const disk = JSON.parse(await fs.readFile(path.join(dir, 'settings.json'), 'utf8'));
  assert.equal(disk.defaultOutboundShipping, 8.5);
});
