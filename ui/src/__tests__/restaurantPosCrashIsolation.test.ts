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
  // ⚠️ These two were MISSING until round 18, which is exactly how they stayed
  // unwrapped: the guard listed the four SETTINGS sub-screens and PosScreen has
  // six. A guard whose list is short of the thing it guards reports clean for the
  // gap. Both are reached from the sidebar and both are heavy enough to throw.
  {
    file: path.join(SRC, 'features/sales/PosScreen.tsx'),
    element: /<TableManagementScreen\b/,
    why: 'table management, reached from the sidebar mid-service',
  },
  {
    file: path.join(SRC, 'features/sales/PosScreen.tsx'),
    element: /<SalesHistoryScreen\b/,
    why: 'sales history, reached from the sidebar mid-service',
  },
  {
    file: path.join(SRC, 'features/sales/PosScreen.tsx'),
    element: /<ProductLookupScreen\b/,
    why: 'stock inquiry, reached from the sidebar mid-service',
  },
  // ── RestaurantMenu: the surface ITSELF, not a panel of it ──
  //
  // The seven entries above are panels of the POS screen. The menu is the ordering
  // surface under all of them, and a throw inside it propagated past RestaurantMenu
  // into PosScreen — which has no boundary around `<RestaurantMenu>` at :1224 — so
  // the POS screen unmounted and the cart went with it. Both money steps are listed:
  // the grid the cashier taps, and the modifier dialog where the price is chosen.
  {
    file: path.join(SRC, 'features/restaurant/RestaurantMenu.tsx'),
    element: /<MenuItemGrid\b/,
    why: 'the product grid: the whole ordering surface',
  },
  {
    file: path.join(SRC, 'features/restaurant/RestaurantMenu.tsx'),
    element: /<ItemModifierModal\b/,
    why: 'the modifier dialog: where an item price is chosen',
  },
  // ── The payment popup, in BOTH shells ──
  //
  // The money dialog, opened after the tender is chosen. Unwrapped, a throw here
  // was caught only by AppProviders' FULL-PAGE boundary (:93) whose recovery is a
  // 30s auto-reload — "a scoped failure never reloads the whole POS" is stated as
  // the intent at AppProviders:28-31, and this surface is the clearest case for it.
  {
    file: path.join(SRC, 'features/sales/PosScreen.tsx'),
    element: /<PaymentModal\b/,
    why: 'the payment popup (restaurant POS)',
  },
  {
    file: path.join(SRC, 'features/retail/RetailPosScreen.tsx'),
    element: /<PaymentModal\b/,
    why: 'the payment popup (retail POS)',
  },
  // The retail shell's three other early-return sub-views — the twins of the
  // restaurant shell's, fixed in the same pass.
  {
    file: path.join(SRC, 'features/retail/RetailPosScreen.tsx'),
    element: /<SalesHistoryView\b/,
    why: 'sales history (retail POS)',
  },
  {
    file: path.join(SRC, 'features/retail/RetailPosScreen.tsx'),
    element: /<TableManagementView\b/,
    why: 'table management (retail POS)',
  },
  {
    file: path.join(SRC, 'features/retail/RetailPosScreen.tsx'),
    element: /<StockInquiryView\b/,
    why: 'stock inquiry (retail POS)',
  },
  // ── The three money dialogs on the sale itself ──
  //
  // Each writes a figure the cashier is about to charge: an item price, a cart
  // discount, or an edited line's options+price. All three sat outside any
  // boundary while AppProviders' full-page one stood behind them.
  {
    file: path.join(SRC, 'features/sales/PosScreen.tsx'),
    element: /<PriceOverrideModal\b/,
    why: 'price override: writes a line price',
  },
  {
    file: path.join(SRC, 'features/sales/PosScreen.tsx'),
    element: /<PromotionsModal\b/,
    why: 'promotions picker: changes the cart discount',
  },
  {
    file: path.join(SRC, 'features/sales/PosScreen.tsx'),
    element: /<ItemModifierModal\b/,
    why: 'in-cart modifier editor: options and price',
  },
  // ── The shift family: cash-drawer reconciliation ──
  {
    file: path.join(SRC, 'features/sales/PosScreen.tsx'),
    element: /<CloseShiftConfirm\b/,
    why: 'close-shift: the cash-drawer count',
  },
  {
    file: path.join(SRC, 'features/sales/PosScreen.tsx'),
    element: /<ShiftSummary\b/,
    why: 'shift summary: the reconciliation figures',
  },
  {
    file: path.join(SRC, 'features/sales/PosScreen.tsx'),
    element: /<OpenShiftModal\b/,
    why: 'open-shift: the opening float',
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
    // PosScreen has SEVEN early-return sub-screens, RestaurantMenu contributes two
    // money-path surfaces, and the payment popup appears in BOTH shells — eleven.
    // The number is asserted because a list short of the thing it guards is exactly
    // how three of these hid until round 18.
    expect(SURFACES.length).toBeGreaterThanOrEqual(20);
  });
});
