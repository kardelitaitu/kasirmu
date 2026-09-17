// ── TopologyScreen tests ────────────────────────────────────────────
//
// Covers the topology -> workspace CRUD bridge: seeding the editor from
// loaded workspace_instances and the atomic diff on save (Critical #4).
// Also covers typeKey change → archive+recreate (#1) and wire-based
// store_id resolution (#5).

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, waitFor, act, screen, fireEvent, within } from '@testing-library/react';
import TopologyScreen from '@/features/locations/TopologyScreen';
import { makeSubscriptionCaps } from '@/__tests__/test-utils/mocks/subscriptionCaps';
import type { SubscriptionCapabilities } from '@/api/subscription';
import type { TopologyHeaderProps } from '@/features/locations/topologyHeader';

// ── Mocks ──────────────────────────────────────────────────────────

// Tier is switchable per test — the capacity guards are Pro-gated, and
// the screen's Apply gate must agree with the editor's live gate. The screen
// reads the tier from `caps` (the same local source the backend quota gate
// uses), so `mockLicenseTier` now flows through the default caps rather than a
// separate `checkLicenseStatus` probe. `maxLocations: null` keeps the store-limit
// gate inactive by default, matching the previous `caps === null` behaviour;
// tests that want the limit set caps explicitly.
let mockLicenseTier: string = 'plus';
// Kept as a spy rather than a plain stub so a test can assert the screen never
// reaches for it again: the tier badge used to come from this network probe,
// which is what made it disagree with the local quota gate.
const { mockCheckLicenseStatus } = vi.hoisted(() => ({
  mockCheckLicenseStatus: vi.fn(() => Promise.resolve({ tier: 'plus' })),
}));
vi.mock('@/api/license', () => ({
  checkLicenseStatus: mockCheckLicenseStatus,
}));

const mockListStores = vi.fn();
const mockCreateStore = vi.fn();
const mockUpdateStore = vi.fn();
const mockDeleteStore = vi.fn();
vi.mock('@/api/locations', () => ({
  listLocationsScoped: (...args: unknown[]) => mockListStores(...args),
  createLocationProfileScoped: (...args: unknown[]) => mockCreateStore(...args),
  updateLocationProfileScoped: (...args: unknown[]) => mockUpdateStore(...args),
  deleteLocationProfileScoped: (...args: unknown[]) => mockDeleteStore(...args),
}));

const mockListWorkspacesScoped = vi.fn();
const mockUpdateWorkspace = vi.fn();
vi.mock('@/api/workspaces', () => ({
  listWorkspacesScoped: (...args: unknown[]) => mockListWorkspacesScoped(...args),
  updateWorkspaceInstanceScoped: (...args: unknown[]) => mockUpdateWorkspace(...args),
}));

const mockApplyTopologyDiff = vi.fn();
const mockCanSaveTopology = vi.fn(() => Promise.resolve(mockIsManager));
const mockLoadTopology = vi.fn();
vi.mock('@/api/topology', () => ({
  applyTopologyDiff: (...args: unknown[]) => mockApplyTopologyDiff(...args),
  canSaveTopology: () => mockCanSaveTopology(),
  loadTopology: (...args: unknown[]) => mockLoadTopology(...args),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'test-session-token' }),
}));

// C2.2: per-file SubscriptionContext stub — plain object so the file's
// `vi.resetAllMocks()` in beforeEach cannot wipe it; the caps value is a
// hoisted fn the gate tests set per-test.
const { mockUseSubscriptionCaps } = vi.hoisted(() => ({
  mockUseSubscriptionCaps: vi.fn<(v: SubscriptionCapabilities | null) => SubscriptionCapabilities | null>(() => null),
}));
vi.mock('@/contexts/SubscriptionContext', () => ({
  useSubscription: () => ({
    caps:
      mockUseSubscriptionCaps(null) ?? makeSubscriptionCaps({ tier: mockLicenseTier, maxLocations: null }),
    loading: false,
    refresh: vi.fn(),
  }),
  useAdminGate: () => ({ locked: false, state: 'active' }),
}));

// The screen derives canSave from session.permissions — the `topology:write`
// key the topology write commands authorize with, honoured exactly, as `*`, or
// as `topology:*`. Not from a role-name boolean. `mockIsManager` keeps this
// file's legacy two-session behaviour; `mockSessionPermissions` (null = unset)
// lets a test pin an EXACT grant set, which is how the manager regression is
// pinned below: Manager holds `staff:update` but not `topology:write`.
let mockIsManager: boolean = true;
let mockSessionPermissions: string[] | null = null;
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => {
    if (mockSessionPermissions !== null) {
      return {
        isManager: true,
        session: {
          user_id: 'u-pin',
          display_name: 'Pinned Role',
          role_name: 'Pinned Role',
          role_id: 'r-pin',
          permissions: mockSessionPermissions,
        },
      };
    }
    return {
      isManager: mockIsManager,
      session: mockIsManager
        ? { user_id: 'u-1', display_name: 'Owner', role_name: 'Owner', role_id: 'r-owner', permissions: ['*'] }
        : { user_id: 'u-2', display_name: 'Cashier', role_name: 'Cashier', role_id: 'r-cashier', permissions: [] },
    };
  },
}));

const mockAddToast = vi.fn();
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('@fluent/react', () => {
  // Minimal stand-in for ErrorBoundary's module-level bundle: it constructs
  // `new ReactLocalization([bundle])` and formats its emergency fallback
  // strings via getString. Without this export the whole suite fails to
  // collect (the mocked module graph resolves ErrorBoundary's import).
  class ReactLocalization {
    constructor(_bundles: unknown[]) { /* bundle list accepted for parity */ }
    getString(id: string) {
      return id;
    }
  }
  // English templates for the keys this suite asserts on with variables;
  // every other key falls back to the key string itself.
  const EN: Record<string, string> = {
    'topology-compare-counts': '{ $onlyInCurrent } workspaces only here · { $onlyInOther } only in { $otherBranch } · { $differ } differ',
    'topology-compare-only-here': 'Only here: { $names }',
    'topology-compare-only-there': 'Only in { $otherBranch }: { $names }',
    'topology-compare-differing': 'Differing: { $names }',
    'topology-compare-none': 'No differences',
  };
  const l10n = {
    getString: (id: string, vars?: Record<string, string | number> | null) => {
      let value = EN[id] ?? id;
      for (const [key, val] of Object.entries(vars ?? {})) {
        value = value.replaceAll(`{ $${key} }`, String(val)).replaceAll(`{${key}}`, String(val));
      }
      return value;
    },
  };
  return {
    useLocalization: () => ({ l10n }),
    Localized: ({ children }: { id: string; children: React.ReactNode }) => <>{children}</>,
    ReactLocalization,
  };
});

// Capture the props the screen passes to the editor so tests can drive
// the save-diff logic without the real canvas.
let capturedEditorProps: {
  onSave?: (nodes: unknown[], wires: unknown[], baseRevision?: number, resolvedIssueKeys?: string[]) => Promise<{ revision: number; idMap?: Record<string, string> } | Record<string, string> | void>;
  workspaceInstances?: unknown[];
  branchToolbar?: unknown;
  branchLocations?: unknown[];
  /** The branch id the editor remounts under — the deep-link scoping
   *  tests read it because the editor is mocked and renders no canvas. */
  branchId?: string;
  onRenameBranch?: (id: string, name: string) => Promise<boolean>;
  onRenameWorkspace?: (id: string, name: string) => Promise<boolean>;
  onDirtyChange?: (dirty: boolean) => void;
  onLoadError?: (error: unknown) => void;
  onLoadSuccess?: () => void;
  compareOverlay?: unknown;
  compareFocus?: boolean;
  canSave?: boolean;
  /** The tier the header badge renders from — asserted by the badge tests. */
  currentTier?: string;
} = {};
let mockRenderRealHeader = false;
vi.mock('@/features/locations/NodeTopologyEditor', async () => {
  const mod = await vi.importActual<Record<string, unknown>>('@/features/locations/topologyHeader');
  const TopologyHeader = mod['TopologyHeader'] as (props: TopologyHeaderProps) => React.ReactElement;
  return {
    default: (props: {
      onSave?: (n: unknown[], w: unknown[]) => Promise<Record<string, string> | void>;
      workspaceInstances?: unknown[];
      branchToolbar?: unknown;
      branchLocations?: unknown[];
      branchId?: string;
      onRenameBranch?: (id: string, name: string) => Promise<boolean>;
      onRenameWorkspace?: (id: string, name: string) => Promise<boolean>;
      onDirtyChange?: (dirty: boolean) => void;
      onLoadError?: (error: unknown) => void;
      onLoadSuccess?: () => void;
      compareOverlay?: unknown;
      compareFocus?: boolean;
      canSave?: boolean;
      currentTier?: string;
    }) => {
      capturedEditorProps = props;
      // Permission tests opt into mounting the editor's REAL header, so the
      // assertion lands on the rendered Apply <button disabled> rather than on
      // a captured prop — the control the user can click is the deliverable.
      if (mockRenderRealHeader) {
        return (
          <TopologyHeader
            l10n={{ getString: (id: string) => id } as unknown as TopologyHeaderProps['l10n']}
            branchToolbar={(props.branchToolbar as TopologyHeaderProps['branchToolbar']) ?? null}
            canSave={!!props.canSave}
            onSaveAvailable={!!props.onSave}
            currentTier={props.currentTier ?? 'plus'}
            saving={false}
            onApply={() => undefined}
          />
        );
      }
      // The branch (graph) selector toolbar is rendered via the editor's
      // branchToolbar slot — mount it so the mocked SettingsSelect inside
      // still registers capturedBranchOnChange for branch-switch tests.
      return (props.branchToolbar as React.ReactElement | null) ?? null;
    },
  };
});

