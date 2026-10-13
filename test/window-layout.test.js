import test from 'node:test';
import assert from 'node:assert/strict';
import { clampWindowRect, defaultDesktopLayout, sanitizeDesktopLayout } from '../public/js/window-layout.js';

test('desktop window rectangles stay inside the workspace', () => {
  assert.deepEqual(
    clampWindowRect({ left: 900, top: 700, width: 700, height: 500 }, { width: 1200, height: 800 }),
    { left: 500, top: 300, width: 700, height: 500 }
  );
});

test('desktop layout opens hunt and scanner side by side by default', () => {
  const layout = defaultDesktopLayout(1200, 700);
  assert.equal(layout.finder.minimized, false);
  assert.equal(layout.scanner.minimized, false);
  assert.equal(layout.inventory.minimized, true);
  assert.ok(layout.finder.left + layout.finder.width <= layout.scanner.left);
});

test('stored desktop layout is sanitized after a viewport change', () => {
  const layout = sanitizeDesktopLayout({
    finder: { left: 9999, top: -100, width: 3000, height: 3000, minimized: false },
    scanner: { minimized: true }
  }, 1000, 600);
  assert.equal(layout.finder.left, 0);
  assert.equal(layout.finder.top, 0);
  assert.equal(layout.finder.width, 1000);
  assert.equal(layout.finder.height, 600);
  assert.equal(layout.scanner.minimized, true);
});
