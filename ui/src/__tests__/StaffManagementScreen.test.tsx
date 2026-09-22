import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import {
  assertAllInvokesHandled,
  recordUnmatchedInvoke,
  resetUnmatchedInvokes,
} from '@/__tests__/test-utils/invokeCoverage';
import staffFtl from '@/locales/staff.ftl?raw';
import StaffManagementScreen from '@/features/staff/StaffManagementScreen';
import { STAFF_TAB_IDS } from '@/features/staff/components/staffTabsModel';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { ImpersonationProvider } from '@/contexts/ImpersonationContext';
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

/** Global fallback assignment (ADR #35 D5 + #47) carried by the staff DTO. */
const GLOBAL_ASSIGNMENT = {
  scope_mode: 'global',
  branches_all: true,
  branch_ids: [],
  workspaces_all: true,
  workspace_keys: [],
  scope_type: 'organization',
  scope_id: null,
};

const SAMPLE_STAFF = [
  { id: 'staff-1', username: 'jane', display_name: 'Jane Smith', role_id: 'role-owner', role_name: 'owner', is_active: true, national_id_masked: '*****6789', is_profile_complete: true, assignment: GLOBAL_ASSIGNMENT },
  { id: 'staff-2', username: 'john', display_name: 'John Doe', role_id: 'role-staff', role_name: 'staff', is_active: false, national_id_masked: '****', is_profile_complete: false, assignment: { scope_mode: 'scoped', branches_all: true, branch_ids: [], workspaces_all: false, workspace_keys: ['restaurant'], scope_type: 'organization', scope_id: null } },
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

const { invokeMock, setActiveWorkspaceMock } = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invokeMock: vi.fn() as any,
  /** The back control's destination setter, from the mocked WorkspaceContext. */
  setActiveWorkspaceMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    // Granted keys, for the two controls this surface gates: the row's
    // Impersonate action (`operator:impersonate`) and the Roles tab
    // (`staff:manage_roles`). Both keys are needed, and that is `passesGate`'s
    // rule rather than a convenience: once a session carries ANY granted key,
    // `requiredPermission` is authoritative and the role fallback no longer
    // applies — so listing one key and not the other hides the Roles tab.
    session: {
      user_id: 'test',
      display_name: 'Test',
      role_name: 'owner',
      role_id: 'role-1',
      permissions: ['operator:impersonate', 'staff:manage_roles'],
    },
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
  // `setActiveWorkspace` is what the back control calls through useWorkspaceNav;
  // without it a click on the only route off this page throws instead of
  // navigating.
  useWorkspace: () => ({ sessionToken: 'session-1', setActiveWorkspace: setActiveWorkspaceMock }),
}));

