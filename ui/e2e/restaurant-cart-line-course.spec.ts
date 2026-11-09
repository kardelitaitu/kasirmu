import { test, expect, type Page } from '@playwright/test';
import { dismissRestaurantCartSheet, openRestaurantPosWithItem, seedCourseFiring } from './helpers';

// WHY THIS FILE EXISTS
//
// Round 204 covered the line STATUS badges and the note. The COURSE chip is the other
// operator-facing control on a line and the one with a service mechanic behind it:
//
//   `CoursingStatus = 'hold' | 'fired'` (types/domain.ts:57) — items on hold wait, and
//   are fired to the kitchen when the course is called. That is what the
//   `restaurant.course_firing` setting (rounds 105, 189) switches on.
//
// The chip renders differently per state (CartLineItem.tsx:234-269): no course shows the
// word 'Course', an assigned one shows its emoji and label, and a fired one adds a ✓
// while a held one adds a ⏸.
//
// The assign path is a listbox: the chip toggles `cart-line-course-dropdown`, whose
// options are `cart-line-course-option-none` and one per COURSES entry. Assigning a
// course decides which kitchen station and which firing round the dish belongs to, so
// the round trip is worth pinning rather than assuming.
//
// ⚠️ A LINE IS ALREADY COURSED WHEN IT LANDS, and that is the product working, not a bug.
// This spec first opened by asserting the chip read the unassigned placeholder
// ('Unassigned: the chip reads the placeholder'), and three of its four cases failed on
// that premise: the chip rendered "🥤 Beverage⏸" with `--set --hold` from the first paint.
//
// `handleRestaurantAddProduct` (PosScreen.tsx:2072) runs
// `inferCourseForProduct(product)` and passes the result as the line's meta, so an item
// added to the till is pre-coursed from its category or name
// (`resolveCourseFromCategory`, types/domain.ts:60). Measured 2026-10-17 on the desktop
// project, the first SIX dev-mock tiles — Caffè Latte, Cappuccino, Espresso Shot, Kopi
// Tubruk, Teh Tarik, Iced Coffee — every one a 'Beverage' category, so every line arrived
// `🥤 Beverage⏸`. The inference is deliberate: it is how the runner knows the station and
// the firing round without the cashier picking one per dish.
//
// The cases below therefore start from the REAL pre-coursed state and exercise the
// transitions that matter: changing the course, clearing it via None, and hold -> fired.
// The unassigned chip ('Course', and no `--set` class) is reached through None, which is
// also the only way an operator undoes a wrong inference — so that assertion is kept, just
// moved to where it is actually reachable.

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
  await seedCourseFiring(page);
  await openRestaurantPosWithItem(page);
  // The chip proves the setting was read AND the workspace gate passed.
  await expect(
    page.locator('[data-testid="cart-line-course-chip"]').first(),
    'enabling course firing must put a course chip on the line',
  ).toBeVisible({ timeout: TIMEOUT });
  await dismissRestaurantCartSheet(page);
}

/**
 * The course the line lands with, inferred from the 'Beverage' category of every
 * dev-mock product. Named once so the three cases that depend on it cannot drift.
 */
const INFERRED_COURSE = 'beverage';

test('a course is assigned from the chip and shown on it', async ({ page }, testInfo) => {
  // Desktop only, same measured reason as the sibling badge and race specs: in portrait
  // the cart is a bottom sheet whose backdrop covers the grid, and dismissing it unmounts
  // the cart panel — so the line's chip is not reachable alongside the grid.
  test.skip(testInfo.project.name !== 'desktop', 'needs grid and cart visible at once');
  await openWithLine(page);

  const line = page.locator('[data-testid="cart-panel-line-item"]').first();
  const chip = line.locator('[data-testid="cart-line-course-chip"]');
  await expect(chip, 'every line offers a course chip').toBeVisible({ timeout: TIMEOUT });

  // Pre-coursed on arrival, by inference — and the listbox starts closed.
  await expect(chip, 'a line lands pre-coursed from its category').toContainText(/beverage/i);
  await expect(line.locator('[data-testid="cart-line-course-dropdown"]')).toHaveCount(0);

  // The chip TOGGLES the listbox rather than assigning directly.
  await chip.click();
  const dropdown = line.locator('[data-testid="cart-line-course-dropdown"]');
  await expect(dropdown, 'the chip opens the course list').toBeVisible({ timeout: 8_000 });

  // 'None' is always offered, so an operator can undo a mis-assignment.
  await expect(line.locator('[data-testid="cart-line-course-option-none"]')).toBeVisible();
  await expect(line.locator('[data-testid="cart-line-course-option-main"]')).toBeVisible();

  // Re-assign Main Course, then prove it landed ON THE CHIP — the round trip, not the
  // click. This is the transition that matters when the inference guesses wrong.
  await line.locator('[data-testid="cart-line-course-option-main"]').click();
  await expect(dropdown, 'choosing closes the list').toHaveCount(0, { timeout: 8_000 });
  await expect(chip, 'the chip shows the assigned course').toContainText(/main/i, {
    timeout: TIMEOUT,
  });
  await expect(chip, 'and the inferred course is gone').not.toContainText(/beverage/i);
});

