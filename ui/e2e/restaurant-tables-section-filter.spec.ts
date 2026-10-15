import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

// WHY THIS FILE EXISTS
//
// `tables-section-badge-all` is the last uncovered control on the tables screen. It is the count
// chip on the "All" filter, and it has TWO rendering modes (`:938`):
//
//   allOccupied > 0   ->  `${occupied}/${total}`     e.g. 5/12
//   allOccupied === 0 ->  just the total              e.g. 12
//
// The mock seeds 5 of 12 occupied (`dev-mock/handlers/floorplan.ts:37-41`), so the FIRST mode is
// the reachable one and the spec pins its exact value rather than merely that a number appeared.
//
// The section chips beside it are the filter itself; clicking one must narrow the floor plan, or
// the chip is decoration.

const TIMEOUT = 20_000;

async function openTables(page: Page): Promise<void> {
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });
  await page.keyboard.press('Shift+L');
  await expect(page.locator('.tables-table').first()).toBeVisible({ timeout: TIMEOUT });
}

test('the All badge counts occupied against the whole floor plan', async ({ page }) => {
  await openTables(page);

  const badge = page.locator('[data-testid="tables-section-badge-all"]');
  await expect(badge, 'the All filter carries a count').toBeVisible({ timeout: TIMEOUT });

  // The seeded plan is 12 tables, 5 occupied. Asserting the SHAPE and the arithmetic rather
  // than the literal lets the seed change without the test lying — while still failing if the
  // badge shows the wrong mode (a bare total where a fraction belongs).
  const text = (await badge.innerText()).trim();
  expect(text, 'an occupied floor plan shows occupied/total').toMatch(/^\d+\/\d+$/);

  const [occupied, total] = text.split('/').map(Number);
  expect(total, 'the badge counts the whole plan').toBe(await page.locator('.tables-table').count());
  expect(occupied, 'and some of it is occupied').toBeGreaterThan(0);
  expect(occupied, 'but not all of it, or the seed changed').toBeLessThan(total!);
});

test('a section chip narrows the floor plan to that section', async ({ page }) => {
  await openTables(page);

  const before = await page.locator('.tables-table').count();
  expect(before, 'the seeded plan has tables').toBeGreaterThan(0);

  // Pick a REAL section chip — not "All", which is the same Button class. The chips after the
  // first one filter by section name; the mock seeds 'Indoor' and 'Patio'.
  const chips = page.locator('.tables-section-btn');
  const chipCount = await chips.count();
  expect(chipCount, 'the plan offers section filters').toBeGreaterThan(1);

  await chips.nth(1).click();

  // NARROWED, not merely re-rendered: a filter that changes nothing is not a filter. Asserting
  // `less than before` also catches a chip wired to the wrong state.
  await expect
    .poll(() => page.locator('.tables-table').count(), { timeout: 8_000 })
    .toBeLessThan(before);

  // And "All" restores the plan — the pair is what pins the filter rather than the click.
  await chips.first().click();
  await expect.poll(() => page.locator('.tables-table').count(), { timeout: 8_000 }).toBe(before);
});