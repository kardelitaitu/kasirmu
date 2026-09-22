import { test, expect } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES, navigateTo } from './helpers';

/**
 * E2E: the staff trash round trip, through the real UI.
 *
 * The bridge tests already prove the SQL (soft delete, the trash read, restore
 * returning a member INACTIVE) against real SQLite. What no test proved until
 * now is that the assembled app — routing, tab gating, the delete confirmation,
 * the retention badge's localized copy, the restore button — actually carries a
 * member there and back. This spec is that missing layer; it drives the browser
 * against the dev-mock IPC, so it needs no Rust backend, and it runs in both
 * the desktop (Chromium) and tablet (WebKit) projects.
 *
 * Three facts are pinned here that unit tests cannot see:
 *   1. The trash is reachable ONLY with `staff:delete`: an admin session — the
 *      preset that holds everything except irreversible org actions — gets a
 *      tab strip WITHOUT the trash tab, and no route into it renders the trash
 *      either. Deleted identities stay readable in the trash, so its gate is
 *      the delete key, not `staff:read`.
 *   2. Deleting an inactive member, then reading the trash, shows that member
 *      with a freshly-started 90-day window.
 *   3. Restoring brings them back to the roster INACTIVE — the state delete
 *      found them in — which is why the row is deletable again afterwards.
 *
 * The mock's seed carries `staff-5` / `Auditor` inactive ON PURPOSE: delete
 * refuses an active member, so without an inactive row this flow would be
 * unreachable in the browser preview.
 *
 * Both halves are mutation-proved, not merely green: forcing the screen's
 * `canDeleteStaff` gate open fails case 1, and making restore leave the member
 * active fails case 3. Note which layer does the enforcing — widening the
 * `trash` ROUTE registration's permission to `staff:read` did NOT fail case 1,
 * because the screen re-derives the same permission for its tab strip and
 * panel. The route declaration and the screen check are two independent
 * statements of one rule, and these assertions cover the outcome rather than
 * either mechanism.
 */

test.describe('Staff trash — delete and restore round trip', () => {
  test('an inactive member moves to the trash, shows the 90-day window, and restores inactive', async ({
    page,
  }) => {
    await loginAs(page, 'owner', '1234');
    await selectWorkspace(page, WORKSPACES.ADMIN);
    await navigateTo(page, 'staff');
    await expect(page.locator('.staff-mgmt-header')).toBeVisible({ timeout: 10_000 });

    // The owner holds staff:delete, so the trash tab exists for this session.
    const trashTab = page.getByTestId('staff-tab-trash');
    await expect(trashTab).toBeVisible();

    // Only an INACTIVE member is deletable — the button's presence IS the rule,
    // so state it from both sides: the inactive row has it, the active one has
    // not.
    await expect(page.getByTestId('staff-card-staff-5')).toBeVisible();
    const deleteBtn = page.getByTestId('staff-delete-staff-5');
    await expect(deleteBtn).toBeVisible();
    await expect(page.getByTestId('staff-delete-staff-4')).toHaveCount(0);

    await deleteBtn.click();
    // Delete requires explicit confirmation naming the member.
    const confirm = page.getByTestId('confirm-dialog-confirm');
    await expect(confirm).toBeVisible();
    await expect(page.locator('.confirm-dialog-body')).toContainText('Auditor');
    await confirm.click();

    // Gone from the live roster.
    await expect(page.getByTestId('staff-card-staff-5')).toHaveCount(0);

    // The TAB reaches the trash, with the retention window restarted at 90 days.
    await trashTab.click();
    const trashedRow = page.getByTestId('staff-trash-staff-5');
    await expect(trashedRow).toBeVisible();
    await expect(trashedRow).toContainText('Auditor');
    await expect(trashedRow).toContainText('90 days before permanent deletion');
    await expect(page.getByTestId('staff-trash-restore-staff-5')).toBeVisible();

    // Back to the roster, then in again by DEEP LINK — the positive control for
    // the admin case below, which asserts this same list is absent.
    await page.getByTestId('staff-tab-account').click();
    await expect(page.getByTestId('staff-card-staff-5')).toHaveCount(0);
    await navigateTo(page, 'trash');
    await expect(page.getByTestId('staff-trash-staff-list')).toBeVisible();
    await expect(page.getByTestId('staff-trash-staff-5')).toBeVisible();

    // Restore returns them to the roster INACTIVE, exactly as delete found them.
    await page.getByTestId('staff-trash-restore-staff-5').click();
    await expect(page.getByTestId('staff-trash-staff-5')).toHaveCount(0);
    await expect(page.getByTestId('staff-trash-empty')).toBeVisible();

    await page.getByTestId('staff-tab-account').click();
    await expect(page.getByTestId('staff-card-staff-5')).toBeVisible();
    // Still inactive: the power button offers "restore", and the row is still
    // deletable. Either alone would lie while the member was wrongly active.
    await expect(page.getByTestId('staff-toggle-active-staff-5')).toHaveClass(
      /staff-mgmt-icon-btn--restore/,
    );
    await expect(page.getByTestId('staff-delete-staff-5')).toBeVisible();
  });

  test('a manager-level session without staff:delete never renders the trash', async ({ page }) => {
    await loginAs(page, 'admin', '9999');
    await selectWorkspace(page, WORKSPACES.ADMIN);
    await navigateTo(page, 'staff');
    await expect(page.locator('.staff-mgmt-header')).toBeVisible({ timeout: 10_000 });

    // The screen IS reachable for this session, and its tab strip rendered: two
    // visible tabs and a deliberately missing third. Asserting the present ones
    // is what makes the absence below a gate decision rather than a broken page.
    await expect(page.getByTestId('staff-tab-account')).toBeVisible();
    await expect(page.getByTestId('staff-tab-roles')).toBeVisible();
    await expect(page.getByTestId('staff-tab-trash')).toHaveCount(0);

    // No route into it renders the trash either: not the panel, not the list,
    // not the empty state.
    await navigateTo(page, 'trash');
    await expect(page.getByTestId('staff-trash-staff-list')).toHaveCount(0);
    await expect(page.getByTestId('staff-trash-empty')).toHaveCount(0);
  });
});
