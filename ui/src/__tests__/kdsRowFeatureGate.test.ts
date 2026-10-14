// ── The Kitchen Display row must respect the feature flag (round 128) ──
//
// `PosScreen.tsx:1738` computes `showKitchenDisplay` with `isPageAccessible(getPage('kds'),
// ...)`. The comment above it (F7/D4) says that is deliberate: the row should be visible
// exactly when the shell's `handleNavigate` would succeed, so the two cannot disagree.
//
// The predicate cannot deliver that for this route. `getPage('kds')` is
// `{ route: 'kds', feature: 'kitchen-display' }` — no `requiredRole`, no
// `requiredPermission` — and `isPageAccessible` -> `passesGate` consults only those two
// (`page-registry/index.ts:119-182`). With neither set, `passesGate` returns `true` at
// `:181`. Measured: `isPageAccessible(kds, 'Owner'|'Cashier'|''|'NotARole')` is `true` in all
// four cases, so `showKitchenDisplay` is a CONSTANT true and the row never hides.
//
// Its sibling two lines up does it correctly: `showTables: isEnabled(FEATURES.
// TABLE_MANAGEMENT)` (`:1730`). This file pins the symmetry, and pins that the constant is
// reachable rather than asserted away.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getPage, isPageAccessible } from '@/registries/page-registry';
import { registerKdsFeature } from '@/features/kds/register';

registerKdsFeature();

const SRC = readFileSync(
  resolve(__dirname, '../features/sales/PosScreen.tsx'),
  'utf-8',
);

describe('the Kitchen Display sidebar row respects its feature flag', () => {
  it('the predicate is inert for this route, which is WHY the flag is needed', () => {
    // The non-vacuity precondition. If `isPageAccessible` ever starts reading `feature`,
    // the source assertion below becomes redundant and this case fails to tell us so.
    const page = getPage('kds');
    expect(page, 'the kds page is not registered, so this file proves nothing').toBeDefined();
    expect(page!.requiredRole, 'kds gained a role gate; re-check the source guard').toBeUndefined();
    expect(page!.requiredPermission, 'kds gained a permission gate; re-check it').toBeUndefined();

    for (const [role, perms] of [
      ['Owner', ['*']],
      ['Cashier', []],
      ['', undefined],
      ['NotARole', ['nope']],
    ] as Array<[string, string[] | undefined]>) {
      expect(
        isPageAccessible(page, role, perms),
        `isPageAccessible returned false for ${JSON.stringify(role)} — if the page gained a ` +
          'gate, the source assertion below is no longer the only thing hiding the row.',
      ).toBe(true);
    }
  });

  it('gates showKitchenDisplay on the feature flag, like showTables', () => {
    const showKds = /showKitchenDisplay:\s*[^,\n]*isEnabled\(\s*FEATURES\.KITCHEN_DISPLAY\s*\)/;
    const showTables = /showTables:\s*isEnabled\(\s*FEATURES\.TABLE_MANAGEMENT\s*\)/;
    expect(
      showTables.test(SRC),
      'showTables lost its feature gate; this guard\'s premise no longer holds.',
    ).toBe(true);
    expect(
      showKds.test(SRC),
      'showKitchenDisplay is not gated on FEATURES.KITCHEN_DISPLAY. `isPageAccessible` ' +
        'cannot hide this row — the kds page has no role or permission gate — so with the ' +
        'feature disabled the row still renders and the click no-ops, which is the exact ' +
        'failure F7/D4 set out to remove.',
    ).toBe(true);
  });
});
