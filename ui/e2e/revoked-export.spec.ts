import { test, expect } from '@playwright/test';

/**
 * E2E: the ADR #58 §2.6 revoked-account data-export screen.
 *
 * WHY THIS SUITE CAN EXIST AT ALL. `RevokedScreen` renders only when
 * `subscriptionState === 'revoked'`, and the dev-mock answered a hardcoded
 * `state: 'active'` — so the one screen whose entire purpose is letting a
 * suspended merchant retrieve their data had never been loaded in a browser.
 * The `?revoked=1` seam opens it, changing no default.
 *
 * The export flow had a SECOND blocker, found while writing these tests: the
 * real `tauri-plugin-dialog` invokes `plugin:dialog|save`, which had no mock
 * handler, so the mock returned `null` — and the screen reads null as "the user
 * cancelled", returning early in silence. Pressing "Export my data" did nothing
 * at all: no error, no toast, no page error. Both are fixed; this pins them.
 */

/** The tablet entry with the subscription forced to revoked. */
const REVOKED = '/index.mobile.html?revoked=1';

test.describe('Revoked account — data export', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(REVOKED);
    // The screen is behind the boot gate, so wait for the export control rather
    // than for a fixed delay.
    await expect(page.getByRole('button', { name: /Export all local store data/i })).toBeVisible({
      timeout: 20_000,
    });
  });

  test('offers the export, and says why the account is suspended', async ({ page }) => {
    // The merchant must be able to tell what happened and that their data is safe.
    await expect(page.getByRole('heading', { name: /Account suspended/i })).toBeVisible();
    await expect(page.getByText(/existing data is safe/i)).toBeVisible();
  });

  test('the export control has an accessible name, not just visible text', async ({ page }) => {
    // Its aria-label deliberately OVERRIDES the visible "Export my data", so the
    // accessible name is the long form. Pinning it keeps the two from drifting.
    await expect(page.getByRole('button', { name: /Export all local store data/i })).toBeVisible();
  });

  test('exports successfully and tells the merchant so', async ({ page }) => {
    // The whole point of the screen. Before the dialog mock this click was a
    // silent no-op, so the assertion is that SOMETHING is reported back.
    await page.getByRole('button', { name: /Export all local store data/i }).click();
    await expect(page.locator('[class*="toast"]').first()).toContainText(/exported successfully/i, {
      timeout: 10_000,
    });
  });

  test('reports a failed export without leaking the internal error', async ({ page }) => {
    // ERR-05/ERR-10 on the highest-stakes screen: a merchant locked out of their
    // account must not be shown a raw backend string while trying to save their data.
    await page.evaluate(async () => {
      const mod = await import('/src/dev-mock/core/mockDispatcher.ts');
      (mod as { handlers: Record<string, unknown> }).handlers['export_data_without_session'] = () => {
        throw new Error('disk full');
      };
    });

    await page.getByRole('button', { name: /Export all local store data/i }).click();

    const toast = page.locator('[class*="toast"]').first();
    await expect(toast).toContainText(/export failed/i, { timeout: 10_000 });
    await expect(toast).not.toContainText('disk full');
  });
});
