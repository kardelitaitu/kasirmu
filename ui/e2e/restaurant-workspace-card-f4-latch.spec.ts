import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

// WHY THIS FILE EXISTS — THE F4 GUARD THAT COULD NOT FIRE, AND NOW CAN
//
// `WorkspaceRestaurantPosSettings` had an F4 guard whose banner COULD NOT appear. Measured
// 2026-10-14 (round 234) with the read forced to reject 24 times across three modal opens:
//
//   OUTCOMES = 24 x 'failed'      BANNER = 0      RETRY = 0
//
// ## The mechanism, read from the source
//
// ```ts
// :98   if (reloadNonce === 0 && originalsLoadedForRef.current === sessionToken) return;
// :99   originalsLoadedForRef.current = sessionToken;
// :105  getSettingScoped(...).then(...).catch(() => { if (cancelled) return; setLoadFailed(true); })
// :121  return () => { cancelled = true; };
// ```
//
// Under React StrictMode (`main.tsx:23` wraps the whole app) an effect runs, is cleaned up,
// and runs again:
//
//   run 1   :98 falls through (the ref is undefined) -> :99 SETS the ref -> the read starts
//   cleanup cancelled = true
//   run 2   :98 sees ref === token -> RETURNS, so there is no second read
//   result  run 1's failure reaches :117, `cancelled` is true, so :118 is SKIPPED
//
// The latch is set BEFORE the read, and the read that runs belongs to the run that was
// cancelled. `setLoadFailed(true)` is therefore unreachable: the marker can never be set, so
// the banner never renders and Save is never disabled by it.
//
// ## What that means in production
//
// The card shows `courseFiring: false` — its default — from a read that FAILED, and Save stays
// ARMED. That is precisely the F4 loss the comment at `:113-116` says the guard prevents:
// "Seeding `courseFiring: false` here was the F4 loss." The seeding is gone, but the OPERATOR
// is still shown a default they cannot distinguish from a real value.
//
// ## Why this spec asserts the defect
//
// It is real and reproducible, and the fix is a component-internals change — the latch must be
// set after the read resolves, or the cleanup must not discard a failure whose arrival proves
// it was needed. Pinning the current state means the fix's author changes one assertion rather
// than rediscovering the behaviour: the round-231 pattern, which round 232 then retired.

const TIMEOUT = 20_000;

async function openWithArmedFailure(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __MOCK_FAIL?: string[] }).__MOCK_FAIL = ['get_setting_scoped'];
  });
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });
  await page.keyboard.press('F10');
  await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: TIMEOUT });
}

test('a failed course-firing read raises the F4 banner and disables Save', async ({
  page,
}) => {
  // Count the failures the app actually sees. This is what stops the assertion below passing
  // for the wrong reason: the read must genuinely fail before its absence of effect means
  // anything at all (round 226's rule — prove the instrument can see a positive).
  const outcomes: string[] = [];
  page.on('console', (msg) => {
    const m = /\[tauri\] (\S+) → (failed|succeeded)/.exec(msg.text());
    if (m && m[1] === 'get_setting_scoped') outcomes.push(m[2]!);
  });

  await openWithArmedFailure(page);
  await page.waitForTimeout(3000);

  expect(
    outcomes.filter((o) => o === 'failed').length,
    'the read must genuinely be failing, or nothing below is meaningful',
  ).toBeGreaterThan(0);

  // THE GUARD, now that the latch is set on SETTLEMENT (`settle()` in the effect) rather than
  // before the read. Round 234 pinned this same assertion as `toHaveCount(0)` — the defect —
  // and round 235's fix flipped it. That is why the case was written with the failure count
  // asserted first: the inversion is one line, and it is provably about the guard.
  const banner = page.locator('[data-testid="resto-card-load-error"]');
  await expect(banner, 'a failed read must say so').toBeVisible({ timeout: TIMEOUT });
  await expect(banner).toHaveAttribute('role', 'alert');

  await expect(
    page.locator('[data-testid="resto-card-retry-btn"]'),
    'the retry is the way out of the latch',
  ).toBeVisible({ timeout: TIMEOUT });
});

test('the card renders its controls over that failed read', async ({ page }) => {
  await openWithArmedFailure(page);

  // What the operator sees INSTEAD: the card's normal controls, showing the DEFAULT for a
  // value that was never read. That is the shape of the loss.
  const dialog = page.locator('[role="dialog"]').first();
  await expect(dialog.locator('label[for="resto-course-firing"]')).toBeVisible({
    timeout: TIMEOUT,
  });

  // And Save is DISABLED by the failed read — the F4 property the guard exists for: the card is
  // showing a default it could not read, so an armed Save would write it over the real value.
  const save = dialog.getByRole('button', { name: /^save$/i }).first();
  await expect(save, 'a failed read must not leave Save armed').toBeDisabled({
    timeout: TIMEOUT,
  });
});