beforeEach(() => {
  invokeMock.mockClear();
  setActiveWorkspaceMock.mockClear();
  resetUnmatchedInvokes();
  // The tab is reflected in the route hash, so a case that switched tabs
  // would otherwise leave the next render mounting on the Roles tab.
  window.location.hash = '';
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'list_staff_scoped') return Promise.resolve(SAMPLE_STAFF);
    if (cmd === 'list_roles_scoped') return Promise.resolve(SAMPLE_ROLES);
    if (cmd === 'list_permission_keys_scoped') return Promise.resolve([]);
    if (cmd === 'create_staff_scoped') return Promise.resolve({ ...SAMPLE_STAFF[0], username: 'newuser' });
    if (cmd === 'update_staff_scoped') return Promise.resolve(SAMPLE_STAFF[0]);
    if (cmd === 'get_staff_profile_scoped') return Promise.resolve(SAMPLE_PROFILE);
    if (cmd === 'impersonate_user_scoped') {
      return Promise.resolve({ session_token: 'imp-token', user_id: 'staff-1', display_name: 'Jane Smith', expires_at: '' });
    }
    if (cmd === 'list_all_workspaces_scoped') return Promise.resolve([
      { key: 'restaurant', name: 'Restaurant', description: 'Dine-in service', icon: 'restaurant' },
      { key: 'store', name: 'Retail Store', description: 'Retail counter', icon: 'store' },
    ]);
    if (cmd === 'list_locations_scoped') return Promise.resolve(SAMPLE_BRANCHES);
    if (cmd === 'list_legal_entities_scoped') {
      return Promise.resolve([
        {
          id: 'default:default-legal-entity',
          tenantId: 'default',
          name: 'Default Legal Entity',
          legalName: 'Default Legal Entity',
          registrationNumber: '',
          taxId: '',
          status: 'active',
          createdAt: '',
          updatedAt: '',
        },
      ]);
    }
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
  it('renders the Staff and Roles tabs with the add button', async () => {
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
    await waitForTable();
    // The tab names the view; there is no page heading to duplicate it.
    expect(screen.getByRole('tab', { name: 'Staff' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Roles' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('button', { name: /add staff/i })).toBeInTheDocument();
  });

  it('swaps the header action to Add New Role on the Roles tab, and opens it as a popup', async () => {
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
    await waitForTable();

    fireEvent.click(screen.getByRole('tab', { name: 'Roles' }));

    // One action slot: the create affordance belongs to the tab on screen.
    expect(screen.getByRole('tab', { name: 'Roles' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: /add staff/i })).not.toBeInTheDocument();
    // Located by testid, and still named for a screen reader.
    const addRole = screen.getByTestId('staff-add-role-btn');
    expect(addRole).toHaveAccessibleName('Add New Role');
    // The panel mounts on first visit; the handle the button reaches through
    // only exists once it has.
    await waitFor(() => expect(document.querySelector('.role-authoring')).not.toBeNull());

    fireEvent.click(addRole);
    expect(screen.getByRole('dialog')).toHaveTextContent('Add New Role');
  });

  it('dismisses the role editor when the route leaves the Roles tab', async () => {
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
    await waitForTable();

    fireEvent.click(screen.getByRole('tab', { name: 'Roles' }));
    await waitFor(() => expect(document.querySelector('.role-authoring')).not.toBeNull());
    fireEvent.click(screen.getByTestId('staff-add-role-btn'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Reached the way it really happens: the popup is a portal, so its overlay
    // covers the tab strip and no CLICK can switch tabs underneath it. A
    // hashchange can — a deep link, or the browser's Back button — and without
    // the panel dismissing its own modals the dialog would outlive the view it
    // edits, still mounted in document.body and still in the a11y tree.
    act(() => {
      window.location.hash = '#/staff';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(screen.getByRole('tab', { name: 'Staff' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // The action follows the tab back, so the dismissed editor leaves no
    // create affordance behind.
    expect(screen.getByRole('button', { name: /add staff/i })).toBeInTheDocument();
  });

  it('renders staff table rows', async () => {
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
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
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
    await waitFor(() => {
      expect(screen.getByText(/no staff members yet/i)).toBeInTheDocument();
    }, FAST_WAIT);
    // The empty state's CTA is the shared Button `EmptyState` renders, tagged by
    // this screen — so it is locatable without matching the English label.
    const emptyCta = screen.getByTestId('staff-empty-cta');
    expect(emptyCta).toHaveTextContent(/add your first staff member/i);
    expect(emptyCta.className).toMatch(/\bbtn(--|$)/);
    fireEvent.click(emptyCta);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('shows loading skeleton initially', async () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const { container } = renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
    const skeleton = container.querySelector('[aria-hidden="true"].staff-mgmt-loading-skeleton');
    expect(skeleton).toBeInTheDocument();
    expect(screen.queryByText(/loading staff/i)).not.toBeInTheDocument();
  });

  it('opens add modal', async () => {
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
    await waitForTable();
    fireEvent.click(screen.getByRole('button', { name: /add staff/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/add staff member/i);
  });

  it('opens edit modal pre-filled', async () => {
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
    await waitForTable();
    const editBtn = screen.getByRole('button', { name: /edit.*jane smith/i });
    fireEvent.click(editBtn);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/edit staff member/i);
  });

  // ── STAFF-09 regression — editing must not reactivate inactive staff ─

  it('preserves is_active when editing an inactive member', async () => {
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
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
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
    await waitForTable();

    // The row action, located by testid; the accessible name still carries the
    // member, which is what a screen reader announces.
    const deactivateBtn = screen.getByTestId('staff-toggle-active-staff-1');
    expect(deactivateBtn).toHaveAccessibleName(/deactivate.*jane smith/i);
    fireEvent.click(deactivateBtn);

    // The confirmation dialog must appear before any request is sent.
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith('update_staff_scoped', expect.objectContaining({
      args: expect.objectContaining({ id: 'staff-1', is_active: false }),
    }));

    // Confirm the deactivation through the shared dialog's own control.
    fireEvent.click(within(dialog).getByTestId('confirm-dialog-confirm'));

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
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
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
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
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
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
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
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
    await waitForTable();
    expect(screen.getByText('*****6789')).toBeInTheDocument();
    expect(screen.queryByText('123456789')).not.toBeInTheDocument();
  });

  it('flags incomplete-profile users with a badge', async () => {
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
    await waitForTable();
    // John (staff-2) has is_profile_complete: false.
    expect(screen.getAllByText(/profile incomplete/i).length).toBeGreaterThan(0);
  });

  it('disables role and workspace assignment while the profile is incomplete', async () => {
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
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
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
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

    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
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

    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
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
    expect(within(dialog).getByTestId('staff-drawer-upgrade-btn')).toHaveTextContent(/upgrade plan/i);
  });

  it('renders the workspace column from the DTO assignment (spec 0048)', async () => {
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
    await waitForTable();

    // Jane is global all/all → "All"; John is scoped to restaurant → the
    // workspace name from the loaded map.
    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('Restaurant')).toBeInTheDocument();
  });

  // ── Five-role taxonomy (ADR #35 D4 / spec 0048) ───────────────────

  it('presents exactly the five-role taxonomy in the role dropdown', async () => {
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
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
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
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
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
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
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
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
            // The org-wide axis default rides along (ADR #47).
            scope_type: 'organization',
          },
        }),
      }));
    }, FAST_WAIT);
  });

  it('blocks saving a scoped assignment with an empty list dimension', async () => {
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
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

  it('binds a manager to one location via the ADR #47 resource scope', async () => {
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
    await waitForTable();

    // Jane is org-wide — scope her to the Bandung location. The wire must
    // carry scope_type=location + scope_id=store-b, and the save button
    // must stay disabled until a resource is chosen.
    fireEvent.click(screen.getByRole('button', { name: /edit.*jane smith/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Date of Birth *')).toHaveValue('1990-05-14');
    }, FAST_WAIT);

    const scopeSelect = within(dialog).getByLabelText(/resource scope/i);
    fireEvent.change(scopeSelect, { target: { value: 'location' } });

    // No location chosen yet — the pair is invalid, save is blocked.
    expect(within(dialog).getByRole('button', { name: /update/i })).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/choose a location/i), {
      target: { value: 'store-b' },
    });
    expect(within(dialog).getByRole('button', { name: /update/i })).toBeEnabled();

    fireEvent.click(within(dialog).getByRole('button', { name: /update/i }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('update_staff_scoped', expect.objectContaining({
        sessionToken: 'session-1',
        args: expect.objectContaining({
          id: 'staff-1',
          assignment: expect.objectContaining({
            scope_type: 'location',
            scope_id: 'store-b',
          }),
        }),
      }));
    }, FAST_WAIT);
  });

  it('shows the approaching-limit banner at 16+ staff on Pro (C2.2)', async () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({ tier: 'pro', maxStaffUsers: 20, staffCount: 16 }),
      state: 'active',
      loading: false,
      refresh: vi.fn(),
    });
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
    await waitForTable();
    expect(screen.getByText(/nearing the Pro plan's 20-staff limit/i)).toBeInTheDocument();
    expect(screen.getByTestId('staff-quota-upgrade-btn')).toHaveTextContent(/upgrade to premium/i);
  });

  it('hides the approaching-limit banner on Premium below its 50-staff cap (C2.2)', async () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({ tier: 'premium', maxStaffUsers: 50, staffCount: 16 }),
      state: 'active',
      loading: false,
      refresh: vi.fn(),
    });
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
    await waitForTable();
    expect(screen.queryByText(/nearing the Pro plan's 20-staff limit/i)).not.toBeInTheDocument();
  });

  it('hides the approaching-limit banner below 80% threshold on Pro (C2.2)', async () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({ tier: 'pro', maxStaffUsers: 20, staffCount: 15 }),
      state: 'active',
      loading: false,
      refresh: vi.fn(),
    });
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
    await waitForTable();
    expect(screen.queryByText(/nearing the Pro plan's 20-staff limit/i)).not.toBeInTheDocument();
  });

  // ── ADR #35 D6: withheld identity + payroll off the edit form ─────
  //
  // The backend withholds national_id/tax_id from a caller without
  // `staff:read_identity`, so an empty field means "not yours to see", not
  // "nothing on file". Treating the two alike left an editor no way to save
  // except by typing a value for a document they could not read — which then
  // replaced the stored one. These cases pin the fix.

  it('saves an edit whose identity was withheld, without demanding or sending it', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_staff_scoped') return Promise.resolve(SAMPLE_STAFF);
      if (cmd === 'list_roles_scoped') return Promise.resolve(SAMPLE_ROLES);
      if (cmd === 'update_staff_scoped') return Promise.resolve(SAMPLE_STAFF[0]);
      // What a caller WITHOUT staff:read_identity actually receives.
      if (cmd === 'get_staff_profile_scoped') {
        return Promise.resolve({
          ...SAMPLE_PROFILE,
          national_id: null,
          tax_id: null,
          identity_withheld: true,
        });
      }
      if (cmd === 'list_all_workspaces_scoped') return Promise.resolve([]);
      if (cmd === 'list_locations_scoped') return Promise.resolve([]);
      if (cmd === 'list_legal_entities_scoped') return Promise.resolve([]);
      if (cmd === 'get_brand_settings' || cmd === 'get_brand_settings_scoped') {
        return Promise.resolve({ primary_colour: '#4f46e5', logo_path: null, store_name: '' });
      }
      recordUnmatchedInvoke(cmd);
      return Promise.reject(new Error(`Unknown command: ${cmd}`));
    });

    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
    await waitForTable();
    fireEvent.click(screen.getByRole('button', { name: /edit.*jane smith/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Date of Birth *')).toHaveValue('1990-05-14');
    }, FAST_WAIT);

    // The field stops reading as required and explains itself instead.
    const nationalId = within(dialog).getByLabelText('National ID (hidden)');
    expect(nationalId).toBeDisabled();
    expect(
      within(dialog).getByText(/do not have permission to view this member/i),
    ).toBeInTheDocument();

    // Saving needs no identity value typed in.
    fireEvent.click(within(dialog).getByRole('button', { name: /update/i }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('update_staff_scoped', expect.objectContaining({
        sessionToken: 'session-1',
        args: expect.objectContaining({ id: 'staff-1' }),
      }));
    }, FAST_WAIT);
    expect(within(dialog).queryByText(/national id is required/i)).not.toBeInTheDocument();

    // ... and the payload OMITS the withheld fields, so the backend preserves
    // the stored document rather than having it blanked.
    const call = invokeMock.mock.calls.find((c: unknown[]) => c[0] === 'update_staff_scoped');
    const profile = (call?.[1] as { args: { profile: Record<string, unknown> } }).args.profile;
    expect(profile).not.toHaveProperty('national_id');
    expect(profile).not.toHaveProperty('tax_id');
  });

  it('does not send payroll when editing, even though the profile carried an amount', async () => {
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
    await waitForTable();
    fireEvent.click(screen.getByRole('button', { name: /edit.*jane smith/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Date of Birth *')).toHaveValue('1990-05-14');
    }, FAST_WAIT);

    // The pay field is not on the edit form at all — a payroll surface owns it.
    expect(within(dialog).queryByLabelText('Monthly Take-Home Pay *')).not.toBeInTheDocument();

    // Saved through the shared popup's tagged control.
    fireEvent.click(within(dialog).getByTestId('settings-popup-save'));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('update_staff_scoped', expect.objectContaining({
        sessionToken: 'session-1',
      }));
    }, FAST_WAIT);

    // SAMPLE_PROFILE carries 5_000_000: an edit must not echo a stale amount
    // back, or it would clobber a newer payroll change made in between.
    const call = invokeMock.mock.calls.find((c: unknown[]) => c[0] === 'update_staff_scoped');
    const profile = (call?.[1] as { args: { profile: Record<string, unknown> } }).args.profile;
    expect(profile).not.toHaveProperty('monthly_take_home_minor');
  });

  it('still collects payroll at creation', async () => {
    // The other half of the move: pay is collected once, when the member is
    // created, so the create form must still require and send it.
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
    await waitForTable();
    fireEvent.click(screen.getByRole('button', { name: /add staff/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: /username/i }), { target: { value: 'newuser' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /display name/i }), { target: { value: 'New User' } });
    fireEvent.change(within(dialog).getByPlaceholderText(/enter pin/i), { target: { value: '1234' } });
    fireEvent.change(within(dialog).getByRole('combobox', { name: /^role/i }), { target: { value: 'role-staff' } });
    await fillRequiredProfile(dialog);

    fireEvent.click(within(dialog).getByTestId('settings-popup-save'));
    await waitFor(() => {
      const call = invokeMock.mock.calls.find((c: unknown[]) => c[0] === 'create_staff_scoped');
      const profile = (call?.[1] as { args: { profile: Record<string, unknown> } }).args.profile;
      expect(profile).toHaveProperty('monthly_take_home_minor');
      expect(profile['monthly_take_home_minor'] as number).toBeGreaterThan(0);
    }, FAST_WAIT);
  });

  // ── Button conformance (structural) ──────────────────────────────
  //
  // The standing brief for this surface: every action renders through the shared
  // Button and carries a stable kebab-case data-testid, so no test or e2e
  // locator has to match an English label a translation can change. These cases
  // are the evidence — a bare <button> shows up here as a missing `btn` class,
  // and an untagged control as a failed lookup.

  /** Shared Button renders `btn …`, or `btn--unstyled` where a screen keeps its
   *  own look. An unclothed <button> matches neither. */
  const expectSharedButton = (el: HTMLElement) =>
    expect(el.className).toMatch(/\bbtn(--|$)/);

  it('renders every staff action through the shared Button, tagged with a testid', async () => {
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
    await waitForTable();

    expectSharedButton(screen.getByTestId('staff-back-btn'));
    expectSharedButton(screen.getByTestId('staff-add-btn'));
    expectSharedButton(screen.getByTestId('staff-edit-staff-1'));
    expectSharedButton(screen.getByTestId('staff-toggle-active-staff-1'));
    // Restore is the SAME control in its other state, so its testid must not
    // move with the label — that is the whole point of tagging it here.
    expectSharedButton(screen.getByTestId('staff-toggle-active-staff-2'));
    expectSharedButton(screen.getByTestId('staff-impersonate-staff-1'));

    // The tab strip is a shared control too, tagged per section.
    expect(screen.getByTestId('staff-tab-account')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('staff-tab-roles')).toBeInTheDocument();

    // The back control is the only route off this sidebar-less page, so a tagged
    // element that does not navigate would be worse than no testid at all.
    fireEvent.click(screen.getByTestId('staff-back-btn'));
    expect(setActiveWorkspaceMock).toHaveBeenCalledWith(null);
  });

  it('opens and dismisses the drawer through the popup controls it renders', async () => {
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
    await waitForTable();

    fireEvent.click(screen.getByTestId('staff-edit-staff-1'));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Date of Birth *')).toHaveValue('1990-05-14');
    }, FAST_WAIT);

    // Cancel closes the drawer without writing anything.
    fireEvent.click(within(dialog).getByTestId('settings-popup-cancel'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), FAST_WAIT);
    expect(invokeMock).not.toHaveBeenCalledWith('update_staff_scoped', expect.anything());

    // The close control is the same tagged surface, reached twice so the drawer
    // is mounted fresh rather than reused.
    fireEvent.click(screen.getByTestId('staff-edit-staff-1'));
    const reopened = await screen.findByRole('dialog');
    fireEvent.click(within(reopened).getByTestId('settings-popup-close'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), FAST_WAIT);
  });

  it('cancels a deactivation from the confirm dialog without writing', async () => {
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
    await waitForTable();

    fireEvent.click(screen.getByTestId('staff-toggle-active-staff-1'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByTestId('confirm-dialog-cancel'));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), FAST_WAIT);
    expect(invokeMock).not.toHaveBeenCalledWith('update_staff_scoped', expect.anything());
  });

  it('retries a failed load through the retry testid', async () => {
    let failedOnce = false;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_staff_scoped') {
        if (!failedOnce) {
          failedOnce = true;
          return Promise.reject(new Error('database is locked'));
        }
        return Promise.resolve(SAMPLE_STAFF);
      }
      if (cmd === 'list_roles_scoped') return Promise.resolve(SAMPLE_ROLES);
      if (cmd === 'list_all_workspaces_scoped') return Promise.resolve([]);
      if (cmd === 'get_brand_settings' || cmd === 'get_brand_settings_scoped') {
        return Promise.resolve({ primary_colour: '#4f46e5', logo_path: null, store_name: '' });
      }
      return Promise.resolve([]);
    });

    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);

    const retry = await screen.findByTestId('staff-retry-btn');
    expectSharedButton(retry);
    fireEvent.click(retry);

    await waitForTable();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
  });

  it('starts impersonation through the row testid', async () => {
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
    await waitForTable();

    fireEvent.click(screen.getByTestId('staff-impersonate-staff-1'));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('impersonate_user_scoped', {
        sessionToken: 'session-1',
        targetUserId: 'staff-1',
      });
    }, FAST_WAIT);
  });

  // ── Panel slide direction ─────────────────────────────────────────
  //
  // The slide itself is CSS (StaffManagementScreen.css) and
  // animationCompliance.test.ts holds it behind prefers-reduced-motion. What the
  // screen owns is the DIRECTION: the panel enters from the side the thumb
  // travelled towards. jsdom computes no animation, so the direction class is
  // the whole observable contract here — a wrong direction is invisible to every
  // other test in this file.

  const panelFor = (tab: "staff" | "roles") => document.getElementById(STAFF_TAB_IDS[tab].panel);

  it("does not slide a panel on first paint", async () => {
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
    await waitForTable();

    // Both panels sit on the bare class, so the page opens still: a panel that
    // arrived already carrying a direction would animate on load.
    expect(panelFor("staff")?.className).toBe("staff-mgmt-tabpanel");
    expect(panelFor("roles")?.className).toBe("staff-mgmt-tabpanel");
  });

  it("brings the incoming panel in from the right when the tab moves right", async () => {
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
    await waitForTable();

    fireEvent.click(screen.getByTestId("staff-tab-roles"));

    expect(panelFor("roles")?.className).toContain("staff-mgmt-tabpanel--from-right");
    expect(panelFor("roles")).not.toHaveAttribute("hidden");
    // The outgoing panel is hidden in the SAME commit, which is why the CSS
    // needs no exit animation: there is nothing left on screen to snap.
    expect(panelFor("staff")).toHaveAttribute("hidden");
  });

  it("brings the panel in from the left when the tab moves back", async () => {
    renderWithProvidersSync(<ImpersonationProvider><StaffManagementScreen /></ImpersonationProvider>, staffFtl);
    await waitForTable();

    fireEvent.click(screen.getByTestId("staff-tab-roles"));
    fireEvent.click(screen.getByTestId("staff-tab-account"));

    expect(panelFor("staff")?.className).toContain("staff-mgmt-tabpanel--from-left");
    expect(panelFor("roles")).toHaveAttribute("hidden");
  });
});
