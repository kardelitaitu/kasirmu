import { test, expect, type Page } from '@playwright/test';

/**
 * E2E: the first-run flow when the connection is lost, or was never there.
 *
 * Both cases are real for this product — a merchant setting up a till in a shop with no
 * wifi, or one whose connection drops mid-setup. The flow's own module doc states the
 * contract: `provision_device` takes a local DB lock and writes local SQLite rows, so a
 * provision cannot fail for want of a connection, and what offline actually blocks is
 * the ACCOUNT LINK, not the setup.
 *
 * These tests pin that contract from the outside, which no suite did before:
 *  - offline blocks linking and says why;
 *  - offline does NOT block provisioning (the standalone path still finishes);
 *  - an account linked while ONLINE survives the connection dropping, and the terminal
 *    can then still be provisioned offline.
 */

const FIRST_RUN = '/index.mobile.html?unprovisioned=1';

/** Drive the tablet email-code leg to a linked state. Requires a live connection. */
async function linkByEmail(page: Page, email = 'merchant@example.com') {
  await page.getByRole('tab', { name: /Email Code/i }).click();
  await page.getByLabel(/^Account email$/i).fill(email);
  await page.getByRole('button', { name: /Email me a code/i }).click();
  await page.getByLabel(/Verification code/i).fill('123456');
  await page.getByRole('button', { name: /^Verify$/i }).click();
  await expect(page.getByText(new RegExp(`Linked to ${email.replace('.', '\\.')}`, 'i'))).toBeVisible({
    timeout: 10_000,
  });
}

/** Answer the owner step and press submit. Assumes the owner fields are already open. */
async function fillOwnerAndSubmit(page: Page) {
  await page.getByTestId('store-type-simple-retail').click();
  await page.getByLabel(/Shop name/i).fill('Toko Berkah');
  await page.getByLabel(/Your name/i).fill('Budi Santoso');
  await page.getByLabel(/Login name/i).fill('budi');
  await page.getByLabel(/^PIN/i).fill('1234');
  await page.getByLabel(/Confirm PIN/i).fill('1234');
  const submit = page.getByTestId('provision-submit');
  await expect(submit).toBeEnabled();
  await submit.click();
}

/** Report the page offline to the app (the browser event the flow listens for). */
async function goOffline(page: Page) {
  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
}

test.describe('First-run provisioning — connection loss', () => {
  test('an account linked while online survives the connection dropping', async ({ page }) => {
    await page.goto(FIRST_RUN);
    await page.waitForSelector('[data-testid="provisioning-flow"]', { timeout: 20_000 });
    await linkByEmail(page);

    await goOffline(page);

    // The warning appears, and crucially the LINK is not discarded: the merchant
    // already paid the cost of linking and must not be asked to redo it.
    await expect(page.locator('.provisioning-status-warn')).toBeVisible();
    await expect(page.getByText(/Linked to merchant@example\.com\./i)).toBeVisible();
  });

  test('a linked terminal can still be provisioned with the connection down', async ({ page }) => {
    // The contract in the flow's module doc: provisioning is local, so offline blocks
    // the LINK and nothing else. Before this was tested, that was a comment.
    await page.goto(FIRST_RUN);
    await page.waitForSelector('[data-testid="provisioning-flow"]', { timeout: 20_000 });
    await linkByEmail(page);
    await goOffline(page);

    await fillOwnerAndSubmit(page);

    // The shell must move on: the flow is gone once provisioning succeeds.
    await expect(page.getByTestId('provisioning-flow')).toBeHidden({ timeout: 15_000 });
  });

  test('offline blocks linking and explains why, without blocking the offline path', async ({ page }) => {
    await page.goto(FIRST_RUN);
    await page.waitForSelector('[data-testid="provisioning-flow"]', { timeout: 20_000 });

    await goOffline(page);

    // The warning names the real constraint. This entry is the TABLET shell, so the link
    // controls are the QR/email subtabs rather than a Google button — and the email
    // fields they lead to are disabled while offline.
    await expect(page.locator('.provisioning-status-warn')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('tab', { name: /Email Code/i }).click();
    await expect(page.getByLabel(/^Account email$/i)).toBeDisabled();
    await expect(page.getByRole('button', { name: /Email me a code/i })).toBeDisabled();

    // But the standalone path stays open — a merchant with no signal must still be able
    // to set the terminal up, which is the whole reason that mode exists.
    await page.getByTestId('provision-mode-local').click();
    await fillOwnerAndSubmit(page);
    await expect(page.getByTestId('provisioning-flow')).toBeHidden({ timeout: 15_000 });
  });
});
