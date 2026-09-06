import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import {
  assertAllInvokesHandled,
  recordUnmatchedInvoke,
  resetUnmatchedInvokes,
} from '@/__tests__/test-utils/invokeCoverage';
import staffFtl from '@/locales/staff.ftl?raw';
import StaffManagementScreen from '@/features/staff/StaffManagementScreen';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { makeSubscriptionCaps } from '@/__tests__/test-utils/mocks/subscriptionCaps';

// FAST_WAIT: 5ms polling for async assertions (10x faster than default 50ms).
const FAST_WAIT = { interval: 5, timeout: 500 } as const;

const SAMPLE_ROLES = [
  { id: 'role-owner', name: 'owner', description: 'Owner', permissions: ['*'] },
  { id: 'role-admin', name: 'admin', description: 'Admin', permissions: ['staff:read', 'reports:view', 'analytics:view'] },
  { id: 'role-manager', name: 'manager', description: 'Manager', permissions: ['sales:view', 'reports:view', 'analytics:view', 'staff:read'] },
  { id: 'role-staff', name: 'staff', description: 'Staff', permissions: ['sales:process', 'sales:view'] },
  { id: 'role-auditor', name: 'auditor', description: 'Auditor', permissions: ['reports:view', 'audit:view'] },
  // A custom role must never appear in the five-role taxonomy dropdown.
  { id: 'role-custom', name: 'custom', description: 'Custom', permissions: [] },
];

/** Global fallback assignment (ADR #35 D5) carried by the staff DTO. */
const GLOBAL_ASSIGNMENT = {
  scope_mode: 'global',
  branches_all: true,
  branch_ids: [],
  workspaces_all: true,
  workspace_keys: [],
};

const SAMPLE_STAFF = [
  { id: 'staff-1', username: 'jane', display_name: 'Jane Smith', role_id: 'role-owner', role_name: 'owner', is_active: true, national_id_masked: '*****6789', is_profile_complete: true, assignment: GLOBAL_ASSIGNMENT },
  { id: 'staff-2', username: 'john', display_name: 'John Doe', role_id: 'role-staff', role_name: 'staff', is_active: false, national_id_masked: '****', is_profile_complete: false, assignment: { scope_mode: 'scoped', branches_all: true, branch_ids: [], workspaces_all: false, workspace_keys: ['restaurant'] } },
];

/** Store profiles = the branch ids the assignment scopes on. */
const SAMPLE_BRANCHES = [
  { id: 'store-a', name: 'Jakarta HQ', address: '', tax_id: '', currency: 'IDR', timezone: 'Asia/Jakarta', is_primary: true, created_at: '', updated_at: '' },
  { id: 'store-b', name: 'Bandung Branch', address: '', tax_id: '', currency: 'IDR', timezone: 'Asia/Jakarta', is_primary: false, created_at: '', updated_at: '' },
];

/** A complete ADR #35 D6 profile as `get_staff_profile_scoped` returns it. */
const SAMPLE_PROFILE = {
  user_id: 'staff-2',
  username: 'john',
  display_name: 'John Doe',
  date_of_birth: '1990-05-14',
  phone: '+14155550123',
  national_id_type: 'ssn',
  national_id: '123456789',
  national_id_masked: '*****6789',
  email: 'john@example.com',
  monthly_take_home_minor: 5_000_000,
  emergency_contact_name: 'Jane',
  emergency_contact_phone: '+14155550987',
  job_title: '',
  notes: '',
  is_complete: true,
};

const { invokeMock } = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invokeMock: vi.fn() as any,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user_id: 'test', display_name: 'Test', role_name: 'owner', role_id: 'role-1' },
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    isManager: true,
    isOwner: true,
  }),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'session-1' }),
}));

