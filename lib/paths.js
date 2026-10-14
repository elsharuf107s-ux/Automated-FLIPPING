import path from 'node:path';

// Everything FlipLab writes lives here. Override with FLIPLAB_DATA_DIR in tests.
export const DATA_DIR = path.resolve(process.env.FLIPLAB_DATA_DIR || path.join(process.cwd(), 'data'));
export const AI_CONFIG_FILE = path.join(DATA_DIR, 'ai-config.json');
export const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
