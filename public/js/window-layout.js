export const MIN_WINDOW_WIDTH = 360;
export const MIN_WINDOW_HEIGHT = 260;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clampWindowRect(rect = {}, bounds = {}) {
  const maxWidth = Math.max(MIN_WINDOW_WIDTH, finite(bounds.width, 1280));
  const maxHeight = Math.max(MIN_WINDOW_HEIGHT, finite(bounds.height, 720));
  const width = Math.min(maxWidth, Math.max(MIN_WINDOW_WIDTH, finite(rect.width, 640)));
  const height = Math.min(maxHeight, Math.max(MIN_WINDOW_HEIGHT, finite(rect.height, 520)));
  const left = Math.min(Math.max(0, finite(rect.left)), Math.max(0, maxWidth - width));
  const top = Math.min(Math.max(0, finite(rect.top)), Math.max(0, maxHeight - height));
  return { left, top, width, height };
}

export function defaultDesktopLayout(width = 1280, height = 720) {
  const w = Math.max(720, finite(width, 1280));
  const h = Math.max(520, finite(height, 720));
  const gap = 12;
  const usableW = w - gap * 3;
  const finderW = Math.round(usableW * 0.54);
  const scannerW = usableW - finderW;
  const windowH = Math.max(420, h - gap * 2);

  return {
    finder: {
      ...clampWindowRect({ left: gap, top: gap, width: finderW, height: windowH }, { width: w, height: h }),
      minimized: false,
      maximized: false
    },
    scanner: {
      ...clampWindowRect({ left: gap * 2 + finderW, top: gap, width: scannerW, height: windowH }, { width: w, height: h }),
      minimized: false,
      maximized: false
    },
    settings: {
      ...clampWindowRect({ left: Math.round(w * 0.24), top: 38, width: Math.round(w * 0.56), height: Math.round(h * 0.76) }, { width: w, height: h }),
      minimized: true,
      maximized: false
    }
  };
}

export function sanitizeDesktopLayout(raw = {}, width = 1280, height = 720) {
  const defaults = defaultDesktopLayout(width, height);
  const next = {};
  for (const [view, fallback] of Object.entries(defaults)) {
    const value = raw?.[view] && typeof raw[view] === 'object' ? raw[view] : {};
    next[view] = {
      ...clampWindowRect({ ...fallback, ...value }, { width, height }),
      minimized: Boolean(value.minimized ?? fallback.minimized),
      maximized: Boolean(value.maximized ?? fallback.maximized)
    };
  }
  return next;
}