beforeEach(() => {
  invokeMock.mockClear();
  resetUnmatchedInvokes();
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'list_staff_scoped') return Promise.resolve(SAMPLE_STAFF);
    if (cmd === 'list_roles_scoped') return Promise.resolve(SAMPLE_ROLES);
    if (cmd === 'create_staff_scoped') return Promise.resolve({ ...SAMPLE_STAFF[0], username: 'newuser' });
    if (cmd === 'update_staff_scoped') return Promise.resolve(SAMPLE_STAFF[0]);
    if (cmd === 'get_staff_profile_scoped') return Promise.resolve(SAMPLE_PROFILE);
    if (cmd === 'list_all_workspaces_scoped') return Promise.resolve([
      { key: 'restaurant', name: 'Restaurant', description: 'Dine-in service', icon: 'restaurant' },
      { key: 'store', name: 'Retail Store', description: 'Retail counter', icon: 'store' },
    ]);
    if (cmd === 'list_locations_scoped') return Promise.resolve(SAMPLE_BRANCHES);
    // Reached via the app shell's branding provider, not the screen itself.
    // Without it every test below rendered the error branch -- 23 of 26.
    // Shape matches the other suites that mock this (CloudSyncSettings.test.tsx).
    if (cmd === 'get_brand_settings' || cmd === 'get_brand_settings_scoped') {
      return Promise.resolve({ primary_colour: '#4f46e5', logo_path: null, store_name: '' });
    }
    recordUnmatchedInvoke(cmd);
    return Promise.reject(new Error(`Unknown command: ${cmd}`));
  });
});

afterEach(() => assertAllInvokesHandled('StaffManagementScreen'));

async function waitForTable() {
  await screen.findByRole('table', { name: /staff members/i });
}

/** Fill the 8 required profile fields in the add/edit dialog. */
async function fillRequiredProfile(dialog: HTMLElement) {
  fireEvent.change(within(dialog).getByLabelText('Date of Birth *'), { target: { value: '1990-05-14' } });
  fireEvent.change(within(dialog).getByLabelText('Phone *'), { target: { value: '+14155550123' } });
  fireEvent.change(within(dialog).getByLabelText('National ID Type *'), { target: { value: 'ssn' } });
  fireEvent.change(within(dialog).getByLabelText('National ID *'), { target: { value: '123456789' } });
  fireEvent.change(within(dialog).getByLabelText('Email *'), { target: { value: 'new@example.com' } });
  fireEvent.change(within(dialog).getByLabelText('Monthly Take-Home Pay *'), { target: { value: '5000000' } });
  fireEvent.change(within(dialog).getByLabelText('Emergency Contact *'), { target: { value: 'Bob' } });
  fireEvent.change(within(dialog).getByLabelText('Emergency Contact Phone *'), { target: { value: '+14155550987' } });
}