test('an assigned course can be removed', async ({ page }, testInfo) => {
  // Desktop only, same measured reason as the sibling badge and race specs: in portrait
  // the cart is a bottom sheet whose backdrop covers the grid, and dismissing it unmounts
  // the cart panel — so the line's chip is not reachable alongside the grid.
  test.skip(testInfo.project.name !== 'desktop', 'needs grid and cart visible at once');
  await openWithLine(page);

  const line = page.locator('[data-testid="cart-panel-line-item"]').first();
  const chip = line.locator('[data-testid="cart-line-course-chip"]');

  // Reopen and pick None — the way back has to exist or a wrong inference is permanent.
  await chip.click();
  const none = line.locator('[data-testid="cart-line-course-option-none"]');
  await expect(none).toBeVisible({ timeout: 8_000 });
  await none.click();

  // The unassigned state: the placeholder word, and no colour accent.
  await expect(chip, 'None clears the assignment').toContainText(/^\s*Course\s*$/i, {
    timeout: TIMEOUT,
  });
  await expect(chip, 'and drops the assigned accent').not.toHaveClass(
    /pos-cart-course-chip--set/,
  );
  await expect(line.locator('[data-testid="cart-line-course-dropdown"]')).toHaveCount(0);
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

  // Exactly one option is `aria-selected` at a time, and it is the line's own course —
  // the inferred Beverage, not 'None'.
  const selected = line.locator('[role="option"][aria-selected="true"]');
  await expect(selected, 'one option is selected').toHaveCount(1);
  await expect(
    line.locator(`[data-testid="cart-line-course-option-${INFERRED_COURSE}"]`),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(line.locator('[data-testid="cart-line-course-option-none"]')).toHaveAttribute(
    'aria-selected',
    'false',
  );
});

test('the chip shows hold, then fired, as the course moves', async ({ page }, testInfo) => {
  // Desktop only: needs the grid and the cart visible at once (round 201's constraint).
  test.skip(testInfo.project.name !== 'desktop', 'needs grid and cart visible at once');

  await openWithLine(page);

  const line = page.locator('[data-testid="cart-panel-line-item"]').first();
  const chip = line.locator('[data-testid="cart-line-course-chip"]');
  const fired = line.locator('[data-testid="cart-line-course-status-fired"]');
  const hold = line.locator('[data-testid="cart-line-course-status-hold"]');

  // The inferred course is ON HOLD from the first paint — queued, not sent. There is no
  // course-less state to observe here: inference means the line is never uncoursed, which
  // is why this case starts at hold rather than asserting both badges are absent.
  await expect(hold, 'an inferred course is on hold immediately').toBeVisible({
    timeout: TIMEOUT,
  });
  await expect(fired, 'and nothing is fired yet').toHaveCount(0);

  // Re-assign to Main and confirm hold survives the change.
  await chip.click();
  const main = line.locator('[data-testid="cart-line-course-option-main"]');
  await expect(main).toBeVisible({ timeout: 8_000 });
  await main.click();
  await expect(hold, 'a re-assigned course is still on hold').toBeVisible({ timeout: TIMEOUT });
  await expect(fired, 'and it is not fired yet').toHaveCount(0);

  // Firing flips hold -> fired, and the hold badge goes. That transition is what tells the
  // runner the course is with the kitchen.
  const fireMain = page.locator('[data-testid="fire-course-main"]');
  await expect(fireMain, 'the bar offers the held course').toBeVisible({ timeout: TIMEOUT });
  await fireMain.click();

  await expect(fired, 'firing moves the course badge to fired').toBeVisible({ timeout: TIMEOUT });
  await expect(hold, 'and hold is gone').toHaveCount(0);
});
