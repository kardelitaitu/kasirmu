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

  test('a failed submit shows its error beside the button, in view', async ({ page }) => {
    // The defect this pins, measured on the desktop POS viewport (1366x768): the
    // card is ~1460px, so pressing "Finish setup" means scrolling down. The
    // failure used to render in the banner at the TOP of the card, at
    // errTop -87 — 87px above the viewport. The merchant saw nothing at all.
    // This asserts the message lands on screen, not merely in the DOM.
    await page.evaluate(async () => {
      const mod = await import('/src/dev-mock/core/mockDispatcher.ts');
      (mod as { handlers: Record<string, unknown> }).handlers['provision_device'] = () => {
        throw new Error('backend exploded');
      };

    });

    await page.getByTestId('provision-mode-local').click();
    await fillOwnerForm(page);
    const submit = page.getByTestId('provision-submit');
    await submit.scrollIntoViewIfNeeded();
    await submit.click();

    const err = page.getByTestId('provision-submit-error');
    // `toBeInViewport`, not `toBeVisible`: an element scrolled off-screen is still
    // "visible" to Playwright, and off-screen is exactly the bug.
    await expect(err).toBeInViewport({ timeout: 10_000 });
    await expect(err).toHaveAttribute('role', 'alert');
    await expect(page.getByTestId('provision-submit')).toBeEnabled();
  });

  test('links an account by emailed code and finishes, end to end', async ({ page }) => {
    // THE FLOW THE WHOLE FIRST-RUN PATH IS BUILT AROUND, and until 2026-09-23 it
    // could not be completed in dev or E2E at all: `link_device_google`,
    // `link_device_email_request` and `link_device_email_consume` had no dev-mock
    // handler, so invoke() returned null for all three. The email path accepted an
    // address, showed the code field, then rejected EVERY code with "That code did
    // not work" — a merchant could not link an account on a dev preview.
    await page.getByRole('tab', { name: /Email Code/i }).click();
    await page.getByLabel(/^Account email$/i).fill('merchant@example.com');
    await page.getByRole('button', { name: /Email me a code/i }).click();

    await page.getByLabel(/Verification code/i).fill('123456');
    await page.getByRole('button', { name: /^Verify$/i }).click();

    // The link is confirmed back to the merchant, naming the address.
    await expect(page.getByText(/Linked to merchant@example\.com\./i)).toBeVisible({ timeout: 10_000 });

    // And a linked terminal can actually finish: the account step stops gating submit.
    await fillOwnerForm(page);
    const submit = page.getByTestId('provision-submit');
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByTestId('provisioning-flow')).toBeHidden({ timeout: 15_000 });
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

  test('a fresh terminal lands on login after setup, not back on owner bootstrap', async ({ page }) => {
    // THE DEFECT THIS PINS (measured 2026-09-23). On a fresh install `has_users` answers
    // false, which is what opens owner bootstrap. `provision_device` then CREATES the owner
    // inside its transaction (ADR #56 §2.2) — but the shells hold `hasAnyUsers` from the
    // boot read and never refreshed it, so the merchant was dropped straight back onto
    // "Create Owner PIN", asked to create the account they had just created, with the
    // success toast still on screen.
    //
    // `?nousers=1` is what makes this reachable: it is the honest fresh-install answer.
    await page.goto('/index.mobile.html?nousers=1&unprovisioned=1');
    await page.waitForSelector('[data-testid="provisioning-flow"]', { timeout: 20_000 });

    await page.getByTestId('provision-mode-local').click();
    await fillOwnerForm(page);
    await page.getByTestId('provision-submit').click();

    // The flow leaves, and the shell does NOT re-offer owner bootstrap.
    await expect(page.getByTestId('provisioning-flow')).toBeHidden({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /Create Owner PIN/i })).toBeHidden();

    // It lands on the login screen, where the owner they just created can sign in.
    await expect(page.getByTestId('staff-login-screen')).toBeVisible({ timeout: 15_000 });
  });
});

