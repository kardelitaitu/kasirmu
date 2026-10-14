// ── The context menu's Escape must not also clear the search query ────────
//
// `MenuItemContextMenu`'s docblock names an invariant (`:15-16`): *"Escape must
// stopImmediatePropagation so the global type-to-search Escape handler cannot clear the
// query while this menu is open"*. Round 174 checked that claim the way round 173 checked
// MenuSearchBar's, and it was NOT pinned — no unit test and no e2e spec mentions
// stopImmediatePropagation anywhere in the tree.
//
// Why it is a real hazard rather than a detail: `MenuSearchBar` keeps its own Escape
// handler on the WINDOW (`:52-56`), which clears the query and blurs. Both listeners sit on
// window, so the ORDER between them is not guaranteed — `stopImmediatePropagation` is what
// makes the context menu's dismissal win. Without it, opening the context menu, typing a
// search, and pressing Escape closes the menu AND wipes the query, so the operator has to
// retype it.
//
// This asserts the mechanism (`stopImmediatePropagation` is called) rather than the user-
// visible outcome, because the outcome depends on listener registration order — which is
// exactly the thing the invariant is defending against.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function findRoot(): string {
  const markers = ['ui/src/features/restaurant/components/MenuItemContextMenu.tsx'];
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
const CONTEXT_MENU = 'ui/src/features/restaurant/components/MenuItemContextMenu.tsx';
/** The global handler whose Escape the context menu has to beat. */
const SEARCH_BAR = 'ui/src/features/restaurant/components/MenuSearchBar.tsx';

describe("the context menu's Escape handler wins over the search's", () => {
  it('calls stopImmediatePropagation on the Escape keydown', () => {
    const src = fs.readFileSync(path.join(ROOT, CONTEXT_MENU), 'utf-8');

    // The guard is inside the Escape branch, not unconditional — calling it for every
    // keydown would make the menu swallow all other shortcuts.
    const escapeBranch = src.indexOf("if (e.key === 'Escape')");
    expect(escapeBranch, 'the Escape branch is gone — the close handler moved').toBeGreaterThan(-1);
    const afterEscape = src.slice(escapeBranch, escapeBranch + 400);
    expect(
      afterEscape.includes('stopImmediatePropagation'),
      'the Escape branch must call stopImmediatePropagation. MenuSearchBar keeps its own ' +
        "window Escape handler that clears the query, so without this the operator's " +
        'search is wiped when they dismiss the menu.',
    ).toBe(true);
  });

  it('the hazard it defends against is real: the search bar listens for Escape too', () => {
    const search = fs.readFileSync(path.join(ROOT, SEARCH_BAR), 'utf-8');

    // If MenuSearchBar stopped handling Escape, the invariant above would be pointless and
    // this file would be pinning a defence against nothing. Asserted so both halves stay
    // honest: the search's Escape handler AND the menu's suppression must both exist.
    expect(
      search.includes("e.key === 'Escape'") && /onChange\(''\)/.test(search),
      'MenuSearchBar no longer clears the query on Escape — re-check whether the ' +
        'stopImmediatePropagation guard is still needed',
    ).toBe(true);
  });
  it("does not stop propagation for the roving-focus keys", () => {
    const src = fs.readFileSync(path.join(ROOT, CONTEXT_MENU), 'utf-8');

    // Non-vacuity for the case above: there is more than one keydown branch, so the
    // assertion is distinguishing the Escape one rather than matching any branch.
    const branches = (src.match(/if \(e\.key ===/g) ?? []).length;
    expect(branches, 'expected a keydown branch per handled key').toBeGreaterThan(1);

    // The arrow branch returns early and does NOT call stopImmediatePropagation.
    const arrowBranch = src.indexOf("if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;");
    expect(arrowBranch).toBeGreaterThan(-1);
    expect(src.slice(arrowBranch, arrowBranch + 300)).not.toContain('stopImmediatePropagation');
  });
});