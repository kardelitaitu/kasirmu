// ── Multi-station kitchen & bar chit routing contract guard ────────────────
//
// In restaurant operations, food orders and beverage orders are prepared at
// different stations: hot food at the Kitchen, and drinks at the Bar.
//
// When a delta order round is fired (`handleDispatchKitchenDelta` in PosScreen.tsx),
// the line items must partition by station category:
//   - Non-beverage items dispatch to `printerTarget: 'kitchen'` / `documentKind: 'kitchen'`
//   - Beverage items dispatch to `printerTarget: 'bar'` / `documentKind: 'bar'`
//
// Hardware drivers on desktop and mobile gracefully route each target to its
// registered station printer, falling back to 'default' if a dedicated bar printer
// is not installed.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(resolve(__dirname, '../features/sales/PosScreen.tsx'), 'utf-8');

/**
 * The whole `handleDispatchKitchenDelta` handler.
 *
 * Sliced to the NEXT top-level declaration rather than a fixed character count: the
 * previous `+ 3500` stopped 482 chars short of the handler's end (measured span:
 * 3982), so the BAR chit catch was outside the window and a guard written against it
 * silently matched nothing. Bounding on the next declaration cannot drift that way.
 */
function dispatchBody(): string {
  const at = SRC.indexOf('const handleDispatchKitchenDelta');
  if (at === -1) return '';
  const next = SRC.indexOf('const handleSendToKitchen', at);
  return SRC.slice(at, next === -1 ? at + 6000 : next);
}

describe('PosScreen kitchen & bar station routing', () => {
  it('imports isBeverageItem from completedSale', () => {
    expect(SRC).toMatch(
      /import\s*\{[^}]*isBeverageItem[^}]*\}\s*from\s*'\.\/payment\/completedSale'/,
    );
  });

  it('partitions delta items into foodLines and drinkLines', () => {
    const body = dispatchBody();
    expect(body.length, 'handleDispatchKitchenDelta moved — re-point this guard').toBeGreaterThan(0);
    expect(body).toMatch(/const foodLines = deltaLines\.filter\(\(l\)\s*=>\s*!isBeverageItem\(l\)\);/);
    expect(body).toMatch(/const drinkLines = deltaLines\.filter\(\(l\)\s*=>\s*isBeverageItem\(l\)\);/);
  });

  it('dispatches foodLines to printerTarget kitchen and drinkLines to printerTarget bar', () => {
    const body = dispatchBody();
    expect(body).toMatch(/foodLines\.length > 0/);
    expect(body).toMatch(/printerTarget:\s*'kitchen'/);
    expect(body).toMatch(/drinkLines\.length > 0/);
    expect(body).toMatch(/printerTarget:\s*'bar'/);
  });

  // ── A failed chit print must REACH the operator ──────────────────────────
  //
  // Both catches used to `console.warn` only. Dispatching non-fatally is correct —
  // the line IS sent — but a ticket that never printed leaves the station with no
  // record of the order, and only the cashier can re-send it. Measured in
  // PaymentModal's sibling chit catch (round 36): with the toast removed, a rejected
  // print left the operator an empty toast area.
  //
  // KEYED TO THE CATCH BODY, not the whole function: asserting the string appears
  // anywhere in `dispatchBody()` would pass on a toast added to some other branch.
  function catchBodyAfter(marker: string): string {
    const body = dispatchBody();
    const at = body.indexOf(marker);
    if (at === -1) return '';
    // The catch body runs to the closing brace of its `catch { … }` block. Taking a
    // generous window and stopping at the next `catch` keyword keeps the assertion on
    // THIS branch without needing a brace matcher.
    const rest = body.slice(at + marker.length);
    const nextCatch = rest.indexOf('catch (', 40);
    return nextCatch === -1 ? rest.slice(0, 1200) : rest.slice(0, nextCatch);
  }

  it('reports a failed KITCHEN chit with a toast, not only the console', () => {
    const body = catchBodyAfter('Kitchen chit printing failed');
    expect(body.length, 'the kitchen chit catch moved — re-point this guard').toBeGreaterThan(0);
    expect(body, 'a failed kitchen chit was logged but never shown').toMatch(/addToast\(/);
    expect(body).toMatch(/pos-toast-kitchen-print-failed/);
  });

  it('reports a failed BAR chit with its OWN string', () => {
    const body = catchBodyAfter('Bar chit printing failed');
    expect(body.length, 'the bar chit catch moved — re-point this guard').toBeGreaterThan(0);
    expect(body).toMatch(/addToast\(/);
    // The bar has its own string so the operator knows WHICH station is missing its
    // ticket; reusing the kitchen text would send them to the wrong printer.
    expect(body).toMatch(/pos-toast-bar-print-failed/);
  });
});