// Capture each selector's onChange so tests can simulate picking a branch
// (SettingsSelect is a custom combobox, not a native select). Handles are
// keyed by id — the compare panel's "compare against" select renders AFTER
// the branch toolbar, so a single shared handle would point at the wrong
// select once the panel is open.
let capturedBranchOnChange: ((value: string) => void) | null = null;
let capturedBranchOptions: { value: string; label: string }[] = [];
let capturedBranchSelectProps: { placeholder?: string; disabled?: boolean } = {};
let capturedCompareOtherOnChange: ((value: string) => void) | null = null;
vi.mock('@/features/settings/SettingsSelect', () => ({
  default: (props: {
    id?: string;
    onChange: (value: string) => void;
    options?: { value: string; label: string }[];
    placeholder?: string;
    disabled?: boolean;
  }) => {
    if (props.id === 'topology-compare-other-select') {
      capturedCompareOtherOnChange = props.onChange;
      return null;
    }
    capturedBranchOnChange = props.onChange;
    capturedBranchOptions = props.options ?? [];
    capturedBranchSelectProps = props;
    return null;
  },
}));

// ── Test data ──────────────────────────────────────────────────────

const loadedInstances = [
  {
    instance_id: 'ws-existing',
    type_key: 'store-pos',
    store_id: 'store-1',
    store_name: 'Main Street',
    purpose_key: 'checkout',
    name: 'Front Register',
    description: 'Old desc',
    icon: 'pos',
    layout_mode: 'sidebar',
    colour: null,
    is_default: false,
  },
];

const sampleStores = [
  { id: 'store-1', name: 'Main Street', is_primary: true, address: '', tax_id: '', currency: 'USD', timezone: 'UTC', created_at: '', updated_at: '' },
];

// ── Helpers ────────────────────────────────────────────────────────

/** Simulate a canvas save with the given workspace nodes and wires. */
async function triggerSave(
  workspaceNodes: unknown[],
  wires: unknown[] = [],
  nonWorkspaceNodes: unknown[] = [],
  resolvedIssueKeys: string[] = [],
) {
  const allNodes = [...nonWorkspaceNodes, ...workspaceNodes];
  await capturedEditorProps.onSave!(allNodes, wires, undefined, resolvedIssueKeys);
}

/** Minimal workspace node factory. */
function wsNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ws-1',
    type: 'workspace',
    name: 'POS #1',
    x: 0,
    y: 0,
    metadata: { typeKey: 'store-pos', purposeKey: 'general' },
    ...overrides,
  };
}

/** Minimal store node factory for wire-based resolution testing. */
function storeNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'store-1',
    type: 'store',
    name: 'Main Street',
    storeProfileId: 'store-1',
    x: 0,
    y: 0,
    ...overrides,
  };
}

function locationWire(
  fromNodeId: string,
  toNodeId: string,
  id = 'location-wire',
) {
  return {
    id,
    fromNodeId,
    fromPort: 'right',
    fromPortId: 'location-out',
    toNodeId,
    toPort: 'left',
    toPortId: 'location-in',
    relationshipType: 'location',
    direction: 'one-way',
  };
}

