import { test, expect } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

/**
 * E2E Upgrade Trigger Flow: 3-Month Sales History Cap (C1.2 & C2.2)
 *
 * Requirements:
 * - Free tier users hitting the 90-day (3-month) sales history cap see
 *   the blurred overlay / teaser row (.sales-history-cap-teaser) at the bottom
 *   of the Sales History table.
 * - The teaser displays localized explanatory text and a prominent "Upgrade" CTA.
 * - Clicking the Upgrade button triggers external pricing navigation to `/#plus`.
 * - When sales history is not capped, the teaser is hidden.
 */

test.describe('E2E: Subscription Upgrade Trigger Flow', () => {
  test('Free tier user hits 3-month history cap -> sees blurred teaser -> clicks upgrade -> pricing page is opened', async ({
    page,
  }) => {
    // Intercept window.open so the test captures the navigation intent safely in headless mode.
    await page.addInitScript(() => {
      (window as unknown as { __MOCK_SALES_CAPPED?: boolean }).__MOCK_SALES_CAPPED = true;
      (window as unknown as { __OPENED_URLS?: string[] }).__OPENED_URLS = [];
      window.open = function (url?: string | URL) {
        if (url) {
          (window as unknown as { __OPENED_URLS: string[] }).__OPENED_URLS.push(String(url));
        }
        return null;
      };
    });

    // ── Step 1: Login and enter Store POS ───────────────────────────
    await loginAs(page, 'staff', '1234');
    await selectWorkspace(page, WORKSPACES.STORE_POS);

    // ── Step 2: Navigate to Sales History (F6 shortcut) ─────────────
    await page.keyboard.press('F6');
    const historyContainer = page.locator('.sales-history');
    await expect(historyContainer).toBeVisible({ timeout: 10_000 });

    // ── Step 3: Assert blurred history cap teaser is visible ────────
    const teaser = page.locator('.sales-history-cap-teaser');
    await expect(teaser).toBeVisible({ timeout: 8_000 });

    // Verify blurred backdrop overlay exists
    const backdrop = teaser.locator('.sales-history-cap-teaser-backdrop');
    await expect(backdrop).toBeVisible();

    // Verify teaser text mentions 3 months / upgrade to Plus
    const teaserText = await teaser.textContent();
    expect(teaserText).toMatch(/3 months|3 bulan/i);

    // ── Step 4: Click the Upgrade CTA button ────────────────────────
    const upgradeBtn = teaser.getByRole('button', { name: /upgrade/i });
    await expect(upgradeBtn).toBeVisible();
    await upgradeBtn.click();

    // ── Step 5: Verify pricing navigation intent ────────────────────
    await expect
      .poll(
        async () => {
          return page.evaluate(() => {
            return (window as unknown as { __OPENED_URLS?: string[] }).__OPENED_URLS ?? [];
          });
        },
        { timeout: 5_000 },
      )
      .toContainEqual(expect.stringContaining('/pricing/#plus'));

    // ── Step 6: Verify teaser is hidden when not capped ─────────────
    await page.evaluate(() => {
      (window as unknown as { __MOCK_SALES_CAPPED?: boolean }).__MOCK_SALES_CAPPED = false;
    });

    // Toggle filter chip to trigger sales reload without full page re-login
    const allChip = page.locator('.sales-history-filter-chip').filter({ hasText: /all/i }).first();
    if (await allChip.isVisible()) {
      await allChip.click();
      await page.waitForTimeout(500);
    }

    // Teaser should now be removed from the view
    await expect(teaser).toHaveCount(0, { timeout: 5_000 });
  });
});
