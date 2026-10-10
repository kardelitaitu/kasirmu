import { test, expect } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

/**
 * Payment modal LAYOUT contract.
 *
 * Pins the geometry that a unit test cannot see and jsdom cannot compute: the
 * two-column split and the fact that the primary action is NOT inside the
 * scrolling column.
 *
 * Why this file exists: the Complete button used to live inside
 * `.payment-tender-col`, which is the scrolling column, so it sat BELOW the
 * modal's clipped bottom edge (measured 134px on a Redmi tablet in landscape)
 * and the cashier had to scroll to reach it. The e2e suite did not catch it
 * because Playwright auto-scrolls before clicking — a green suite over an
 * unreachable button.
 */

const TIMEOUT = 15_000;

async function openModal(page: import('@playwright/test').Page) {
  await loginAs(page, 'staff', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);

  const cards = page.locator('.restaurant-card');
  await expect(cards.first()).toBeVisible({ timeout: TIMEOUT });
  await cards.first().click();

  const lineItem = page.locator('[data-testid="cart-panel-line-item"]');
  if (!(await lineItem.first().isVisible().catch(() => false))) {
    const trigger = page.locator('.restaurant-floating-cart-trigger');
    if (await trigger.isVisible().catch(() => false)) {
      await trigger.click();
      await expect(page.locator('.restaurant-cart-sheet-panel')).toBeVisible({ timeout: 5_000 });
    }
  }

  const pay = page.locator('.pos-cart-pay-btn');
  await expect(pay).toBeEnabled({ timeout: 8_000 });
  await pay.click();
  await expect(page.locator('[data-testid="payment-modal"]')).toBeVisible({ timeout: 5_000 });
}

test.describe('Payment modal — layout contract', () => {
  test('the commit rail is the right column and the tender column is the left', async ({ page }) => {
    await openModal(page);

    const geo = await page.evaluate(() => {
      const tender = document.querySelector('.payment-tender-col')!.getBoundingClientRect();
      const summary = document.querySelector('.payment-summary-col')!.getBoundingClientRect();
      const total = document.querySelector('.payment-total-row')!.getBoundingClientRect();
      return {
        tenderLeft: Math.round(tender.left),
        summaryLeft: Math.round(summary.left),
        tenderWidth: Math.round(tender.width),
        summaryWidth: Math.round(summary.width),
        totalInsideSummary: total.left >= summary.left - 1 && total.right <= summary.right + 1,
      };
    });

    // Tender/entry on the left, commit rail on the right.
    expect(geo.tenderLeft).toBeLessThan(geo.summaryLeft);
    // The tender column takes the flexible track: it holds a 2-up method grid
    // and the split editor rows (~383px each).
    expect(geo.tenderWidth).toBeGreaterThan(geo.summaryWidth);
    // Total Due lives in the commit rail.
    expect(geo.totalInsideSummary).toBe(true);
  });

  test('the Complete action is NOT inside the scrolling column, and is fully visible', async ({ page }) => {
    await openModal(page);

    // Enter a sufficient tender FIRST. A disabled button carries
    // `pointer-events: none`, so elementFromPoint would return its PARENT and
    // the reachability assertion below would fail for a reason that has nothing
    // to do with layout. (Measured: that is exactly how this test first failed.)
    const tendered = page.locator('.payment-tendered-input');
    await expect(tendered).toBeVisible({ timeout: 3_000 });
    await tendered.click();
    await tendered.pressSequentially('9999999', { delay: 30 });
    await expect(page.locator('[data-testid="settle-button"]')).toBeEnabled({ timeout: 5_000 });

    const geo = await page.evaluate(() => {
      const col = (sel: string) => document.querySelector(sel) as HTMLElement;
      const scroller = [col('.payment-tender-col'), col('.payment-summary-col')]
        .find((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY));
      const modal = col('[data-testid="payment-modal"]').getBoundingClientRect();
      const actions = col('.payment-actions').getBoundingClientRect();
      const settle = col('[data-testid="settle-button"]').getBoundingClientRect();
      const cx = settle.left + settle.width / 2;
      const cy = settle.top + settle.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      const settleEl = col('[data-testid="settle-button"]');
      return {
        actionsParentIsScroller: scroller ? scroller.contains(col('.payment-actions')) : null,
        actionsOverflowPx: Math.round(actions.bottom - modal.bottom),
        modalBottom: Math.round(modal.bottom),
        viewportH: window.innerHeight,
        settleBottom: Math.round(settle.bottom),
        settleHitIsSelf: hit === settleEl || settleEl.contains(hit),
      };
    });

    // The load-bearing assertion: the action row is not in a scrolling container.
    expect(geo.actionsParentIsScroller).toBe(false);
    // ...so it cannot be pushed past the modal's clipped edge.
    expect(geo.actionsOverflowPx).toBeLessThanOrEqual(0);
    expect(geo.settleBottom).toBeLessThanOrEqual(geo.modalBottom + 1);
    // ...and it is actually reachable by a pointer at its centre.
    expect(geo.settleHitIsSelf).toBe(true);
  });

  test('the split EDITOR stays in the wide column; only its toggle moves right', async ({ page }) => {
    await openModal(page);

    // Turn split mode on.
    await page.locator('#payment-split-toggle-cb').check();
    await expect(page.locator('.payment-split-row').first()).toBeVisible({ timeout: 3_000 });

    const geo = await page.evaluate(() => {
      const row = document.querySelector('.payment-split-row') as HTMLElement;
      const group = row.querySelector('.payment-split-method-group') as HTMLElement;
      const tender = document.querySelector('.payment-tender-col')!.getBoundingClientRect();
      const summary = document.querySelector('.payment-summary-col')!.getBoundingClientRect();
      const toggle = document.querySelector('.payment-split-toggle')!.getBoundingClientRect();
      return {
        editorInsideTender:
          tender.left <= row.getBoundingClientRect().left &&
          row.getBoundingClientRect().right <= tender.right + 1,
        // The measured reason the editor cannot go right: it needs ~383px.
        methodGroupOverflow: group.scrollWidth - group.clientWidth,
        rowWidth: Math.round(row.getBoundingClientRect().width),
        toggleInsideSummary:
          summary.left <= toggle.left && toggle.right <= summary.right + 1,
      };
    });

    // Editor: wide column, no horizontal overflow.
    expect(geo.editorInsideTender).toBe(true);
    expect(geo.methodGroupOverflow).toBeLessThanOrEqual(0);
    // Toggle: commit rail.
    expect(geo.toggleInsideSummary).toBe(true);
  });
});
