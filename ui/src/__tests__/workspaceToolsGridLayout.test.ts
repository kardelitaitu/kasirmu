import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const CSS = readFileSync(
  resolve(__dirname, '..', 'features', 'workspaces', 'WorkspaceHome.css'),
  'utf8',
);

/**
 * The tools grid's three layout contracts, pinned because jsdom cannot compute
 * any of them and all three were reported as VISIBLE defects on the tablet:
 *
 *   1. every tool card the same height (measured 54 / 64 / 76 px before the fix),
 *   2. rows that line up, which follows from (1) plus the grid's own row track,
 *   3. the tier badge keeps its COLOUR on a locked card.
 *
 * (3) is the subtle one and has a history. The card used to carry
 * `filter: grayscale(1)` to grey everything at once, including the badge — the
 * comment at the old `.workspace-tool-card--locked` said so explicitly. But
 * `filter` applies to the whole subtree, so the badge's artwork was desaturated
 * with the rest and NO descendant rule can undo it. The badge names the plan the
 * merchant must buy, so it is the one element on a locked card that has to stay
 * legible. The fix moves the greying onto the card's own parts, one selector at
 * a time, and lifts the badge's opacity back to 1.
 *
 * These assertions are on DECLARATIONS, not on rendered geometry — the stylesheet
 * is the contract here, and the device measurement above is what confirmed the
 * declarations have the intended effect.
 */
describe('workspace tools grid — layout contracts', () => {
  /**
   * The declaration block whose selector LIST contains `selector`, or '' when no
   * block does. Two forms have to match: a block on its own (`x { ... }`) and one
   * shared by a comma-joined list, which is how the locked card greys its text —
   * `x .name,\n x .desc { filter: ... }` — and a naive `selector + ' {'` lookup
   * finds neither the second form nor, therefore, its declarations.
   */
  function rule(selector: string): string {
    // Comments are stripped first: several blocks in this sheet carry long
    // explanatory comments containing `{`-free prose that would otherwise be
    // captured as part of the preceding selector.
    const css = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const blocks = css.match(/([^{}]+)\{([^}]*)\}/g) ?? [];
    for (const block of blocks) {
      const open = block.indexOf('{');
      const selectors = block.slice(0, open).split(',').map((s) => s.trim());
      if (selectors.includes(selector)) return block;
    }
    return '';
  }

  it('sizes every card to one height', () => {
    // The floor lives on the body so it composes with the card's padding and the
    // badge band, rather than restating their arithmetic as an absolute card height.
    const body = rule('.workspace-tool-body');
    expect(body).not.toBe('');
    expect(body).toMatch(/min-height\s*:/);
  });

  it('makes the grid rows a single track so row-mates align', () => {
    const grid = rule('.workspace-tools-grid');
    expect(grid).toMatch(/grid-auto-rows\s*:\s*1fr/);
  });

  it('does NOT put a filter on the whole locked card', () => {
    // The regression this guards: a card-level filter greys the tier badge too,
    // and no descendant rule can restore it.
    const locked = rule('.workspace-tool-card--locked');
    expect(locked).not.toBe('');
    // `filter: none` is permitted (it is explicit about the absence); any
    // desaturating value is not.
    expect(locked).not.toMatch(/filter\s*:\s*(?!none)[^;]*grayscale/);
  });

  it('greys the locked card\'s text and icon individually instead', () => {
    // The replacement for the card-level filter: targeted, so the badge (a
    // sibling of the body, not of these) never matches.
    expect(rule('.workspace-tool-card--locked .workspace-tool-name')).toMatch(/filter\s*:\s*grayscale/);
    expect(rule('.workspace-tool-card--locked .workspace-tool-icon')).toMatch(/filter\s*:\s*grayscale/);
  });

  it('keeps the tier badge at full opacity inside a dimmed card', () => {
    // The card is 0.62; without this the badge would still be faded, which is the
    // other half of "the badge should still have its colour".
    expect(rule('.workspace-tool-card--locked')).toMatch(/opacity\s*:\s*0\.62/);
    expect(rule('.workspace-tool-tier-badge')).toMatch(/opacity\s*:\s*1/);
  });
});
