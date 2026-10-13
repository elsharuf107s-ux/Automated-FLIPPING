import path from 'node:path';

// Everything FlipLab writes lives here. Override with FLIPLAB_DATA_DIR (used by tests).
export const DATA_DIR = path.resolve(process.env.FLIPLAB_DATA_DIR || path.join(process.cwd(), 'data'));
export const DB_FILE = path.join(DATA_DIR, 'db.json');
export const AI_CONFIG_FILE = path.join(DATA_DIR, 'ai-config.json');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
