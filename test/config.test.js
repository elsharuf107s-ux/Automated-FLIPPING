import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { useTempDataDir } from './helpers.js';

const dir = await useTempDataDir();
delete process.env.OPENAI_API_KEY;
const config = await import('../lib/config.js');

const KEY = 'sk-proj-test-0123456789abcdefghijklmnop';

test('defaults to OpenAI with no key', async () => {
  const pub = await config.publicAiConfig();
  assert.equal(pub.provider, 'openai');
  assert.equal(pub.configured, false);
  assert.equal(pub.openai.keySet, false);
});

test('environment key is used and masked', async () => {
  process.env.OPENAI_API_KEY = 'sk-env-key-0123456789abcdefghij';
  const pub = await config.publicAiConfig();
  assert.equal(pub.configured, true);
  assert.equal(pub.sources.openaiApiKey, 'env');
  assert.equal(pub.openai.keyPreview, 'sk-…ghij');
  assert.equal(JSON.stringify(pub).includes('0123456789'), false);
});

test('saved key overrides the environment and is stored privately', async () => {
  const pub = await config.saveAiConfig({ openaiApiKey: KEY, openaiModel: 'my-model' });
  assert.equal(pub.sources.openaiApiKey, 'app');
  assert.equal(pub.openai.model, 'my-model');
  assert.equal(JSON.stringify(pub).includes(KEY), false);
  assert.equal((await config.resolveAiConfig()).openaiApiKey, KEY);

  const file = path.join(dir, 'ai-config.json');
  const stat = await fs.stat(file);
  if (process.platform !== 'win32') assert.equal(stat.mode & 0o777, 0o600);
});

test('clearing the saved key falls back to the environment', async () => {
  const pub = await config.saveAiConfig({ openaiApiKey: '' });
  assert.equal(pub.sources.openaiApiKey, 'env');
  delete process.env.OPENAI_API_KEY;
  assert.equal((await config.publicAiConfig()).openai.keySet, false);
});

test('validates only the settings the lean app supports', () => {
  assert.throws(() => config.validateAiPatch({ provider: 'ollama' }), /uses OpenAI/);
  assert.throws(() => config.validateAiPatch({ openaiApiKey: 'short' }), /valid OpenAI API key/);
  assert.throws(() => config.validateAiPatch({ openaiApiKey: 'sk-has spaces in the middle of it' }), /valid OpenAI API key/);
  assert.throws(() => config.validateAiPatch({ openaiModel: 'two words' }), /spaces/);
});

test('draft model overrides work without saving', async () => {
  const resolved = await config.resolveAiConfig({ openaiModel: 'temporary-model' });
  assert.equal(resolved.openaiModel, 'temporary-model');
  assert.equal(resolved.provider, 'openai');
  assert.notEqual((await config.resolveAiConfig()).openaiModel, 'temporary-model');
});
