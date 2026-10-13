import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Point FlipLab at a throwaway data directory. Must run before importing lib/ modules.
export async function useTempDataDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fliplab-test-'));
  process.env.FLIPLAB_DATA_DIR = dir;
  for (const name of ['AI_PROVIDER', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'OLLAMA_BASE_URL', 'OLLAMA_MODEL']) delete process.env[name];
  return dir;
}

export const PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
