import { test, expect, type Page } from '@playwright/test';

/**
 * E2E: First-run provisioning (ADR #56 §2.3).
 *
 * WHY THIS SUITE CAN EXIST AT ALL. `ProvisioningFlow` was unreachable in a browser
 * for the whole setup audit: the DESKTOP shell bypasses it under
 * `import.meta.env.DEV` (AppShell.tsx:214-217 sets `setupKnownComplete(true)` before
 * any IPC call, so the mock's answer is never consulted), and the tablet shell —
 * which has no bypass — reads `get_first_run_state`, whose dev-mock answer was a
 * hardcoded `provisioned`. Round 10 measured both dead ends.
 *
 * The dev-mock now honours `?unprovisioned=1`, so this suite drives the TABLET
 * entry (`/index.mobile.html`), where no dev bypass stands in the way. Every test
 * here would have been impossible before that flag.
 */

/** The tablet entry, with the first-run gate forced open. */
const FIRST_RUN = '/index.mobile.html?unprovisioned=1';

/** Fill the fields a local-mode provisioning needs. */
async function fillOwnerForm(page: Page, opts: { store?: string; shop?: string } = {}) {
  await page.getByTestId('store-type-' + (opts.store ?? 'simple-retail')).click();
  await page.getByLabel(/Shop name/i).fill(opts.shop ?? 'Toko Berkah');
  await page.getByLabel(/Your name/i).fill('Budi Santoso');
  await page.getByLabel(/Login name/i).fill('budi');
  await page.getByLabel(/^PIN/i).fill('1234');
  await page.getByLabel(/Confirm PIN/i).fill('1234');
}

test.describe('First-run provisioning', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FIRST_RUN);
    await page.getByTestId('provisioning-flow').waitFor({ state: 'visible', timeout: 15_000 });
  });

  test('renders the flow on a terminal that is not provisioned', async ({ page }) => {
    // The screen a merchant sees before they have a working register.
    await expect(page.getByRole('heading', { name: /Set up this terminal/i })).toBeVisible();
    // Both store types are offered, and the offline path is reachable.
    await expect(page.getByTestId('store-type-simple-retail')).toBeVisible();
    await expect(page.getByTestId('store-type-restaurant')).toBeVisible();
    await expect(page.getByTestId('provision-mode-local')).toBeVisible();
  });

  test('will not submit until the form is complete', async ({ page }) => {
    // A disabled control is the first line of defence; the empty-form state must
    // never be submittable.
    await expect(page.getByTestId('provision-submit')).toBeDisabled();
  });

  test('completes an offline setup end to end and leaves the flow', async ({ page }) => {
    // The merchant's core promise: no account, no connection, a working terminal.
    await page.getByTestId('provision-mode-local').click();
    await fillOwnerForm(page);

    const submit = page.getByTestId('provision-submit');
    await expect(submit).toBeEnabled();
    await submit.click();

    // The shell must move on: the flow is gone once provisioning succeeds.
    await expect(page.getByTestId('provisioning-flow')).toBeHidden({ timeout: 15_000 });
  });

  test('names a PIN mismatch instead of leaving submit silently dead', async ({ page }) => {
    // The inline validation added in the audit. Before it the button simply stayed
    // disabled and the merchant had to guess which field was wrong.
    await page.getByTestId('provision-mode-local').click();
    await fillOwnerForm(page);
    await page.getByLabel(/Confirm PIN/i).fill('9999');

    await expect(page.locator('#provision-pin-error')).toHaveText(/do not match/i);
    await expect(page.getByLabel(/Confirm PIN/i)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('provision-submit')).toBeDisabled();
  });

  test('marks a too-short PIN', async ({ page }) => {
    await page.getByTestId('provision-mode-local').click();
    await fillOwnerForm(page);
    await page.getByLabel(/Confirm PIN/i).fill('');
    await page.getByLabel(/^PIN/i).fill('12');
    // The field LABEL also contains "at least 4 digits", so scope to the error
    // element the component renders rather than matching both.
    await expect(page.locator('#provision-pin-error')).toHaveText(/at least 4 digits/i);
  });

  test('shows how much of the form is left', async ({ page }) => {
    // Measured: the card is ~1423px tall in a 1366px viewport, so the submit
    // button starts BELOW the fold. The rail is the only thing telling the
    // merchant how much form remains — this asserts it is actually on screen
    // at first paint, not merely in the DOM.
    await expect(page.getByText(/Step 1 of 3/i)).toBeVisible();

    // The first step is the current one, exposed to AT as a position.
    const steps = page.getByRole('listitem').filter({ hasText: 'Account' });
    await expect(steps).toHaveAttribute('aria-current', 'step');

    // Completing a step advances the count and marks it done.
    await page.getByTestId('provision-mode-local').click();
    await expect(page.getByText(/Step 2 of 3/i)).toBeVisible();

    await page.getByTestId('store-type-simple-retail').click();
    await expect(page.getByText(/Step 3 of 3/i)).toBeVisible();
  });
});

// ── The first-run owner bootstrap (has_users === false) ────────────────
//
// `CreatePinScreen` is the OTHER first-run gate: it opens when the shell reads
// `has_users: false`, i.e. a store with no owner account at all. It was
// unreachable in a browser for the same reason the provisioning flow was — the
// dev-mock answered a hardcoded `true` — so it carried no E2E coverage until the
// `?nousers=1` seam. The default is deliberately unchanged: a normal dev preview
// still reports its seeded owner.
const NO_USERS = '/index.mobile.html?nousers=1';

test.describe('First-run owner bootstrap', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(NO_USERS);
  });

  test('opens the owner-bootstrap screen when no accounts exist', async ({ page }) => {
    // The store really has no users, so a login could never succeed — the shell
    // must offer bootstrap rather than a dead login form.
    await expect(page.getByRole('heading', { name: /Create Owner PIN/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('#displayName')).toBeVisible();
    await expect(page.locator('#username')).toBeVisible();
    await expect(page.locator('#pin')).toBeVisible();
    await expect(page.locator('#confirmPin')).toBeVisible();
  });

  test('every bootstrap field has an accessible name', async ({ page }) => {
    // The fields carry a real <label>, so this is addressable by name — the same
    // contract the provisioning flow's tablet fields had to be given this round.
    await expect(page.getByLabel(/Display Name/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel(/^Username$/i)).toBeVisible();
    await expect(page.getByLabel(/^PIN$/i)).toBeVisible();
    await expect(page.getByLabel(/Confirm PIN/i)).toBeVisible();
  });

  test('will not submit an incomplete bootstrap', async ({ page }) => {
    const submit = page.getByRole('button', { name: /Create/i });
    await expect(submit).toBeVisible({ timeout: 15_000 });
    await expect(submit).toBeDisabled();
  });

  test('names the offending field instead of silently refusing to submit', async ({ page }) => {
    // A PIN that cannot possibly match must be named, not merely blocked.
    await page.getByLabel(/Display Name/i).fill('Budi Santoso');
    await page.getByLabel(/^Username$/i).fill('budi');
    await page.getByLabel(/^PIN$/i).fill('1234');
    await page.getByLabel(/Confirm PIN/i).fill('9999');

    const submit = page.getByRole('button', { name: /Create/i });
    await submit.click();

    // The submit is refused and the mismatch is reported through aria-invalid on
    // the field itself — the association a screen reader follows.
    await expect(page.getByLabel(/Confirm PIN/i)).toHaveAttribute('aria-invalid', 'true');
  });

});
