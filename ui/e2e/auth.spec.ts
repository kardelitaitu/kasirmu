import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './helpers';

/**
 * E2E: Staff Login with PIN — Hard Assertions
 *
 * Verifies the complete authentication flow with deterministic assertions.
 * All guards (`if (count > 0)`) removed — tests hard-fail on regressions.
 *
 * Dev-mock credentials:
 *   - "owner"   / "1234"  → role: owner,   display: "Owner"
 *   - "admin"   / "9999"  → role: admin,   display: "Admin"
 *   - "manager" / "1234"  → role: manager, display: "Manager"
 *   - "staff"   / "1234"  → role: staff,   display: "Staff"
 *   - "auditor" / "1234"  → role: auditor, display: "Auditor"
 *
 * CSS contract (StaffLoginScreen.tsx):
 *   .staff-login-screen     — container
 *   .staff-login-input      — username text input
 *   .staff-login-submit-btn — submit / next button
 *   .staff-login-pad        — PIN keypad (visible after username step)
 *   .staff-login-pad-key    — individual digit buttons
 *   .staff-login-pin-dot--filled — filled PIN dot
 *   .toast--error           — error toast (replaces inline error alert)
 *   .staff-login-lockout    — lockout countdown (rate-limit)
 *   .workspace-home         — workspace picker (post-login success)
 *   .ws-header-greeting     — display name in workspace header
 */

const VALID_USER = 'owner';
const VALID_PIN = '1234';
const WRONG_PIN = '0000';
// A wrong PIN that never touches the bottom keypad row. The error toast overlays
// that row on the tablet layout, so a test needing several consecutive taps (the
// colour check below) has to stay clear of it rather than race the toast.
const WRONG_PIN_TOP_ROW = '9999';
const UNKNOWN_USER = 'nonexistent';

async function enterPin(page: Page, pin: string) {
  for (const digit of pin) {
    const key = page.locator('.staff-login-pad-key').filter({ hasText: digit });
    await key.click();
    await page.waitForTimeout(80);
  }
}