/** Get the first call's args array for applyTopologyDiff. */
function appliedArgs() {
  const call = mockApplyTopologyDiff.mock.calls[0];
  if (!call) throw new Error('applyTopologyDiff was not called');
  // [sessionToken, creations, updates, archives, diagramNodes, diagramWires]
  return {
    sessionToken: call[0] as string,
    creations: call[1] as { id: string; type_key: string; name: string; store_id: string }[],
    updates: call[2] as { id: string; name: string; purpose_key?: string }[],
    archives: call[3] as string[],
    diagramNodes: call[4] as { id: string }[],
    diagramWires: call[5] as {
      from_node_id: string;
      to_node_id: string;
      bends?: { x: number; y: number }[];
    }[],
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('TopologyScreen', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockLicenseTier = 'plus';
    mockIsManager = true;
    mockSessionPermissions = null;
    mockRenderRealHeader = false;
    mockCanSaveTopology.mockImplementation(() => Promise.resolve(mockIsManager));
    capturedEditorProps = {};
    capturedBranchOnChange = null;
    capturedBranchOptions = [];
    capturedBranchSelectProps = {};
    capturedCompareOtherOnChange = null;
    mockListStores.mockResolvedValue(sampleStores);
    mockListWorkspacesScoped.mockResolvedValue(loadedInstances);
    mockApplyTopologyDiff.mockResolvedValue({ revision: 1 });
    mockDeleteStore.mockResolvedValue(undefined);
    mockLoadTopology.mockResolvedValue(null);
  });

  const renderReady = async (expectedInstanceCount = 1) => {
    render(<TopologyScreen />);
    await waitFor(() => expect(capturedEditorProps.onSave).toBeDefined());
    await waitFor(() =>
      expect(capturedEditorProps.workspaceInstances).toHaveLength(expectedInstanceCount),
    );
  };

  // ── Seed ──────────────────────────────────────────────────────

  it('seeds the editor with loaded workspace instances', async () => {
    await renderReady();
    expect(capturedEditorProps.workspaceInstances).toEqual([
      {
        instanceId: 'ws-existing',
        typeKey: 'store-pos',
        storeId: 'store-1',
        storeName: 'Main Street',
        purposeKey: 'checkout',
        name: 'Front Register',
        subtitle: 'Old desc',
      },
    ]);
  });

  // ── Branch selector empty states ──────────────────────────────

  it('shows the empty-state placeholder and disables the selector when no branch exists', async () => {
    // The bare "Branch" label read like a fake selected value sitting on
    // an openable empty dropdown; the settled-empty state must say why
    // it's empty and point at the adjacent Add Branch button instead.
    mockListStores.mockResolvedValue([]);
    render(<TopologyScreen />);
    await waitFor(() =>
      expect(capturedBranchSelectProps.placeholder).toBe('topology-branch-selector-empty'),
    );
    expect(capturedBranchSelectProps.disabled).toBe(true);
  });

  it('reports branch unavailability (not an empty state) when the store list fails to load', async () => {
    // A failed fetch also renders an empty list — "No branches yet" would
    // be a lie while the load-error toast explains the real state.
    mockListStores.mockRejectedValue(new Error('boom'));
    render(<TopologyScreen />);
    await waitFor(() =>
      expect(capturedBranchSelectProps.placeholder).toBe('topology-branch-selector-unavailable'),
    );
    expect(capturedBranchSelectProps.disabled).toBe(true);
  });

  it('keeps the selector enabled with the branch label while branches exist', async () => {
    await renderReady();
    expect(capturedBranchSelectProps.placeholder).toBe('topology-branch-selector-label');
    expect(capturedBranchSelectProps.disabled).toBe(false);
  });

  it('excludes Inventory Management instances — the warehouse node is the single storage card', async () => {
    // Two storage-flavored cards on one canvas confused users: the
    // Warehouse node (the topology's stock-routing target) and the
    // Inventory Management workspace. Only the warehouse survives — an
    // inventory instance must never seed the canvas (its workspace row
    // still exists outside the topology; the sweep just never sees it).
    mockListWorkspacesScoped.mockResolvedValue([
      { ...loadedInstances[0]!, instance_id: 'ws-pos', type_key: 'store-pos', name: 'Store POS' },
      { ...loadedInstances[0]!, instance_id: 'ws-inv', type_key: 'inventory', name: 'Inventory Management' },
    ]);
    render(<TopologyScreen />);
    await waitFor(() => expect(capturedEditorProps.onSave).toBeDefined());
    await waitFor(() => expect(capturedEditorProps.workspaceInstances).toHaveLength(1));

    const seeded = capturedEditorProps.workspaceInstances as Array<{ instanceId: string; typeKey: string }>;
    expect(seeded.map((s) => s.instanceId)).toEqual(['ws-pos']);
    expect(seeded[0]!.typeKey).toBe('store-pos');
  });

  it('refetches workspace instances when the branch selector changes', async () => {
    // Branch-scoped graphs: switching the selector must reload that
    // branch's instances (and the editor remounts, keyed by branch) rather
    // than showing the previous branch's canvas.
    mockListWorkspacesScoped
      .mockResolvedValueOnce(loadedInstances)                                   // initial branch (store-1)
      .mockResolvedValueOnce([{ ...loadedInstances[0]!, instance_id: 'ws-b1', store_id: 'store-b', name: 'B POS' }]);
    await renderReady();

    // Simulate the manager picking branch B in the branch selector.
    act(() => { capturedBranchOnChange?.('store-b'); });

    await waitFor(() => expect(mockListWorkspacesScoped).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(capturedEditorProps.workspaceInstances).toEqual([
        expect.objectContaining({ instanceId: 'ws-b1', storeId: 'store-b', name: 'B POS' }),
      ]),
    );
  });

  it('blocks a dirty branch switch until the user confirms discarding, and cancel keeps the branch', async () => {
    // Only ONE load happens here (the switch is cancelled) — queue exactly
    // one Once value so no unconsumed mockResolvedValueOnce leaks into the
    // next test (vi.clearAllMocks does not drain the once-queue).
    mockListWorkspacesScoped.mockResolvedValueOnce(loadedInstances);           // initial branch (store-1)
    await renderReady();

    // The editor reports unsaved edits (e.g. an in-flight drag or rename).
    act(() => { capturedEditorProps.onDirtyChange?.(true); });

    // Switching branches now must NOT refetch — the discard-confirm dialog
    // intercepts before the selection changes.
    act(() => { capturedBranchOnChange?.('store-b'); });

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    act(() => { fireEvent.click(within(dialog).getByRole('button', { name: 'cancel' })); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockListWorkspacesScoped).toHaveBeenCalledTimes(1);
    expect(capturedEditorProps.workspaceInstances).toEqual([
      expect.objectContaining({ instanceId: 'ws-existing' }),
    ]);
  });

  it('switches branches after the user confirms discarding unsaved edits', async () => {
    mockListWorkspacesScoped
      .mockResolvedValueOnce(loadedInstances)                                   // initial branch (store-1)
      .mockResolvedValueOnce([{ ...loadedInstances[0]!, instance_id: 'ws-b1', store_id: 'store-b', name: 'B POS' }]);
    await renderReady();

    act(() => { capturedEditorProps.onDirtyChange?.(true); });
    act(() => { capturedBranchOnChange?.('store-b'); });

    const dialog = screen.getByRole('dialog');
    act(() => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'topology-discard-changes-confirm' }));
    });

    // The branch refetch now proceeds and the new branch's instances load.
    await waitFor(() => expect(mockListWorkspacesScoped).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(capturedEditorProps.workspaceInstances).toEqual([
        expect.objectContaining({ instanceId: 'ws-b1', storeId: 'store-b', name: 'B POS' }),
      ]),
    );
  });

  it('switches branches immediately when the canvas is clean (no dialog)', async () => {
    mockListWorkspacesScoped
      .mockResolvedValueOnce(loadedInstances)                                   // initial branch (store-1)
      .mockResolvedValueOnce([{ ...loadedInstances[0]!, instance_id: 'ws-b1', store_id: 'store-b', name: 'B POS' }]);
    await renderReady();

    act(() => { capturedBranchOnChange?.('store-b'); });

    await waitFor(() => expect(mockListWorkspacesScoped).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(capturedEditorProps.workspaceInstances).toEqual([
        expect.objectContaining({ instanceId: 'ws-b1', storeId: 'store-b', name: 'B POS' }),
      ]),
    );
  });

  it('renames a branch profile through the card callback and syncs the selector + card seed', async () => {
    // The editor card drives the rename via the onRenameBranch prop; the
    // screen persists it through update_store_profile preserving the other
    // fields, reports success so the card can close its inline form, and —
    // because both the header selector labels and the editor's branch seed
    // derive from the SAME stores state — the new name is live everywhere
    // immediately.
    mockListStores.mockResolvedValueOnce([
      { id: 'store-1', name: 'Main Street', is_primary: true, address: 'A St', tax_id: 'T-1', currency: 'USD', timezone: 'UTC', created_at: '', updated_at: '' },
    ]);
    mockUpdateStore.mockResolvedValueOnce({
      id: 'store-1', name: 'Main Street (Flagship)', is_primary: true, address: 'A St', tax_id: 'T-1', currency: 'USD', timezone: 'UTC', created_at: '', updated_at: '',
    });
    await renderReady();

    const ok = await capturedEditorProps.onRenameBranch!('store-1', 'Main Street (Flagship)');
    expect(ok).toBe(true);
    expect(mockUpdateStore).toHaveBeenCalledWith(
      'test-session-token',
      {
        id: 'store-1',
        name: 'Main Street (Flagship)',
        address: 'A St',
        tax_id: 'T-1',
        currency: 'USD',
        timezone: 'UTC',
      },
    );

    // Header selector label is live: the branch dropdown now lists the new
    // name (the stores-state update flushes on a re-render).
    await waitFor(() =>
      expect(
        capturedBranchOptions.some((o) => o.value === 'store-1' && o.label === 'Main Street (Flagship)'),
      ).toBe(true),
    );
    // The editor's branch seed (the card-title source) is live too.
    await waitFor(() =>
      expect(capturedEditorProps.branchLocations).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'store-1', name: 'Main Street (Flagship)' })]),
      ),
    );
  });

  it('renames a workspace instance through the card callback', async () => {
    // The workspace card rename persists via update_workspace_instance_scoped
    // (the live row) and updates the instances state so the seed the editor
    // receives carries the new name on the next refresh.
    mockListStores.mockResolvedValueOnce(sampleStores);
    mockListWorkspacesScoped.mockResolvedValueOnce(loadedInstances);
    mockUpdateWorkspace.mockResolvedValueOnce(undefined);
    await renderReady();

    const ok = await capturedEditorProps.onRenameWorkspace!('ws-existing', 'Renamed Register');
    expect(ok).toBe(true);
    // The rename must preserve the instance's other editable fields — the
    // wrapper nulls omitted description/colour, which would wipe the card
    // subtitle on every rename (reviewer-found bug).
    expect(mockUpdateWorkspace).toHaveBeenCalledWith(
      'test-session-token',
      'ws-existing',
      expect.objectContaining({ name: 'Renamed Register', description: 'Old desc' }),
    );

    // The editor's workspace seed carries the new name on the refresh.
    await waitFor(() =>
      expect(capturedEditorProps.workspaceInstances).toEqual(
        expect.arrayContaining([expect.objectContaining({ instanceId: 'ws-existing', name: 'Renamed Register' })]),
      ),
    );
  });

  it('deletes a branch: selector option, editor seed, and selection move to the remaining branch', async () => {
    // Two branches so deletion has somewhere to land.
    mockListStores.mockResolvedValue([
      { id: 'store-1', name: 'Main Street', is_primary: true, address: '', tax_id: '', currency: 'USD', timezone: 'UTC', created_at: '', updated_at: '' },
      { id: 'store-2', name: 'Second Street', is_primary: false, address: '', tax_id: '', currency: 'USD', timezone: 'UTC', created_at: '', updated_at: '' },
    ]);
    await renderReady(1);

    await waitFor(() =>
      expect(capturedBranchOptions.map((o) => o.value)).toEqual(['store-1', 'store-2']),
    );

    // Delete Branch → confirm.
    fireEvent.click(screen.getByRole('button', { name: 'topology-branch-delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'topology-branch-delete-confirm-btn' }));

    // The profile is deleted through the API.
    await waitFor(() => expect(mockDeleteStore).toHaveBeenCalledWith('test-session-token', 'store-1'));

    // The selector option for the deleted branch is gone…
    await waitFor(() =>
      expect(capturedBranchOptions.map((o) => o.value)).toEqual(['store-2']),
    );
    // …and the editor seed no longer carries the deleted branch (its card
    // leaves the canvas on the next rebuild/merge).
    await waitFor(() =>
      expect(capturedEditorProps.branchLocations).toEqual([{ id: 'store-2', name: 'Second Street' }]),
    );
  });

  // ── Branch-to-branch comparison ───────────────────────────────

  it('compare panel loads both diagrams and shows the summary', async () => {
    mockListStores.mockResolvedValue([
      { id: 'store-1', name: 'Main Street', is_primary: true, address: '', tax_id: '', currency: 'USD', timezone: 'UTC', created_at: '', updated_at: '' },
      { id: 'store-2', name: 'Second Street', is_primary: false, address: '', tax_id: '', currency: 'USD', timezone: 'UTC', created_at: '', updated_at: '' },
    ]);
    mockLoadTopology.mockImplementation((_sessionToken: string, branchId?: string) => {
      if (branchId === 'store-1') {
        return Promise.resolve({
          nodes: [
            { id: 'ws-pos', type: 'workspace', name: 'Front Register', x: 0, y: 0, metadata: { typeKey: 'store-pos' } },
            { id: 'ws-kds', type: 'workspace', name: 'Kitchen Display', x: 0, y: 0, metadata: { typeKey: 'kds' } },
          ],
          wires: [{ id: 'w1', from_node_id: 'ws-pos', to_node_id: 'ws-kds', direction: 'one-way', relationship_type: 'generic' }],
        });
      }
      if (branchId === 'store-2') {
        return Promise.resolve({
          nodes: [
            { id: 'ws-pos', type: 'workspace', name: 'Front Register', x: 0, y: 0, metadata: { typeKey: 'store-pos' } },
            { id: 'ws-wh', type: 'workspace', name: 'Stock Room', x: 0, y: 0, metadata: { typeKey: 'store-pos' } },
          ],
          wires: [{ id: 'w2', from_node_id: 'ws-pos', to_node_id: 'ws-wh', direction: 'one-way', relationship_type: 'stock-routing' }],
        });
      }
      return Promise.resolve(null);
    });
    await renderReady(1);

    // The compare affordance is a toolbar button (two branches exist).
    fireEvent.click(screen.getByRole('button', { name: 'topology-compare-open' }));

    // Both diagrams are fetched and the summary is rendered.
    await waitFor(() =>
      expect(screen.getByText('1 workspaces only here · 1 only in Second Street · 1 differ')).toBeInTheDocument(),
    );
    expect(screen.getByText('Only here: Kitchen Display')).toBeInTheDocument();
    expect(screen.getByText('Only in Second Street: Stock Room')).toBeInTheDocument();
    expect(screen.getByText('Differing: Front Register')).toBeInTheDocument();
  });

  it('compare panel closes and reports no differences for identical diagrams', async () => {
    mockListStores.mockResolvedValue([
      { id: 'store-1', name: 'Main Street', is_primary: true, address: '', tax_id: '', currency: 'USD', timezone: 'UTC', created_at: '', updated_at: '' },
      { id: 'store-2', name: 'Second Street', is_primary: false, address: '', tax_id: '', currency: 'USD', timezone: 'UTC', created_at: '', updated_at: '' },
    ]);
    const sameDiagram = {
      nodes: [{ id: 'ws-pos', type: 'workspace', name: 'Front Register', x: 0, y: 0, metadata: { typeKey: 'store-pos' } }],
      wires: [],
    };
    mockLoadTopology.mockResolvedValue(sameDiagram);
    await renderReady(1);

    fireEvent.click(screen.getByRole('button', { name: 'topology-compare-open' }));
    await waitFor(() => expect(screen.getByText('No differences')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'topology-compare-close' }));
    expect(screen.queryByText('No differences')).not.toBeInTheDocument();
  });

  it('compare panel renders the spatial overlay: ghosts and markers on the canvas', async () => {
    // Instances back the two workspace cards the diagrams share/reference,
    // so they actually render on the canvas (the editor never resurrects a
    // workspace node without a live instance).
    mockListWorkspacesScoped.mockResolvedValue([
      { instance_id: 'ws-pos', type_key: 'store-pos', store_id: 'store-1', store_name: 'Main Street', purpose_key: 'checkout', name: 'Front Register', description: '', icon: 'pos', layout_mode: 'sidebar', colour: null, is_default: false },
      { instance_id: 'ws-kds', type_key: 'kds', store_id: 'store-1', store_name: 'Main Street', purpose_key: 'kitchen', name: 'Kitchen Display', description: '', icon: 'kds', layout_mode: 'sidebar', colour: null, is_default: false },
    ]);
    mockListStores.mockResolvedValue([
      { id: 'store-1', name: 'Main Street', is_primary: true, address: '', tax_id: '', currency: 'USD', timezone: 'UTC', created_at: '', updated_at: '' },
      { id: 'store-2', name: 'Second Street', is_primary: false, address: '', tax_id: '', currency: 'USD', timezone: 'UTC', created_at: '', updated_at: '' },
    ]);
    mockLoadTopology.mockImplementation((_sessionToken: string, branchId?: string) => {
      if (branchId === 'store-1') {
        return Promise.resolve({
          nodes: [
            { id: 'ws-pos', type: 'workspace', name: 'Front Register', x: 100, y: 100, metadata: { typeKey: 'store-pos' } },
            { id: 'ws-kds', type: 'workspace', name: 'Kitchen Display', x: 400, y: 100, metadata: { typeKey: 'kds' } },
          ],
          wires: [{ id: 'w1', from_node_id: 'ws-pos', to_node_id: 'ws-kds', direction: 'one-way', relationship_type: 'generic' }],
        });
      }
      if (branchId === 'store-2') {
        return Promise.resolve({
          nodes: [
            { id: 'ws-pos', type: 'workspace', name: 'Front Register', x: 10, y: 20, metadata: { typeKey: 'store-pos' } },
            { id: 'ws-wh', type: 'workspace', name: 'Stock Room', x: 480, y: 360, metadata: { typeKey: 'store-pos' } },
          ],
          wires: [{ id: 'w2', from_node_id: 'ws-pos', to_node_id: 'ws-wh', direction: 'one-way', relationship_type: 'stock-routing' }],
        });
      }
      return Promise.resolve(null);
    });
    await renderReady(2);

    fireEvent.click(screen.getByRole('button', { name: 'topology-compare-open' }));
    await waitFor(() =>
      expect(screen.getByText('1 workspaces only here · 1 only in Second Street · 1 differ')).toBeInTheDocument(),
    );

    // The spatial overlay is derived from the SAME saved-vs-saved
    // comparison the summary shows: the other-only workspace becomes a
    // ghost at ITS diagram's position; the current-only and shared-differing
    // ids become card markers. (The editor is mocked here — the canvas
    // rendering of ghosts/markers is pinned in the editor suite.)
    expect(capturedEditorProps.compareOverlay).toEqual({
      ghosts: [{ id: 'ws-wh', name: 'Stock Room', x: 480, y: 360 }],
      onlyHere: ['ws-kds'],
      differing: ['ws-pos'],
      otherWires: [
        { id: 'w2', from_node_id: 'ws-pos', to_node_id: 'ws-wh', direction: 'one-way', relationship_type: 'stock-routing' },
      ],
      sharedByOtherId: [{ otherId: 'ws-pos', currentId: 'ws-pos' }],
    });

    // Closing the panel removes the overlay from the editor props.
    fireEvent.click(screen.getByRole('button', { name: 'topology-compare-close' }));
    await waitFor(() => expect(capturedEditorProps.compareOverlay).toBeNull());
  });

  it('the compare panel toggles focus mode and close resets it', async () => {
    mockListWorkspacesScoped.mockResolvedValue([
      { instance_id: 'ws-pos', type_key: 'store-pos', store_id: 'store-1', store_name: 'Main Street', purpose_key: 'checkout', name: 'Front Register', description: '', icon: 'pos', layout_mode: 'sidebar', colour: null, is_default: false },
      { instance_id: 'ws-kds', type_key: 'kds', store_id: 'store-1', store_name: 'Main Street', purpose_key: 'kitchen', name: 'Kitchen Display', description: '', icon: 'kds', layout_mode: 'sidebar', colour: null, is_default: false },
    ]);
    mockListStores.mockResolvedValue([
      { id: 'store-1', name: 'Main Street', is_primary: true, address: '', tax_id: '', currency: 'USD', timezone: 'UTC', created_at: '', updated_at: '' },
      { id: 'store-2', name: 'Second Street', is_primary: false, address: '', tax_id: '', currency: 'USD', timezone: 'UTC', created_at: '', updated_at: '' },
    ]);
    mockLoadTopology.mockImplementation(async (_sessionToken: string, branchId?: string) => {
      if (branchId === 'store-1') {
        return Promise.resolve({
          nodes: [
            { id: 'ws-pos', type: 'workspace', name: 'Front Register', x: 0, y: 0, metadata: { typeKey: 'store-pos' } },
            { id: 'ws-kds', type: 'workspace', name: 'Kitchen Display', x: 0, y: 0, metadata: { typeKey: 'kds' } },
          ],
          wires: [{ id: 'w1', from_node_id: 'ws-pos', to_node_id: 'ws-kds', direction: 'one-way', relationship_type: 'generic' }],
        });
      }
      if (branchId === 'store-2') {
        return Promise.resolve({
          nodes: [
            { id: 'ws-pos', type: 'workspace', name: 'Front Register', x: 0, y: 0, metadata: { typeKey: 'store-pos' } },
            { id: 'ws-wh', type: 'workspace', name: 'Stock Room', x: 0, y: 0, metadata: { typeKey: 'store-pos' } },
          ],
          wires: [{ id: 'w2', from_node_id: 'ws-pos', to_node_id: 'ws-wh', direction: 'one-way', relationship_type: 'stock-routing' }],
        });
      }
      return Promise.resolve(null);
    });
    await renderReady(2);

    fireEvent.click(screen.getByRole('button', { name: 'topology-compare-open' }));
    await waitFor(() => expect(screen.getByText('topology-compare-focus')).toBeInTheDocument());

    // Focus is OFF by default; the toggle flips it and the editor receives it.
    expect(capturedEditorProps.compareFocus).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'topology-compare-focus' }));
    await waitFor(() => expect(capturedEditorProps.compareFocus).toBe(true));

    // Closing the panel resets focus along with the overlay.
    fireEvent.click(screen.getByRole('button', { name: 'topology-compare-close' }));
    await waitFor(() => expect(capturedEditorProps.compareOverlay).toBeNull());
    expect(capturedEditorProps.compareFocus).toBe(false);
  });

  it('re-targets the comparison when the selected branch becomes the compare target (never self-compare)', async () => {
    // Three branches so the comparison can be re-pointed at a real other.
    mockListStores.mockResolvedValue([
      { id: 'store-1', name: 'Main Street', is_primary: true, address: '', tax_id: '', currency: 'USD', timezone: 'UTC', created_at: '', updated_at: '' },
      { id: 'store-2', name: 'Second Street', is_primary: false, address: '', tax_id: '', currency: 'USD', timezone: 'UTC', created_at: '', updated_at: '' },
      { id: 'store-3', name: 'Third Street', is_primary: false, address: '', tax_id: '', currency: 'USD', timezone: 'UTC', created_at: '', updated_at: '' },
    ]);
    mockLoadTopology.mockImplementation((_sessionToken: string, _branchId?: string) =>
      Promise.resolve({
        nodes: [{ id: 'ws-pos', type: 'workspace', name: 'Front Register', x: 0, y: 0, metadata: { typeKey: 'store-pos' } }],
        wires: [],
      }),
    );
    await renderReady(1);

    // Open compare: the target defaults to the first OTHER branch (store-2).
    // (The initial pair may repeat — openCompare fetches once and the
    // open-effect fetches again; slice(0,2) reads the first pair.)
    fireEvent.click(screen.getByRole('button', { name: 'topology-compare-open' }));
    await waitFor(() =>
      expect(mockLoadTopology.mock.calls.map((c) => c[1]).slice(0, 2)).toEqual(['store-1', 'store-2']),
    );

    // Switch the main selector to the branch currently being compared
    // against. The comparison must re-point at another branch — never
    // compare a branch with itself: the last pair reads (selected=store-2,
    // other=store-1).
    act(() => capturedBranchOnChange?.('store-2'));
    await waitFor(() =>
      expect(mockLoadTopology.mock.calls.map((c) => c[1]).slice(-2)).toEqual(['store-2', 'store-1']),
    );

    // A user-chosen valid target is preserved: picking store-3 in the
    // compare panel re-compares the current branch against it.
    act(() => capturedCompareOtherOnChange?.('store-3'));
    await waitFor(() =>
      expect(mockLoadTopology.mock.calls.map((c) => c[1]).slice(-2)).toEqual(['store-2', 'store-3']),
    );
  });

  it('closes the compare panel when deleting the selected branch leaves a single branch', async () => {
    mockListStores.mockResolvedValue([
      { id: 'store-1', name: 'Main Street', is_primary: true, address: '', tax_id: '', currency: 'USD', timezone: 'UTC', created_at: '', updated_at: '' },
      { id: 'store-2', name: 'Second Street', is_primary: false, address: '', tax_id: '', currency: 'USD', timezone: 'UTC', created_at: '', updated_at: '' },
    ]);
    mockLoadTopology.mockImplementation((_sessionToken: string, _branchId?: string) =>
      Promise.resolve({
        nodes: [{ id: 'ws-pos', type: 'workspace', name: 'Front Register', x: 0, y: 0, metadata: { typeKey: 'store-pos' } }],
        wires: [],
      }),
    );
    await renderReady(1);

    // Open the comparison against the only other branch.
    fireEvent.click(screen.getByRole('button', { name: 'topology-compare-open' }));
    await waitFor(() => expect(screen.getByText('topology-compare-title')).toBeInTheDocument());

    // Deleting the selected branch moves selection to the remaining one —
    // with a single branch there is nothing left to compare, so the panel
    // must close instead of comparing the branch with itself.
    fireEvent.click(screen.getByRole('button', { name: 'topology-branch-delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'topology-branch-delete-confirm-btn' }));

    await waitFor(() => expect(mockDeleteStore).toHaveBeenCalledWith('test-session-token', 'store-1'));
    await waitFor(() => expect(screen.queryByText('topology-compare-title')).not.toBeInTheDocument());
  });

  // ── #4: Atomic diff — single applyTopologyDiff call ────────────

  it('creates a new workspace via applyTopologyDiff (atomic diff)', async () => {
    await renderReady();

    const nodes = [
      storeNode(),
      wsNode({ id: 'ws-existing', name: 'Front Register', metadata: { typeKey: 'store-pos', persisted: true } }),
      wsNode({ id: 'ws-new', name: 'New Register', metadata: { typeKey: 'store-pos', persisted: false } }),
    ];
    await triggerSave(nodes, [locationWire('store-1', 'ws-existing', 'location-existing'), locationWire('store-1', 'ws-new', 'location-new')]);

    expect(mockApplyTopologyDiff).toHaveBeenCalledTimes(1);
    const a = appliedArgs();
    expect(a.sessionToken).toBe('test-session-token');
    expect(a.creations).toHaveLength(1);
    expect(a.creations[0]!.id).toBe('ws-new');
    expect(a.creations[0]!.type_key).toBe('store-pos');
    expect(a.creations[0]!.name).toBe('New Register');
    expect(a.updates).toHaveLength(0);
    expect(a.archives).toHaveLength(0);
    expect(a.diagramNodes.map((n) => n.id).sort()).toEqual(['store-1', 'ws-existing', 'ws-new'].sort());
  });

  it('updates a renamed workspace via applyTopologyDiff', async () => {
    await renderReady();

    await triggerSave([
      storeNode(),
      wsNode({ id: 'ws-existing', name: 'Renamed Register', metadata: { typeKey: 'store-pos', persisted: true } }),
    ], [locationWire('store-1', 'ws-existing')]);

    const a = appliedArgs();
    expect(a.creations).toHaveLength(0);
    expect(a.updates).toHaveLength(1);
    expect(a.updates[0]!.id).toBe('ws-existing');
    expect(a.updates[0]!.name).toBe('Renamed Register');
    expect(a.updates[0]!.purpose_key).toBe('checkout');
  });

  it('archives removed instances via applyTopologyDiff', async () => {
    await renderReady();

    await triggerSave([storeNode()]);

    const a = appliedArgs();
    expect(a.archives).toHaveLength(1);
    expect(a.archives[0]).toBe('ws-existing');
  });

  it('no-op when no changes (still saves diagram)', async () => {
    await renderReady();

    await triggerSave([
      storeNode(),
      wsNode({ id: 'ws-existing', name: 'Front Register', metadata: { typeKey: 'store-pos', persisted: true } }),
    ], [locationWire('store-1', 'ws-existing')]);

    const a = appliedArgs();
    expect(a.creations).toHaveLength(0);
    expect(a.updates).toHaveLength(0);
    expect(a.archives).toHaveLength(0);
  });

  // ── #1: TypeKey change → archive + recreate ──────────────────

  it('archives and recreates when typeKey changes (Critical #1)', async () => {
    await renderReady();

    await triggerSave([
      storeNode(),
      wsNode({ id: 'ws-existing', name: 'Front Register', metadata: { typeKey: 'restaurant-pos', persisted: true } }),
    ], [locationWire('store-1', 'ws-existing')]);

    const a = appliedArgs();
    expect(a.archives).toHaveLength(1);
    expect(a.archives[0]).toBe('ws-existing');
    expect(a.creations).toHaveLength(1);
    expect(a.creations[0]!.type_key).toBe('restaurant-pos');
    expect(a.creations[0]!.name).toBe('Front Register');
    expect(a.creations[0]!.id).not.toBe('ws-existing');
    expect(a.creations[0]!.id).toMatch(/^ws-[0-9a-f-]+$/);
    expect(a.updates).toHaveLength(0);
    // Diagram workspace node remapped to new UUID
    expect(a.diagramNodes.map((node) => node.id)).toContain(a.creations[0]!.id);
  });

  it('returns idMap so editor can remap canvas state (#1)', async () => {
    await renderReady();

    const result = await capturedEditorProps.onSave!(
      [storeNode(), wsNode({ id: 'ws-existing', name: 'Front Register', metadata: { typeKey: 'restaurant-pos', persisted: true } })],
      [locationWire('store-1', 'ws-existing')],
    );

    expect(result).toBeDefined();
    const applyResult = result as { revision: number; idMap?: Record<string, string> };
    expect(applyResult.revision).toBe(1);
    expect(Object.keys(applyResult.idMap ?? {})).toHaveLength(1);
    expect(applyResult.idMap?.['ws-existing']).toMatch(/^ws-[0-9a-f-]+$/);
  });

  it('remaps wire endpoints for type-changed nodes (#1)', async () => {
    await renderReady();

    const store = storeNode({ id: 'store-1', name: 'Main Street' });
    const ws = wsNode({ id: 'ws-existing', name: 'Front Register', metadata: { typeKey: 'restaurant-pos', persisted: true } });
    const wires = [locationWire('store-1', 'ws-existing', 'w-1')];

    await capturedEditorProps.onSave!([store, ws], wires);

    const a = appliedArgs();
    expect(a.diagramWires).toHaveLength(1);
    expect(a.diagramWires[0]!.from_node_id).toBe('store-1');
    expect(a.diagramWires[0]!.to_node_id).not.toBe('ws-existing');
    expect(a.diagramWires[0]!.to_node_id).toMatch(/^ws-[0-9a-f-]+$/);
  });

  it('preserves name change when typeKey also changes (#1)', async () => {
    await renderReady();

    // User renamed AND changed type in one edit session
    await triggerSave([
      storeNode(),
      wsNode({ id: 'ws-existing', name: 'Bar POS', metadata: { typeKey: 'restaurant-pos', persisted: true } }),
    ], [locationWire('store-1', 'ws-existing')]);

    const a = appliedArgs();
    // Archive old, create new
    expect(a.archives).toHaveLength(1);
    expect(a.archives[0]).toBe('ws-existing');
    expect(a.creations).toHaveLength(1);
    // The new instance uses the new typeKey AND the new name
    expect(a.creations[0]!.type_key).toBe('restaurant-pos');
    expect(a.creations[0]!.name).toBe('Bar POS');
  });

  it('does not archive+recreate when typeKey is unchanged (#1 false-positive guard)', async () => {
    await renderReady();

    // Same typeKey as the loaded instance — should be a regular update (name change)
    // or no-op if name also hasn't changed
    await triggerSave([
      storeNode(),
      wsNode({ id: 'ws-existing', name: 'Front Register', metadata: { typeKey: 'store-pos', persisted: true } }),
    ], [locationWire('store-1', 'ws-existing')]);

    const a = appliedArgs();
    // No archive, no create — just a no-op since name also didn't change
    expect(a.archives).toHaveLength(0);
    expect(a.creations).toHaveLength(0);
  });

  it('handles multiple type changes in one save (#1)', async () => {
    mockListWorkspacesScoped.mockResolvedValue([
      { ...loadedInstances[0]!, instance_id: 'ws-a', type_key: 'store-pos', name: 'A' },
      { ...loadedInstances[0]!, instance_id: 'ws-b', type_key: 'store-pos', name: 'B' },
    ]);
    await renderReady(2);

    await capturedEditorProps.onSave!(
      [
        storeNode(),
        wsNode({ id: 'ws-a', name: 'A', metadata: { typeKey: 'restaurant-pos', persisted: true } }),
        wsNode({ id: 'ws-b', name: 'B', metadata: { typeKey: 'restaurant-pos', persisted: true } }),
      ],
      [locationWire('store-1', 'ws-a', 'location-a'), locationWire('store-1', 'ws-b', 'location-b')],
    );

    const a = appliedArgs();
    expect(a.creations).toHaveLength(2);
    expect(a.archives).toHaveLength(2);
    expect(a.archives).toContain('ws-a');
    expect(a.archives).toContain('ws-b');
    const newIds = a.creations.map((c) => c.id);
    expect(new Set(newIds).size).toBe(2);
  });

  // ── Semantic store_id resolution ─────────────────────────────

  it('uses wire-connected store for store_id (Critical #5)', async () => {
    // The loaded instance belongs to store-1 (the default-selected branch),
    // so the branch-scoped seed keeps it; the canvas then wires the new
    // workspace to a DIFFERENT store's node, and that wire must drive the
    // resolved store_id — never the primary/default branch.
    mockListStores.mockResolvedValue([
      { ...sampleStores[0]!, id: 'store-1', name: 'Store A', is_primary: true },
      { ...sampleStores[0]!, id: 'store-b', name: 'Store B', is_primary: false },
    ]);
    await renderReady();

    const store = storeNode({ id: 'store-b', name: 'Store B', storeProfileId: 'store-b' });
    const ws = wsNode({ id: 'ws-new', name: 'POS', metadata: { typeKey: 'store-pos', persisted: false } });
    const wires = [locationWire('store-b', 'ws-new', 'w-1')];

    await capturedEditorProps.onSave!([store, ws], wires);

    const a = appliedArgs();
    expect(a.creations).toHaveLength(1);
    expect(a.creations[0]!.store_id).toBe('store-b');
  });

  it('accepts and persists a legacy Restaurant POS → KDS operation wire', async () => {
    await renderReady();

    const resto = wsNode({
      id: 'resto-pos',
      name: 'Restaurant POS',
      metadata: { typeKey: 'restaurant-pos', purposeKey: 'dining-room', persisted: false },
    });
    const kds = wsNode({
      id: 'kds',
      name: 'Kitchen Display',
      metadata: { typeKey: 'kds', purposeKey: 'kitchen-hot-line', persisted: false },
    });
    await triggerSave(
      [storeNode(), resto, kds],
      [
        locationWire('store-1', 'resto-pos', 'location-resto'),
        {
          id: 'operation-resto-kds',
          fromNodeId: 'resto-pos',
          toNodeId: 'kds',
          fromPort: 'right',
          toPort: 'left',
          direction: 'one-way',
        },
      ],
    );

    expect(mockApplyTopologyDiff).toHaveBeenCalledTimes(1);
    const a = appliedArgs();
    expect(a.creations.map((creation) => creation.type_key).sort()).toEqual(['kds', 'restaurant-pos']);
    expect(a.creations.every((creation) => creation.store_id === 'store-1')).toBe(true);
    expect(a.diagramWires).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'operation-resto-kds',
        from_port_id: 'operation-out',
        to_port_id: 'operation-in',
        relationship_type: 'generic',
      }),
    ]));
  });

  it('rejects a workspace without semantic Location In ownership', async () => {
    await renderReady();

    await expect(triggerSave([
      storeNode(),
      wsNode({ id: 'ws-new', name: 'Unowned POS', metadata: { typeKey: 'store-pos', persisted: false } }),
    ])).rejects.toThrow('topology-validation-missing-location');

    expect(mockApplyTopologyDiff).not.toHaveBeenCalled();
    expect(mockAddToast).toHaveBeenCalledWith({
      message: 'topology-validation-missing-location',
      type: 'error',
    });
  });

  // ══ Capacity gate parity (editor gate vs parent Apply gate) ════

  it('applies an at-capacity warehouse diagram on standard tier', async () => {
    // The capacity guards are Pro-gated (rounds 72/75/76) — on standard
    // the same diagram that Pro blocks must save cleanly. This pins the
    // parent Apply gate agreeing with the editor's live gate so they
    // cannot drift (a user on standard is never stuck behind a Pro check).
    await renderReady();

    await triggerSave([
      storeNode(),
      wsNode({ id: 'ws-pos', name: 'Retail POS', metadata: { typeKey: 'store-pos' } }),
      {
        id: 'wh-1',
        type: 'warehouse',
        name: 'Main Stock Room',
        x: 0,
        y: 0,
        metadata: { stock: 1000, capacity: 1000 },
      },
    ], [
      locationWire('store-1', 'ws-pos', 'w-loc'),
      locationWire('store-1', 'wh-1', 'w-wh-scope'),
      {
        id: 'w-stock',
        fromNodeId: 'ws-pos',
        fromPortId: 'stock-out',
        toNodeId: 'wh-1',
        toPortId: 'stock-in',
        relationshipType: 'stock-routing',
        direction: 'one-way',
      },
    ]);

    expect(mockApplyTopologyDiff).toHaveBeenCalledTimes(1);
    // The save went through — the only toast is the success one, never the
    // capacity error that Pro would have raised.
    expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    expect(mockAddToast).not.toHaveBeenCalledWith({
      message: 'Something went wrong. Please try again.',
      type: 'error',
    });
  });

  it('blocks the same at-capacity diagram on Pro tier', async () => {
    // Pro enforces the capacity guard at the parent gate too — the editor's
    // live marker and the Apply block must never disagree.
    mockLicenseTier = 'pro';
    await renderReady();

    await expect(triggerSave([
      storeNode(),
      wsNode({ id: 'ws-pos', name: 'Retail POS', metadata: { typeKey: 'store-pos' } }),
      {
        id: 'wh-1',
        type: 'warehouse',
        name: 'Main Stock Room',
        x: 0,
        y: 0,
        metadata: { stock: 1000, capacity: 1000 },
      },
    ], [
      locationWire('store-1', 'ws-pos', 'w-loc'),
      locationWire('store-1', 'wh-1', 'w-wh-scope'),
      {
        id: 'w-stock',
        fromNodeId: 'ws-pos',
        fromPortId: 'stock-out',
        toNodeId: 'wh-1',
        toPortId: 'stock-in',
        relationshipType: 'stock-routing',
        direction: 'one-way',
      },
    ])).rejects.toThrow('topology-validation-warehouse-at-capacity');

    expect(mockApplyTopologyDiff).not.toHaveBeenCalled();
    // The Apply gate now toasts the specific validation message (the
    // refactored topologyApply.ts shows the localized messageId, not the
    // generic plainErrorMessage fallback).
    expect(mockAddToast).toHaveBeenCalledWith({
      message: 'topology-validation-warehouse-at-capacity',
      type: 'error',
    });
  });

  // ══ Intentionally-empty warehouse (dismissed prompt) ══════════

  // The editor sends dismissed issue keys with the branch topology document;
  // the screen's Apply gate must honor that same payload.
  const unwiredWarehouseSave = (resolvedIssueKeys: string[] = []) =>
    triggerSave(
      [
        storeNode(),
        wsNode({ id: 'ws-pos', name: 'Retail POS', metadata: { typeKey: 'store-pos' } }),
        {
          id: 'wh-1',
          type: 'warehouse',
          name: 'Main Stock Room',
          x: 0,
          y: 0,
          metadata: { stock: 500, capacity: 1000 },
        },
      ],
      [
        locationWire('store-1', 'ws-pos', 'w-loc'),
        locationWire('store-1', 'wh-1', 'w-wh-scope'),
      ],
      undefined,
      resolvedIssueKeys,
    );

  it('blocks an unwired capacity warehouse on Pro tier', async () => {
    mockLicenseTier = 'pro';
    await renderReady();

    await expect(unwiredWarehouseSave()).rejects.toThrow('topology-validation-warehouse-missing-stock-routing');

    expect(mockApplyTopologyDiff).not.toHaveBeenCalled();
    expect(mockAddToast).toHaveBeenCalledWith({
      message: 'topology-validation-warehouse-missing-stock-routing',
      type: 'error',
    });
  });

  it('blocks a two-warehouse transfer chain on standard tier at the parent gate', async () => {
    // Round 87: the multi-warehouse cap must be enforced by TopologyScreen's
    // strict Apply boundary, not only by the editor's live gate — a loaded
    // or pasted Pro-authored 2-warehouse diagram on standard must never
    // persist. The transfer chain is semantically clean; the license cap
    // is the only blocker.
    await renderReady();

    await expect(triggerSave(
      [
        storeNode(),
        wsNode({ id: 'ws-pos', name: 'Retail POS', metadata: { typeKey: 'store-pos' } }),
        {
          id: 'wh-hub',
          type: 'warehouse',
          name: 'Hub Stock Room',
          x: 0,
          y: 0,
          metadata: { stock: 300, capacity: 1000 },
        },
        {
          id: 'wh-sat',
          type: 'warehouse',
          name: 'Satellite Stock Room',
          x: 0,
          y: 0,
          metadata: { stock: 200, capacity: 500 },
        },
      ],
      [
        locationWire('store-1', 'ws-pos', 'w-loc'),
        locationWire('store-1', 'wh-hub', 'w-hub-scope'),
        locationWire('store-1', 'wh-sat', 'w-sat-scope'),
        {
          id: 'w-stock',
          fromNodeId: 'ws-pos',
          fromPortId: 'stock-out',
          toNodeId: 'wh-hub',
          toPortId: 'stock-in',
          relationshipType: 'stock-routing',
          direction: 'one-way',
        },
        {
          id: 'w-transfer',
          fromNodeId: 'wh-hub',
          fromPortId: 'transfer-out',
          toNodeId: 'wh-sat',
          toPortId: 'transfer-in',
          relationshipType: 'inventory-transfer',
          direction: 'one-way',
        },
      ],
    )).rejects.toThrow('topology-toast-multi-warehouse');

    expect(mockApplyTopologyDiff).not.toHaveBeenCalled();
    // The Apply gate toasts the specific tier-limit messageId.
    expect(mockAddToast).toHaveBeenCalledWith({
      message: 'topology-toast-multi-warehouse',
      type: 'error',
    });
  });

  it('applies the same diagram once the prompt is dismissed (intentionally empty)', async () => {
    mockLicenseTier = 'pro';
    await renderReady();

    await unwiredWarehouseSave(['node:wh-1:topology-validation-warehouse-missing-stock-routing']);

    expect(mockApplyTopologyDiff).toHaveBeenCalledTimes(1);
    expect(mockAddToast).not.toHaveBeenCalledWith({
      message: 'Something went wrong. Please try again.',
      type: 'error',
    });
  });

  // ══ Error handling ═══════════════════════════════════════════

  it('carries wire bend points through the diff payload', async () => {
    await renderReady();

    const wires = [
      {
        ...locationWire('store-1', 'ws-existing', 'w-1'),
        bends: [{ x: 350, y: 334 }, { x: 400, y: 300 }],
      },
    ];
    await triggerSave([
      storeNode(),
      wsNode({ id: 'ws-existing', name: 'Front Register', metadata: { typeKey: 'store-pos', persisted: true } }),
    ], wires);

    const a = appliedArgs();
    expect(a.diagramWires[0]!.bends).toEqual([{ x: 350, y: 334 }, { x: 400, y: 300 }]);
  });

  it('surfaces applyTopologyDiff errors and rejects the save', async () => {
    mockApplyTopologyDiff.mockRejectedValue(new Error('DB locked'));
    await renderReady();

    await expect(capturedEditorProps.onSave!(
      [storeNode(), wsNode({ id: 'ws-new', name: 'POS', metadata: { typeKey: 'store-pos', persisted: false } })],
      [locationWire('store-1', 'ws-new')],
    )).rejects.toThrow('DB locked');

    // The screen re-throws IPC failures without a toast — the editor's
    // confirmApply owns error display for non-validation failures (it shows
    // topology-toast-save-error there). No screen-level toast is emitted.
    expect(mockAddToast).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: expect.stringContaining('Something went wrong'),
      }),
    );
  });

  it('surfaces applyTopologyDiff network error via toast', async () => {
    mockApplyTopologyDiff.mockRejectedValue(new Error('Network failure'));
    await renderReady();

    await expect(triggerSave([
      storeNode(),
      wsNode({ id: 'ws-new', name: 'POS', metadata: { typeKey: 'store-pos', persisted: false } }),
    ], [locationWire('store-1', 'ws-new')])).rejects.toThrow('Network failure');

    // Same ownership contract: the rejection surfaces the error; the editor
    // (not the screen) shows the save-error toast.
    expect(mockAddToast).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: expect.stringContaining('Something went wrong'),
      }),
    );
  });

  // ══ #5: Wire-based store_id resolution (duplicate names) ═══════

  it('uses stable semantic store_profile_id when display names collide', async () => {
    // Two branches share the display name 'Downtown'; the canvas wires to
    // the secondary one. The resolved store_id must come from the wire's
    // branch node storeProfileId — never from display-name matching.
    mockListStores.mockResolvedValue([
      { ...sampleStores[0]!, id: 'store-1', name: 'Downtown', is_primary: true },
      { ...sampleStores[0]!, id: 'store-downtown-2', name: 'Downtown', is_primary: false },
    ]);
    await renderReady();

    const store = storeNode({ id: 'store-b', name: 'Downtown', storeProfileId: 'store-downtown-2' });
    const ws = wsNode({ id: 'ws-new', name: 'POS', metadata: { typeKey: 'store-pos', persisted: false } });
    const wires = [locationWire('store-b', 'ws-new', 'w-1')];

    await capturedEditorProps.onSave!([store, ws], wires);

    const a = appliedArgs();
    expect(a.creations).toHaveLength(1);
    // Stable semantic store_profile_id wins even when display names collide.
    expect(a.creations[0]!.store_id).toBe('store-downtown-2');
  });

  // ══ #1: Type-change metadata.persisted flag ════════════════════

  it('sets metadata.persisted=true on type-changed diagram nodes', async () => {
    await renderReady();

    await triggerSave([
      storeNode(),
      wsNode({ id: 'ws-existing', name: 'Front Register', metadata: { typeKey: 'restaurant-pos', persisted: true } }),
    ], [locationWire('store-1', 'ws-existing')]);

    const a = appliedArgs();
    expect(a.diagramNodes).toHaveLength(2);
    const changedNode = a.diagramNodes.find((node) => node.id !== 'store-1');
    expect(changedNode?.id).not.toBe('ws-existing');
    // The recreated node's metadata should have persisted: true
    const meta = (changedNode as { metadata?: { persisted?: boolean } } | undefined)?.metadata;
    expect(meta).toBeDefined();
    expect(meta!.persisted).toBe(true);
  });

  // ── Edge cases ────────────────────────────────────────────────

  it('returns empty idMap on error (no session token)', async () => {
    // With sessionToken present in mock, this just verifies error path
    // works. Real no-session case would need different mock setup.
    await renderReady();
    await expect(capturedEditorProps.onSave!([], [])).rejects.toThrow('topology-validation-missing-branch');
  });

  it('refreshes workspace instances after successful save', async () => {
    mockListWorkspacesScoped.mockClear();
    mockListWorkspacesScoped.mockResolvedValue(loadedInstances);
    await renderReady();

    await triggerSave([
      storeNode(),
      wsNode({ id: 'ws-existing', name: 'Front Register', metadata: { typeKey: 'store-pos', persisted: true } }),
      wsNode({ id: 'ws-new', name: 'New POS', metadata: { typeKey: 'store-pos', persisted: false } }),
    ], [locationWire('store-1', 'ws-existing', 'location-existing'), locationWire('store-1', 'ws-new', 'location-new')]);

    await waitFor(() => {
      expect(mockListWorkspacesScoped).toHaveBeenCalledTimes(2);
    });
  });

  // ══ Permission gating (save mechanism design) ═════════════════

  it('disables Apply after an authoritative topology load error', async () => {
    await renderReady();

    act(() => { capturedEditorProps.onLoadError?.(new Error('corrupt topology')); });
    await waitFor(() => expect(capturedEditorProps.canSave).toBe(false));

    // A successful authoritative retry clears only the load-error lock;
    // capability authorization remains backend-owned.
    act(() => { capturedEditorProps.onLoadSuccess?.(); });
    await waitFor(() => expect(capturedEditorProps.canSave).toBe(true));
  });

  it('passes canSave=true for manager/owner roles', async () => {
    mockIsManager = true;
    await renderReady();
    expect(capturedEditorProps.canSave).toBe(true);
  });

  it('renders view-only (canSave=false) for non-manager roles', async () => {
    mockIsManager = false;
    await renderReady();
    expect(capturedEditorProps.canSave).toBe(false);
  });

  // ── The key the kernel actually checks (regression) ──────────────
  //
  // `topology:write` (platform/core/src/rbac.rs TOPOLOGY_WRITE) is what every
  // topology write command authorizes with — `crates/kasirmu-bridge/src/topology/
  // commands.rs:45, :79, :255, :479`. Among the built-in presets ONLY Admin
  // carries it (rbac_presets.rs:253), plus Owner implicitly via `permissions:
  // &["*"]` (rbac_presets.rs:46). Manager holds `staff:update`
  // (rbac_presets.rs:75) but NOT topology:write, and the kernel refuses a
  // manager topology write (apps/desktop-client/.../topology_command_tests.rs:
  // 1399-1415 asserts exactly that). The gate used to test `staff:update`, so a
  // manager reached `#/settings/topology` — the route gate is role-based,
  // ui/src/features/settings/register.tsx:10 requiredRole 'manager' — and got
  // an enabled Apply that could only ever fail. These cases render the REAL
  // header, so the assertion is on the rendered button, not a prop.
  const applyButton = async () => {
    await renderReady();
    const btn = screen.getByRole('button', { name: 'Apply Topology' });
    await waitFor(() => expect(btn).toBeInTheDocument());
    return btn;
  };

  it('disables Apply for a MANAGER grant set (staff:update, no topology:write)', async () => {
    mockRenderRealHeader = true;
    mockSessionPermissions = [
      'sales:process',
      'products:update',
      'staff:read',
      'staff:create',
      'staff:update',
      'settings:read',
      'audit:view',
    ];
    const btn = await applyButton();
    expect(btn).toBeDisabled();
    expect(capturedEditorProps.canSave).toBe(false);
  });

  it('enables Apply for an OWNER grant set (wildcard `*` only)', async () => {
    mockRenderRealHeader = true;
    mockSessionPermissions = ['*'];
    const btn = await applyButton();
    expect(btn).toBeEnabled();
    expect(capturedEditorProps.canSave).toBe(true);
  });

  it('enables Apply for an ADMIN grant set (explicit topology:write)', async () => {
    mockRenderRealHeader = true;
    mockSessionPermissions = ['staff:update', 'topology:write'];
    const btn = await applyButton();
    expect(btn).toBeEnabled();
    expect(capturedEditorProps.canSave).toBe(true);
  });

  it('enables Apply for a CUSTOM role holding the `topology:*` domain wildcard', async () => {
    // Guards the choice of helper over a raw `Array.includes`: a role granted
    // `topology:*` IS authorized by the backend matcher, and a raw includes of
    // the literal key would deny it (and deny Owner's `*`, above).
    mockRenderRealHeader = true;
    mockSessionPermissions = ['staff:update', 'topology:*'];
    const btn = await applyButton();
    expect(btn).toBeEnabled();
    expect(capturedEditorProps.canSave).toBe(true);
  });

  // ── The READ gate on the same helper (regression) ────────────────
  //
  // canViewTopologyHistory decides whether the deploy-history button is even
  // offered (TopologyScreen.tsx:845, ADR #46 §8) and used the SAME key the
  // audit-read commands authorize with — `audit:view` (rbac.rs AUDIT_VIEW) —
  // but matched it with two raw `Array.includes` calls: the literal `*` and
  // the literal `audit:view`. The backend matcher (platform/core/src/rbac.rs
  // :259-266, mirrored in TS at ui/src/platform/ui/page-registry/index.ts
  // :163-172) accepts THREE forms: exact, `*`, and `<domain>:*`. So a custom
  // role holding `audit:*` — which the kernel would serve — was denied the
  // control. Same helper as canSaveTopology above, same three forms, asserted
  // on the rendered button rather than a prop.
  const historyButton = async () => {
    await renderReady();
    const btn = screen.getByRole('button', { name: 'topology-history-open' });
    await waitFor(() => expect(btn).toBeInTheDocument());
    return btn;
  };

  it('offers deploy history for an OWNER grant set (wildcard `*`)', async () => {
    mockRenderRealHeader = true;
    mockSessionPermissions = ['*'];
    const btn = await historyButton();
    expect(btn).toBeEnabled();
  });

  it('offers deploy history for an explicit `audit:view` grant', async () => {
    mockRenderRealHeader = true;
    mockSessionPermissions = ['staff:update', 'audit:view'];
    const btn = await historyButton();
    expect(btn).toBeEnabled();
  });

  it('offers deploy history for a CUSTOM role holding the `audit:*` domain wildcard', async () => {
    // The regression: the kernel grants this read to `audit:*`, so the gate
    // must not be the thing that says no.
    mockRenderRealHeader = true;
    mockSessionPermissions = ['staff:update', 'audit:*'];
    const btn = await historyButton();
    expect(btn).toBeEnabled();
  });

  it('withholds deploy history from a grant set without any audit form', async () => {
    // Topology:write alone buys the WRITE control, not the audit READ. The
    // sibling Add Branch button is asserted first so this proves the READ
    // gate, not an unselected branch or an absent toolbar.
    mockRenderRealHeader = true;
    mockSessionPermissions = ['staff:update', 'topology:write'];
    await renderReady();
    expect(screen.getByRole('button', { name: 'topology-branch-add' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'topology-history-open' })).not.toBeInTheDocument();
  });

  it('blocks renames for non-manager roles with a permission toast', async () => {
    mockIsManager = false;
    await renderReady();

    const branchResult = await capturedEditorProps.onRenameBranch!('store-1', 'Renamed');
    expect(branchResult).toBe(false);
    expect(mockUpdateStore).not.toHaveBeenCalled();
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'topology-rename-permission-error' }),
    );

    mockAddToast.mockClear();
    const wsResult = await capturedEditorProps.onRenameWorkspace!('ws-existing', 'Renamed');
    expect(wsResult).toBe(false);
    expect(mockUpdateWorkspace).not.toHaveBeenCalled();
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'topology-rename-permission-error' }),
    );
  });

  // ── C2.2: second-store gate (Plus→Pro trigger) ───────────────

  it('shows the store-limit upgrade banner at the tier cap and blocks creation (C2.2)', async () => {
    mockUseSubscriptionCaps.mockReturnValue(makeSubscriptionCaps({ maxLocations: 1, locationCount: 1 }));
    render(<TopologyScreen />);
    await waitFor(() => expect(capturedEditorProps.onSave).toBeDefined());

    // Opening the branch-add form surfaces the inline upgrade banner.
    fireEvent.click(screen.getByRole('button', { name: 'topology-branch-add' }));
    expect(screen.getByText('location-limit-upgrade-pro')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'location-limit-upgrade-cta' })).toBeInTheDocument();
  });

  it('hides the store-limit banner when under the cap (C2.2)', async () => {
    mockUseSubscriptionCaps.mockReturnValue(makeSubscriptionCaps({ maxLocations: 2, locationCount: 1 }));
    render(<TopologyScreen />);
    await waitFor(() => expect(capturedEditorProps.onSave).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: 'topology-branch-add' }));
    expect(screen.queryByText('location-limit-upgrade-pro')).not.toBeInTheDocument();
  });

  // ── Tier badge must agree with the quota gate ──────────────────

  it('takes the tier badge from subscription caps, not the license probe', async () => {
    // The badge used to call `checkLicenseStatus`, a network probe to the license
    // server. With no activated license that rejects, the `catch` fell back to
    // 'free', and the header read FREE while the backend quota gate
    // (`commands/subscription.rs`) was treating the same debug build as Premium.
    // Both values were correct about their own source; the screen was displaying
    // the wrong one. It now reads `caps`, which is the gate's own source, so the
    // debug override is inherited rather than duplicated.
    mockUseSubscriptionCaps.mockReturnValue(
      makeSubscriptionCaps({ tier: 'Premium', maxLocations: null }),
    );
    render(<TopologyScreen />);
    await waitFor(() => expect(capturedEditorProps.onSave).toBeDefined());

    // Asserted on the prop the badge renders from, not its text: the header
    // upper-cases through Fluent, so the string is a localisation artefact while
    // this is the actual wiring.
    expect(capturedEditorProps.currentTier).toBe('premium');
  });

  it('never probes the license server to decide the tier badge', async () => {
    // Regression guard. Calling it again would reintroduce the disagreement
    // silently: the probe succeeds against a live license server and fails on an
    // offline dev machine, so the badge would be right sometimes.
    mockCheckLicenseStatus.mockClear();
    render(<TopologyScreen />);
    await waitFor(() => expect(capturedEditorProps.onSave).toBeDefined());

    expect(mockCheckLicenseStatus).not.toHaveBeenCalled();
  });

  // ── Locations → Topology deep-link hints (§"Locations and Topology
  //    navigation") ──────────────────────────────────────────────

  it('opens scoped to the deep-linked branch instead of the session default', async () => {
    // Locations → Configure topology passes ?branch=<id>; the editor must
    // mount on that location's graph, not the session's resolved store.
    mockListStores.mockResolvedValue([
      ...sampleStores,
      { id: 'store-target', name: 'Deep Linked', is_primary: false, address: '', tax_id: '', currency: 'USD', timezone: 'UTC', created_at: '', updated_at: '' },
    ]);
    render(<TopologyScreen initialBranchId="store-target" />);
    await waitFor(() => expect(capturedEditorProps.onSave).toBeDefined());

    // The selected branch is only observable through the editor's key
    // (branchId) and the seeds: both must reflect the deep-linked branch.
    expect(capturedEditorProps.branchId).toBe('store-target');
    expect(capturedEditorProps.branchLocations).toEqual([
      { id: 'store-target', name: 'Deep Linked' },
    ]);
    expect(mockListWorkspacesScoped).toHaveBeenCalledTimes(1);
  });

  it('falls back to the default branch when the deep-linked branch no longer exists', async () => {
    // The dashboard click and this mount are two different store-list
    // fetches: the location may have been deleted in between. A stale
    // hint must not strand an unowned canvas with a ghost selector value.
    render(<TopologyScreen initialBranchId="store-deleted" />);
    await waitFor(() => expect(capturedEditorProps.onSave).toBeDefined());

    expect(capturedEditorProps.branchId).toBe('store-1');
    expect(capturedEditorProps.branchLocations).toEqual([
      { id: 'store-1', name: 'Main Street' },
    ]);
  });

  it('does not honour a deep-link branch once the user picks another one', async () => {
    // The hint is consumed by the first defaulting pass; afterwards the
    // user's own selection must win (a stale hint re-asserting itself over
    // a deliberate user choice would fight the operator).
    mockListStores.mockResolvedValue([
      ...sampleStores,
      { id: 'store-target', name: 'Deep Linked', is_primary: false, address: '', tax_id: '', currency: 'USD', timezone: 'UTC', created_at: '', updated_at: '' },
    ]);
    mockListWorkspacesScoped
      .mockResolvedValueOnce(loadedInstances)
      .mockResolvedValueOnce([]);
    render(<TopologyScreen initialBranchId="store-target" />);
    await waitFor(() => expect(capturedEditorProps.onSave).toBeDefined());
    expect(capturedEditorProps.branchId).toBe('store-target');

    act(() => { capturedBranchOnChange?.('store-1'); });
    await waitFor(() => expect(mockListWorkspacesScoped).toHaveBeenCalledTimes(2));
    expect(capturedEditorProps.branchId).toBe('store-1');
  });

  it('arms the Add Branch form for the creation hand-off (?create=1)', async () => {
    // Location creation begins from Locations for discoverability, then
    // opens the editor with its Add Branch form armed — the editor owns
    // the actual profile mutation.
    render(<TopologyScreen openCreateOnMount />);
    await waitFor(() => expect(capturedEditorProps.onSave).toBeDefined());

    expect(screen.getByRole('button', { name: 'topology-branch-add-confirm' })).toBeInTheDocument();
  });

  it('leaves Add Branch closed without the creation hint (default entry)', async () => {
    // A manager who navigates to the topology section manually must not
    // find the creation form open — the hint is mount-scoped, not global.
    render(<TopologyScreen />);
    await waitFor(() => expect(capturedEditorProps.onSave).toBeDefined());

    expect(screen.getByRole('button', { name: 'topology-branch-add' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'topology-branch-add-confirm' })).not.toBeInTheDocument();
  });
});
