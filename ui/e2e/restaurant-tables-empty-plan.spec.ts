import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

// WHY THIS FILE EXISTS
//
// `tables-empty-add-table-btn` is the tables screen's SECOND empty state, on a different branch
// from the one round 246 covered:
//
//   :1026  showEmpty && section === null      -> this control
//   :1045  showEmpty && section !== null      -> `All` (round 246, covered)
//
// Reaching it through the UI costs ~13 lifecycle operations — the seed has 13 tables of which 6
// are occupied, so each needs release -> close panel -> delete — and round 267's attempt timed out
// at the twelfth. **That is a seed problem, not a test problem**, and this spec uses the seam the
// dev-mock already provides for that shape.
//
// THE SEAM: `?plan=empty`, added to `dev-mock/handlers/floorplan.ts` alongside the existing
// conventions (`system.ts:29-56` — an explicit per-navigation opt-in, read at CALL time, changing
// no default, guarded for jsdom).
//
// ⚠️ IT MUST BE SET ON THE FIRST LOAD. `mockTables` is seeded at module load, so a later `goto`
// finds the plan already built — measured: navigating after login left 12 tiles in place.

const TIMEOUT = 20_000;

async function openEmptyPlan(page: Page): Promise<void> {
  // The flag goes on before anything loads, because the seed is captured at module load.
  await page.addInitScript(() => {
    if (!location.search.includes('plan=')) {
      history.replaceState(null, '', location.pathname + '?plan=empty');
    }
  });
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });
  await page.keyboard.press('Shift+L');
  // Wait for the EMPTY state, not the floor plan container: a container assertion would pass on
  // the populated plan too, which is the state this spec exists to distinguish from.
  await expect(
    page.locator('[data-testid="tables-empty-add-table-btn"]'),
    'the seam did not take — this is the populated plan',
  ).toBeVisible({ timeout: TIMEOUT });
}

test('an empty floor plan says so and offers the first table', async ({ page }) => {
  await openEmptyPlan(page);

  // NO TILES. The state and its consequence, asserted together.
  await expect(page.locator('.tables-table'), 'an empty plan renders no tiles').toHaveCount(0);

  // AND THE FILTER ESCAPE IS ABSENT. `:1049` renders an `All` button for the SECTION-empty state;
  // offering it on a plan that has no sections to return to would be a dead end dressed as a
  // way out. This is what distinguishes the two branches from the outside.
  const empty = page.locator('.tables-empty');
  await expect(empty.getByRole('button', { name: /all/i })).toHaveCount(0);

  // THE CONTROL OPENS THE FORM. A button that rendered but did nothing would satisfy everything
  // above — and this is the only route out of a plan with no tables.
  await page.locator('[data-testid="tables-empty-add-table-btn"]').click();
  await expect(
    page.locator('.tables-modal-backdrop'),
    'the empty plan offers a way to create its first table',
  ).toBeVisible({ timeout: TIMEOUT });
});