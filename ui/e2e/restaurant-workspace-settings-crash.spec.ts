import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

// WHY THIS FILE EXISTS — AND WHAT IT FOUND
//
// The FOURTH F4 guard, in `WorkspaceRestaurantPosSettings` — the restaurant-POS setting surface
// reached through the workspace settings modal. Reaching it turned up something the other three
// rounds did not: **the modal crashes when F10 opens it.**
//
// ```
// Workspace Settings | Admin Settings | Something went wrong
// useSettings must be used within a <SettingsProvider>
// Try Again
// ```
//
// Measured with NO injection of any kind, so it is not an artefact of the failure seam:
//
//   AppShell.tsx renders `<WorkspaceSettingsModal>` for F10 (`:435-459`)
//   SettingsProvider is rendered ONLY inside `SettingsPage.tsx:108`
//   `WorkspaceRestaurantPosSettings.tsx:34` calls `useSettings()`
//
// So the modal works when opened FROM the settings page and throws from every workspace. Its unit
// tests pass because they supply the provider themselves
// (`WorkspaceSettingsModal.test.tsx:210`, `…role-swap.test.tsx:134`) — the tree under test has a
// provider the real shell does not.
//
// This spec pins the REACHABLE behaviour rather than the intended one. When the crash is fixed,
// the assertions below are what should change — deliberately, in one place.

const TIMEOUT = 20_000;

async function openWorkspaceSettings(page: Page): Promise<void> {
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });
  await page.keyboard.press('F10');
  await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: TIMEOUT });
}

test('F10 does not reach the settings cards for a restaurant workspace', async ({ page }) => {
  await openWorkspaceSettings(page);

  const dialog = page.locator('[role="dialog"]').first();
  const text = await dialog.innerText();

  // THE DEFECT, pinned as it is: the modal's error boundary, not its cards.
  expect(
    text,
    'F10 opens the modal but it throws before rendering its cards — see the header for why',
  ).toMatch(/useSettings must be used within a <SettingsProvider>/);

  // The cards are therefore absent, including the F4 guard this round set out to cover. Asserting
  // the ABSENCE keeps the file honest about the current behaviour rather than implying coverage.
  await expect(
    page.locator('[data-testid="resto-card-load-error"]'),
    'the card cannot render while the modal throws',
  ).toHaveCount(0);
});

test('the modal offers a way past the crash', async ({ page }) => {
  await openWorkspaceSettings(page);

  const dialog = page.locator('[role="dialog"]').first();
  // The shell wraps the modal in a boundary WITH a reset control. That is what stops a thrown
  // render from leaving the operator with an unusable screen and no way back.
  await expect(dialog.getByRole('button', { name: /try again/i })).toBeVisible({
    timeout: 8_000,
  });
});