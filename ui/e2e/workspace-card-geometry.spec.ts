import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { loginAs } from './helpers';

/**
 * Wait past the picker's skeleton phase: `.workspace-home` renders while
 * workspaces are still loading, so `.workspace-card` must be waited on
 * before any geometry measurement.
 */
async function waitForCards(page: Page): Promise<void> {
  await page.waitForSelector('.workspace-card', { timeout: 15_000 });
}

/**
 * E2E: Workspace Card Geometry Stability
 *
 * Locks in the workspace-picker interior contract so the card layout
 * cannot silently regress:
 *   1. Every card's interior row fills the card at the SAME width —
 *      guards against the flex shrink-wrap bug where one card's 40:60
 *      interior collapsed to a narrow text zone (e.g. Store POS).
 *   2. Cards never crush below 240px at any supported viewport — the
 *      column-collapse breakpoints (3→2→1) keep cards readable.
 *   3. Titles are never clipped — they wrap (balanced) instead of being
 *      cut off by the text zone.
 *   4. No horizontal page overflow on the picker.
 *
 * Runs in BOTH Playwright projects (desktop 1366px → 3 columns,
 * tablet 1024px → 2 columns), so both breakpoint regimes are exercised.
 */

test.describe('Workspace card geometry stability', () => {
  test('all cards share identical interior geometry and never crush', async ({ page }) => {
    await loginAs(page, 'owner', '1234');
    await waitForCards(page);

    const widths = await page.locator('.workspace-card-row').evaluateAll((rows) =>
      rows.map((r) => r.getBoundingClientRect().width),
    );

    // Admin is excluded from the card grid (reached via the Tools section),
    // leaving the 4 seeded non-admin workspaces: Restaurant POS, Store POS,
    // Kitchen Display, Warehouse. The 'Add Workspace' card is NOT rendered
    // while workspaces exist — WorkspaceHome.tsx:382 gates it on
    // `sortedWorkspaces.length === 0`, and the comment at the grid's tail
    // says so explicitly. The old floor of 5 predates that rule.
    expect(widths.length).toBeGreaterThanOrEqual(4);
    await expect(page.locator('.workspace-card--add')).toHaveCount(0);

    const first = widths[0];
    for (const w of widths) {
      expect(Math.abs(w - first)).toBeLessThanOrEqual(1);
    }

    // Column collapse keeps cards above ~240px at every supported viewport.
    expect(first).toBeGreaterThanOrEqual(240);
  });

  test('titles are never clipped by the text zone', async ({ page }) => {
    await loginAs(page, 'owner', '1234');
    await waitForCards(page);

    const clipped = await page.locator('.workspace-card-name').evaluateAll((names) =>
      names.map((n) => ({
        text: (n.textContent ?? '').trim(),
        overflow: n.scrollWidth - n.clientWidth,
      })),
    );

    // Admin is excluded from the card grid; the 4 seeded non-admin
    // workspaces render, and no 'Add Workspace' card exists while any
    // workspace is present (WorkspaceHome.tsx:382).
    expect(clipped.length).toBeGreaterThanOrEqual(4);
    for (const t of clipped) {
      expect(t.overflow, `title "${t.text}" is clipped`).toBeLessThanOrEqual(1);
    }
  });

  test('no horizontal overflow on the workspace picker', async ({ page }) => {
    await loginAs(page, 'owner', '1234');

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth);
  });
});
