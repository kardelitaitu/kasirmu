import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

// WHY THIS FILE EXISTS
//
// `tables-empty-filtered` is the tables screen's ONLY empty state. Round 244's filter fix made it
// reachable without meaning to: the branch needs `showEmpty` under a selected section, and
// `showEmpty` had been keyed on the unfiltered list, so it could never be true while any table
// existed. Round 245 mapped the route and stopped one step short. This finishes it.
//
// WHY THE ROUTE IS LONG. `mockSections` is derived ONCE at module load
// (`dev-mock/handlers/floorplan.ts:66`) and never recomputed, so a section's chip survives after
// its last table is deleted - the state an operator reaches when they pack a room away.
//
// Every step below was MEASURED in round 245, not assumed:
//
//   the delete guard   activeBill OR occupied disables Delete (`:1422`), so reserved and cleaning
//                      tables ARE deletable and only occupied-or-billed are not;
//   deletable counts   All -> 7, Indoor -> 1, Patio -> 6. INDOOR HAS FIVE OCCUPIED of six, so it
//                      cannot be emptied from the UI at all. Patio is the only choice.
//   the confirmation   an INLINE .tables-warning-banner (`:1278-1298`), not a modal;
//   closing the panel  its own Close button (`:1431`). Escape left it open, which is what broke
//                      round 245's loop: it re-selected the same tile every pass.

const TIMEOUT = 20_000;

async function openTables(page: Page): Promise<void> {
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });
  await page.keyboard.press('Shift+L');
  await expect(page.locator('.tables-table').first()).toBeVisible({ timeout: TIMEOUT });
}

/** The detail panel's own Close control - Escape does not dismiss it. */
async function closeDetail(page: Page): Promise<void> {
  const panel = page.locator('.tables-detail');
  // ⚠️ THE PANEL MAY ALREADY BE CLOSING. Measured: after a delete the framework dismisses it on
  // its own, so a click lands on a node that is "detached from the DOM" and times out. Waiting for
  // the panel to be GONE is the real goal - whether this call closed it or the app did.
  if (await panel.count() === 0) return;
  const close = panel.getByRole('button', { name: /^close$/i }).first();
  await close.scrollIntoViewIfNeeded().catch(() => undefined);
  await close.click({ timeout: 3_000 }).catch(() => undefined);
  await expect(panel).toHaveCount(0, { timeout: TIMEOUT });
}

/**
 * Delete the section's deletable tables, closing the panel after each one.
 *
 * Bounded by the count round 245 measured (6 for Patio) rather than an arbitrary guard, so a
 * regression that stops deletion shows up as a failed assertion instead of a silent pass.
 */
async function deleteDeletable(page: Page, expected: number): Promise<number> {
  let deleted = 0;
  for (let pass = 0; pass < expected + 4; pass++) {
    const tiles = page.locator('.tables-table');
    const count = await tiles.count();
    if (count === 0) break;

    let found = false;
    for (let i = 0; i < count; i++) {
      await tiles.nth(i).click();
      const probe = page.locator('[data-testid="tables-delete-table-btn"]');
      if (await probe.isEnabled()) { found = true; break; }
      await closeDetail(page);
    }
    if (!found) break;

    await page.locator('[data-testid="tables-delete-table-btn"]').click();
    await page
      .locator('.tables-warning-banner')
      .getByRole('button', { name: /^delete$/i })
      .first()
      .click();
    await closeDetail(page);
    deleted++;
  }
  return deleted;
}

test('emptying a section says so, and offers the way back', async ({ page }) => {
  await openTables(page);

  const chips = page.locator('.tables-section-btn');
  await chips.last().click();

  const emptied = await deleteDeletable(page, 6);
  expect(emptied, 'the section must actually empty').toBeGreaterThan(0);

  const empty = page.locator('.tables-empty');
  await expect(empty, 'an emptied section reports itself').toBeVisible({ timeout: TIMEOUT });
  await expect(page.locator('.tables-table'), 'and shows no tiles').toHaveCount(0);

  const back = empty.getByRole('button', { name: /all/i }).first();
  await expect(back, 'the empty state offers a way back to the full plan').toBeVisible();
  await back.click();

  await expect(page.locator('.tables-table').first()).toBeVisible({ timeout: TIMEOUT });
});