describe('StaffManagementScreen', () => {
  it('renders title and add button', async () => {
    renderWithProvidersSync(<StaffManagementScreen />, staffFtl);
    await waitForTable();
    expect(screen.getByRole('heading', { name: /staff/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add staff/i })).toBeInTheDocument();
  });

  it('renders staff table rows', async () => {
    renderWithProvidersSync(<StaffManagementScreen />, staffFtl);
    await waitForTable();
    expect(screen.getAllByText('Jane Smith').length).toBeGreaterThan(0);
    expect(screen.getAllByText('John Doe').length).toBeGreaterThan(0);
    expect(screen.getByText('jane')).toBeInTheDocument();
    expect(screen.getByText('john')).toBeInTheDocument();
    expect(screen.getByText('owner')).toBeInTheDocument();
    expect(screen.getByText('staff')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('shows empty state when no staff', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_staff_scoped') return Promise.resolve([]);
      if (cmd === 'list_roles_scoped') return Promise.resolve(SAMPLE_ROLES);
      if (cmd === 'list_all_workspaces_scoped') return Promise.resolve([]);
      return Promise.resolve([]);
    });
    renderWithProvidersSync(<StaffManagementScreen />, staffFtl);
    await waitFor(() => {
      expect(screen.getByText(/no staff members yet/i)).toBeInTheDocument();
    }, FAST_WAIT);
    expect(screen.getByRole('button', { name: /add your first staff member/i })).toBeInTheDocument();
  });

  it('shows loading skeleton initially', async () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const { container } = renderWithProvidersSync(<StaffManagementScreen />, staffFtl);
    const skeleton = container.querySelector('[aria-hidden="true"].staff-mgmt-loading-skeleton');
    expect(skeleton).toBeInTheDocument();
    expect(screen.queryByText(/loading staff/i)).not.toBeInTheDocument();
  });

  it('opens add modal', async () => {
    renderWithProvidersSync(<StaffManagementScreen />, staffFtl);
    await waitForTable();
    fireEvent.click(screen.getByRole('button', { name: /add staff/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/add staff member/i);
  });

  it('opens edit modal pre-filled', async () => {
    renderWithProvidersSync(<StaffManagementScreen />, staffFtl);
    await waitForTable();
    const editBtn = screen.getByRole('button', { name: /edit.*jane smith/i });
    fireEvent.click(editBtn);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/edit staff member/i);
  });

  // ── STAFF-09 regression — editing must not reactivate inactive staff ─

  it('preserves is_active when editing an inactive member', async () => {
    renderWithProvidersSync(<StaffManagementScreen />, staffFtl);
    await waitForTable();

    // Edit John (inactive) and save a profile change.
    const editBtn = screen.getByRole('button', { name: /edit.*john doe/i });
    fireEvent.click(editBtn);
    const dialog = await screen.findByRole('dialog');
    // ADR #35 D6: the edit form is pre-filled from get_staff_profile_scoped.
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Date of Birth *')).toHaveValue('1990-05-14');
    }, FAST_WAIT);
    fireEvent.change(within(dialog).getByRole('textbox', { name: /display name/i }), { target: { value: 'John D.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /update/i }));

    // update_staff_scoped must carry is_active: false (unchanged), not true.
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('update_staff_scoped', expect.objectContaining({
        sessionToken: 'session-1',
        args: expect.objectContaining({
          id: 'staff-2',
          is_active: false,
        }),
      }));
    }, FAST_WAIT);
  });

  // ── New edge-case tests ─────────────────────────────────────────

  it('deactivates an active staff member after confirming the dialog (STAFF-10)', async () => {
    renderWithProvidersSync(<StaffManagementScreen />, staffFtl);
    await waitForTable();

    // Find the Deactivate button for Jane (active)
    const deactivateBtn = screen.getByRole('button', { name: /deactivate.*jane smith/i });
    fireEvent.click(deactivateBtn);

    // The confirmation dialog must appear before any request is sent.
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith('update_staff_scoped', expect.objectContaining({
      args: expect.objectContaining({ id: 'staff-1', is_active: false }),
    }));

    // Confirm the deactivation.
    fireEvent.click(within(dialog).getByRole('button', { name: /deactivate/i }));

    // update_staff_scoped should be called with is_active: false
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('update_staff_scoped', expect.objectContaining({
        sessionToken: 'session-1',
        args: expect.objectContaining({
          id: 'staff-1',
          is_active: false,
        }),
      }));
    }, FAST_WAIT);
  });

  it('reactivates an inactive staff member when Restore is clicked', async () => {
    renderWithProvidersSync(<StaffManagementScreen />, staffFtl);
    await waitForTable();

    // Find the Restore button for John (inactive) via visible text content
    const restoreBtn = screen.getByText('Restore').closest('button')!;
    fireEvent.click(restoreBtn);

    // update_staff_scoped wraps args in { args } — assert the inner payload
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('update_staff_scoped', expect.objectContaining({
        sessionToken: 'session-1',
        args: expect.objectContaining({
          id: 'staff-2',
          is_active: true,
        }),
      }));
    }, FAST_WAIT);
  });

  it('closes the add modal when Escape is pressed', async () => {
    renderWithProvidersSync(<StaffManagementScreen />, staffFtl);
    await waitForTable();

    // Open add modal
    fireEvent.click(screen.getByRole('button', { name: /add staff/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Press Escape — kept as userEvent.keyboard because the modal's
    // useFocusTrap hook uses a native addEventListener for keydown,
    // which userEvent simulates more faithfully than fireEvent.keyDown.
    const user = userEvent.setup();
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    }, FAST_WAIT);
  });

  it('creates a new staff member via the add modal', async () => {
    renderWithProvidersSync(<StaffManagementScreen />, staffFtl);
    await waitForTable();

    // Open add modal and fill form
    fireEvent.click(screen.getByRole('button', { name: /add staff/i }));
    const dialog = screen.getByRole('dialog');

    // Fill username — fireEvent.change saves ~140ms vs userEvent.type
    fireEvent.change(within(dialog).getByRole('textbox', { name: /username/i }), { target: { value: 'newuser' } });

    // Fill display name
    fireEvent.change(within(dialog).getByRole('textbox', { name: /display name/i }), { target: { value: 'New User' } });

    // Fill PIN — use placeholder to avoid matching both label and input elements
    fireEvent.change(within(dialog).getByPlaceholderText(/enter pin/i), { target: { value: '1234' } });

    // Select a role
    fireEvent.change(within(dialog).getByRole('combobox', { name: /^role/i }), { target: { value: 'role-staff' } });

    // ADR #35 D6: creation requires the 9 mandatory fields.
    await fillRequiredProfile(dialog);

    // Click Create
    fireEvent.click(within(dialog).getByRole('button', { name: /create/i }));

    // create_staff_scoped wraps args in { args }
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('create_staff_scoped', expect.objectContaining({
        sessionToken: 'session-1',
        args: expect.objectContaining({
          username: 'newuser',
        }),
      }));
    }, FAST_WAIT);

    // Modal should close
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    }, FAST_WAIT);
  });

  // ── ADR #35 D6 UI behaviors ────────────────────────────────────

  it('renders the national id masked to last-4 in the list', async () => {
    renderWithProvidersSync(<StaffManagementScreen />, staffFtl);
    await waitForTable();
    expect(screen.getByText('*****6789')).toBeInTheDocument();
    expect(screen.queryByText('123456789')).not.toBeInTheDocument();
  });

  it('flags incomplete-profile users with a badge', async () => {
    renderWithProvidersSync(<StaffManagementScreen />, staffFtl);
    await waitForTable();
    // John (staff-2) has is_profile_complete: false.
    expect(screen.getAllByText(/profile incomplete/i).length).toBeGreaterThan(0);
  });

  it('disables role and workspace assignment while the profile is incomplete', async () => {
    renderWithProvidersSync(<StaffManagementScreen />, staffFtl);
    await waitForTable();
    fireEvent.click(screen.getByRole('button', { name: /edit.*john doe/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Date of Birth *')).toHaveValue('1990-05-14');
    }, FAST_WAIT);
    // Role selector and assignment section are disabled for incomplete
    // profiles (a disabled fieldset drops its children from the a11y tree,
    // so assert on the fieldset itself).
    expect(within(dialog).getByRole('combobox', { name: /^role/i })).toBeDisabled();
    expect(within(dialog).getByRole('group', { name: /assignment access/i })).toBeDisabled();
  });

  it('blocks create submission with per-field errors when a required profile field is missing', async () => {
    renderWithProvidersSync(<StaffManagementScreen />, staffFtl);
    await waitForTable();
    fireEvent.click(screen.getByRole('button', { name: /add staff/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: /username/i }), { target: { value: 'newuser' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /display name/i }), { target: { value: 'New User' } });
    fireEvent.change(within(dialog).getByPlaceholderText(/enter pin/i), { target: { value: '1234' } });
    fireEvent.change(within(dialog).getByRole('combobox', { name: /^role/i }), { target: { value: 'role-staff' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /create/i }));

    // The submit must be blocked and per-field errors shown (localized).
    await waitFor(() => {
      expect(within(dialog).getAllByText(/date of birth is required/i).length).toBeGreaterThan(0);
    }, FAST_WAIT);
    expect(within(dialog).getAllByText(/email address is required/i).length).toBeGreaterThan(0);
    expect(invokeMock).not.toHaveBeenCalledWith('create_staff_scoped', expect.anything());
    // The dialog stays open.
    expect(within(dialog).getByRole('button', { name: /create/i })).toBeInTheDocument();
  });

  it('handles save failure gracefully in add modal', async () => {
    // Mock create_staff_scoped to fail
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'create_staff_scoped') return Promise.reject(new Error('DB error'));
      if (cmd === 'list_staff_scoped') return Promise.resolve(SAMPLE_STAFF);
      if (cmd === 'list_roles_scoped') return Promise.resolve(SAMPLE_ROLES);
      if (cmd === 'list_all_workspaces_scoped') return Promise.resolve([]);
      return Promise.resolve([]);
    });

    renderWithProvidersSync(<StaffManagementScreen />, staffFtl);
    await waitForTable();

    // Open add modal and fill form
    fireEvent.click(screen.getByRole('button', { name: /add staff/i }));
    const dialog = screen.getByRole('dialog');

    fireEvent.change(within(dialog).getByRole('textbox', { name: /username/i }), { target: { value: 'newuser' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /display name/i }), { target: { value: 'New User' } });
    fireEvent.change(within(dialog).getByPlaceholderText(/enter pin/i), { target: { value: '1234' } });
    fireEvent.change(within(dialog).getByRole('combobox', { name: /role/i }), { target: { value: 'role-staff' } });

    fireEvent.click(within(dialog).getByRole('button', { name: /create/i }));

    // Modal should stay open after failure
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    }, FAST_WAIT);
  });

  it('shows the upgrade CTA when staff creation hits the tier staff limit (C1.1)', async () => {
    // The backend rejects past the tier cap with subKind subscriptionLimitExceeded.
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'create_staff_scoped') {
        return Promise.reject(
          new Error(
            "Error invoking remote method 'create_staff_scoped': Error: " +
              JSON.stringify({
                kind: 'core',
                subKind: 'subscriptionLimitExceeded',
                message: 'Your Free tier allows maximum 1 staff users. You currently have 1. Upgrade to add more.',
              }),
          ),
        );
      }
      if (cmd === 'list_staff_scoped') return Promise.resolve(SAMPLE_STAFF);
      if (cmd === 'list_roles_scoped') return Promise.resolve(SAMPLE_ROLES);
      if (cmd === 'list_all_workspaces_scoped') return Promise.resolve([]);
      return Promise.resolve([]);
    });

    renderWithProvidersSync(<StaffManagementScreen />, staffFtl);
    await waitForTable();

    fireEvent.click(screen.getByRole('button', { name: /add staff/i }));
    const dialog = screen.getByRole('dialog');

    fireEvent.change(within(dialog).getByRole('textbox', { name: /username/i }), { target: { value: 'newuser' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /display name/i }), { target: { value: 'New User' } });
    fireEvent.change(within(dialog).getByPlaceholderText(/enter pin/i), { target: { value: '1234' } });
    fireEvent.change(within(dialog).getByRole('combobox', { name: /role/i }), { target: { value: 'role-staff' } });
    await fillRequiredProfile(dialog);

    fireEvent.click(within(dialog).getByRole('button', { name: /create/i }));

    // The quota banner replaces the generic error: message + upgrade CTA.
    await waitFor(() => {
      expect(screen.getByText(/your plan allows a limited number of staff/i)).toBeInTheDocument();
    }, FAST_WAIT);
    expect(within(dialog).getByRole('button', { name: /upgrade plan/i })).toBeInTheDocument();
  });

  it('renders the workspace column from the DTO assignment (spec 0048)', async () => {
    renderWithProvidersSync(<StaffManagementScreen />, staffFtl);
    await waitForTable();

    // Jane is global all/all → "All"; John is scoped to restaurant → the
    // workspace name from the loaded map.
    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('Restaurant')).toBeInTheDocument();
  });

  // ── Five-role taxonomy (ADR #35 D4 / spec 0048) ───────────────────

  it('presents exactly the five-role taxonomy in the role dropdown', async () => {
    renderWithProvidersSync(<StaffManagementScreen />, staffFtl);
    await waitForTable();
    fireEvent.click(screen.getByRole('button', { name: /add staff/i }));
    const dialog = screen.getByRole('dialog');
    const combobox = within(dialog).getByRole('combobox', { name: /^role/i });
    const options = within(combobox).getAllByRole('option').map((o) => o.textContent);
    // First option is the placeholder; then Owner → Admin → Manager →
    // Staff → Auditor — the custom role is absent.
    expect(options[0]).toMatch(/select a role/i);
    expect(options.slice(1)).toEqual([
      expect.stringMatching(/owner/i),
      expect.stringMatching(/admin/i),
      expect.stringMatching(/manager/i),
      expect.stringMatching(/staff/i),
      expect.stringMatching(/auditor/i),
    ]);
    expect(options.join(' | ')).not.toMatch(/custom/i);
  });

  it('shows the selected role\'s granted permission keys as chips', async () => {
    renderWithProvidersSync(<StaffManagementScreen />, staffFtl);
    await waitForTable();
    fireEvent.click(screen.getByRole('button', { name: /add staff/i }));
    const dialog = screen.getByRole('dialog');
    const combobox = within(dialog).getByRole('combobox', { name: /^role/i });

    // No role selected yet — no chip row.
    expect(screen.queryByText('Role permissions')).not.toBeInTheDocument();

    fireEvent.change(combobox, { target: { value: 'role-manager' } });
    // The chip row renders the role's granted keys (0046) verbatim.
    expect(screen.getByText('Role permissions')).toBeInTheDocument();
    expect(screen.getByText('analytics:view')).toBeInTheDocument();
    expect(screen.getByText('staff:read')).toBeInTheDocument();

    // Switching roles swaps the chips.
    fireEvent.change(combobox, { target: { value: 'role-staff' } });
    expect(screen.queryByText('analytics:view')).not.toBeInTheDocument();
    expect(screen.getByText('sales:process')).toBeInTheDocument();
  });

  // ── Assignment editor (ADR #35 D5 / spec 0048) ───────────────────

  it('pre-fills the assignment editor from the member DTO', async () => {
    renderWithProvidersSync(<StaffManagementScreen />, staffFtl);
    await waitForTable();

    // John is scoped → the scoped radio is selected and his workspace list
    // shows the checked restaurant.
    fireEvent.click(screen.getByRole('button', { name: /edit.*john doe/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Date of Birth *')).toHaveValue('1990-05-14');
    }, FAST_WAIT);
    expect(within(dialog).getByLabelText('Restrict by branch or workspace')).toBeChecked();
    expect(within(dialog).getByLabelText('All branches')).toBeChecked();
    expect(within(dialog).getByLabelText('All workspaces')).not.toBeChecked();
    expect(within(dialog).getByLabelText(/Restaurant/)).toBeChecked();
  });

  it('saves a scoped assignment with branch and workspace lists', async () => {
    renderWithProvidersSync(<StaffManagementScreen />, staffFtl);
    await waitForTable();

    // Jane is global — switch her to scoped with a branch + workspace list.
    fireEvent.click(screen.getByRole('button', { name: /edit.*jane smith/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Date of Birth *')).toHaveValue('1990-05-14');
    }, FAST_WAIT);
    fireEvent.click(within(dialog).getByLabelText('Restrict by branch or workspace'));
    fireEvent.click(within(dialog).getByLabelText('All branches'));
    fireEvent.click(within(dialog).getByLabelText(/Bandung Branch/));
    fireEvent.click(within(dialog).getByLabelText('All workspaces'));
    fireEvent.click(within(dialog).getByLabelText(/Retail Store/));

    fireEvent.click(within(dialog).getByRole('button', { name: /update/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('update_staff_scoped', expect.objectContaining({
        sessionToken: 'session-1',
        args: expect.objectContaining({
          id: 'staff-1',
          assignment: {
            scope_mode: 'scoped',
            branches_all: false,
            branch_ids: ['store-b'],
            workspaces_all: false,
            workspace_keys: ['store'],
          },
        }),
      }));
    }, FAST_WAIT);
  });

  it('blocks saving a scoped assignment with an empty list dimension', async () => {
    renderWithProvidersSync(<StaffManagementScreen />, staffFtl);
    await waitForTable();

    // John is scoped with workspace list [restaurant] — uncheck restaurant,
    // leaving the list empty, which per ADR #35 D5 is a deny, never an
    // implicit "all" — saving must block.
    fireEvent.click(screen.getByRole('button', { name: /edit.*john doe/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Date of Birth *')).toHaveValue('1990-05-14');
    }, FAST_WAIT);
    fireEvent.click(within(dialog).getByLabelText(/Restaurant/));

    expect(within(dialog).getByRole('button', { name: /update/i })).toBeDisabled();
  });

  // ── C2.2: Pro→Premium approaching-limit banner (16+ staff) ──

  it('shows the approaching-limit banner at 16+ staff on Pro (C2.2)', async () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({ tier: 'pro', maxStaffUsers: 20, staffCount: 16 }),
      loading: false,
      refresh: vi.fn(),
    });
    renderWithProvidersSync(<StaffManagementScreen />, staffFtl);
    await waitForTable();
    expect(screen.getByText(/nearing the Pro plan's 20-staff limit/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upgrade to premium/i })).toBeInTheDocument();
  });

  it('hides the approaching-limit banner on Premium below its 50-staff cap (C2.2)', async () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({ tier: 'premium', maxStaffUsers: 50, staffCount: 16 }),
      loading: false,
      refresh: vi.fn(),
    });
    renderWithProvidersSync(<StaffManagementScreen />, staffFtl);
    await waitForTable();
    expect(screen.queryByText(/nearing the Pro plan's 20-staff limit/i)).not.toBeInTheDocument();
  });

  it('hides the approaching-limit banner below 80% threshold on Pro (C2.2)', async () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({ tier: 'pro', maxStaffUsers: 20, staffCount: 15 }),
      loading: false,
      refresh: vi.fn(),
    });
    renderWithProvidersSync(<StaffManagementScreen />, staffFtl);
    await waitForTable();
    expect(screen.queryByText(/nearing the Pro plan's 20-staff limit/i)).not.toBeInTheDocument();
  });});
