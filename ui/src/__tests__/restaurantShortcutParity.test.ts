// ── The restaurant shortcut manifest advertises only what exists ──────────
//
// Modelled on `retailShortcutParity.test.tsx`, which exists because the retail function bar,
// the help overlay and the keydown handler each kept their own key map and drifted — the F11
// contradiction, where the overlay said "Toggle Fullscreen" and the handler opened Quick
// Return. That is the failure mode a manifest prevents, and it is only prevented if something
// checks the manifest against the code.
//
// Three claims, each a way the manifest can lie:
//
//   1. TWO OWNERS. No key may appear twice. A duplicate is silently dead — the loop in
//      `useRestaurantShortcuts` returns at the first match, so the second never fires.
//   2. A COLLISION WITH RETAIL. Retail owns F1-F12, `?`, Ctrl+K, Ctrl+L and Esc; AppShell
//      owns F10 globally. A restaurant binding on any of those shadows a working key —
//      `PosScreen.tsx:91-95` records the tree paying for exactly that once.
//   3. AN UNWIRED ACTION. Every advertised action must appear in the handler interface, so a
//      key the help overlay lists cannot be one nobody implements.
//   4. A DEAD FLAG. `editableGuard` must actually be read by the hook. It was not: the hook
//      hardcoded a blanket editable check and only this file's header claimed otherwise, so
//      every entry's flag was decorative. It agreed with the hardcoded behaviour only because
//      all five entries happen to be `true` — the day someone adds `editableGuard: false`
//      (a bare key meant to work while typing) it would have been silently suppressed.
//   5. A MISSING HANDLER SITE. Claim 3 parses the HOOK's interface, which says what the hook
//      CAN run — not what `PosScreen` actually PASSES it. Renaming a key in PosScreen's
//      `useMemo` would leave claim 3 green and the key silently dead, because nothing else
//      renders the restaurant shortcut path.
//   6. AN UNCONDITIONAL HANDLER. The keys belong to the SALE VIEW, and a sub-screen replaces
//      that view (`showTables` / `showSalesHistory` / `showStockInquiry` each early-return).
//      `useRestaurantShortcuts` registers on `document`, so an unconditional handler map is
//      live behind those sub-screens — measured: `Shift+B` opened the split-bill modal over
//      the Table Management list and `Shift+P` printed an interim bill for a cart the cashier
//      could not see. Claims 3 and 5 read the static map and pass either way, so only this
//      one can notice a regression to unconditional wiring.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { RESTAURANT_SHORTCUTS, matchesRestaurantShortcut } from '@/features/restaurant/restaurantShortcuts';
import { RETAIL_SHORTCUTS } from '@/features/retail/retailShortcuts';

