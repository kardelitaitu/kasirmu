import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import staffFtl from '@/locales/staff.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

// ── Mocks ────────────────────────────────────────────────────────

const { mockCreateStaff, mockUpdateStaff, mockGetProfile } = vi.hoisted(() => ({
  mockCreateStaff: vi.fn(),
  mockUpdateStaff: vi.fn(),
  mockGetProfile: vi.fn(),
}));

vi.mock('@/api/staff', () => ({
  createStaffScoped: (_t: string, args: unknown) => mockCreateStaff(args),
  updateStaffScoped: (_t: string, args: unknown) => mockUpdateStaff(args),
  getStaffProfileScoped: (_t: string, id: string) => mockGetProfile(id),
  isStaffQuotaLimitError: () => false,
}));

vi.mock('@/api/workspaces', () => ({
  listAllWorkspacesScoped: () => Promise.resolve([]),
}));
vi.mock('@/api/locations', () => ({
  listLocationsScoped: () => Promise.resolve([]),
}));
vi.mock('@/api/legalEntities', () => ({
  listLegalEntitiesScoped: () => Promise.resolve([]),
}));
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok-1', activeWorkspace: null, logout: vi.fn() }),
}));
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ addToast: vi.fn(), removeToast: vi.fn(), clearToasts: vi.fn() }),
}));

import { StaffDetailDrawer } from '@/features/staff/components/StaffDetailDrawer';

const ROLES = [
  { id: 'role-owner', name: 'Owner', permissions: [] },
  { id: 'role-staff', name: 'Staff', permissions: [] },
] as never[];

/** Fill every field `validateProfileForm` demands for a CREATE. */
function fillRequiredFields() {
  const set = (id: string, value: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) throw new Error('missing field ' + id);
    fireEvent.change(el, { target: { value } });
  };
  set('staff-field-username', 'newbie');
  set('staff-field-name', 'New Bie');
  set('staff-field-pin', '1234');
  set('staff-field-dob', '1990-01-01');
  set('staff-field-phone', '+628123456789');
  set('staff-field-email', 'newbie@example.com');
  set('staff-field-national-id', '1234567890123456');
  set('staff-field-pay', '5000000');
  set('staff-field-emergency-name', 'Kin');
  set('staff-field-emergency-phone', '+628123456780');
  const role = document.getElementById('staff-field-role') as HTMLSelectElement | null;
  if (role) fireEvent.change(role, { target: { value: 'role-staff' } });
  const idType = document.getElementById('staff-field-national-id-type') as HTMLSelectElement | null;
  if (idType) fireEvent.change(idType, { target: { value: 'nik' } });
}

describe('StaffDetailDrawer — create re-entry', () => {
  beforeEach(() => {
    mockCreateStaff.mockReset();
    mockUpdateStaff.mockReset();
    mockGetProfile.mockResolvedValue(null);
  });

  it('creates a staff member once for a double click while the first is in flight', async () => {
    // `users.username` is UNIQUE, so the replay is refused -- and the catch reports
    // `staff-error-save-failed`. The operator is told the account was not created while the
    // first tap created it, and is left on a drawer for an account that now exists.
    let releaseCreate: ((v: unknown) => void) | undefined;
    mockCreateStaff.mockImplementation(
      () => new Promise((resolve) => { releaseCreate = resolve; }),
    );

    renderWithFluentSync(
      <StaffDetailDrawer open member={null} roles={ROLES} onClose={vi.fn()} onSaved={vi.fn()} />,
      staffFtl, sharedFtl,
    );

    await waitFor(() => expect(document.getElementById('staff-field-username')).toBeTruthy());
    fillRequiredFields();

    const saveBtn = screen.getByTestId('staff-detail-save') as HTMLButtonElement;
    // fireEvent, not userEvent.click: userEvent awaits its own act(), which flushes the
    // pending chain so the first create would have settled and the clicks would never
    // overlap. The disabled flag React set is dropped for the second click so the atomic
    // guard is measured, not the DOM.
    await act(async () => {
      fireEvent.click(saveBtn);
      saveBtn.removeAttribute('disabled');
      fireEvent.click(saveBtn);
    });

    expect(
      mockCreateStaff.mock.calls.length,
      'a double click on Create sent the staff create twice; users.username is UNIQUE so ' +
        'the second is refused and reported as a save failure',
    ).toBe(1);

    releaseCreate?.(undefined);
    await waitFor(() => expect(mockCreateStaff).toHaveBeenCalledTimes(1));
  });

  it('does not strand the guard when validation refuses the submit', async () => {
    // The guard is taken AFTER validation, so one refused submit must leave it clear.
    // Flipping the order would set the flag with no `finally` to clear it and the drawer
    // could never be saved again.
    //
    // The state has to be one the BUTTON permits. `saveDisabled` already mirrors the
    // required-field checks, so an empty form never reaches the handler -- measured: the
    // button is disabled before the first click, and a case built on it would pass with the
    // guard in either position. A 3-character PIN does clear the button (it only checks
    // `length < 4`... and so does `validateProfileForm`), so the refusal used here is a
    // malformed EMAIL: nothing on the button reads it, and validateProfileForm rejects it.
    mockCreateStaff.mockResolvedValue(undefined);

    renderWithFluentSync(
      <StaffDetailDrawer open member={null} roles={ROLES} onClose={vi.fn()} onSaved={vi.fn()} />,
      staffFtl, sharedFtl,
    );

    await waitFor(() => expect(document.getElementById('staff-field-username')).toBeTruthy());

    fillRequiredFields();
    fireEvent.change(document.getElementById('staff-field-email')!, {
      target: { value: 'not-an-email' },
    });

    const saveBtn = screen.getByTestId('staff-detail-save') as HTMLButtonElement;
    expect(saveBtn.disabled, 'the button must be enabled or this case reaches no handler').toBe(false);
    fireEvent.click(saveBtn);
    expect(mockCreateStaff).not.toHaveBeenCalled();

    // A valid email must still be able to save: the guard did not survive the refusal.
    fireEvent.change(document.getElementById('staff-field-email')!, {
      target: { value: 'newbie@example.com' },
    });
    fireEvent.click(screen.getByTestId('staff-detail-save'));
    await waitFor(() => expect(mockCreateStaff).toHaveBeenCalledTimes(1));
  });
});
