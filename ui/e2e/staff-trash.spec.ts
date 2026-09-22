import { test, expect, type Locator } from '@playwright/test';
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
 * The ROLE half rides the same tab strip but a different store, and its two
 * rules differ from the staff half in ways a shared assertion would miss:
 *   - A PRESET role carries no Edit and no Delete at all (the seeder owns it),
 *     so the round trip has to run on a role this test authors first.
 *   - A trashed role is restored as a LIVE authored row — unlike staff, it is
 *     not forced inactive, because a role has no activation state to restore.
 *     "Usable again" is therefore proved by the restored row reappearing as a
 *     live authored row whose editor reopens on the grant it was authored with.
 *
 * Both halves are mutation-proved, not merely green: forcing the screen's
 * `canDeleteStaff` gate open fails case 1, and making restore leave the member
 * active fails case 3. Note which layer does the enforcing — widening the
 * `trash` ROUTE registration's permission to `staff:read` did NOT fail case 1,
 * because the screen re-derives the same permission for its tab strip and
 * panel. The route declaration and the screen check are two independent
 * statements of one rule, and these assertions cover the outcome rather than
 * either mechanism. The role round trip is mutation-proved from the role side
 * of the mock the same way: making `restore_role_scoped` leave the row in
 * `MOCK_TRASH_ROLES` fails the assertion that it left the trash, and making
 * `list_role_trash_scoped` serve the LIVE authored roles instead fails the
 * assertion that the deleted role is listed there.
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

  test('a custom role moves to the trash, shows the 90-day window, and restores usable', async ({
    page,
  }) => {
    await loginAs(page, 'owner', '1234');
    await selectWorkspace(page, WORKSPACES.ADMIN);
    await navigateTo(page, 'staff');
    await expect(page.locator('.staff-mgmt-header')).toBeVisible({ timeout: 10_000 });

    // The dev preview pins memo bubbles to the viewport's bottom-left (fixed,
    // z-index --z-overlay). At the tablet viewport the role list reaches that
    // corner, so a bubble physically covers the Delete button and Playwright
    // refuses the click as intercepted — the same app-level overlay collision
    // admin-workflows.spec.ts documents for the settings footer. The overlap
    // itself is being fixed at the layout level in parallel; here the demo
    // bubbles are dismissed rather than clicked through, because
    // `click({ force: true })` would dispatch past an overlay a real tablet
    // user hits and hide the collision this spec is supposed to expose.
    //
    // Clearing once at the top does not survive a case this long: the flow
    // fills three fields and saves (slow on the tablet project) and the stack
    // is live again by the Delete click. So every critical click clears first,
    // and retries after re-clearing if a bubble still wins the race.
    const clearMemos = async () => {
      const ackButtons = page.getByTestId('memo-banner-acknowledge');
      for (let i = 0; i < 5; i++) {
        const remaining = await ackButtons.count();
        if (remaining === 0) return;
        try {
          await ackButtons.first().click({ timeout: 2_000 });
        } catch {
          // An open modal sits ABOVE the stack, so a bubble cannot be the thing
          // covering the click this helper is about to make — leave it be.
          return;
        }
        // The bubble plays a 450ms exit before its row unmounts, so the count
        // only drops once that finishes — wait for it rather than re-clicking a
        // button that is disabled mid-exit.
        await expect(ackButtons).toHaveCount(remaining - 1);
      }
    };
    const clickCleared = async (target: Locator) => {
      for (let attempt = 0; ; attempt++) {
        await clearMemos();
        try {
          await target.click({ timeout: 5_000 });
          return;
        } catch (e) {
          if (attempt >= 2) throw e;
        }
      }
    };

    await clickCleared(page.getByTestId('staff-tab-roles'));

    // A PRESET row carries no Edit and no Delete at all — the seeder owns it,
    // so an edit would be silently overwritten on the next re-seed. The seeded
    // AUTHORED row beside it does carry both, which is what makes the absence
    // a decision about the `is_builtin` flag rather than a missing feature.
    const roleRowNamed = (name: string) =>
      page.locator('.role-list-item').filter({
        has: page.locator('.role-list-name', { hasText: name }),
      });
    const presetRow = roleRowNamed(/^Manager$/);
    await expect(presetRow).toBeVisible();
    await expect(presetRow.locator('[data-testid^="staff-role-edit-"]')).toHaveCount(0);
    await expect(presetRow.locator('[data-testid^="staff-role-delete-"]')).toHaveCount(0);
    await expect(
      roleRowNamed(/^Night Manager$/).locator('[data-testid^="staff-role-delete-"]'),
    ).toBeVisible();

    // Author a custom role. The name is unique per run so a dev server kept
    // alive across runs (reuseExistingServer) cannot let a previous run's row
    // answer for this one.
    const roleName = `E2E Role ${Date.now()}`;
    await clickCleared(page.getByTestId('staff-add-role-btn'));
    const popup = page.locator('.settings-popup');
    await expect(popup).toBeVisible();
    await popup.locator('.role-input').first().fill(roleName);
    await popup.locator('.role-input').nth(1).fill('Authored by the staff-trash round-trip spec.');
    // Exactly one grant, so "usable again" has a permission set that must
    // survive the round trip rather than an empty one that survives trivially.
    await popup.getByLabel('reports:view').check();
    await clickCleared(page.getByTestId('settings-popup-save'));

    const authoredRow = roleRowNamed(roleName);
    await expect(authoredRow).toBeVisible();
    await expect(authoredRow).toContainText('Custom');
    const deleteBtn = authoredRow.locator('[data-testid^="staff-role-delete-"]');
    await expect(deleteBtn).toBeVisible();
    // The id is server-generated, so it is read back off the rendered row
    // rather than assumed.
    const roleId = ((await deleteBtn.getAttribute('data-testid')) ?? '').replace(
      'staff-role-delete-',
      '',
    );
    expect(roleId).not.toBe('');

    await clickCleared(deleteBtn);
    // Delete requires explicit confirmation naming the role, like staff delete.
    const confirm = page.getByTestId('confirm-dialog-confirm');
    await expect(confirm).toBeVisible();
    await expect(page.locator('.confirm-dialog-body')).toContainText(roleName);
    await clickCleared(confirm);

    // Gone from the live role list.
    await expect(authoredRow).toHaveCount(0);

    // The Trash tab lists it under "Deleted roles", with a freshly-started
    // 90-day window — the same retention copy the staff half shows.
    await clickCleared(page.getByTestId('staff-tab-trash'));
    const trashedRow = page.getByTestId(`staff-trash-${roleId}`);
    await expect(page.getByTestId('staff-trash-role-list')).toBeVisible();
    await expect(trashedRow).toBeVisible();
    await expect(trashedRow).toContainText(roleName);
    await expect(trashedRow).toContainText('90 days before permanent deletion');
    await expect(page.getByTestId(`staff-trash-restore-${roleId}`)).toBeVisible();

    await clickCleared(page.getByTestId(`staff-trash-restore-${roleId}`));
    await expect(trashedRow).toHaveCount(0);
    // Positive control for the restore: nothing else was in the trash, so the
    // empty state — not a silently still-rendered list — is what proves the row
    // left the trash rather than merely losing its badge.
    await expect(page.getByTestId('staff-trash-empty')).toBeVisible();

    // Re-enter the Roles tab through a fresh screen instance. The panel keeps
    // its OWN copy of the role list and fetches it on mount only, while the
    // restore's onRestored reloads the SHELL's copy (StaffManagementScreen
    // load()), which feeds the roster's "Roles" stat tile and the drawer — not
    // this panel. So a plain tab click still shows the list as it was BEFORE
    // the restore: measured on the desktop project, 6 rows with the restored
    // role absent. That is a real staleness defect, reported alongside this
    // spec; re-entering is what makes the live list observable today and keeps
    // this case correct once the panel is given a refresh path.
    await navigateTo(page, 'settings');
    await navigateTo(page, 'roles');

    // Usable again: a live authored row carrying the one grant it was authored
    // with — not a tombstone, and not a row whose permission set was dropped by
    // the round trip.
    await expect(authoredRow).toBeVisible();
    await expect(authoredRow).toContainText('Custom');
    await expect(authoredRow).toContainText('1 permission');
    await clickCleared(authoredRow.locator('[data-testid^="staff-role-edit-"]'));
    const reopened = page.locator('.settings-popup');
    await expect(reopened).toBeVisible();
    await expect(reopened.locator('.role-input').first()).toHaveValue(roleName);
    await expect(reopened.getByLabel('reports:view')).toBeChecked();
  });
});
