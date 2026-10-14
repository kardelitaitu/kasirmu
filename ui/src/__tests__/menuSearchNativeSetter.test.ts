// ── Type-to-search injects through the NATIVE setter ────────────────────
//
// `MenuSearchBar`'s docblock claims *"the type-to-search injection goes through the native
// value setter so React's onChange still fires"* (`:20-21`), and `RestaurantMenu.test.tsx`
// pins seven of the eight invariants that block names — everything EXCEPT this one. Round
// 173 noticed the gap and this file closes it.
//
// Why the native setter is load-bearing rather than a detail: React tracks the input's
// value through a property descriptor on `HTMLInputElement.prototype`. Assigning
// `input.value = v` sets the property WITHOUT going through that descriptor, so React's
// onChange never fires — and the failure is silent. The keystroke appears in the field,
// the grid does not filter, and nothing reports it. A direct assignment is the obvious way
// to write those three lines, which is exactly why it needs pinning.
//
// Asserted on the MECHANISM, not the effect: replacing the setter with a plain assignment
// would leave the correct value in the field and pass an effect-only test.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function findRoot(): string {
  const markers = ['ui/src/features/restaurant/components/MenuSearchBar.tsx'];
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
const SEARCH_BAR = 'ui/src/features/restaurant/components/MenuSearchBar.tsx';
const read = () => fs.readFileSync(path.join(ROOT, SEARCH_BAR), 'utf-8');

describe('type-to-search routes through the native value setter', () => {
  it('reads the descriptor from the prototype and CALLS it', () => {
    const src = read();

    // All three parts are required: reading the descriptor is useless without calling
    // it, and `input.value = v` is the spelling that silently breaks React.
    const readsDescriptor = src.includes('Object.getOwnPropertyDescriptor(');
    const fromPrototype = src.includes('window.HTMLInputElement.prototype');
    const callsIt = /nativeSetter\?\.call\(/.test(src);

    expect(
      readsDescriptor && fromPrototype && callsIt,
      'the injection must go through the prototype descriptor setter. `input.value = v` ' +
        'would leave the keystroke visible but stop React from seeing it, so the grid ' +
        'stops filtering with nothing reported.',
    ).toBe(true);
  });

  it('dispatches an input event so the change is observable', () => {
    const src = read();

    // Without this, even a correct setter would not notify React.
    expect(
      src.includes("new Event('input', { bubbles: true })") || src.includes('dispatchEvent('),
      'the injection must dispatch an input event; the setter alone does not notify React',
    ).toBe(true);
  });
});