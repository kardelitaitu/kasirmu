import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

// WHY THIS FILE EXISTS
//
// Round 240 covered reserving a table. This is the OTHER HALF of the workflow, and the half an
// operator performs when the party actually walks in: the reservation card and Seat Guests.
//
// `tables-reservation-card` renders only for a reserved table (`:1150`) and `tables-seat-guests-btn`
// only for `status === 'reserved'` (`:1309`).
//
// Both states come from the mock's own snapshot (`dev-mock/handlers/floorplan.ts:37-41`):
// `table-10` is seeded RESERVED and four tables are seeded AVAILABLE — so neither needs a seed.
// An earlier version of this file wrote its own localStorage slice, which the floor-plan mock has
// no seam to read (the module is deliberately in-memory, `floorplan.ts:60-62`) and so did
// nothing. That is round 210's `MOCK_PRODUCTS` lesson in a third place: **read what the mock
// already seeds before inventing a fixture.**
//
// Two handler behaviours worth pinning rather than assuming (`:755-786`):
//   it CARRIES an existing reservation bill across the seating rather than dropping it
//   (`:763-775`), and it CLEARS the detail panel (`:780`) so the seated table stops offering
//   actions that no longer apply.

const TIMEOUT = 20_000;

/**
 * A held cart in the reservation shape.
 *
 * `tables-reservation-card` is NOT driven by the table's status alone — `getTableReservation`
 * (`:160-179`) reads the table's held cart and requires a label containing `Res:`. The mock seeds
 * `table-10` as `reserved` but with no such cart, so the card stays absent.
 *
 * This is the exact label `handleConfirmReservation` writes (`:720-721`), and its guest name is
 * parsed back out of it (`:165`), so seeding it here exercises the real parser rather than a
 * convenient shortcut.
 */
const RESERVED_CART = {
  id: 'held-res-1',
  label: 'Table 10 · Res: Siti (19:30) [4p]',
  cart_data: JSON.stringify({
    lines: [],
    customerName: 'Siti',
    partySize: 4,
    reservationTime: '19:30',
    isReservation: true,
    tableNumber: 'Table 10',
  }),
  item_count: 0,
  total_minor: 0,
  currency: 'IDR',
  bill_type: 'open_bill',
  customer_name: 'Siti',
  deduction_location_id: null,
  created_at: '2026-10-14T10:00:00.000Z',
};

async function openTables(page: Page): Promise<void> {
  await page.addInitScript((cart) => {
    const key = 'oz-dev-mock:held-carts';
    if (localStorage.getItem(key) !== null) return;
    localStorage.setItem(key, JSON.stringify([cart]));
  }, RESERVED_CART);
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });
  await page.keyboard.press('Shift+L');
  await expect(page.locator('.tables-table').first()).toBeVisible({ timeout: TIMEOUT });
}

/** The mocked plan seeds exactly one reserved table (`table-10`). */
async function openReservedTable(page: Page): Promise<void> {
  const reserved = page.locator('.tables-table').nth(9);
  await expect(reserved, 'the seeded plan has a reserved table').toBeVisible({ timeout: TIMEOUT });
  await reserved.click();
  await expect(page.locator('[data-testid="tables-reservation-card"]')).toBeVisible({
    timeout: TIMEOUT,
  });
}

test('a reserved table shows who it is held for, and offers to seat them', async ({ page }) => {
  await openTables(page);
  await openReservedTable(page);

  const card = page.locator('[data-testid="tables-reservation-card"]');

  // THE GUEST. A card showing a time but not a name is useless at the door: the question being
  // asked is always "who is this for?". The mock's reserved table carries a guest name, so this
  // asserts text rather than emptiness — a card that rendered with a blank would still "appear".
  await expect(card.locator('.tables-reservation-guest')).not.toBeEmpty({ timeout: TIMEOUT });

  await expect(
    page.locator('[data-testid="tables-seat-guests-btn"]'),
    'a reserved table must offer the seating action',
  ).toBeVisible({ timeout: TIMEOUT });
});

test('Seat Guests seats the party and reports it', async ({ page }) => {
  await openTables(page);
  await openReservedTable(page);

  await page.locator('[data-testid="tables-seat-guests-btn"]').click();

  // THE REPORT. The handler toasts on success (`:782-785`); a silent success leaves the operator
  // wondering whether the tap registered.
  await expect(
    page.getByText(/seated/i).first(),
    'seating a party must report itself',
  ).toBeVisible({ timeout: TIMEOUT });

  // AND THE DETAIL CLOSES. `:780` clears `selected`, so the seated table stops offering actions
  // that no longer apply — Reserve Table and Seat Guests are both reserved-only (`:1309`, `:1337`).
  await expect(
    page.locator('.tables-detail'),
    'a seated table must stop showing the detail panel',
  ).toHaveCount(0, { timeout: TIMEOUT });
});