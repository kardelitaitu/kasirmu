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

function dispatchBody(): string {
  const at = SRC.indexOf('const handleDispatchKitchenDelta');
  return at === -1 ? '' : SRC.slice(at, at + 3500);
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
});
