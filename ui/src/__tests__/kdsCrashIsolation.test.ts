// ── Crash isolation for the KDS surfaces ────────────────────────────────
//
// WHY THIS EXISTS
//
// The restaurant POS has 33 <LocalizedErrorBoundary> wrappers and a guard
// (restaurantPosCrashIsolation.test.ts) that keeps its scoped surfaces wrapped.
// The KDS has NONE, and no guard — so every fault under it reaches the app-level
// boundary in AppProviders whose recovery is a FULL RELOAD after
// ERROR_AUTO_REFRESH_MS (AppProviders.tsx:88).
//
// That is the wrong trade for this screen specifically. The KDS is a
// wall-mounted kitchen display showing live tickets: a reload blanks the board
// mid-service and every cook loses the queue at once. The POS comment states the
// intent this screen is missing — "a scoped failure never reloads the whole POS".
//
// WHY THE MAIN CONTENT IS THE FIRST TARGET
//
// KdsMainContent is driven entirely by live server data — filteredOrders,
// slaThresholds, prefs, per-order line items — which is where a malformed payload
// throws. Its siblings (header, chips, notices) render local state, so they are
// listed too but the board is the one whose fault takes the kitchen down.
//
// A static scan rather than a render test, for the same reason the POS guard gives:
// mounting KdsScreen needs a session, a queue, preferences and realtime — a render
// test would have to mock the component it is checking and could pass with the
// boundary removed.

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(process.cwd(), 'src');

interface GuardedSurface {
  file: string;
  element: RegExp;
  why: string;
}

const SURFACES: GuardedSurface[] = [
  {
    file: path.join(SRC, 'features/kds/KdsScreen.tsx'),
    element: /<KdsMainContent\b/,
    why: 'the ticket board: live orders, SLA and per-line data — a throw here blanks the kitchen',
  },
  {
    file: path.join(SRC, 'features/kds/KdsScreen.tsx'),
    element: /<KdsNoticeBanners\b/,
    why: 'offline / device notices: driven by connection state',
  },
  {
    file: path.join(SRC, 'features/kds/KdsScreen.tsx'),
    element: /<KdsZoneChips\b/,
    why: 'zone filter chips: derived from the order set',
  },
];

/**
 * Whether `element` appears inside a <LocalizedErrorBoundary> region. Text scan,
 * not a parser — the assertion is "depth >= 1" and nothing about props.
 */
function elementInsideBoundary(file: string, element: RegExp): { found: boolean; depth: number } {
  const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/);
  let depth = 0;
  for (const line of lines) {
    if (/<\/LocalizedErrorBoundary>/.test(line)) depth = Math.max(0, depth - 1);
    if (element.test(line)) return { found: true, depth };
    if (/<LocalizedErrorBoundary\b/.test(line)) depth += 1;
  }
  return { found: false, depth: 0 };
}

describe('KDS crash isolation', () => {
  it.each(SURFACES)(
    'wraps $element inside a <LocalizedErrorBoundary>',
    ({ file, element, why }) => {
      const { found, depth } = elementInsideBoundary(file, element);
      const rel = path.relative(SRC, file);
      expect(found, `${rel}: ${String(element)} is NOT RENDERED — the guard is ` +
        'stale and must be updated rather than passing vacuously.').toBe(true);
      expect(
        depth,
        `${rel}: ${String(element)} is NOT inside a <LocalizedErrorBoundary> (${why}). ` +
          'The KDS has no scoped boundaries, so a throw here reaches the app-level ' +
          'boundary whose recovery is a full reload — which blanks the kitchen board ' +
          'mid-service.',
      ).toBeGreaterThan(0);
    },
  );
});
