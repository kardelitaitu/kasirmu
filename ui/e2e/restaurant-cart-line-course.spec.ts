import { test, expect, type Page } from '@playwright/test';
import { openRestaurantPosWithItem } from './helpers';

// WHY THIS FILE EXISTS
//
// Round 204 covered the line STATUS badges and the note. The COURSE chip is the other
// operator-facing control on a line and the one with a service mechanic behind it:
//
//   `CoursingStatus = 'hold' | 'fired'` (types/domain.ts:57) — items on hold wait, and
//   are fired to the kitchen when the course is called. That is what the
//   `restaurant.course_firing` setting (rounds 105, 189) switches on.
//
// The chip renders differently per state (`CartLineItem.tsx:247-269`): no course shows
// the word 'Course', an assigned one shows its emoji and label, and a fired one adds a
// ✓ while a held one adds a ⏸.
//
// The assign path is a listbox: the chip toggles `cart-line-course-dropdown`, whose
// options are `cart-line-course-option-none` and one per COURSES entry. Assigning a
// course decides which kitchen station and which firing round the dish belongs to, so
// the round trip is worth pinning rather than assuming.

const TIMEOUT = 20_000;

/**
 * Open the POS with one line, portrait sheet dismissed so the cart stays reachable.
 *
 * ⚠️ COURSE FIRING MUST BE ENABLED FIRST, and it is off by default:
 * `DEFAULT_RESTAURANT_SETTINGS.courseFiring` is `false`
 * (`restaurantSettingsModel.ts:60`), and `CourseSelectorBar` plus the per-line chip are
 * gated on `courseFiringEnabled !== false` (`CartPanel.tsx:961`, `:1003`).
 *
 * The first version of this spec did NOT enable it and all six cases failed with an
 * empty cart-line subtree — `CHIPS=0`, `FIRING_BAR=0`. Measured rather than assumed.
 *
 * Seeding it through the dev-mock's settings slice also exercises the link the operator
 * actually uses: the Settings screen's Course Firing toggle (rounds 105, 189) is what
 * puts the chip on the till.
 */
async function openWithLine(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const key = 'oz-dev-mock:settings';
    if (localStorage.getItem(key) !== null) return;
    // The dev-mock reads this slice once at module init, so an addInitScript (which
    // runs before the bundle) is what makes it visible to that first read.
    localStorage.setItem(key, JSON.stringify({ 'restaurant.course_firing': 'true' }));
  });
  await openRestaurantPosWithItem(page);
  // The chip proves the setting was read AND the workspace gate passed.
  await expect(
    page.locator('[data-testid="cart-line-course-chip"]').first(),
    'enabling course firing must put a course chip on the line',
  ).toBeVisible({ timeout: TIMEOUT });
  const backdrop = page.locator('[data-testid="restaurant-cart-sheet-backdrop"]');
  if (await backdrop.isVisible().catch(() => false)) {
    await backdrop.click({ position: { x: 5, y: 5 } });
    await expect(backdrop).toHaveCount(0, { timeout: 8_000 });
  }
}

test('a course is assigned from the chip and shown on it', async ({ page }, testInfo) => {
  // Desktop only, same measured reason as the sibling badge and race specs: in portrait
  // the cart is a bottom sheet whose backdrop covers the grid, and dismissing it unmounts
  // the cart panel — so the line's chip is not reachable alongside the grid.
  test.skip(testInfo.project.name !== 'desktop', 'needs grid and cart visible at once');
  await openWithLine(page);

  const line = page.locator('[data-testid="cart-panel-line-item"]').first();
  const chip = line.locator('[data-testid="cart-line-course-chip"]');
  await expect(chip, 'every line offers a course chip').toBeVisible({ timeout: TIMEOUT });

  // Unassigned: the chip reads the placeholder and the listbox is closed.
  await expect(chip).toContainText(/course/i);
  await expect(line.locator('[data-testid="cart-line-course-dropdown"]')).toHaveCount(0);

  // The chip TOGGLES the listbox rather than assigning directly.
  await chip.click();
  const dropdown = line.locator('[data-testid="cart-line-course-dropdown"]');
  await expect(dropdown, 'the chip opens the course list').toBeVisible({ timeout: 8_000 });

  // 'None' is always offered, so an operator can undo a mis-assignment.
  await expect(line.locator('[data-testid="cart-line-course-option-none"]')).toBeVisible();
  await expect(line.locator('[data-testid="cart-line-course-option-main"]')).toBeVisible();

  // Assign Main Course, then prove it landed ON THE CHIP — the round trip, not the click.
  await line.locator('[data-testid="cart-line-course-option-main"]').click();
  await expect(dropdown, 'choosing closes the list').toHaveCount(0, { timeout: 8_000 });
  await expect(chip, 'the chip shows the assigned course').toContainText(/main/i, {
    timeout: TIMEOUT,
  });
});

test('an assigned course can be removed', async ({ page }, testInfo) => {
  // Desktop only, same measured reason as the sibling badge and race specs: in portrait
  // the cart is a bottom sheet whose backdrop covers the grid, and dismissing it unmounts
  // the cart panel — so the line's chip is not reachable alongside the grid.
  test.skip(testInfo.project.name !== 'desktop', 'needs grid and cart visible at once');
  await openWithLine(page);

  const line = page.locator('[data-testid="cart-panel-line-item"]').first();
  const chip = line.locator('[data-testid="cart-line-course-chip"]');

  await chip.click();
  const main = line.locator('[data-testid="cart-line-course-option-main"]');
  await expect(main).toBeVisible({ timeout: 8_000 });
  await main.click();
  await expect(chip).toContainText(/main/i, { timeout: TIMEOUT });

  // Reopen and pick None — the way back has to exist or a mistake is permanent.
  await chip.click();
  const none = line.locator('[data-testid="cart-line-course-option-none"]');
  await expect(none).toBeVisible({ timeout: 8_000 });
  await none.click();

  await expect(chip, 'None clears the assignment').toContainText(/course/i, { timeout: TIMEOUT });
  await expect(chip).not.toContainText(/main/i);
});

test('the listbox reports which course is selected', async ({ page }, testInfo) => {
  // Desktop only, same measured reason as the sibling badge and race specs: in portrait
  // the cart is a bottom sheet whose backdrop covers the grid, and dismissing it unmounts
  // the cart panel — so the line's chip is not reachable alongside the grid.
  test.skip(testInfo.project.name !== 'desktop', 'needs grid and cart visible at once');
  await openWithLine(page);

  const line = page.locator('[data-testid="cart-panel-line-item"]').first();
  const chip = line.locator('[data-testid="cart-line-course-chip"]');

  // `aria-expanded` on the chip is what tells a screen reader the list is open; both
  // halves are asserted because a toggle that never reports its state is unusable.
  await expect(chip).toHaveAttribute('aria-expanded', 'false');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-expanded', 'true', { timeout: 8_000 });

  // And exactly one option is `aria-selected` at a time.
  const selected = line.locator('[role="option"][aria-selected="true"]');
  await expect(selected, 'one option is selected').toHaveCount(1);
  await expect(line.locator('[data-testid="cart-line-course-option-none"]')).toHaveAttribute(
    'aria-selected',
    'true',
  );
});