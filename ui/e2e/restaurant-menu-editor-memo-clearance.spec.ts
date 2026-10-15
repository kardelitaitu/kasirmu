import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

// WHY THIS FILE EXISTS
//
// The menu editor's CATEGORY RAIL was under the memo stack. `RestaurantMenuEditorScreen.css:46`
// pins the rail at `position: sticky; top: var(--space-4)`, and its natural box measured
// `y 105..803` — 698px of content against a 768px viewport — while the stack occupies y 610..747.
//
// Rounds 249-250 measured THREE of the rail's controls inside that band:
//
//   restaurant-menu-editor-cat-edit-cat-snack        y 601
//   restaurant-menu-editor-cat-edit-cat-cold-drink   y 696
//   restaurant-menu-editor-cat-del-cat-cold-drink    y 696   <- a DELETE
//
// So a category could not be edited or deleted while a memo was pending. A `max-height` gated on
// the stack's presence now bounds the rail and gives it a scroll of its own.
//
// WHY A CAP WORKS HERE and not on the receipts preview column (round 249): that column's natural
// height was SHORTER than the viewport, so its cap never engaged. This rail is 698px inside 768px,
// so the cap binds.

const TIMEOUT = 20_000;

async function openMenuEditor(page: Page): Promise<void> {
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });
  await page.locator('.restaurant-sidebar-btn').first().click();
  await page.locator('[data-testid="restaurant-sidebar-menu-editor"]').click();
  await expect(page.locator('.restaurant-menu-editor-rail')).toBeVisible({ timeout: TIMEOUT });
}

test('the rail is bounded so its last category stays reachable', async ({ page }) => {
  await openMenuEditor(page);

  const rail = page.locator('.restaurant-menu-editor-rail');

  // THE BOUND. With memos pending the rail must not extend past the viewport: without the cap its
  // box measured y 105..803 against a 768px viewport, which is what put its last rows under the
  // stack. Asserting the BOTTOM is inside the viewport is the property the cap exists for.
  const box = await rail.boundingBox();
  expect(box, 'the rail is laid out').not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport, 'the project declares a viewport').not.toBeNull();
  expect(
    Math.round(box!.y + box!.height),
    'the rail must not extend past the viewport, or its tail lands under the memo stack',
  ).toBeLessThanOrEqual(viewport!.height);

  // AND IT SCROLLS WHEN IT NEEDS TO. The cap must produce a SCROLL, not a truncation — a bounded
  // box that clipped its overflow would hide the last categories instead of exposing them.
  //
  // Asserted conditionally and honestly: measured, the rail's content fits once the cap applies at
  // the default state, so there is nothing to scroll. The property that matters is the CONDITIONAL —
  // overflow implies a scrollable box — which is what this checks whichever way the seed falls.
  const overflows = await rail.evaluate((el) => el.scrollHeight > el.clientHeight + 4);
  if (overflows) {
    const scrollable = await rail.evaluate((el) => {
      const oy = getComputedStyle(el).overflowY;
      return oy === 'auto' || oy === 'scroll';
    });
    expect(scrollable, 'a capped rail that overflows must own a scroll, not clip').toBe(true);
  }
});

test('a category can be deleted with memos pending', async ({ page }) => {
  await openMenuEditor(page);

  // The control the occlusion made unusable. Round 249's hit-test named this exact id as sitting
  // under the stack; clicking it is what the fix has to make possible.
  const del = page.locator('[data-testid="restaurant-menu-editor-cat-del-cat-cold-drink"]');
  await expect(del, 'the rail offers a delete per category').toBeAttached({ timeout: TIMEOUT });

  await del.scrollIntoViewIfNeeded();
  await expect(del).toBeVisible({ timeout: TIMEOUT });

  // The proof is the click LANDING, not the element existing: Playwright refuses an intercepted
  // click, so `force: true` would be needed if the stack still covered it — and it is not used.
  await del.click({ timeout: 8_000 });
  await expect(
    page.locator('.restaurant-menu-editor-category-modal, [role="dialog"]').first(),
    'the delete confirmation opens',
  ).toBeVisible({ timeout: TIMEOUT });
});