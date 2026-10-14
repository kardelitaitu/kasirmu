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
});