function findRoot(): string {
  const markers = ['ui/src/features/retail/retailShortcuts.ts', 'ui/src/features/sales/PosScreen.tsx'];
  let dir = process.cwd();
  for (let up = 0; up < 6; up += 1) {
    if (markers.every((m) => fs.existsSync(path.join(dir, m)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not locate the repo root from ' + process.cwd());
}

const ROOT = findRoot();
const HOOK = 'ui/src/features/restaurant/hooks/useRestaurantShortcuts.ts';

describe('the restaurant shortcut manifest', () => {
  it('binds no key twice', () => {
    const seen = new Map<string, number>();
    for (const s of RESTAURANT_SHORTCUTS) {
      seen.set(s.key, (seen.get(s.key) ?? 0) + 1);
    }
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    expect(dupes, 'a duplicated key is dead: the loop returns at the first match').toEqual([]);
  });

  it('claims no key that retail or AppShell already owns', () => {
    const retailKeys = new Set(RETAIL_SHORTCUTS.map((s) => s.key.toLowerCase()));
    // AppShell owns F10 across every workspace (AppShell.tsx:439).
    retailKeys.add('f10');
    const collisions = RESTAURANT_SHORTCUTS.map((s) => s.key.toLowerCase()).filter((k) =>
      retailKeys.has(k),
    );
    expect(
      collisions,
      'these keys are already bound; a second owner shadows a working shortcut',
    ).toEqual([]);
  });

  it('advertises only actions the hook implements', () => {
    const hook = fs.readFileSync(path.join(ROOT, HOOK), 'utf-8');

    // The handler interface is the hook's own statement of what it can run.
    const iface = /export interface RestaurantShortcutHandlers \{([\s\S]*?)\n\}/.exec(hook);
    expect(iface, 'could not read the handler interface — has the hook moved?').not.toBeNull();
    const wired = new Set([...iface![1]!.matchAll(/'(\w[\w-]*)'\??:/g)].map((m) => m[1]!));
    expect(wired.size, 'no handlers parsed — the interface shape changed').toBeGreaterThan(2);

    const unwired = RESTAURANT_SHORTCUTS.map((s) => s.action).filter((a) => !wired.has(a));
    expect(
      unwired.sort(),
      'the manifest advertises an action the hook cannot run',
    ).toEqual([]);
  });

  it('reads editableGuard per entry rather than hardcoding the guard', () => {
    const hook = fs.readFileSync(path.join(ROOT, HOOK), 'utf-8');
    expect(
      /shortcut\.editableGuard|s\.editableGuard|\.editableGuard\b/.test(hook),
      'the hook must consult each entry\'s editableGuard; a blanket isEditableTarget() '
      + 'return makes the manifest field decorative and its own header comment false',
    ).toBe(true);
  });

  it('wires every advertised action in PosScreen\'s handler object', () => {
    // The site the manifest cannot see. PosScreen builds the handler object; if a key
    // here is missing or misspelled the shortcut is consumed as a no-op (the hook
    // returns at the first match and calls nothing), with the help overlay still
    // advertising it.
    const posScreen = fs.readFileSync(
      path.join(ROOT, 'ui/src/features/sales/PosScreen.tsx'),
      'utf-8',
    );
    const memo = /useMemo<RestaurantShortcutHandlers>\(\(\) => \{([\s\S]*?)\n {2}\}, \[/.exec(posScreen);
    expect(memo, 'could not read the PosScreen handler object — has it moved?').not.toBeNull();
    const body = memo![1]!;
    const wired = new Set([...body.matchAll(/'([\w-]+)':/g)].map((m) => m[1]!));

    const missing = RESTAURANT_SHORTCUTS.map((s) => s.action).filter((a) => !wired.has(a));
    expect(
      missing.sort(),
      'PosScreen does not supply a handler for these advertised actions, so the key '
      + 'preventDefaults and then does nothing',
    ).toEqual([]);
    expect(wired.size, 'no handlers parsed — the handler object shape changed').toBeGreaterThan(2);
  });

  it('matches a Shift+ chord only with Shift held, and never with Ctrl/Meta/Alt', () => {
    const shortcut = RESTAURANT_SHORTCUTS[0]!;
    const letter = shortcut.key.replace('Shift+', '');
    const base = { key: letter, shiftKey: true, ctrlKey: false, metaKey: false, altKey: false };
    expect(matchesRestaurantShortcut(shortcut, base), 'Shift+letter must match').toBe(true);
    expect(
      matchesRestaurantShortcut(shortcut, { ...base, shiftKey: false }),
      'the bare letter must not match a Shift chord',
    ).toBe(false);
    for (const mod of ['ctrlKey', 'metaKey', 'altKey'] as const) {
      expect(
        matchesRestaurantShortcut(shortcut, { ...base, [mod]: true }),
        `${mod} must not match a bare Shift chord`,
      ).toBe(false);
    }
  });
  // Claim 6: the handler map is CONDITIONAL on the sale view being the one showing.
  //
  // Claims 3 and 5 read the static map, so they pass whether or not it is guarded —
  // which is why the rounds-69/70 fix needed its own guard rather than relying on these.
  // The fix is one clause (`|| !saleViewVisible`), so this reads the map's guard
  // expression directly and requires it to name the view state.
  it('supplies no shortcut handler while a sub-screen owns the view', () => {
    const posScreen = fs.readFileSync(
      path.join(ROOT, 'ui/src/features/sales/PosScreen.tsx'),
      'utf-8',
    );

    // The derivation the guard reads. It must exist and must name all three
    // sub-screen flags; a guard over a stale subset is the same bug with fewer views.
    const deriv = /const saleViewVisible =([^;]*);/.exec(posScreen);
    expect(
      deriv,
      'saleViewVisible is gone — the restaurant keys are probably unguarded again',
    ).not.toBeNull();
    for (const flag of ['showTables', 'showSalesHistory', 'showStockInquiry']) {
      expect(
        deriv![1]!,
        deriv![1]!.includes(flag)
          ? 'ok'
          : `saleViewVisible no longer consults ${flag} — that sub-screen's keys are live behind it`,
      ).toContain(flag);
    }

    // And the handler map must actually READ it. A derivation nobody references is
    // dead code, which is how the tile memo read correct for a round (see
    // MenuItemGrid).
    const guard = /if \(activeWorkspace !== 'restaurant-pos'([^)]*)\) return \{\};/.exec(posScreen);
    expect(
      guard,
      'the restaurant handler map is not guarded by the lease workspace check',
    ).not.toBeNull();
    expect(
      guard![1]!,
      'the handler map ignores saleViewVisible — the keys are live behind a sub-screen',
    ).toContain('saleViewVisible');
  });
});