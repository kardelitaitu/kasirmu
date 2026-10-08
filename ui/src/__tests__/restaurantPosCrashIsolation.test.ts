// ── Crash-isolation guard for the restaurant POS surfaces (F9) ─────
//
// Finding F9 in todo-restaurant-pos-reliability.md: the workspace cards were
// boundary-wrapped but the restaurant POS surfaces were not. A render throw in
// RestaurantSidebar or one of the four settings sub-screens took down the POS
// screen itself — mid-sale, with the cashier's cart in memory — and offered no
// recovery.
//
// WHY A STATIC GUARD RATHER THAN A RENDER TEST: the surfaces are mounted deep
// inside PosScreen/RestaurantMenu and the sub-screens are lazy/mocked in the
// existing suites, so a behavioural test would have to mock the component it is
// checking and could pass with the boundary removed. This scans the SOURCE for
// the wrapper instead, which is the same drift-guard idiom
// errorPolicyCompliance.test.ts uses, and it is deliberately narrow: it asserts
// the wrapper is PRESENT around the named element, not that the element behaves.
//
// The guard is only worth having if it fails when a boundary is removed, so
// each case is kill-tested by deleting the wrapper from the named file.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Resolve against the working directory (ui/), following the convention
// errorPolicyCompliance.test.ts documents: vitest's __dirname is the compiled
// output, not the repo layout.
const SRC = path.resolve(process.cwd(), 'src');

/** One surface that must be crash-isolated, and the element it wraps. */
interface GuardedSurface {
  file: string;
  /** The component element that must sit inside the boundary. */
  element: RegExp;
  /** Why this surface is worth isolating. */
  why: string;
}

const SURFACES: GuardedSurface[] = [
  {
    file: path.join(SRC, 'features/restaurant/RestaurantMenu.tsx'),
    element: /<RestaurantSidebar\b/,
    why: 'a panel over a live sale; a throw must not discard the cart',
  },
  {
    file: path.join(SRC, 'features/sales/PosScreen.tsx'),
    element: /<RestaurantMenuEditorScreen\b/,
    why: 'menu authoring reached from the sidebar',
  },
  {
    file: path.join(SRC, 'features/sales/PosScreen.tsx'),
    element: /<RestaurantReceiptsScreen\b/,
    why: 'receipt/printer configuration',
  },
  {
    file: path.join(SRC, 'features/sales/PosScreen.tsx'),
    element: /<RestaurantPaymentsScreen\b/,
    why: 'payment-rail configuration',
  },
  {
    file: path.join(SRC, 'features/sales/PosScreen.tsx'),
    element: /<RestaurantSettingsScreen\b/,
    why: 'the restaurant settings screen this lane rewrote',
  },
];

/**
 * Whether `element` appears inside a `<LocalizedErrorBoundary>` region.
 *
 * Walks the file line by line tracking the boundary nesting depth, and reports
 * the depth at which the element is found. Depth 0 means it is unwrapped. This
 * is a text scan, not a parser, which is why the assertion is "appears at depth
 * >= 1" rather than anything about props.
 */
function elementInsideBoundary(file: string, element: RegExp): { found: boolean; depth: number } {
  const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/);
  let depth = 0;
  for (const line of lines) {
    // Close BEFORE open on a line, so a self-closing boundary cannot skew depth.
    if (/<\/LocalizedErrorBoundary>/.test(line)) depth = Math.max(0, depth - 1);
    if (element.test(line)) return { found: true, depth };
    if (/<LocalizedErrorBoundary\b/.test(line)) depth += 1;
  }
  return { found: false, depth: 0 };
}

describe('restaurant POS crash isolation (F9)', () => {
  it.each(SURFACES)('$file wraps $element ($why)', ({ file, element }) => {
    const { found, depth } = elementInsideBoundary(file, element);
    const rel = path.relative(SRC, file);
    expect(found, `${rel} no longer renders ${String(element)}`).toBe(true);
    expect(
      depth,
      `${rel}: ${String(element)} is NOT inside a <LocalizedErrorBoundary>. A throw here \\n` +
        `would take the POS screen down mid-sale with no recovery.`,
    ).toBeGreaterThan(0);
  });

  it('scans a meaningful number of surfaces', () => {
    // A collector that silently found nothing would pass every case above.
    expect(SURFACES.length).toBeGreaterThanOrEqual(5);
  });
});
