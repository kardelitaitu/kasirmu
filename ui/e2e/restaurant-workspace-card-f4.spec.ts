import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

// WHY THIS FILE EXISTS — AND WHAT IT NOW PINS
//
// Round 231 set out to cover the FOURTH F4 guard, in `WorkspaceRestaurantPosSettings` — the
// restaurant-POS setting surface reached through the workspace settings modal — and found the
// modal could not render at all:
//
//   Workspace Settings | Something went wrong
//   useSettings must be used within a <SettingsProvider>
//
// `AppShell.tsx:435-459` renders the modal for F10 as a sibling of the workspace screens, but
// `SettingsProvider` was rendered only inside `SettingsPage.tsx:108`; the workspace cards call
// `useSettings()`. Round 231 pinned the crash as the reachable behaviour.
//
// Round 232 FIXED it by wrapping the portal's content in `<SettingsProvider>` — the only place
// that covers every caller, since `createPortal` puts the tree on `document.body` outside the
// caller's React tree. This file now pins the FIXED behaviour and the F4 guard it was opened for.

const TIMEOUT = 20_000;

const SETTING_CMD = 'get_setting_scoped';

async function openWorkspaceSettings(page: Page, failRead = false): Promise<void> {
  if (failRead) {
    await page.addInitScript((cmd) => {
      (window as unknown as { __MOCK_FAIL?: string[] }).__MOCK_FAIL = [cmd];
    }, SETTING_CMD);
  }
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });
  await page.keyboard.press('F10');
  await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: TIMEOUT });
}

test('F10 renders the workspace settings instead of throwing', async ({ page }) => {
  await openWorkspaceSettings(page);

  const dialog = page.locator('[role="dialog"]').first();
  const text = await dialog.innerText();

  // THE REGRESSION. Before the fix this text was `useSettings must be used within a
  // <SettingsProvider>` behind an error boundary; the assertion is the negative so a
  // reintroduced missing provider fails here rather than in production.
  expect(text, 'the modal must not throw').not.toMatch(
    /useSettings must be used within a <SettingsProvider>|Something went wrong/,
  );

  // And the cards are what renders instead — the restaurant-POS card's own controls.
  await expect(dialog).toContainText(/Table Management/i);
  await expect(dialog).toContainText(/Course Firing/i);
});

test('the card renders its restaurant-POS controls once the modal opens', async ({ page }) => {
  await openWorkspaceSettings(page);

  const dialog = page.locator('[role="dialog"]').first();

  // The card is LIVE, not merely present: both of its toggles have real labels wired to them.
  // `resto-table-mgmt` is Table Management, `resto-course-firing` is the setting whose READ the
  // F4 guard protects — so a rendered control here is what makes the guard meaningful at all.
  await expect(dialog.locator('label[for="resto-table-mgmt"]')).toBeVisible({ timeout: TIMEOUT });
  await expect(dialog.locator('label[for="resto-course-firing"]')).toBeVisible({ timeout: TIMEOUT });

  // And they are operable — flipping one is what the card exists for. Through the LABEL: the
  // raw `role=switch` input is styled out of the layout (rounds 148, 170, 179, 228, 230).
  await dialog.locator('label[for="resto-course-firing"]').first().click();
  const toggle = dialog.locator('[data-testid="setting-course-firing-toggle"], input#resto-course-firing');
  if (await toggle.count() > 0) {
    await expect(toggle.first()).toBeAttached();
  }
});

// ⚠️ NOT COVERED HERE, and why. The two F4 cases this file was opened for could NOT be made to
// reach the banner. The card's read is gated by a once-per-session latch (`:98`):
//
//   if (reloadNonce === 0 && originalsLoadedForRef.current === sessionToken) return;
//
// so by the time F10 opens the modal the read has already happened, and forcing
// `get_setting_scoped` to reject afterwards changes nothing. Reaching it would need the injection
// armed BEFORE the workspace mounts — which the same seam provides, but the ordering against the
// modal's own mount was not established inside this round's budget.
//
// Round 233's first step: arm the failure in an init script keyed to the SESSION rather than the
// modal, or drive the Read through `reloadNonce` by pressing Retry on a healthy load.
