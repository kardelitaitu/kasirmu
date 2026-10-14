import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

// WHY THIS FILE EXISTS
//
// The table-reservation workflow landed in `d7147648c` (another lane) and is now part of the
// restaurant surface. Round 240 is the first to cover it from the browser.
//
// The flow is a three-step chain, and each step is gated on the previous one:
//
//   `tables-open-reserve-btn`     renders ONLY for an `available` table (`:1337`)
//   `tables-reservation-card`     the detail panel's own banner once reserved
//   `tables-seat-guests-btn`      the next transition, offered on a reserved table
//
// The confirm is gated on a non-empty guest name (`:1877`), which is the round-220/230 shape:
// **a disabled state and an enabled state are two claims**, and asserting only one passes on a
// button that is hard-coded either way.

const TIMEOUT = 20_000;

async function openTables(page: Page): Promise<void> {
  // Shift+L is the till's table shortcut (rounds 221, 219). The sidebar helper walks a different
  // route and does not reach this screen.
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });
  await page.keyboard.press('Shift+L');
  await expect(page.getByText(/^Table \d+$/).first()).toBeVisible({ timeout: TIMEOUT });
}

/** Click the first AVAILABLE tile and return its index, captured before the click. */
async function selectFirstAvailable(page: Page): Promise<number> {
  const tiles = page.locator('.tables-table');
  await expect(tiles.first()).toBeVisible({ timeout: TIMEOUT });
  const count = await tiles.count();
  for (let i = 0; i < count; i++) {
    const cls = (await tiles.nth(i).getAttribute('class')) ?? '';
    if (cls.includes('available')) {
      await tiles.nth(i).click();
      return i;
    }
  }
  throw new Error('no available table in the seeded floor plan');
}

test('Reserve Table is offered for a free table and opens a seeded form', async ({ page }) => {
  await openTables(page);
  await selectFirstAvailable(page);

  const reserve = page.locator('[data-testid="tables-open-reserve-btn"]');
  await expect(reserve, 'a free table can be reserved').toBeVisible({ timeout: TIMEOUT });
  await reserve.click();

  // The modal seeds PARTY SIZE from the table's own capacity (`:1347`) — so the form arrives
  // with a sensible default rather than an empty box the operator must fill.
  const party = page.locator('#reserve-modal-party');
  await expect(party, 'the form seeds from the table').toBeVisible({ timeout: TIMEOUT });
  expect(Number(await party.inputValue()), 'party size defaults to the capacity').toBeGreaterThan(0);

  // The guest name starts empty, which is what makes the confirm gate meaningful below.
  await expect(page.locator('#reserve-modal-name')).toHaveValue('');
});

test('the confirm is gated on a guest name', async ({ page }) => {
  await openTables(page);
  await selectFirstAvailable(page);
  await page.locator('[data-testid="tables-open-reserve-btn"]').click();

  const confirm = page.locator('[data-testid="tables-reserve-confirm-btn"]');
  await expect(confirm).toBeVisible({ timeout: TIMEOUT });

  // ARM 1: nothing typed, so nothing to confirm. A reservation with no name is not one.
  await expect(confirm, 'an unnamed reservation must not be submittable').toBeDisabled();

  // ARM 2: the other state. Whitespace only must NOT arm it — the handler trims (`:1877`), and
  // a gate that accepted spaces would let the operator confirm an unnamed booking.
  const name = page.locator('#reserve-modal-name');
  await name.fill('   ');
  await expect(confirm, 'whitespace is not a name').toBeDisabled();

  await name.fill('Budi');
  await expect(confirm, 'a named reservation is submittable').toBeEnabled({ timeout: 8_000 });
});