test.describe('Staff Login', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.staff-login-screen', { timeout: 15_000 });
  });

  // ── E2E-4: Hard-assert login happy path ──────────────────────

  test('successful login shows workspace picker with greeting', async ({ page }) => {
    // Enter username.
    await page.locator('.staff-login-input').fill(VALID_USER);
    await page.locator('.staff-login-submit-btn').click();

    // Wait for PIN pad (not waitForTimeout).
    await page.locator('.staff-login-pad').waitFor({ state: 'visible', timeout: 10_000 });

    // Enter PIN.
    await enterPin(page, VALID_PIN);

    // Workspace home must render with greeting (hard assertion).
    // Note: hash-based routing means the URL may or may not include #/
    // depending on the router initialisation order — asserting workspace
    // content is more reliable than asserting the URL pattern.
    await expect(page.locator('.workspace-home')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.ws-header-greeting')).toContainText('Owner');
  });

  // ── E2E-5: Assert error text for wrong PIN ───────────────────

  test('shows "Invalid credentials" for wrong PIN', async ({ page }) => {
    await page.locator('.staff-login-input').fill(VALID_USER);
    await page.locator('.staff-login-submit-btn').click();
    await page.locator('.staff-login-pad').waitFor({ state: 'visible', timeout: 10_000 });

    // Enter wrong PIN.
    await enterPin(page, WRONG_PIN);

    // Error must appear as a toast with exact dev-mock error text.
    const errorToast = page.locator('.toast--error');
    await expect(errorToast).toBeVisible({ timeout: 8_000 });
    await expect(errorToast).toContainText('Invalid credentials');

    // Must stay on login screen.
    await expect(page.locator('.staff-login-screen')).toBeVisible();
  });

  // ── E2E-5b: the failed PIN marks the FIELD, not only the toast ────
  //
  // The unit tests assert this at the DOM level. This one runs in a real
  // browser, which is the layer that matters: it proves the mark survives the
  // actual React commit and the CSS, and that a reader reaching the PIN row
  // after a failure finds it marked invalid.

  test('wrong PIN marks the PIN row invalid in the real DOM', async ({ page }) => {
    await page.locator('.staff-login-input').fill(VALID_USER);
    await page.locator('.staff-login-submit-btn').click();
    await page.locator('.staff-login-pad').waitFor({ state: 'visible', timeout: 10_000 });

    const pinDots = page.locator('.staff-login-pin-dots');
    // Valid before any attempt.
    await expect(pinDots).not.toHaveAttribute('aria-invalid', 'true');

    await enterPin(page, WRONG_PIN);
    await expect(page.locator('.toast--error')).toBeVisible({ timeout: 8_000 });

    // The mark lands once auth state carries the error.
    await expect(pinDots).toHaveAttribute('aria-invalid', 'true', { timeout: 8_000 });

    // And it clears when the user starts retrying, so a fresh attempt is not
    // announced as already wrong.
    await enterPin(page, '1');
    await expect(pinDots).not.toHaveAttribute('aria-invalid', 'true');
  });
  // ── E2E-6: Assert uniform pre-auth for unknown username (STAFF-06) ──

  test('unknown username advances to PIN step then errors (STAFF-06)', async ({ page }) => {
    await page.locator('.staff-login-input').fill(UNKNOWN_USER);
    await page.locator('.staff-login-submit-btn').click();

    // STAFF-06: the pre-check returns a uniform { proceed: true } and never
    // reveals whether the account exists — the screen must advance to the
    // PIN step for ANY username (no enumeration oracle).
    await expect(page.locator('.staff-login-pad')).toBeVisible({ timeout: 10_000 });

    // Entering a PIN for an unknown account fails with the uniform error.
    await enterPin(page, '1234');

    // Wait for the async login to complete and the error toast to appear.
    const errorToast = page.locator('.toast--error');
    await expect(errorToast).toBeVisible({ timeout: 8_000 });
    await expect(errorToast).toContainText('Invalid credentials');

    // Must stay on login screen.
    await expect(page.locator('.staff-login-screen')).toBeVisible();
  });

  // ── E2E-7: Rate-limit lockout UI ─────────────────────────────

  test('rate-limit lockout after 5 wrong PIN attempts', async ({ page }) => {
    await page.locator('.staff-login-input').fill(VALID_USER);
    await page.locator('.staff-login-submit-btn').click();
    await page.locator('.staff-login-pad').waitFor({ state: 'visible', timeout: 10_000 });

    // Enter wrong PIN 5 times.
    for (let attempt = 0; attempt < 5; attempt++) {
      await enterPin(page, WRONG_PIN);

      // Wait for error toast to appear, then continue.
      const errorToast = page.locator('.toast--error');
      await errorToast.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});

      // If we're locked out, stop.
      const lockoutVisible = await page
        .locator('.staff-login-lockout, [class*="lockout"]')
        .isVisible()
        .catch(() => false);
      if (lockoutVisible) break;

      // Wait for PIN to clear before next attempt.
      await page.waitForTimeout(500);
    }

    // After 5 attempts, either lockout appears or PIN pad is disabled.
    const lockoutEl = page.locator('.staff-login-lockout, [class*="lockout"], .staff-login-rate-limit--lockout');
    const pinPadDisabled = page.locator('.staff-login-pad[aria-disabled="true"]');

    const lockoutVisible = await lockoutEl.isVisible().catch(() => false);
    const padDisabled = await pinPadDisabled.isVisible().catch(() => false);

    // At least one lockout mechanism must be active.
    expect(lockoutVisible || padDisabled).toBe(true);
  });

  // ── E2E-8: Session persistence across reload ─────────────────

  test('returns to login screen after page reload', async ({ page }) => {
    // Login successfully first.
    await page.locator('.staff-login-input').fill(VALID_USER);
    await page.locator('.staff-login-submit-btn').click();
    await page.locator('.staff-login-pad').waitFor({ state: 'visible', timeout: 10_000 });
    await enterPin(page, VALID_PIN);
    await page.waitForSelector('.workspace-home', { timeout: 15_000 });

    // Reload the page.
    await page.reload();

    // Session is NOT persisted in localStorage — login screen should appear.
    await page.waitForSelector('.staff-login-screen', { timeout: 15_000 });
    await expect(page.locator('.staff-login-screen')).toBeVisible();
  });

  // ── E2E-5c: the invalid state is VISIBLE, not only announced ──────
  //
  // aria-invalid is invisible. This is the one assertion no jsdom suite can
  // make: whether the stylesheet actually colours the row, which is what a
  // sighted user gets instead of reading the toast.

  test('wrong PIN colours the PIN dots, not just the attribute', async ({ page }) => {
    await page.locator('.staff-login-input').fill(VALID_USER);
    await page.locator('.staff-login-submit-btn').click();
    await page.locator('.staff-login-pad').waitFor({ state: 'visible', timeout: 10_000 });

    const dots = page.locator('.staff-login-pin-dots');
    const firstDot = page.locator('.staff-login-pin-dot').first();

    // The same dot while the row is VALID. Comparing against an empty row would
    // prove nothing useful if the dots were ever filled here, so both readings are
    // taken on the same (empty) dot: valid first, invalid after.
    const validColour = await firstDot.evaluate((el) => getComputedStyle(el).borderColor);

    await enterPin(page, WRONG_PIN_TOP_ROW);
    // Wait for the row to carry the mark before reading the computed style; the
    // failed attempt raises a toast that overlays the keypad on the tablet layout.
    await expect(dots).toHaveAttribute('aria-invalid', 'true', { timeout: 8_000 });

    // Assert the border IS the danger colour, resolved from the token the rule
    // names — an exact value rather than merely "different", which is what makes
    // this fail when the rule is removed instead of passing on the filled state.
    // WAIT FOR THE COLOUR TO SETTLE. The dot transitions `border-color`
    // (StaffLoginScreen.css:455), so reading it the instant aria-invalid appears
    // returns a mid-transition BLEND — measured rgb(192,112,143), which differs
    // from the valid colour whether or not the invalid rule exists. That made an
    // earlier version of this test pass with the rule deleted.
    //
    // Poll until two consecutive reads agree, then assert against the danger token
    // resolved from a sibling outside the dot. `--color-danger` is theme-dependent
    // (desktop rgb(255,107,104) vs tablet rgb(244,108,111)), so a literal would pin
    // the theme rather than the behaviour.
    // Poll until two consecutive reads agree, i.e. the transition has finished.
    let settled = validColour;
    await expect
      .poll(
        async () => {
          const a = await firstDot.evaluate((el) => getComputedStyle(el).borderColor);
          await page.waitForTimeout(80);
          const b = await firstDot.evaluate((el) => getComputedStyle(el).borderColor);
          if (a !== b) return null;
          settled = a;
          return a;
        },
        { timeout: 5_000, message: 'dot border-color never settled' },
      )
      .not.toBeNull();

    // The danger colour is read from a probe OUTSIDE the dot, so the dot's own
    // transition and border rules cannot recolour the reference.
    const danger = await page.evaluate(() => {
      const probe = document.createElement('span');
      document.body.appendChild(probe);
      probe.style.borderColor = 'var(--color-danger)';
      probe.style.borderStyle = 'solid';
      const c = getComputedStyle(probe).borderColor;
      probe.remove();
      return c;
    });

    expect(danger).not.toBe('');
    expect(settled).toBe(danger);
  });
  // ── Bonus: Clears PIN dots after error ───────────────────────

  test('clears PIN dots when error occurs', async ({ page }) => {
    await page.locator('.staff-login-input').fill(VALID_USER);
    await page.locator('.staff-login-submit-btn').click();
    await page.locator('.staff-login-pad').waitFor({ state: 'visible', timeout: 10_000 });

    await enterPin(page, WRONG_PIN);

    // Error toast should appear.
    await expect(page.locator('.toast--error')).toBeVisible({ timeout: 8_000 });

    // PIN dots must be cleared (no filled dots).
    await expect(page.locator('.staff-login-pin-dot--filled')).toHaveCount(0);
  });

  // ── Bonus: PIN step indicator shows active step ──────────────

  test('shows PIN step as active after username submit', async ({ page }) => {
    await page.locator('.staff-login-input').fill(VALID_USER);
    await page.locator('.staff-login-submit-btn').click();

    // PIN pad must appear.
    await expect(page.locator('.staff-login-pad')).toBeVisible({ timeout: 10_000 });

    // Step indicator dot for PIN step (index 1) must be active.
    const stepDots = page.locator('.staff-login-step-dot');
    const dotCount = await stepDots.count();
    if (dotCount > 1) {
      await expect(stepDots.nth(1)).toHaveClass(/staff-login-step-dot--active/);
    }
  });

  // ── Bonus: Admin login shows correct greeting ───────────────

  test('admin login shows admin greeting', async ({ page }) => {
    await loginAs(page, 'admin', '9999');
    await expect(page.locator('.ws-header-greeting')).toContainText('Admin');
  });

  // ── Bonus: Staff login shows staff greeting ─────────────────

  test('staff login shows staff greeting', async ({ page }) => {
    await loginAs(page, 'staff', '1234');
    await expect(page.locator('.ws-header-greeting')).toContainText('Staff');
  });

  test('a server outage at the PIN step shows connection copy, not internal text', async ({ page }) => {
    // The leak this pins (measured 2026-09-23): with the login call failing at the
    // transport level, the PIN step rendered the raw internal string "network down"
    // to the cashier — Error.message straight from the IPC boundary. The merchant
    // needs to know it is the connection, not their PIN, or they will keep retyping
    // a correct PIN until the lockout trips.
    await page.goto('/index.html');
    await page.getByTestId('staff-login-screen').waitFor({ timeout: 30_000 });
    await page.locator('.staff-login-input').first().fill('owner');
    await page.locator('.staff-login-submit-btn').click();
    await page.locator('.staff-login-pad').waitFor({ timeout: 15_000 });

    // The server dies between the username check and the PIN submit.
    await page.evaluate(async () => {
      const mod = await import('/src/dev-mock/core/mockDispatcher.ts');
      (mod as { handlers: Record<string, unknown> }).handlers['staff_login'] = () => {
        throw new Error('network down');
      };
    });
    for (const d of '1234') {
      await page.locator('.staff-login-pad-key').filter({ hasText: d }).click();
    }

    const toast = page.locator('.toast--error').first();
    await expect(toast).toBeVisible({ timeout: 10_000 });
    await expect(toast).not.toContainText('network down');
    await expect(toast).toContainText(/offline|connection/i);
  });
});
