import { test, expect, type Page } from '@playwright/test';
import { openRestaurantPosWithItem } from './helpers';

// WHY THIS FILE EXISTS
//
// Round 205 covered the course CHIP, which puts a line on hold. This covers the firing
// ACTION — the bar that sends a held course to the kitchen. Together they are the
// mechanic `restaurant.course_firing` switches on:
//
//   assign a course  ->  coursingStatus 'hold'   (round 205)
//   fire the course  ->  coursingStatus 'fired'  (this file)
//
// `CourseSelectorBar` renders one button per course that HAS holds, each carrying its
// hold COUNT, plus a Fire-All. `fireCourse` is deliberately narrow
// (`usePosState.ts:215-223`): it flips 'hold' to 'fired' for ONE course and leaves
// everything else alone. `fireAllCourses` (`:228-236`) flips every held line.
//
// Getting this wrong has a physical cost: firing the wrong course sends food early, and
// firing nothing leaves a table waiting.

const TIMEOUT = 20_000;

// Course firing must be ENABLED: the default is `false`
// (`restaurantSettingsModel.ts:60`) and the chip and bar both gate on
// `courseFiringEnabled !== false` (`CartPanel.tsx:961`, `:1003`). Round 205 established
// this by measuring `CHIPS=0` on a default profile; this is the same seed.
async function seedCourseFiring(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const key = 'oz-dev-mock:settings';
    if (localStorage.getItem(key) !== null) return;
    localStorage.setItem(key, JSON.stringify({ 'restaurant.course_firing': 'true' }));
  });
}

// Open the POS, dismiss the portrait sheet, and add `count` distinct lines.
async function openWithLines(page: Page, count: number): Promise<void> {
  await seedCourseFiring(page);
  await openRestaurantPosWithItem(page);
  const backdrop = page.locator('[data-testid="restaurant-cart-sheet-backdrop"]');
  if (await backdrop.isVisible().catch(() => false)) {
    await backdrop.click({ position: { x: 5, y: 5 } });
    await expect(backdrop).toHaveCount(0, { timeout: 8_000 });
  }
  for (let n = 1; n < count; n += 1) {
    await page.locator('.restaurant-card').nth(n).click();
  }
  await expect
    .poll(() => page.locator('[data-testid="cart-panel-line-item"]').count(), {
      timeout: TIMEOUT,
    })
    .toBe(count);
}

// Assign a course to one line, by index.
async function assignCourse(page: Page, index: number, course: string): Promise<void> {
  const line = page.locator('[data-testid="cart-panel-line-item"]').nth(index);
  await line.locator('[data-testid="cart-line-course-chip"]').click();
  const option = line.locator(`[data-testid="cart-line-course-option-${course}"]`);
  await expect(option).toBeVisible({ timeout: 8_000 });
  await option.click();
  await expect(line.locator('[data-testid="cart-line-course-chip"]')).toContainText(
    new RegExp(course, 'i'),
    { timeout: TIMEOUT },
  );
}

test('the bar offers a held course with its count, and firing clears it', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'needs grid and cart visible at once');

  await openWithLines(page, 2);

  // Nothing is on hold yet, so NO fire button exists — the bar is a function of holds,
  // not a permanent fixture.
  const mainBtn = page.locator('[data-testid="fire-course-main"]');
  await expect(mainBtn, 'no holds means no fire button').toHaveCount(0);

  await assignCourse(page, 0, 'main');

  // One hold on Main: the button exists and reports the COUNT, which is what tells the
  // runner how much is queued.
  await expect(mainBtn).toBeVisible({ timeout: TIMEOUT });
  await expect(mainBtn).toContainText('1');

  await mainBtn.click();

  // Firing empties the holds for that course, so the button goes away with them.
  await expect(mainBtn, 'firing clears the holds that produced the button').toHaveCount(0, {
    timeout: TIMEOUT,
  });
});

test('firing one course leaves another course on hold', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'needs grid and cart visible at once');

  await openWithLines(page, 2);

  await assignCourse(page, 0, 'main');
  await assignCourse(page, 1, 'dessert');

  const mainBtn = page.locator('[data-testid="fire-course-main"]');
  const dessertBtn = page.locator('[data-testid="fire-course-dessert"]');
  await expect(mainBtn).toBeVisible({ timeout: TIMEOUT });
  await expect(dessertBtn).toBeVisible({ timeout: TIMEOUT });

  // Firing Main must NOT fire Dessert. That is the whole point of per-course firing —
  // the dessert is held back until the mains are cleared.
  await mainBtn.click();
  await expect(mainBtn).toHaveCount(0, { timeout: TIMEOUT });
  await expect(dessertBtn, 'an unrelated course must stay on hold').toBeVisible({
    timeout: TIMEOUT,
  });
});

test('Fire All clears every held course', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'needs grid and cart visible at once');

  await openWithLines(page, 2);
  await assignCourse(page, 0, 'main');
  await assignCourse(page, 1, 'dessert');

  const fireAll = page.locator('[data-testid="fire-all-courses"]');
  await expect(fireAll, 'the batch control appears with the first hold').toBeVisible({
    timeout: TIMEOUT,
  });

  await fireAll.click();

  // Both courses fire and the whole bar empties — including the batch button itself,
  // which renders only while something is on hold.
  await expect(page.locator('[data-testid="fire-course-main"]')).toHaveCount(0, {
    timeout: TIMEOUT,
  });
  await expect(page.locator('[data-testid="fire-course-dessert"]')).toHaveCount(0, {
    timeout: TIMEOUT,
  });
  await expect(fireAll, 'nothing left to fire').toHaveCount(0, { timeout: TIMEOUT });
});