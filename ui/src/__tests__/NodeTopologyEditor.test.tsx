import { useState, type ComponentProps } from 'react';
import { screen, fireEvent, waitFor, act, within, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import NodeTopologyEditor, { type WorkspaceInstanceSeed, type BranchLocationSeed } from '../features/locations/NodeTopologyEditor';
import {
  clampNodeToViewport,
  edgeAutoPanDelta,
  findFreeSpawnSpot,
  NODE_HEIGHT,
  NODE_PORT_ROW_H,
  NODE_PORT_MARKER,
  NODE_WIDTH,
  resolveDropOverlaps,
} from '../features/locations/nodeTopologyClamp';
import { clearDevLog, getDevLog } from '@/utils/devLog';
import { loadTopology, type TopologyData } from '@/api/topology';
import type * as nodeTopologyEditorState from '../features/locations/nodeTopologyEditorState';
import multiStoreFtl from '@/locales/multi-location.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

vi.mock('@/api/topology', () => ({
  // Self-seeding defaults so ANY describe — or a filtered run that skips
  // the Component describe's beforeEach — mounts the editor without
  // depending on an earlier describe having seeded the mocks first.
  // Sibling describes are otherwise order-dependent: a bare vi.fn()
  // returns undefined and crashes the load effect's `.then` on mount.
  loadTopology: vi.fn(() => Promise.resolve(null)),
}));

// Passthrough mock: keep real LocalizationProvider/ReactLocalization so
// withFluent (used by renderWithProvidersSync) still works, but replace
// <Localized> with a simple children-rendering passthrough and stub
// useLocalization().getString with a lookup that returns the English
// fallback for known topology keys (tests assert on English text).
//
// <Localized> passthrough handles all UI label text; this map covers the
// ~20 keys used via l10n.getString() for node names, subtitles, toasts,
// dialogs, workspace type labels, and aria attributes.
const TOPOLOGY_EN: Record<string, string> = {
  'topology-new-store': 'New Store',
  'topology-new-store-subtitle': 'Branch',
  'topology-new-workspace': 'New Workspace',
  'topology-new-workspace-subtitle': 'Register',
  'topology-new-warehouse': 'New Warehouse',
  'topology-new-warehouse-subtitle': 'Storage',
  'topology-new-hardware': 'New Hardware',
  'topology-new-hardware-subtitle': 'Peripheral',
  'topology-new-ready': 'Ready',
  'topology-workspace-types-title': 'Workspace Types',
  'topology-other-nodes-title': 'Other Nodes',
  'topology-tool-restaurant-pos': '+ Restaurant POS',
  'topology-tool-restaurant-pos-desc': 'Restaurant checkout workspace',
  'topology-tool-retail-pos': '+ Retail POS',
  'topology-tool-retail-pos-desc': 'Retail checkout workspace',
  'topology-tool-kds': '+ KDS',
  'topology-tool-kds-desc': 'Kitchen display workspace',
  'topology-tool-warehouse-workspace': '+ Warehouse',
  'topology-tool-warehouse-workspace-desc': 'Inventory storage workspace',
  'topology-toast-multi-warehouse': 'Multiple Warehouses require a Pro Tier license.',
  'topology-warehouse-excess-badge': '{count} Warehouses — 1 allowed',
  'topology-branch-excess-badge': '{count} Branch Locations — 1 allowed',
  'topology-toast-wire-duplicate': 'A wire already connects these ports.',
  'topology-wire-incompatible': 'These connectors cannot be connected.',
  'topology-relationship-picker-title': 'Choose connection type',
  'topology-relationship-picker-cancel': 'Cancel',
  'topology-relationship-stock-routing': 'Stock routing',
  'topology-relationship-inventory-transfer': 'Transfer',
  'topology-relationship-location': 'Location',
  'topology-relationship-ticket-routing': 'Ticket routing',
  'topology-relationship-hardware-connection': 'Device connection',
  'topology-relationship-operation': 'Operation',
  'topology-relationship-generic': 'Generic',
  'topology-wire-label-transfer': 'Transfer',
  'topology-toast-fallback-warehouse': 'Multi-warehouse stock deduction fallback wires require a Pro Tier license.',
  'topology-toast-load-error': 'Failed to load topology',
  'topology-toast-selection-dropped': 'The selected element is not part of this preset and was deselected.',
  'topology-confirm-delete-node-title': 'Delete Node',
  'topology-confirm-delete-wire-title': 'Delete Wire',
  'topology-confirm-delete-node-msg':
    'This node has connected wires. Deleting it will remove all its wires too. This action cannot be undone.',
  'topology-confirm-delete-wire-msg': 'Delete this wire connection? This action cannot be undone.',
  'topology-confirm-delete-many-title': 'Delete {count} Nodes',
  'topology-confirm-delete-many-msg': 'Delete these {count} nodes and all of their wires? This action cannot be undone.',
  'topology-confirm-delete-label': 'Delete',
  'topology-status-selection': '{count} selected',
  'topology-canvas-aria-label': 'Topology editor canvas. Use arrow keys to nudge selected nodes, Ctrl+Z to undo.',
  'topology-ws-type-store-pos': 'Retail POS',
  'topology-ws-type-restaurant-pos': 'Restaurant POS',
  'topology-ws-type-kds': 'Kitchen Display (KDS)',
  'topology-port-operation-in': 'Operation',
  'topology-ws-type-warehouse': 'Warehouse',
  'topology-node-type-store': 'Branch Location',
  'topology-node-type-workspace': 'Workspace',
  'topology-node-type-warehouse': 'Warehouse',
  'topology-node-type-hardware': 'Hardware Device',
  'topology-hardware-thermal-receipt': 'Thermal Receipt Printer',
  'topology-hardware-thermal-kitchen': 'Kitchen Printer',
  'topology-hardware-barcode-scanner': 'Barcode Scanner',
  'topology-hardware-cash-drawer': 'Cash Drawer',
  'topology-hardware-display-customer': 'Customer Display',
  'topology-port-location-out': 'Location',
  'topology-port-location-in': 'Location',
  'topology-port-location-out-aria': 'Location port',
  'topology-port-location-in-aria': 'Location port',
  'topology-port-aria': 'Topology port',
  'topology-wire-flip-hint-connecting':
    'Flip direction? Clicking keeps your connection in progress.',
  'topology-port-workspace-out': 'Operation',
  'topology-port-stock-in': 'Stock In',
  'topology-port-stock-out': 'Stock Out',
  'topology-port-transfer-in': 'Transfer In',
  'topology-port-transfer-out': 'Transfer Out',
  'topology-port-operation-out': 'Operation',
  'topology-node-status-ok': 'Configured correctly',
  'topology-port-ticket-in': 'Ticket In',
  'topology-port-ticket-out': 'Ticket Out',
  'topology-port-ticket-out-aria': 'Ticket port',
  'topology-wire-label-ticket': 'Ticket Print',
  'topology-port-device-out': 'Device Out',
  'topology-port-generic-in': 'Input',
  'topology-port-generic-out': 'Output',
  'topology-port-input-only': 'Input connectors receive connections; choose an output connector first.',
  'topology-validation-missing-location': 'Connect this workspace to a Branch Location using Location In.',
  'topology-validation-multiple-location': 'A workspace can have only one Location In wire.',
  'topology-validation-missing-warehouse-input': 'This Warehouse must connect to exactly one Location or Retail POS Operation input.',
  'topology-validation-multiple-warehouse-inputs': 'This Warehouse can have only one primary connection: Location or Retail POS Operation.',
  'topology-validation-multiple-ticket-inputs': 'A ticket device can receive tickets from only one source.',
  'topology-validation-invalid-warehouse-operation-source': 'Warehouse Operation In must receive an Operation feed from Retail POS.',
  'topology-validation-missing-branch': 'Add exactly one Branch Location node.',
  'topology-validation-multiple-branches': 'Keep exactly one Branch Location node in this graph.',
  'topology-validation-branch-identity': 'This Branch Location is missing its store profile identity.',
  'topology-validation-invalid-purpose': 'This workspace purpose is not supported by its technical type.',
  'topology-node-stock-wire-hint': "Connect a workspace's Stock Out or another Warehouse's output to this Warehouse's Stock In.",
  'topology-validation-unknown-wire-endpoint': 'This wire references a node that is not in the graph.',
  'topology-validation-invalid-semantic-connection': 'This wire uses an incompatible port and relationship type.',
  'topology-validation-ambiguous-legacy-wire': 'This older wire cannot be identified safely. Delete and reconnect it using the labeled ports.',
  // NOTE: topology-wire-label-* keys are deliberately ABSENT so the
  // existing label tests pin the raw-key fallback behavior.
  'topology-migration-title': 'Migrate legacy connections',
  'topology-migration-description': 'These older connections cannot be identified safely. Choose what each one means so the diagram can be applied. Connections with no compatible meaning must be deleted and recreated with the labeled ports.',
  'topology-migration-select-aria': 'Connection from {from} to {to}',
  'topology-migration-delete': 'Delete this wire',
  'topology-migration-later': 'Later',
  'topology-migration-resolve': 'Resolve',
  'topology-migration-announce': 'Legacy connections resolved',
  'topology-field-name': 'Name',
  'topology-field-name-aria': 'Edit name',
  'topology-field-enabled': 'Enabled',
  'topology-field-enabled-aria': 'Toggle enabled state',
  'topology-zoom-in': 'Zoom in',
  'topology-zoom-out': 'Zoom out',
  'topology-zoom-level-aria': 'Zoom level ({count})%',
  'topology-zoom-slider-aria': 'Zoom level',
  'topology-empty-state-title': 'Build your store topology',
  'topology-empty-state-body':
    'Drag tools from the palette onto the canvas, or press 1–4 to add a node. Connect nodes with the port sockets on each card.',
  'topology-unsaved': 'Unsaved changes',
  'topology-shortcuts-aria': 'Keyboard shortcuts',
  'topology-shortcuts-title': 'Shortcuts',
  'topology-shortcuts-help': 'Show keyboard shortcuts',
  'topology-shortcuts-pan': 'Pan the canvas',
  'topology-shortcuts-duplicate-drag': 'Duplicate by dragging',
  'topology-shortcuts-additive-marquee': 'Add to the selection',
  'topology-shortcuts-spawn': 'Spawn a node from the palette slot',
  'topology-shortcuts-nudge': 'Move selected nodes (Shift = snap to grid)',
  'topology-shortcuts-esc': 'Deselect or cancel the in-flight action',
  'topology-shortcuts-inspector': 'Focus the inspector name field',
  'topology-context-add-title': 'Add Node',
  'topology-context-select-all': 'Select All',
  'topology-context-selection-title': '{count} selected',
  'topology-context-clear-selection': 'Clear selection',
  'topology-context-zoom-selection': 'Zoom to Selection',
  'topology-context-rename': 'Rename',
  'topology-context-duplicate': 'Duplicate',
  'topology-wire-toggle-aria': 'Toggle wire direction',
  'topology-context-delete-wire': 'Delete wire',
  'topology-context-rename-wire': 'Rename wire',
  'topology-wire-rename-placeholder': 'Wire label',
  'topology-wire-labels-toggle': 'Wire labels',
  'topology-snap-announce': 'Aligned',
  'topology-duplicate-announce': 'Duplicate created',
  'topology-duplicate-cancel-announce': 'Duplicate cancelled',
  'topology-selection-announce': '{name} selected',
  'topology-selection-wire-announce': 'Wire selected',
  'topology-selection-clear-announce': 'Selection cleared',
  'topology-validation-details': 'Issues ({count})',
  'topology-align-aria': 'Align & distribute',
  'topology-align-left': 'Align left',
  'topology-align-hcenter': 'Align horizontal centers',
  'topology-align-right': 'Align right',
  'topology-align-top': 'Align top',
  'topology-align-vcenter': 'Align vertical centers',
  'topology-align-bottom': 'Align bottom',
  'topology-distribute-h': 'Distribute horizontally',
  'topology-distribute-v': 'Distribute vertically',
  'topology-bends-override-note': 'Bends override routing on bent wires',
  'topology-finder-aria': 'Find node',
  'topology-finder-placeholder': 'Search nodes…',
  'topology-finder-no-matches': 'No nodes match',
  'topology-shortcuts-find': 'Find node',
  'topology-auto-layout': 'Auto-layout',
  'topology-layout-announce': 'Topology arranged automatically',
  'topology-rack-share-title': 'topology-rack-share-title',
  'topology-rack-add-title': 'topology-rack-add-title',
  'topology-rack-edit-title': 'topology-rack-edit-title',
  'topology-rack-view-title': 'topology-rack-view-title',
  'topology-export': 'Export',
  'topology-import': 'Import',
  'topology-save-template': 'Save template',
  'topology-template-name-placeholder': 'Template name',
  'topology-template-save': 'Save',
  'topology-templates': 'Templates',
  'topology-template-load': 'Load',
  'topology-template-delete': 'Delete',
  'topology-no-templates': 'No saved templates',
  'topology-toast-export-copied': 'Topology copied to clipboard',
  'topology-toast-import-ok': 'Topology imported',
  'topology-toast-import-invalid': 'Clipboard does not contain a valid topology',
  'topology-toast-clipboard-unavailable': 'Clipboard is not available',
  'topology-toast-template-saved': 'Template saved',
  'topology-toast-template-deleted': 'Template deleted',
  'topology-apply-workspace-diff': '{ $created } created · { $updated } updated · { $archived } archived · { $typeChanged } type-changed · rev { $from } → { $to }',
  'topology-apply-blocked': 'Apply blocked — { $count } issue(s) to fix in the panel',
};

vi.mock('@fluent/react', async () => {
  const actual = await vi.importActual('@fluent/react');
  return {
    ...actual,
    Localized: ({ children }: { id: string; children: React.ReactNode }) => <>{children}</>,
    useLocalization: () => ({
      l10n: {
        getString: (id: string, vars?: Record<string, string | number> | null) => {
          let value = TOPOLOGY_EN[id] ?? id;
          for (const [key, val] of Object.entries(vars ?? {})) {
            value = value.replaceAll(`{ $${key} }`, String(val)).replaceAll(`{${key}}`, String(val));
          }
          return value;
        },
      },
    }),
  };
});

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({
    settings: {
      receipt: {
        showCurrency: false,
        decimalSeparator: 'dot',
        showTax: true,
        footer: '',
        paperWidth: 'standard',
        showTableNumber: false,
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 0,
        marginRight: 0,
      },
      store: { name: 'Test Store', address: '', taxId: '', currency: 'IDR', branch: '' },
      sync: { serverUrl: null, hasApiKey: false, enabled: false },
      brand: { colour: '#147EFB', storeName: 'Test Store' },
      preferences: { cardSize: 0, fontSize: 0, fontSmoothing: 'antialiased' },
      currencies: [],
      appVersion: '0.0.19',
    },
    loading: false,
    error: null,
    hasPartialError: false,
    refetch: vi.fn(),
    lastChangedKeys: [],
    markSettingsUpdated: vi.fn(),
  }),
}));

// The Apply flow now requires PIN verification before onSave (the redesign
// added a PIN confirmation popup). Mock verifyPin to accept any 4+ digit PIN
// so Apply tests drive the real popup flow instead of bypassing it.
vi.mock('@/api/staff', () => ({
  verifyPin: vi.fn(async () => true),
}));

const mockLoadTopology = vi.mocked(loadTopology);

// ── Retail seed (presets UI removed from production) ────────────────────────
// The editor no longer ships preset constants, so interaction tests seed the
// canvas with this local retail diagram — byte-identical to the old default
// retail preset. The passthrough hook mock below only fills the initial graph
// when the caller passes an empty one, so tests that seed via
// props/loadTopology keep their own data.
const RETAIL_SEED = {
  nodes: [
    // Cards are 240px tall: workspace rows sit at y 80/320 (240px apart on
    // the 24px grid) so no cards overlap on first load. The store keeps its
    // historical (80, 140) position — the geometry tests pin it.
    { id: 'store-1', type: 'store', name: 'Downtown Branch', subtitle: 'Primary Store', x: 80, y: 140, telemetryBadge: 'Online (2 POS)', telemetryStatus: 'online' },
    { id: 'ws-1', type: 'workspace', name: 'Retail POS #1', subtitle: 'Main Checkout', x: 380, y: 80, metadata: { typeKey: 'store-pos' }, telemetryBadge: 'Active', telemetryStatus: 'online' },
    { id: 'wh-1', type: 'warehouse', name: 'Main Warehouse', subtitle: 'Primary Storage', x: 680, y: 140, telemetryBadge: '1,250 items', telemetryStatus: 'online' },
  ],
  wires: [
    // Retail POS supplies the warehouse's one primary Operation scope.
    // Runtime stock deduction consumes this typed route as the warehouse
    // target, so the graph needs no second inbound stock wire.
    { id: 'w-1', fromNodeId: 'store-1', fromPort: 'right', toNodeId: 'ws-1', toPort: 'left', fromPortId: 'location-out', toPortId: 'location-in', relationshipType: 'location', direction: 'one-way', label: 'Binds Store' },
    { id: 'w-2', fromNodeId: 'ws-1', fromPort: 'right', toNodeId: 'wh-1', toPort: 'left', fromPortId: 'operation-out', toPortId: 'operation-in', relationshipType: 'generic', direction: 'one-way', label: 'Operation Feed' },
  ],
};

vi.mock('../features/locations/nodeTopologyEditorState', async () => {
  const actual = await vi.importActual<typeof nodeTopologyEditorState>(
    '../features/locations/nodeTopologyEditorState',
  );
  return {
    ...actual,
    useTopologyEditorGraph: (initialNodes: unknown[], initialWires: unknown[]) =>
      actual.useTopologyEditorGraph(
        initialNodes.length > 0 ? initialNodes : RETAIL_SEED.nodes,
        initialWires.length > 0 ? initialWires : RETAIL_SEED.wires,
      ),
  };
});

type TopologyTier = Exclude<ComponentProps<typeof NodeTopologyEditor>['currentTier'], undefined>;

const renderEditor = (props?: {
  onSave?: (nodes: unknown, wires: unknown) => Promise<Record<string, string> | void>;
  currentTier?: TopologyTier;
  branchLocations?: BranchLocationSeed[];
  workspaceInstances?: WorkspaceInstanceSeed[];
  onRenameBranch?: (id: string, name: string) => Promise<boolean> | boolean | void;
  onRenameWorkspace?: (id: string, name: string) => Promise<boolean> | boolean | void;
  allowLegacyApply?: boolean;
  branchId?: string;
  onDirtyChange?: (dirty: boolean) => void;
  onLoadError?: (error: unknown) => void;
  compareOverlay?: {
    ghosts: Array<{ id: string; name: string; x: number; y: number }>;
    onlyHere: string[];
    differing: string[];
    otherWires: Array<{ id: string; from_node_id: string; to_node_id: string; direction: string; relationship_type: string }>;
    sharedByOtherId: Array<{ otherId: string; currentId: string }>;
  } | null;
  compareFocus?: boolean;
  canSave?: boolean;
}) => {
  const result = renderWithProvidersSync(<NodeTopologyEditor currentTier="plus" {...props} />, multiStoreFtl, sharedFtl);
  // Open the Add panel for tests that expect the node palette to be visible.
  // The production default is collapsed (round 174); the test helper opens it
  // so existing tests that click +Retail POS etc. don't need updating.
  openRackPanel('add');
  return result;
};

/**
 * Harness that re-renders the editor with a NEW workspaceInstances array
 * on demand — simulating the TopologyScreen parent refreshing instances
 * after a save/apply. The load effect depends on [workspaceInstances], so
 * a new identity re-triggers the non-skip reload path.
 */
function ReloadingHarness({ next }: { next: WorkspaceInstanceSeed[] }) {
  const [instances, setInstances] = useState<WorkspaceInstanceSeed[] | undefined>(undefined);
  return (
    <>
      <button type="button" onClick={() => setInstances(next)}>
        reload-instances
      </button>
      {/* exactOptionalPropertyTypes: omit the prop while instances is undefined */}
      <NodeTopologyEditor currentTier="plus" {...(instances ? { workspaceInstances: instances } : {})} />
    </>
  );
}

/** Read a ghost card's position from its translate transform (round 169:
 *  ghosts position via transform so the glide transition is compositor-
 *  friendly, instead of left/top which would layout-thrash while easing). */
const ghostXY = (el: HTMLElement) => {
  const m = /translate\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px\s*\)/.exec(el.style.transform);
  if (!m) return { x: NaN, y: NaN };
  return { x: parseFloat(m[1]!), y: parseFloat(m[2]!) };
};

/** Stable workspace seed — identity never changes, so only the
 *  branchLocations prop drives the load-effect re-run in the rename flow. */
const renameWsInstances: WorkspaceInstanceSeed[] = [
  { instanceId: 'ws-rename', typeKey: 'store-pos', name: 'POS #1' },
];

/**
 * Harness simulating the TopologyScreen parent: a successful card rename
 * swaps the branchLocations identity (the parent's stores-state update),
 * re-triggering the editor's load effect with ONLY branch locations changed.
 */
function BranchRenameHarness() {
  const [locations, setLocations] = useState<BranchLocationSeed[]>([
    { id: 'store-1', name: 'Downtown Branch' },
  ]);
  return (
    <NodeTopologyEditor
      currentTier="plus"
      workspaceInstances={renameWsInstances}
      branchLocations={locations}
      onRenameBranch={async (id, name) => {
        setLocations((prev) => prev.map((l) => (l.id === id ? { ...l, name } : l)));
        return true;
      }}
    />
  );
}

/** Harness simulating the TopologyScreen parent for workspace renames: the
 *  parent persists via the instance API and refreshes the instances array
 *  with the SAME ids (only the name changed). */
function WorkspaceRenameHarness() {
  const [instances, setInstances] = useState<WorkspaceInstanceSeed[]>([
    { instanceId: 'ws-rename', typeKey: 'store-pos', name: 'POS #1' },
  ]);
  return (
    <NodeTopologyEditor
      currentTier="plus"
      workspaceInstances={instances}
      branchLocations={[{ id: 'store-1', name: 'Downtown Branch' }]}
      onRenameWorkspace={async (id, name) => {
        setInstances((prev) => prev.map((i) => (i.instanceId === id ? { ...i, name } : i)));
        return true;
      }}
    />
  );
}

/** Harness that swaps instances AND branch locations in one action — the
 *  instances-changed-wins case the light-merge guard must NOT intercept. */
function BothChangeHarness() {
  const [instances, setInstances] = useState<WorkspaceInstanceSeed[] | undefined>(undefined);
  const [locations, setLocations] = useState<BranchLocationSeed[] | undefined>(undefined);
  return (
    <>
      <button type="button" onClick={() => {
        setInstances([{ instanceId: 'ws-both', typeKey: 'store-pos', name: 'Both POS' }]);
        setLocations([{ id: 'store-9', name: 'Both Branch' }]);
      }}>
        both-change
      </button>
      <NodeTopologyEditor
        currentTier="plus"
        {...(instances ? { workspaceInstances: instances } : {})}
        {...(locations ? { branchLocations: locations } : {})}
      />
    </>
  );
}

const getNodeCount = () => document.querySelectorAll('.topology-node').length;
const getWireCount = () => document.querySelectorAll('.wire-group').length;

// Preset renders nodes in array order: [store-1, ws-1, wh-1].
const nodeAt = (idx: number) =>
  document.querySelectorAll('.topology-node')[idx] as HTMLElement;
const portOf = (node: HTMLElement, port: string) =>
  node.querySelector(`.node-port-row--${port}`) as HTMLElement;
/** The N-th stacked port row on a side (round 174). The first row (index 0)
 *  is the PRIMARY semantic for that side; use `portRowOf(node, port, i)` to
 *  click a specific semantic row (e.g. stock-in row on a warehouse left). */
const portRowOf = (node: HTMLElement, port: string, index: number) =>
  node.querySelectorAll(`.node-port-row--${port}`)[index] as HTMLElement;
/** Click two specific semantic port rows to author a wire (round 174). Each
 *  stacked row is one semantic, so the drop commits directly — the old
 *  single-socket click (portOf) no longer opens the relationship picker. */
const connectRows = (
  fromIdx: number, fromPort: string, fromRow: number,
  toIdx: number, toPort: string, toRow: number,
) => {
  fireEvent.click(portRowOf(nodeAt(fromIdx), fromPort, fromRow));
  fireEvent.click(portRowOf(nodeAt(toIdx), toPort, toRow));
};
const typeSelect = () => document.querySelector('select.inspector-select') as HTMLSelectElement;
const previewLine = () => document.querySelector('path.wire-path[opacity="0.5"]');

const selectFirstNode = () => {
  const firstNode = document.querySelector('.topology-node');
  if (firstNode) fireEvent.mouseDown(firstNode as Element, { button: 0 });
};

/** Lay the canvas out in jsdom so viewport-relative clamping has a real size. */
const mockCanvasSize = (width: number, height: number) => {
  const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
  Object.defineProperty(canvas, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(canvas, 'clientHeight', { value: height, configurable: true });
};

/**
 * Click the confirm button of an open confirm dialog. The dialog's confirm
 * button carries aria-label="Delete" while the inspector may also render a
 * Delete button for the selected node — scope the query to the dialog panel.
 */
const confirmDialogAction = (label = 'Delete') => {
  const dialog = document.querySelector('.modal-panel[role="dialog"]') as HTMLElement | null;
  if (!dialog) throw new Error('no open confirm dialog');
  const btn = within(dialog).getByRole('button', { name: label });
  fireEvent.click(btn);
};

/**
 * Open a tool-rack panel (the redesign collapsed the always-visible sidebar
 * into a right-side icon strip with click-to-open panels). The add panel
 * starts open by default; edit/view/share must be opened explicitly. The
 * rack icon buttons carry `aria-label` from the l10n keys. Idempotent: a second
 * open for an already-open panel is a no-op (the icon is a toggle).
 */
const openRackPanel = (panel: 'add' | 'edit' | 'view' | 'share') => {
  const label = {
    add: 'topology-rack-add-title',
    edit: 'topology-rack-edit-title',
    view: 'topology-rack-view-title',
    share: 'topology-rack-share-title',
  }[panel];
  const btn = document.querySelector(`.rack-icon-btn[aria-label="${label}"]`) as HTMLElement | null;
  if (!btn) throw new Error(`rack icon button for '${panel}' panel not found`);
  if (btn.classList.contains('is-active')) return;
  fireEvent.click(btn);
};

/**
 * Complete the Apply flow through the PIN confirmation popup (the redesign
 * gates Apply behind a 4+ digit PIN). Clicks Apply Topology, types
 * the PIN, and confirms; returns after the verifyPin promise settles. The
 * verifyPin module mock accepts any PIN.
 */
const applyWithPin = async (pin = '1234') => {
  fireEvent.click(screen.getByText('Apply Topology'));
  const input = document.getElementById('topology-apply-pin') as HTMLInputElement | null;
  if (!input) throw new Error('Apply PIN input not found');
  fireEvent.change(input, { target: { value: pin } });
  fireEvent.click(screen.getByText('Apply'));
};

describe('NodeTopologyEditor Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDevLog(); // no dev-log diagnostics may leak across tests
    mockLoadTopology.mockResolvedValue(null);
  });

  it('renders tier badge and default retail preset nodes', () => {
    renderEditor();

    // The header no longer carries a title — the tier badge (default
    // currentTier = 'plus') marks the header instead.
    expect(screen.getByText('PLUS TIER')).toBeInTheDocument();
    expect(screen.getByText('Downtown Branch')).toBeInTheDocument();
    expect(screen.getByText('Retail POS #1')).toBeInTheDocument();
    expect(screen.getByText('Main Warehouse')).toBeInTheDocument();
  });

  it('renders the branch-diff overlay: ghost cards and card markers', async () => {
    // Sparse load: the full retail preset fills the 800×600 jsdom rect, so
    // (400, 20) is a genuinely free spot here (store at (80,140), ws-1 at
    // (680,140)) — the ghost must render exactly at its saved position
    // when unobstructed.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Downtown Branch', x: 80, y: 140 },
        { id: 'ws-1', type: 'workspace', name: 'Retail POS #1', x: 680, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-1', type: 'warehouse', name: 'Main Warehouse', x: 680, y: 420 },
      ],
      wires: [],
    } as never);
    renderEditor({
      compareOverlay: {
        ghosts: [{ id: 'ws-ghost', name: 'Stock Room', x: 400, y: 20 }],
        onlyHere: ['ws-1'],
        differing: ['store-1'],
        otherWires: [],
        sharedByOtherId: [],
      },
    });
    await waitFor(() => expect(getNodeCount()).toBe(3));

    // Other-only workspaces render as ghost cards at the other diagram's
    // saved position — decorative (never a real, interactive card).
    const ghost = document.querySelector(
      '.topology-overlay-ghost[data-overlay-node-id="ws-ghost"]',
    ) as HTMLElement | null;
    expect(ghost).not.toBeNull();
    expect(ghostXY(ghost!)).toEqual({ x: 400, y: 20 });
    expect(ghost!.textContent).toContain('Stock Room');
    expect(ghost!.getAttribute('aria-hidden')).toBe('true');

    // The glide is gated behind the layer's animate class while idle — the
    // transition is removed during a pan drag so ghosts track the canvas.
    const layer = document.querySelector('.topology-overlay-ghost-layer');
    expect(layer!.className).toContain('topology-ghosts-animate');

    // Current-only cards get the red marker, shared-differing ones the amber
    // marker; cards outside the classification keep their plain look.
    const ws1 = document.querySelector('.topology-node[data-node-id="ws-1"]') as HTMLElement;
    expect(ws1.className).toContain('topology-node--overlay-only-here');
    const store1 = document.querySelector('.topology-node[data-node-id="store-1"]') as HTMLElement;
    expect(store1.className).toContain('topology-node--overlay-differing');
    const wh1 = document.querySelector('.topology-node[data-node-id="wh-1"]') as HTMLElement;
    expect(wh1.className).not.toContain('topology-node--overlay-');
  });

  it('clamps off-canvas overlay ghosts into the visible canvas and leaves in-view ghosts alone', async () => {
    // Sparse load so the clamped corner (560,360) and the in-view spot
    // (320,20) are genuinely free — the full retail preset's warehouse
    // occupies the corner, which would move the far ghost aside instead.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Downtown Branch', x: 80, y: 140 },
        // Far off-canvas: it must not crowd the clamped corner the far
        // ghost tests.
        { id: 'ws-1', type: 'workspace', name: 'Retail POS #1', x: 4000, y: 4000, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [],
    } as never);
    renderEditor({
      compareOverlay: {
        ghosts: [
          { id: 'ws-ghost-far', name: 'Satellite', x: 4000, y: 4000 },
          { id: 'ws-ghost-in', name: 'Local', x: 320, y: 20 },
        ],
        onlyHere: [],
        differing: [],
        otherWires: [],
        sharedByOtherId: [],
      },
    });
    await waitFor(() => expect(getNodeCount()).toBe(2));

    // The far ghost clamps into the default 800×600 viewport (jsdom has no
    // layout, so the editor falls back to 800×600 at zoom 1, pan 0 — the
    // visible world-rect is [0,800]×[0,600] and a 240px card fits at x ≤ 560).
    const far = document.querySelector(
      '.topology-overlay-ghost[data-overlay-node-id="ws-ghost-far"]',
    ) as HTMLElement | null;
    expect(far).not.toBeNull();
    expect(ghostXY(far!)).toEqual({ x: 560, y: 360 });

    // The already-visible ghost keeps its exact position (the layout must
    // not shuffle cards that fit).
    const inView = document.querySelector(
      '.topology-overlay-ghost[data-overlay-node-id="ws-ghost-in"]',
    ) as HTMLElement | null;
    expect(inView).not.toBeNull();
    expect(ghostXY(inView!)).toEqual({ x: 320, y: 20 });
  });

  it('gates the ghost glide off during a pan drag and restores it on release', () => {
    renderEditor({
      compareOverlay: {
        ghosts: [{ id: 'ws-ghost', name: 'Stock Room', x: 480, y: 360 }],
        onlyHere: [],
        differing: [],
        otherWires: [],
        sharedByOtherId: [],
      },
    });
    const layer = document.querySelector('.topology-overlay-ghost-layer') as HTMLElement;
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    expect(layer.className).toContain('topology-ghosts-animate');

    // Middle-button drag starts the pan: the transition class must drop so
    // an edge-anchored ghost tracks the pointer instead of trailing it.
    fireEvent.mouseDown(canvas, { button: 1, clientX: 100, clientY: 100 });
    expect(layer.className).not.toContain('topology-ghosts-animate');
    fireEvent.mouseMove(document, { clientX: 150, clientY: 130 });
    expect(layer.className).not.toContain('topology-ghosts-animate');

    // Releasing the drag restores the glide for the next discrete re-clamp.
    fireEvent.mouseUp(document, { button: 1 });
    expect(layer.className).toContain('topology-ghosts-animate');
  });

  it('draws dashed ghost-wire stubs between ghost workspaces wired together in the other branch', () => {
    renderEditor({
      compareOverlay: {
        ghosts: [
          { id: 'ws-ghost-a', name: 'Satellite A', x: 0, y: 300 },
          { id: 'ws-ghost-b', name: 'Satellite B', x: 500, y: 300 },
        ],
        onlyHere: [],
        differing: [],
        otherWires: [
          {
            id: 'w-ghost-ab',
            from_node_id: 'ws-ghost-a',
            to_node_id: 'ws-ghost-b',
            direction: 'one-way',
            relationship_type: 'generic',
          },
          // A ghost wired to a non-ghost workspace must NOT produce a stub.
          {
            id: 'w-ghost-out',
            from_node_id: 'ws-ghost-a',
            to_node_id: 'ws-1',
            direction: 'one-way',
            relationship_type: 'generic',
          },
        ],
        sharedByOtherId: [],
      },
    });

    const lines = Array.from(document.querySelectorAll('.topology-overlay-stub'));
    expect(lines).toHaveLength(1);
    const line = lines[0] as unknown as { getAttribute: (n: string) => string | null };

    // The stub must connect the two RENDERED ghost cards edge-to-edge
    // (right edge midpoint of the left card → left edge midpoint of the
    // right card). The cards' exact positions are layout-decided (round 159
    // may push a ghost off a live card), so derive the expectations from
    // the rendered cards instead of hardcoding the preset geometry.
    const gA = document.querySelector(
      '.topology-overlay-ghost[data-overlay-node-id="ws-ghost-a"]',
    ) as HTMLElement;
    const gB = document.querySelector(
      '.topology-overlay-ghost[data-overlay-node-id="ws-ghost-b"]',
    ) as HTMLElement;
    const { x: ax, y: ay } = ghostXY(gA);
    const { x: bx, y: by } = ghostXY(gB);
    expect(bx).toBeGreaterThan(ax); // B sits to the RIGHT of A
    expect(line.getAttribute('x1')).toBe(String(ax + 240));
    expect(line.getAttribute('y1')).toBe(String(ay + 120));
    expect(line.getAttribute('x2')).toBe(String(bx));
    expect(line.getAttribute('y2')).toBe(String(by + 120));
  });

  it('draws a ghost-to-shared stub from a ghost card to the live shared workspace', () => {
    renderEditor({
      compareOverlay: {
        ghosts: [{ id: 'ws-ghost-sat', name: 'Satellite Room', x: 0, y: 300 }],
        onlyHere: [],
        differing: [],
        otherWires: [
          {
            id: 'w-ghost-shared',
            from_node_id: 'ws-ghost-sat',
            to_node_id: 'ws-other-side',
            direction: 'one-way',
            relationship_type: 'stock-routing',
          },
        ],
        sharedByOtherId: [{ otherId: 'ws-other-side', currentId: 'ws-1' }],
      },
    });

    const lines = Array.from(document.querySelectorAll('.topology-overlay-stub'));
    expect(lines).toHaveLength(1);
    const line = lines[0] as unknown as { getAttribute: (n: string) => string | null };

    // The stub must connect the RENDERED ghost card to the LIVE ws-1 card
    // (the retail preset's workspace) edge-to-edge. ws-1 is to the right of
    // the ghost, so the ghost's right edge midpoint → ws-1's left edge
    // midpoint. Both positions come from the rendered DOM, decoupled from
    // the preset geometry.
    const ghost = document.querySelector(
      '.topology-overlay-ghost[data-overlay-node-id="ws-ghost-sat"]',
    ) as HTMLElement;
    const shared = document.querySelector('.topology-node[data-node-id="ws-1"]') as HTMLElement;
    const { x: gx, y: gy } = ghostXY(ghost);
    const sx = parseInt(shared.style.left, 10);
    const sy = parseInt(shared.style.top, 10);
    expect(sx).toBeGreaterThan(gx); // the shared card sits to the RIGHT
    expect(line.getAttribute('x1')).toBe(String(gx + 240));
    expect(line.getAttribute('y1')).toBe(String(gy + 120));
    expect(line.getAttribute('x2')).toBe(String(sx));
    expect(line.getAttribute('y2')).toBe(String(sy + 120));
  });

  it('compare focus dims only the shared-identical cards when enabled', () => {
    // Overlay: ws-1 is shared-identical (dim); store-1 is only-here (keep
    // bright); wh-1 is shared-but-differing (keep bright). The overlay ids
    // are current-side card ids; ws-1 must be in sharedByOtherId but not
    // in differing.
    renderEditor({
      compareFocus: true,
      compareOverlay: {
        ghosts: [],
        onlyHere: ['store-1'],
        differing: ['wh-1'],
        otherWires: [],
        sharedByOtherId: [{ otherId: 'ws-1', currentId: 'ws-1' }],
      },
    });

    const ws1 = document.querySelector('.topology-node[data-node-id="ws-1"]') as HTMLElement;
    expect(ws1.className).toContain('node-dimmed');
    const store1 = document.querySelector('.topology-node[data-node-id="store-1"]') as HTMLElement;
    expect(store1.className).not.toContain('node-dimmed');
    const wh1 = document.querySelector('.topology-node[data-node-id="wh-1"]') as HTMLElement;
    expect(wh1.className).not.toContain('node-dimmed');
  });

  it('compare focus dims nothing when disabled even with an overlay', () => {
    renderEditor({
      compareOverlay: {
        ghosts: [],
        onlyHere: [],
        differing: [],
        otherWires: [],
        sharedByOtherId: [{ otherId: 'ws-1', currentId: 'ws-1' }],
      },
    });
    expect(document.querySelectorAll('.topology-node.node-dimmed')).toHaveLength(0);
  });

  it('hover inspection lights the inspected card back up despite compare-focus dimming', () => {
    // Round 163 regression: compare focus dims ws-1 (shared-identical), but
    // hovering ws-1 itself must LIGHT it up — the operator is inspecting
    // this exact card, and hover focus is the transient, specific intent.
    // The naive OR of the two dim modes kept the inspected card dimmed.
    renderEditor({
      compareFocus: true,
      compareOverlay: {
        ghosts: [],
        onlyHere: [],
        differing: [],
        otherWires: [],
        sharedByOtherId: [{ otherId: 'ws-1', currentId: 'ws-1' }],
      },
    });

    const ws = document.querySelector('.topology-node[data-node-id="ws-1"]') as HTMLElement;
    expect(ws.className).toContain('node-dimmed');

    fireEvent.mouseEnter(ws);
    expect(ws.className).not.toContain('node-dimmed');

    fireEvent.mouseLeave(ws);
    expect(ws.className).toContain('node-dimmed');
  });

  it('hovering a connected card also lights a compare-dimmed neighbour', () => {
    renderEditor({
      compareFocus: true,
      compareOverlay: {
        ghosts: [],
        onlyHere: [],
        differing: [],
        otherWires: [],
        sharedByOtherId: [{ otherId: 'ws-1', currentId: 'ws-1' }],
      },
    });

    // Retail preset: store-1 → ws-1. Hovering the store keeps its direct
    // neighbour (ws-1) lit even though compare focus dims ws-1.
    const store = document.querySelector('.topology-node[data-node-id="store-1"]') as HTMLElement;
    const ws = document.querySelector('.topology-node[data-node-id="ws-1"]') as HTMLElement;
    expect(ws.className).toContain('node-dimmed');

    fireEvent.mouseEnter(store);
    expect(ws.className).not.toContain('node-dimmed');
  });


  it('adds each of the four supported workspace types from the palette', () => {
    renderEditor({ currentTier: 'pro' });

    fireEvent.click(screen.getByText('+ Restaurant POS'));
    fireEvent.click(screen.getByText('+ Retail POS'));
    fireEvent.click(screen.getByText('+ KDS'));
    fireEvent.click(screen.getByText('+ Warehouse'));

    expect(document.querySelectorAll('.topology-node.node-type-workspace')).toHaveLength(4);
    expect(document.querySelectorAll('.topology-node.node-type-warehouse')).toHaveLength(2);
    expect(screen.getByLabelText('Restaurant POS')).toBeInTheDocument();
    expect(screen.getByLabelText('Retail POS')).toBeInTheDocument();
    expect(screen.getByLabelText('Kitchen Display (KDS)')).toBeInTheDocument();
  });

  it('renders the UX-first titlebar, stacked labeled port rows, textbox, and toggle', () => {
    renderEditor();

    expect(document.querySelectorAll('.node-titlebar')).toHaveLength(3);
    expect(screen.getAllByText('Location').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Operation').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('textbox', { name: /Edit name/ })).toHaveLength(1);
    expect(screen.getAllByRole('checkbox', { name: /Toggle enabled state/ })).toHaveLength(1);
    // The stacked-row footer only renders left/right semantic rows — never
    // the retired top/bottom sockets.
    expect(document.querySelectorAll('.node-port-row--top')).toHaveLength(0);
    expect(document.querySelectorAll('.node-port-row--bottom')).toHaveLength(0);
    expect(document.body.textContent).not.toContain('topology-port-');
    expect(document.body.textContent).not.toContain('topology-field-');

    // The widened card reserves a dedicated connector footer: labels and
    // sockets live in the footer columns, outside the content flow, so they
    // cannot collide with telemetry or inline workspace controls.
    const workspace = nodeAt(1);
    expect(workspace.classList.contains('node-type-workspace')).toBe(true);
    expect(workspace.querySelector('.node-body')).not.toBeNull();
    expect(workspace.querySelector('.node-footer')).not.toBeNull();
    expect(workspace.querySelectorAll('.node-port-row--left')).toHaveLength(1);
    expect(workspace.querySelectorAll('.node-port-row--right')).toHaveLength(3);
  });

  it('keeps only the icon and node name in the title bar', () => {
    renderEditor();

    for (let i = 0; i < 3; i += 1) {
      const card = nodeAt(i);
      const header = card.querySelector('.node-titlebar');
      const body = card.querySelector('.node-body');
      expect(header, `node ${i} title bar exists`).not.toBeNull();
      expect(body, `node ${i} body exists`).not.toBeNull();
      expect(header?.querySelector('.node-type-icon')).not.toBeNull();
      expect(header?.querySelector('.node-title')).not.toBeNull();
      expect(header?.querySelector('.node-type-accent')).toBeNull();
      expect(header?.querySelector('.node-grip')).toBeNull();
      expect(header?.querySelector('.node-card-rename-btn')).toBeNull();
      expect(header?.querySelector('.node-telemetry-badge')).toBeNull();
      expect(body?.querySelector('.node-grip')).not.toBeNull();
      const badge = card.querySelector('.node-telemetry-badge');
      if (badge) expect(body?.contains(badge)).toBe(true);
    }
  });

  it('keeps connector geometry aligned to the card edge and per-row centerline', () => {
    renderEditor();

    const workspace = nodeAt(1);
    const footer = workspace.querySelector('.node-footer') as HTMLElement;
    const left = workspace.querySelector('.node-port-row--left') as HTMLElement;
    const right = workspace.querySelector('.node-port-row--right') as HTMLElement;
    expect(footer).not.toBeNull();
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();

    // The shared contract is intentionally explicit: wire endpoints sit at
    // x=0 / x=NODE_WIDTH and y = node.y + portRowCenterY(row), with each
    // stacked semantic row centered in its PORT_ROW_H band inside the footer.
    expect(NODE_WIDTH).toBe(240);
    expect(NODE_PORT_ROW_H - NODE_PORT_MARKER).toBe(20);
    expect(left.className).toContain('node-port-row--left');
    expect(right.className).toContain('node-port-row--right');
    expect(footer.className).toContain('node-footer');
  });

  it('keeps long workspace titles visually bounded by the titlebar', () => {
    renderEditor();

    const title = nodeAt(1).querySelector('.node-title') as HTMLElement;
    expect(title).not.toBeNull();
    expect(title.parentElement?.classList.contains('node-title-wrapper')).toBe(true);
  });

  it('edits inline workspace controls without dragging the node', () => {
    renderEditor();

    const workspace = nodeAt(1);
    const nameInput = screen.getAllByRole('textbox', { name: /Edit name/ })[0]!;
    const enabled = screen.getAllByRole('checkbox', { name: /Toggle enabled state/ })[0]!;
    fireEvent.change(nameInput, { target: { value: 'Counter POS' } });
    fireEvent.click(enabled);

    expect(screen.getByText('Counter POS')).toBeInTheDocument();
    expect((enabled as HTMLInputElement).checked).toBe(false);
    // Retail preset spaces workspace cards at x 380 so the 240px-wide cards
    // never overlap the store column.
    expect(workspace.style.left).toBe('380px');
  });

  it('drags from the titlebar while connector clicks remain interaction-only', () => {
    renderEditor();

    const workspace = nodeAt(1);
    const titlebar = workspace.querySelector('.node-titlebar') as HTMLElement;
    const port = portOf(workspace, 'right');
    const before = workspace.style.left;
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    fireEvent.mouseDown(titlebar, { button: 0, clientX: 340, clientY: 80 });
    fireEvent.mouseMove(canvas, { clientX: 388, clientY: 80 });
    expect(workspace.style.left).not.toBe(before);
    fireEvent.mouseUp(canvas, { button: 0 });

    const afterDrag = workspace.style.left;
    fireEvent.mouseDown(port, { button: 0, clientX: 0, clientY: 0 });
    expect(workspace.style.left).toBe(afterDrag);
  });

  it('renders a legacy Inventory workspace as a plain workspace — fixed Location input', async () => {
    // Inventory Management was removed from the topology (round 67): an
    // inventory node left over in a saved diagram degrades to the generic
    // workspace card. Unwired, its single left input reads the fixed
    // "Location" label — the flexible "Input"/Operation behavior of the
    // old inventory card is gone.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
        { id: 'ws-inv', type: 'workspace', name: 'Inventory', x: 380, y: 140, metadata: { typeKey: 'inventory' } },
      ],
      wires: [],
    } as never);
    renderEditor();

    await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(2));
    const inv = nodeAt(1);
    // Single left Location input, two right outputs (stock + transfer).
    expect(inv.querySelectorAll('.node-port-row--left')).toHaveLength(1);
    expect(inv.querySelectorAll('.node-port-row--right')).toHaveLength(2);
    // The first left row label should resolve to Location.
    const leftRow = inv.querySelector('.node-port-row--left');
    expect(leftRow?.textContent).toContain('Location');
  });

  it('exposes a left Operation input and a right Ticket Out output on Kitchen Display nodes', async () => {
    // A KDS consumes one Operation feed from the left and forwards ticket
    // feeds to a printer from the right — so it exposes exactly one left
    // connector labeled "Operation" (never a Location In pair) plus one
    // right connector labeled "Ticket Out".
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
        { id: 'ws-kds', type: 'workspace', name: 'Kitchen Display', x: 380, y: 80, metadata: { typeKey: 'kds' } },
      ],
      wires: [],
    } as never);
    renderEditor();

    await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(2));
    const kds = nodeAt(1);
    expect(kds.querySelector('.node-title')?.textContent).toBe('Kitchen Display');
    // KDS: left=operation-in (1), right=ticket-out (1).
    expect(kds.querySelectorAll('.node-port-row--left')).toHaveLength(1);
    expect(kds.querySelectorAll('.node-port-row--right')).toHaveLength(1);
    const leftRow = kds.querySelector('.node-port-row--left');
    const rightRow = kds.querySelector('.node-port-row--right');
    expect(leftRow?.textContent).toContain('Operation');
    expect(rightRow?.textContent).toContain('Ticket Out');
  });

  // ── Typed connection gating (ADR #34 first slice) ────────────────────
  it('creates a Location wire from a store output to a workspace input', async () => {
    // Clean canvas (no preset wires): a store's Location output must still
    // author a location wire into a workspace input under typed gating.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
        { id: 'ws-a', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));
    fireEvent.click(portOf(nodeAt(0), 'right'));
    fireEvent.click(portOf(nodeAt(1), 'left'));
    expect(getWireCount()).toBe(1);
    // A single-semantic drop authors the wire directly — no picker.
    expect(document.querySelector('.topology-relationship-picker')).toBeNull();
  });

  it('authors a stock-routing wire from a workspace stock-out row to a warehouse stock-in row', async () => {
    // With stacked per-semantic port rows (round 174), clicking the stock-out
    // row (workspace right, index 0) and the stock-in row (warehouse left,
    // index 2) creates the stock-routing wire directly — no picker needed.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
        { id: 'ws-a', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-1', type: 'warehouse', name: 'WH', x: 680, y: 140 },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));

    // stock-out (workspace right row 0) → stock-in (warehouse left row 2).
    connectRows(1, 'right', 0, 2, 'left', 2);
    expect(getWireCount()).toBe(1);
    expect(document.querySelector('.topology-relationship-picker')).toBeNull();
  });

  it('authors an inventory-transfer wire from a workspace transfer-out to a warehouse transfer-in', async () => {
    // transfer-out (workspace right row 1) → transfer-in (warehouse left row 3).
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
        { id: 'ws-a', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-1', type: 'warehouse', name: 'WH', x: 680, y: 140 },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));

    connectRows(1, 'right', 1, 2, 'left', 3);
    expect(getWireCount()).toBe(1);
    // The transfer wire carries its own label (surfaced as the hitbox
    // title, translated by the mock to 'Transfer').
    const wires = document.querySelectorAll('.wire-group');
    const title = wires[0]!.querySelector('.wire-hitbox title');
    expect(title?.textContent).toContain('Transfer');
  });

  it('allows a transfer and a stock wire to coexist on the same socket pair', async () => {
    // With per-row semantics, a workspace can emit both a stock-routing wire
    // (stock-out → stock-in) and a transfer wire (transfer-out → transfer-in)
    // to the same warehouse — both coexist because they carry distinct
    // from/to semantic ids.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
        { id: 'ws-a', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-1', type: 'warehouse', name: 'WH', x: 680, y: 140 },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));

    // Transfer first (transfer-out → transfer-in).
    connectRows(1, 'right', 1, 2, 'left', 3);
    expect(getWireCount()).toBe(1);

    // Stock routing second (stock-out → stock-in) — distinct semantic ids,
    // not a duplicate.
    connectRows(1, 'right', 0, 2, 'left', 2);
    expect(getWireCount()).toBe(2);
  });

  it('rejects a duplicate of the SAME relationship with a duplicate toast', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
        { id: 'ws-a', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-1', type: 'warehouse', name: 'WH', x: 680, y: 140 },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));

    // stock-out → stock-in (stock-routing).
    connectRows(1, 'right', 0, 2, 'left', 2);
    expect(getWireCount()).toBe(1);

    // The same relationship again on the same pair is a duplicate.
    connectRows(1, 'right', 0, 2, 'left', 2);
    expect(getWireCount()).toBe(1);
    expect(screen.getByText('A wire already connects these ports.')).toBeInTheDocument();
  });

  it('authors a ticket-routing wire from a KDS ticket-out to a hardware input (single option, no picker)', async () => {
    // The load-only gap is closed: a KDS output is now visible and the
    // hardware input admits the ticket-in semantic, so the drop resolves
    // to exactly one ticket-routing option and authors directly.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
        { id: 'ws-kds', type: 'workspace', name: 'Kitchen Display', x: 380, y: 140, metadata: { typeKey: 'kds' } },
        { id: 'hw-prn', type: 'hardware', name: 'Thermal Printer', x: 680, y: 140 },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));

    // KDS right row 0 = ticket-out; hardware left row 1 = ticket-in.
    connectRows(1, 'right', 0, 2, 'left', 1);

    // No picker (single semantic) and the ticket-routing wire exists.
    expect(document.querySelector('.topology-relationship-picker')).toBeNull();
    expect(getWireCount()).toBe(1);
    const wire = document.querySelector('.wire-group');
    expect(wire?.querySelector('.wire-hitbox title')?.textContent).toContain('Ticket Print');
  });

  it('connects Restaurant POS output to the KDS Operation input', async () => {
    // Restaurant POS emits the operational feed consumed by a KDS. This
    // regression test exercises the actual socket click path, not only the
    // semantic pairing helper, so the editor cannot silently gate the valid
    // Resto → KDS connection closed.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
        { id: 'ws-resto', type: 'workspace', name: 'Restaurant POS', x: 380, y: 140, metadata: { typeKey: 'restaurant-pos' } },
        { id: 'ws-kds', type: 'workspace', name: 'Kitchen Display', x: 680, y: 140, metadata: { typeKey: 'kds' } },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));

    fireEvent.click(portOf(nodeAt(1), 'right'));
    fireEvent.click(portOf(nodeAt(2), 'left'));

    expect(getWireCount()).toBe(1);
    expect(document.querySelector('.topology-relationship-picker')).toBeNull();
  });

  it('does not flag a KDS connected to Restaurant POS as missing Location', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', store_profile_id: 'store-1', x: 80, y: 140 },
        { id: 'ws-resto', type: 'workspace', name: 'Restaurant POS', x: 380, y: 140, metadata: { typeKey: 'restaurant-pos' } },
        { id: 'ws-kds', type: 'workspace', name: 'Kitchen Display', x: 680, y: 140, metadata: { typeKey: 'kds' } },
      ],
      wires: [
        { id: 'w-location', from_node_id: 'store-1', to_node_id: 'ws-resto', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-operation', from_node_id: 'ws-resto', to_node_id: 'ws-kds', from_port_id: 'operation-out', to_port_id: 'operation-in', relationship_type: 'generic', direction: 'one-way' },
      ],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));

    expect(within(nodeAt(2)).queryByText('Connect this workspace to a Branch Location using Location In.')).toBeNull();
    expect(within(nodeAt(2)).queryByText('Connect this KDS to a Restaurant POS using Operation In.')).toBeNull();
  });


  it('refuses a ticket wire into a printer that already has a ticket source', async () => {
    // ADR #34 ticket-routing cardinality: a ticket device accepts exactly
    // one source. The drop is refused with a toast — explicit, never
    // silent replacement — and no wire is drawn.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
        { id: 'ws-kds-1', type: 'workspace', name: 'Kitchen A', x: 380, y: 140, metadata: { typeKey: 'kds' } },
        { id: 'ws-kds-2', type: 'workspace', name: 'Kitchen B', x: 380, y: 420, metadata: { typeKey: 'kds' } },
        { id: 'hw-prn', type: 'hardware', name: 'Thermal Printer', x: 680, y: 280 },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(4));

    // Author the first KDS → printer ticket wire.
    // KDS right row 0 = ticket-out; hardware left row 1 = ticket-in.
    connectRows(1, 'right', 0, 3, 'left', 1);
    expect(getWireCount()).toBe(1);

    // A SECOND KDS dropping onto the same printer must be refused — the
    // pair differs, so this is a cardinality refusal, not a duplicate.
    connectRows(2, 'right', 0, 3, 'left', 1);
    expect(getWireCount()).toBe(1);
    expect(screen.getByText('A ticket device can receive tickets from only one source.')).toBeInTheDocument();
  });

  it('flags a printer fed by two ticket sources in the live validation badge', async () => {
    // The badge mirror must surface the same cardinality error Apply
    // throws — pinned to the printer card like the other multiple-inputs
    // errors, so the live surface and the Apply gate can never drift.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', store_profile_id: 'store-1', x: 80, y: 140 },
        { id: 'ws-resto-a', type: 'workspace', name: 'Resto A', x: 260, y: 140, metadata: { typeKey: 'restaurant-pos' } },
        { id: 'ws-resto-b', type: 'workspace', name: 'Resto B', x: 260, y: 420, metadata: { typeKey: 'restaurant-pos' } },
        { id: 'ws-kds-a', type: 'workspace', name: 'Kitchen A', x: 440, y: 140, metadata: { typeKey: 'kds' } },
        { id: 'ws-kds-b', type: 'workspace', name: 'Kitchen B', x: 440, y: 420, metadata: { typeKey: 'kds' } },
        { id: 'hw-prn', type: 'hardware', name: 'Thermal Printer', x: 680, y: 280 },
      ],
      wires: [
        { id: 'w-la', from_node_id: 'store-1', to_node_id: 'ws-resto-a', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-lb', from_node_id: 'store-1', to_node_id: 'ws-resto-b', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-oa', from_node_id: 'ws-resto-a', to_node_id: 'ws-kds-a', from_port_id: 'operation-out', to_port_id: 'operation-in', relationship_type: 'generic', direction: 'one-way' },
        { id: 'w-ob', from_node_id: 'ws-resto-b', to_node_id: 'ws-kds-b', from_port_id: 'operation-out', to_port_id: 'operation-in', relationship_type: 'generic', direction: 'one-way' },
        { id: 'w-ta', from_node_id: 'ws-kds-a', to_node_id: 'hw-prn', from_port_id: 'ticket-out', to_port_id: 'ticket-in', relationship_type: 'ticket-routing', direction: 'one-way' },
        { id: 'w-tb', from_node_id: 'ws-kds-b', to_node_id: 'hw-prn', from_port_id: 'ticket-out', to_port_id: 'ticket-in', relationship_type: 'ticket-routing', direction: 'one-way' },
      ],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(6));

    const printer = [...document.querySelectorAll('.topology-node')].find(
      (n) => n.querySelector('.node-title')?.textContent === 'Thermal Printer',
    );
    expect(printer).not.toBeUndefined();
    expect(
      within(printer as HTMLElement).getByText('A ticket device can receive tickets from only one source.'),
    ).toBeInTheDocument();
  });

  it('moves a ghost off a live NON-workspace card it would land on (spatial divergence)', () => {
    // Branch divergence: the other branch's workspace sits where THIS
    // branch keeps its Branch Location (store at (80,140)). The ghost must
    // never cover the root card — ALL live card kinds are blockers, not
    // just workspaces. The 800×600 jsdom canvas has no room to drop the
    // ghost below the store, so zoom out to 0.8: the visible world-rect
    // grows to 1000×750 and the stack drops the ghost to 388 = 140 + 240
    // + 8 gap below the store's bottom edge.
    renderEditor({
      compareOverlay: {
        ghosts: [{ id: 'ws-ghost', name: 'Stock Room', x: 120, y: 240 }],
        onlyHere: [],
        differing: [],
        otherWires: [],
        sharedByOtherId: [],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));

    const ghost = document.querySelector(
      '.topology-overlay-ghost[data-overlay-node-id="ws-ghost"]',
    ) as HTMLElement | null;
    expect(ghost).not.toBeNull();
    expect(ghostXY(ghost!)).toEqual({ x: 120, y: 388 });
  });

  // ── Connection cancellation (edge cases) ─────────────────────────
  // The direct wire-creation tests (above) verify that the stacked per-
  // semantic row model arms and completes connections correctly. These
  // two edge cases pin the surrounding cancellation contract: a plain
  // canvas click does NOT cancel an armed connection (the user may be
  // panning to a distant target — connection reducer's dismiss-picker
  // case), Escape does, and re-arming from another output replaces the
  // previous attempt without ever committing a wire.

  it('clicking the canvas does not cancel an armed connection (Escape does)', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
        { id: 'ws-a', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-1', type: 'warehouse', name: 'WH', x: 680, y: 140 },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));

    // Arm a connection from the workspace's stock-out row.
    fireEvent.click(portRowOf(nodeAt(1), 'right', 0));
    expect(previewLine()).not.toBeNull();

    // A plain canvas click (down+up on the background, no port) must NOT
    // cancel a plain armed connection: the user may be panning toward a
    // distant target. The in-flight preview stays live and no wire is
    // created. (Only Escape, a compatible drop, or dismissing an OPEN
    // picker cancels — see the connection reducer's dismiss-picker case.)
    // The upstroke matters: it finalizes the marquee the downstroke armed,
    // so a later Escape reaches the connection-cancel branch instead of
    // being swallowed by the mid-marquee guard.
    fireEvent.mouseDown(document.querySelector('.node-canvas-container')!);
    fireEvent.mouseUp(document.querySelector('.node-canvas-container')!);
    await act(async () => {});
    expect(previewLine()).not.toBeNull();
    expect(getWireCount()).toBe(0);

    // Escape is the explicit cancel gesture.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(previewLine()).toBeNull();
    expect(getWireCount()).toBe(0);
  });

  it('clicking a second output row while armed cancels the in-flight connection with an incompatible toast', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
        { id: 'ws-a', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-1', type: 'warehouse', name: 'WH', x: 680, y: 140 },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));

    // Arm from the workspace's stock-out row...
    fireEvent.click(portRowOf(nodeAt(1), 'right', 0));
    expect(previewLine()).not.toBeNull();

    // ...then click another OUTPUT row while a connection is in flight.
    // An output is never a legal target, so the incompatible guard fires:
    // the in-flight attempt is canceled (no wire committed) and a toast
    // explains why. A fresh attempt must be begun from a port on the
    // SOURCE node (same-node clicks also cancel).
    fireEvent.click(portRowOf(nodeAt(0), 'right', 0));
    expect(getWireCount()).toBe(0);
    expect(previewLine()).toBeNull();
    expect(screen.getByText('These connectors cannot be connected.')).toBeInTheDocument();
  });


  it('Escape cancels an in-flight connection without creating a wire', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
        { id: 'ws-a', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-1', type: 'warehouse', name: 'WH', x: 680, y: 140 },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));

    // Arm a connection from the workspace's stock-out row.
    fireEvent.click(portRowOf(nodeAt(1), 'right', 0));
    expect(previewLine()).not.toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(previewLine()).toBeNull();
    expect(getWireCount()).toBe(0);
  });

  it('clamps the connection preview line to the viewport edge', async () => {
    // The preview line (ghost) should stay within the visible canvas.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
        { id: 'ws-a', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-1', type: 'warehouse', name: 'WH', x: -80, y: -100 },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));

    // Arm a connection from the workspace's stock-out row.
    fireEvent.click(portRowOf(nodeAt(1), 'right', 0));
    expect(previewLine()).not.toBeNull();
  });

  it('does not over-clamp a connection whose target is well inside the canvas', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
        { id: 'ws-a', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-1', type: 'warehouse', name: 'WH', x: 300, y: 140 },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));
    mockCanvasSize(1200, 800);

    // Arm a connection from the workspace's stock-out row.
    fireEvent.click(portRowOf(nodeAt(1), 'right', 0));
    expect(previewLine()).not.toBeNull();
  });

  it('rejects a workspace-to-workspace connection (untyped pair) with an incompatible toast', () => {
    renderEditor();
    // Add a second workspace via the tool rack so a workspace output can
    // target a workspace input.
    fireEvent.click(screen.getByText('+ Retail POS'));
    const newWs = nodeAt(3);
    fireEvent.click(portOf(nodeAt(1), 'right'));
    fireEvent.click(portOf(newWs, 'left'));
    // The drop was rejected: no wire was created and a toast explains why.
    expect(getWireCount()).toBe(2);
    expect(screen.getByText('These connectors cannot be connected.')).toBeInTheDocument();
  });

  it('treats a Branch Location to warehouse drop as the primary Location connection', () => {
    renderEditor();
    fireEvent.click(portOf(nodeAt(0), 'right'));
    fireEvent.click(portOf(nodeAt(2), 'left'));
    // The retail preset already contains the warehouse's primary Operation
    // scope, so a Location attempt is rejected as a second primary input.
    expect(getWireCount()).toBe(2);
    expect(screen.getByText('This Warehouse can have only one primary connection: Location or Retail POS Operation.')).toBeInTheDocument();
  });

  it('highlights only compatible target sockets while connecting', () => {
    renderEditor();
    mockCanvasSize(1200, 800);
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    // Arm a connection from the store's location-out row (right, index 0).
    fireEvent.click(portRowOf(nodeAt(0), 'right', 0));
    // Hover the workspace's left socket (location-in, row 0): compatible → highlight.
    // ws-1 at (380, 80); portRowCenterY(ws, 0) = 48 + 157 + 10 = 215 → y=295.
    fireEvent.mouseMove(canvas, { clientX: 380, clientY: 295 });
    const wsLeft = portRowOf(nodeAt(1), 'left', 0);
    expect(wsLeft.className).toContain('port-highlight');
    // The warehouse's left socket (location-in, row 0) is also compatible.
    // wh-1 at (680, 140); portRowCenterY(wh, 0) = 48 + 85 + 10 = 143 → y=283.
    fireEvent.mouseMove(canvas, { clientX: 680, clientY: 283 });
    const whLeft = portRowOf(nodeAt(2), 'left', 0);
    expect(whLeft.className).toContain('port-highlight');
  });

  // ── Live validation badges (ADR #34 slice 2) ───────────────────
  // The Apply gate already runs validateTopologyGraph; these badges
  // surface the SAME semantic errors live on the canvas — per-node notes
  // on the offending cards and a banner for graph-level problems — so a
  // user sees what is wrong while editing, not only when Apply toasts.
  // Canonical store identities (store_profile_id) opt the canvas into the
  // strict validation the real topology screen uses.

  it('badges a workspace that is missing its Location In connection', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-a', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));

    // The offending workspace card carries the note; the store card is clean.
    expect(within(nodeAt(1)).getByText('Connect this workspace to a Branch Location using Location In.')).toBeInTheDocument();
    expect(nodeAt(0).querySelector('.node-validation-note')).toBeNull();
    // No graph-level problem → no banner.
    expect(document.querySelector('.topology-validation-banner')).toBeNull();
  });

  it('clears the badge live once the Location In wire is created', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-a', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));
    expect(within(nodeAt(1)).getByText('Connect this workspace to a Branch Location using Location In.')).toBeInTheDocument();

    // Author the missing location wire — the badge must vanish without Apply.
    fireEvent.click(portOf(nodeAt(0), 'right'));
    fireEvent.click(portOf(nodeAt(1), 'left'));
    expect(getWireCount()).toBe(1);
    await waitFor(() => expect(nodeAt(1).querySelector('.node-validation-note')).toBeNull());
  });

  it('shows a canvas banner when multiple Branch Location roots exist', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch A', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'store-2', type: 'store', name: 'Branch B', x: 80, y: 400, store_profile_id: 'store-2' },
        { id: 'ws-a', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [
        { id: 'w-1', from_node_id: 'store-1', from_port: 'right', to_node_id: 'ws-a', to_port: 'left', direction: 'one-way' },
      ],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));
    // Node-scoped error (never a banner): the message rides the card's
    // sr span + portal tooltip — tolerate both copies.
    expect(screen.getAllByText('Keep exactly one Branch Location node in this graph.').length).toBeGreaterThanOrEqual(1);
  });

  it('shows a canvas banner when no Branch Location root exists', async () => {
    // The real topology screen runs strict validation (allowLegacyApply=false),
    // so a branch-less canvas is a genuine error there, not a legacy demo.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'ws-a', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [],
    } as never);
    renderEditor({ allowLegacyApply: false });
    await waitFor(() => expect(getNodeCount()).toBe(1));
    // Graph-level error → banner; the orphaned workspace also gets its
    // own missing-Location badge.
    expect(screen.getByText('Add exactly one Branch Location node.')).toBeInTheDocument();
    expect(within(nodeAt(0)).getByText('Connect this workspace to a Branch Location using Location In.')).toBeInTheDocument();
  });

  it('cannot clear the multiple-branch banner by deleting a Branch Location (permanent anchors)', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch A', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'store-2', type: 'store', name: 'Branch B', x: 80, y: 400, store_profile_id: 'store-2' },
        { id: 'ws-a', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [
        { id: 'w-1', from_node_id: 'store-1', from_port: 'right', to_node_id: 'ws-a', to_port: 'left', direction: 'one-way' },
      ],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));
    expect(screen.getAllByText('Keep exactly one Branch Location node in this graph.').length).toBeGreaterThanOrEqual(1);

    // Branch Location nodes are permanent anchors — the Delete action is a
    // no-op for them, so the graph stays invalid and the error persists.
    fireEvent.mouseDown(nodeAt(1), { button: 0 });
    openRackPanel('edit'); fireEvent.click(screen.getByText('Delete Selected Element'));
    expect(getNodeCount()).toBe(3);

    // The error stays live — the extra branch cannot be deleted away.
    expect(screen.queryAllByText('Keep exactly one Branch Location node in this graph.').length).toBeGreaterThanOrEqual(1);
  });

  it('shows a canvas banner for a wire referencing a ghost node', async () => {
    // The legacy load path keeps wires verbatim, so a corrupt saved wire
    // pointing at a missing node survives into the canvas — the banner
    // surfaces the integrity error live instead of only blocking Apply.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-a', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [
        { id: 'w-ghost', from_node_id: 'store-1', from_port: 'right', to_node_id: 'nope-ghost', to_port: 'left', direction: 'one-way' },
      ],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));
    expect(screen.getByText('This wire references a node that is not in the graph.')).toBeInTheDocument();
  });

  it('badges a workspace fed by two Location wires (multiple inputs)', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch A', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'store-2', type: 'store', name: 'Branch B', x: 80, y: 400, store_profile_id: 'store-2' },
        { id: 'ws-a', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [
        { id: 'w-1', from_node_id: 'store-1', from_port: 'right', to_node_id: 'ws-a', to_port: 'left', direction: 'one-way' },
        { id: 'w-2', from_node_id: 'store-2', from_port: 'right', to_node_id: 'ws-a', to_port: 'left', direction: 'one-way' },
      ],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));
    expect(within(nodeAt(2)).getByText('A workspace can have only one Location In wire.')).toBeInTheDocument();
  });

  it('badges a workspace whose purpose does not match its type', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-kds', type: 'workspace', name: 'KDS', x: 380, y: 140, metadata: { typeKey: 'kds', purposeKey: 'checkout' } },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));
    expect(within(nodeAt(1)).getByText('This workspace purpose is not supported by its technical type.')).toBeInTheDocument();
  });

  it('leaves legacy (non-canonical) canvases badge-free, mirroring the Apply gate', () => {
    // The retail preset's store node carries no store_profile_id, so the
    // editor treats it like the legacy/demo path: strict validation is
    // gated off at Apply, and the live badges must agree.
    renderEditor();
    expect(document.querySelector('.node-validation-note')).toBeNull();
    expect(document.querySelector('.topology-validation-banner')).toBeNull();
  });

  it('renders legacy vertical wire ports on canonical left/right sides', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
        { id: 'ws-1', type: 'workspace', name: 'POS', x: 340, y: 80 },
      ],
      wires: [{ id: 'legacy-wire', from_node_id: 'store-1', from_port: 'top', to_node_id: 'ws-1', to_port: 'bottom', direction: 'one-way' }],
    } as never);
    renderEditor();

    await waitFor(() => expect(getWireCount()).toBe(1));
    expect(portOf(nodeAt(0), 'right')).not.toBeNull();
    expect(portOf(nodeAt(0), 'top')).toBeNull();
    expect(portOf(nodeAt(1), 'left')).not.toBeNull();
    expect(portOf(nodeAt(1), 'bottom')).toBeNull();
  });



  // ── Load persisted topology on mount ──────────────────────────

  it('loads persisted topology on mount when data exists', async () => {
    mockLoadTopology.mockResolvedValue({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Loaded Store', x: 100, y: 200 },
        { id: 'ws-1', type: 'workspace', name: 'Loaded POS', x: 300, y: 100 },
      ],
      wires: [{ id: 'w-1', from_node_id: 'store-1', to_node_id: 'ws-1', direction: 'one-way' }],
    });

    renderEditor();

    await waitFor(() => {
      expect(screen.getByText('Loaded Store')).toBeInTheDocument();
      expect(screen.getByText('Loaded POS')).toBeInTheDocument();
    });
  });

  it('falls back to retail preset when loadTopology returns null', async () => {
    mockLoadTopology.mockResolvedValue(null);

    renderEditor();

    await waitFor(() => {
      expect(mockLoadTopology).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText('Downtown Branch')).toBeInTheDocument();
  });

  it('falls back to retail preset when loadTopology returns empty nodes', async () => {
    mockLoadTopology.mockResolvedValue({ nodes: [], wires: [] });

    renderEditor();

    await waitFor(() => {
      expect(mockLoadTopology).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText('Downtown Branch')).toBeInTheDocument();
  });

  it('surfaces a load failure via toast + onLoadError and keeps the preset canvas', async () => {
    // Characterization for the load lifecycle boundary (Phase 3.1): a
    // THROWN load error (corrupt DB, serialisation failure — distinct from
    // the expected null result above) must (1) toast the localized
    // load-error category with the USER-SAFE fallback copy appended (the
    // ERR-06 policy: raw backend messages never render), (2) notify the
    // parent with the ORIGINAL error through onLoadError (TopologyScreen
    // drops canSave in response and logs the raw detail), and (3) leave
    // the canvas untouched — a failed load must never wipe or half-replace
    // the rendered graph.
    mockLoadTopology.mockRejectedValueOnce(new Error('corrupt topology'));
    const onLoadError = vi.fn();

    renderEditor({ onLoadError });

    await waitFor(() => expect(onLoadError).toHaveBeenCalledTimes(1));
    expect(onLoadError).toHaveBeenCalledWith(expect.any(Error));
    // The toast carries the localized category AND the user-safe fallback
    // copy — never the raw backend message.
    expect(await screen.findByText(/Failed to load topology/)).toBeInTheDocument();
    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
    expect(screen.queryByText(/corrupt topology/)).not.toBeInTheDocument();
    // The canvas is untouched: the seed graph is still rendered.
    expect(screen.getByText('Downtown Branch')).toBeInTheDocument();
    expect(screen.getByText('Retail POS #1')).toBeInTheDocument();
    expect(screen.getByText('Main Warehouse')).toBeInTheDocument();
  });

  // ── Save topology ─────────────────────────────────────────────

  it('disables Apply and shows the view-only note when canSave=false', async () => {
    const onSave = vi.fn();
    renderEditor({ onSave, canSave: false });

    const applyBtn = screen.getByText('Apply Topology');
    expect(applyBtn).toBeDisabled();
    expect(screen.getByText(/View-only/)).toBeInTheDocument();

    // A disabled button never fires the save path.
    fireEvent.click(applyBtn);
    await new Promise((r) => setTimeout(r, 50));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('enables Apply by default (canSave=true)', async () => {
    renderEditor({ onSave: vi.fn() });
    expect(screen.getByText('Apply Topology')).not.toBeDisabled();
  });

  it('delegates the Apply payload when Apply Topology is clicked', async () => {
    const onSave = vi.fn();
    renderEditor({ onSave });

    await applyWithPin();

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    const [nodes, wires] = onSave.mock.calls[0]!;
    expect(nodes).toHaveLength(3);
    expect(wires).toHaveLength(2);
    expect(nodes[0].id).toBe('store-1');
    expect(nodes[0].name).toBe('Downtown Branch');
  });

  it('passes all node fields through onSave', async () => {
    const onSave = vi.fn();
    renderEditor({ onSave });

    await applyWithPin();

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    const [nodes] = onSave.mock.calls[0]!;
    const storeNode = nodes.find((n: { id: string }) => n.id === 'store-1');
    expect(storeNode).toBeDefined();
    expect(storeNode.name).toBe('Downtown Branch');
    expect(storeNode.subtitle).toBe('Primary Store');
    expect(storeNode.telemetryBadge).toBe('Online (2 POS)');
    expect(storeNode.telemetryStatus).toBe('online');
    expect(storeNode.x).toBe(80);
    expect(storeNode.y).toBe(140);
  });

  // ── Add node ────────────────────────────────────────────────────

  it('adds a new store node when tool rack button clicked', () => {
    renderEditor();

    const initialCount = getNodeCount();

    fireEvent.click(screen.getByText('+ Store Node'));

    expect(getNodeCount()).toBe(initialCount + 1);
    // The spawned node is auto-selected, so the inspector header shows the
    // same name — the card title AND the inspector h3 both match.
    expect(screen.getAllByText('New Store').length).toBeGreaterThanOrEqual(1);
  });

  it('adds a new hardware node when tool rack button clicked', () => {
    renderEditor();

    fireEvent.click(screen.getByText('+ Hardware Node'));

    expect(screen.getAllByText('New Hardware').length).toBeGreaterThanOrEqual(1);
  });

  // ── Spawn placement (P3): no stacking, no off-screen spawns ──────

  describe('palette spawn placement', () => {
    afterEach(() => localStorage.removeItem('oz-topology-viewport:unassigned'));

    it('spawns new nodes without overlapping the preset or each other', () => {
      renderEditor();
      mockCanvasSize(1200, 900);

      fireEvent.click(screen.getByText('+ Store Node'));
      fireEvent.click(screen.getByText('+ Store Node'));

      // Canvas node order is preset (3) then appended spawns (2).
      const boxes = [...document.querySelectorAll('.topology-node')].map((el) => {
        const n = el as HTMLElement;
        return { x: parseFloat(n.style.left), y: parseFloat(n.style.top) };
      });
      expect(boxes).toHaveLength(5);
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          const overlap = a.x < b.x + NODE_WIDTH && a.x + NODE_WIDTH > b.x
            && a.y < b.y + NODE_HEIGHT && a.y + NODE_HEIGHT > b.y;
          expect(overlap, `nodes ${i} and ${j} overlap`).toBe(false);
        }
      }
    });

    it('pans the viewport so a palette spawn is visible after a panned-away view', () => {
      // Restore a view panned far off the diagram (e.g. after a branch
      // switch): the origin jitter spot is completely off a 800×600 canvas.
      localStorage.setItem('oz-topology-viewport:unassigned', JSON.stringify({ zoom: 1, pan: { x: 3000, y: 3000 } }));
      renderEditor();
      mockCanvasSize(800, 600);

      fireEvent.click(screen.getByText('+ Store Node'));

      const vp = document.querySelector('.node-canvas-viewport') as HTMLElement;
      const m = vp.style.transform.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/);
      expect(m).not.toBeNull();
      const panX = parseFloat(m![1]!);
      const panY = parseFloat(m![2]!);
      const zoom = parseFloat(m![3]!);

      // The view must have MOVED to reveal the fresh node — the seeded
      // far-away pan is gone (auto-scroll, not a clamp-only pin at the edge).
      expect(vp.style.transform).not.toContain('translate(3000px, 3000px)');

      const el = nodeAt(3) as HTMLElement;
      const sx = panX + parseFloat(el.style.left) * zoom;
      const sy = panY + parseFloat(el.style.top) * zoom;
      // Node box intersects the 800×600 viewport with ≥40px edge margin.
      expect(sx + NODE_WIDTH > 40 && sx < 800 - 40).toBe(true);
      expect(sy + NODE_HEIGHT > 40 && sy < 600 - 40).toBe(true);
    });

    it('clamps a context-menu spawn at the canvas edge into view', () => {
      renderEditor();
      mockCanvasSize(800, 600);
      const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

      // Right-click at the far right edge (identity transform → canvas
      // coords equal screen coords): the 240px node would extend off-canvas.
      fireEvent.contextMenu(canvas, { clientX: 790, clientY: 300 });
      fireEvent.click(screen.getByText('New Hardware'));

      const last = [...document.querySelectorAll('.topology-node')].pop() as HTMLElement;
      expect(last.className).toContain('node-type-hardware');
      const x = parseFloat(last.style.left);
      expect(x).toBeLessThanOrEqual(800 - 40); // clamped inside the east margin
      expect(x + NODE_WIDTH).toBeGreaterThan(40); // and past the west margin
    });
  });

  // ── Node-card a11y (P3): selection state + Space activation ─────

  it('never exposes aria-selected on node cards (role=group does not support it — axe critical)', () => {
    // role=group carries no selection state; aria-selected on it is an
    // aria-allowed-attr violation (caught by the a11y suite). Selection
    // reaches screen readers through the canvas live region instead
    // (see "accessible live announcements"). This pins the absence so a
    // future restore of the illegal attribute fails here AND in axe.
    renderEditor();

    const cards = document.querySelectorAll('.topology-node');
    expect(cards[0]!.getAttribute('aria-selected')).toBeNull();
    expect(cards[1]!.getAttribute('aria-selected')).toBeNull();

    selectFirstNode();
    expect(cards[0]!.getAttribute('aria-selected')).toBeNull();
    expect(cards[0]!.className).toContain('node-selected');
    expect(cards[1]!.className).not.toContain('node-selected');
  });

  it('Space selects the focused card and prevents page scroll', () => {
    renderEditor();

    const card = document.querySelector('.topology-node') as HTMLElement;
    card.focus();
    const preventDefault = vi.spyOn(KeyboardEvent.prototype, 'preventDefault');
    try {
      fireEvent.keyDown(card, { key: ' ' });
    } finally {
      preventDefault.mockRestore();
    }
    expect(card.className).toContain('node-selected');
    // Selection is announced via the live region, not aria-selected.
    expect(card.getAttribute('aria-selected')).toBeNull();
  });

  // ── Workspace rename persistence (P3): body + inspector commit ──

  describe('rename persistence via the parent callbacks (body + inspector)', () => {
    it('commits a body-config rename through onRenameWorkspace on blur', async () => {
      const onRenameWorkspace = vi.fn().mockResolvedValue(true);
      renderEditor({ onRenameWorkspace });

      const input = document.querySelector('.node-config-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'Body Renamed POS' } });
      fireEvent.blur(input);

      await waitFor(() => expect(onRenameWorkspace).toHaveBeenCalledWith('ws-1', 'Body Renamed POS'));
    });

    it('commits a body-config rename on Enter', async () => {
      const onRenameWorkspace = vi.fn().mockResolvedValue(true);
      renderEditor({ onRenameWorkspace });

      const input = document.querySelector('.node-config-input') as HTMLInputElement;
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'Enter Renamed POS' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => expect(onRenameWorkspace).toHaveBeenCalledWith('ws-1', 'Enter Renamed POS'));
    });

    it('commits an inspector rename of a workspace through onRenameWorkspace on blur', async () => {
      const onRenameWorkspace = vi.fn().mockResolvedValue(true);
      renderEditor({ onRenameWorkspace });

      // The retail preset's workspace card is the second node on canvas.
      fireEvent.mouseDown(nodeAt(1), { button: 0 });
      const nameInput = document.querySelector('.inspector-field input[type="text"]') as HTMLInputElement;
      expect(nameInput.value).toBe('Retail POS #1');
      fireEvent.change(nameInput, { target: { value: 'Inspector Renamed POS' } });
      fireEvent.blur(nameInput);

      await waitFor(() => expect(onRenameWorkspace).toHaveBeenCalledWith('ws-1', 'Inspector Renamed POS'));
    });

    it('commits an inspector rename of the branch through onRenameBranch on blur', async () => {
      const onRenameBranch = vi.fn().mockResolvedValue(true);
      renderEditor({ onRenameBranch });

      fireEvent.mouseDown(nodeAt(0), { button: 0 });
      const nameInput = document.querySelector('.inspector-field input[type="text"]') as HTMLInputElement;
      expect(nameInput.value).toBe('Downtown Branch');
      fireEvent.change(nameInput, { target: { value: 'Inspector Renamed Branch' } });
      fireEvent.blur(nameInput);

      await waitFor(() => expect(onRenameBranch).toHaveBeenCalledWith('store-1', 'Inspector Renamed Branch'));
    });

    it('reverts the card label when the parent REJECTS a body-config rename', async () => {
      // The parent returns false (it toasts the error) — the canvas must not
      // keep holding a name the backend refused, or the next authoritative
      // refresh would silently revert it. commitNodeRename keeps its draft
      // open for retry; a blurred input has no draft, so the honest state is
      // the focus-time (authoritative) name.
      const onRenameWorkspace = vi.fn().mockResolvedValue(false);
      renderEditor({ onRenameWorkspace });
      const card = document.querySelector('.topology-node[data-node-id="ws-1"]') as HTMLElement;
      const title = () => card.querySelector('.node-title')?.textContent;
      expect(title()).toBe('Retail POS #1');

      const input = document.querySelector('.node-config-input') as HTMLInputElement;
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'Rejected POS' } });
      // Live-bound input updates the card as you type.
      expect(title()).toBe('Rejected POS');
      fireEvent.blur(input);

      await waitFor(() => expect(onRenameWorkspace).toHaveBeenCalledWith('ws-1', 'Rejected POS'));
      await waitFor(() => expect(title()).toBe('Retail POS #1'));
    });

    it('keeps the new label when the parent ACCEPTS a body-config rename', async () => {
      const onRenameWorkspace = vi.fn().mockResolvedValue(true);
      renderEditor({ onRenameWorkspace });
      const card = document.querySelector('.topology-node[data-node-id="ws-1"]') as HTMLElement;
      const title = () => card.querySelector('.node-title')?.textContent;

      const input = document.querySelector('.node-config-input') as HTMLInputElement;
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'Accepted POS' } });
      fireEvent.blur(input);

      await waitFor(() => expect(onRenameWorkspace).toHaveBeenCalledWith('ws-1', 'Accepted POS'));
      expect(title()).toBe('Accepted POS');
    });
  });

  // ── Warehouse tier Apply gate (P1 slice 2) ─────────────────────

  describe('warehouse tier Apply gate', () => {
    const twoWarehouseDiagram = {
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-1', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-1', type: 'warehouse', name: 'WH 1', x: 680, y: 140 },
        { id: 'wh-2', type: 'warehouse', name: 'WH 2', x: 680, y: 400 },
      ],
      wires: [
        { id: 'w-1', from_node_id: 'store-1', to_node_id: 'ws-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-scope-1', from_node_id: 'store-1', to_node_id: 'wh-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-scope-2', from_node_id: 'store-1', to_node_id: 'wh-2', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
      ],
    } as never;

    it('flags two warehouses on a standard-tier diagram via the live banner', async () => {
      mockLoadTopology.mockResolvedValueOnce(twoWarehouseDiagram);
      renderEditor();
      await waitFor(() => expect(getNodeCount()).toBe(4));

      expect(screen.getAllByText('Multiple Warehouses require a Pro Tier license.').length).toBeGreaterThanOrEqual(1);
    });

    it('blocks Apply for two warehouses on standard tier without calling onSave', async () => {
      mockLoadTopology.mockResolvedValueOnce(twoWarehouseDiagram);
      const onSave = vi.fn();
      renderEditor({ onSave });
      await waitFor(() => expect(getNodeCount()).toBe(4));

      fireEvent.click(screen.getByText('Apply Topology'));

      // The Apply gate opens the issues panel (so the user sees EVERY
      // blocking issue at once) and toasts a block summary instead of a
      // single error message.
      await waitFor(() =>
        expect(screen.getByText('Apply blocked — 1 issue(s) to fix in the panel')).toBeInTheDocument());
      expect(document.querySelector('.topology-validation-panel')).not.toBeNull();
      expect(onSave).not.toHaveBeenCalled();
    });

    it('allows two warehouses on a Pro-tier diagram', async () => {
      mockLoadTopology.mockResolvedValueOnce(twoWarehouseDiagram);
      const onSave = vi.fn();
      renderEditor({ currentTier: 'pro', onSave });
      await waitFor(() => expect(getNodeCount()).toBe(4));

      await applyWithPin();
      await waitFor(() => expect(onSave).toHaveBeenCalled());
    });

    it('allows two warehouses on a Premium-tier diagram (Pro-equivalent)', async () => {
      // Regression: the editor's Pro set was ['pro', 'enterprise'] and the
      // screen's tier union omitted 'premium', so a Premium install saw the
      // standard-tier warehouse-tier-limit banner and Apply gate even though
      // the backend treats Premium as an unlimited-warehouse tier.
      mockLoadTopology.mockResolvedValueOnce(twoWarehouseDiagram);
      const onSave = vi.fn();
      renderEditor({ currentTier: 'premium', onSave });
      await waitFor(() => expect(getNodeCount()).toBe(4));

      expect(screen.queryByText('Multiple Warehouses require a Pro Tier license.')).toBeNull();

      await applyWithPin();
      await waitFor(() => expect(onSave).toHaveBeenCalled());
    });
  });

  // ── Store spawn in strict mode (P1/P2) ─────────────────────────

  describe('store spawn in strict mode', () => {
    it('hides the Store palette slot in strict mode', () => {
      renderEditor({ allowLegacyApply: false });

      expect(screen.queryByText('+ Store Node')).toBeNull();
      expect(screen.getByText('+ Retail POS')).toBeInTheDocument();
    });

    it('keeps the Store palette slot in legacy mode', () => {
      renderEditor();

      expect(screen.getByText('+ Store Node')).toBeInTheDocument();
    });

    it('omits the store entry from the strict-mode context menu', () => {
      renderEditor({ allowLegacyApply: false });

      fireEvent.contextMenu(document.querySelector('.node-canvas-container')!, { clientX: 100, clientY: 100 });
      expect(screen.queryByText('New Store')).toBeNull();
      expect(screen.getByText('New Workspace')).toBeInTheDocument();
    });

    it('ignores the 1 key in strict mode', () => {
      renderEditor({ allowLegacyApply: false });

      const before = getNodeCount();
      fireEvent.keyDown(document.querySelector('.node-canvas-container')!, { key: '1' });
      expect(getNodeCount()).toBe(before);
    });
  });

  it('prevents adding second warehouse on standard tier', () => {
    renderEditor();

    fireEvent.click(screen.getByText('+ Warehouse'));
    fireEvent.click(screen.getByText('+ Warehouse'));

    const warningToasts = screen.queryAllByText(
      'Multiple Warehouses require a Pro Tier license.',
    );
    expect(warningToasts.length).toBeGreaterThanOrEqual(1);
  });

  // ── Delete node ─────────────────────────────────────────────────

  it('deletes a node without wires immediately', async () => {
    renderEditor();

    // Add a new node (no wires connected) then delete it. Hardware is a
    // deletable type — Branch Locations are permanent anchors.
    fireEvent.click(screen.getByText('+ Hardware Node'));
    await waitFor(() => {
      // The spawned node is auto-selected, so the inspector header also
      // shows the name — the card title AND the inspector h3 both match.
      expect(screen.getAllByText('New Hardware').length).toBeGreaterThanOrEqual(1);
    });

    // Select the new node (last one in the DOM)
    const nodes = document.querySelectorAll('.topology-node');
    const newNode = nodes[nodes.length - 1];
    fireEvent.mouseDown(newNode as Element, { button: 0 });

    openRackPanel('edit'); const deleteBtn = screen.getByText('Delete Selected Element');
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(screen.queryByText('New Hardware')).not.toBeInTheDocument();
    });
  });

  it('shows confirmation dialog when deleting node with wires', () => {
    renderEditor();

    // ws-1 (Retail POS #1) is wired and NOT a Branch Location anchor, so it
    // is deletable and opens the confirm dialog.
    const wired = document.querySelector('.node-type-workspace') as HTMLElement;
    fireEvent.mouseDown(wired, { button: 0 });

    expect(screen.queryByText('Delete Node')).not.toBeInTheDocument();

    openRackPanel('edit'); const deleteBtn = screen.getByText('Delete Selected Element');
    fireEvent.click(deleteBtn);

    expect(screen.getByText('Delete Node')).toBeInTheDocument();
    expect(
      screen.getByText(/This node has connected wires/),
    ).toBeInTheDocument();
  });

  // ── Undo ────────────────────────────────────────────────────────

  it('shows Undo button after making changes', () => {
    renderEditor();

    fireEvent.click(screen.getByText('+ Store Node'));

    openRackPanel('edit'); expect(screen.getByText('Undo (Ctrl+Z)')).toBeInTheDocument();
  });

  it('restores previous state on undo', () => {
    renderEditor();

    const initialCount = getNodeCount();

    fireEvent.click(screen.getByText('+ Store Node'));
    expect(getNodeCount()).toBe(initialCount + 1);

    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));

    expect(getNodeCount()).toBe(initialCount);
  });

  // ── Wire deletion undo (#2) ─────────────────────────────────────

  it('restores deleted wire on undo', () => {
    renderEditor();

    // Retail preset has 2 wires
    const initialWireCount = getWireCount();
    expect(initialWireCount).toBe(2);

    // Click a wire hitbox to select the wire (hitting the label text
    // only toggles direction — it doesn't set selectedWireId)
    const hitbox = document.querySelector('.wire-hitbox');
    expect(hitbox).not.toBeNull();
    fireEvent.click(hitbox!);

    openRackPanel('edit'); const deleteBtn = screen.getByText('Delete Selected Element');
    fireEvent.click(deleteBtn);

    // Confirm the wire deletion dialog
    const confirmDeleteBtn = screen.getByText('Delete');
    fireEvent.click(confirmDeleteBtn);

    expect(getWireCount()).toBe(initialWireCount - 1);

    // Undo should restore the wire
    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));

    expect(getWireCount()).toBe(initialWireCount);
  });

  // ── Click-to-select must not pollute undo/dirty state (#11) ───────

  it('does not enable Undo when a node is merely clicked (no drag)', () => {
    renderEditor();

    const firstNode = document.querySelector('.topology-node');
    expect(firstNode).not.toBeNull();

    // Plain click: mousedown + mouseup with zero movement. Selecting a
    // node is not an edit, so it must not push an undo entry.
    fireEvent.mouseDown(firstNode as Element, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseUp(firstNode as Element, { button: 0, clientX: 0, clientY: 0 });

    expect(screen.queryByText('Undo (Ctrl+Z)')).not.toBeInTheDocument();
  });


  it('enables Undo only after an actual drag and restores the position on undo', () => {
    renderEditor();

    const firstNode = document.querySelector('.topology-node') as HTMLElement;
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    expect(firstNode).not.toBeNull();
    expect(canvas).not.toBeNull();

    // Retail preset: store-1 at (80, 140), snapped to the 24px grid.
    expect(firstNode.style.left).toBe('80px');
    expect(firstNode.style.top).toBe('140px');

    // mousedown at clientX/Y 0, then drag 48px right + 48px down.
    // newX = snap(0 - (0 - 80)) = snap(128) = 120; newY = snap(188) = 192.
    fireEvent.mouseDown(firstNode, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 48, clientY: 48 });

    openRackPanel('edit'); expect(screen.getByText('Undo (Ctrl+Z)')).toBeInTheDocument();
    expect(firstNode.style.left).toBe('120px');
    expect(firstNode.style.top).toBe('192px');

    fireEvent.mouseUp(canvas, { button: 0 });
    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));

    expect(firstNode.style.left).toBe('80px');
    expect(firstNode.style.top).toBe('140px');
  });

  // ── Drag released outside the canvas must cancel (#13) ───────────

  it('cancels the node drag when the pointer is released outside the canvas', () => {
    renderEditor();

    const firstNode = document.querySelector('.topology-node') as HTMLElement;
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    expect(firstNode).not.toBeNull();
    expect(canvas).not.toBeNull();
    expect(firstNode.style.left).toBe('80px');
    expect(firstNode.style.top).toBe('140px');

    // mousedown then drag 48px right + down, as in the normal drag test.
    fireEvent.mouseDown(firstNode, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 48, clientY: 48 });
    expect(firstNode.style.left).toBe('120px');
    expect(firstNode.style.top).toBe('192px');

    // Release OUTSIDE the canvas (document-level mouseup never reaches
    // the canvas onMouseUp handler). The drag must be cancelled.
    fireEvent.mouseUp(document, { button: 0 });

    // Further mousemoves over the canvas must NOT move the node — no
    // button is held and no ghost drag may follow the cursor.
    fireEvent.mouseMove(canvas, { clientX: 96, clientY: 96 });
    fireEvent.mouseMove(canvas, { clientX: 144, clientY: 144 });

    expect(firstNode.style.left).toBe('120px');
    expect(firstNode.style.top).toBe('192px');
  });

  // ── Dynamic edge clamp: north/west freedom past the old 20px floor ──

  it('lets a node drag freely north/west to the viewport edge (not the 20px floor)', () => {
    renderEditor();

    const firstNode = document.querySelector('.topology-node') as HTMLElement;
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    expect(firstNode).not.toBeNull();
    expect(canvas).not.toBeNull();
    // Lay the canvas out so the clamp has a real viewport to honour.
    mockCanvasSize(800, 600);
    expect(firstNode.style.left).toBe('80px');
    expect(firstNode.style.top).toBe('140px');

    // mousedown at clientX/Y 0 → dragOffset = (0 - 80, 0 - 140).
    fireEvent.mouseDown(firstNode, { button: 0, clientX: 0, clientY: 0 });

    // Drag far north-west: raw = (-320, -260) → clamped to the viewport
    // edge (-200, -200) → snapped (-192, -192). The old 20px floor would
    // have parked the node at (24, 24).
    fireEvent.mouseMove(canvas, { clientX: -400, clientY: -400 });
    expect(firstNode.style.left).toBe('-192px');
    expect(firstNode.style.top).toBe('-192px');

    // Dragging even further must HOLD the node at the edge — the clamp
    // guarantees a node can never be pushed off-canvas and lost.
    fireEvent.mouseMove(canvas, { clientX: -1000, clientY: -1000 });
    expect(firstNode.style.left).toBe('-192px');
    expect(firstNode.style.top).toBe('-192px');

    fireEvent.mouseUp(canvas, { button: 0 });
  });

  it('arrow keys respect the same viewport clamp as mouse dragging', () => {
    renderEditor();

    const firstNode = document.querySelector('.topology-node') as HTMLElement;
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    mockCanvasSize(800, 600);

    selectFirstNode();
    // Plain arrows with snap on move in full grid steps (24px), so every
    // press actually advances: 80 → 48 → 24 → 0 → -24 → … → clamps at
    // minX = -200, snapping to the grid bound -192.
    for (let i = 0; i < 15; i += 1) {
      fireEvent.keyDown(canvas, { key: 'ArrowLeft' });
    }
    expect(firstNode.style.left).toBe('-192px');

    // North: 140 → 120 → 96 → … → clamps at minY = -200,
    // snapping to the nearest grid position -192.
    for (let i = 0; i < 15; i += 1) {
      fireEvent.keyDown(canvas, { key: 'ArrowUp' });
    }
    expect(firstNode.style.top).toBe('-192px');
  });

  // ── clampNodeToViewport unit contract ────────────────────────────

  describe('clampNodeToViewport (view-relative edge clamp)', () => {
    it('at identity transform, the west/north bound keeps only the margin visible', () => {
    // 800×600 canvas, pan 0, zoom 1, default node 240×240, margin 40.
    expect(clampNodeToViewport(-320, -260, { panX: 0, panY: 0, zoom: 1, canvasW: 800, canvasH: 600 }))
      .toEqual({ x: -200, y: -200 });
    });

    it('keeps the node inside the east/south edges with the same margin', () => {
      expect(clampNodeToViewport(9999, 9999, { panX: 0, panY: 0, zoom: 1, canvasW: 800, canvasH: 600 }))
        .toEqual({ x: 760, y: 560 });
    });

    it('is pan-aware: panning extends the reachable west bound', () => {
      // Pan +200 shifts content right, so the canvas-space origin sits
      // further left: minX = (40 - 200) - 240 = -400.
      expect(clampNodeToViewport(-500, -260, { panX: 200, panY: 0, zoom: 1, canvasW: 800, canvasH: 600 }))
        .toEqual({ x: -400, y: -200 });
    });

    it('is zoom-aware: zooming out widens the reachable bounds', () => {
      // Margin is in screen px, so at zoom 0.5 the 40px margin becomes
      // 80 canvas px: minX = (40/0.5) - 240 = -160.
      expect(clampNodeToViewport(-320, -260, { panX: 0, panY: 0, zoom: 0.5, canvasW: 800, canvasH: 600 }))
        .toEqual({ x: -160, y: -160 });
    });

    it('returns the position unchanged when the canvas has no measured size', () => {
      // jsdom / pre-layout canvases report 0 — no viewport constraint exists.
      expect(clampNodeToViewport(120, 90, { panX: 0, panY: 0, zoom: 1, canvasW: 0, canvasH: 0 }))
        .toEqual({ x: 120, y: 90 });
    });
  });

  // ── findFreeSpawnSpot unit contract ─────────────────────────────

  describe('edgeAutoPanDelta (edge auto-pan math)', () => {
    it('returns no delta in the canvas middle', () => {
      expect(edgeAutoPanDelta(400, 300, 800, 600)).toEqual({ dx: 0, dy: 0 });
    });

    it('pans right, proportional to how deep the pointer sits in the right band', () => {
      // 800px wide, 48px band → band starts at 752. 16px in (of 48) is
      // one third of maxDelta (20) ≈ 6.67; at the very edge it's 20.
      const half = edgeAutoPanDelta(768, 300, 800, 600);
      expect(half.dx).toBeCloseTo(6.67, 2);
      expect(half.dy).toBe(0);
      const full = edgeAutoPanDelta(800, 300, 800, 600);
      expect(full.dx).toBe(20);
    });

    it('pans left/up/down from the other bands', () => {
      const left = edgeAutoPanDelta(16, 300, 800, 600);
      expect(left.dx).toBeCloseTo(-13.33, 2);
      expect(left.dy).toBe(0);
      const bottom = edgeAutoPanDelta(400, 590, 800, 600);
      expect(bottom.dx).toBe(0);
      expect(bottom.dy).toBeCloseTo(15.83, 2);
    });

    it('a corner pan goes both ways at once', () => {
      const corner = edgeAutoPanDelta(784, 8, 800, 600);
      expect(corner.dx).toBeGreaterThan(0);
      expect(corner.dy).toBeLessThan(0);
    });

    it('a pointer OUTSIDE the canvas produces no delta (drag holds at the clamp edge)', () => {
      expect(edgeAutoPanDelta(-400, 300, 800, 600)).toEqual({ dx: 0, dy: 0 });
      expect(edgeAutoPanDelta(810, 300, 800, 600)).toEqual({ dx: 0, dy: 0 });
    });
  });

  describe('findFreeSpawnSpot (collision-free spawn placement)', () => {
    it('returns the candidate unchanged when nothing overlaps it', () => {
      expect(findFreeSpawnSpot({ x: 120, y: 90 }, []))
        .toEqual({ x: 120, y: 90 });
    });

    it('steps outward to the first position clear of an occupied box', () => {
      // Candidate sits inside the occupied 240×240 box at (80, 140) plus
      // the 24px gap — the spiral must escape it.
      const free = findFreeSpawnSpot({ x: 100, y: 100 }, [{ x: 80, y: 140 }]);
      const overlapsOccupied = free.x < 80 + NODE_WIDTH + 24 && free.x + NODE_WIDTH + 24 > 80
        && free.y < 140 + NODE_HEIGHT + 24 && free.y + NODE_HEIGHT + 24 > 140;
      expect(free).not.toEqual({ x: 100, y: 100 });
      expect(overlapsOccupied).toBe(false);
    });

    it('escapes a dense wall of boxes within the bounded search', () => {
      // A 3×3 wall spanning 0..792 in both axes — the spiral must find a
      // clear cell despite starting inside it.
      const wall: { x: number; y: number }[] = [];
      for (let r = 0; r < 3; r += 1) {
        for (let c = 0; c < 3; c += 1) {
          wall.push({ x: c * (NODE_WIDTH + 24), y: r * (NODE_HEIGHT + 24) });
        }
      }
      const free = findFreeSpawnSpot({ x: 130, y: 130 }, wall);
      const clear = !wall.some((o) =>
        free.x < o.x + NODE_WIDTH + 24 && free.x + NODE_WIDTH + 24 > o.x
        && free.y < o.y + NODE_HEIGHT + 24 && free.y + NODE_HEIGHT + 24 > o.y);
      expect(clear).toBe(true);
    });
  });

  // ── Branch Location rename from the node card ───────────────────

  it('renames the branch from its card and closes the inline form', async () => {
    const onRenameBranch = vi.fn().mockResolvedValue(true);
    renderEditor({ onRenameBranch });

    // The retail preset's store card is the first node on canvas.
    const storeCard = document.querySelectorAll('.topology-node')[0] as HTMLElement;
    expect(storeCard.className).toContain('node-type-store');

    // Pencil → inline input pre-filled with the current name → Enter.
    fireEvent.click(within(storeCard).getByRole('button', { name: 'topology-branch-rename-label' }));
    const input = within(storeCard).getByLabelText('topology-branch-rename-placeholder');
    expect((input as HTMLInputElement).value).toBe('Downtown Branch');
    fireEvent.change(input, { target: { value: 'Main Street HQ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onRenameBranch).toHaveBeenCalledWith('store-1', 'Main Street HQ'));
    // On success the form closes and the card title reflects the new name.
    await waitFor(() => expect(within(storeCard).queryByLabelText('topology-branch-rename-placeholder')).toBeNull());
    await waitFor(() => expect(within(storeCard).getByText('Main Street HQ')).toBeTruthy());
    // A keyboard commit returns focus to the store card, not the canvas body.
    expect(document.activeElement).toBe(storeCard);
  });

  it('closes the rename form when the name is unchanged (no callback round-trip)', () => {
    const onRenameBranch = vi.fn();
    renderEditor({ onRenameBranch });

    const storeCard = document.querySelectorAll('.topology-node')[0] as HTMLElement;
    fireEvent.click(within(storeCard).getByRole('button', { name: 'topology-branch-rename-label' }));
    const input = within(storeCard).getByLabelText('topology-branch-rename-placeholder');
    // Enter without editing — the pre-filled draft equals the current name.
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRenameBranch).not.toHaveBeenCalled();
    expect(within(storeCard).queryByLabelText('topology-branch-rename-placeholder')).toBeNull();
    expect(within(storeCard).getByText('Downtown Branch')).toBeTruthy();
    // An unchanged-name Enter is still a keyboard close — focus returns to the card.
    expect(document.activeElement).toBe(storeCard);
  });

  it('Escape cancels the card rename without calling the callback', () => {
    const onRenameBranch = vi.fn();
    renderEditor({ onRenameBranch });

    const storeCard = document.querySelectorAll('.topology-node')[0] as HTMLElement;
    fireEvent.click(within(storeCard).getByRole('button', { name: 'topology-branch-rename-label' }));
    const input = within(storeCard).getByLabelText('topology-branch-rename-placeholder');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onRenameBranch).not.toHaveBeenCalled();
    expect(within(storeCard).queryByLabelText('topology-branch-rename-placeholder')).toBeNull();
    expect(within(storeCard).getByText('Downtown Branch')).toBeTruthy();
    // Escape is a keyboard close — focus returns to the store card.
    expect(document.activeElement).toBe(storeCard);
  });

  it('does not steal focus back when the rename commits via blur', async () => {
    // Click-away commits must NOT yank focus back to the card — the user
    // deliberately clicked elsewhere (e.g. the Apply button).
    const onRenameBranch = vi.fn().mockResolvedValue(true);
    renderEditor({ onRenameBranch });

    const storeCard = document.querySelectorAll('.topology-node')[0] as HTMLElement;
    fireEvent.click(within(storeCard).getByRole('button', { name: 'topology-branch-rename-label' }));
    const input = within(storeCard).getByLabelText('topology-branch-rename-placeholder');
    fireEvent.change(input, { target: { value: 'Blur Renamed' } });
    fireEvent.blur(input);

    await waitFor(() => expect(onRenameBranch).toHaveBeenCalledWith('store-1', 'Blur Renamed'));
    await waitFor(() => expect(within(storeCard).queryByLabelText('topology-branch-rename-placeholder')).toBeNull());
    expect(document.activeElement).not.toBe(storeCard);
  });

  /** Harness simulating the TopologyScreen parent deleting the LAST branch:
 *  both the branch list AND the workspace instances empty in one update —
 *  the instances-changed-wins case that lands in the full rebuild with a
 *  provided-but-empty branch list. */
function DeleteAllHarness() {
  const [instances, setInstances] = useState<WorkspaceInstanceSeed[]>(renameWsInstances);
  const [locations, setLocations] = useState<BranchLocationSeed[]>([
    { id: 'store-1', name: 'Downtown Branch' },
  ]);
  return (
    <>
      <button type="button" onClick={() => { setInstances([]); setLocations([]); }}>
        delete-all-branches
      </button>
      <NodeTopologyEditor
        currentTier="plus"
        workspaceInstances={instances}
        branchLocations={locations}
      />
    </>
  );
}

/** Harness simulating the TopologyScreen parent deleting a store profile:
 *  removing a branch swaps the branchLocations identity (the parent's
 *  stores-state update) WITHOUT touching workspace instances — the
 *  light-merge path must drop the deleted branch's card and wires. */
function BranchDeleteHarness() {
  const [locations, setLocations] = useState<BranchLocationSeed[]>([
    { id: 'store-1', name: 'Downtown Branch' },
    { id: 'store-2', name: 'Uptown Branch' },
  ]);
  return (
    <div>
      <button onClick={() => setLocations((prev) => prev.filter((l) => l.id !== 'store-1'))}>
        delete-store-1
      </button>
      <NodeTopologyEditor
        currentTier="plus"
        workspaceInstances={renameWsInstances}
        branchLocations={locations}
      />
    </div>
  );
}

// ── Branch rename must not clobber unsaved canvas edits ─────────

  it('keeps unsaved canvas edits when a branch rename refreshes branch locations', async () => {
    // The TopologyScreen parent reacts to a successful rename by updating
    // its stores state, which swaps the branchLocations identity the editor
    // receives. A full rebuild on that change would discard in-flight drags
    // and wires — the rename must merge the new name into the live canvas.
    renderWithProvidersSync(<BranchRenameHarness />, multiStoreFtl, sharedFtl);
    await waitFor(() => expect(document.querySelector('.node-canvas-container')).not.toBeNull());
    mockCanvasSize(800, 600);

    await waitFor(() => expect(screen.getByText('POS #1')).toBeInTheDocument());

    // Unsaved edit: drag the workspace node across the canvas.
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const wsCard = nodeAt(1);
    fireEvent.mouseDown(wsCard, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 200, clientY: 120 });
    fireEvent.mouseUp(canvas, { button: 0 });
    const draggedLeft = wsCard.style.left;
    const draggedTop = wsCard.style.top;
    expect(draggedLeft).not.toBe('336px'); // the drag actually moved it

    // Rename the branch through its card (name change → parent refreshes
    // branchLocations with a new identity).
    const storeCard = nodeAt(0);
    fireEvent.click(within(storeCard).getByRole('button', { name: 'topology-branch-rename-label' }));
    const input = within(storeCard).getByLabelText('topology-branch-rename-placeholder');
    fireEvent.change(input, { target: { value: 'Renamed HQ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // The rename propagated to the card title…
    await waitFor(() => expect(within(storeCard).getByText('Renamed HQ')).toBeTruthy());
    // …and the unsaved drag survived the branchLocations refresh.
    await waitFor(() => expect(wsCard.style.left).toBe(draggedLeft));
    expect(wsCard.style.top).toBe(draggedTop);
  });

  // ── Branch deletion: card + wires leave the canvas cleanly ─────

  it('removes a deleted branch location card and its wires (light merge)', async () => {
    mockLoadTopology.mockResolvedValue({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Downtown Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'store-2', type: 'store', name: 'Uptown Branch', x: 380, y: 140, store_profile_id: 'store-2' },
      ],
      wires: [
        { id: 'w-1', from_node_id: 'store-1', from_port: 'right', to_node_id: 'ws-rename', to_port: 'left', direction: 'one-way' },
        { id: 'w-2', from_node_id: 'store-2', from_port: 'right', to_node_id: 'ws-rename', to_port: 'left', direction: 'one-way' },
      ],
    });
    renderWithProvidersSync(<BranchDeleteHarness />, multiStoreFtl, sharedFtl);
    await waitFor(() => expect(document.querySelector('.node-canvas-container')).not.toBeNull());
    mockCanvasSize(800, 600);
    await waitFor(() => expect(screen.getByText('POS #1')).toBeInTheDocument());
    expect(getNodeCount()).toBe(3);
    expect(getWireCount()).toBe(2);

    // The parent deletes store-1 — the canvas must drop its card and the
    // wire attached to it, keeping the surviving branch + workspace intact.
    fireEvent.click(screen.getByRole('button', { name: 'delete-store-1' }));

    await waitFor(() => expect(getNodeCount()).toBe(2));
    expect(getWireCount()).toBe(1);
    expect(screen.queryByText('Downtown Branch')).not.toBeInTheDocument();
    expect(screen.getByText('Uptown Branch')).toBeInTheDocument();
    expect(screen.getByText('POS #1')).toBeInTheDocument();
  });

  it('drops a saved store node whose branch was deleted (full rebuild)', async () => {
    // The real delete flow remounts the editor for the next branch: the
    // saved diagram may still carry the deleted branch's node, but the
    // rebuild must not resurrect it — its card and wires leave cleanly.
    mockLoadTopology.mockResolvedValue({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Downtown Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'store-2', type: 'store', name: 'Uptown Branch', x: 380, y: 140, store_profile_id: 'store-2' },
      ],
      wires: [
        { id: 'w-1', from_node_id: 'store-1', from_port: 'right', to_node_id: 'ws-rename', to_port: 'left', direction: 'one-way' },
        { id: 'w-2', from_node_id: 'store-2', from_port: 'right', to_node_id: 'ws-rename', to_port: 'left', direction: 'one-way' },
      ],
    });
    renderEditor({
      branchLocations: [{ id: 'store-2', name: 'Uptown Branch' }],
      workspaceInstances: renameWsInstances,
    });
    await waitFor(() => expect(screen.getByText('POS #1')).toBeInTheDocument());
    expect(getNodeCount()).toBe(2);
    expect(getWireCount()).toBe(1);
    expect(screen.queryByText('Downtown Branch')).not.toBeInTheDocument();
    expect(screen.getByText('Uptown Branch')).toBeInTheDocument();
  });

  it('drops a legacy saved store node (no store_profile_id) when the last branch is deleted', async () => {
    // Dev-mock and legacy diagrams store store nodes WITHOUT
    // store_profile_id. Deleting the last branch empties BOTH the branch
    // list and the workspace instances, so the full rebuild runs against a
    // provided-but-empty branchLocations — the legacy fallback must not
    // resurrect the deleted branch's card (or its wires) just because the
    // saved node lacks a store_profile_id.
    // The saved store node sits at a NON-default position (y 260, not the
    // 140 seed slot) so the test also pins that a legacy node keeps its
    // saved position after adopting its canonical branch identity — it
    // must not be dropped and re-seeded at the default slot.
    mockLoadTopology.mockResolvedValue({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Downtown Branch', x: 80, y: 260 },
        { id: 'ws-rename', type: 'workspace', name: 'Store POS', x: 380, y: 140, metadata: { typeKey: 'store-pos', persisted: true } },
      ],
      wires: [
        { id: 'w-1', from_node_id: 'store-1', from_port: 'right', to_node_id: 'ws-rename', to_port: 'left', direction: 'one-way' },
      ],
    });
    renderWithProvidersSync(<DeleteAllHarness />, multiStoreFtl, sharedFtl);
    await waitFor(() => expect(document.querySelector('.node-canvas-container')).not.toBeNull());
    // Mount: the legacy store card keeps its saved position (260px, not the
    // 140px seed slot) and the saved wire binds it to the workspace
    // instance.
    await waitFor(() => expect(getNodeCount()).toBe(2));
    expect(getWireCount()).toBe(1);
    expect((nodeAt(0) as HTMLElement).style.top).toBe('260px');

    // Delete the last branch — instances AND locations empty in one update.
    fireEvent.click(screen.getByRole('button', { name: 'delete-all-branches' }));

    // The deleted branch's card and wire leave the canvas cleanly even
    // though the saved diagram still holds them.
    await waitFor(() => expect(getNodeCount()).toBe(0));
    expect(getWireCount()).toBe(0);
    expect(screen.queryByText('Downtown Branch')).not.toBeInTheDocument();
  });

  it('renames a workspace node from its card', async () => {
    const onRenameWorkspace = vi.fn().mockResolvedValue(true);
    renderEditor({ onRenameWorkspace });

    // The retail preset's workspace card is the second node on canvas.
    const wsCard = nodeAt(1);
    expect(wsCard.className).toContain('node-type-workspace');

    // Pencil → inline input pre-filled with the current name → Enter.
    fireEvent.click(within(wsCard).getByRole('button', { name: 'topology-workspace-rename-label' }));
    const input = within(wsCard).getByLabelText('topology-workspace-rename-placeholder');
    expect((input as HTMLInputElement).value).toBe('Retail POS #1');
    fireEvent.change(input, { target: { value: 'Front Register' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onRenameWorkspace).toHaveBeenCalledWith('ws-1', 'Front Register'));
    await waitFor(() => expect(within(wsCard).getByText('Front Register')).toBeTruthy());
    // Keyboard commit returns focus to the workspace card.
    expect(document.activeElement).toBe(wsCard);
  });

  it('keeps unsaved canvas edits when a workspace rename refreshes instances (same ids)', async () => {
    // The parent persists the rename via the instance API and refreshes the
    // instances array with the SAME ids — the editor must merge the new
    // name in place, not rebuild (a rebuild would discard the unsaved drag).
    renderWithProvidersSync(<WorkspaceRenameHarness />, multiStoreFtl, sharedFtl);
    await waitFor(() => expect(document.querySelector('.node-canvas-container')).not.toBeNull());
    mockCanvasSize(800, 600);
    await waitFor(() => expect(screen.getByText('POS #1')).toBeInTheDocument());

    // Unsaved edit: drag the workspace node across the canvas.
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const wsCard = nodeAt(1);
    fireEvent.mouseDown(wsCard, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 200, clientY: 120 });
    fireEvent.mouseUp(canvas, { button: 0 });
    const draggedLeft = wsCard.style.left;
    expect(draggedLeft).not.toBe('336px'); // the drag actually moved it

    // Rename the workspace through its card.
    fireEvent.click(within(wsCard).getByRole('button', { name: 'topology-workspace-rename-label' }));
    const input = within(wsCard).getByLabelText('topology-workspace-rename-placeholder');
    fireEvent.change(input, { target: { value: 'POS #1 (Renamed)' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // The rename propagated to the card title…
    await waitFor(() => expect(within(wsCard).getByText('POS #1 (Renamed)')).toBeTruthy());
    // …and the unsaved drag survived the instances refresh.
    await waitFor(() => expect(wsCard.style.left).toBe(draggedLeft));
  });

  it('takes the full reload path when instances AND branch locations change together', async () => {
    // The light-merge guard must only intercept branchLocations-only
    // changes: when instances change in the same batch, the full rebuild
    // (authoritative instances win) still runs.
    renderWithProvidersSync(<BothChangeHarness />, multiStoreFtl, sharedFtl);
    await waitFor(() => expect(screen.getByText('Downtown Branch')).toBeInTheDocument());

    fireEvent.click(screen.getByText('both-change'));

    await waitFor(() => expect(screen.getByText('Both POS')).toBeInTheDocument());
    expect(screen.getByText('Both Branch')).toBeInTheDocument();
    expect(screen.queryByText('Downtown Branch')).not.toBeInTheDocument();
  });

  // ── Arrow-key auto-repeat must not flood the undo stack (#14) ────

  it('ignores auto-repeated arrow nudges so one nudge is one undo step', () => {
    renderEditor();

    const firstNode = document.querySelector('.topology-node') as HTMLElement;
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    expect(firstNode).not.toBeNull();
    expect(canvas).not.toBeNull();
    expect(firstNode.style.left).toBe('80px');

    selectFirstNode();

    // ArrowRight with snap on moves exactly one grid step: snap(80 + 24) = 96.
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    expect(firstNode.style.left).toBe('96px');

    // Holding the key fires repeated keydowns (repeat: true). Those are
    // the SAME held nudge — they must not move further nor create extra
    // undo entries.
    fireEvent.keyDown(canvas, { key: 'ArrowRight', repeat: true });
    expect(firstNode.style.left).toBe('96px');

    // A single undo must return the node to the ORIGINAL position — the
    // held key produced exactly one history entry.
    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));
    expect(firstNode.style.left).toBe('80px');
  });

  it('coalesces rapid discrete arrow nudges into ONE undo entry (undo reverts the whole burst)', () => {
    renderEditor();
    const firstNode = document.querySelector('.topology-node') as HTMLElement;
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    expect(firstNode.style.left).toBe('80px');

    selectFirstNode();

    // Two discrete taps (NOT OS auto-repeat — each is a fresh keydown
    // without repeat: true) within the coalesce window: 80 → 96 → 120.
    // (A third tap would step the card into the preset's neighbour — the
    // round-141 no-overlap block, not a nudge failure.)
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    expect(firstNode.style.left).toBe('120px');

    // ONE undo reverts the WHOLE burst back to the origin — not just the
    // last grid step — and the burst consumed exactly one entry.
    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));
    expect(firstNode.style.left).toBe('80px');
    expect(screen.queryByText('Undo (Ctrl+Z)')).not.toBeInTheDocument();
  });

  it('a pause between nudges ends the burst and starts a fresh undo entry', async () => {
    renderEditor();
    const firstNode = document.querySelector('.topology-node') as HTMLElement;
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    expect(firstNode.style.left).toBe('80px');

    selectFirstNode();

    fireEvent.keyDown(canvas, { key: 'ArrowRight' }); // 80 → 96 (burst entry)
    // Pause past the coalesce window: the next press is a NEW burst.
    await new Promise((resolve) => setTimeout(resolve, 1600));
    fireEvent.keyDown(canvas, { key: 'ArrowRight' }); // 96 → 120 (fresh entry)

    // The first undo reverts only the LATEST nudge; the second reverts the
    // first. Two entries exist — the pause split the burst.
    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));
    expect(firstNode.style.left).toBe('96px');
    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));
    expect(firstNode.style.left).toBe('80px');
  });

  it('an undo closes the nudge burst — the next nudge starts a fresh entry', () => {
    renderEditor();
    const firstNode = document.querySelector('.topology-node') as HTMLElement;
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    expect(firstNode.style.left).toBe('80px');

    selectFirstNode();

    // Two-tap burst: 80 → 96 → 120 (one entry, snapshotting the origin).
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    expect(firstNode.style.left).toBe('120px');

    // Undo reverts the WHOLE burst to its origin; the burst session must
    // NOT survive the undo.
    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));
    expect(firstNode.style.left).toBe('80px');

    // A fresh nudge immediately after the undo must be its OWN entry: if
    // the stale burst session had survived, it would push nothing and the
    // following undo could not revert the nudge.
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    expect(firstNode.style.left).toBe('96px');
    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));
    expect(firstNode.style.left).toBe('80px');
  });

  it('Shift+arrow nudges exactly 1px and bypasses the grid entirely', () => {
    renderEditor();
    const firstNode = document.querySelector('.topology-node') as HTMLElement;
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    expect(firstNode.style.left).toBe('80px');
    expect(firstNode.style.top).toBe('140px');

    selectFirstNode();

    // Shift = fine adjustment: 1px raw, never rounded to the 24px grid.
    fireEvent.keyDown(canvas, { key: 'ArrowRight', shiftKey: true });
    expect(firstNode.style.left).toBe('81px');
    fireEvent.keyDown(canvas, { key: 'ArrowDown', shiftKey: true });
    expect(firstNode.style.top).toBe('141px');
  });

  it('plain arrows with snap on move exactly one grid step (no dead presses)', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [{ id: 'x', type: 'store', name: 'X', x: 96, y: 96 }],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(1));
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const node = document.querySelector('.topology-node') as HTMLElement;
    selectFirstNode();

    // From an ON-GRID position (96), the old 8px step snapped back to 96
    // (a dead press). One grid step must move 96 → 120 deterministically.
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    expect(node.style.left).toBe('120px');
  });

  it('plain arrows with snap off move the raw 8px step', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [{ id: 'x', type: 'store', name: 'X', x: 96, y: 96 }],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(1));
    openRackPanel('view'); fireEvent.click(screen.getByText('Snap to grid')); // toggles OFF
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const node = document.querySelector('.topology-node') as HTMLElement;
    selectFirstNode();

    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    expect(node.style.left).toBe('104px');
  });

  // ── Alignment guides on fine nudge (Shift+arrow) ────────────────

  describe('NodeTopologyEditor — alignment guides on fine nudge', () => {
    // A at (200, 200) has its RIGHT edge at 440; B at (447, 250) has its LEFT
    // edge at 447 — a 7px gap, just outside the 6px alignment band.
    const loadNudgeFixture = () => {
      mockLoadTopology.mockResolvedValueOnce({
        nodes: [
          { id: 'a', type: 'store', name: 'A', x: 200, y: 200 },
          { id: 'b', type: 'workspace', name: 'B', x: 447, y: 250, metadata: { typeKey: 'store-pos' } },
        ],
        wires: [],
      } as never);
      renderEditor();
    };

    const canvas = () => document.querySelector('.node-canvas-container') as HTMLElement;
    const nodeA = () => document.querySelector('.topology-node[data-node-id="a"]') as HTMLElement;

    it('draws an alignment guide when a fine nudge lands flush against a neighbour', async () => {
      loadNudgeFixture();
      await waitFor(() => expect(getNodeCount()).toBe(2));
      selectFirstNode();

      // A's right edge is 7px short of B's left edge (outside the 6px band).
      // One Shift+Right brings it to 441 → ENTRY snap lands flush at 447
      // (A.x = 207) and the guide draws on B's edge.
      fireEvent.keyDown(canvas(), { key: 'ArrowRight', shiftKey: true });

      expect(nodeA().style.left).toBe('207px');
      expect(document.querySelector('.alignment-guide-x')).not.toBeNull();
    });

    it('entry snap does not eat in-band nudges (raw 1px moves stand)', async () => {
      loadNudgeFixture();
      await waitFor(() => expect(getNodeCount()).toBe(2));
      selectFirstNode();

      fireEvent.keyDown(canvas(), { key: 'ArrowRight', shiftKey: true });
      expect(nodeA().style.left).toBe('207px'); // flush at 447 (entry snap)

      // The band was entered ONCE — a raw 1px move AWAY from the neighbour
      // stands (206, never snapping back to 207). The guide stays in-band.
      // (Moving TOWARD the neighbour is now blocked at the wall — round 141
      // forbids stepping 1px into the card, so the in-band raw-move property
      // is exercised in the reachable direction.)
      fireEvent.keyDown(canvas(), { key: 'ArrowLeft', shiftKey: true });
      expect(nodeA().style.left).toBe('206px');
      expect(document.querySelector('.alignment-guide-x')).not.toBeNull();
      fireEvent.keyDown(canvas(), { key: 'ArrowLeft', shiftKey: true });
      expect(nodeA().style.left).toBe('205px');
      expect(document.querySelector('.alignment-guide-x')).not.toBeNull();
      // Nudging back toward the neighbour is legal while a gap remains (205
      // → 206, edge 446 still 1px short of B's 447); the WALL is at flush —
      // a nudge that would step into B (207 → 208) is blocked (round 141).
      fireEvent.keyDown(canvas(), { key: 'ArrowRight', shiftKey: true });
      expect(nodeA().style.left).toBe('206px');
      fireEvent.keyDown(canvas(), { key: 'ArrowRight', shiftKey: true });
      expect(nodeA().style.left).toBe('207px');
      fireEvent.keyDown(canvas(), { key: 'ArrowRight', shiftKey: true });
      expect(nodeA().style.left).toBe('207px'); // blocked — never 208
      expect(document.querySelector('.alignment-guide-x')).not.toBeNull();
    });

    it('clears the guide once a nudge leaves the alignment band', async () => {
      loadNudgeFixture();
      await waitFor(() => expect(getNodeCount()).toBe(2));
      selectFirstNode();

      fireEvent.keyDown(canvas(), { key: 'ArrowRight', shiftKey: true });
      expect(nodeA().style.left).toBe('207px'); // entry snap, flush at 447

      // 6 nudges LEFT → 201 (edge 441, still 6px from the line = in band).
      // (Right is a hard wall at flush — round 141 blocks stepping into the
      // neighbour — so the band-exit property is exercised leftward.)
      for (let i = 0; i < 6; i++) fireEvent.keyDown(canvas(), { key: 'ArrowLeft', shiftKey: true });
      expect(nodeA().style.left).toBe('201px');
      expect(document.querySelector('.alignment-guide-x')).not.toBeNull();

      // One more → 200 (edge 440, 7px past) — out of the band, guide clears.
      fireEvent.keyDown(canvas(), { key: 'ArrowLeft', shiftKey: true });
      expect(nodeA().style.left).toBe('200px');
      expect(document.querySelector('.alignment-guide')).toBeNull();
    });

    it('a member\'s edge entry snap carries the whole selection rigidly (collective nudge)', async () => {
      // Round-25 semantics through the KEYBOARD path: A (200, 200) has its
      // right edge at 440; B (447, 250) sits 7px short of it; C (900, 250)
      // is far. Select B + C and Shift+Left — B's left edge enters the band
      // (446, dist 6), the entry snap lands it flush at 440, and C rides
      // along rigidly (900 → 893). No member was pre-aligned, so entry fires.
      mockLoadTopology.mockResolvedValueOnce({
        nodes: [
          { id: 'a', type: 'store', name: 'A', x: 200, y: 200 },
          { id: 'b', type: 'workspace', name: 'B', x: 447, y: 250, metadata: { typeKey: 'store-pos' } },
          { id: 'c', type: 'workspace', name: 'C', x: 900, y: 250, metadata: { typeKey: 'store-pos' } },
        ],
        wires: [],
      } as never);
      renderEditor();
      await waitFor(() => expect(getNodeCount()).toBe(3));
      mockCanvasSize(1200, 800);

      // Backward marquee (980,460) → (460,260) touches B + C but NOT A
      // (A's box 200-440 × 200-440 stays clear of the 460-980 × 260-460 box).
      const canvasEl = canvas();
      fireEvent.mouseDown(canvasEl, { button: 0, clientX: 980, clientY: 460 });
      fireEvent.mouseMove(canvasEl, { clientX: 460, clientY: 260 });
      fireEvent.mouseUp(canvasEl, { button: 0 });
      expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(2);

      fireEvent.keyDown(canvasEl, { key: 'ArrowLeft', shiftKey: true });

      const nodeB = document.querySelector('.topology-node[data-node-id="b"]') as HTMLElement;
      const nodeC = document.querySelector('.topology-node[data-node-id="c"]') as HTMLElement;
      expect(nodeB.style.left).toBe('440px'); // B's edge flush on A's right edge
      expect(nodeC.style.left).toBe('893px'); // whole selection rides rigidly
      expect(document.querySelector('.alignment-guide-x')).not.toBeNull();
    });
  });

  // ── Fresh topology reload clears the undo stack (#15) ────────────

  it('clears the undo stack when a fresh topology loads (non-skip path)', async () => {
    mockLoadTopology.mockResolvedValue({
      nodes: [{ id: 'store-x', type: 'store', name: 'Loaded Store', x: 100, y: 100 }],
      wires: [],
    });

    renderWithProvidersSync(
      <ReloadingHarness
        next={[{ instanceId: 'ws-new', typeKey: 'restaurant-pos', name: 'New Instance' }]}
      />,
      multiStoreFtl,
      sharedFtl,
    );

    // Legacy path (no instances yet): saved diagram renders.
    await waitFor(() => {
      expect(screen.getByText('Loaded Store')).toBeInTheDocument();
    });

    // Make an edit so the undo stack has an entry.
    openRackPanel('add'); fireEvent.click(screen.getByText('+ Store Node'));
    openRackPanel('edit'); expect(screen.getByText('Undo (Ctrl+Z)')).toBeInTheDocument();
    // Auto-select opens the inspector header with the same name — both match.
    expect(screen.getAllByText('New Store').length).toBeGreaterThanOrEqual(1);

    // Parent pushes a fresh workspaceInstances array → non-skip reload.
    fireEvent.click(screen.getByText('reload-instances'));

    // The new authoritative topology replaces the canvas — the manually
    // added node is gone (rebuilt from instances, not the undo stack).
    await waitFor(() => {
      expect(screen.getByText('New Instance')).toBeInTheDocument();
      expect(screen.queryByText('New Store')).not.toBeInTheDocument();
    });

    // The undo stack must be cleared — Undo can never restore a stale
    // canvas that contradicts the loaded workspace instances.
    expect(screen.queryByText('Undo (Ctrl+Z)')).not.toBeInTheDocument();
  });


  // ── Wire direction toggle ───────────────────────────────────────

  it('cycles wire direction through one-way → reverse → two-way on click', () => {
    renderEditor();

    // The whole wire is the affordance: clicking the hitbox cycles the
    // flow. Retail preset wires start one-way.
    const hitbox = document.querySelector('.wire-hitbox') as Element;
    const path = () => hitbox.parentElement!.querySelector('path.wire-path') as Element;
    expect(path().getAttribute('data-direction')).toBe('one-way');

    fireEvent.click(hitbox);
    expect(path().getAttribute('data-direction')).toBe('reverse');

    fireEvent.click(hitbox);
    expect(path().getAttribute('data-direction')).toBe('two-way');

    fireEvent.click(hitbox);
    expect(path().getAttribute('data-direction')).toBe('one-way');
  });

  it('renders no visible label pills — the label is a hover tooltip only', async () => {
    // Wire labels are presentation chrome: they surface as a native SVG
    // tooltip on hover, never as a permanent canvas pill.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'S', x: 80, y: 80 },
        { id: 'ws-1', type: 'workspace', name: 'W', x: 380, y: 80, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [
        { id: 'w-unlabeled', from_node_id: 'store-1', to_node_id: 'ws-1', direction: 'one-way' },
        { id: 'w-labeled', from_node_id: 'store-1', to_node_id: 'ws-1', direction: 'one-way', label: 'Binds Store' },
      ],
    } as never);
    renderEditor();

    // The load effect resolves async — wait for the two mocked wires first.
    await waitFor(() => expect(document.querySelectorAll('.wire-path')).toHaveLength(2));
    // No label group elements anywhere — the old pill chrome is gone.
    expect(document.querySelectorAll('.wire-label-group')).toHaveLength(0);
    // The labeled wire's hitbox carries the label as its native tooltip.
    const titles = [...document.querySelectorAll('.wire-hitbox title')];
    expect(titles).toHaveLength(2);
    expect(titles.some((t) => t.textContent?.includes('Binds Store'))).toBe(true);
  });

  // ── Zoom controls ───────────────────────────────────────────────

  it('shows zoom controls in the floating canvas cluster', () => {
    renderEditor();

    expect(document.querySelector('.canvas-zoom-level')?.textContent).toBe('100%');
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument();
    expect(screen.getByText('Fit All')).toBeInTheDocument();
    expect(screen.getByText('Reset View')).toBeInTheDocument();
  });

  // ── Keyboard shortcut guard (#3) ────────────────────────────────

  it('does not delete node when Backspace is pressed in a text field', () => {
    renderEditor();

    // Add a node and select it to open the inspector
    fireEvent.click(screen.getByText('+ Store Node'));
    const nodeCountAfterAdd = getNodeCount();

    // Find the Node Name input in the inspector
    const nameInput = document.querySelector('.inspector-field input[type="text"]') as HTMLInputElement;
    expect(nameInput).not.toBeNull();

    // Focus the input and fire Backspace
    nameInput.focus();
    fireEvent.keyDown(nameInput, { key: 'Backspace' });

    // Node count should be unchanged — Backspace was handled by the input
    expect(getNodeCount()).toBe(nodeCountAfterAdd);
  });

  // ── Apply button — idMap remapping (#1) ───────────────────────

  it('remaps node and wire IDs when onSave returns idMap', async () => {
    // Load a custom topology with known, stable node IDs so this test
    // does NOT depend on the retail preset internals.
    mockLoadTopology.mockResolvedValue({
      nodes: [
        { id: 'store-test', type: 'store', name: 'Remap Store', x: 100, y: 100 },
        { id: 'ws-test', type: 'workspace', name: 'Remap POS', x: 300, y: 100 },
      ],
      wires: [{ id: 'w-test', from_node_id: 'store-test', to_node_id: 'ws-test', direction: 'one-way' }],
    });

    const onSave = vi.fn().mockResolvedValue({ 'ws-test': 'ws-remapped-id' });
    renderEditor({ onSave });

    await waitFor(() => {
      expect(screen.getByText('Remap POS')).toBeInTheDocument();
    });

    await applyWithPin();

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    // onSave receives the original IDs (remapping happens client-side AFTER return)
    const [nodes] = onSave.mock.calls[0]!;
    const wsTestNode = nodes.find((n: { id: string }) => n.id === 'ws-test');
    expect(wsTestNode).toBeDefined();
    expect(wsTestNode.name).toBe('Remap POS');

    // After remapping, no nodes are lost and component is stable
    expect(getNodeCount()).toBe(2);
    expect(screen.getByText('Remap POS')).toBeInTheDocument();
    expect(screen.getByText('Remap Store')).toBeInTheDocument();
  });

  it('clears selection after idMap remapping', async () => {
    const onSave = vi.fn().mockResolvedValue({ 'ws-1': 'ws-new-id' });
    renderEditor({ onSave });

    await waitFor(() => {
      expect(screen.getByText('Downtown Branch')).toBeInTheDocument();
    });

    // Select the workspace node first
    const wsNode = document.querySelector('.node-type-workspace');
    expect(wsNode).not.toBeNull();
    fireEvent.mouseDown(wsNode as Element, { button: 0 });

    // Inspector should be visible (Delete button appears when something is selected)
    openRackPanel('edit'); expect(screen.getByText('Delete Selected Element')).toBeInTheDocument();

    // Click Apply — the idMap remapping should clear selection
    await applyWithPin();

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    // After remapping, the delete button should disappear (selection cleared)
    await waitFor(() => {
      expect(screen.queryByText('Delete Selected Element')).not.toBeInTheDocument();
    });
  });

  it('clears the undo stack when a save remaps node ids', async () => {
    // Custom topology with a stable workspace id so the remap is deterministic.
    mockLoadTopology.mockResolvedValue({
      nodes: [
        { id: 'store-test', type: 'store', name: 'Remap Store', x: 100, y: 100 },
        { id: 'ws-test', type: 'workspace', name: 'Remap POS', x: 300, y: 100 },
      ],
      wires: [{ id: 'w-test', from_node_id: 'store-test', to_node_id: 'ws-test', direction: 'one-way' }],
    });

    const onSave = vi.fn().mockResolvedValue({ 'ws-test': 'ws-remapped-id' });
    renderEditor({ onSave });

    await waitFor(() => {
      expect(screen.getByText('Remap POS')).toBeInTheDocument();
    });

    // Make an edit so the undo stack holds a pre-save entry.
    fireEvent.click(screen.getByText('+ Store Node'));
    openRackPanel('edit');
    openRackPanel('edit'); expect(screen.getByText('Undo (Ctrl+Z)')).toBeInTheDocument();

    // Apply — archive+recreate remaps 'ws-test' → 'ws-remapped-id' after
    // onSave resolves. The undo stack must be cleared: every pre-save entry
    // holds the OLD id, which no longer exists on the canvas or in the DB.
    await applyWithPin();
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByText('Undo (Ctrl+Z)')).not.toBeInTheDocument();
  });

  it('keeps the undo stack when a save does not remap ids', async () => {
    const onSave = vi.fn().mockResolvedValue({});
    renderEditor({ onSave });

    await waitFor(() => {
      expect(screen.getByText('Downtown Branch')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('+ Store Node'));
    openRackPanel('edit');
    openRackPanel('edit'); expect(screen.getByText('Undo (Ctrl+Z)')).toBeInTheDocument();

    await applyWithPin();
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    // No remap → ids unchanged → the pre-save undo entry stays valid, so
    // undo-after-save keeps working (the entry restores real, existing ids).
    openRackPanel('edit'); expect(screen.getByText('Undo (Ctrl+Z)')).toBeInTheDocument();
  });





  it('handles empty idMap gracefully (no remapping)', async () => {
    const onSave = vi.fn().mockResolvedValue({});
    renderEditor({ onSave });

    await waitFor(() => {
      expect(screen.getByText('Downtown Branch')).toBeInTheDocument();
    });

    const initialNodeCount = getNodeCount();

    await applyWithPin();

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    // Node count unchanged — no remapping occurred
    expect(getNodeCount()).toBe(initialNodeCount);
    // All original nodes should still be present
    expect(screen.getByText('Downtown Branch')).toBeInTheDocument();
    expect(screen.getByText('Retail POS #1')).toBeInTheDocument();
  });

  it('handles onSave returning undefined (backward compat)', async () => {
    // vi.fn() returns undefined by default, which is the legacy behavior
    const onSave = vi.fn();
    renderEditor({ onSave });

    await waitFor(() => {
      expect(screen.getByText('Downtown Branch')).toBeInTheDocument();
    });

    const initialNodeCount = getNodeCount();

    await applyWithPin();

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    // No crash, no remapping
    expect(getNodeCount()).toBe(initialNodeCount);
  });

  it('remaps wire endpoints when returning idMap', async () => {
    // Load a custom topology with explicit wire endpoints so we can
    // verify the endpoint IDs onSave receives AND that wires survive
    // client-side remapping.
    mockLoadTopology.mockResolvedValue({
      nodes: [
        { id: 'store-wr', type: 'store', name: 'Wire Store', x: 100, y: 100 },
        { id: 'ws-wr', type: 'workspace', name: 'Wire POS', x: 300, y: 100 },
      ],
      wires: [{ id: 'w-wr', from_node_id: 'store-wr', to_node_id: 'ws-wr', direction: 'one-way' }],
    });

    const onSave = vi.fn().mockResolvedValue({ 'ws-wr': 'ws-remapped' });
    renderEditor({ onSave });

    await waitFor(() => {
      expect(screen.getByText('Wire POS')).toBeInTheDocument();
    });

    const initialWireCount = getWireCount();
    expect(initialWireCount).toBe(1);

    await applyWithPin();

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    // onSave received the wire with original endpoint IDs
    const [, wires] = onSave.mock.calls[0]!;
    expect(wires).toHaveLength(1);
    expect(wires[0].fromNodeId).toBe('store-wr'); // unchanged
    expect(wires[0].toNodeId).toBe('ws-wr'); // old ID, client remaps after return

    // After remapping, wires should still be present (no loss)
    expect(getWireCount()).toBe(1);
  });


  // ── Delete via keyboard shortcut also uses input guard (#3) ─────

  it('does not delete node when Delete is pressed in a text field', () => {
    renderEditor();

    fireEvent.click(screen.getByText('+ Store Node'));
    const nodeCountAfterAdd = getNodeCount();

    const nameInput = document.querySelector('.inspector-field input[type="text"]') as HTMLInputElement;
    expect(nameInput).not.toBeNull();

    nameInput.focus();
    fireEvent.keyDown(nameInput, { key: 'Delete' });

    // Node count should be unchanged
    expect(getNodeCount()).toBe(nodeCountAfterAdd);
  });

  it('does not intercept Ctrl+Z when typing in a text field', () => {
    renderEditor();

    fireEvent.click(screen.getByText('+ Store Node'));
    const nodeCountAfterAdd = getNodeCount();

    const nameInput = document.querySelector('.inspector-field input[type="text"]') as HTMLInputElement;
    expect(nameInput).not.toBeNull();

    nameInput.focus();
    fireEvent.keyDown(nameInput, { key: 'z', ctrlKey: true });

    // Ctrl+Z should be handled by the input field, not the canvas handler
    expect(getNodeCount()).toBe(nodeCountAfterAdd);
  });

  // ── Delegation regression: Apply always uses the parent callback ────────

  it('delegates Apply to onSave when the parent callback is provided', async () => {
    const onSave = vi.fn();
    renderEditor({ onSave });

    await applyWithPin();

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    // The editor delegates entirely to onSave, preserving the single-writer
    // boundary owned by TopologyScreen.
  });

  // ── Undo sequence resilience (#6) ───────────────────────────────

  it('undoes multiple sequential additions back to initial state', () => {
    renderEditor();

    const initialCount = getNodeCount();

    // Add 3 nodes
    fireEvent.click(screen.getByText('+ Store Node'));
    fireEvent.click(screen.getByText('+ Hardware Node'));
    fireEvent.click(screen.getByText('+ Store Node'));
    expect(getNodeCount()).toBe(initialCount + 3);

    // Undo 3 times (the edit panel holds the Undo button)
    openRackPanel('edit');
    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));
    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));
    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));

    expect(getNodeCount()).toBe(initialCount);
  });

  // ── Redo (#7) ───────────────────────────────────────────────────

  it('redos restore undone state', () => {
    renderEditor();

    const initialCount = getNodeCount();

    fireEvent.click(screen.getByText('+ Store Node'));
    expect(getNodeCount()).toBe(initialCount + 1);
    expect(screen.getAllByText('New Store').length).toBeGreaterThanOrEqual(1);

    openRackPanel('edit');
    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));
    expect(getNodeCount()).toBe(initialCount);
    // Redo button appears after undo
    expect(screen.getByText('Redo (Ctrl+Y)')).toBeInTheDocument();

    openRackPanel('edit'); fireEvent.click(screen.getByText('Redo (Ctrl+Y)'));
    expect(getNodeCount()).toBe(initialCount + 1);
    expect(screen.getAllByText('New Store').length).toBeGreaterThanOrEqual(1);
    // Redo stack consumed, button gone
    expect(screen.queryByText('Redo (Ctrl+Y)')).not.toBeInTheDocument();
  });

  it('clears redo stack on new edit after undo', () => {
    renderEditor();

    fireEvent.click(screen.getByText('+ Store Node'));
    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));
    // Redo should be available
    expect(screen.getByText('Redo (Ctrl+Y)')).toBeInTheDocument();

    // New edit after undo — clears redo branch (back to the add panel for
    // the tool card, then re-open edit to verify Redo is gone).
    openRackPanel('add');
    fireEvent.click(screen.getByText('+ Hardware Node'));
    expect(screen.queryByText('Redo (Ctrl+Y)')).not.toBeInTheDocument();
  });

  it('Ctrl+Y keyboard shortcut triggers redo', () => {
    renderEditor();

    const initialCount = getNodeCount();
    fireEvent.click(screen.getByText('+ Store Node'));
    expect(getNodeCount()).toBe(initialCount + 1);

    // Ctrl+Z to undo
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    expect(canvas).not.toBeNull();
    fireEvent.keyDown(canvas!, { key: 'z', ctrlKey: true });
    expect(getNodeCount()).toBe(initialCount);

    // Ctrl+Y to redo
    fireEvent.keyDown(canvas!, { key: 'y', ctrlKey: true });
    expect(getNodeCount()).toBe(initialCount + 1);
  });

  it('Ctrl+Shift+Z also triggers redo', () => {
    renderEditor();

    const initialCount = getNodeCount();
    fireEvent.click(screen.getByText('+ Store Node'));
    expect(getNodeCount()).toBe(initialCount + 1);

    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    expect(canvas).not.toBeNull();

    // Ctrl+Z to undo
    fireEvent.keyDown(canvas!, { key: 'z', ctrlKey: true });
    expect(getNodeCount()).toBe(initialCount);

    // Ctrl+Shift+Z to redo (via the undo handler's shiftKey check)
    fireEvent.keyDown(canvas!, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(getNodeCount()).toBe(initialCount + 1);
  });

  // ── Corrupt wire direction resilience (#10) ─────────────────────

  it('renders without crash when loaded topology has corrupt wire direction', async () => {
    mockLoadTopology.mockResolvedValue({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Store', x: 100, y: 100 },
        { id: 'ws-1', type: 'workspace', name: 'POS', x: 300, y: 100 },
      ],
      wires: [{ id: 'w-bad', from_node_id: 'store-1', to_node_id: 'ws-1', direction: 'bidirectional' }],
    });

    renderEditor();

    // Should render without crashing — corrupt direction falls back to one-way
    await waitFor(() => {
      expect(screen.getByText('Store')).toBeInTheDocument();
      expect(screen.getByText('POS')).toBeInTheDocument();
    });

    // Wire should still render (just without the two-way marker)
    expect(getWireCount()).toBe(1);
  });

  it('normalizes a corrupt wire direction at load instead of keeping it verbatim', async () => {
    // The load path must apply the same closed-union discipline as the
    // semantic contract: a garbage direction from the backend (manual
    // edit, stale JSON) must fold to a legal value in the EDITOR MODEL,
    // not survive verbatim — otherwise it renders with wrong markers and
    // round-trips back to the backend on the next Apply.
    mockLoadTopology.mockResolvedValue({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Store', x: 100, y: 100 },
        { id: 'ws-1', type: 'workspace', name: 'POS', x: 300, y: 100 },
      ],
      wires: [{ id: 'w-bad', from_node_id: 'store-1', to_node_id: 'ws-1', direction: 'bidirectional' }],
    });

    renderEditor();

    await waitFor(() => {
      expect(getWireCount()).toBe(1);
    });

    // data-direction is the live render contract: it must be a legal
    // WireDirection, not the corrupt stored value.
    const wirePath = document.querySelector('.wire-path') as SVGPathElement;
    expect(wirePath.getAttribute('data-direction')).toBe('one-way');
  });

  // ── Inspector edits are undoable and mark the canvas dirty (#12) ──

  it('pushes a single undo entry for an inspector rename burst', () => {
    renderEditor();

    const firstNode = document.querySelector('.topology-node') as HTMLElement;
    fireEvent.mouseDown(firstNode, { button: 0, clientX: 0, clientY: 0 });

    const nameInput = document.querySelector('.inspector-field input[type="text"]') as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    expect(nameInput.value).toBe('Downtown Branch');

    // Type a burst: two change events in one focus session. The whole
    // burst must be a SINGLE undo entry, not one per keystroke.
    fireEvent.change(nameInput, { target: { value: 'Renamed' } });
    fireEvent.change(nameInput, { target: { value: 'Renamed Branch' } });

    openRackPanel('edit');
    openRackPanel('edit'); expect(screen.getByText('Undo (Ctrl+Z)')).toBeInTheDocument();

    // One undo must restore the ORIGINAL name.
    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));

    expect(
      (document.querySelector('.inspector-field input[type="text"]') as HTMLInputElement).value,
    ).toBe('Downtown Branch');
  });


  it('reports dirty transitions through onDirtyChange', async () => {
    const onDirtyChange = vi.fn();
    renderEditor({ onDirtyChange });
    // After the load commits its snapshot, the canvas is clean.
    await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(false));

    // A real edit flips the signal true.
    fireEvent.click(screen.getByText('+ Store Node'));
    await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(true));

    // Undo back to the applied snapshot flips it false again.
    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it('pushes an undo entry when the workspace type select changes', () => {
    renderEditor();

    const wsNode = document.querySelector('.node-type-workspace') as HTMLElement;
    expect(wsNode).not.toBeNull();
    fireEvent.mouseDown(wsNode, { button: 0, clientX: 0, clientY: 0 });

    const select = typeSelect();
    expect(select).not.toBeNull();
    expect(select.value).toBe('store-pos');

    fireEvent.change(select, { target: { value: 'restaurant-pos' } });
    expect(select.value).toBe('restaurant-pos');
    openRackPanel('edit'); expect(screen.getByText('Undo (Ctrl+Z)')).toBeInTheDocument();

    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));

    expect((document.querySelector('.inspector-select') as HTMLSelectElement).value).toBe('store-pos');
  });

  // ── Selection re-validation on undo/redo/preset load (#16) ───────

  it('clears the dangling node selection when undoing a node add', () => {
    renderEditor();

    // Adding a node auto-selects it — the tool-rack Delete button appears.
    fireEvent.click(screen.getByText('+ Store Node'));
    // Auto-select opens the inspector header with the same name — both match.
    expect(screen.getAllByText('New Store').length).toBeGreaterThanOrEqual(1);
    openRackPanel('edit'); expect(screen.getByText('Delete Selected Element')).toBeInTheDocument();

    // Undo removes the node. The selection must NOT stay dangling at the
    // now-gone node — the Delete button (rendered for any selection) is
    // the observable proof the selection was cleared.
    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));

    expect(screen.queryByText('New Store')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete Selected Element')).not.toBeInTheDocument();
  });

  it('preserves a still-valid node selection when undoing a drag', () => {
    renderEditor();

    const firstNode = document.querySelector('.topology-node') as HTMLElement;
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    expect(firstNode).not.toBeNull();
    expect(firstNode.style.left).toBe('80px');

    // Drag the selected node (history pushed on first movement), then undo.
    fireEvent.mouseDown(firstNode, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 48, clientY: 48 });
    expect(firstNode.style.left).toBe('120px');
    fireEvent.mouseUp(canvas, { button: 0 });

    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));
    expect(firstNode.style.left).toBe('80px');

    // The node still exists — its selection must survive the undo.
    openRackPanel('edit'); expect(screen.getByText('Delete Selected Element')).toBeInTheDocument();
  });

  it('preserves a still-valid wire selection when undoing a direction cycle', () => {
    renderEditor();

    // Click the first retail wire via its hitbox — selects AND cycles to
    // reverse in one click (the whole wire is the affordance now).
    const hitbox = document.querySelector('.wire-hitbox') as Element;
    expect(hitbox).not.toBeNull();
    const path = () => hitbox.parentElement!.querySelector('path.wire-path') as Element;
    fireEvent.click(hitbox);
    openRackPanel('edit'); expect(screen.getByText('Delete Selected Element')).toBeInTheDocument();
    expect(path().getAttribute('data-direction')).toBe('reverse');

    // Cycle again (pushes another undo entry), then undo twice: the first
    // undo restores reverse, the second restores one-way.
    fireEvent.click(hitbox);
    expect(path().getAttribute('data-direction')).toBe('two-way');
    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));
    expect(path().getAttribute('data-direction')).toBe('reverse');
    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));
    expect(path().getAttribute('data-direction')).toBe('one-way');

    // Direction restored and the wire still exists — selection preserved.
    openRackPanel('edit'); expect(screen.getByText('Delete Selected Element')).toBeInTheDocument();
  });


  // ── Undo-of-delete re-selects the restored node (#17) ─────────────

  it('re-selects a node restored by undoing a dialog (wired) delete', () => {
    renderEditor();

    // ws-1 (Retail POS #1) has connected wires → the dialog delete path,
    // and is NOT a Branch Location anchor so it is deletable.
    const wired = document.querySelector('.node-type-workspace') as HTMLElement;
    expect(wired).not.toBeNull();
    fireEvent.mouseDown(wired, { button: 0 });
    openRackPanel('edit'); expect(screen.getByText('Delete Selected Element')).toBeInTheDocument();

    openRackPanel('edit'); fireEvent.click(screen.getByText('Delete Selected Element'));
    expect(screen.getByText('Delete Node')).toBeInTheDocument();
    confirmDialogAction(); // confirm via the dialog (scoped to modal-panel)
    expect(screen.queryByText('Retail POS #1')).not.toBeInTheDocument();

    // Undo restores ws-1 AND must re-select it so the inspector reopens.
    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));

    // The card title AND the inspector header both show the restored name.
    expect(screen.getAllByText('Retail POS #1').length).toBeGreaterThanOrEqual(1);
    expect(
      (document.querySelector('.inspector-field input[type="text"]') as HTMLInputElement).value,
    ).toBe('Retail POS #1');
    openRackPanel('edit'); expect(screen.getByText('Delete Selected Element')).toBeInTheDocument();
  });

  it('re-selects a node restored by undoing an immediate (wireless) delete', () => {
    renderEditor();

    // A freshly added hardware node has no wires → the immediate delete path
    // (hardware is deletable; Branch Locations are permanent anchors).
    fireEvent.click(screen.getByText('+ Hardware Node'));
    expect(screen.getAllByText('New Hardware').length).toBeGreaterThanOrEqual(1);
    openRackPanel('edit'); fireEvent.click(screen.getByText('Delete Selected Element'));
    expect(screen.queryByText('New Hardware')).not.toBeInTheDocument();

    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));

    // Undo re-selects the restored node — card AND inspector header match.
    expect(screen.getAllByText('New Hardware').length).toBeGreaterThanOrEqual(1);
    openRackPanel('edit'); expect(screen.getByText('Delete Selected Element')).toBeInTheDocument();
  });

  it('does not re-select a node when undoing a wire deletion', () => {
    renderEditor();

    // Select w-1 via its hitbox and delete it through the dialog.
    const hitbox = document.querySelector('.wire-hitbox') as Element;
    expect(hitbox).not.toBeNull();
    fireEvent.click(hitbox);
    openRackPanel('edit'); fireEvent.click(screen.getByText('Delete Selected Element'));
    confirmDialogAction(); // confirm the wire-delete dialog
    expect(getWireCount()).toBe(1);

    // Undo restores the wire — no node was restored, so nothing may be
    // re-selected (the Delete button must stay hidden).
    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));
    expect(getWireCount()).toBe(2);
    expect(screen.queryByText('Delete Selected Element')).not.toBeInTheDocument();
  });

  // ── Toast when a preset load drops the selection (#18) ────────────



// ── Wire creation via port connections ──────────────────────────

describe('NodeTopologyEditor — wire creation', () => {
  it('creates a wire when two ports on different nodes are connected', () => {
    renderEditor();
    // A fresh workspace gives the canvas a non-duplicate authorable pair
    // (store Location out → new workspace Location in) under typed gating.
    fireEvent.click(screen.getByText('+ Retail POS'));
    const baseline = getWireCount();

    fireEvent.click(portOf(nodeAt(0), 'right'));
    fireEvent.click(portOf(nodeAt(3), 'left'));

    expect(getWireCount()).toBe(baseline + 1);
  });

  it('rejects a duplicate connection with a toast and no new wire', () => {
    renderEditor();
    fireEvent.click(screen.getByText('+ Retail POS'));
    const baseline = getWireCount();

    fireEvent.click(portOf(nodeAt(0), 'right'));
    fireEvent.click(portOf(nodeAt(3), 'left'));
    expect(getWireCount()).toBe(baseline + 1);

    // Same two ports again — duplicate.
    fireEvent.click(portOf(nodeAt(0), 'right'));
    fireEvent.click(portOf(nodeAt(3), 'left'));

    expect(getWireCount()).toBe(baseline + 1);
    expect(screen.getByText('A wire already connects these ports.')).toBeInTheDocument();
  });

  it('cancels the connection when clicking the same node again', () => {
    renderEditor();
    const baseline = getWireCount();

    fireEvent.click(portOf(nodeAt(0), 'right'));
    fireEvent.click(portOf(nodeAt(0), 'right')); // same node → cancel

    expect(getWireCount()).toBe(baseline);
  });

  it('undoes a created wire in a single undo step', () => {
    renderEditor();
    fireEvent.click(screen.getByText('+ Retail POS'));
    const baseline = getWireCount();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    fireEvent.click(portOf(nodeAt(0), 'right'));
    fireEvent.click(portOf(nodeAt(3), 'left'));
    expect(getWireCount()).toBe(baseline + 1);

    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    expect(getWireCount()).toBe(baseline);
  });

  it('blocks a second workspace→warehouse fallback wire on the standard tier', () => {
    renderEditor();
    const baseline = getWireCount();

    // Add a second workspace, then connect it to the existing warehouse.
    fireEvent.click(screen.getByText('+ Retail POS'));
    // stock-out (new workspace right row 0) → stock-in (warehouse left row 2).
    connectRows(3, 'right', 0, 2, 'left', 2);

    expect(getWireCount()).toBe(baseline);
    expect(
      screen.getByText(
        'Multi-warehouse stock deduction fallback wires require a Pro Tier license.',
      ),
    ).toBeInTheDocument();
  });
});

// ── Duplicate detection vs defaulted (null) ports ───────────────

describe('NodeTopologyEditor — duplicate detection vs defaulted ports', () => {
  it('rejects a duplicate wire against a loaded wire whose ports are defaulted', async () => {
    // The backend stores from_port/to_port as Option<PortName> and legacy
    // topologies round-trip wires with no ports. The load path maps that to
    // undefined — the wire renders on the DEFAULT ports (source right →
    // target left). Reconnecting the same default ports must be rejected
    // as a duplicate, not silently create a second overlapping wire.
    mockLoadTopology.mockResolvedValue({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Loaded Store', x: 100, y: 200 },
        { id: 'ws-1', type: 'workspace', name: 'Loaded POS', x: 300, y: 100 },
      ],
      wires: [{ id: 'w-1', from_node_id: 'store-1', to_node_id: 'ws-1', direction: 'one-way' }],
    });

    renderEditor();

    await waitFor(() => expect(screen.getByText('Loaded Store')).toBeInTheDocument());

    const baseline = getWireCount();
    expect(baseline).toBe(1);

    fireEvent.click(portOf(nodeAt(0), 'right'));
    fireEvent.click(portOf(nodeAt(1), 'left'));

    expect(getWireCount()).toBe(baseline);
    expect(screen.getByText('A wire already connects these ports.')).toBeInTheDocument();
  });

  it('rejects a reversed duplicate against a loaded wire with defaulted ports', async () => {
    mockLoadTopology.mockResolvedValue({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Loaded Store', x: 100, y: 200 },
        { id: 'ws-1', type: 'workspace', name: 'Loaded POS', x: 300, y: 100 },
      ],
      wires: [{ id: 'w-1', from_node_id: 'store-1', to_node_id: 'ws-1', direction: 'one-way' }],
    });

    renderEditor();

    await waitFor(() => expect(screen.getByText('Loaded Store')).toBeInTheDocument());

    const baseline = getWireCount();
    // Inputs cannot start a connection in the left/right UX.
    fireEvent.click(portOf(nodeAt(1), 'left'));

    expect(getWireCount()).toBe(baseline);
    expect(screen.getByText('Input connectors receive connections; choose an output connector first.')).toBeInTheDocument();
  });

  it('treats a literal null port payload (serde None) as a defaulted port', async () => {
    // serde serializes Option<PortName>::None as JSON null. The payload
    // interface types it as optional-string, but the runtime wire can carry
    // explicit nulls — the load path must coalesce them to undefined so
    // duplicate detection and rendering agree on the defaults.
    mockLoadTopology.mockResolvedValue({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Loaded Store', x: 100, y: 200 },
        { id: 'ws-1', type: 'workspace', name: 'Loaded POS', x: 300, y: 100 },
      ],
      wires: [{
        id: 'w-1',
        from_node_id: 'store-1',
        to_node_id: 'ws-1',
        direction: 'one-way',
        from_port: null as unknown as string,
        to_port: null as unknown as string,
      }],
    });

    renderEditor();

    await waitFor(() => expect(screen.getByText('Loaded Store')).toBeInTheDocument());

    const baseline = getWireCount();
    fireEvent.click(portOf(nodeAt(0), 'right'));
    fireEvent.click(portOf(nodeAt(1), 'left'));

    expect(getWireCount()).toBe(baseline);
    expect(screen.getByText('A wire already connects these ports.')).toBeInTheDocument();
  });
});

// ── Canvas shortcuts vs focused chrome controls ─────────────────

describe('NodeTopologyEditor — canvas shortcuts vs focused chrome', () => {
  it('does not delete the canvas when a tool-rack button has keyboard focus', () => {
    renderEditor();

    // Clicking '+ Store Node' adds AND selects the new node; the button
    // keeps keyboard focus after the click (browser behavior). A stray
    // Delete/Backspace must NOT instantly delete the just-added node via
    // the immediate-delete (no-wires) path.
    const addBtn = screen.getByText('+ Store Node');
    fireEvent.click(addBtn);
    expect(getNodeCount()).toBe(4);

    addBtn.focus();
    fireEvent.keyDown(addBtn, { key: 'Delete' });

    expect(getNodeCount()).toBe(4);
    expect(screen.queryByText('Delete Node')).not.toBeInTheDocument();
  });

  it('keeps arrow-nudge inert while a tool-card has focus', () => {
    renderEditor();

    // Select a node WITHOUT an edit — a plain selection pushes no history,
    // so the Undo button's absence after the arrow key proves no nudge
    // (the nudge path would pushHistory).
    const firstNode = document.querySelector('.topology-node') as HTMLElement;
    fireEvent.mouseDown(firstNode, { button: 0 });
    fireEvent.mouseUp(firstNode);
    expect(document.querySelector('.node-selected')).not.toBeNull();
    expect(screen.queryByText('Undo (Ctrl+Z)')).not.toBeInTheDocument();

    const toolCard = screen.getByText('+ Store Node');
    toolCard.focus();
    fireEvent.keyDown(toolCard, { key: 'ArrowDown' });

    expect(screen.queryByText('Undo (Ctrl+Z)')).not.toBeInTheDocument();
  });

  it('keeps arrow-nudge and Escape inert while a header button has focus', () => {
    renderEditor();

    // Select a node so the nudge/selection paths would otherwise fire.
    const firstNode = document.querySelector('.topology-node') as HTMLElement;
    fireEvent.mouseDown(firstNode, { button: 0 });
    fireEvent.mouseUp(firstNode); // end the drag cleanly (no ghost drag)
    expect(document.querySelector('.node-selected')).not.toBeNull();

    const headerBtn = screen.getByText('Apply Topology');
    headerBtn.focus();

    // Arrow keys must not nudge the canvas (no history entry → no Undo).
    fireEvent.keyDown(headerBtn, { key: 'ArrowDown' });
    expect(screen.queryByText('Undo (Ctrl+Z)')).not.toBeInTheDocument();

    // Escape must not clear the selection under the focused control.
    fireEvent.keyDown(headerBtn, { key: 'Escape' });
    expect(document.querySelector('.node-selected')).not.toBeNull();
  });

  it('still deletes via Delete when a canvas node card itself has focus', () => {
    renderEditor();

    // The guard is chrome-scoped: canvas-internal elements (node cards,
    // ports, wire labels) keep their keyboard shortcuts. Hardware nodes are
    // deletable (Branch Locations are permanent anchors).
    fireEvent.click(screen.getByText('+ Hardware Node'));
    const count = getNodeCount();
    const addedNode = document.querySelectorAll('.topology-node')[count - 1] as HTMLElement;
    addedNode.focus();
    fireEvent.keyDown(addedNode, { key: 'Delete' });

    expect(getNodeCount()).toBe(count - 1);
  });

  it('does not open the delete dialog when Apply has focus and a wired node is selected', () => {
    renderEditor();

    // Select a WIRED node (store-1 has preset wires) — without the chrome
    // guard, Delete on the focused Apply button would hit the hasWires
    // branch and open the 'Delete Node' confirm dialog.
    const firstNode = document.querySelector('.topology-node') as HTMLElement;
    fireEvent.mouseDown(firstNode, { button: 0 });
    fireEvent.mouseUp(firstNode);
    expect(document.querySelector('.node-selected')).not.toBeNull();

    const applyBtn = screen.getByText('Apply Topology');
    applyBtn.focus();
    fireEvent.keyDown(applyBtn, { key: 'Delete' });

    // Chrome owns the keyboard while focused: no confirm dialog, and the
    // selection survives (the button itself is untouched).
    expect(screen.queryByText('Delete Node')).not.toBeInTheDocument();
    expect(document.querySelector('.node-selected')).not.toBeNull();
    expect(getNodeCount()).toBe(3);
  });

  it('does not delete the fresh node via Backspace when a tool-card keeps focus', () => {
    renderEditor();

    // Backspace shares the Delete branch — the guard must cover it too, or
    // a stray Backspace instantly deletes the just-added (no-wires) node.
    const addBtn = screen.getByText('+ Store Node');
    fireEvent.click(addBtn);
    expect(getNodeCount()).toBe(4);

    addBtn.focus();
    fireEvent.keyDown(addBtn, { key: 'Backspace' });

    expect(getNodeCount()).toBe(4);
    expect(screen.queryByText('Delete Node')).not.toBeInTheDocument();
  });
});

// ── Delete / Backspace key flow ─────────────────────────────────

describe('NodeTopologyEditor — Delete/Backspace key flow', () => {
  it('Delete key deletes a selected wireless node immediately without a dialog', async () => {
    renderEditor();
    const baseline = getNodeCount();

    // Hardware nodes are deletable (Branch Locations are permanent anchors).
    fireEvent.click(screen.getByText('+ Hardware Node'));
    await waitFor(() => expect(screen.getAllByText('New Hardware').length).toBeGreaterThanOrEqual(1));
    const nodes = document.querySelectorAll('.topology-node');
    fireEvent.mouseDown(nodes[nodes.length - 1] as Element, { button: 0 });

    fireEvent.keyDown(window, { key: 'Delete' });

    await waitFor(() => expect(getNodeCount()).toBe(baseline));
    expect(screen.queryByText('Delete Node')).not.toBeInTheDocument();
  });

  it('Backspace key behaves like Delete for a selected wireless node', async () => {
    renderEditor();
    const baseline = getNodeCount();

    fireEvent.click(screen.getByText('+ Hardware Node'));
    await waitFor(() => expect(screen.getAllByText('New Hardware').length).toBeGreaterThanOrEqual(1));
    const nodes = document.querySelectorAll('.topology-node');
    fireEvent.mouseDown(nodes[nodes.length - 1] as Element, { button: 0 });

    fireEvent.keyDown(window, { key: 'Backspace' });

    await waitFor(() => expect(getNodeCount()).toBe(baseline));
  });

  it('Delete key opens the confirm dialog for a wired node; Cancel leaves everything intact', () => {
    renderEditor();
    const nodeCount = getNodeCount();
    const wireCount = getWireCount();
    // ws-1 (Retail POS #1) is wired (w-1, w-2) and is NOT a Branch Location
    // anchor, so it is deletable and opens the confirm dialog.
    const wired = document.querySelector('.node-type-workspace') as HTMLElement;
    fireEvent.mouseDown(wired, { button: 0 });

    fireEvent.keyDown(window, { key: 'Delete' });

    expect(screen.getByText('Delete Node')).toBeInTheDocument();
    expect(screen.getByText(/This node has connected wires/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Delete Node')).not.toBeInTheDocument();
    expect(getNodeCount()).toBe(nodeCount);
    expect(getWireCount()).toBe(wireCount);
  });

  it('confirming the Delete-key dialog removes the wired node and its wires', () => {
    renderEditor();
    const nodeCount = getNodeCount();
    const wireCount = getWireCount();
    const wired = document.querySelector('.node-type-workspace') as HTMLElement;
    fireEvent.mouseDown(wired, { button: 0 });

    fireEvent.keyDown(window, { key: 'Delete' });
    confirmDialogAction(); // confirm via the dialog (scoped to modal-panel)

    expect(getNodeCount()).toBe(nodeCount - 1);
    // ws-1 (Retail POS #1) has TWO preset wires (w-1 from store-1 and w-2
    // to wh-1) — both go with it.
    expect(getWireCount()).toBe(wireCount - 2);
    expect(screen.queryByText('Delete Node')).not.toBeInTheDocument();
  });

  it('Delete key on a selected wire opens the wire dialog; confirm removes the wire', () => {
    renderEditor();
    const wireCount = getWireCount();

    const hitbox = document.querySelector('.wire-hitbox') as HTMLElement;
    fireEvent.click(hitbox);
    openRackPanel('edit'); expect(screen.getByText('Delete Selected Element')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Delete' });
    expect(screen.getByText('Delete Wire')).toBeInTheDocument();

    confirmDialogAction(); // confirm via the dialog (scoped to modal-panel)
    expect(getWireCount()).toBe(wireCount - 1);
  });
});

});

// ── Wire deletion vs an in-flight connection ───────────────────
// Deleting a wire is a single-wire mutation (like toggling direction), so
// it must NOT cancel a connection in flight — the source node and every
// port the pending connection references stay valid. The one exception:
// if the deleted wire is the EXACT duplicate pair the connection would
// create, the pending state must be cancelled — otherwise completing the
// connection after the delete silently recreates the wire the user just
// removed, bypassing the duplicate detector.

describe('NodeTopologyEditor — wire deletion keeps an in-flight connection', () => {
  it('deleting an unrelated wire keeps the connection in flight and it completes', () => {
    renderEditor();
    const baseline = getWireCount();

    // Start a connection from the store output — a fresh workspace gives
    // the canvas a non-duplicate authorable target under typed gating.
    fireEvent.click(screen.getByText('+ Retail POS'));
    fireEvent.click(portOf(nodeAt(0), 'right'));
    expect(nodeAt(0).className).toContain('node-connecting-source');
    expect(previewLine()).not.toBeNull();

    // Select and delete w-2 (workspace right -> warehouse left) — unrelated
    // to the store-1 -> new-workspace connection being built.
    const hitboxes = document.querySelectorAll('.wire-hitbox');
    fireEvent.click(hitboxes[1] as Element);
    openRackPanel('edit'); expect(screen.getByText('Delete Selected Element')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(screen.getByText('Delete Wire')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Delete'));
    expect(getWireCount()).toBe(baseline - 1);

    // The connection SURVIVED the unrelated wire delete.
    expect(nodeAt(0).className).toContain('node-connecting-source');
    expect(previewLine()).not.toBeNull();

    // And it still completes normally.
    fireEvent.click(portOf(nodeAt(3), 'left'));
    expect(getWireCount()).toBe(baseline);
  });

  it('deleting the exact duplicate pair cancels the in-flight connection', () => {
    renderEditor();
    const baseline = getWireCount();

    // Start a connection that is an EXACT duplicate of w-1 (store-1 right
    // -> ws-1 left — the same endpoints AND the same normalized ports).
    fireEvent.click(portOf(nodeAt(0), 'right'));
    expect(nodeAt(0).className).toContain('node-connecting-source');
    expect(previewLine()).not.toBeNull();

    // Delete w-1 mid-connection — this is the wire the connection would
    // recreate. The pending state must be cancelled, not left dangling to
    // silently duplicate the deleted wire on completion.
    const hitboxes = document.querySelectorAll('.wire-hitbox');
    fireEvent.click(hitboxes[0] as Element);
    openRackPanel('edit'); expect(screen.getByText('Delete Selected Element')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(screen.getByText('Delete Wire')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Delete'));
    expect(getWireCount()).toBe(baseline - 1);

    // Completing the connection must NOT recreate the deleted wire — it
    // should behave as a cancelled in-flight connection (no new wire).
    fireEvent.click(portOf(nodeAt(1), 'left'));
    expect(getWireCount()).toBe(baseline - 1);
  });

  it('deleting the duplicate pair cancels a connection started from the REVERSED endpoint', () => {
    renderEditor();
    const baseline = getWireCount();

    // Start the connection from the output side of w-2 (workspace right ->
    // warehouse left). Inputs cannot start connections in the UX.
    fireEvent.click(portOf(nodeAt(1), 'right'));
    expect(nodeAt(1).className).toContain('node-connecting-source');
    expect(previewLine()).not.toBeNull();

    const hitboxes = document.querySelectorAll('.wire-hitbox');
    fireEvent.click(hitboxes[1] as Element); // w-2: workspace right <-> warehouse left
    openRackPanel('edit'); expect(screen.getByText('Delete Selected Element')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(screen.getByText('Delete Wire')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Delete'));
    expect(getWireCount()).toBe(baseline - 1);

    // The pending state was cancelled — completing cannot recreate w-2.
    fireEvent.click(portOf(nodeAt(2), 'left'));
    expect(getWireCount()).toBe(baseline - 1);
  });
});

// ── Escape connection-cancel flow ───────────────────────────────

describe('NodeTopologyEditor — Escape connection-cancel flow', () => {
  it('Escape cancels an in-flight connection before it completes', () => {
    renderEditor();
    const baseline = getWireCount();

    // Start a connection from store-1's bottom port — a ghost preview line appears.
    fireEvent.click(portOf(nodeAt(2), 'right'));
    expect(previewLine()).not.toBeNull();

    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    fireEvent.keyDown(canvas, { key: 'Escape' });

    // Preview gone, and clicking a target port on another node does NOT
    // complete a wire — the connection was cancelled, not left dangling.
    expect(previewLine()).toBeNull();
    fireEvent.click(portOf(nodeAt(1), 'left'));
    expect(getWireCount()).toBe(baseline);
  });

  it('Escape during a connection also clears the current selection', () => {
    renderEditor();

    selectFirstNode();
    expect(document.querySelector('.topology-node.node-selected')).not.toBeNull();

    fireEvent.click(portOf(nodeAt(2), 'right'));
    expect(previewLine()).not.toBeNull();

    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    fireEvent.keyDown(canvas, { key: 'Escape' });

    expect(document.querySelector('.topology-node.node-selected')).toBeNull();
    expect(previewLine()).toBeNull();
  });

  it('Escape typed in a text field does not cancel the connection (input guard)', () => {
    renderEditor();
    const baseline = getWireCount();

    // Select a node so the inspector (with its text input) is open.
    selectFirstNode();
    fireEvent.click(screen.getByText('+ Retail POS'));
    fireEvent.click(portOf(nodeAt(0), 'right'));
    expect(previewLine()).not.toBeNull();

    const nameInput = document.querySelector(
      '.inspector-field input[type="text"]',
    ) as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    nameInput.focus();
    fireEvent.keyDown(nameInput, { key: 'Escape' });

    // The connection is still in flight — completing it creates the wire.
    expect(previewLine()).not.toBeNull();
    // Store location-out → warehouse left row 0 (location-in).
    fireEvent.click(portRowOf(nodeAt(3), 'left', 0));
    expect(getWireCount()).toBe(baseline + 1);
  });
});

// ── Pro-tier warehouse fallback wire label ──────────────────────

describe('NodeTopologyEditor — Pro-tier warehouse fallback label', () => {
  it('allows a second workspace→warehouse wire with the fallback label on Pro', () => {
    renderEditor({ currentTier: 'pro' });
    const baseline = getWireCount();

    // Add a second warehouse, then connect the workspace to it. The retail
    // preset already has one warehouse wire, so this is fallback priority 2.
    fireEvent.click(screen.getByText('+ Warehouse'));
    // stock-out (workspace right row 0) → stock-in (warehouse left row 2).
    connectRows(1, 'right', 0, 3, 'left', 2);

    expect(getWireCount()).toBe(baseline + 1);
    expect(
      screen.queryByText(
        'Multi-warehouse stock deduction fallback wires require a Pro Tier license.',
      ),
    ).not.toBeInTheDocument();

    // The new wire carries the fallback label — surfaced as its hover
    // tooltip (raw key in the identity-l10n mock), never as a canvas pill.
    const wires = document.querySelectorAll('.wire-group');
    const last = wires[wires.length - 1]!;
    const title = last.querySelector('.wire-hitbox title');
    expect(title?.textContent).toContain('topology-wire-label-fallback');
  });
});

// ── First warehouse wire: stock-deduct label ────────────────────

describe('NodeTopologyEditor — first warehouse wire stock-deduct label', () => {
  it('allows the first workspace→warehouse wire on standard tier with the stock-deduct label', async () => {
    // Custom topology with a warehouse but NO warehouse wires, so the first
    // ws→wh connection takes the stock-deduct (priority 1) path.
    mockLoadTopology.mockResolvedValue({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Store', x: 80, y: 120 },
        { id: 'ws-1', type: 'workspace', name: 'POS', x: 240, y: 80 },
        { id: 'wh-1', type: 'warehouse', name: 'WH', x: 420, y: 160 },
      ],
      wires: [],
    });
    renderEditor();

    await waitFor(() => expect(getNodeCount()).toBe(3));
    const baseline = getWireCount();

    // stock-out (workspace right row 0) → stock-in (warehouse left row 2) —
    // the first workspace→warehouse connection, allowed on the standard
    // tier, labelled as the primary stock-deduction path. Each stacked row
    // is a specific semantic, so the drop authors directly (no picker).
    connectRows(1, 'right', 0, 2, 'left', 2);

    expect(getWireCount()).toBe(baseline + 1);
    expect(
      screen.queryByText(
        'Multi-warehouse stock deduction fallback wires require a Pro Tier license.',
      ),
    ).not.toBeInTheDocument();

    const wires = document.querySelectorAll('.wire-group');
    const last = wires[wires.length - 1]!;
    const title = last.querySelector('.wire-hitbox title');
    expect(title?.textContent).toContain('topology-wire-label-stock-deduct');
  });
});

// ── Warehouse tool-card tier lock ───────────────────────────────

describe('NodeTopologyEditor — warehouse tool-card tier lock', () => {
  it('locks the warehouse tool-card on standard tier when a warehouse exists', () => {
    renderEditor(); // retail preset already contains a warehouse

    const locked = document.querySelector('.tool-card.locked');
    expect(locked).not.toBeNull();
    expect(locked!.textContent).toContain('Pro');

    const before = getNodeCount();
    fireEvent.click(screen.getByText('+ Warehouse'));
    // handleAddNode guards the tier: toast, no new node.
    expect(getNodeCount()).toBe(before);
    expect(
      screen.getByText('Multiple Warehouses require a Pro Tier license.'),
    ).toBeInTheDocument();
  });

  it('unlocks the warehouse tool-card on Pro tier and adds a warehouse', () => {
    renderEditor({ currentTier: 'pro' });

    expect(document.querySelector('.tool-card.locked')).toBeNull();

    const before = getNodeCount();
    fireEvent.click(screen.getByText('+ Warehouse'));
    expect(getNodeCount()).toBe(before + 1);
  });
});

// ── Warehouse inspector settings card ───────────────────────────

describe('NodeTopologyEditor — warehouse inspector settings card', () => {
  const selectWarehouse = () => {
    const warehouse = document.querySelector('.node-type-warehouse') as HTMLElement;
    expect(warehouse).not.toBeNull();
    fireEvent.mouseDown(warehouse, { button: 0 });
  };

  it('renders the Warehouse settings card with capacity and low-stock inputs', () => {
    renderEditor();
    selectWarehouse();

    expect(screen.getByText('Warehouse Settings')).toBeInTheDocument();
    expect(screen.getByLabelText(/Capacity/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Low-Stock Threshold/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Current Stock/)).toBeInTheDocument();
  });

  it('marks the diagram dirty when capacity is edited', async () => {
    const onDirtyChange = vi.fn();
    // Capacity edits are Pro-gated (round 78) — render at Pro so the edit lands.
    renderEditor({ currentTier: 'pro', onDirtyChange });
    // Wait for the post-load clean snapshot so the edit is the only delta.
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    selectWarehouse();

    fireEvent.change(screen.getByLabelText(/Capacity/), { target: { value: '500' } });

    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it('persists capacity and low-stock threshold through Apply', async () => {
    const onSave = vi.fn();
    // Capacity edits are Pro-gated (round 78) — render at Pro so the edits land.
    renderEditor({ currentTier: 'pro', onSave });
    selectWarehouse();

    fireEvent.change(screen.getByLabelText(/Capacity/), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText(/Low-Stock Threshold/), { target: { value: '25' } });

    await applyWithPin();

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    const [nodes] = onSave.mock.calls[0]!;
    const wh = nodes.find((n: { id: string }) => n.id === 'wh-1');
    expect(wh).toBeDefined();
    expect(wh.metadata.capacity).toBe(500);
    expect(wh.metadata.lowStockThreshold).toBe(25);
  });

  it('persists a Current Stock edit through Apply', async () => {
    const onSave = vi.fn();
    renderEditor({ onSave });
    selectWarehouse();

    fireEvent.change(screen.getByLabelText(/Current Stock/), { target: { value: '5' } });

    await applyWithPin();

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    const [nodes] = onSave.mock.calls[0]!;
    const wh = nodes.find((n: { id: string }) => n.id === 'wh-1');
    expect(wh).toBeDefined();
    expect(wh.metadata.stock).toBe(5);
  });
});

// ── Warehouse capacity tier lock ────────────────────────────────

describe('NodeTopologyEditor — warehouse capacity tier lock', () => {
  const selectWarehouse = () => {
    const warehouse = document.querySelector('.node-type-warehouse') as HTMLElement;
    expect(warehouse).not.toBeNull();
    fireEvent.mouseDown(warehouse, { button: 0 });
  };

  it('disables the capacity inputs on standard tier with a Pro lock badge and hint', () => {
    renderEditor();
    selectWarehouse();

    expect(screen.getByLabelText(/Capacity/)).toBeDisabled();
    expect(screen.getByLabelText(/Low-Stock Threshold/)).toBeDisabled();
    expect(document.querySelector('.inspector-lock-badge')).not.toBeNull();
    // The locked hint shows under both disabled fields.
    expect(screen.getAllByText('Upgrade to Pro to set capacity limits.')).toHaveLength(2);
  });

  it('keeps Current Stock editable on standard tier', () => {
    renderEditor();
    selectWarehouse();

    expect(screen.getByLabelText(/Current Stock/)).toBeEnabled();
  });

  it('enables all warehouse inputs on Pro tier without the lock badge', () => {
    renderEditor({ currentTier: 'pro' });
    selectWarehouse();

    expect(screen.getByLabelText(/Capacity/)).toBeEnabled();
    expect(screen.getByLabelText(/Low-Stock Threshold/)).toBeEnabled();
    expect(screen.getByLabelText(/Current Stock/)).toBeEnabled();
    expect(document.querySelector('.inspector-lock-badge')).toBeNull();
  });
});

// ── Warehouse low-stock telemetry ───────────────────────────────

describe('NodeTopologyEditor — warehouse low-stock telemetry', () => {
  const renderWarehouse = async (metadata: Record<string, unknown>) => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
        { id: 'wh-1', type: 'warehouse', name: 'Main Stock Room', x: 380, y: 140, metadata },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(2));
  };

  const badgeOf = () => {
    const wh = document.querySelector('.node-type-warehouse') as HTMLElement;
    return wh?.querySelector('.node-telemetry-badge');
  };

  it('shows a warning badge when stored stock is at or below the threshold', async () => {
    await renderWarehouse({ stock: 5, lowStockThreshold: 10 });

    const badge = badgeOf();
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('5 items');
    expect(badge?.className).toContain('telemetry-warning');
  });

  it('shows an online badge when stored stock is above the threshold', async () => {
    await renderWarehouse({ stock: 50, lowStockThreshold: 10 });

    const badge = badgeOf();
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('50 items');
    expect(badge?.className).toContain('telemetry-online');
  });

  it('formats stock against capacity when both are set', async () => {
    await renderWarehouse({ stock: 5, capacity: 1000, lowStockThreshold: 10 });
    expect(badgeOf()?.textContent).toBe('5 / 1000 items');
  });

  it('keeps the card badge hidden until stock is entered', async () => {
    await renderWarehouse({ capacity: 1000, lowStockThreshold: 10 });
    expect(badgeOf()).toBeNull();
  });
});

// ── Warehouse capacity validation ───────────────────────────────

describe('NodeTopologyEditor — warehouse capacity validation', () => {
  // Capacity checks are a Pro-tier feature — the fixture renders at Pro so
  // the guards are enforced (the standard-tier suppression is pinned in the
  // 'warehouse capacity tier gate' describe below).
  const renderStockedGraph = async (stock: number, capacity: number) => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-1', type: 'workspace', name: 'Retail POS', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-1', type: 'warehouse', name: 'Main Stock Room', x: 680, y: 140, metadata: { stock, capacity } },
      ],
      wires: [
        { id: 'w-loc', from_node_id: 'store-1', to_node_id: 'ws-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-scope', from_node_id: 'store-1', to_node_id: 'wh-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-stock', from_node_id: 'ws-1', to_node_id: 'wh-1', from_port_id: 'stock-out', to_port_id: 'stock-in', relationship_type: 'stock-routing', direction: 'one-way' },
      ],
    } as never);
    renderEditor({ currentTier: 'pro' });
    await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(3));
  };

  const warehouseNote = () =>
    /* the card's visually-hidden message span carries the error text;
       the header chip itself only shows the red ! marker */
    document.querySelector('.node-type-warehouse')?.querySelector('.node-validation-sr') ?? null;

  it('flags the Warehouse card when stock is at capacity', async () => {
    await renderStockedGraph(1000, 1000);

    const note = warehouseNote();
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain('capacity');
  });

  it('flags the Warehouse card when stock is over capacity', async () => {
    await renderStockedGraph(1200, 1000);
    expect(warehouseNote()).not.toBeNull();
  });

  it('keeps the Warehouse card clean while stock is below capacity', async () => {
    await renderStockedGraph(500, 1000);
    expect(warehouseNote()).toBeNull();
  });

  it('renders a wire-scoped warning marker on the at-capacity stock wire', async () => {
    await renderStockedGraph(1000, 1000);

    const marker = document.querySelector('.wire-validation-marker');
    expect(marker).not.toBeNull();
    // The marker sits inside the flagged wire's group, whose hitbox carries
    // the wire id — it cannot belong to a different wire.
    const group = marker?.closest('.wire-group');
    expect(group?.querySelector('.wire-hitbox')?.getAttribute('data-wire-id')).toBe('w-stock');
    // The marker's tooltip carries the localizable capacity message.
    expect(marker?.textContent).toContain('capacity');
  });

  it('keeps the wire marker hidden while stock is below capacity', async () => {
    await renderStockedGraph(500, 1000);
    expect(document.querySelector('.wire-validation-marker')).toBeNull();
  });
});

// ── Warehouse missing stock-routing prompt ──────────────────────

describe('NodeTopologyEditor — warehouse missing stock-routing prompt', () => {
  const renderUnwiredWarehouse = async (metadata: Record<string, unknown>) => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-1', type: 'workspace', name: 'Retail POS', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-1', type: 'warehouse', name: 'Main Stock Room', x: 680, y: 140, metadata },
      ],
      wires: [
        { id: 'w-loc', from_node_id: 'store-1', to_node_id: 'ws-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-scope', from_node_id: 'store-1', to_node_id: 'wh-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
      ],
    } as never);
    renderEditor({ currentTier: 'pro' });
    await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(3));
  };

  const warehouseNote = () =>
    /* the card's visually-hidden message span carries the error text;
       the header chip itself only shows the red ! marker */
    document.querySelector('.node-type-warehouse')?.querySelector('.node-validation-sr') ?? null;

  it('prompts to route stock in when a warehouse with room has no stock wire', async () => {
    await renderUnwiredWarehouse({ stock: 500, capacity: 1000 });

    const note = warehouseNote();
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain('stock');
  });

  it('keeps the prompt off a warehouse with room when a stock wire exists', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-1', type: 'workspace', name: 'Retail POS', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-1', type: 'warehouse', name: 'Main Stock Room', x: 680, y: 140, metadata: { stock: 500, capacity: 1000 } },
      ],
      wires: [
        { id: 'w-loc', from_node_id: 'store-1', to_node_id: 'ws-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-scope', from_node_id: 'store-1', to_node_id: 'wh-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-stock', from_node_id: 'ws-1', to_node_id: 'wh-1', from_port_id: 'stock-out', to_port_id: 'stock-in', relationship_type: 'stock-routing', direction: 'one-way' },
      ],
    } as never);
    renderEditor({ currentTier: 'pro' });
    await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(3));

    expect(warehouseNote()).toBeNull();
  });

  it('keeps the prompt off a full warehouse with no stock wire', async () => {
    await renderUnwiredWarehouse({ stock: 1000, capacity: 1000 });
    expect(warehouseNote()).toBeNull();
  });

  it('keeps the prompt off a warehouse without capacity metadata', async () => {
    await renderUnwiredWarehouse({ stock: 500 });
    expect(warehouseNote()).toBeNull();
  });

  it('keeps the prompt off a satellite warehouse fed by inventory-transfer (hub-and-spoke)', async () => {
    // Round 82: the hub receives stock-routing from the workspace; the
    // satellite receives warehouse-to-warehouse inventory-transfer. Both
    // are serviced — the satellite must not be flagged.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-1', type: 'workspace', name: 'Retail POS', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-hub', type: 'warehouse', name: 'Hub Stock Room', x: 680, y: 80, metadata: { stock: 500, capacity: 1000 } },
        { id: 'wh-sat', type: 'warehouse', name: 'Satellite Stock Room', x: 980, y: 80, metadata: { stock: 200, capacity: 500 } },
      ],
      wires: [
        { id: 'w-loc', from_node_id: 'store-1', to_node_id: 'ws-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-scope-hub', from_node_id: 'store-1', to_node_id: 'wh-hub', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-scope-sat', from_node_id: 'store-1', to_node_id: 'wh-sat', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-stock', from_node_id: 'ws-1', to_node_id: 'wh-hub', from_port_id: 'stock-out', to_port_id: 'stock-in', relationship_type: 'stock-routing', direction: 'one-way' },
        { id: 'w-transfer', from_node_id: 'wh-hub', to_node_id: 'wh-sat', from_port_id: 'transfer-out', to_port_id: 'transfer-in', relationship_type: 'inventory-transfer', direction: 'one-way' },
      ],
    } as never);
    renderEditor({ currentTier: 'pro' });
    await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(4));

    const satellite = [...document.querySelectorAll('.topology-node')].find((n) =>
      n.textContent?.includes('Satellite Stock Room'),
    );
    expect(satellite?.querySelector('.node-validation-note')).toBeNull();
  });

  it('flags a full satellite warehouse fed by inventory-transfer at capacity', async () => {
    // Round 83: a transfer INTO a full Stock Room is as illegal as a stock
    // wire — the satellite carries the card note AND the wire marker on
    // the transfer wire itself.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-1', type: 'workspace', name: 'Retail POS', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-hub', type: 'warehouse', name: 'Hub Stock Room', x: 680, y: 80, metadata: { stock: 500, capacity: 1000 } },
        { id: 'wh-sat', type: 'warehouse', name: 'Satellite Stock Room', x: 980, y: 80, metadata: { stock: 500, capacity: 500 } },
      ],
      wires: [
        { id: 'w-loc', from_node_id: 'store-1', to_node_id: 'ws-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-scope-hub', from_node_id: 'store-1', to_node_id: 'wh-hub', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-scope-sat', from_node_id: 'store-1', to_node_id: 'wh-sat', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-stock', from_node_id: 'ws-1', to_node_id: 'wh-hub', from_port_id: 'stock-out', to_port_id: 'stock-in', relationship_type: 'stock-routing', direction: 'one-way' },
        { id: 'w-transfer', from_node_id: 'wh-hub', to_node_id: 'wh-sat', from_port_id: 'transfer-out', to_port_id: 'transfer-in', relationship_type: 'inventory-transfer', direction: 'one-way' },
      ],
    } as never);
    renderEditor({ currentTier: 'pro' });
    await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(4));

    const satellite = [...document.querySelectorAll('.topology-node')].find((n) =>
      n.textContent?.includes('Satellite Stock Room'),
    );
    expect(satellite?.querySelector('.node-validation-note')).not.toBeNull();

    const marker = document.querySelector('.wire-validation-marker');
    expect(marker).not.toBeNull();
    expect(marker?.closest('.wire-group')?.querySelector('.wire-hitbox')?.getAttribute('data-wire-id')).toBe('w-transfer');
  });

  it('flags a full warehouse once even when two inbound stock-bearing wires feed it', async () => {
    // Round 89: the at-capacity error is once per TARGET warehouse, not once
    // per inbound wire — a satellite fed by both a stock wire and a transfer
    // wire shows exactly one card note and exactly one wire marker (on the
    // first inbound wire).
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-1', type: 'workspace', name: 'Retail POS', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-hub', type: 'warehouse', name: 'Hub Stock Room', x: 680, y: 80, metadata: { stock: 500, capacity: 1000 } },
        { id: 'wh-sat', type: 'warehouse', name: 'Satellite Stock Room', x: 980, y: 80, metadata: { stock: 500, capacity: 500 } },
      ],
      wires: [
        { id: 'w-loc', from_node_id: 'store-1', to_node_id: 'ws-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-scope-hub', from_node_id: 'store-1', to_node_id: 'wh-hub', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-scope-sat', from_node_id: 'store-1', to_node_id: 'wh-sat', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-stock', from_node_id: 'ws-1', to_node_id: 'wh-hub', from_port_id: 'stock-out', to_port_id: 'stock-in', relationship_type: 'stock-routing', direction: 'one-way' },
        { id: 'w-stock-sat', from_node_id: 'ws-1', to_node_id: 'wh-sat', from_port_id: 'stock-out', to_port_id: 'stock-in', relationship_type: 'stock-routing', direction: 'one-way' },
        { id: 'w-transfer', from_node_id: 'wh-hub', to_node_id: 'wh-sat', from_port_id: 'transfer-out', to_port_id: 'transfer-in', relationship_type: 'inventory-transfer', direction: 'one-way' },
      ],
    } as never);
    renderEditor({ currentTier: 'pro' });
    await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(4));

    const satellite = [...document.querySelectorAll('.topology-node')].find((n) =>
      n.textContent?.includes('Satellite Stock Room'),
    );
    expect(satellite?.querySelectorAll('.node-validation-note')).toHaveLength(1);

    const markers = document.querySelectorAll('.wire-validation-marker');
    expect(markers).toHaveLength(1);
    expect(markers[0]?.closest('.wire-group')?.querySelector('.wire-hitbox')?.getAttribute('data-wire-id')).toBe('w-stock-sat');
  });
});

// ── Validation panel stock-wire action ──────────────────────────

describe('NodeTopologyEditor — validation panel stock-wire action', () => {
  const renderUnwiredWarehouse = async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-1', type: 'workspace', name: 'Retail POS', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-1', type: 'warehouse', name: 'Main Stock Room', x: 680, y: 140, metadata: { stock: 500, capacity: 1000 } },
      ],
      wires: [
        { id: 'w-loc', from_node_id: 'store-1', to_node_id: 'ws-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-scope', from_node_id: 'store-1', to_node_id: 'wh-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
      ],
    } as never);
    renderEditor({ currentTier: 'pro' });
    await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(3));
  };

  const openPanel = async () => {
    fireEvent.click(screen.getByText(/Issues \(1\)/));
    return document.querySelector('.topology-validation-panel') as HTMLElement;
  };

  it('shows the Add stock wire action on the missing-stock-routing entry', async () => {
    await renderUnwiredWarehouse();
    const panel = await openPanel();

    expect(within(panel).getByText('Add stock wire')).toBeInTheDocument();
  });

  it('keeps the action off other per-node issues', async () => {
    // A workspace missing its Location In carries a per-node issue but has
    // no stock-wire action.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-1', type: 'workspace', name: 'Retail POS', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(2));

    fireEvent.click(screen.getByText(/Issues \(1\)/));
    expect(document.querySelector('.topology-validation-item-action')).toBeNull();
  });

  it('clicking Add stock wire jumps to the warehouse and shows the hint chip', async () => {
    await renderUnwiredWarehouse();
    const panel = await openPanel();

    fireEvent.click(within(panel).getByText('Add stock wire'));

    // Panel closes and the warehouse becomes the sole selection.
    expect(document.querySelector('.topology-validation-panel')).toBeNull();
    const selected = [...document.querySelectorAll('.topology-node.node-selected')] as HTMLElement[];
    expect(selected).toHaveLength(1);
    expect(selected[0]!.className).toContain('node-type-warehouse');

    // The one-click hint chip appears on the card.
    const hint = document.querySelector('.node-stock-wire-hint');
    expect(hint).not.toBeNull();
    // Round 84: the guidance covers BOTH sources — a workspace Stock Out
    // or another Stock Room's output (hub-and-spoke transfers).
    expect(hint?.textContent).toContain('another Warehouse\'s output');
  });

  it('keeps the hint chip hidden until the action is used', async () => {
    await renderUnwiredWarehouse();

    // The error note is present, but no hint chip — the chip is the
    // one-click affordance, not a duplicate of the note.
    expect(document.querySelector('.node-validation-note')).not.toBeNull();
    expect(document.querySelector('.node-stock-wire-hint')).toBeNull();
  });

  it('hides the hint chip once a stock wire resolves the issue', async () => {
    await renderUnwiredWarehouse();
    const panel = await openPanel();
    fireEvent.click(within(panel).getByText('Add stock wire'));
    expect(document.querySelector('.node-stock-wire-hint')).not.toBeNull();

    // Wire ws-1 stock-out → wh-1 stock-in (stacked rows: workspace right
    // row 0 = stock-out, warehouse left row 2 = stock-in), resolving the prompt.
    connectRows(1, 'right', 0, 2, 'left', 2);
    expect(getWireCount()).toBe(3);

    await waitFor(() => expect(document.querySelector('.node-stock-wire-hint')).toBeNull());
  });
});

// ── Missing-stock-routing dismiss (intentionally empty) ─────────

describe('NodeTopologyEditor — missing-stock-routing dismiss', () => {
  const unwiredFixture = {
    nodes: [
      { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
      { id: 'ws-1', type: 'workspace', name: 'Retail POS', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
      { id: 'wh-1', type: 'warehouse', name: 'Main Stock Room', x: 680, y: 140, metadata: { stock: 500, capacity: 1000 } },
    ],
    wires: [
      { id: 'w-loc', from_node_id: 'store-1', to_node_id: 'ws-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
      { id: 'w-scope', from_node_id: 'store-1', to_node_id: 'wh-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
    ],
  } as TopologyData;

  const renderUnwired = async (props?: Parameters<typeof renderEditor>[0]) => {
    mockLoadTopology.mockResolvedValueOnce(unwiredFixture);
    renderEditor({ currentTier: 'pro', ...props });
    await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(3));
  };

  const noteDismiss = () =>
    /* the dismiss lives inside the portal tooltip (document.body) — the
       card's overflow:hidden would clip an in-card tooltip */
    document.querySelector('.node-validation-note-dismiss') as HTMLElement | null;

  it('renders a dismiss action on the missing-stock-routing card note', async () => {
    await renderUnwired();
    expect(noteDismiss()).not.toBeNull();
  });

  it('keeps the dismiss action off other error notes', async () => {
    // A workspace missing its Location In is a hard integrity error — no
    // "intentionally empty" escape hatch exists for it.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-1', type: 'workspace', name: 'Retail POS', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(2));

    expect(document.querySelector('.node-validation-note-dismiss')).toBeNull();
  });

  it('dismissing the prompt hides the note and lets Apply succeed', async () => {
    const onSave = vi.fn();
    await renderUnwired({ onSave });

    expect(document.querySelector('.node-validation-note')).not.toBeNull();
    fireEvent.click(noteDismiss()!);

    await waitFor(() => expect(document.querySelector('.node-validation-note')).toBeNull());
    // Zero visible issues → the issues widget disappears entirely.
    expect(document.querySelector('.topology-issues-btn')).toBeNull();

    await applyWithPin();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it('keeps the dismissed state and the Apply bypass across a reload', async () => {
    const onSave = vi.fn();
    await renderUnwired({ onSave, branchId: 'b-dismiss' });
    fireEvent.click(noteDismiss()!);
    await waitFor(() => expect(document.querySelector('.node-validation-note')).toBeNull());

    // Reload the same branch — the persisted dismissal must still hide the
    // note and keep Apply unblocked.
    cleanup();
    mockLoadTopology.mockResolvedValueOnce({
      ...unwiredFixture,
      resolved_issue_keys: ['node:wh-1:topology-validation-warehouse-missing-stock-routing'],
    });
    renderEditor({ currentTier: 'pro', onSave, branchId: 'b-dismiss' });
    await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(3));

    expect(document.querySelector('.node-validation-note')).toBeNull();
    await applyWithPin();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });
});

// ── Warehouse capacity tier gate ────────────────────────────────

describe('NodeTopologyEditor — warehouse capacity tier gate', () => {
  const renderStandard = async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-1', type: 'workspace', name: 'Retail POS', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-1', type: 'warehouse', name: 'Main Stock Room', x: 680, y: 140, metadata: { stock: 1000, capacity: 1000 } },
      ],
      wires: [
        { id: 'w-loc', from_node_id: 'store-1', to_node_id: 'ws-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-scope', from_node_id: 'store-1', to_node_id: 'wh-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-stock', from_node_id: 'ws-1', to_node_id: 'wh-1', from_port_id: 'stock-out', to_port_id: 'stock-in', relationship_type: 'stock-routing', direction: 'one-way' },
      ],
    } as never);
    renderEditor(); // default standard tier
    await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(3));
  };

  it('suppresses the capacity note and wire marker on standard tier', async () => {
    await renderStandard();

    expect(document.querySelector('.node-type-warehouse')?.querySelector('.node-validation-note')).toBeNull();
    expect(document.querySelector('.wire-validation-marker')).toBeNull();
  });

  it('suppresses the missing-wire prompt on standard tier', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-1', type: 'workspace', name: 'Retail POS', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-1', type: 'warehouse', name: 'Main Stock Room', x: 680, y: 140, metadata: { stock: 500, capacity: 1000 } },
      ],
      wires: [
        { id: 'w-loc', from_node_id: 'store-1', to_node_id: 'ws-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-scope', from_node_id: 'store-1', to_node_id: 'wh-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
      ],
    } as never);
    renderEditor();
    await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(3));

    expect(document.querySelector('.node-type-warehouse')?.querySelector('.node-validation-note')).toBeNull();
  });
});

// ── Warehouse capacity tier notice ──────────────────────────────

describe('NodeTopologyEditor — warehouse capacity tier notice', () => {
  const renderGraph = async (tier: 'plus' | 'pro', metadata: Record<string, unknown>) => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-1', type: 'workspace', name: 'Retail POS', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-1', type: 'warehouse', name: 'Main Stock Room', x: 680, y: 140, metadata },
      ],
      wires: [
        { id: 'w-loc', from_node_id: 'store-1', to_node_id: 'ws-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-scope', from_node_id: 'store-1', to_node_id: 'wh-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
      ],
    } as never);
    renderEditor({ currentTier: tier });
    await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(3));
  };

  it('shows the notice on plus tier when capacity numbers are stored', async () => {
    await renderGraph('plus', { stock: 500, capacity: 1000 });

    const notice = document.querySelector('.topology-tier-notice');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain('capacity');
  });

  it('hides the notice on Pro tier with the same numbers', async () => {
    await renderGraph('pro', { stock: 500, capacity: 1000 });
    expect(document.querySelector('.topology-tier-notice')).toBeNull();
  });

  it('hides the notice on plus tier without capacity numbers', async () => {
    await renderGraph('plus', { stock: 500 });
    expect(document.querySelector('.topology-tier-notice')).toBeNull();
  });

  it('does not block Apply', async () => {
    const onSave = vi.fn();
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-1', type: 'workspace', name: 'Retail POS', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-1', type: 'warehouse', name: 'Main Stock Room', x: 680, y: 140, metadata: { stock: 500, capacity: 1000 } },
      ],
      wires: [
        { id: 'w-loc', from_node_id: 'store-1', to_node_id: 'ws-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-scope', from_node_id: 'store-1', to_node_id: 'wh-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
      ],
    } as never);
    renderEditor({ onSave });
    await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(3));

    expect(document.querySelector('.topology-tier-notice')).not.toBeNull();
    await applyWithPin();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });
});

// ── Zoom controls behavior ──────────────────────────────────────

describe('NodeTopologyEditor — zoom controls behavior', () => {
  it('zooms with the mouse wheel and Reset View returns to 100%', () => {
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    fireEvent.wheel(canvas, { deltaY: -100, clientX: 10, clientY: 10 });
    expect(document.querySelector('.canvas-zoom-level')?.textContent).toBe('110%');

    fireEvent.click(screen.getByText('Reset View'));
    expect(document.querySelector('.canvas-zoom-level')?.textContent).toBe('100%');
  });

  it('Fit All recomputes the zoom from the node bounds', () => {
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    fireEvent.wheel(canvas, { deltaY: -100, clientX: 10, clientY: 10 });
    expect(document.querySelector('.canvas-zoom-level')?.textContent).toBe('110%');

    fireEvent.click(screen.getByText('Fit All'));
    // Fit-to-bounds replaces the wheel zoom with a computed value (still
    // clamped to the 40%..200% range).
    expect(document.querySelector('.canvas-zoom-level')?.textContent).not.toBe('110%');
    expect(document.querySelector('.canvas-zoom-level')?.textContent).toMatch(/^(?:[4-9]\d|1\d\d|200)%$/);
  });

  it('floating zoom buttons step the zoom in and out', () => {
    renderEditor();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(document.querySelector('.canvas-zoom-level')?.textContent).toBe('125%');

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(document.querySelector('.canvas-zoom-level')?.textContent).toBe('100%');
  });

  it('clicking the zoom level opens a slider popover seeded with the current zoom', () => {
    renderEditor();
    const zoomBtn = screen.getByRole('button', { name: /zoom level/i });
    expect(zoomBtn).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(zoomBtn);
    expect(zoomBtn).toHaveAttribute('aria-expanded', 'true');
    const slider = document.querySelector('.canvas-zoom-slider-pop input[type="range"]') as HTMLInputElement;
    expect(slider).not.toBeNull();
    expect(slider.value).toBe('100');
  });

  it('dragging the slider changes the zoom live', () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: /zoom level/i }));
    const slider = document.querySelector('.canvas-zoom-slider-pop input[type="range"]') as HTMLInputElement;

    fireEvent.change(slider, { target: { value: '75' } });

    expect(document.querySelector('.canvas-zoom-level')?.textContent).toBe('75%');
    expect((document.querySelector('.node-canvas-viewport') as HTMLElement).style.transform).toContain('scale(0.75)');
  });

  it('Escape or an outside click closes the slider popover', () => {
    renderEditor();
    const zoomBtn = screen.getByRole('button', { name: /zoom level/i });
    fireEvent.click(zoomBtn);
    expect(document.querySelector('.canvas-zoom-slider-pop')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('.canvas-zoom-slider-pop')).toBeNull();
    expect(zoomBtn).toHaveAttribute('aria-expanded', 'false');

    // Reopen, then click the canvas background — the popover must close.
    fireEvent.click(zoomBtn);
    expect(document.querySelector('.canvas-zoom-slider-pop')).not.toBeNull();
    fireEvent.mouseDown(document.querySelector('.node-canvas-container')!);
    expect(document.querySelector('.canvas-zoom-slider-pop')).toBeNull();
  });
});

// ── Canvas pan ──────────────────────────────────────────────────

describe('NodeTopologyEditor — canvas pan', () => {
  beforeEach(() => {
    mockLoadTopology.mockResolvedValue(null);
  });

  it('pans the viewport when middle-button dragging on empty canvas background', () => {
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const viewport = document.querySelector('.node-canvas-viewport') as HTMLElement;
    expect(viewport.style.transform).toContain('translate(0px, 0px)');

    // Left-button empty-background drag is the marquee selector now, so pan
    // lives on the middle (or right) button. mousedown at (100,100), drag
    // to (150,130): the viewport must translate by the pointer delta (50, 30).
    fireEvent.mouseDown(canvas, { button: 1, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 150, clientY: 130 });
    fireEvent.mouseUp(document, { button: 1 });

    expect(viewport.style.transform).toContain('translate(50px, 30px)');
  });

  it('minimap viewport rect tracks pan/zoom in canvas coordinates (the −pan/zoom origin)', () => {
    renderEditor();
    const viewport = document.querySelector('.topology-minimap-viewport') as SVGRectElement;
    // Derive the live minimap scale from two known preset node rects
    // (store-1 at x=80, wh-1 at x=680 → 600 canvas px apart on the map).
    const nodeRects = [...document.querySelectorAll('.topology-minimap-node')]
      .map((r) => parseFloat(r.getAttribute('x')!));
    const scale = (nodeRects[2]! - nodeRects[0]!) / 600;
    const PAD = 8;
    const MIN_X = 80; // leftmost content edge of the retail preset
    // The box is the viewport rect ∩ content bounds. jsdom reports a 0px
    // canvas, so the view is a degenerate point at −pan/zoom and the box
    // renders as the minimum chip pinned toward that point's edge.
    const expectedX = (panX: number, zoom: number) => {
      const viewLeft = -panX / zoom;
      const ix0 = Math.max(viewLeft, MIN_X);
      const raw = PAD + (ix0 - MIN_X) * scale;
      return Math.min(Math.max(raw, PAD), PAD + 160 - 8);
    };

    // pan=0, zoom=1: the view origin sits left of the content box — the chip
    // pins to the left pad instead of the SVG clipping it mid-edge.
    expect(parseFloat(viewport.getAttribute('x')!)).toBeCloseTo(expectedX(0, 1));

    // Drag the view right (pan −200): the view origin enters the content
    // range and the box tracks −pan/zoom exactly.
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    fireEvent.mouseDown(canvas, { button: 1, clientX: 300, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(document, { button: 1 });
    expect(parseFloat(viewport.getAttribute('x')!)).toBeCloseTo(expectedX(-200, 1));

    // Zoom out to 0.8 (pan untouched): the origin math must divide the
    // pan by the new zoom — the visible canvas left edge is −200/0.8.
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(parseFloat(viewport.getAttribute('x')!)).toBeCloseTo(expectedX(-200, 0.8));

    // Pan the view far left (pan +300, origin far left of the content):
    // the intersection pins the chip at the content's left pad — the box
    // never spills past the map edge however far the view outgrows it.
    fireEvent.mouseDown(canvas, { button: 1, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 400, clientY: 100 });
    fireEvent.mouseUp(document, { button: 1 });
    expect(parseFloat(viewport.getAttribute('x')!)).toBeCloseTo(expectedX(300, 0.8));
  });

  it('does not open the context menu after a right-button pan drag', () => {
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    fireEvent.mouseDown(canvas, { button: 2, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 150, clientY: 130 });
    fireEvent.mouseUp(document, { button: 2 });
    // Browsers dispatch contextmenu after the right-button mouseup. A drag
    // must suppress that event; a stationary right-click remains a menu.
    fireEvent.contextMenu(canvas, { clientX: 150, clientY: 130 });

    expect(document.querySelector('.topology-context-menu')).toBeNull();
  });

  it('dragging a node moves the node and leaves the viewport translation untouched', () => {
    renderEditor();
    const firstNode = document.querySelector('.topology-node') as HTMLElement;
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const viewport = document.querySelector('.node-canvas-viewport') as HTMLElement;
    const beforeLeft = firstNode.style.left;

    // Mirrors the established node-drag pattern: node gets the mousedown,
    // the canvas receives the move/up events.
    fireEvent.mouseDown(firstNode, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 48, clientY: 48 });
    fireEvent.mouseUp(canvas, { button: 0 });

    expect(firstNode.style.left).not.toBe(beforeLeft);
    expect(viewport.style.transform).toContain('translate(0px, 0px)');
  });

  it('a grab-and-return drag with snap OFF leaves NO undo entry (undo would be a no-op)', () => {
    renderEditor();
    const firstNode = document.querySelector('.topology-node') as HTMLElement;
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    expect(firstNode.style.left).toBe('80px');

    // Snap off: positions are raw, so returning the cursor to the exact
    // start point restores the node to EXACTLY 80px. The gesture pushed a
    // history entry on first movement — a COMPLETED no-op drag must pop
    // it, so Undo never appears enabled but restores identical positions.
    openRackPanel('view'); fireEvent.click(screen.getByText('Snap to grid'));
    fireEvent.mouseDown(firstNode, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 48, clientY: 0 });
    expect(firstNode.style.left).toBe('128px');
    fireEvent.mouseMove(canvas, { clientX: 0, clientY: 0 });
    fireEvent.mouseUp(canvas, { button: 0 });

    expect(firstNode.style.left).toBe('80px');
    expect(screen.queryByText('Undo (Ctrl+Z)')).not.toBeInTheDocument();
  });

  it('a wiggle-and-return drag of an ON-GRID node with snap ON leaves NO undo entry', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [{ id: 'x', type: 'store', name: 'X', x: 96, y: 96 }],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(1));
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const node = document.querySelector('.topology-node') as HTMLElement;
    expect(node.style.left).toBe('96px');

    // Wiggle right and return: the on-grid origin (96) snaps back to
    // EXACTLY 96 — a completed drag that changed nothing. No undo entry.
    fireEvent.mouseDown(node, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 48, clientY: 0 });
    expect(node.style.left).toBe('144px');
    fireEvent.mouseMove(canvas, { clientX: 0, clientY: 0 });
    fireEvent.mouseUp(canvas, { button: 0 });

    expect(node.style.left).toBe('96px');
    expect(screen.queryByText('Undo (Ctrl+Z)')).not.toBeInTheDocument();
  });

  it('Space+drag pans like the middle button without clearing the selection or opening a marquee', () => {
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const viewport = document.querySelector('.node-canvas-viewport') as HTMLElement;

    // Select a node first (mousedown selects) — space-panning must not destroy it.
    fireEvent.mouseDown(document.querySelectorAll('.topology-node')[0]!, { button: 0 });
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(1);

    // Hold Space (arms the pan cursor), then LEFT-drag by (50, 30).
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    expect(canvas.className).toContain('canvas-space-pan');
    fireEvent.mouseDown(canvas, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 150, clientY: 130 });
    fireEvent.mouseUp(document, { button: 0 });
    fireEvent.keyUp(window, { code: 'Space', key: ' ' });

    expect(viewport.style.transform).toContain('translate(50px, 30px)');
    expect(document.querySelector('.topology-marquee')).toBeNull();
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(1);
  });

  it('releasing Space before the drag restores the left-drag marquee', () => {
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    fireEvent.keyUp(window, { code: 'Space', key: ' ' });

    fireEvent.mouseDown(canvas, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 650, clientY: 420 });
    fireEvent.mouseUp(canvas, { button: 0 });

    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(2);
  });

  it('Space on a focused wire cycles its direction instead of arming the pan', () => {
    renderEditor();
    const hitbox = document.querySelector('.wire-hitbox') as HTMLElement;
    const path = () => hitbox.parentElement!.querySelector('path.wire-path') as Element;
    expect(path().getAttribute('data-direction')).toBe('one-way');

    fireEvent.keyDown(hitbox, { code: 'Space', key: ' ' });

    expect(path().getAttribute('data-direction')).toBe('reverse');
    expect(document.querySelector('.node-canvas-container')!.className).not.toContain('canvas-space-pan');
  });

  it('the Pan tool turns left-drags into pans and preserves the selection', () => {
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const viewport = document.querySelector('.node-canvas-viewport') as HTMLElement;

    openRackPanel('view'); fireEvent.click(screen.getByText('Pan tool'));
    const toggle = screen.getByRole('button', { name: 'Pan tool' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(canvas.className).toContain('canvas-space-pan');

    fireEvent.mouseDown(document.querySelectorAll('.topology-node')[0]!, { button: 0 });
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(1);

    // Left-drag on empty canvas pans by the pointer delta, no marquee.
    fireEvent.mouseDown(canvas, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 150, clientY: 130 });
    fireEvent.mouseUp(document, { button: 0 });

    expect(viewport.style.transform).toContain('translate(50px, 30px)');
    expect(document.querySelector('.topology-marquee')).toBeNull();
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(1);
  });  it('turning the Pan tool off restores the left-drag marquee', () => {
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    openRackPanel('view'); fireEvent.click(screen.getByText('Pan tool'));
    openRackPanel('view'); fireEvent.click(screen.getByText('Pan tool'));
    expect(screen.getByRole('button', { name: 'Pan tool' })).toHaveAttribute('aria-pressed', 'false');
    expect(canvas.className).not.toContain('canvas-space-pan');

    fireEvent.mouseDown(canvas, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 650, clientY: 420 });
    fireEvent.mouseUp(canvas, { button: 0 });

    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(2);

  });

  it('window blur disarms a held Space so the next left-drag still marquees', () => {
    // Regression: the Space arming only had keydown/keyup writers. If the
    // window loses focus while Space is held (alt-tab, devtools, an OS
    // dialog), the browser delivers keyup to the NEW window — the editor
    // never sees it — so spacePanArmed stuck true, the canvas kept the pan
    // cursor, and the next left-drag PANNED instead of marquee-selecting.
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const viewport = document.querySelector('.node-canvas-viewport') as HTMLElement;

    // Arm the pan (Space held), then lose window focus without a keyup.
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    expect(canvas.className).toContain('canvas-space-pan');
    fireEvent.blur(window);

    // The pan must disarm: cursor class gone, and a left-drag on empty
    // canvas opens a marquee instead of panning the viewport.
    expect(canvas.className).not.toContain('canvas-space-pan');
    fireEvent.mouseDown(canvas, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 650, clientY: 420 });
    fireEvent.mouseUp(canvas, { button: 0 });

    expect(document.querySelector('.topology-marquee')).toBeNull(); // marquee is transient; released already
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(2);
    expect(viewport.style.transform).toContain('translate(0px, 0px)');
  });
});

// ── Touch gestures (pointer-event parity for tablets) ──────────
// jsdom has no PointerEvent, so test-setup.ts polyfills it; these tests
// drive the canvas's pointer handlers with pointerType 'touch'.

describe('NodeTopologyEditor — touch gestures', () => {
  beforeEach(() => {
    mockLoadTopology.mockResolvedValue(null);
  });

  it('single-finger drag on empty canvas pans the viewport', () => {
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const viewport = document.querySelector('.node-canvas-viewport') as HTMLElement;
    expect(viewport.style.transform).toContain('translate(0px, 0px)');

    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 150, clientY: 130 });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch' });

    expect(viewport.style.transform).toContain('translate(50px, 30px)');
  });

  it('a sub-threshold touch is a tap, not a pan', () => {
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const viewport = document.querySelector('.node-canvas-viewport') as HTMLElement;
    // Select a node first: a tap (no pan) must still clear the selection on
    // release, proving the gesture stayed a tap below the drag threshold.
    fireEvent.mouseDown(document.querySelectorAll('.topology-node')[0]!, { button: 0 });
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(1);

    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 105, clientY: 103 });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch' });

    expect(viewport.style.transform).toContain('translate(0px, 0px)');
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(0);
  });

  it('tap on empty canvas clears the node selection', () => {
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    // Select a node first (mouse path), then tap the background.
    fireEvent.mouseDown(document.querySelectorAll('.topology-node')[0]!, { button: 0 });
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(1);

    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch' });

    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(0);
  });

  it('two-finger pinch zooms toward the midpoint', () => {
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const viewport = document.querySelector('.node-canvas-viewport') as HTMLElement;

    // Fingers at (100,100) + (140,100): mid (120,100), dist 40.
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 });
    fireEvent.pointerDown(canvas, { pointerId: 2, pointerType: 'touch', clientX: 140, clientY: 100 });
    // Spread to dist 60, mid (130,100): zoom 1.5, pan (-50,-50).
    fireEvent.pointerMove(canvas, { pointerId: 2, pointerType: 'touch', clientX: 160, clientY: 100 });

    expect(document.querySelector('.canvas-zoom-level')?.textContent).toBe('150%');
    expect(viewport.style.transform).toContain('scale(1.5)');

    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerUp(canvas, { pointerId: 2, pointerType: 'touch' });
  });

  it('touch drag on a node card moves the node', () => {
    renderEditor();
    const firstNode = document.querySelector('.topology-node') as HTMLElement;
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const viewport = document.querySelector('.node-canvas-viewport') as HTMLElement;
    const beforeLeft = firstNode.style.left;

    fireEvent.pointerDown(firstNode, { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 48, clientY: 48 });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch' });

    expect(firstNode.style.left).not.toBe(beforeLeft);
    expect(viewport.style.transform).toContain('translate(0px, 0px)');
  });

  it('a second finger cancels an armed node drag and enters pinch', () => {
    renderEditor();
    const firstNode = document.querySelector('.topology-node') as HTMLElement;
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const beforeLeft = firstNode.style.left;

    // First finger lands on the node (arms a drag), second lands on the
    // background before any movement → pinch, never a node drag.
    fireEvent.pointerDown(firstNode, { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 });
    fireEvent.pointerDown(canvas, { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 200 });
    fireEvent.pointerMove(canvas, { pointerId: 2, pointerType: 'touch', clientX: 260, clientY: 200 });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerUp(canvas, { pointerId: 2, pointerType: 'touch' });

    expect(firstNode.style.left).toBe(beforeLeft);
    expect(document.querySelector('.canvas-zoom-level')?.textContent).not.toBe('100%');
  });
});

// ── Edge auto-pan while dragging ────────────────────────────────
// Dragging a node toward a canvas edge pans the viewport so the drag can
// continue across a large diagram instead of hitting the viewport clamp.

describe('NodeTopologyEditor — edge auto-pan while dragging', () => {
  beforeEach(() => {
    mockLoadTopology.mockResolvedValue(null);
  });

  const readPanX = () => {
    const viewport = document.querySelector('.node-canvas-viewport') as HTMLElement;
    const m = viewport.style.transform.match(/translate\(([-\d.]+)px/);
    return m ? Number(m[1]) : 0;
  };

  it('dragging a node into the right edge band pans the viewport', () => {
    renderEditor();
    mockCanvasSize(800, 600);
    const firstNode = document.querySelector('.topology-node') as HTMLElement;
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    expect(readPanX()).toBe(0);

    fireEvent.mouseDown(firstNode, { button: 0, clientX: 0, clientY: 0 });
    // Pointer 16px inside the right band (band starts at 752 of 800);
    // y=100 is mid-canvas so only the x axis pans.
    fireEvent.mouseMove(canvas, { clientX: 784, clientY: 100 });

    expect(readPanX()).toBeGreaterThan(0);
    expect(Number.parseInt(firstNode.style.left, 10)).toBeGreaterThan(80);
    fireEvent.mouseUp(canvas, { button: 0 });
  });

  it('touch drags auto-pan too (the gesture-loop closure sees fresh pan via refs)', () => {
    renderEditor();
    mockCanvasSize(800, 600);
    const firstNode = document.querySelector('.topology-node') as HTMLElement;
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    fireEvent.pointerDown(firstNode, { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 784, clientY: 100 });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch' });

    expect(readPanX()).toBeGreaterThan(0);
  });

  it('a drag far OUTSIDE the canvas holds at the clamp edge without panning', () => {
    renderEditor();
    mockCanvasSize(800, 600);
    const firstNode = document.querySelector('.topology-node') as HTMLElement;
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    expect(readPanX()).toBe(0);

    fireEvent.mouseDown(firstNode, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: -1000, clientY: -1000 });

    // The node holds at the clamp edge and the viewport never moved — the
    // pinned "never lose a node off-canvas" invariant stays intact.
    expect(firstNode.style.left).toBe('-192px');
    expect(readPanX()).toBe(0);
    fireEvent.mouseUp(canvas, { button: 0 });
  });
});

// ── Cursor readout isolation ────────────────────────────────────
// The HUD coordinate readout lives in its own rAF-owning component with
// its own document mousemove listener, so pointer movement re-renders the
// readout alone — never the whole editor (which used to re-render up to
// 60×/sec while the mouse moved over a large diagram).

describe('NodeTopologyEditor — cursor readout isolation', () => {
  beforeEach(() => {
    mockLoadTopology.mockResolvedValue(null);
  });

  it('updates from its OWN document-level listener, not the canvas handler', async () => {
    renderEditor();
    expect(document.querySelector('.canvas-hud-cursor')?.textContent).toBe('—');

    // A move on `document` never reaches the canvas's onMouseMove — only a
    // self-driven listener can update the readout. Pre-fix this stays '—'.
    fireEvent.mouseMove(document, { clientX: 200, clientY: 88 });
    await waitFor(() => expect(document.querySelector('.canvas-hud-cursor')?.textContent).toBe('200, 88'));
  });

  it('still shows canvas coordinates when the pointer moves over the canvas', async () => {
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    fireEvent.mouseMove(canvas, { clientX: 123, clientY: 45 });
    await waitFor(() => expect(document.querySelector('.canvas-hud-cursor')?.textContent).toBe('123, 45'));
  });

  it('reflects the current pan/zoom in the displayed coordinates', async () => {
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const viewport = document.querySelector('.node-canvas-viewport') as HTMLElement;

    // Pan the viewport, then move the pointer: the readout is in CANVAS
    // coords (pan subtracted), so a (150, 50) screen point with pan (50, 0)
    // reads as canvas (100, 50).
    fireEvent.mouseDown(canvas, { button: 1, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 150, clientY: 100 });
    fireEvent.mouseUp(document, { button: 1 });
    expect(viewport.style.transform).toContain('translate(50px, 0px)');

    fireEvent.mouseMove(canvas, { clientX: 150, clientY: 50 });
    await waitFor(() => expect(document.querySelector('.canvas-hud-cursor')?.textContent).toBe('100, 50'));
  });
});

// ── Multi-select, marquee, group drag, batch delete ────────────

describe('NodeTopologyEditor — multi-select & marquee', () => {
  it('marquee drag selects the nodes inside the box and clears on release', () => {
    renderEditor();
    mockCanvasSize(1200, 800);
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    // Preset geometry (identity zoom/pan): store-1 80–320 × 140–380,
    // ws-1 380–620 × 80–320, wh-1 680–920 × 140–380. A marquee from the
    // top-left to (650, 420) covers the first two but not the warehouse.
    fireEvent.mouseDown(canvas, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 650, clientY: 420 });
    expect(document.querySelector('.topology-marquee')).not.toBeNull();
    fireEvent.mouseUp(canvas, { button: 0 });

    expect(document.querySelector('.topology-marquee')).toBeNull();
    const selected = document.querySelectorAll('.topology-node.node-selected');
    expect(selected).toHaveLength(2);
    expect(selected[0]?.getAttribute('data-node-id')).toBe('store-1');
    expect(selected[1]?.getAttribute('data-node-id')).toBe('ws-1');
  });

  it('commits the marquee even when released outside the canvas (no leaked box)', () => {
    renderEditor();
    mockCanvasSize(1200, 800);
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    // Start the marquee over the canvas, then release OUTSIDE it — the
    // canvas onMouseUp never fires there, so the document-level finalizer
    // must commit the selection and disarm the box.
    fireEvent.mouseDown(canvas, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 650, clientY: 420 });
    fireEvent.mouseUp(document, { button: 0 });
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(2);

    // A subsequent mousemove must NOT re-open the marquee.
    fireEvent.mouseMove(canvas, { clientX: 800, clientY: 600 });
    expect(document.querySelector('.topology-marquee')).toBeNull();
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(2);
  });

  it('unmount disarms the marquee document finalizer (no leaked mouseup listener)', () => {
    // Regression: the unmount effect cleaned pan/drag/minimap listeners and
    // fresh-node timers, but NOT marqueeCleanupRef — a marquee started and
    // then unmounted (branch switch, screen navigation) left its document
    // mouseup listener armed. The leaked listener fired finalizeMarquee
    // against an unmounted editor on the next page-wide release.
    const { unmount } = renderEditor();
    mockCanvasSize(1200, 800);
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    // Arm the marquee: the document mouseup finalizer is attached.
    fireEvent.mouseDown(canvas, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 650, clientY: 420 });
    expect(document.querySelector('.topology-marquee')).not.toBeNull();

    // Spy AFTER arming so only unmount-time removals are attributed.
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    unmount();

    // The marquee's mouseup finalizer must be removed by unmount teardown.
    const mouseUpRemovals = removeSpy.mock.calls.filter(([type]) => type === 'mouseup');
    removeSpy.mockRestore();
    expect(mouseUpRemovals.length).toBeGreaterThan(0);
  });

  it('an authoritative reload cancels an in-flight marquee (canvas-replacement rule)', async () => {
    // Regression: the load effect cancels connection/hover/simulation on
    // canvas replacement but NOT the in-flight marquee — its document
    // mouseup finalizer stayed armed and the box stayed rendered. A reload
    // mid-marquee (branch switch, instance refresh) left a phantom
    // selection box on the NEW canvas that the next page-wide release
    // committed against stale coordinates.
    mockLoadTopology.mockResolvedValue({
      nodes: [
        { id: 'ws-1', type: 'workspace', name: 'POS One', x: 80, y: 120, metadata: { typeKey: 'store-pos' } },
        { id: 'ws-2', type: 'workspace', name: 'POS Two', x: 240, y: 80, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [],
    });

    renderWithProvidersSync(
      <ReloadingHarness
        next={[
          { instanceId: 'ws-1', typeKey: 'store-pos', name: 'POS Reloaded' },
          { instanceId: 'ws-2', typeKey: 'store-pos', name: 'POS Two' },
        ]}
      />,
      multiStoreFtl,
      sharedFtl,
    );

    // Initial legacy load renders the fixture (POS One/POS Two); POS
    // Reloaded only appears after the authoritative rebuild, so it is the
    // reload-complete marker.
    await waitFor(() => expect(screen.getByText('POS One')).toBeInTheDocument());
    mockCanvasSize(1200, 800);
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    // Arm and render the marquee.
    fireEvent.mouseDown(canvas, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 650, clientY: 420 });
    expect(document.querySelector('.topology-marquee')).not.toBeNull();

    // Canvas replaced mid-marquee — the box must not linger on the new
    // canvas.
    fireEvent.click(screen.getByText('reload-instances'));
    await waitFor(() => expect(screen.getByText('POS Reloaded')).toBeInTheDocument());
    expect(document.querySelector('.topology-marquee')).toBeNull();

    // A release after the reload must NOT commit a phantom selection from
    // the pre-reload box (both rebuilt ws nodes sit inside it pre-fix).
    fireEvent.mouseUp(document, { button: 0 });
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(0);
  });


  it('left→right marquee selects only fully-contained nodes (excludes partial overlaps)', () => {
    renderEditor();
    mockCanvasSize(1200, 800);
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    // Box (300,100)→(650,420): store-1 (80–320 × 140–380) and ws-1
    // (380–620 × 80–320) each poke OUTSIDE the box, so a forward drag must
    // NOT select them; wh-1 (680–920) is entirely clear too.
    fireEvent.mouseDown(canvas, { button: 0, clientX: 300, clientY: 100 });
    fireEvent.mouseMove(canvas, { clientX: 650, clientY: 420 });
    fireEvent.mouseUp(canvas, { button: 0 });

    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(0);
  });

  it('left→right marquee fully containing a node selects it', () => {
    renderEditor();
    mockCanvasSize(1200, 800);
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    // Box (0,0)→(650,420) fully contains store-1 (80–320 × 140–380) and
    // ws-1 (380–620 × 80–320); wh-1 (680+) is clear.
    fireEvent.mouseDown(canvas, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 650, clientY: 420 });
    fireEvent.mouseUp(canvas, { button: 0 });

    const selected = document.querySelectorAll('.topology-node.node-selected');
    expect(selected).toHaveLength(2);
    expect(selected[0]?.getAttribute('data-node-id')).toBe('store-1');
    expect(selected[1]?.getAttribute('data-node-id')).toBe('ws-1');
  });

  it('right→left marquee selects any node the box touches (partial overlap counts)', () => {
    renderEditor();
    mockCanvasSize(1200, 800);
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    // The same (300,100)→(650,420) box, dragged BACKWARD from (650,420):
    // store-1 and ws-1 poke out of it, yet a backward drag must still grab
    // every node the box touches.
    fireEvent.mouseDown(canvas, { button: 0, clientX: 650, clientY: 420 });
    fireEvent.mouseMove(canvas, { clientX: 300, clientY: 100 });
    fireEvent.mouseUp(canvas, { button: 0 });

    const selected = document.querySelectorAll('.topology-node.node-selected');
    expect(selected).toHaveLength(2);
    expect(selected[0]?.getAttribute('data-node-id')).toBe('store-1');
    expect(selected[1]?.getAttribute('data-node-id')).toBe('ws-1');
  });

  it('shift+drag marquee unions into the existing selection', () => {
    renderEditor();
    mockCanvasSize(1200, 800);
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    // Select store-1 + ws-1 with a forward marquee.
    fireEvent.mouseDown(canvas, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 650, clientY: 420 });
    fireEvent.mouseUp(canvas, { button: 0 });
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(2);

    // Shift+drag a box that fully contains wh-1 (680–920 × 140–380): it
    // JOINS the selection; nothing is lost.
    fireEvent.mouseDown(canvas, { button: 0, shiftKey: true, clientX: 650, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 1000, clientY: 500 });
    fireEvent.mouseUp(canvas, { button: 0 });

    const selected = document.querySelectorAll('.topology-node.node-selected');
    expect(selected).toHaveLength(3);
    const ids = Array.from(selected).map((el) => el.getAttribute('data-node-id'));
    expect(ids).toEqual(expect.arrayContaining(['store-1', 'ws-1', 'wh-1']));
  });

  it('shift+drag marquee that captures nothing leaves the selection intact', () => {
    renderEditor();
    mockCanvasSize(1200, 800);
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    fireEvent.mouseDown(canvas, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 650, clientY: 420 });
    fireEvent.mouseUp(canvas, { button: 0 });
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(2);

    // Shift+drag over the empty bottom-left (every node sits above y=380):
    // a non-additive marquee would clear the selection; Shift must keep it.
    fireEvent.mouseDown(canvas, { button: 0, shiftKey: true, clientX: 0, clientY: 500 });
    fireEvent.mouseMove(canvas, { clientX: 300, clientY: 800 });
    fireEvent.mouseUp(canvas, { button: 0 });

    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(2);
  });

  it('a plain drag after shift+drag still replaces the selection (no additive leak)', () => {
    renderEditor();
    mockCanvasSize(1200, 800);
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    fireEvent.mouseDown(canvas, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 650, clientY: 420 });
    fireEvent.mouseUp(canvas, { button: 0 });
    fireEvent.mouseDown(canvas, { button: 0, shiftKey: true, clientX: 650, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 1000, clientY: 500 });
    fireEvent.mouseUp(canvas, { button: 0 });
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(3);

    // A subsequent NON-shift marquee over wh-1 alone must replace, not grow.
    fireEvent.mouseDown(canvas, { button: 0, clientX: 650, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 1000, clientY: 500 });
    fireEvent.mouseUp(canvas, { button: 0 });

    const selected = document.querySelectorAll('.topology-node.node-selected');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.getAttribute('data-node-id')).toBe('wh-1');
  });

  it('a plain click on empty canvas clears the multi-selection', () => {
    renderEditor();
    mockCanvasSize(1200, 800);
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    fireEvent.mouseDown(canvas, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 650, clientY: 420 });
    fireEvent.mouseUp(canvas, { button: 0 });
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(2);

    // Click (no drag) on empty background below the warehouse card.
    fireEvent.mouseDown(canvas, { button: 0, clientX: 700, clientY: 500 });
    fireEvent.mouseUp(canvas, { button: 0 });
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(0);
  });

  it('Escape cancels an in-flight marquee box and disarms its finalizer', () => {
    renderEditor();
    mockCanvasSize(1200, 800);
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    // A marquee over the store card (80..320, 140..380) — a normal release
    // would select it.
    fireEvent.mouseDown(canvas, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(canvas, { clientX: 400, clientY: 300 });
    expect(document.querySelector('.topology-marquee')).not.toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.querySelector('.topology-marquee')).toBeNull();

    // The cancelled marquee cannot commit a selection on a later release.
    fireEvent.mouseUp(document, { button: 0, clientX: 400, clientY: 300 });
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(0);
  });

  it('dragging one selected node moves the whole group by the same delta', async () => {
    // Grid-aligned positions (multiples of 24) so the snapped delta is exact.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 96, y: 144 },
        { id: 'ws-a', type: 'workspace', name: 'POS A', x: 384, y: 144, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));
    mockCanvasSize(1200, 800);
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    // Marquee-select both, then drag the workspace by (48, 48).
    fireEvent.mouseDown(canvas, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 700, clientY: 500 });
    fireEvent.mouseUp(canvas, { button: 0 });
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(2);

    fireEvent.mouseDown(nodeAt(1), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 48, clientY: 48 });
    fireEvent.mouseUp(canvas, { button: 0 });

    // Both nodes travelled exactly +48 on each axis (48 is grid-aligned).
    expect(nodeAt(0).style.left).toBe('144px');
    expect(nodeAt(0).style.top).toBe('192px');
    expect(nodeAt(1).style.left).toBe('432px');
    expect(nodeAt(1).style.top).toBe('192px');
  });

  it('shift+click adds to the selection; a plain click collapses it', () => {
    renderEditor();
    const store = nodeAt(0);
    const ws = nodeAt(1);
    const wh = nodeAt(2);

    fireEvent.mouseDown(store, { button: 0 });
    fireEvent.mouseUp(store);
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(1);

    // Shift+click adds the second node without dropping the first.
    fireEvent.mouseDown(ws, { button: 0, shiftKey: true });
    fireEvent.mouseUp(ws);
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(2);

    // A plain click on a third node collapses to just it.
    fireEvent.mouseDown(wh, { button: 0 });
    fireEvent.mouseUp(wh);
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(1);
    expect(wh.classList.contains('node-selected')).toBe(true);
  });

  it('batch deletes selected nodes and their wires after confirmation, and undo restores them', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-a', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'ws-b', type: 'workspace', name: 'POS B', x: 680, y: 140, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [
        { id: 'w-1', from_node_id: 'store-1', from_port: 'right', to_node_id: 'ws-a', to_port: 'left', direction: 'one-way' },
        { id: 'w-2', from_node_id: 'store-1', from_port: 'right', to_node_id: 'ws-b', to_port: 'left', direction: 'one-way' },
      ],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));
    mockCanvasSize(1200, 800);
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    // Select the two wired workspaces (POS A + POS B) together — the
    // marquee starts past the branch anchor's right edge (80+240=320) and
    // extends past ws-b's right edge (680+240=920).
    fireEvent.mouseDown(canvas, { button: 0, clientX: 340, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 1000, clientY: 400 });
    fireEvent.mouseUp(canvas, { button: 0 });
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(2);

    // Batch delete: the pair has wires, so the count-aware dialog appears.
    openRackPanel('edit'); fireEvent.click(screen.getByText('Delete Selected Element'));
    expect(screen.getByText('Delete 2 Nodes')).toBeInTheDocument();
    confirmDialogAction(); // confirm via the dialog (scoped to modal-panel)
    await waitFor(() => expect(getNodeCount()).toBe(1)); // the branch anchor stays
    expect(getWireCount()).toBe(0);

    // One undo restores the whole batch.
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(getNodeCount()).toBe(3));
    expect(getWireCount()).toBe(2);
  });

  it('Delete key removes an unwired multi-selection immediately, no dialog', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
        { id: 'ws-a', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-1', type: 'warehouse', name: 'WH', x: 680, y: 140 },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));
    mockCanvasSize(1200, 800);
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    // Select store + workspace, leave the warehouse out of the box.
    fireEvent.mouseDown(canvas, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 650, clientY: 420 });
    fireEvent.mouseUp(canvas, { button: 0 });
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(2);

    fireEvent.keyDown(canvas, { key: 'Delete' });

    // The unwired workspace deletes immediately; the Branch Location anchor
    // survives (permanent anchors), so 2 of the 3 nodes remain.
    expect(getNodeCount()).toBe(2);
    expect(screen.queryByText('Delete 2 Nodes')).not.toBeInTheDocument();
    expect(document.querySelector('.topology-node[data-node-id="wh-1"]')).not.toBeNull();
    expect(document.querySelector('.topology-node[data-node-id="store-1"]')).not.toBeNull();
  });
});

// ── Apply failure resilience ────────────────────────────────────

describe('NodeTopologyEditor — Apply failure resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockLoadTopology.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps edits, stays dirty, and preserves undo when Apply fails', async () => {
    renderEditor({
      onSave: async () => {
        throw new Error('boom');
      },
    });

    // Make a dirty edit: add a node.
    fireEvent.click(screen.getByText('+ Store Node'));
    const countAfterEdit = getNodeCount();

    await applyWithPin();

    // The failure surfaces as an error toast (plainErrorMessage sanitizes the
    // thrown Error to the generic fallback, so pin the save-error key itself).
    await waitFor(() =>
      expect(screen.getByText(/topology-toast-save-error/)).toBeInTheDocument(),
    );

    // The in-memory edit survives the failed save.
    expect(getNodeCount()).toBe(countAfterEdit);

    // Still dirty WHILE the edit is present — the unsaved-changes chip stays.
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    // Undo still works — the pre-save history entry was not cleared.
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    expect(getNodeCount()).toBe(countAfterEdit - 1);
  });

  it('does not clear selection when Apply fails before the idMap branch', async () => {
    renderEditor({ onSave: vi.fn().mockRejectedValue(new Error('late-fail')) });

    fireEvent.click(screen.getByText('+ Store Node'));
    // Select a node so a selection exists before the failed save.
    selectFirstNode();
    const selectedBefore = document.querySelector('.topology-node.node-selected');
    expect(selectedBefore).not.toBeNull();

    await applyWithPin();

    await waitFor(() =>
      expect(screen.getByText(/topology-toast-save-error/)).toBeInTheDocument(),
    );

    // Selection survives — the failure returns before the idMap branch clears it.
    expect(document.querySelector('.topology-node.node-selected')).not.toBeNull();
  });

  it('adopts the authoritative topology when Apply rejects with a revision conflict', async () => {
    // A stale base revision can never retry successfully (round 133) — the
    // editor must reload the authoritative topology instead of stranding the
    // user on a stale canvas whose every Apply fails with the same conflict.
    // The mock returns a real (authoritative) diagram on EVERY load so the
    // reload visibly replaces the canvas — a null response is a deliberate
    // no-op for the standalone editor (it keeps the demo preset).
    mockLoadTopology.mockImplementation(async () => ({
      revision: 1,
      resolved_issue_keys: [],
      nodes: [{
        id: 'store-auth',
        type: 'store',
        name: 'Authoritative Branch',
        x: 80,
        y: 140,
      }],
      wires: [],
    }));

    renderEditor({
      onSave: async () => {
        // The backend serializes TopologyValidation as
        // { kind: 'topologyValidation', code: 'topology-revision-conflict', ... }.
        throw {
          kind: 'topologyValidation',
          code: 'topology-revision-conflict',
          nodeId: null,
          wireId: null,
          portId: null,
          message: 'topology revision conflict: expected 0, current 1',
        };
      },
    });

    // Initial authoritative load lands the diagram, then the user makes a
    // stale edit that will never be accepted.
    await waitFor(() => expect(getNodeCount()).toBe(1));
    fireEvent.click(screen.getByText('+ Store Node'));
    expect(getNodeCount()).toBe(2);

    await applyWithPin();

    // The conflict must trigger an authoritative reload that replaces the
    // stale canvas (back to the authoritative diagram's single node) — and
    // the reload must not be swallowed by the post-save skip guard.
    await waitFor(() => expect(getNodeCount()).toBe(1));
    expect(mockLoadTopology.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Wire click cycles direction ─────────────────────────────────

describe('NodeTopologyEditor — wire click direction cycle', () => {
  it('a single click on the wire selects it and cycles the direction', () => {
    renderEditor();

    const hitbox = document.querySelector('.wire-hitbox') as Element;
    const path = () => hitbox.parentElement!.querySelector('path.wire-path') as Element;
    expect(path().getAttribute('data-direction')).toBe('one-way');

    fireEvent.click(hitbox);
    expect(path().getAttribute('data-direction')).toBe('reverse');
    // The click also selects the wire (Delete button appears).
    openRackPanel('edit'); expect(screen.getByText('Delete Selected Element')).toBeInTheDocument();

    fireEvent.click(hitbox);
    expect(path().getAttribute('data-direction')).toBe('two-way');

    fireEvent.click(hitbox);
    expect(path().getAttribute('data-direction')).toBe('one-way');
  });

  it('cycles wire direction with Enter and Space (keyboard parity)', () => {
    renderEditor();

    const hitbox = document.querySelector('.wire-hitbox') as Element;
    const path = () => hitbox.parentElement!.querySelector('path.wire-path') as Element;
    expect(path().getAttribute('data-direction')).toBe('one-way');

    fireEvent.keyDown(hitbox, { key: 'Enter' });
    expect(path().getAttribute('data-direction')).toBe('reverse');

    fireEvent.keyDown(hitbox, { key: ' ' });
    expect(path().getAttribute('data-direction')).toBe('two-way');
  });
});

// ── Wire bend editing ────────────────────────────────────────────

describe('NodeTopologyEditor — wire bend editing', () => {
  /** Select w-1 (first wire) so its bend handles render. */
  const selectFirstWire = () => {
    const hitbox = document.querySelector('.wire-hitbox') as Element;
    fireEvent.click(hitbox);
    return hitbox;
  };

  /** Create a bend on w-1 by dragging its midpoint ghost to (400, 300). */
  const createBend = () => {
    const ghost = document.querySelector('.wire-bend-ghost') as Element;
    fireEvent.mouseDown(ghost, { button: 0, clientX: 350, clientY: 289 });
    fireEvent.mouseMove(document, { clientX: 400, clientY: 300 });
    fireEvent.mouseUp(document, { button: 0 });
  };

  it('creates a bend by dragging the midpoint ghost and routes the wire through it', () => {
    renderEditor();
    const hitbox = selectFirstWire();

    // Retail w-1 runs store right (320,364) → ws left (380,304); with no
    // bends the ghost sits at the curve's midpoint.
    const ghost = document.querySelector('.wire-bend-ghost') as Element;
    expect(ghost).not.toBeNull();
    expect(ghost.getAttribute('cx')).toBe('350');
    expect(ghost.getAttribute('cy')).toBe('289');

    createBend();

    const handle = document.querySelector('.wire-bend-handle') as Element;
    expect(handle).not.toBeNull();
    expect(handle.getAttribute('cx')).toBe('400');
    expect(handle.getAttribute('cy')).toBe('300');

    // The wire now routes through the bend as an orthogonal polyline.
    const path = hitbox.parentElement!.querySelector('path.wire-path') as Element;
    expect(path.getAttribute('d')).toBe('M 320 283 L 400 300 L 380 295');

    // The whole drag is ONE undo entry.
    openRackPanel('edit'); expect(screen.getByText('Undo (Ctrl+Z)')).toBeInTheDocument();
  });

  it('shows a bends-override note when any wire carries bends, and hides it otherwise', () => {
    renderEditor();
    // No bends yet — the elbow/curved toggle applies to every wire, no note.
    expect(screen.queryByText('Bends override routing on bent wires')).toBeNull();

    selectFirstWire();
    createBend();

    // The elbow toggle silently does nothing for a bent wire (authored
    // geometry wins) — the note makes that visible instead of lying.
    openRackPanel('view'); expect(screen.getByText('Bends override routing on bent wires')).toBeInTheDocument();
    // The toggle itself carries the same explanation as a tooltip.
    const toggle = screen.getByText('Elbow wires').closest('button');
    expect(toggle?.getAttribute('title')).toContain('Bends override');
  });

  it('moves an existing bend by dragging its handle', () => {
    renderEditor();
    const hitbox = selectFirstWire();
    createBend();

    const handle = document.querySelector('.wire-bend-handle') as Element;
    fireEvent.mouseDown(handle, { button: 0, clientX: 400, clientY: 300 });
    fireEvent.mouseMove(document, { clientX: 420, clientY: 280 });
    fireEvent.mouseUp(document, { button: 0 });

    expect(handle.getAttribute('cx')).toBe('420');
    expect(handle.getAttribute('cy')).toBe('280');
    const path = hitbox.parentElement!.querySelector('path.wire-path') as Element;
    expect(path.getAttribute('d')).toBe('M 320 283 L 420 280 L 380 295');
  });

  it('removes a bend on double-click, restoring the default curve', () => {
    renderEditor();
    const hitbox = selectFirstWire();
    createBend();

    const handle = document.querySelector('.wire-bend-handle') as Element;
    fireEvent.doubleClick(handle);

    expect(document.querySelector('.wire-bend-handle')).toBeNull();
    const path = hitbox.parentElement!.querySelector('path.wire-path') as Element;
    expect(path.getAttribute('d')).toContain('C');
  });

  it('undo restores the unbent wire', () => {
    renderEditor();
    const hitbox = selectFirstWire();
    createBend();

    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));

    expect(document.querySelector('.wire-bend-handle')).toBeNull();
    const path = hitbox.parentElement!.querySelector('path.wire-path') as Element;
    expect(path.getAttribute('d')).toContain('C');
  });

  it('marks the canvas dirty when a bend is created', () => {
    renderEditor();
    selectFirstWire();
    createBend();

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('a bend dragged away and back to its exact start leaves NO undo entry', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'ws-1', type: 'workspace', name: 'POS One', x: 80, y: 120, metadata: { typeKey: 'store-pos' } },
        { id: 'ws-2', type: 'workspace', name: 'POS Two', x: 240, y: 80, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [
        { id: 'w-1', from_node_id: 'ws-1', to_node_id: 'ws-2', direction: 'one-way', bends: [{ x: 200, y: 200 }] },
      ],
    });
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));

    // Select the wire: the click cycles direction (one entry, dirties the
    // canvas). Undo the cycle to return to the CLEAN baseline — undo keeps
    // the selection and the bend survives.
    const hitbox = document.querySelector('.wire-hitbox') as Element;
    fireEvent.click(hitbox);
    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    const handle = document.querySelector('.wire-bend-handle') as Element;
    expect(handle).not.toBeNull();

    // Drag the bend away and return the cursor to the exact start: the
    // bend lands back at (200, 200) — a completed no-op drag must pop the
    // entry it pushed on first movement.
    fireEvent.mouseDown(handle, { button: 0, clientX: 200, clientY: 200 });
    fireEvent.mouseMove(document, { clientX: 250, clientY: 250 });
    fireEvent.mouseMove(document, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(document, { button: 0 });

    expect(handle.getAttribute('cx')).toBe('200');
    expect(handle.getAttribute('cy')).toBe('200');
    expect(screen.queryByText('Undo (Ctrl+Z)')).not.toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes') === null).toBe(true);
  });

  it('a click without drag on a midpoint ghost creates nothing (no phantom bend, no dirty)', () => {
    renderEditor();
    // Select w-1 and cycle the direction back to one-way (3 clicks) so the
    // canvas is CLEAN before the ghost click — the direction-cycle dirty
    // would otherwise confound the assertion.
    const hitbox = document.querySelector('.wire-hitbox') as Element;
    fireEvent.click(hitbox);
    fireEvent.click(hitbox);
    fireEvent.click(hitbox);
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();

    const ghost = document.querySelector('.wire-bend-ghost') as Element;
    expect(ghost).not.toBeNull();

    // Mousedown + mouseup on the midpoint ghost with NO movement. Today
    // this inserts a phantom bend (a midpoint bend on a straight segment
    // is a geometric no-op) that dirties the canvas, survives Apply, and
    // has NO undo entry — the entry only pushes on first movement.
    // Mousedown + mouseup on the midpoint ghost with NO movement.
    fireEvent.mouseDown(ghost, { button: 0, clientX: 350, clientY: 289 });
    fireEvent.mouseUp(document, { button: 0 });

    // Boolean forms: chai's failure formatter walks DOM elements and can
    // throw on their getters, masking the real assertion with a TypeError.
    expect(document.querySelector('.wire-bend-handle') === null).toBe(true);
    expect(screen.queryByText('Unsaved changes') === null).toBe(true);
  });

  it('Escape cancels an in-flight bend drag, restoring the bend and popping the entry', () => {
    renderEditor();
    const hitbox = selectFirstWire();
    createBend(); // bend at (400, 300) — one undo entry (the creation)

    const handle = document.querySelector('.wire-bend-handle') as Element;
    fireEvent.mouseDown(handle, { button: 0, clientX: 400, clientY: 300 });
    fireEvent.mouseMove(document, { clientX: 420, clientY: 280 });
    // Bend now at (420, 280) — the move pushed a SECOND entry.
    fireEvent.keyDown(window, { key: 'Escape' });

    // The bend snaps back to where the drag started.
    expect(handle.getAttribute('cx')).toBe('400');
    expect(handle.getAttribute('cy')).toBe('300');
    const path = hitbox.parentElement!.querySelector('path.wire-path') as Element;
    expect(path.getAttribute('d')).toBe('M 320 283 L 400 300 L 380 295');

    // The cancelled MOVE left no entry: ONE undo reverts the creation.
    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));
    expect(document.querySelector('.wire-bend-handle')).toBeNull();
    expect(path.getAttribute('d')).toContain('C');
  });

  it('Escape cancels a bend creation started from a ghost, leaving no trace', () => {
    renderEditor();
    const hitbox = selectFirstWire(); // the selection click also cycles
    // direction (one undo entry — existing wire-click semantics)

    const ghost = document.querySelector('.wire-bend-ghost') as Element;
    fireEvent.mouseDown(ghost, { button: 0, clientX: 350, clientY: 289 });
    fireEvent.mouseMove(document, { clientX: 400, clientY: 300 });
    fireEvent.keyDown(window, { key: 'Escape' });

    // The whole creation gesture is cancelled: no bend, default curve. The
    // drag's entry was popped, so ONE undo reverts the selection's
    // direction cycle — it must NOT re-create the bend.
    expect(document.querySelector('.wire-bend-handle')).toBeNull();
    const path = hitbox.parentElement!.querySelector('path.wire-path') as Element;
    expect(path.getAttribute('d')).toContain('C');

    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));
    expect(document.querySelector('.wire-bend-handle')).toBeNull();
    expect(path.getAttribute('data-direction')).toBe('one-way');
  });

  it('an authoritative reload disarms an in-flight bend-drag (canvas-replacement rule)', async () => {
    // Regression: the load effect cancels connection/hover/simulation on
    // canvas replacement but NOT the in-flight bend-drag — its document
    // mousemove/mouseup listeners stayed armed, so a reload mid-drag left
    // the drag hanging on the new canvas: the next move wrote bend
    // coordinates to a wire by stale id and the release never restored the
    // pre-gesture bend position.
    mockLoadTopology.mockResolvedValue({
      nodes: [
        { id: 'ws-1', type: 'workspace', name: 'POS One', x: 80, y: 120, metadata: { typeKey: 'store-pos' } },
        { id: 'ws-2', type: 'workspace', name: 'POS Two', x: 240, y: 80, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [
        { id: 'w-1', from_node_id: 'ws-1', to_node_id: 'ws-2', direction: 'one-way', bends: [{ x: 200, y: 200 }] },
      ],
    });

    renderWithProvidersSync(
      <ReloadingHarness
        next={[
          { instanceId: 'ws-1', typeKey: 'store-pos', name: 'POS Reloaded' },
          { instanceId: 'ws-2', typeKey: 'store-pos', name: 'POS Two' },
        ]}
      />,
      multiStoreFtl,
      sharedFtl,
    );

    // Initial legacy load renders the fixture (POS One/POS Two); the
    // reload rebuilds from instances (POS Reloaded marks completion).
    await waitFor(() => expect(screen.getByText('POS One')).toBeInTheDocument());

    // Select the wire so its bend handle renders, then start the drag.
    // (This also pins the legacy-load bend preservation — the fixture's
    // bend must survive the initial saved-diagram load or the handle
    // never renders.)
    fireEvent.click(document.querySelector('.wire-hitbox') as Element);
    const handle = document.querySelector('.wire-bend-handle') as Element;
    expect(handle).not.toBeNull();
    fireEvent.mouseDown(handle, { button: 0, clientX: 200, clientY: 200 });
    fireEvent.mouseMove(document, { clientX: 220, clientY: 180 });

    // Spy AFTER arming so only reload-time removals are attributed.
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    fireEvent.click(screen.getByText('reload-instances'));
    await waitFor(() => expect(screen.getByText('POS Reloaded')).toBeInTheDocument());

    const gestureRemovals = removeSpy.mock.calls.filter(
      ([type]) => type === 'mousemove' || type === 'mouseup',
    );
    removeSpy.mockRestore();
    expect(gestureRemovals.length).toBeGreaterThan(0);
  });

  it('reveals midpoint bend ghosts on hover without selecting the wire', () => {
    renderEditor();
    expect(document.querySelector('.wire-bend-ghost')).toBeNull();

    const hitbox = document.querySelector('.wire-hitbox') as Element;
    fireEvent.mouseEnter(hitbox.parentElement as Element); // the wire group

    const ghost = document.querySelector('.wire-bend-ghost') as Element;
    expect(ghost).not.toBeNull();
    expect(ghost.getAttribute('cx')).toBe('350');
    expect(ghost.getAttribute('cy')).toBe('289');
    // Hover alone must NOT select the wire: no bend handles, no undo entry
    // (a click-to-select would push a direction-cycle entry).
    expect(document.querySelector('.wire-bend-handle')).toBeNull();
    expect(screen.queryByText('Undo (Ctrl+Z)')).not.toBeInTheDocument();
  });

  it('dragging a hover ghost creates the bend and selects the wire', () => {
    renderEditor();
    const hitbox = document.querySelector('.wire-hitbox') as Element;
    fireEvent.mouseEnter(hitbox.parentElement as Element);

    const ghost = document.querySelector('.wire-bend-ghost') as Element;
    fireEvent.mouseDown(ghost, { button: 0, clientX: 350, clientY: 289 });
    fireEvent.mouseMove(document, { clientX: 400, clientY: 300 });
    fireEvent.mouseUp(document, { button: 0 });

    expect(document.querySelector('.wire-bend-handle')).not.toBeNull();
    const path = hitbox.parentElement!.querySelector('path.wire-path') as Element;
    expect(path.getAttribute('d')).toBe('M 320 283 L 400 300 L 380 295');
    // The drag is exactly ONE undo entry (hover pushed nothing, and the
    // direction cycle never fired) — undo removes the bend.
    openRackPanel('edit'); expect(screen.getByText('Undo (Ctrl+Z)')).toBeInTheDocument();
    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));
    expect(document.querySelector('.wire-bend-handle')).toBeNull();
  });

  it('clears the hover ghost when the pointer leaves the wire', () => {
    renderEditor();
    const hitbox = document.querySelector('.wire-hitbox') as Element;
    const group = hitbox.parentElement as Element;
    fireEvent.mouseEnter(group);
    expect(document.querySelector('.wire-bend-ghost')).not.toBeNull();

    fireEvent.mouseLeave(group);
    expect(document.querySelector('.wire-bend-ghost')).toBeNull();
  });

  it('a completed bend drag is not cancelled by a later Escape', () => {
    renderEditor();
    const hitbox = selectFirstWire();
    createBend();

    const handle = document.querySelector('.wire-bend-handle') as Element;
    fireEvent.mouseDown(handle, { button: 0, clientX: 400, clientY: 300 });
    fireEvent.mouseMove(document, { clientX: 420, clientY: 280 });
    fireEvent.mouseUp(document, { button: 0 }); // drag completes

    fireEvent.keyDown(window, { key: 'Escape' });

    // Plain Escape clears the selection — the moved bend stays put.
    const path = hitbox.parentElement!.querySelector('path.wire-path') as Element;
    expect(path.getAttribute('d')).toBe('M 320 283 L 420 280 L 380 295');
    expect(document.querySelector('.wire-bend-handle')).toBeNull();
  });
});

// ── Hover-target preview snap ───────────────────────────────────

describe('NodeTopologyEditor — hover-target preview snap', () => {
  it('snaps the in-flight preview to a port when hovering near it', () => {
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    // Start a connection from warehouse's output.
    fireEvent.click(portOf(nodeAt(2), 'right'));

    // Move to ws-1's left input port: the UX exposes only left/right
    // connectors, so the preview should snap to the labeled Location In.
    // The port row center = 48 (header) + 157 (main) + 10 = 215.
    const wsX = parseFloat(nodeAt(1).style.left);
    const wsY = parseFloat(nodeAt(1).style.top);
    const targetX = wsX;
    const targetY = wsY + 48 + 157 + 10;
    fireEvent.mouseMove(canvas, { clientX: targetX, clientY: targetY });

    const preview = document.querySelector(
      'path.wire-path[opacity="0.5"]',
    ) as SVGPathElement | null;
    expect(preview).not.toBeNull();
    const d = preview!.getAttribute('d')!;
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const endX = nums[nums.length - 2]!;
    const endY = nums[nums.length - 1]!;
    // The preview endpoint snapped to the ws-1 left input port.
    expect(endX).toBeCloseTo(targetX, 1);
    expect(endY).toBeCloseTo(targetY, 1);
  });
});

// ── Wire arrow markers ──────────────────────────────────────────

describe('NodeTopologyEditor — wire arrow markers', () => {
  it('renders direction markers for one-way, reverse, and two-way wires', () => {
    renderEditor();

    // Retail preset wires are one-way: end marker only, no start marker.
    const oneWayPath = document.querySelector('path.wire-path.one-way');
    expect(oneWayPath).not.toBeNull();
    expect(oneWayPath!.getAttribute('marker-start')).toBeNull();
    expect(oneWayPath!.getAttribute('marker-end')).toBe('url(#arrow-end)');

    // Click the first wire: one-way → reverse. Reverse renders only the
    // START marker (pointing back along the path) and no end marker.
    const hitbox = document.querySelector('.wire-hitbox') as Element;
    fireEvent.click(hitbox);
    const reversePath = hitbox.parentElement!.querySelector('path.wire-path') as Element;
    expect(reversePath.getAttribute('data-direction')).toBe('reverse');
    expect(reversePath.getAttribute('marker-end')).toBeNull();
    expect(reversePath.getAttribute('marker-start')).toBe('url(#arrow-start)');

    // reverse → two-way: both markers render.
    fireEvent.click(hitbox);
    const twoWayPath = hitbox.parentElement!.querySelector('path.wire-path') as Element;
    expect(twoWayPath.getAttribute('data-direction')).toBe('two-way');
    expect(twoWayPath.getAttribute('marker-start')).toBe('url(#arrow-start)');
    expect(twoWayPath.getAttribute('marker-end')).toBe('url(#arrow-end)');

    // The other one-way wire is untouched.
    expect(document.querySelectorAll('path.wire-path.one-way').length).toBe(1);
  });
});

// ── Wire crossing under cards ───────────────────────────────────

describe('NodeTopologyEditor — wire crossing under cards', () => {
  it('draws the under-card segment ON TOP so a crossing wire reads as continuous', async () => {
    // The restaurant template's store→warehouse wire passes under the
    // middle POS card; mirror that geometry: a store→warehouse wire whose
    // bezier runs straight through ws-1's box. The under-card segment must
    // be drawn over the card (pointer-events-none) so the wire reads as one
    // continuous connection instead of vanishing under the card and
    // re-emerging as two broken pieces.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
        // Ports sit at y = node.y + NODE_PORT_Y (224), so this store→warehouse
        // wire runs along y=364; the middle POS card at y=260 covers it.
        { id: 'ws-1', type: 'workspace', name: 'POS', x: 380, y: 260, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-1', type: 'warehouse', name: 'Stock', x: 680, y: 140 },
      ],
      wires: [
        {
          id: 'w-cross', from_node_id: 'store-1', from_port: 'right', to_node_id: 'wh-1', to_port: 'left',
          from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location',
          direction: 'one-way', label: 'Binds Store',
        },
      ],
    } as never);
    renderEditor();
    await waitFor(() => expect(getWireCount()).toBe(1));
    expect(document.querySelectorAll('.node-wires-crossing path')).toHaveLength(1);
    const overlayPath = document.querySelector('.node-wires-crossing path') as Element;
    // Pointer-events-none: the overlay never steals clicks from the card.
    expect(overlayPath.getAttribute('pointer-events')).toBe('none');
  });

  it('renders no overlay when no wire crosses a card', () => {
    renderEditor();
    // Retail preset wires sit in the 60px gaps between adjacent cards —
    // nothing passes under a card, so there is nothing to overlay.
    expect(document.querySelectorAll('.node-wires-crossing path')).toHaveLength(0);
  });

  // SKIPPED — unfixable, not flaky. This test drives a "Test Order
  // Simulation" button that no longer exists: 4653d966 (2026-08-26, "PIN
  // remember checkbox, presets popover, validation UX improvements") deleted
  // the `.simulation-btn` control along with its `isSimulating` state. The
  // `topology-sim-start` / `topology-sim-stop` Fluent keys and the
  // `.wire-simulation-pulse` CSS rule survived that commit and are now
  // referenced by nothing outside this file and the a11y mock dictionary, so
  // `getByText` can never resolve. Left in place rather than deleted because
  // the geometry it asserts is real and still supported: `polylinePoint` and
  // `wireUnderCardSegments` (topologyWireGeometry.ts:134) exist precisely so
  // "a simulation pulse crosses each segment at constant speed". If the
  // control is ever restored, this test should pass unchanged — restore it
  // then. Until then it must NOT be re-widened into a describe.skip: the
  // other five tests in this block cover the live round-146 under-card
  // overlay and were silently skipped alongside it for 11 days.
  it.skip('rides the simulation pulse over the card it passes under', async () => {
    // Round 147: the wire reads continuous (round 146) but the simulation
    // pulse still travelled along the BASE path — under a card it blinked
    // out and re-emerged, breaking the continuity the overlay just fixed.
    // The hidden pulse must render on the overlay (same class, so the same
    // info-blue dot) and disappear once it clears the card.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
        { id: 'ws-1', type: 'workspace', name: 'POS', x: 380, y: 260, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-1', type: 'warehouse', name: 'Stock', x: 680, y: 140 },
      ],
      wires: [
        {
          id: 'w-cross', from_node_id: 'store-1', from_port: 'right', to_node_id: 'wh-1', to_port: 'left',
          from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location',
          direction: 'one-way', label: 'Binds Store',
        },
      ],
    } as never);
    renderEditor();
    await waitFor(() => expect(getWireCount()).toBe(1));

    // Fake timers only AFTER the async load settles — waitFor must not run
    // under frozen time.
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByText('Test Order Simulation'));
      // Advance to t=0.5 (step 50): the straight wire runs y=364 from
      // x=320 to x=680, so the pulse sits at (500, 364) — inside ws-1's
      // box [380,620]×[260,500]. The overlay must show it.
      act(() => {
        vi.advanceTimersByTime(30 * 50);
      });
      expect(document.querySelectorAll('.node-wires-crossing circle')).toHaveLength(1);

      // Advance past the card: t=0.95 → x≈662, clear of the box — the
      // overlay dot must vanish (the base dot renders again).
      act(() => {
        vi.advanceTimersByTime(30 * 45);
      });
      expect(document.querySelectorAll('.node-wires-crossing circle')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('mirrors the base wire hover on the under-card overlay segment', async () => {
    // Round 151: the base wire brightens + thickens on hover
    // (.wire-group:hover .wire-path) but the round-146 overlay path had no
    // hover treatment — so hovering a crossing wire re-broke the continuity
    // the overlay exists to provide (exposed parts brighten, the under-card
    // segment stays dim, the wire visibly splits again).
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
        { id: 'ws-1', type: 'workspace', name: 'POS', x: 380, y: 260, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-1', type: 'warehouse', name: 'Stock', x: 680, y: 140 },
      ],
      wires: [
        {
          id: 'w-cross', from_node_id: 'store-1', from_port: 'right', to_node_id: 'wh-1', to_port: 'left',
          from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location',
          direction: 'one-way', label: 'Binds Store',
        },
      ],
    } as never);
    renderEditor();
    await waitFor(() => expect(getWireCount()).toBe(1));
    const overlayPath = document.querySelector('.node-wires-crossing path') as Element;
    expect(overlayPath.getAttribute('class')).toBeNull();

    const hitbox = document.querySelector('.wire-hitbox') as Element;
    fireEvent.mouseEnter(hitbox.parentElement as Element); // the wire group

    expect(overlayPath.getAttribute('class')).toContain('node-wires-crossing-hover');
  });

  it('mirrors the base wire selection on the under-card overlay segment', async () => {
    // The same continuity rule as hover: clicking a crossing wire selects
    // it, and the base path turns info-blue + thickens — the under-card
    // segment must follow or the selected wire reads as two pieces.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
        { id: 'ws-1', type: 'workspace', name: 'POS', x: 380, y: 260, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-1', type: 'warehouse', name: 'Stock', x: 680, y: 140 },
      ],
      wires: [
        {
          id: 'w-cross', from_node_id: 'store-1', from_port: 'right', to_node_id: 'wh-1', to_port: 'left',
          from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location',
          direction: 'one-way', label: 'Binds Store',
        },
      ],
    } as never);
    renderEditor();
    await waitFor(() => expect(getWireCount()).toBe(1));
    const overlayPath = document.querySelector('.node-wires-crossing path') as Element;

    const hitbox = document.querySelector('.wire-hitbox') as Element;
    fireEvent.click(hitbox);

    expect(overlayPath.getAttribute('class')).toContain('node-wires-crossing-selected');
  });

  it('dims the under-card overlay segment with the base wire in hover-focus mode', async () => {
    // Hover-focus mode (a node hovered) dims non-neighbourhood wires
    // (.wire-group.wire-dimmed). The crossing store→warehouse wire is not
    // connected to the middle POS card, so hovering that card dims the
    // wire — the under-card segment must dim with it or it glows while
    // the rest of the wire fades.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
        { id: 'ws-1', type: 'workspace', name: 'POS', x: 380, y: 260, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-1', type: 'warehouse', name: 'Stock', x: 680, y: 140 },
      ],
      wires: [
        {
          id: 'w-cross', from_node_id: 'store-1', from_port: 'right', to_node_id: 'wh-1', to_port: 'left',
          from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location',
          direction: 'one-way', label: 'Binds Store',
        },
      ],
    } as never);
    renderEditor();
    await waitFor(() => expect(getWireCount()).toBe(1));
    const overlayPath = document.querySelector('.node-wires-crossing path') as Element;

    // Hover the middle POS card — the crossing wire is not connected to it.
    fireEvent.mouseEnter(nodeAt(1));

    expect(overlayPath.getAttribute('class')).toContain('node-wires-crossing-dimmed');
  });
});

// ── Fresh-node animation pulse ──────────────────────────────────

describe('NodeTopologyEditor — fresh-node animation pulse', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks a newly added node as fresh and clears the pulse after 400ms', () => {
    vi.useFakeTimers();
    renderEditor();

    fireEvent.click(screen.getByText('+ Store Node'));
    expect(document.querySelector('.topology-node.node-fresh')).not.toBeNull();

    // The 400ms fresh-pulse timer expires.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(document.querySelector('.topology-node.node-fresh')).toBeNull();
  });
});

// ── Undo history cap ────────────────────────────────────────────

describe('NodeTopologyEditor — undo history cap', () => {
  it('caps the undo stack at 50 entries, evicting the oldest', () => {
    renderEditor();
    const initial = getNodeCount(); // retail preset: 3

    // 51 node adds — each pushes one history entry; the cap (pushHistory
    // evicts when length > 50, so the stack holds at most 50) drops the
    // oldest, which is the snapshot of the ORIGINAL pre-edit state.
    for (let i = 0; i < 51; i++) {
      fireEvent.click(screen.getByText('+ Store Node'));
    }
    expect(getNodeCount()).toBe(initial + 51);

    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    // Exactly 50 undos are available: they walk back to initial + 1 (the
    // first add's snapshot is the evicted one).
    for (let i = 0; i < 50; i++) {
      fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    }
    expect(getNodeCount()).toBe(initial + 1);

    // The evicted oldest entry (the original state) is unreachable — the
    // 51st undo is a no-op on the empty stack.
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    expect(getNodeCount()).toBe(initial + 1);
  });
});

// ── Direction toggle undo/redo ──────────────────────────────────

describe('NodeTopologyEditor — direction cycle undo/redo', () => {
  it('undo restores the previous wire direction and redo re-applies it', () => {
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const hitbox = document.querySelector('.wire-hitbox') as Element;
    const path = () => hitbox.parentElement!.querySelector('path.wire-path') as Element;

    // one-way → reverse: the cycle pushes one history entry.
    fireEvent.click(hitbox);
    expect(path().getAttribute('data-direction')).toBe('reverse');

    // One undo returns to one-way; one redo re-applies reverse.
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    expect(path().getAttribute('data-direction')).toBe('one-way');
    fireEvent.keyDown(canvas, { key: 'y', ctrlKey: true });
    expect(path().getAttribute('data-direction')).toBe('reverse');
  });
});

// ── Connected label on regular wires ────────────────────────────

describe('NodeTopologyEditor — connected wire label', () => {
  it('labels a regular store→workspace wire as connected', () => {
    renderEditor();
    fireEvent.click(screen.getByText('+ Retail POS'));
    const baseline = getWireCount();

    fireEvent.click(portOf(nodeAt(0), 'right'));
    fireEvent.click(portOf(nodeAt(3), 'left'));
    expect(getWireCount()).toBe(baseline + 1);

    // Non-warehouse wires carry the plain connected label (raw identity key)
    // — surfaced as the wire's hover tooltip.
    const wires = document.querySelectorAll('.wire-group');
    const last = wires[wires.length - 1]!;
    const title = last.querySelector('.wire-hitbox title');
    expect(title?.textContent).toContain('topology-wire-label-connected');
  });
});

// ── Wire relabel undo ───────────────────────────────────────────

describe('NodeTopologyEditor — wire relabel undo', () => {
  it('undo restores the previous wire label in one step', () => {
    renderEditor();
    const hitbox = document.querySelector('.wire-hitbox') as Element;
    const label = () => hitbox.querySelector('title')?.textContent ?? '';
    expect(label()).toContain('Binds Store');

    // Right-click the wire → Rename wire (labels are hidden by default, so
    // the context menu is the affordance).
    fireEvent.contextMenu(hitbox);
    fireEvent.click(screen.getByText('Rename wire'));

    const input = document.querySelector('.wire-rename-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'X Wire' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(label()).toContain('X Wire');
    openRackPanel('edit'); expect(screen.getByText('Undo (Ctrl+Z)')).toBeInTheDocument();

    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));
    expect(label()).toContain('Binds Store');
  });
});

// ── Preset load cancels in-flight connection ────────────────────

describe('NodeTopologyEditor — canvas reload cancels in-flight connection', () => {

  it('cancels an in-flight connection when the canvas reloads from instances', async () => {
    // Saved diagram with a store + workspace; the harness then replaces the
    // canvas via a workspaceInstances reload (post-save/apply path).
    mockLoadTopology.mockResolvedValue({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Store', x: 80, y: 120 },
        { id: 'ws-1', type: 'workspace', name: 'POS', x: 240, y: 80 },
      ],
      wires: [],
    });
    renderWithProvidersSync(
      <ReloadingHarness
        next={[{ instanceId: 'ws-1', typeKey: 'store-pos', name: 'POS' }]}
      />,
      multiStoreFtl,
      sharedFtl,
    );

    await waitFor(() => expect(screen.getByText('Store')).toBeInTheDocument());

    fireEvent.click(portOf(nodeAt(0), 'right'));
    expect(previewLine()).not.toBeNull();

    // Trigger the workspaceInstances reload — the canvas is replaced.
    fireEvent.click(screen.getByText('reload-instances'));
    await waitFor(() => expect(previewLine()).toBeNull());

    // The stale connection cannot complete: a target click creates no wire.
    fireEvent.click(portOf(nodeAt(1), 'left'));
    expect(getWireCount()).toBe(0);
  });
});

// ── Wire-label toggle keeps an in-flight connection ─────────────
//
// Decision (pinned): a direction toggle is a SINGLE-WIRE mutation that
// leaves every node/port an in-flight connection references valid, so it
// must NOT cancel the connection — the codebase's rule is to cancel only
// when the CANVAS is replaced (preset load, instance reload), where a
// stale source node could mis-wire the new canvas. Cancelling on a toggle
// would destroy a deliberate two-step connection intent for an unrelated
// edit, and no other single-element interaction (node drag, selection
// click) cancels connections either. The toggle's history push is
// orthogonal: connection state is transient UI and is never captured in
// history, so neither the push nor its undo affects it.

describe('NodeTopologyEditor — wire click keeps an in-flight connection', () => {
  it('keeps the connection in flight across a direction cycle and completes it correctly', () => {
    renderEditor();
    const baseline = getWireCount();

    // Start a connection from the store's output — ghost preview + source
    // highlight. A fresh workspace gives a non-duplicate authorable target.
    fireEvent.click(screen.getByText('+ Retail POS'));
    fireEvent.click(portOf(nodeAt(0), 'right'));
    expect(previewLine()).not.toBeNull();
    expect(nodeAt(0).className).toContain('node-connecting-source');

    // Click the first wire (store right → workspace left): one-way → reverse.
    const hitbox = document.querySelector('.wire-hitbox') as Element;
    const path = () => hitbox.parentElement!.querySelector('path.wire-path') as Element;
    expect(path().getAttribute('data-direction')).toBe('one-way');
    fireEvent.click(hitbox);
    expect(path().getAttribute('data-direction')).toBe('reverse');

    // The connection SURVIVED the cycle: source highlight + ghost preview intact.
    expect(nodeAt(0).className).toContain('node-connecting-source');
    expect(previewLine()).not.toBeNull();

    // Completing the connection still creates the expected store→workspace
    // wire from the in-flight source — the cycle's history push did not
    // corrupt the pending state.
    fireEvent.click(portOf(nodeAt(3), 'left'));
    expect(getWireCount()).toBe(baseline + 1);
    const wires = document.querySelectorAll('.wire-group');
    const created = wires[wires.length - 1]!;
    const title = created.querySelector('.wire-hitbox title');
    expect(title?.textContent).toContain('topology-wire-label-connected');
  });

  it('keeps the connection in flight when the cycle is undone (history push is orthogonal)', () => {
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const baseline = getWireCount();

    fireEvent.click(screen.getByText('+ Retail POS'));
    fireEvent.click(portOf(nodeAt(0), 'right'));
    expect(previewLine()).not.toBeNull();

    // Cycle to reverse, then undo the cycle mid-connection.
    const hitbox = document.querySelector('.wire-hitbox') as Element;
    const path = () => hitbox.parentElement!.querySelector('path.wire-path') as Element;
    fireEvent.click(hitbox);
    expect(path().getAttribute('data-direction')).toBe('reverse');
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    expect(path().getAttribute('data-direction')).toBe('one-way');

    // The connection survived BOTH the cycle's history push and its undo.
    expect(nodeAt(0).className).toContain('node-connecting-source');
    expect(previewLine()).not.toBeNull();

    // And it still completes normally afterwards.
    fireEvent.click(portOf(nodeAt(3), 'left'));
    expect(getWireCount()).toBe(baseline + 1);
  });

  it('wire click does not bubble a cancel to the canvas (stopPropagation contract)', () => {
    // The wire's onClick must never reach a canvas-level background handler
    // (e.g. a future background-click-cancels-connection listener). Without
    // stopPropagation the cycle click bubbles to a container onClick — where
    // a background-click cancel would wrongly kill the in-flight connection
    // the cycle is supposed to leave untouched. The spy is a REACT-level
    // onClick on a wrapper container: native listeners on intermediate
    // elements fire regardless of React's synthetic stopPropagation (React
    // 17+ delegates at the root), so only the delegation-level handler
    // discriminates the fix.
    let canvasClicked = false;
    const onCanvasClick = () => { canvasClicked = true; };
    // Native <button> as the wrapper: an interactive element that would
    // receive the bubbled wire click, standing in for a future
    // canvas-level background-click-cancels-connection handler.
    function Wrap() {
      return <button type="button" onClick={onCanvasClick}><NodeTopologyEditor currentTier="plus" /></button>;
    }
    renderWithProvidersSync(<Wrap />, multiStoreFtl, sharedFtl);

    // Start a connection from the warehouse output.
    fireEvent.click(portOf(nodeAt(2), 'right'));
    expect(nodeAt(2).className).toContain('node-connecting-source');

    // Click the first wire to cycle its direction.
    const hitbox = document.querySelector('.wire-hitbox') as Element;
    fireEvent.click(hitbox);
    const path = () => hitbox.parentElement!.querySelector('path.wire-path') as Element;
    expect(path().getAttribute('data-direction')).toBe('reverse');

    // The click must NOT have bubbled to the wrapper's React onClick — a
    // background-click cancel handler must never fire for a wire
    // interaction.
    expect(canvasClicked).toBe(false);

    // The user's contract: a background mousedown on the canvas AFTER the
    // wire click must not cancel the in-flight connection — the cycle's
    // click never reached (and cannot arm) a background-click cancel.
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    fireEvent.mouseDown(canvas, { button: 0 });
    expect(nodeAt(2).className).toContain('node-connecting-source');
    expect(previewLine()).not.toBeNull();
  });

  it('surfaces the label + cycle hint as the wire hover tooltip', () => {
    renderEditor();

    // Every wire's native tooltip carries its label plus the click-to-cycle
    // hint (raw FTL key in the identity-l10n mock).
    const titles = [...document.querySelectorAll('.wire-hitbox title')];
    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) {
      expect(title.textContent).toContain('topology-wire-toggle-hint');
    }
    // The first retail wire's label appears in its tooltip.
    expect(titles[0]!.textContent).toContain('Binds Store');

    // And the tooltip never renders as visible canvas chrome.
    expect(document.querySelector('.wire-label-group')).toBeNull();
  });
});

// ── Escape on an open dialog does not touch canvas state ────────

describe('NodeTopologyEditor — dialog Escape isolation', () => {
  it('Escape cancelling the delete dialog keeps the node selected', async () => {
    renderEditor();

    // Select a wired node so the delete flow opens the confirm dialog.
    // ws-1 (Retail POS #1) is wired and NOT a Branch Location anchor, so it
    // is deletable and opens the dialog.
    const wired = document.querySelector('.node-type-workspace') as HTMLElement;
    fireEvent.mouseDown(wired, { button: 0 });
    openRackPanel('edit'); fireEvent.click(screen.getByText('Delete Selected Element'));
    expect(screen.getByText('Delete Node')).toBeInTheDocument();

    // Escape closes the dialog (the Modal's focus trap owns it). The Modal
    // primitive plays a 200ms exit fade (a986bc275) before unmounting, so
    // the unmount is asynchronous — await it like the shared Modal and
    // ConfirmDialog suites do.
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    fireEvent.keyDown(canvas, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Delete Node')).not.toBeInTheDocument());

    // ...without the editor's window-level handler stealing the selection
    // (the dialog must own the keyboard while it is open).
    expect(document.querySelector('.topology-node.node-selected')).not.toBeNull();
  });

});

// ── Tool-slot shortcuts + empty-state onboarding ────────────────

describe('NodeTopologyEditor — tool-slot shortcuts', () => {
  const lastNodeType = () => {
    const nodes = document.querySelectorAll('.topology-node');
    return nodes[nodes.length - 1]?.className ?? '';
  };

  it('1 spawns a store node, 2 a workspace, 3 a warehouse, 4 hardware', () => {
    // Pro tier: the standard-tier preset already owns a warehouse, which
    // would block the '3' slot on the multi-warehouse gate.
    renderEditor({ currentTier: 'pro' });
    const before = getNodeCount();
    // The 1–4 slots are canvas-scoped: the keydown must originate inside
    // the canvas container (the real surface a focused canvas produces).
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    fireEvent.keyDown(canvas, { key: '1' });
    expect(getNodeCount()).toBe(before + 1);
    expect(lastNodeType()).toContain('node-type-store');

    fireEvent.keyDown(canvas, { key: '2' });
    expect(lastNodeType()).toContain('node-type-workspace');

    fireEvent.keyDown(canvas, { key: '3' });
    expect(lastNodeType()).toContain('node-type-warehouse');

    fireEvent.keyDown(canvas, { key: '4' });
    expect(lastNodeType()).toContain('node-type-hardware');
    expect(getNodeCount()).toBe(before + 4);
  });

  it('does not spawn from a 1–4 keystroke outside the canvas (body focus)', () => {
    renderEditor({ currentTier: 'pro' });
    const before = getNodeCount();

    // Focus on the document body (no canvas interaction) must NOT spawn —
    // the slot shortcuts are canvas-scoped, so a stray keystroke anywhere
    // else in the app cannot create a node.
    fireEvent.keyDown(document.body, { key: '2' });
    expect(getNodeCount()).toBe(before);
  });

  it('does not spawn while the user is typing in a text field', () => {
    renderEditor();
    const before = getNodeCount();
    const input = document.querySelector('.node-config-input') as HTMLInputElement | null;
    expect(input).not.toBeNull();

    fireEvent.keyDown(input!, { key: '1' });
    expect(getNodeCount()).toBe(before);
  });

  it('does not spawn while a palette tool card owns focus', () => {
    renderEditor();
    const before = getNodeCount();
    const toolCard = document.querySelector('.tool-card') as HTMLElement | null;
    expect(toolCard).not.toBeNull();

    fireEvent.keyDown(toolCard!, { key: '2' });
    expect(getNodeCount()).toBe(before);
  });
});

describe('NodeTopologyEditor — empty-state onboarding', () => {
  beforeEach(() => {
    mockLoadTopology.mockResolvedValue(null);
  });

  it('shows an onboarding hint when the canvas has no nodes', async () => {
    // Provided-but-empty branches/instances = the real post-delete / fresh
    // install state: the canvas is unowned and must guide the user.
    renderEditor({ branchLocations: [], workspaceInstances: [] });

    await waitFor(() => expect(getNodeCount()).toBe(0));
    expect(screen.getByText('Build your store topology')).toBeInTheDocument();
    expect(screen.getByText(/press 1–4/)).toBeInTheDocument();
  });

  it('hides the hint once a node lands on the canvas', async () => {
    renderEditor({ branchLocations: [], workspaceInstances: [] });
    await waitFor(() => expect(getNodeCount()).toBe(0));
    expect(screen.getByText('Build your store topology')).toBeInTheDocument();

    fireEvent.keyDown(document.querySelector('.node-canvas-container')!, { key: '1' });
    await waitFor(() => expect(getNodeCount()).toBe(1));
    expect(screen.queryByText('Build your store topology')).not.toBeInTheDocument();
  });

  // ADR #45 §4.1 — "a mandatory root is not a decision, so do not make the
  // merchant place it." @branch-root exists exactly once per graph by contract,
  // so a fresh store that HAS a branch location must open on that root rather
  // than on an empty canvas asking for it. The two tests above cover the
  // genuinely rootless cases (no locations at all); this is the one where a
  // location exists and the diagram is empty.
  it('authors the Branch Location root for a fresh store that has a location', async () => {
    mockLoadTopology.mockResolvedValueOnce(null); // no saved diagram yet
    renderEditor({
      branchLocations: [{ id: 'store-1', name: 'Main Street' }],
      workspaceInstances: [],
    });

    await waitFor(() => expect(getNodeCount()).toBe(1));
    const root = document.querySelector('.topology-node[data-node-id="store-1"]') as HTMLElement;
    expect(root).toBeInTheDocument();
    // The onboarding hint must not compete with the root the contract required.
    expect(screen.queryByText('Build your store topology')).not.toBeInTheDocument();
  });

  it('does not mark the canvas dirty for a root the merchant never placed', async () => {
    // The auto-authored root lands in the same commitSnapshot as the loaded
    // graph, so it is part of the applied baseline. If it were added as an
    // edit instead, every fresh store would open showing "Unsaved changes" —
    // asking the merchant to Apply a decision they were never asked to make.
    mockLoadTopology.mockResolvedValueOnce(null);
    renderEditor({
      branchLocations: [{ id: 'store-1', name: 'Main Street' }],
      workspaceInstances: [],
    });

    await waitFor(() => expect(getNodeCount()).toBe(1));
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });
});

// ── Unsaved-changes indicator ────────────────────────────────────

describe('NodeTopologyEditor — unsaved-changes indicator', () => {
  it('shows the chip after an edit and clears it on Apply', async () => {
    renderEditor({ onSave: async () => undefined });
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();

    // A name edit is validation-safe (unlike adding a second branch), so
    // Apply can actually succeed and clear the indicator.
    const nameInput = document.querySelector('.node-config-input') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Renamed POS' } });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    await applyWithPin();
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument());
  });

  it('clears when undo returns the canvas to the saved state', () => {
    renderEditor();
    const nameInput = document.querySelector('.node-config-input') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Renamed POS' } });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('previews the Apply summary on the standalone canvas (no instance seed)', () => {
    // Round 153: the chip always uses the workspace-instance format — on a
    // standalone canvas the before-side is synthesized from the committed
    // snapshot (the demo preset), so a Store node (diagram-only) reads as
    // zero workspace vectors while a spawned workspace counts as a
    // creation, with the revision bump on every dirty change.
    renderEditor();
    const summary = () => document.querySelector('.topology-diff-summary')?.textContent ?? '';
    // Fresh preset: the snapshot equals the canvas, so the chip is hidden.
    expect(document.querySelector('.topology-diff-summary')).toBeNull();

    // Spawning a Store node is diagram-only — no workspace vector — but the
    // revision still bumps.
    fireEvent.click(screen.getByText('+ Store Node'));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(summary()).toContain('0 created');
    expect(summary()).toContain('0 updated');
    expect(summary()).toContain('0 archived');
    expect(summary()).toContain('0 type-changed');
    expect(summary()).toContain('rev 0 → 1');

    // A spawned workspace counts as a creation against the snapshot.
    fireEvent.click(screen.getByText('+ Retail POS'));
    expect(summary()).toContain('1 created');
  });

  it('previews the workspace-instance diff when instances are seeded', async () => {
    // Round 150: with real instances the chip reports what Apply actually
    // commits (workspace create/update/archive vectors), not canvas counts.
    renderEditor({
      workspaceInstances: [
        { instanceId: 'ws-existing', typeKey: 'store-pos', purposeKey: 'checkout', name: 'Front Register' },
      ],
      branchLocations: [{ id: 'store-1', name: 'Main Street' }],
    });
    await waitFor(() => expect(getNodeCount()).toBe(2));
    const summary = () => document.querySelector('.topology-diff-summary')?.textContent ?? '';
    // Fresh seed: the canvas equals the committed snapshot, so the chip is hidden.
    expect(document.querySelector('.topology-diff-summary')).toBeNull();

    // A Store node is a diagram-only change — no workspace vector, but the
    // revision still bumps.
    fireEvent.click(screen.getByText('+ Store Node'));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(summary()).toContain('0 created');
    expect(summary()).toContain('0 updated');
    expect(summary()).toContain('0 archived');
    expect(summary()).toContain('rev 0 → 1');
  });

  it('counts a spawned workspace as a creation in the workspace diff', async () => {
    renderEditor({
      workspaceInstances: [
        { instanceId: 'ws-existing', typeKey: 'store-pos', purposeKey: 'checkout', name: 'Front Register' },
      ],
      branchLocations: [{ id: 'store-1', name: 'Main Street' }],
    });
    await waitFor(() => expect(getNodeCount()).toBe(2));

    fireEvent.click(screen.getByText('+ Retail POS'));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    const summary = () => document.querySelector('.topology-diff-summary')?.textContent ?? '';
    expect(summary()).toContain('1 created');
    expect(summary()).toContain('0 updated');
    expect(summary()).toContain('0 archived');
  });

  it('counts a renamed workspace as an update in the workspace diff', async () => {
    renderEditor({
      workspaceInstances: [
        { instanceId: 'ws-existing', typeKey: 'store-pos', purposeKey: 'checkout', name: 'Front Register' },
      ],
      branchLocations: [{ id: 'store-1', name: 'Main Street' }],
    });
    await waitFor(() => expect(getNodeCount()).toBe(2));
    const summary = () => document.querySelector('.topology-diff-summary')?.textContent ?? '';

    // Select the workspace node (second card — the first is the store).
    fireEvent.mouseDown(nodeAt(1), { button: 0 });
    const nameInput = document.querySelector('.node-config-input') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Renamed Register' } });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(summary()).toContain('1 updated');
    expect(summary()).toContain('0 created');
    expect(summary()).toContain('0 archived');
  });

  it('counts a removed workspace as an archive in the workspace diff', async () => {
    renderEditor({
      workspaceInstances: [
        { instanceId: 'ws-existing', typeKey: 'store-pos', purposeKey: 'checkout', name: 'Front Register' },
      ],
      branchLocations: [{ id: 'store-1', name: 'Main Street' }],
    });
    await waitFor(() => expect(getNodeCount()).toBe(2));
    const summary = () => document.querySelector('.topology-diff-summary')?.textContent ?? '';

    fireEvent.mouseDown(nodeAt(1), { button: 0 });
    openRackPanel('edit'); fireEvent.click(screen.getByText('Delete Selected Element'));
    await waitFor(() => expect(getNodeCount()).toBe(1));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(summary()).toContain('1 archived');
    expect(summary()).toContain('0 created');
    expect(summary()).toContain('0 updated');
  });

  it('flags a type change as a recreate instead of a plain create plus archive', async () => {
    // Round 152: changing a workspace's type archives the old instance and
    // creates a NEW one with a fresh id (Critical #1) — a destructive
    // recreate the chip previously read as "1 created · 1 archived". It
    // must surface as a distinct type-changed count.
    renderEditor({
      workspaceInstances: [
        { instanceId: 'ws-existing', typeKey: 'store-pos', purposeKey: 'checkout', name: 'Front Register' },
      ],
      branchLocations: [{ id: 'store-1', name: 'Main Street' }],
    });
    await waitFor(() => expect(getNodeCount()).toBe(2));
    const summary = () => document.querySelector('.topology-diff-summary')?.textContent ?? '';

    // Select the workspace node (second card) and switch its type.
    fireEvent.mouseDown(nodeAt(1), { button: 0 });
    const select = typeSelect();
    fireEvent.change(select, { target: { value: 'restaurant-pos' } });

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(summary()).toContain('1 type-changed');
    expect(summary()).toContain('0 created');
    expect(summary()).toContain('0 archived');
    expect(summary()).toContain('0 updated');
  });
});

// ── Hover focus mode ─────────────────────────────────────────────

describe('NodeTopologyEditor — hover focus mode', () => {
  it('preserves the selected state while hovering a card', () => {
    renderEditor();
    const store = document.querySelector('.topology-node') as HTMLElement;

    fireEvent.mouseDown(store, { button: 0 });
    expect(store.classList.contains('node-selected')).toBe(true);
    fireEvent.mouseEnter(store);
    expect(store.classList.contains('node-selected')).toBe(true);
  });

  it('dims non-connected nodes while hovering a card and restores on leave', () => {
    renderEditor();
    const nodes = [...document.querySelectorAll('.topology-node')] as HTMLElement[];
    const [store, ws, wh] = nodes;

    // Retail preset: store-1 → ws-1 and ws-1 → wh-1. Hovering the store
    // keeps its direct neighbour lit and dims the unconnected warehouse.
    fireEvent.mouseEnter(store!);
    expect(store!.classList.contains('node-dimmed')).toBe(false);
    expect(ws!.classList.contains('node-dimmed')).toBe(false);
    expect(wh!.classList.contains('node-dimmed')).toBe(true);

    fireEvent.mouseLeave(store!);
    expect(document.querySelectorAll('.node-dimmed')).toHaveLength(0);
  });

  it('deleting the hovered node must not leave the remaining canvas dimmed', async () => {
    // Regression: the prune effect cleared selection and connection on node
    // removal but not the hover. React never fires mouseleave on unmount, so
    // the stale hovered id kept hoverConnections non-null and every
    // remaining card rendered dimmed until the next hover.
    renderEditor();
    const baseline = getNodeCount();

    // Add a wireless node (Delete removes it immediately, no dialog).
    // Hardware is deletable; Branch Locations are permanent anchors.
    fireEvent.click(screen.getByText('+ Hardware Node'));
    await waitFor(() => expect(screen.getAllByText('New Hardware').length).toBeGreaterThanOrEqual(1));
    const nodes = document.querySelectorAll('.topology-node');
    const last = nodes[nodes.length - 1] as HTMLElement;

    // Hover the card (focus mode dims the unconnected retail nodes)…
    fireEvent.mouseEnter(last);
    expect(document.querySelectorAll('.node-dimmed').length).toBeGreaterThan(0);

    // …then delete it while the pointer still rests over its position.
    fireEvent.keyDown(window, { key: 'Delete' });
    await waitFor(() => expect(getNodeCount()).toBe(baseline));

    // The deleted card is gone; the remaining cards must be lit again — a
    // stale hover must not dim the whole diagram.
    expect(document.querySelectorAll('.node-dimmed')).toHaveLength(0);
  });
});

// ── Canvas context menu ──────────────────────────────────────────

describe('NodeTopologyEditor — canvas context menu', () => {
  beforeEach(() => {
    mockLoadTopology.mockResolvedValue(null);
  });

  it('opens on right-click and spawns the chosen node at the cursor', () => {
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    fireEvent.contextMenu(canvas, { clientX: 400, clientY: 300 });
    expect(document.querySelector('.topology-context-menu')).not.toBeNull();

    const before = getNodeCount();
    fireEvent.click(screen.getByText('New Hardware'));
    expect(getNodeCount()).toBe(before + 1);
    expect(document.querySelector('.topology-context-menu')).toBeNull();

    // Spawned at the right-click point (identity transform → canvas coords
    // equal screen coords), snapped to the 24px grid: snap(400) = 408.
    const last = [...document.querySelectorAll('.topology-node')].pop() as HTMLElement;
    expect(last.className).toContain('node-type-hardware');
    expect(last.style.left).toBe('408px');
  });

  it('Select All selects every node from the context menu', () => {
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    fireEvent.contextMenu(canvas, { clientX: 100, clientY: 100 });
    fireEvent.click(screen.getByText('Select All'));
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(3);
    expect(document.querySelector('.topology-context-menu')).toBeNull();
  });

  it('closes on Escape', () => {
    renderEditor();
    fireEvent.contextMenu(document.querySelector('.node-canvas-container')!, { clientX: 100, clientY: 100 });
    expect(document.querySelector('.topology-context-menu')).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('.topology-context-menu')).toBeNull();
  });

  it('an authoritative reload closes the open context menu (canvas-replacement rule)', async () => {
    // Regression: the load effect resets connection/hover/sim/marquee on
    // canvas replacement but NOT the open context menu — a menu open when
    // a reload lands (branch switch, instance refresh) stayed on screen at
    // its stale position, offering actions (rename/delete/spawn) against
    // nodes or wires that were just replaced.
    mockLoadTopology.mockResolvedValue({
      nodes: [
        { id: 'ws-1', type: 'workspace', name: 'POS One', x: 80, y: 120, metadata: { typeKey: 'store-pos' } },
        { id: 'ws-2', type: 'workspace', name: 'POS Two', x: 240, y: 80, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [],
    });

    renderWithProvidersSync(
      <ReloadingHarness
        next={[
          { instanceId: 'ws-1', typeKey: 'store-pos', name: 'POS Reloaded' },
          { instanceId: 'ws-2', typeKey: 'store-pos', name: 'POS Two' },
        ]}
      />,
      multiStoreFtl,
      sharedFtl,
    );

    await waitFor(() => expect(screen.getByText('POS One')).toBeInTheDocument());

    // Open the canvas context menu.
    fireEvent.contextMenu(
      document.querySelector('.node-canvas-container') as HTMLElement,
      { clientX: 400, clientY: 300 },
    );
    expect(document.querySelector('.topology-context-menu')).not.toBeNull();

    // Canvas replaced mid-menu — the stale menu must close.
    fireEvent.click(screen.getByText('reload-instances'));
    await waitFor(() => expect(screen.getByText('POS Reloaded')).toBeInTheDocument());
    expect(document.querySelector('.topology-context-menu')).toBeNull();
  });

  it('navigates menuitems with arrow keys and wraps at the ends', () => {
    renderEditor();
    fireEvent.contextMenu(document.querySelector('.node-canvas-container')!, { clientX: 100, clientY: 100 });
    const menu = document.querySelector('.topology-context-menu') as HTMLElement;
    const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(items.length).toBeGreaterThanOrEqual(4); // 4 add-types + select all + fit + reset

    items[0]!.focus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    // Wrap forward from the last item back to the first.
    items[items.length - 1]!.focus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);
    // Wrap backward from the first item to the last.
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('shows the selection count + Clear selection when a marquee leaves a multi-selection', () => {
    renderEditor();
    mockCanvasSize(1200, 800);
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    // Forward marquee over store-1 + ws-1 (preset geometry: store-1
    // 80–320 × 140–380, ws-1 380–620 × 80–320) — both fully contained.
    fireEvent.mouseDown(canvas, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 650, clientY: 420 });
    fireEvent.mouseUp(canvas, { button: 0 });
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(2);

    // Right-click the empty canvas: the menu opens and the selection stays.
    fireEvent.contextMenu(canvas, { clientX: 100, clientY: 100 });
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(2);

    // The menu leads with the count and a clear action (scoped to the menu
    // — the HUD shows the same "N selected" readout at the canvas bottom).
    expect(screen.getByText('2 selected', { selector: '.topology-context-section-title' })).not.toBeNull();
    expect(screen.getByText('Clear selection', { selector: '.topology-context-item' })).not.toBeNull();
  });

  it('Clear selection clears the marquee selection and closes the menu', () => {
    renderEditor();
    mockCanvasSize(1200, 800);
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    fireEvent.mouseDown(canvas, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 650, clientY: 420 });
    fireEvent.mouseUp(canvas, { button: 0 });
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(2);

    fireEvent.contextMenu(canvas, { clientX: 100, clientY: 100 });
    fireEvent.click(screen.getByText('Clear selection'));

    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(0);
    expect(document.querySelector('.topology-context-menu')).toBeNull();
  });

  it('hides the selection section when nothing is selected', () => {
    renderEditor();
    fireEvent.contextMenu(document.querySelector('.node-canvas-container')!, { clientX: 100, clientY: 100 });
    expect(document.querySelector('.topology-context-menu')).not.toBeNull();
    expect(screen.queryByText('Clear selection', { selector: '.topology-context-item' })).toBeNull();
    expect(screen.queryByText('0 selected', { selector: '.topology-context-section-title' })).toBeNull();
  });
});

// ── Align & distribute toolbar ───────────────────────────────────

describe('NodeTopologyEditor — align & distribute toolbar', () => {
  beforeEach(() => {
    mockLoadTopology.mockResolvedValue(null);
  });

  const selectPair = () => {
    const nodes = [...document.querySelectorAll('.topology-node')] as HTMLElement[];
    fireEvent.mouseDown(nodes[0]!, { button: 0 });
    fireEvent.mouseDown(nodes[1]!, { button: 0, shiftKey: true });
  };

  it('appears only with 2+ selected and aligns tops', () => {
    renderEditor();
    expect(document.querySelector('.topology-align-toolbar')).toBeNull();

    selectPair();
    expect(document.querySelector('.topology-align-toolbar')).not.toBeNull();

    // Preset ys: store 140, ws 80 (different). Align top → both = 80.
    const beforeY = () => [...document.querySelectorAll('.topology-node')]
      .map((n) => parseInt((n as HTMLElement).style.top, 10));
    expect(beforeY()[0]).toBe(140);
    expect(beforeY()[1]).toBe(80);

    fireEvent.click(screen.getByRole('button', { name: 'Align top' }));
    const afterY = beforeY();
    expect(afterY[0]).toBe(80);
    expect(afterY[1]).toBe(80);
    expect(afterY[2]).toBe(140); // warehouse untouched
  });

  it('undo restores the pre-align geometry in one step', () => {
    renderEditor();
    const nodes = [...document.querySelectorAll('.topology-node')] as HTMLElement[];
    fireEvent.mouseDown(nodes[0]!, { button: 0 });
    fireEvent.mouseDown(nodes[1]!, { button: 0, shiftKey: true });

    fireEvent.click(screen.getByRole('button', { name: 'Align top' }));
    const yAfterAlign = () => [...document.querySelectorAll('.topology-node')]
      .map((n) => parseInt((n as HTMLElement).style.top, 10));
    expect(yAfterAlign()[0]).toBe(80);
    expect(yAfterAlign()[1]).toBe(80);
    openRackPanel('edit'); expect(screen.getByText('Undo (Ctrl+Z)')).toBeInTheDocument();

    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));
    const yAfterUndo = yAfterAlign();
    expect(yAfterUndo[0]).toBe(140);
    expect(yAfterUndo[1]).toBe(80);
  });

  it('distributes selected nodes evenly on the vertical axis', () => {
    renderEditor();
    // Select all three: shift-click after the first keeps the group.
    const nodes = [...document.querySelectorAll('.topology-node')] as HTMLElement[];
    fireEvent.mouseDown(nodes[0]!, { button: 0 });
    fireEvent.mouseDown(nodes[1]!, { button: 0, shiftKey: true });
    fireEvent.mouseDown(nodes[2]!, { button: 0, shiftKey: true });

    fireEvent.click(screen.getByRole('button', { name: 'Distribute vertically' }));

    // Sorted ys after distribution must have equal gaps: ws 80, store 110, wh 140.
    const ys = [...document.querySelectorAll('.topology-node')]
      .map((n) => parseInt((n as HTMLElement).style.top, 10))
      .sort((a, b) => a - b);
    expect(ys[1]! - ys[0]!).toBe(ys[2]! - ys[1]!);
  });

  it('settles a card that an align would stack onto a same-row neighbour', () => {
    renderEditor();
    // store-1 (80, 140) and wh-1 (680, 140) share a row — Align left
    // collapses both to x=80, stacking the moved card EXACTLY over the
    // anchor. The no-overlap invariant (rounds 140-143) must hold here
    // too: the moved card settles into a free spot instead of hiding
    // under its anchor, while the anchor keeps the alignment line.
    const nodes = [...document.querySelectorAll('.topology-node')] as HTMLElement[];
    fireEvent.mouseDown(nodes[0]!, { button: 0 }); // store-1
    fireEvent.mouseDown(nodes[2]!, { button: 0, shiftKey: true }); // wh-1

    fireEvent.click(screen.getByRole('button', { name: 'Align left' }));

    const rect = (el: HTMLElement) => ({
      x: parseInt(el.style.left, 10),
      y: parseInt(el.style.top, 10),
    });
    const anchor = rect(nodes[0]!);
    const moved = rect(nodes[2]!);
    const overlaps = anchor.x < moved.x + NODE_WIDTH && anchor.x + NODE_WIDTH > moved.x
      && anchor.y < moved.y + NODE_HEIGHT && anchor.y + NODE_HEIGHT > moved.y;
    expect(overlaps).toBe(false);
    // The anchor stays on the line; only the moved card settled away.
    expect(anchor).toEqual({ x: 80, y: 140 });
  });

  it('settles BOTH cards when a center-align collapses the pair onto the unselected neighbour', () => {
    renderEditor();
    // store-1 (80,140) and wh-1 (680,140): Align hcenter moves BOTH to
    // x=380 — colliding with each other AND with the unselected ws-1
    // (380,80) parked on the same column. Every card must stay visible.
    const nodes = [...document.querySelectorAll('.topology-node')] as HTMLElement[];
    fireEvent.mouseDown(nodes[0]!, { button: 0 }); // store-1
    fireEvent.mouseDown(nodes[2]!, { button: 0, shiftKey: true }); // wh-1

    fireEvent.click(screen.getByRole('button', { name: 'Align horizontal centers' }));

    const rect = (el: HTMLElement) => ({
      x: parseInt(el.style.left, 10),
      y: parseInt(el.style.top, 10),
    });
    const boxes = [rect(nodes[0]!), rect(nodes[1]!), rect(nodes[2]!)];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlaps = a.x < b.x + NODE_WIDTH && a.x + NODE_WIDTH > b.x
          && a.y < b.y + NODE_HEIGHT && a.y + NODE_HEIGHT > b.y;
        expect(overlaps).toBe(false);
      }
    }
  });
});

// ── Clipboard & bulk duplication ────────────────────────────────

describe('NodeTopologyEditor — clipboard & bulk duplication', () => {
  beforeEach(() => {
    mockLoadTopology.mockResolvedValue(null);
  });

  const selectNode = (i: number, shift = false) => {
    const nodes = [...document.querySelectorAll('.topology-node')] as HTMLElement[];
    fireEvent.mouseDown(nodes[i]!, { button: 0, shiftKey: shift });
  };
  const nodeCount = () => document.querySelectorAll('.topology-node').length;
  const nodePos = () => [...document.querySelectorAll('.topology-node')]
    .map((n) => ({
      x: parseInt((n as HTMLElement).style.left, 10),
      y: parseInt((n as HTMLElement).style.top, 10),
    }));

  it('Ctrl+D duplicates a selected node one grid step away and selects the copy', async () => {
    renderEditor();
    selectNode(0);

    fireEvent.keyDown(document, { key: 'd', ctrlKey: true });

    await waitFor(() => expect(nodeCount()).toBe(4));
    // Original untouched at (80, 140); copy lands +24 on both axes.
    const pos = nodePos();
    expect(pos).toContainEqual({ x: 80, y: 140 });
    expect(pos).toContainEqual({ x: 104, y: 164 });
    // The copy — not the original — is the new selection, so Ctrl+D cascades.
    const selected = [...document.querySelectorAll('.topology-node.node-selected')] as HTMLElement[];
    expect(selected).toHaveLength(1);
    expect(selected[0]!.style.left).toBe('104px');
  });

  it('Ctrl+D repeats cascade so each duplicate offsets from the last', async () => {
    renderEditor();
    selectNode(0);

    fireEvent.keyDown(document, { key: 'd', ctrlKey: true });
    await waitFor(() => expect(nodeCount()).toBe(4));
    fireEvent.keyDown(document, { key: 'd', ctrlKey: true });
    await waitFor(() => expect(nodeCount()).toBe(5));

    const pos = nodePos();
    expect(pos).toContainEqual({ x: 80, y: 140 });
    expect(pos).toContainEqual({ x: 104, y: 164 });
    expect(pos).toContainEqual({ x: 128, y: 188 });
  });

  it('Ctrl+D duplicates wires whose both endpoints are selected', async () => {
    renderEditor();
    // Retail preset already wires store→ws and ws→wh (2 wires); add a fresh
    // workspace and wire it store→new-ws so the pair is authorable.
    fireEvent.click(screen.getByText('+ Retail POS'));
    fireEvent.click(portOf(nodeAt(0), 'right'));
    fireEvent.click(portOf(nodeAt(3), 'left'));
    expect(getWireCount()).toBe(3);

    selectNode(0);
    selectNode(3, true);
    fireEvent.keyDown(document, { key: 'd', ctrlKey: true });

    await waitFor(() => expect(nodeCount()).toBe(6));
    // The store→new-ws wire is copied (both endpoints selected); the preset
    // wires stay uncopied (ws-1/wh-1 are not in the selection).
    expect(getWireCount()).toBe(4);
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(2);
  });

  it('does not duplicate a wire when only one endpoint is selected', async () => {
    renderEditor();
    fireEvent.click(screen.getByText('+ Retail POS'));
    fireEvent.click(portOf(nodeAt(0), 'right'));
    fireEvent.click(portOf(nodeAt(3), 'left'));
    expect(getWireCount()).toBe(3);

    selectNode(0); // store only — the wire's other end is not selected
    fireEvent.keyDown(document, { key: 'd', ctrlKey: true });

    await waitFor(() => expect(nodeCount()).toBe(5));
    expect(getWireCount()).toBe(3); // no dangling wire copy
  });

  it('Ctrl+C then Ctrl+V pastes a cascade and selects the pasted copies', async () => {
    renderEditor();
    selectNode(0);

    fireEvent.keyDown(document, { key: 'c', ctrlKey: true });
    fireEvent.keyDown(document, { key: 'v', ctrlKey: true });
    await waitFor(() => expect(nodeCount()).toBe(4));
    expect(nodePos()).toContainEqual({ x: 104, y: 164 });
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(1);

    // Second paste cascades one more grid step.
    fireEvent.keyDown(document, { key: 'v', ctrlKey: true });
    await waitFor(() => expect(nodeCount()).toBe(5));
    expect(nodePos()).toContainEqual({ x: 128, y: 188 });
  });

  it('drops a half-copied wire — a partial selection never pastes a dangling endpoint', async () => {
    // Canonical load (the branch has identity, so the live-validation gate
    // is ACTIVE — a corrupted wire would surface as a graph banner).
    // ws-1's wire w-1 has an unselected endpoint (store-1): copying only
    // ws-1 must not carry it into the clip. The both-endpoints filter at
    // COPY time is the structural guarantee against a paste that dangles.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', store_profile_id: 'store-1', x: 80, y: 140 },
        { id: 'ws-1', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'ws-2', type: 'workspace', name: 'POS B', x: 680, y: 140, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [
        { id: 'w-1', from_node_id: 'store-1', to_node_id: 'ws-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-2', from_node_id: 'store-1', to_node_id: 'ws-2', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
      ],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));
    selectNode(1); // ws-1

    fireEvent.keyDown(document, { key: 'c', ctrlKey: true });
    fireEvent.keyDown(document, { key: 'v', ctrlKey: true });

    await waitFor(() => expect(getNodeCount()).toBe(4)); // 3 + the ws-1 copy
    // NO new wire landed — the half-copied w-1 was dropped at copy, so the
    // paste could not create a wire referencing an absent node. (The ws-1
    // copy's missing Location In is a NODE note; a corrupted pasted wire
    // would instead surface as the graph-level unknown-wire banner.)
    expect(getWireCount()).toBe(2);
    expect(document.querySelector('.topology-validation-banner')).toBeNull();
  });

  it('a fully-copied wire pastes remapped to the copies — never a dangling endpoint', async () => {
    // store-1 + ws-1 selected: w-1 (both endpoints covered) is copied; w-2
    // (ws-2 unselected) is dropped. The pasted w-1 must connect the two
    // NEW copies via the idMap remap (so the remapped pair cannot dangle),
    // and the whole paste is ONE undo unit. Canonical load keeps the
    // validation gate active so any broken wire would surface as a banner.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', store_profile_id: 'store-1', x: 80, y: 140 },
        { id: 'ws-1', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'ws-2', type: 'workspace', name: 'POS B', x: 680, y: 140, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [
        { id: 'w-1', from_node_id: 'store-1', to_node_id: 'ws-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
        { id: 'w-2', from_node_id: 'store-1', to_node_id: 'ws-2', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
      ],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));
    selectNode(0);
    selectNode(1, true);

    fireEvent.keyDown(document, { key: 'c', ctrlKey: true });
    fireEvent.keyDown(document, { key: 'v', ctrlKey: true });

    await waitFor(() => expect(getNodeCount()).toBe(5)); // 3 + 2 copies
    expect(getWireCount()).toBe(3); // 2 original + the remapped w-1
    expect(document.querySelector('.topology-validation-banner')).toBeNull();

    // One undo removes the copies AND the remapped wire together.
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(getNodeCount()).toBe(3));
    expect(getWireCount()).toBe(2);
  });

  it('a pasted Branch Location copy is identity-less — never a second branch impersonation', async () => {
    // sanitizeCopiedNode strips storeProfileId on every duplicate route, so
    // the pasted store is a diagram-only card: the graph still has exactly
    // one canonical branch, and validation flags the copy's missing
    // identity instead of letting it impersonate the real branch.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', store_profile_id: 'store-1', x: 80, y: 140 },
        { id: 'ws-1', type: 'workspace', name: 'POS #1', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [
        { id: 'w-1', from_node_id: 'store-1', to_node_id: 'ws-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
      ],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));
    selectNode(0); // the canonical store

    fireEvent.keyDown(document, { key: 'c', ctrlKey: true });
    fireEvent.keyDown(document, { key: 'v', ctrlKey: true });

    await waitFor(() => expect(getNodeCount()).toBe(3));
    // The pasted copies became the selection — the store copy is the only
    // selected card. Its visible note leads with the multiple-branch
    // guidance, and the note's title (all errors) carries the identity
    // error — the copy is diagram-only, never a second branch impersonation.
    const selected = [...document.querySelectorAll('.topology-node.node-selected')] as HTMLElement[];
    expect(selected).toHaveLength(1);
    expect(
      within(selected[0]!).getByText('Keep exactly one Branch Location node in this graph.'),
    ).toBeInTheDocument();
    const note = selected[0]!.querySelector('.node-validation-note') as HTMLElement | null;
    expect(note?.title).toContain('missing its store profile identity');
  });

  it('Ctrl+A selects every node on the canvas', async () => {
    renderEditor();

    fireEvent.keyDown(document, { key: 'a', ctrlKey: true });

    await waitFor(() => expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(3));
  });

  it('undo restores the original canvas after a duplicate', async () => {
    renderEditor();
    selectNode(0);

    fireEvent.keyDown(document, { key: 'd', ctrlKey: true });
    await waitFor(() => expect(nodeCount()).toBe(4));

    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(nodeCount()).toBe(3));
  });

  it('undo-past a paste never resurrects a wire whose endpoint was since deleted', async () => {
    // The restore-boundary invariant: at no point — paste, delete of a
    // pasted endpoint, or either undo — may a wire reference a node that
    // is gone from the canvas (the unknown-wire-endpoint banner is the
    // state-level signal that survives the geometry-gated wire render).
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-1', type: 'workspace', name: 'POS', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [
        { id: 'w-1', from_node_id: 'store-1', to_node_id: 'ws-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
      ],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));

    // Copy the wired pair, then paste — copies + a remapped wire.
    fireEvent.keyDown(document, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(document, { key: 'c', ctrlKey: true });
    fireEvent.keyDown(document, { key: 'v', ctrlKey: true });
    await waitFor(() => expect(getNodeCount()).toBe(4));
    expect(getWireCount()).toBe(2);
    expect(screen.queryByText('This wire references a node that is not in the graph.')).toBeNull();

    // Delete the PASTED workspace copy — the pasted wire's new endpoint.
    // (The paste leaves BOTH copies selected; clear first so the delete
    // targets just the pasted workspace, not the group.)
    fireEvent.keyDown(document, { key: 'Escape' });
    const pastedWs = document.querySelector('.topology-node[data-node-id^="workspace-"]') as HTMLElement;
    expect(pastedWs).not.toBeNull();
    fireEvent.mouseDown(pastedWs, { button: 0 });
    fireEvent.keyDown(document, { key: 'Delete' });
    confirmDialogAction(); // confirm the wired-node dialog
    await waitFor(() => expect(getNodeCount()).toBe(3));
    expect(getWireCount()).toBe(1);
    expect(screen.queryByText('This wire references a node that is not in the graph.')).toBeNull();

    // Undo the delete — the pasted copy and its wire come back TOGETHER.
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(getNodeCount()).toBe(4));
    expect(getWireCount()).toBe(2);
    expect(screen.queryByText('This wire references a node that is not in the graph.')).toBeNull();

    // Undo the paste — back to the pre-paste canvas; no wire may survive
    // without its endpoints.
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(getNodeCount()).toBe(2));
    expect(getWireCount()).toBe(1);
    expect(screen.queryByText('This wire references a node that is not in the graph.')).toBeNull();
  });

  it('a paste round-trips undo → redo with the remapped wire intact', async () => {
    // Undo pushes the post-paste state onto the REDO branch — a history
    // entry in its own right — so the redo-push must be sanitized at push
    // time exactly like every other entry: redo restores the copies AND
    // their remapped wire together, never a wire whose endpoints are
    // missing from the same entry.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-1', type: 'workspace', name: 'POS', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [
        { id: 'w-1', from_node_id: 'store-1', to_node_id: 'ws-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
      ],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));

    fireEvent.keyDown(document, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(document, { key: 'c', ctrlKey: true });
    fireEvent.keyDown(document, { key: 'v', ctrlKey: true });
    await waitFor(() => expect(getNodeCount()).toBe(4));
    expect(getWireCount()).toBe(2);

    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(getNodeCount()).toBe(2));
    expect(getWireCount()).toBe(1);
    // The undo state is where a dangling entry would surface: no wire may
    // reference a node the undo did not also restore.
    expect(screen.queryByText('This wire references a node that is not in the graph.')).toBeNull();

    openRackPanel('edit'); fireEvent.click(screen.getByText('Redo (Ctrl+Y)'));
    await waitFor(() => expect(getNodeCount()).toBe(4));
    expect(getWireCount()).toBe(2); // the remapped wire returns WITH its endpoints
    expect(screen.queryByText('This wire references a node that is not in the graph.')).toBeNull();
  });

  // ── Warehouse Pro-tier cap on duplicate paths ────────────────────
  // The palette spawn path already blocks a second warehouse on standard
  // tier (test above); these pin that Ctrl+D / Ctrl+V / Alt+drag cannot
  // silently bypass the same gate.
  describe('warehouse Pro-tier cap on duplicate paths', () => {
    // The retail preset ships ONE warehouse (wh-1) — the single warehouse a
    // standard-tier install may have. These pin that the duplicate paths
    // (Ctrl+D / Ctrl+V / Alt+drag) respect the same cap the palette spawn
    // path enforces, instead of silently creating a second warehouse.
    const warehouseCount = () =>
      [...document.querySelectorAll('.topology-node')]
        .filter((n) => n.classList.contains('node-type-warehouse')).length;
    const selectWarehouse = () => {
      const wh = [...document.querySelectorAll('.topology-node')]
        .find((n) => n.classList.contains('node-type-warehouse')) as HTMLElement;
      fireEvent.mouseDown(wh, { button: 0 });
    };
    const WH_TOAST = 'Multiple Warehouses require a Pro Tier license.';

    it('blocks Ctrl+D duplicating the only warehouse on standard tier', async () => {
      renderEditor();
      expect(warehouseCount()).toBe(1);
      selectWarehouse();

      fireEvent.keyDown(document, { key: 'd', ctrlKey: true });

      await waitFor(() => expect(screen.queryAllByText(WH_TOAST).length).toBeGreaterThanOrEqual(1));
      expect(warehouseCount()).toBe(1);
      expect(nodeCount()).toBe(3); // the preset set — no copy landed
    });

    it('blocks Ctrl+V pasting a copied warehouse on standard tier', async () => {
      renderEditor();
      selectWarehouse();
      fireEvent.keyDown(document, { key: 'c', ctrlKey: true });

      fireEvent.keyDown(document, { key: 'v', ctrlKey: true });

      await waitFor(() => expect(screen.queryAllByText(WH_TOAST).length).toBeGreaterThanOrEqual(1));
      expect(warehouseCount()).toBe(1);
    });

    it('blocks an Alt+drag duplicate of the warehouse on standard tier', () => {
      renderEditor();
      const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
      const wh = [...document.querySelectorAll('.topology-node')]
        .find((n) => n.classList.contains('node-type-warehouse')) as HTMLElement;

      fireEvent.mouseDown(wh, { button: 0, altKey: true, clientX: 0, clientY: 0 });
      fireEvent.mouseMove(canvas, { clientX: 60, clientY: 40 });
      fireEvent.mouseUp(canvas, { button: 0 });

      expect(screen.queryAllByText(WH_TOAST).length).toBeGreaterThanOrEqual(1);
      expect(warehouseCount()).toBe(1);
    });

    it('allows Ctrl+D on pro tier (the gate is tier-aware)', async () => {
      renderEditor({ currentTier: 'pro' });
      expect(warehouseCount()).toBe(1);
      selectWarehouse();

      fireEvent.keyDown(document, { key: 'd', ctrlKey: true });

      await waitFor(() => expect(warehouseCount()).toBe(2));
    });
  });

});

// ── Per-branch viewport memory ──────────────────────────────────

describe('NodeTopologyEditor — per-branch viewport memory', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockLoadTopology.mockResolvedValue(null);
  });

  const zoomLevel = () => document.querySelector('.canvas-zoom-level')?.textContent;

  it('restores a branch’s saved zoom when the editor remounts', () => {
    const first = renderEditor({ branchId: 'branch-a' });
    expect(zoomLevel()).toBe('100%');

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(zoomLevel()).toBe('125%');

    first.unmount();
    renderEditor({ branchId: 'branch-a' });
    expect(zoomLevel()).toBe('125%');
  });

  it('does not leak one branch’s view into another branch', () => {
    const first = renderEditor({ branchId: 'branch-a' });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    first.unmount();

    renderEditor({ branchId: 'branch-b' });
    expect(zoomLevel()).toBe('100%');
  });

  it('keeps identity zoom for a branch with no saved view', () => {
    renderEditor({ branchId: 'fresh-branch' });
    expect(zoomLevel()).toBe('100%');
  });

  it('loads topology data for the active branch', async () => {
    renderEditor({ branchId: 'branch-a' });
    await waitFor(() => expect(mockLoadTopology).toHaveBeenCalledWith('branch-a'));
  });
});

// ── Node finder (Ctrl+F) ────────────────────────────────────────

describe('NodeTopologyEditor — node finder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTopology.mockResolvedValue(null);
  });

  const openFinder = () => fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
  const finderInput = () => document.querySelector('.topology-finder-input') as HTMLInputElement | null;

  it('Ctrl+F opens the finder and filters nodes by name as you type', () => {
    renderEditor();
    expect(document.querySelector('.topology-finder')).toBeNull();

    openFinder();
    const input = finderInput();
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);

    fireEvent.change(input!, { target: { value: 'ware' } });
    const items = [...document.querySelectorAll('.topology-finder-item')].map((el) => el.textContent);
    expect(items).toHaveLength(1);
    expect(items[0]).toContain('Main Warehouse');

    // No match — the empty state renders instead of a stale list.
    fireEvent.change(input!, { target: { value: 'zzz-none' } });
    expect(document.querySelector('.topology-finder-empty')).not.toBeNull();
  });

  it('Enter jumps to the highlighted match, selects and centers it, and closes the finder', () => {
    renderEditor();
    openFinder();
    const input = finderInput();
    fireEvent.change(input!, { target: { value: 'ware' } });
    fireEvent.keyDown(input!, { key: 'Enter' });

    // The overlay closes.
    expect(document.querySelector('.topology-finder')).toBeNull();
    // The matched node is the selection.
    const selected = [...document.querySelectorAll('.topology-node.node-selected')] as HTMLElement[];
    expect(selected).toHaveLength(1);
    expect(selected[0]!.textContent).toContain('Main Warehouse');
    // The viewport centers the node at the current zoom (canvas is 0×0 in
    // jsdom, so pan = -node center): transform is exactly deterministic.
    const vp = document.querySelector('.node-canvas-viewport') as HTMLElement;
    const cx = 680 + NODE_WIDTH / 2;
    const cy = 140 + NODE_HEIGHT / 2;
    expect(vp.style.transform).toBe(`translate(${-cx}px, ${-cy}px) scale(1)`);
  });

  it('Escape closes the finder without changing selection or view', () => {
    renderEditor();
    const before = (document.querySelector('.node-canvas-viewport') as HTMLElement).style.transform;

    openFinder();
    const input = finderInput();
    fireEvent.change(input!, { target: { value: 'warehouse' } });
    fireEvent.keyDown(input!, { key: 'Escape' });

    expect(document.querySelector('.topology-finder')).toBeNull();
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(0);
    expect((document.querySelector('.node-canvas-viewport') as HTMLElement).style.transform).toBe(before);
  });

  it('navigates from the visibly-active row after the match list shrinks (node deleted while open)', async () => {
    // Deleted-node edge: the finder stays open while a node is deleted, the
    // list shrinks, and the STORED index (2) now points past the end. The
    // render clamps the highlight to the last row, so the next arrow press
    // must move from THAT row — not compute against the stale index (which
    // swallows exactly one press). Enter must then jump to a live node.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
        { id: 'ws-a', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'ws-b', type: 'workspace', name: 'POS B', x: 680, y: 140, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));
    openFinder();
    const input = finderInput()!;
    const options = () => [...document.querySelectorAll('.topology-finder-item')];
    expect(options()).toHaveLength(3);

    // Move the highlight to the LAST row (index 2).
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[2]!.id);

    // Delete the FIRST match (POS A) while the finder stays open — no
    // wires, so the delete is immediate.
    fireEvent.mouseDown(nodeAt(1), { button: 0 });
    fireEvent.keyDown(document, { key: 'Delete' });
    await waitFor(() => expect(options()).toHaveLength(2));
    // The render clamps the highlight to the last remaining row (POS B).
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[1]!.id);

    // ArrowDown must wrap to the FIRST row — one press, not swallowed by
    // the stale stored index.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[0]!.id);

    // Enter after the delete jumps to a LIVE node (never a ghost id).
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(document.querySelector('.topology-finder')).toBeNull();
    const selected = [...document.querySelectorAll('.topology-node.node-selected')] as HTMLElement[];
    expect(selected).toHaveLength(1);
    expect(selected[0]!.textContent).toContain('Branch');
  });

  it('reflects a rename in the open finder and Enter jumps to the renamed node', async () => {
    // Renamed-node edge: the finder stays open while a node is renamed from
    // its card. The match list must react (the old name stops matching, the
    // new name matches), and Enter must still jump to the node by its
    // STABLE id — a rename is a name change, not a different instance.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
        { id: 'ws-a', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [],
    } as never);
    const onRenameWorkspace = vi.fn().mockResolvedValue(true);
    renderEditor({ onRenameWorkspace });
    await waitFor(() => expect(getNodeCount()).toBe(2));
    openFinder();
    const input = finderInput()!;

    fireEvent.change(input, { target: { value: 'pos' } });
    let row = document.querySelector('.topology-finder-item') as HTMLElement;
    expect(row.textContent).toContain('POS A');

    // Rename the node from its card while the finder stays open.
    const wsCard = nodeAt(1);
    fireEvent.click(within(wsCard).getByRole('button', { name: 'topology-workspace-rename-label' }));
    const renameInput = within(wsCard).getByLabelText('topology-workspace-rename-placeholder');
    fireEvent.change(renameInput, { target: { value: 'Front Register' } });
    fireEvent.keyDown(renameInput, { key: 'Enter' });
    await waitFor(() => expect(onRenameWorkspace).toHaveBeenCalledWith('ws-a', 'Front Register'));

    // The open finder reacted: the old-name query no longer matches (empty
    // state, not a stale row).
    await waitFor(() => expect(document.querySelector('.topology-finder-empty')).not.toBeNull());

    // The new name matches and Enter jumps to the renamed node by its id.
    fireEvent.change(input, { target: { value: 'front' } });
    row = document.querySelector('.topology-finder-item') as HTMLElement;
    expect(row.textContent).toContain('Front Register');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(document.querySelector('.topology-finder')).toBeNull();
    const selected = [...document.querySelectorAll('.topology-node.node-selected')] as HTMLElement[];
    expect(selected).toHaveLength(1);
    expect(selected[0]!.textContent).toContain('Front Register');
  });

  it('wires the combobox ARIA contract so the active match is announced', () => {
    // The finder is a combobox pattern (filter input + option list), so the
    // input must expose aria-expanded / aria-controls / aria-activedescendant
    // or a screen-reader user gets NO feedback on which match Enter jumps to.
    renderEditor();
    openFinder();
    const input = finderInput()!;
    const listbox = document.querySelector('.topology-finder-list') as HTMLElement;
    expect(listbox.id).toBe('topology-finder-listbox');
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-controls')).toBe('topology-finder-listbox');

    // Default (empty) query matches all three retail nodes — first is active.
    const options = () => [...document.querySelectorAll('.topology-finder-item')];
    expect(options()).toHaveLength(3);
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[0]!.id);

    // ArrowDown moves the highlight (and the announced target) forward, wrapping.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[1]!.id);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[0]!.id);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[2]!.id);

    // A query with no matches points at the empty-state option, so the
    // "no results" state is announced instead of a stale highlight.
    fireEvent.change(input, { target: { value: 'zzz-none' } });
    expect(document.querySelector('.topology-finder-empty')).not.toBeNull();
    expect(input.getAttribute('aria-activedescendant')).toBe('topology-finder-empty');
  });
});

// ── Auto-layout ──────────────────────────────────────────────────

describe('NodeTopologyEditor — auto-layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTopology.mockResolvedValue(null);
  });

  const posOf = (name: string) => {
    const el = [...document.querySelectorAll('.topology-node')]
      .find((n) => n.textContent?.includes(name)) as HTMLElement;
    return { x: parseInt(el.style.left, 10), y: parseInt(el.style.top, 10) };
  };

  it('Auto-layout ranks nodes by wire direction into columns and restores on one undo', async () => {
    // A deliberately tangled diagram: store at the BOTTOM, a mid-store and
    // the warehouse straddling the workspaces' column.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Store', x: 0, y: 400 },
        { id: 'ws-1', type: 'workspace', name: 'POS A', x: 300, y: 100 },
        { id: 'ws-2', type: 'workspace', name: 'POS B', x: 700, y: 300 },
        { id: 'wh-1', type: 'warehouse', name: 'WH', x: 200, y: 500 },
      ],
      wires: [
        { id: 'w-1', from_node_id: 'store-1', to_node_id: 'ws-1', direction: 'one-way' },
        { id: 'w-2', from_node_id: 'store-1', to_node_id: 'ws-2', direction: 'one-way' },
        { id: 'w-3', from_node_id: 'ws-2', to_node_id: 'wh-1', direction: 'one-way' },
      ],
    } as never);
    renderEditor();
    await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(4));
    openRackPanel('view');

    const before = ['Store', 'POS A', 'POS B', 'WH'].map(posOf);

    fireEvent.click(screen.getByText('Auto-layout'));

    const after = ['Store', 'POS A', 'POS B', 'WH'].map(posOf);
    // Store (rank 0) is left of both POS workspaces (rank 1), which share
    // one column and stack in prior-y order (POS A above POS B); the
    // warehouse (rank 2, fed by POS B) is rightmost.
    expect(after[0]!.x).toBeLessThan(after[1]!.x);
    expect(after[1]!.x).toBe(after[2]!.x);
    expect(after[1]!.y).toBeLessThan(after[2]!.y);
    expect(after[3]!.x).toBeGreaterThan(after[1]!.x);

    // ONE undo restores the tangled geometry exactly.
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(['Store', 'POS A', 'POS B', 'WH'].map(posOf)).toEqual(before));
  });

  it('Auto-layout snaps to the grid when elbow routing and snap are both on', () => {
    // Elbow (orthogonal) wires only look clean when the cards sit on the
    // 24px grid, so the layout anchor snaps in that mode. The retail preset
    // lands off-grid (store at x=80), so every node must move to a lattice
    // point.
    localStorage.setItem('oz-topology-view-routing:unassigned', 'elbow');
    localStorage.setItem('oz-topology-view-snap:unassigned', '1');
    try {
      renderEditor();
      openRackPanel('view');
      fireEvent.click(screen.getByText('Auto-layout'));

      const cards = [...document.querySelectorAll('.topology-node')];
      for (const card of cards) {
        const el = card as HTMLElement;
        expect(parseFloat(el.style.left) % 24).toBe(0);
        expect(parseFloat(el.style.top) % 24).toBe(0);
      }
    } finally {
      localStorage.removeItem('oz-topology-view-routing:unassigned');
      localStorage.removeItem('oz-topology-view-snap:unassigned');
    }
  });

  it('Auto-layout clears stale bends authored for the old geometry', () => {
    renderEditor();
    openRackPanel('view');
    // Retail preset: store→ws→wh. Bend w-1 at (400, 300).
    fireEvent.click(document.querySelector('.wire-hitbox') as Element);
    const ghost = document.querySelector('.wire-bend-ghost') as Element;
    fireEvent.mouseDown(ghost, { button: 0, clientX: 350, clientY: 289 });
    fireEvent.mouseMove(document, { clientX: 400, clientY: 300 });
    fireEvent.mouseUp(document, { button: 0 });
    expect(document.querySelector('.wire-bend-handle')).not.toBeNull();

    fireEvent.click(screen.getByText('Auto-layout'));

    // The bend described the old geometry — the reorganization clears it.
    expect(document.querySelector('.wire-bend-handle')).toBeNull();
  });
});

// ── Minimap overview ────────────────────────────────────────────

describe('NodeTopologyEditor — minimap overview', () => {
  beforeEach(() => {
    mockLoadTopology.mockResolvedValue(null);
  });

  it('renders one minimap node rect per canvas node', () => {
    renderEditor();
    const map = document.querySelector('.topology-minimap');
    expect(map).not.toBeNull();
    expect(map!.querySelectorAll('.topology-minimap-node')).toHaveLength(3);
  });

  it('hides the minimap when the canvas is empty', async () => {
    // An empty load falls back to the retail preset, so the only way to an
    // empty canvas is deleting every node. Use a single unwired hardware
    // node so Delete removes it immediately (no dialog; hardware is
    // deletable, Branch Locations are permanent anchors).
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [{ id: 'hw-1', type: 'hardware', name: 'Printer', x: 80, y: 140 }],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(1));
    expect(document.querySelector('.topology-minimap')).not.toBeNull();

    fireEvent.mouseDown(document.querySelector('.topology-node') as HTMLElement, { button: 0 });
    fireEvent.keyDown(document, { key: 'Delete' });

    await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(0));
    expect(document.querySelector('.topology-minimap')).toBeNull();
  });

  it('clicking the minimap recenters the viewport', () => {
    renderEditor();
    const map = document.querySelector('.topology-minimap') as HTMLElement;
    const viewport = document.querySelector('.node-canvas-viewport') as HTMLElement;
    expect(viewport.style.transform).toContain('translate(0px, 0px)');

    // jsdom rects are zero-sized, so the pointer lands at raw minimap px.
    fireEvent.mouseDown(map, { button: 0, clientX: 160, clientY: 60 });

    // Recentering computes a non-zero pan → the viewport translate changes.
    expect(viewport.style.transform).not.toContain('translate(0px, 0px)');
  });

  it('the viewport rect tracks panning on the main canvas', () => {
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const mapRect = document.querySelector('.topology-minimap-viewport') as HTMLElement;
    const before = mapRect.getAttribute('x');

    // Middle-button drag pans the main canvas (see the canvas-pan describe).
    // The drag goes LEFT by 200: pan becomes −200, so the view origin
    // (−pan/zoom = 200) enters the content range and the intersection box
    // moves with it — a rightward pan would pin the chip at the map edge
    // (the view origin never reaches the content), so x would not move.
    fireEvent.mouseDown(canvas, { button: 1, clientX: 300, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(document, { button: 1 });

    expect(mapRect.getAttribute('x')).not.toBe(before);
  });

  it('the zoom-cluster toggle hides and restores the minimap', () => {
    renderEditor();
    expect(document.querySelector('.topology-minimap')).not.toBeNull();

    fireEvent.click(screen.getByText('Hide Minimap'));
    expect(document.querySelector('.topology-minimap')).toBeNull();

    fireEvent.click(screen.getByText('Show Minimap'));
    expect(document.querySelector('.topology-minimap')).not.toBeNull();
  });

  it('the minimap toggle reports its state via aria-pressed', () => {
    renderEditor();
    // The minimap surface itself is role="button", so pin the toggle by its
    // exact label — which also asserts the label flips with the state.
    const toggle = screen.getByRole('button', { name: 'Hide Minimap' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Show Minimap' })).toHaveAttribute('aria-pressed', 'false');
  });

  describe('per-branch visibility persistence', () => {
    // These tests write and read the minimap localStorage key, so scrub it
    // around every test — a leftover '0' under the 'unassigned' key would
    // hide the minimap for any later default-mount test in the suite.
    beforeEach(() => localStorage.clear());
    afterEach(() => localStorage.clear());

    it('persists the visibility to the branch-scoped localStorage key', () => {
      renderEditor({ branchId: 'branch-a' });

      fireEvent.click(screen.getByText('Hide Minimap'));
      expect(localStorage.getItem('oz-topology-view-minimap:branch-a')).toBe('0');

      fireEvent.click(screen.getByText('Show Minimap'));
      expect(localStorage.getItem('oz-topology-view-minimap:branch-a')).toBe('1');
    });

    it('restores a saved hidden minimap for the same branch on mount', () => {
      localStorage.setItem('oz-topology-view-minimap:branch-a', '0');
      renderEditor({ branchId: 'branch-a' });

      expect(document.querySelector('.topology-minimap')).toBeNull();
      expect(screen.getByRole('button', { name: 'Show Minimap' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('writes only the active branch\'s key, leaving other branches untouched', () => {
      localStorage.setItem('oz-topology-view-minimap:branch-a', '0');
      renderEditor({ branchId: 'branch-a' });

      fireEvent.click(screen.getByText('Show Minimap'));
      expect(localStorage.getItem('oz-topology-view-minimap:branch-a')).toBe('1');
      expect(localStorage.getItem('oz-topology-view-minimap:branch-b')).toBeNull();
    });

    it('falls back to visible when the saved value is corrupted', () => {
      localStorage.setItem('oz-topology-view-minimap:branch-a', 'garbage');
      renderEditor({ branchId: 'branch-a' });

      expect(document.querySelector('.topology-minimap')).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Hide Minimap' })).toHaveAttribute('aria-pressed', 'true');
    });
  });
});

// ── F2 inline rename + HUD status readouts ──────────────────────

describe('NodeTopologyEditor — F2 rename & status readouts', () => {
  beforeEach(() => {
    mockLoadTopology.mockResolvedValue(null);
  });

  it('F2 opens the inline rename for the selected store node', () => {
    renderEditor({ onRenameBranch: vi.fn() });
    fireEvent.mouseDown(document.querySelectorAll('.topology-node')[0]!, { button: 0 });

    fireEvent.keyDown(document, { key: 'F2' });

    const input = document.querySelector('.node-card-rename-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('Downtown Branch');
  });

  it('F2 does not open rename for non-renameable nodes', () => {
    renderEditor({ onRenameBranch: vi.fn() });
    fireEvent.mouseDown(document.querySelectorAll('.topology-node')[2]!, { button: 0 }); // warehouse

    fireEvent.keyDown(document, { key: 'F2' });

    expect(document.querySelector('.node-card-rename-input')).toBeNull();
  });

  it('the HUD reports the selection count', () => {
    renderEditor();
    const hud = document.querySelector('.canvas-hud') as HTMLElement;
    expect(hud.textContent).toContain('0 selected');

    const nodes = document.querySelectorAll('.topology-node');
    fireEvent.mouseDown(nodes[0]!, { button: 0 });
    fireEvent.mouseDown(nodes[1]!, { button: 0, shiftKey: true });

    expect(hud.textContent).toContain('2 selected');
  });

  it('the HUD tracks the cursor position in canvas coords', async () => {
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    fireEvent.mouseMove(canvas, { clientX: 120, clientY: 80 });

    // The readout is rAF-throttled — the update lands on the next frame.
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });

    const hud = document.querySelector('.canvas-hud') as HTMLElement;
    expect(hud.textContent).toContain('120, 80');
  });

  it('defers the cursor readout update to the next animation frame', async () => {
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const hud = document.querySelector('.canvas-hud') as HTMLElement;

    fireEvent.mouseMove(canvas, { clientX: 120, clientY: 80 });

    // Synchronously after the event the readout is still stale — the
    // handler only schedules the frame; it never sets state per event.
    expect(hud.textContent).not.toContain('120, 80');

    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });
    expect(hud.textContent).toContain('120, 80');
  });

  it('coalesces a burst of moves into the latest position', async () => {
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const hud = document.querySelector('.canvas-hud') as HTMLElement;

    fireEvent.mouseMove(canvas, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(canvas, { clientX: 50, clientY: 60 });
    fireEvent.mouseMove(canvas, { clientX: 200, clientY: 150 });

    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });

    // The frame drains the LATEST coords — the readout never lags behind
    // to a mid-burst value even though only one state update ran.
    expect(hud.textContent).toContain('200, 150');
  });
});

// ── Zoom to selection & zoom shortcuts ──────────────────────────

describe('NodeTopologyEditor — zoom to selection & zoom shortcuts', () => {
  beforeEach(() => {
    mockLoadTopology.mockResolvedValue(null);
  });

  const zoomLevel = () => (document.querySelector('.canvas-zoom-level') as HTMLElement).textContent;

  it('context menu offers Zoom to Selection only when nodes are selected', () => {
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    fireEvent.contextMenu(canvas, { clientX: 100, clientY: 100 });
    expect(screen.queryByText('Zoom to Selection')).toBeNull();

    fireEvent.mouseDown(document.querySelectorAll('.topology-node')[0]!, { button: 0 });
    fireEvent.contextMenu(canvas, { clientX: 100, clientY: 100 });
    expect(screen.getByText('Zoom to Selection')).toBeInTheDocument();
  });

  it('Zoom to Selection fits the selected node', () => {
    renderEditor();
    expect(zoomLevel()).toBe('100%');

    fireEvent.mouseDown(document.querySelectorAll('.topology-node')[0]!, { button: 0 });
    fireEvent.contextMenu(document.querySelector('.node-canvas-container')!, { clientX: 100, clientY: 100 });
    fireEvent.click(screen.getByText('Zoom to Selection'));

    // Fit-to-bounds replaces the current zoom with a computed value within
    // the clamped 40%..200% range (jsdom's zero-sized canvas → min clamp).
    expect(zoomLevel()).not.toBe('100%');
    expect(zoomLevel()).toMatch(/^(?:[4-9]\d|1\d\d|200)%$/);
  });

  it('Ctrl+0 fits the diagram and Ctrl+1 returns to 100%', () => {
    renderEditor();
    expect(zoomLevel()).toBe('100%');

    fireEvent.keyDown(document, { key: '0', ctrlKey: true });
    expect(zoomLevel()).toMatch(/^(?:[4-9]\d|1\d\d|200)%$/);
    expect(zoomLevel()).not.toBe('100%');

    fireEvent.keyDown(document, { key: '1', ctrlKey: true });
    expect(zoomLevel()).toBe('100%');
  });

  it('Ctrl+0 pan stays consistent when the fit zoom hits the 40% floor', async () => {
    // A diagram spanning more than ~2.5 viewports makes the raw fitZoom
    // drop below the 0.4 zoom floor. The pan MUST be computed at the
    // CLAMPED zoom — using the raw fitZoom centers the diagram at a
    // different scale than the one actually applied, so the "fit" lands
    // off-center (error = |minX|·(0.4 − fitZoom)).
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
        { id: 'ws-1', type: 'workspace', name: 'Far POS', x: 4000, y: 140, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));
    mockCanvasSize(1200, 800);

    fireEvent.keyDown(document, { key: '0', ctrlKey: true });

    // viewW = 1200−120 = 1080; diagram width = 4160 → raw fitZoom ≈ 0.26,
    // clamped to 0.4. The correct fit pan is padding − minX·clampedZoom =
    // 60 − 80·0.4 = 28 (the diagram's left edge lands exactly at the 60px
    // padding).
    const vp = document.querySelector('.node-canvas-viewport') as HTMLElement;
    const m = vp.style.transform.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/);
    expect(m).not.toBeNull();
    const panX = parseFloat(m![1]!);
    const panY = parseFloat(m![2]!);
    const zoom = parseFloat(m![3]!);
    expect(zoom).toBeCloseTo(0.4, 5);
    // 60 − 80·0.4 = 28 — the raw-fitZoom pan (60 − 80·0.26 ≈ 39.2) fails this.
    expect(panX).toBeCloseTo(28, 5);
    expect(panY).toBeCloseTo(60 - 140 * 0.4, 5);
  });

  it('Ctrl+= zooms in and Ctrl+- zooms out by a step', () => {
    renderEditor();

    fireEvent.keyDown(document, { key: '=', ctrlKey: true });
    expect(zoomLevel()).toBe('125%');

    fireEvent.keyDown(document, { key: '-', ctrlKey: true });
    expect(zoomLevel()).toBe('100%');
  });
});

// ── Wire routing styles (curved vs orthogonal elbow) ─────────────

describe('NodeTopologyEditor — wire routing styles', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  beforeEach(() => {
    mockLoadTopology.mockResolvedValue(null);
  });

  const firstPathD = () => {
    const path = document.querySelector('.wire-path') as SVGPathElement;
    return path.getAttribute('d');
  };

  it('draws curved bezier wires by default', () => {
    renderEditor();
    expect(firstPathD()).toContain('C ');
  });

  it('toggles to orthogonal elbow routing and back', () => {
    renderEditor();

    openRackPanel('view'); fireEvent.click(screen.getByText('Elbow wires'));
    expect(firstPathD()).toContain('L ');
    expect(firstPathD()).not.toContain('C ');

    openRackPanel('view'); fireEvent.click(screen.getByText('Elbow wires'));
    expect(firstPathD()).toContain('C ');
  });

});

// ── Node context menu & double-click rename ─────────────────────

describe('NodeTopologyEditor — node context menu & double-click rename', () => {
  beforeEach(() => {
    mockLoadTopology.mockResolvedValue(null);
  });

  const rightClickNode = (i: number) => {
    const node = document.querySelectorAll('.topology-node')[i] as HTMLElement;
    fireEvent.contextMenu(node, { clientX: 100, clientY: 100 });
  };

  it('right-click selects the node and opens a node menu with Rename', () => {
    renderEditor({ onRenameBranch: vi.fn() });
    rightClickNode(0); // store

    expect(document.querySelector('.topology-context-menu')).not.toBeNull();
    expect(screen.getByText('Rename')).toBeInTheDocument();
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(1);
  });

  it('the node menu duplicates the node', () => {
    renderEditor({ onRenameBranch: vi.fn() });
    // Right-click a non-anchor node (Branch Location menus hide Duplicate).
    rightClickNode(1); // ws-1 (Retail POS #1)

    // The context menu's Duplicate item (the selected node also shows a
    // Duplicate button in the inspector — scope to the menu).
    const menu = document.querySelector('.topology-context-menu') as HTMLElement;
    fireEvent.click(within(menu).getByText('Duplicate'));
    expect(getNodeCount()).toBe(4);
  });

  it('the node menu deletes an unwired node immediately', () => {
    renderEditor();
    fireEvent.click(screen.getByText('+ Retail POS'));
    expect(getNodeCount()).toBe(4);

    rightClickNode(3); // the fresh unwired workspace
    fireEvent.click(screen.getByText('Delete Node'));
    expect(getNodeCount()).toBe(3);
  });

  it('non-renameable nodes hide the Rename item', () => {
    renderEditor({ onRenameBranch: vi.fn() });
    rightClickNode(2); // warehouse

    expect(screen.queryByText('Rename')).toBeNull();
    expect(screen.getByText('Delete Node')).toBeInTheDocument();
  });

  it('double-click opens the inline rename on a renameable node', () => {
    renderEditor({ onRenameBranch: vi.fn() });

    fireEvent.doubleClick(document.querySelectorAll('.topology-node')[0]!);

    const input = document.querySelector('.node-card-rename-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('Downtown Branch');
  });
});

// ── Wire context menu ───────────────────────────────────────────

describe('NodeTopologyEditor — wire context menu', () => {
  beforeEach(() => {
    mockLoadTopology.mockResolvedValue(null);
  });

  const rightClickWire = (i: number) => {
    const hitbox = document.querySelectorAll('.wire-hitbox')[i] as HTMLElement;
    fireEvent.contextMenu(hitbox, { clientX: 400, clientY: 300 });
  };

  it('right-click selects the wire and opens a wire menu titled with its label', () => {
    renderEditor();

    rightClickWire(0); // preset w-1: 'Binds Store'

    expect(document.querySelector('.topology-context-menu')).not.toBeNull();
    // The menu is titled with the wire's label and offers direction + delete.
    expect(screen.getByText('Binds Store', { selector: '.topology-context-section-title' })).not.toBeNull();
    expect(screen.getByText('Toggle wire direction')).not.toBeNull();
    expect(screen.getByText('Delete wire')).not.toBeNull();
    // The wire itself is selected (and node selection is cleared).
    expect(document.querySelector('.wire-selected')).not.toBeNull();
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(0);
  });

  it('Toggle direction from the wire menu cycles the wire direction', () => {
    renderEditor();
    const hitbox = document.querySelector('.wire-hitbox') as Element;
    const path = () => hitbox.parentElement!.querySelector('path.wire-path') as Element;
    expect(path().getAttribute('data-direction')).toBe('one-way');

    rightClickWire(0);
    fireEvent.click(screen.getByText('Toggle wire direction'));

    expect(path().getAttribute('data-direction')).toBe('reverse');
    expect(document.querySelector('.topology-context-menu')).toBeNull();
  });

  it('Delete wire from the menu opens the confirm dialog; confirming removes the wire', () => {
    renderEditor();
    const wireCount = document.querySelectorAll('.wire-hitbox').length;

    rightClickWire(1); // preset w-2
    fireEvent.click(screen.getByText('Delete wire'));

    // Same confirm flow as the Delete key: dialog names the wire delete.
    expect(screen.getByText('Delete Wire')).toBeInTheDocument();
    expect(document.querySelectorAll('.wire-hitbox')).toHaveLength(wireCount);

    fireEvent.click(screen.getByText('Delete')); // confirm label
    expect(document.querySelectorAll('.wire-hitbox')).toHaveLength(wireCount - 1);
    expect(document.querySelector('.wire-selected')).toBeNull();
  });

  it('Rename wire opens an inline editor seeded with the label; Enter commits it', () => {
    renderEditor();

    rightClickWire(0); // preset w-1: 'Binds Store'
    fireEvent.click(screen.getByText('Rename wire'));

    const input = document.querySelector('.wire-rename-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('Binds Store');
    // The menu closes and the wire stays selected while editing.
    expect(document.querySelector('.topology-context-menu')).toBeNull();
    expect(document.querySelector('.wire-selected')).not.toBeNull();

    fireEvent.change(input, { target: { value: 'Backbone' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(document.querySelector('.wire-rename-input')).toBeNull();
    const titles = [...document.querySelectorAll('.wire-hitbox title')];
    expect(titles.some((t) => t.textContent?.includes('Backbone'))).toBe(true);
    expect(titles.some((t) => t.textContent?.includes('Binds Store'))).toBe(false);
  });

  it('an empty wire label clears the custom label back to the endpoint display', () => {
    renderEditor();

    rightClickWire(0); // preset w-1: 'Binds Store'
    fireEvent.click(screen.getByText('Rename wire'));

    const input = document.querySelector('.wire-rename-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // The custom label is gone — the menu now titles the wire from its
    // endpoints (the label pill no longer exists on the canvas).
    rightClickWire(0);
    expect(screen.getByText('Downtown Branch → Retail POS #1', { selector: '.topology-context-section-title' })).not.toBeNull();
  });

  it('Escape cancels the wire rename without touching the label', () => {
    renderEditor();

    rightClickWire(0);
    fireEvent.click(screen.getByText('Rename wire'));

    const input = document.querySelector('.wire-rename-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Nope' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(document.querySelector('.wire-rename-input')).toBeNull();
    const titles = [...document.querySelectorAll('.wire-hitbox title')];
    expect(titles.some((t) => t.textContent?.includes('Binds Store'))).toBe(true);
  });

  it('a wire relabel marks the canvas dirty (label is a persisted field)', () => {
    renderEditor();

    rightClickWire(0);
    fireEvent.click(screen.getByText('Rename wire'));

    const input = document.querySelector('.wire-rename-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Backbone' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(document.querySelector('.topology-dirty-dot')).not.toBeNull();
  });
});

// ── Live connection preview & snap-to-grid toggle ────────────────

describe('NodeTopologyEditor — live preview & snap toggle', () => {
  beforeEach(() => {
    mockLoadTopology.mockResolvedValue(null);
  });

  const canvas = () => document.querySelector('.node-canvas-container') as HTMLElement;

  it('the connection preview follows the cursor while connecting', () => {
    renderEditor();
    fireEvent.mouseMove(canvas(), { clientX: 200, clientY: 150 });
    fireEvent.click(portOf(nodeAt(0), 'right'));
    const before = previewLine()!.getAttribute('d');

    fireEvent.mouseMove(canvas(), { clientX: 320, clientY: 210 });
    const after = previewLine()!.getAttribute('d');

    expect(after).not.toBe(before);
  });

  it('the connection preview uses elbow routing when enabled', () => {
    renderEditor();
    openRackPanel('view'); fireEvent.click(screen.getByText('Elbow wires'));
    fireEvent.mouseMove(canvas(), { clientX: 300, clientY: 200 });

    fireEvent.click(portOf(nodeAt(0), 'right'));

    expect(previewLine()!.getAttribute('d')).toContain('L ');
  });

  it('dragging with snap off places the node off-grid', () => {
    renderEditor();
    openRackPanel('view'); fireEvent.click(screen.getByText('Snap to grid')); // toggles OFF
    const node = document.querySelector('.topology-node') as HTMLElement;

    fireEvent.mouseDown(node, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 123, clientY: 100 });
    fireEvent.mouseUp(canvas(), { button: 0 });

    // The raw unsnapped landing (203px) overlaps the preset's Retail POS
    // card, so the drop settles into the nearest free spot (round 140) —
    // the resolution steps in 24px increments FROM the raw landing, so the
    // off-grid character survives: 203 → 131 (both off the 24px grid).
    const left = parseFloat(node.style.left);
    expect(left % 24).not.toBe(0);
    // …and the settled card must not intersect any other preset card.
    const top = parseFloat(node.style.top);
    const others = [...document.querySelectorAll('.topology-node')].slice(1);
    const overlaps = others.some((o) => {
      const el = o as HTMLElement;
      const ox = parseFloat(el.style.left);
      const oy = parseFloat(el.style.top);
      return left < ox + NODE_WIDTH && left + NODE_WIDTH > ox
        && top < oy + NODE_HEIGHT && top + NODE_HEIGHT > oy;
    });
    expect(overlaps).toBe(false);
  });

  it('the canvas menu spawn respects the snap toggle', () => {
    renderEditor();
    openRackPanel('view'); fireEvent.click(screen.getByText('Snap to grid')); // toggles OFF

    fireEvent.contextMenu(canvas(), { clientX: 100, clientY: 100 });
    fireEvent.click(screen.getByText('New Hardware'));

    const last = [...document.querySelectorAll('.topology-node')].pop() as HTMLElement;
    expect(last.style.left).toBe('100px'); // snap(100) would be 96
  });
});

// ── Validation issues panel & persisted view prefs ──────────────

describe('NodeTopologyEditor — validation panel & view prefs', () => {
  beforeEach(() => {
    mockLoadTopology.mockResolvedValue(null);
    localStorage.clear();
  });

  const issueFixture = {
    nodes: [
      // Canonical store identity opts the canvas into strict validation;
      // the workspace has no Location In wire → a per-node issue.
      { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
      { id: 'ws-1', type: 'workspace', name: 'Retail POS #1', x: 380, y: 80, metadata: { typeKey: 'store-pos' } },
    ],
    wires: [],
  } as never;

  it('shows an issues button with the count when the diagram has problems', async () => {
    mockLoadTopology.mockResolvedValueOnce(issueFixture);
    renderEditor();
    await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(2));

    const btn = document.querySelector('.topology-issues-btn') as HTMLElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain('Issues (1)');
  });

  it('the panel lists the issue and clicking it selects the node', async () => {
    mockLoadTopology.mockResolvedValueOnce(issueFixture);
    renderEditor();
    await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(2));

    fireEvent.click(screen.getByText(/Issues \(1\)/));
    const panel = document.querySelector('.topology-validation-panel') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(within(panel).getByText('Connect this workspace to a Branch Location using Location In.')).toBeInTheDocument();

    fireEvent.click(within(panel).getByText('Retail POS #1'));
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(1);
    expect(document.querySelector('.topology-validation-panel')).toBeNull();
  });

  it('no issues button on a clean diagram', () => {
    renderEditor();
    expect(document.querySelector('.topology-issues-btn')).toBeNull();
  });

  describe('mark-issue-resolved persistence', () => {
    // Two unwired workspaces → two per-node "connect this workspace" issues.
    const twoIssueFixture: TopologyData = {
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-1', type: 'workspace', name: 'Retail POS #1', x: 380, y: 80, metadata: { typeKey: 'store-pos' } },
        { id: 'ws-2', type: 'workspace', name: 'KDS #1', x: 380, y: 240, metadata: { typeKey: 'kds' } },
      ],
      wires: [],
    };
    const openPanel = async () => {
      fireEvent.click(screen.getByText(/Issues \(2\)/));
      return document.querySelector('.topology-validation-panel') as HTMLElement;
    };
    // The parent describe still clears localStorage for the viewport tests;
    // dismissals themselves no longer use browser storage.
    afterEach(() => localStorage.clear());

    it('dismissing an issue removes it from the panel and decrements the count', async () => {
      mockLoadTopology.mockResolvedValue(twoIssueFixture);
      renderEditor();
      await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(3));

      const panel = await openPanel();
      const dismissBtns = panel.querySelectorAll('.topology-validation-item-dismiss');
      expect(dismissBtns).toHaveLength(2);

      fireEvent.click(dismissBtns[0] as HTMLElement);
      expect(panel.querySelectorAll('.topology-validation-item')).toHaveLength(1);
      // The readout is settled — it commits the new count once the value
      // holds steady (the panel itself is live).
      await waitFor(() => expect(screen.getByText(/Issues \(1\)/)).toBeInTheDocument());
      // The dismissed issue's card note badge is gone too.
      expect(document.querySelectorAll('.node-validation-note')).toHaveLength(1);
    });

    it('loads dismissal state from the branch topology document', async () => {
      mockLoadTopology.mockResolvedValue({
        ...twoIssueFixture,
        resolved_issue_keys: ['node:ws-1:topology-validation-missing-location'],
      });
      renderEditor();
      await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(3));

      await waitFor(() => expect(screen.getByText(/Issues \(1\)/)).toBeInTheDocument());
      expect(document.querySelectorAll('.node-validation-note')).toHaveLength(1);
      expect(localStorage.getItem('oz-topology-resolved-issues:unassigned')).toBeNull();
    });

    it('keeps a dismissed issue dismissed across a remount', async () => {
      mockLoadTopology.mockResolvedValue({
        ...twoIssueFixture,
        resolved_issue_keys: ['node:ws-1:topology-validation-missing-location'],
      });
      const { unmount } = renderEditor();
      await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(3));

      await waitFor(() => expect(screen.getByText(/Issues \(1\)/)).toBeInTheDocument());

      unmount();
      renderEditor();
      await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(3));
      expect(screen.getByText(/Issues \(1\)/)).toBeInTheDocument();
    });

    it('scopes dismissals per branch', async () => {
      mockLoadTopology.mockResolvedValue(twoIssueFixture);
      const { unmount } = renderEditor({ branchId: 'branch-a' });
      await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(3));

      const panel = await openPanel();
      fireEvent.click(panel.querySelectorAll('.topology-validation-item-dismiss')[0] as HTMLElement);
      await waitFor(() => expect(screen.getByText(/Issues \(1\)/)).toBeInTheDocument());

      unmount();
      renderEditor({ branchId: 'branch-b' });
      await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(3));
      expect(screen.getByText(/Issues \(2\)/)).toBeInTheDocument();
    });

    it('forgets a dismissal once the underlying problem is fixed', async () => {
      mockLoadTopology.mockResolvedValue(twoIssueFixture);
      const { unmount } = renderEditor();
      await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(3));

      const panel = await openPanel();
      fireEvent.click(panel.querySelectorAll('.topology-validation-item-dismiss')[0] as HTMLElement);
      // A clean diagram (no issues) drops the dismissal in memory — a genuine
      // recurrence later will surface again instead of staying hidden.
      unmount();
      mockLoadTopology.mockResolvedValue(null);
      renderEditor();
      await waitFor(() => expect(document.querySelector('.topology-issues-btn')).toBeNull());
      expect(screen.queryByText(/Issues \(/)).toBeNull();
    });

    it('ignores unknown dismissal keys from the topology document', async () => {
      mockLoadTopology.mockResolvedValue({
        ...twoIssueFixture,
        resolved_issue_keys: ['garbage'],
      });
      renderEditor();
      await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(3));
      expect(screen.getByText(/Issues \(2\)/)).toBeInTheDocument();
    });

    describe('settled issues-count readout', () => {
      it('defers the readout update until the count settles', async () => {
        mockLoadTopology.mockResolvedValue(twoIssueFixture);
        renderEditor();
        await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(3));

        const panel = await openPanel();
        fireEvent.click(panel.querySelectorAll('.topology-validation-item-dismiss')[0] as HTMLElement);

        // The panel is live, but the badge readout keeps the previous
        // settled value until the count holds steady — a drag or dismiss
        // burst must not flicker the number on every validation recompute.
        expect(screen.getByText(/Issues \(2\)/)).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText(/Issues \(1\)/)).toBeInTheDocument());
      });

      it('settles a burst of changes to the final count, skipping intermediates', async () => {
        const threeIssueFixture = {
          nodes: [
            { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
            { id: 'ws-1', type: 'workspace', name: 'Retail POS #1', x: 380, y: 80, metadata: { typeKey: 'store-pos' } },
            { id: 'ws-2', type: 'workspace', name: 'KDS #1', x: 380, y: 240, metadata: { typeKey: 'kds' } },
            { id: 'ws-3', type: 'workspace', name: 'KDS #2', x: 380, y: 400, metadata: { typeKey: 'kds' } },
          ],
          wires: [],
        } as never;
        mockLoadTopology.mockResolvedValue(threeIssueFixture);
        renderEditor();
        await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(4));

        fireEvent.click(screen.getByText(/Issues \(3\)/));
        const panel = document.querySelector('.topology-validation-panel') as HTMLElement;
        const dismiss = panel.querySelectorAll('.topology-validation-item-dismiss');
        fireEvent.click(dismiss[0] as HTMLElement);
        fireEvent.click(dismiss[1] as HTMLElement);

        // Both dismisses landed inside the settle window: the readout is
        // still on the previous settled value, then jumps straight to the
        // final count without ever showing the intermediate 2.
        expect(screen.getByText(/Issues \(3\)/)).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText(/Issues \(1\)/)).toBeInTheDocument());
      });

      it('applies the pop animation when the readout settles on a new count', async () => {
        mockLoadTopology.mockResolvedValue(twoIssueFixture);
        renderEditor();
        await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(3));

        const panel = await openPanel();
        fireEvent.click(panel.querySelectorAll('.topology-validation-item-dismiss')[0] as HTMLElement);

        await waitFor(() => {
          expect(screen.getByText(/Issues \(1\)/)).toHaveClass('topology-issues-label-pop');
        });
      });
    });
  });

  it('persists the elbow routing preference to the branch-scoped key', () => {
    renderEditor();
    openRackPanel('view'); fireEvent.click(screen.getByText('Elbow wires'));
    expect(localStorage.getItem('oz-topology-view-routing:unassigned')).toBe('elbow');
  });

  it('restores the elbow routing preference on mount', () => {
    localStorage.setItem('oz-topology-view-routing:unassigned', 'elbow');
    renderEditor();

    const path = document.querySelector('.wire-path') as SVGPathElement;
    expect(path.getAttribute('d')).toContain('L ');
  });

  it('persists the snap preference to the branch-scoped key', () => {
    renderEditor();
    openRackPanel('view'); fireEvent.click(screen.getByText('Snap to grid')); // toggles OFF
    expect(localStorage.getItem('oz-topology-view-snap:unassigned')).toBe('0');
  });

  describe('per-branch snap persistence', () => {
    // Scrub after too so a leftover '0' under a branch key can't affect
    // later default-mount describes that assume snap is on.
    afterEach(() => localStorage.clear());

    it("persists the choice to the active branch's key only", () => {
      renderEditor({ branchId: 'branch-a' });
      openRackPanel('view'); fireEvent.click(screen.getByText('Snap to grid')); // toggles OFF

      expect(localStorage.getItem('oz-topology-view-snap:branch-a')).toBe('0');
      expect(localStorage.getItem('oz-topology-view-snap:branch-b')).toBeNull();
    });

    it("restores the branch's own saved snap on mount", () => {
      localStorage.setItem('oz-topology-view-snap:branch-a', '0');
      renderEditor({ branchId: 'branch-a' });

      openRackPanel('view'); expect(screen.getByRole('button', { name: 'Snap to grid' })).toHaveAttribute('aria-pressed', 'false');
    });

    it("does not leak another branch's saved snap", () => {
      localStorage.setItem('oz-topology-view-snap:branch-a', '0');
      renderEditor({ branchId: 'branch-b' });

      openRackPanel('view'); expect(screen.getByRole('button', { name: 'Snap to grid' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('inherits the legacy per-install value once when no per-branch choice exists', () => {
      localStorage.setItem('oz-topology-view-snap', '0');
      renderEditor({ branchId: 'branch-a' });

      openRackPanel('view'); expect(screen.getByRole('button', { name: 'Snap to grid' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('falls back to snap ON when the saved value is corrupted', () => {
      localStorage.setItem('oz-topology-view-snap:branch-a', 'garbage');
      renderEditor({ branchId: 'branch-a' });

      openRackPanel('view'); expect(screen.getByRole('button', { name: 'Snap to grid' })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('per-branch wire-routing persistence', () => {
    // The parent describe clears localStorage before each test; scrub after
    // too so a leftover 'elbow' under the 'unassigned' key can't leak into
    // later describes that assert curved paths on a default mount.
    afterEach(() => localStorage.clear());

    it('persists the choice to the active branch\'s key only', () => {
      renderEditor({ branchId: 'branch-a' });
      openRackPanel('view'); fireEvent.click(screen.getByText('Elbow wires'));

      expect(localStorage.getItem('oz-topology-view-routing:branch-a')).toBe('elbow');
      expect(localStorage.getItem('oz-topology-view-routing:branch-b')).toBeNull();
    });

    it('restores the branch\'s own saved routing on mount', () => {
      localStorage.setItem('oz-topology-view-routing:branch-a', 'elbow');
      renderEditor({ branchId: 'branch-a' });

      const path = document.querySelector('.wire-path') as SVGPathElement;
      expect(path.getAttribute('d')).toContain('L ');
    });

    it('does not leak another branch\'s saved routing', () => {
      localStorage.setItem('oz-topology-view-routing:branch-a', 'elbow');
      renderEditor({ branchId: 'branch-b' });

      const path = document.querySelector('.wire-path') as SVGPathElement;
      expect(path.getAttribute('d')).toContain('C ');
    });

    it('inherits the legacy per-install value once when no per-branch choice exists', () => {
      localStorage.setItem('oz-topology-view-routing', 'elbow');
      renderEditor({ branchId: 'branch-a' });

      const path = document.querySelector('.wire-path') as SVGPathElement;
      expect(path.getAttribute('d')).toContain('L ');
    });

    it('falls back to curved when the saved value is corrupted', () => {
      localStorage.setItem('oz-topology-view-routing:branch-a', 'garbage');
      renderEditor({ branchId: 'branch-a' });

      const path = document.querySelector('.wire-path') as SVGPathElement;
      expect(path.getAttribute('d')).toContain('C ');
    });
  });
});

// ── Wire label pills ────────────────────────────────────────────

describe('NodeTopologyEditor — wire label pills', () => {
  beforeEach(() => {
    mockLoadTopology.mockResolvedValue(null);
    localStorage.clear();
  });

  const pills = () => [...document.querySelectorAll('.wire-label-pill')];

  it('are hidden by default; the View toggle reveals a pill at each wire midpoint', () => {
    renderEditor();
    expect(pills()).toHaveLength(0);

    openRackPanel('view'); fireEvent.click(screen.getByText('Wire labels'));
    openRackPanel('view'); expect(screen.getByRole('button', { name: 'Wire labels' })).toHaveAttribute('aria-pressed', 'true');

    // One pill per preset wire, titled with the label (custom or endpoint).
    const texts = pills().map((p) => p.textContent);
    expect(texts).toContain('Binds Store');
    expect(texts).toContain('Operation Feed');
  });

  it('clicking a pill opens the rename editor without cycling the direction', () => {
    renderEditor();
    openRackPanel('view'); fireEvent.click(screen.getByText('Wire labels'));

    const path = () => document.querySelector('.wire-path') as SVGPathElement;
    expect(path().getAttribute('data-direction')).toBe('one-way');

    fireEvent.click(pills()[0]!);

    // The rename editor opens seeded with the label (round 20 flow) and the
    // wire is selected — but the direction did NOT cycle (the wire itself
    // remains the cycle affordance).
    const input = document.querySelector('.wire-rename-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('Binds Store');
    expect(path().getAttribute('data-direction')).toBe('one-way');
    expect(document.querySelector('.wire-selected')).not.toBeNull();
  });

  it('the pill of the wire being renamed is replaced by the editor input', () => {
    renderEditor();
    openRackPanel('view'); fireEvent.click(screen.getByText('Wire labels'));

    fireEvent.click(pills()[0]!);

    expect(document.querySelector('.wire-rename-input')).not.toBeNull();
    expect(pills()).toHaveLength(1); // the renamed wire's pill is hidden
  });

  it('persists the preference to the branch-scoped key', () => {
    renderEditor();
    openRackPanel('view'); fireEvent.click(screen.getByText('Wire labels'));
    expect(localStorage.getItem('oz-topology-view-wire-labels:unassigned')).toBe('1');
  });

  it('restores the wire-labels preference on mount', () => {
    localStorage.setItem('oz-topology-view-wire-labels:unassigned', '1');
    renderEditor();

    expect(pills()).toHaveLength(2);
    openRackPanel('view'); expect(screen.getByRole('button', { name: 'Wire labels' })).toHaveAttribute('aria-pressed', 'true');
  });

  describe('per-branch wire-labels persistence', () => {
    afterEach(() => localStorage.clear());

    it("persists the choice to the active branch's key only", () => {
      renderEditor({ branchId: 'branch-a' });
      openRackPanel('view'); fireEvent.click(screen.getByText('Wire labels'));

      expect(localStorage.getItem('oz-topology-view-wire-labels:branch-a')).toBe('1');
      expect(localStorage.getItem('oz-topology-view-wire-labels:branch-b')).toBeNull();
    });

    it("restores the branch's own saved wire-labels on mount", () => {
      localStorage.setItem('oz-topology-view-wire-labels:branch-a', '1');
      renderEditor({ branchId: 'branch-a' });

      expect(pills()).toHaveLength(2);
      openRackPanel('view'); expect(screen.getByRole('button', { name: 'Wire labels' })).toHaveAttribute('aria-pressed', 'true');
    });

    it("does not leak another branch's saved wire-labels", () => {
      localStorage.setItem('oz-topology-view-wire-labels:branch-a', '1');
      renderEditor({ branchId: 'branch-b' });

      expect(pills()).toHaveLength(0);
    });

    it('inherits the legacy per-install value once when no per-branch choice exists', () => {
      localStorage.setItem('oz-topology-view-wire-labels', '1');
      renderEditor({ branchId: 'branch-a' });

      expect(pills()).toHaveLength(2);
    });

    it('falls back to hidden when the saved value is corrupted', () => {
      localStorage.setItem('oz-topology-view-wire-labels:branch-a', 'garbage');
      renderEditor({ branchId: 'branch-a' });

      expect(pills()).toHaveLength(0);
    });
  });

  it('dims pills for wires outside the hovered node neighbourhood', () => {
    renderEditor();
    openRackPanel('view'); fireEvent.click(screen.getByText('Wire labels'));

    // Hover the store: w-2 (ws-1 → wh-1) is not in its neighbourhood.
    fireEvent.mouseEnter(document.querySelectorAll('.topology-node')[0]!);

    const dimmed = document.querySelectorAll('.wire-label-pill.wire-label-pill-dimmed');
    expect(dimmed).toHaveLength(1);
    expect(dimmed[0]!.textContent).toBe('Operation Feed');
  });
});

// ── Alignment guides while dragging ─────────────────────────────

describe('NodeTopologyEditor — alignment guides', () => {
  beforeEach(() => {
    mockLoadTopology.mockResolvedValue(null);
  });

  const canvas = () => document.querySelector('.node-canvas-container') as HTMLElement;

  it('snaps a dragged edge to a stationary edge and draws a vertical guide', () => {
    renderEditor();
    mockCanvasSize(1200, 800);
    const store = nodeAt(0); // store-1 at (80, 140) — box 80–320 × 140–380

    // Drag store-1 so its RIGHT edge (raw x 140 + 240 = 380) lands on
    // ws-1's LEFT edge (380). The raw 140 would grid-snap to 144, so an
    // exact 140 proves the guide won over the grid.
    fireEvent.mouseDown(store, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 60, clientY: 24 });

    expect(store.style.left).toBe('140px');
    expect(document.querySelector('.alignment-guide-x')).not.toBeNull();
    expect(document.querySelector('.alignment-guide-y')).toBeNull();
  });

  it('snaps a dragged center to a stationary center and draws a horizontal guide', () => {
    renderEditor();
    mockCanvasSize(1200, 800);
    const ws = nodeAt(1); // ws-1 at (380, 80) — centerY 200

    // Drag ws-1 down so its centerY (raw y 140 + 120 = 260) lands on
    // store-1's centerY (260). Exact 140 vs the grid's 144 again.
    fireEvent.mouseDown(ws, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 0, clientY: 60 });

    expect(ws.style.top).toBe('140px');
    expect(document.querySelector('.alignment-guide-y')).not.toBeNull();
    expect(document.querySelector('.alignment-guide-x')).toBeNull();
  });

  it('does not snap beyond the threshold (guides stay clear)', () => {
    renderEditor();
    mockCanvasSize(1200, 800);
    openRackPanel('view'); fireEvent.click(screen.getByText('Snap to grid')); // toggles OFF
    const store = nodeAt(0);

    // Right edge lands at 390 — 10px past ws-1's left edge (380): no snap.
    fireEvent.mouseDown(store, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 70, clientY: 24 });

    expect(store.style.left).toBe('150px');
    expect(document.querySelector('.alignment-guide')).toBeNull();
  });

  it('clears the guides when the drag ends', () => {
    renderEditor();
    mockCanvasSize(1200, 800);
    const store = nodeAt(0);

    fireEvent.mouseDown(store, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 60, clientY: 24 });
    expect(document.querySelector('.alignment-guide-x')).not.toBeNull();

    fireEvent.mouseUp(canvas(), { button: 0 });
    expect(document.querySelector('.alignment-guide')).toBeNull();
  });

  it('applies the snap to the whole dragged group rigidly', () => {
    renderEditor();
    mockCanvasSize(1200, 800);
    const canvasEl = canvas();

    // Backward marquee (touched semantics) selects ws-1 + wh-1 only.
    fireEvent.mouseDown(canvasEl, { button: 0, clientX: 700, clientY: 400 });
    fireEvent.mouseMove(canvasEl, { clientX: 380, clientY: 80 });
    fireEvent.mouseUp(canvasEl, { button: 0 });
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(2);

    // Drag ws-1 so its LEFT edge (320) meets store-1's RIGHT edge (320).
    // The −60 delta must carry wh-1 along (680 → 620), group-rigid.
    fireEvent.mouseDown(nodeAt(1), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvasEl, { clientX: -60, clientY: 0 });

    expect(nodeAt(1).style.left).toBe('320px');
    expect(nodeAt(2).style.left).toBe('620px');
    expect(document.querySelector('.alignment-guide-x')).not.toBeNull();
  });

  it('snaps on a NON-grabbed member\'s edge and carries the whole group rigidly', () => {
    renderEditor();
    mockCanvasSize(1200, 800);
    const canvasEl = canvas();

    // Backward marquee selects ws-1 + wh-1 (grabbed = ws-1).
    fireEvent.mouseDown(canvasEl, { button: 0, clientX: 700, clientY: 400 });
    fireEvent.mouseMove(canvasEl, { clientX: 380, clientY: 80 });
    fireEvent.mouseUp(canvasEl, { button: 0 });
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(2);

    // Drag the group by (−360, 0): ws-1 → (20, 80), wh-1 → (320, 140). The
    // GRABBED node's edges touch nothing, but wh-1's LEFT edge lands exactly
    // on store-1's RIGHT edge (320) — the group must snap on that member.
    fireEvent.mouseDown(nodeAt(1), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvasEl, { clientX: -360, clientY: 0 });

    // Aligned-axis grid skip holds for the whole group: ws-1 stays at the
    // raw 20 (not snap(20) = 24) and wh-1 at exactly 320.
    expect(nodeAt(1).style.left).toBe('20px');
    expect(nodeAt(2).style.left).toBe('320px');
    expect(document.querySelector('.alignment-guide-x')).not.toBeNull();
  });

  it('snaps EXACTLY onto the line when the drag approaches 3px PAST it', async () => {
    // A at (200, 200) — right edge 440; B at (446, 250) — left edge 446.
    // Drag A so its right edge RAW-lands at 449 (3px past the line): the
    // snap must pull it back onto 446, not park it 6px past (the sign bug
    // would land at 212px; the correct landing is 206px = flush at 446).
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'a', type: 'store', name: 'A', x: 200, y: 200 },
        { id: 'b', type: 'workspace', name: 'B', x: 446, y: 250, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));
    mockCanvasSize(1200, 800);
    const a = document.querySelector('.topology-node[data-node-id="a"]') as HTMLElement;

    // offset = 0 − 200 = −200; clientX 9 → target x 209 (edge 449).
    fireEvent.mouseDown(a, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 9, clientY: 0 });

    expect(a.style.left).toBe('206px');
    expect(document.querySelector('.alignment-guide-x')).not.toBeNull();
    expect((document.querySelector('.alignment-guide-x') as HTMLElement).style.left).toBe('446px');
  });

  it('snaps EXACTLY onto the line when the drag approaches 3px SHORT of it', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'a', type: 'store', name: 'A', x: 200, y: 200 },
        { id: 'b', type: 'workspace', name: 'B', x: 446, y: 250, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));
    mockCanvasSize(1200, 800);
    const a = document.querySelector('.topology-node[data-node-id="a"]') as HTMLElement;

    // clientX 3 → target x 203 (edge 443, 3px short): the snap must push it
    // forward onto 446 (206px) — the sign bug would land at 200px instead.
    fireEvent.mouseDown(a, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 3, clientY: 0 });

    expect(a.style.left).toBe('206px');
    expect(document.querySelector('.alignment-guide-x')).not.toBeNull();
  });
});

// ── Alt+drag to duplicate ───────────────────────────────────────

describe('NodeTopologyEditor — Alt+drag to duplicate', () => {
  beforeEach(() => {
    mockLoadTopology.mockResolvedValue(null);
  });

  const canvas = () => document.querySelector('.node-canvas-container') as HTMLElement;
  const nodeBy = (id: string) =>
    document.querySelector(`.topology-node[data-node-id="${id}"]`) as HTMLElement;
  const copyNodes = (prefix: string) =>
    [...document.querySelectorAll('.topology-node')].filter((n) =>
      n.getAttribute('data-node-id')!.startsWith(`${prefix}-`),
    ) as HTMLElement[];

  it('duplicates the dragged node: the original stays put, the copy follows the cursor', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [{ id: 'a', type: 'store', name: 'A', x: 200, y: 200 }],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(1));
    mockCanvasSize(1200, 800);

    // Alt+drag: offset −200 → the copy lands at x 300 (clientX 100); the
    // original must NOT move (a plain drag would move it to 300 too).
    fireEvent.mouseDown(nodeBy('a'), { button: 0, altKey: true, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 100, clientY: 0 });
    fireEvent.mouseUp(canvas(), { button: 0 });

    expect(getNodeCount()).toBe(2);
    expect(nodeBy('a').style.left).toBe('200px'); // original unmoved

    const copy = copyNodes('store');
    expect(copy).toHaveLength(1);
    // The copy followed the cursor through the SAME snap pipeline as a
    // normal drag: raw 300 → snap(300) = 312.
    expect(copy[0]!.style.left).toBe('312px');
    // The copy became the selection; the original was released.
    expect(copy[0]!.classList.contains('node-selected')).toBe(true);
    expect(nodeBy('a').classList.contains('node-selected')).toBe(false);
  });

  it('Escape cancels an in-flight Alt+drag: no copy, no history entry, original stays', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [{ id: 'a', type: 'store', name: 'A', x: 200, y: 200 }],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(1));
    mockCanvasSize(1200, 800);

    fireEvent.mouseDown(nodeBy('a'), { button: 0, altKey: true, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 100, clientY: 0 });
    expect(getNodeCount()).toBe(2); // copy previewed live mid-drag

    fireEvent.keyDown(canvas(), { key: 'Escape' });

    expect(getNodeCount()).toBe(1);
    expect(nodeBy('a').style.left).toBe('200px');
    expect(screen.queryByText('Undo (Ctrl+Z)')).toBeNull(); // nothing pushed
  });

  it('duplicates the whole group rigidly and copies wires with both endpoints selected', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'a', type: 'store', name: 'A', x: 200, y: 200 },
        { id: 'b', type: 'workspace', name: 'B', x: 500, y: 200, metadata: { typeKey: 'store-pos' } },
      ],
      // Loaded wire shape is snake_case (backend contract).
      wires: [{ id: 'w1', from_node_id: 'a', to_node_id: 'b', direction: 'one-way' }],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));
    mockCanvasSize(1200, 800);

    // Backward marquee selects A + B.
    fireEvent.mouseDown(canvas(), { button: 0, clientX: 800, clientY: 500 });
    fireEvent.mouseMove(canvas(), { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(canvas(), { button: 0 });
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(2);

    // Snap off so the rigid +60 group delta is exact (per-node grid snap
    // would land the copies at 264/552 instead — snap is covered in test 1).
    openRackPanel('view'); fireEvent.click(screen.getByText('Snap to grid'));

    // Alt+drag on A by +60: BOTH copies ride along rigidly (+60 each).
    fireEvent.mouseDown(nodeBy('a'), { button: 0, altKey: true, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 60, clientY: 0 });
    fireEvent.mouseUp(canvas(), { button: 0 });

    expect(getNodeCount()).toBe(4);
    expect(getWireCount()).toBe(2); // original + copy (both endpoints copied)
    expect(nodeBy('a').style.left).toBe('200px');
    expect(nodeBy('b').style.left).toBe('500px');

    const storeCopy = copyNodes('store');
    const wsCopy = copyNodes('workspace');
    expect(storeCopy).toHaveLength(1);
    expect(wsCopy).toHaveLength(1);
    expect(storeCopy[0]!.style.left).toBe('260px');
    expect(wsCopy[0]!.style.left).toBe('560px');
  });

  it('does not copy a wire when only one endpoint is Alt+dragged — no dangling copy', async () => {
    // Canonical load (gate active) so a corrupted copy would surface as the
    // graph banner — the wire render is geometry-gated, so the banner is
    // the state-level signal that survives it.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 200, y: 200, store_profile_id: 'store-1' },
        { id: 'ws-1', type: 'workspace', name: 'POS #1', x: 500, y: 200, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [{ id: 'w1', from_node_id: 'store-1', to_node_id: 'ws-1', direction: 'one-way' }],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));
    mockCanvasSize(1200, 800);

    // Alt+drag the store alone — the wire's other endpoint (ws-1) is NOT in
    // the selection, so the wire must NOT come along (mirror of the Ctrl+D
    // one-endpoint pin, at the state level).
    fireEvent.mouseDown(nodeBy('store-1'), { button: 0, altKey: true, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 100, clientY: 0 });
    fireEvent.mouseUp(canvas(), { button: 0 });

    expect(getNodeCount()).toBe(3); // store, ws, store-copy
    expect(getWireCount()).toBe(1); // the ORIGINAL wire only
    expect(document.querySelector('.topology-validation-banner')).toBeNull();
  });

  it('Alt pressed MID-move does not copy a wire with only one endpoint dragged', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 200, y: 200, store_profile_id: 'store-1' },
        { id: 'ws-1', type: 'workspace', name: 'POS #1', x: 500, y: 200, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [{ id: 'w1', from_node_id: 'store-1', to_node_id: 'ws-1', direction: 'one-way' }],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));
    mockCanvasSize(1200, 800);

    // Plain move of the store, then convert MID-move: the conversion route
    // (convertDragToDuplicate) must apply the same both-endpoints rule.
    fireEvent.mouseDown(nodeBy('store-1'), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 100, clientY: 0 });
    fireEvent.keyDown(canvas(), { key: 'Alt' });
    fireEvent.mouseUp(canvas(), { button: 0 });

    expect(getNodeCount()).toBe(3);
    expect(getWireCount()).toBe(1);
    expect(document.querySelector('.topology-validation-banner')).toBeNull();
  });

  it('an undo entry whose wire references a node missing from the entry cannot resurrect it', async () => {
    // Restore-boundary hardening: Undo/Redo apply entries verbatim, so a
    // future creation-path regression that let a dangling wire into a
    // history entry would resurrect it on undo. The restore guard drops
    // wires whose endpoints are absent from the SAME entry — the
    // never-dangling invariant holds at the one place state lands.
    // Mutation-verified: forcing commitDuplicateDrag's entry wire-filter
    // to keep copy wires makes this undo restore a dangling wire (the
    // unknown-wire-endpoint banner fires) until the guard exists.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-1', type: 'workspace', name: 'POS #1', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [{ id: 'w1', from_node_id: 'store-1', to_node_id: 'ws-1', direction: 'one-way' }],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));
    mockCanvasSize(1200, 800);

    // Backward marquee selects both, then Alt+drag duplicates them
    // (copies + a copy wire).
    fireEvent.mouseDown(canvas(), { button: 0, clientX: 800, clientY: 500 });
    fireEvent.mouseMove(canvas(), { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(canvas(), { button: 0 });
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(2);
    fireEvent.mouseDown(nodeBy('store-1'), { button: 0, altKey: true, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 60, clientY: 0 });
    fireEvent.mouseUp(canvas(), { button: 0 });
    expect(getNodeCount()).toBe(4);
    expect(getWireCount()).toBe(2);

    // ONE undo removes the whole duplicate — and whatever entry it
    // restores, no wire may reference a node that is not also restored.
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(getNodeCount()).toBe(2));
    expect(getWireCount()).toBe(1);
    expect(screen.queryByText('This wire references a node that is not in the graph.')).toBeNull();
  });

  it('an Alt+drag duplicate round-trips undo → redo with the copy wire intact', async () => {
    // The commitDuplicateDrag entry is the one FILTERED entry in the whole
    // history (current state minus the copy ids). Its round-trip through
    // undo → redo pins that the entry — and the redo-push it spawns — stay
    // endpoint-consistent: redo restores the copies AND the copy wire
    // together, never a wire whose endpoints are missing from the entry.
    // A clean round-trip must also stay silent: the guard's [topology]
    // diagnostic fires only when a wire is actually dropped (corruption).
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-1', type: 'workspace', name: 'POS #1', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [
        { id: 'w-1', from_node_id: 'store-1', to_node_id: 'ws-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
      ],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));
    mockCanvasSize(1200, 800);

    // Backward marquee selects both, then Alt+drag duplicates them
    // (copies + a copy wire).
    fireEvent.mouseDown(canvas(), { button: 0, clientX: 800, clientY: 500 });
    fireEvent.mouseMove(canvas(), { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(canvas(), { button: 0 });
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(2);
    fireEvent.mouseDown(nodeBy('store-1'), { button: 0, altKey: true, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 60, clientY: 0 });
    fireEvent.mouseUp(canvas(), { button: 0 });
    expect(getNodeCount()).toBe(4);
    expect(getWireCount()).toBe(2);

    // Undo → pre-drag state. The undo state is where a dangling entry would
    // surface: no wire may reference a node the undo did not also restore.
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(getNodeCount()).toBe(2));
    expect(getWireCount()).toBe(1);
    expect(screen.queryByText('This wire references a node that is not in the graph.')).toBeNull();

    // Redo → copies AND the copy wire return.
    openRackPanel('edit'); fireEvent.click(screen.getByText('Redo (Ctrl+Y)'));
    await waitFor(() => expect(getNodeCount()).toBe(4));
    expect(getWireCount()).toBe(2);
    expect(screen.queryByText('This wire references a node that is not in the graph.')).toBeNull();
    // No corruption diagnostic on a clean round-trip — the guards only
    // record a dev-log warn when they actually drop a dangling wire.
    expect(getDevLog().filter((e) => e.source === 'topology')).toHaveLength(0);
  });

  it('an Alt+dragged Branch Location copy is identity-less — never a second branch impersonation', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-1', type: 'workspace', name: 'POS #1', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [
        { id: 'w-1', from_node_id: 'store-1', to_node_id: 'ws-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
      ],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));
    mockCanvasSize(1200, 800);

    fireEvent.mouseDown(nodeBy('store-1'), { button: 0, altKey: true, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 120, clientY: 0 });
    fireEvent.mouseUp(canvas(), { button: 0 });
    await waitFor(() => expect(getNodeCount()).toBe(3));

    // The copy took the selection. Its note leads with the multiple-branch
    // guidance and the title carries the identity error — the copy is
    // diagram-only, never a second branch impersonating the original
    // (sanitizeCopiedNode must strip storeProfileId on THIS route too).
    const selected = [...document.querySelectorAll('.topology-node.node-selected')] as HTMLElement[];
    expect(selected).toHaveLength(1);
    expect(
      within(selected[0]!).getByText('Keep exactly one Branch Location node in this graph.'),
    ).toBeInTheDocument();
    const note = selected[0]!.querySelector('.node-validation-note') as HTMLElement | null;
    expect(note?.title).toContain('missing its store profile identity');
  });

  it('the duplicate drop is ONE undo entry', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [{ id: 'a', type: 'store', name: 'A', x: 200, y: 200 }],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(1));
    mockCanvasSize(1200, 800);

    fireEvent.mouseDown(nodeBy('a'), { button: 0, altKey: true, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 100, clientY: 0 });
    fireEvent.mouseUp(canvas(), { button: 0 });
    expect(getNodeCount()).toBe(2);

    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));
    expect(getNodeCount()).toBe(1); // the whole copy vanishes in one undo
    expect(nodeBy('a').style.left).toBe('200px');
  });

  it('Alt pressed MID-move converts the move into a live duplicate (Figma)', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [{ id: 'a', type: 'store', name: 'A', x: 200, y: 200 }],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(1));
    mockCanvasSize(1200, 800);

    // Plain move drag: the node follows the cursor to snap(300) = 312.
    fireEvent.mouseDown(nodeBy('a'), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 100, clientY: 0 });
    expect(nodeBy('a').style.left).toBe('312px');

    // Press Alt MID-drag: the original snaps back to its start (200) and a
    // copy takes over the cursor, continuing from the current position (312).
    fireEvent.keyDown(canvas(), { key: 'Alt' });
    expect(nodeBy('a').style.left).toBe('200px'); // original dropped back
    expect(getNodeCount()).toBe(2); // the copy took over the drag

    // The copy keeps following: snap(350) = 360.
    fireEvent.mouseMove(canvas(), { clientX: 150, clientY: 0 });
    fireEvent.mouseUp(canvas(), { button: 0 });

    const copy = copyNodes('store');
    expect(copy).toHaveLength(1);
    expect(copy[0]!.style.left).toBe('360px');
    expect(copy[0]!.classList.contains('node-selected')).toBe(true);
  });

  it('Escape after a mid-drag convert cancels: no copy, no history entry', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [{ id: 'a', type: 'store', name: 'A', x: 200, y: 200 }],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(1));
    mockCanvasSize(1200, 800);

    fireEvent.mouseDown(nodeBy('a'), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 100, clientY: 0 });
    expect(getNodeCount()).toBe(1);

    fireEvent.keyDown(canvas(), { key: 'Alt' });
    expect(getNodeCount()).toBe(2);

    fireEvent.keyDown(canvas(), { key: 'Escape' });

    expect(getNodeCount()).toBe(1);
    expect(nodeBy('a').style.left).toBe('200px');
    expect(screen.queryByText('Undo (Ctrl+Z)')).toBeNull(); // entry popped too
  });

  it('a converted drop is ONE undo entry (the move entry doubles as pre-drag)', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [{ id: 'a', type: 'store', name: 'A', x: 200, y: 200 }],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(1));
    mockCanvasSize(1200, 800);

    fireEvent.mouseDown(nodeBy('a'), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 100, clientY: 0 });
    fireEvent.keyDown(canvas(), { key: 'Alt' });
    fireEvent.mouseMove(canvas(), { clientX: 150, clientY: 0 });
    fireEvent.mouseUp(canvas(), { button: 0 });
    expect(getNodeCount()).toBe(2);

    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));
    expect(getNodeCount()).toBe(1); // exactly ONE undo removes the copy
    expect(nodeBy('a').style.left).toBe('200px');
  });
});

// ── Legacy-schema migration dialog (ADR #34 item 7) ────────────

describe('NodeTopologyEditor — legacy-schema migration dialog', () => {
  beforeEach(() => {
    mockLoadTopology.mockResolvedValue(null);
  });

  /** Canonical diagram with ONE unresolvable-by-identity legacy wire: a
   *  KDS → printer wire carrying NO semantic fields. No identity rule
   *  folds it (kds→hardware), so it normalizes to legacy-out/legacy-in and
   *  the graph reports ambiguous-legacy-wire. The kds→hardware pair has
   *  exactly one legal relationship (ticket-routing). */
  const ambiguousTicketDiagram = {
    nodes: [
      { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
      { id: 'kds-1', type: 'workspace', name: 'Kitchen KDS', x: 380, y: 140, metadata: { typeKey: 'kds' } },
      { id: 'hw-1', type: 'hardware', name: 'Thermal Printer', x: 680, y: 140 },
    ],
    wires: [
      { id: 'w-amb', from_node_id: 'kds-1', to_node_id: 'hw-1', from_port: 'right', to_port: 'left', direction: 'one-way' },
    ],
  } as never;

  it('auto-opens on an ambiguous legacy wire and resolves it in place', async () => {
    mockLoadTopology.mockResolvedValueOnce(ambiguousTicketDiagram);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));

    // The migration dialog auto-opens listing the unresolved wire.
    const dialog = await waitFor(() => {
      const el = document.querySelector('.topology-migration-dialog') as HTMLElement | null;
      expect(el).not.toBeNull();
      return el!;
    });
    expect(within(dialog).getByText('Kitchen KDS → Thermal Printer')).toBeInTheDocument();

    // The only legal relationship is offered and pre-selected.
    const select = within(dialog).getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('0');
    expect(within(dialog).getByText('Ticket routing')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByText('Resolve'));

    await waitFor(() => expect(document.querySelector('.topology-migration-dialog')).toBeNull());
    // The wire now carries the ticket-routing semantics — its tooltip
    // label reads like an authored wire.
    const hitbox = document.querySelector('.wire-hitbox[data-wire-id="w-amb"]') as HTMLElement | null;
    expect(hitbox?.querySelector('title')?.textContent).toContain('Ticket Print');
    // The ambiguous-wire error cleared from the validation panel.
    fireEvent.click(document.querySelector('.topology-issues-btn')!);
    const panel = document.querySelector('.topology-validation-panel') as HTMLElement | null;
    expect(panel).not.toBeNull();
    expect(panel!.textContent).not.toContain('cannot be identified safely');
  });

  it('one undo restores the unresolved wire and re-offers the dialog', async () => {
    mockLoadTopology.mockResolvedValueOnce(ambiguousTicketDiagram);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));

    const dialog = await waitFor(() => {
      const el = document.querySelector('.topology-migration-dialog') as HTMLElement | null;
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.click(within(dialog).getByText('Resolve'));
    await waitFor(() => expect(document.querySelector('.topology-migration-dialog')).toBeNull());
    expect(getWireCount()).toBe(1);

    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(getWireCount()).toBe(1));
    // The wire is back to UNRESOLVED (no ticket label — the tooltip is the
    // bare toggle hint again) and the ambiguity re-surfaces — the dialog
    // re-offers itself.
    const hitbox = document.querySelector('.wire-hitbox[data-wire-id="w-amb"]') as HTMLElement | null;
    expect(hitbox?.querySelector('title')?.textContent).not.toContain('Ticket Print');
    await waitFor(() => expect(document.querySelector('.topology-migration-dialog')).not.toBeNull());
  });

  it('offers delete-only for a legacy wire with no compatible meaning', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-1', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'ws-2', type: 'workspace', name: 'POS B', x: 380, y: 420, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [
        { id: 'w-owner', from_node_id: 'store-1', to_node_id: 'ws-1', from_port: 'right', to_port: 'left', direction: 'one-way' },
        // store-pos → store-pos has NO legal pairing row: the wire cannot
        // be migrated and must be deleted — never silently reinterpreted.
        { id: 'w-amb', from_node_id: 'ws-1', to_node_id: 'ws-2', from_port: 'right', to_port: 'left', direction: 'one-way' },
      ],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));

    const dialog = await waitFor(() => {
      const el = document.querySelector('.topology-migration-dialog') as HTMLElement | null;
      expect(el).not.toBeNull();
      return el!;
    });
    const select = within(dialog).getByRole('combobox') as HTMLSelectElement;
    expect(select.options).toHaveLength(1); // only "Delete this wire"
    expect(select.value).toBe('delete');

    fireEvent.click(within(dialog).getByText('Resolve'));
    await waitFor(() => expect(document.querySelector('.topology-migration-dialog')).toBeNull());
    expect(getWireCount()).toBe(1); // only the owner wire remains
  });

  it('Later dismisses the dialog and keeps the unresolved wire blocking Apply', async () => {
    mockLoadTopology.mockResolvedValueOnce(ambiguousTicketDiagram);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));

    const dialog = await waitFor(() => {
      const el = document.querySelector('.topology-migration-dialog') as HTMLElement | null;
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.click(within(dialog).getByText('Later'));

    expect(document.querySelector('.topology-migration-dialog')).toBeNull();
    expect(getWireCount()).toBe(1); // the wire is untouched
    // The wire is still unresolved — the panel keeps the error, so Apply
    // stays blocked.
    fireEvent.click(document.querySelector('.topology-issues-btn')!);
    const panel = document.querySelector('.topology-validation-panel') as HTMLElement | null;
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain('cannot be identified safely');
  });

  it('does not open the dialog for a clean canonical diagram', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-1', type: 'workspace', name: 'POS #1', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [
        { id: 'w-1', from_node_id: 'store-1', to_node_id: 'ws-1', from_port_id: 'location-out', to_port_id: 'location-in', relationship_type: 'location', direction: 'one-way' },
      ],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));
    expect(document.querySelector('.topology-migration-dialog')).toBeNull();
  });
});

// ── Accessible live announcements ───────────────────────────────

describe('NodeTopologyEditor — accessible live announcements', () => {
  beforeEach(() => {
    mockLoadTopology.mockResolvedValue(null);
  });

  const canvas = () => document.querySelector('.node-canvas-container') as HTMLElement;
  // The editor also has a role="status" dirty chip — target the live region
  // by its test id instead.
  const status = () => screen.getByTestId('topology-live-region');

  it('announces an alignment snap when a drag lands on a guide', () => {
    renderEditor();
    mockCanvasSize(1200, 800);
    expect(status().textContent).toBe('');

    // store-1 (80,140) → right edge lands on ws-1's left edge (380).
    fireEvent.mouseDown(nodeAt(0), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 60, clientY: 24 });

    expect(status().textContent).toBe('Aligned');
    fireEvent.mouseUp(canvas(), { button: 0 });
    // A re-approach re-announces (the guide clear reset the entry latch).
    fireEvent.mouseDown(nodeAt(0), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 60, clientY: 24 });
    expect(status().textContent).toBe('Aligned');
  });

  it('stays silent for a plain drag that never snaps', () => {
    renderEditor();
    mockCanvasSize(1200, 800);
    expect(status().textContent).toBe('');

    // Right edge lands 10px past ws-1's left edge — beyond the 6px band.
    fireEvent.mouseDown(nodeAt(0), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 70, clientY: 24 });
    fireEvent.mouseUp(canvas(), { button: 0 });

    expect(status().textContent).toBe('');
  });

  it('announces a fine-nudge snap the same way', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'a', type: 'store', name: 'A', x: 200, y: 200 },
        { id: 'b', type: 'workspace', name: 'B', x: 447, y: 250, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));
    expect(status().textContent).toBe('');
    selectFirstNode();

    fireEvent.keyDown(canvas(), { key: 'ArrowRight', shiftKey: true }); // entry snap
    expect(status().textContent).toBe('Aligned');
  });

  it('announces an Alt+drag duplicate drop', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [{ id: 'a', type: 'store', name: 'A', x: 200, y: 200 }],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(1));
    mockCanvasSize(1200, 800);
    expect(status().textContent).toBe('');

    fireEvent.mouseDown(document.querySelector('.topology-node') as HTMLElement, { button: 0, altKey: true, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 100, clientY: 0 });
    fireEvent.mouseUp(canvas(), { button: 0 });

    expect(getNodeCount()).toBe(2);
    expect(status().textContent).toBe('Duplicate created');
  });

  it('announces an Escape-cancelled duplicate drag', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [{ id: 'a', type: 'store', name: 'A', x: 200, y: 200 }],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(1));
    mockCanvasSize(1200, 800);

    fireEvent.mouseDown(document.querySelector('.topology-node') as HTMLElement, { button: 0, altKey: true, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 100, clientY: 0 });
    fireEvent.keyDown(canvas(), { key: 'Escape' });

    expect(getNodeCount()).toBe(1);
    expect(status().textContent).toBe('Duplicate cancelled');
  });

  // Selection announcements are the screen-reader contract for the
  // selectable cards (role=group cannot carry aria-selected — see the a11y
  // suite). The settle timer collapses a marquee flicker into one summary.
  it('announces a single node selection by name', async () => {
    renderEditor();
    mockCanvasSize(1200, 800);
    expect(status().textContent).toBe('');

    selectFirstNode();
    await waitFor(() => expect(status().textContent).toBe('Downtown Branch selected'));
  });

  it('announces a multi-node selection as a settled count', async () => {
    renderEditor();
    mockCanvasSize(1200, 800);
    expect(status().textContent).toBe('');

    fireEvent.keyDown(document, { key: 'a', ctrlKey: true });
    await waitFor(() => expect(status().textContent).toBe('3 selected'));
  });

  it('announces a wire selection', async () => {
    renderEditor();
    mockCanvasSize(1200, 800);
    expect(status().textContent).toBe('');

    const hitbox = document.querySelector('.wire-hitbox');
    expect(hitbox).not.toBeNull();
    fireEvent.click(hitbox!);
    await waitFor(() => expect(status().textContent).toBe('Wire selected'));
  });

  it('announces when the selection is cleared', async () => {
    renderEditor();
    mockCanvasSize(1200, 800);

    selectFirstNode();
    await waitFor(() => expect(status().textContent).toBe('Downtown Branch selected'));
    fireEvent.keyDown(canvas(), { key: 'Escape' });
    await waitFor(() => expect(status().textContent).toBe('Selection cleared'));
  });
});

// ── Escape cancels an in-flight move ────────────────────────────

describe('NodeTopologyEditor — Escape cancels a move', () => {
  beforeEach(() => {
    mockLoadTopology.mockResolvedValue(null);
  });

  const canvas = () => document.querySelector('.node-canvas-container') as HTMLElement;
  const node = () => document.querySelector('.topology-node') as HTMLElement;

  it('Escape mid-move snaps the node back to its start position and pops the drag entry', () => {
    renderEditor();
    mockCanvasSize(1200, 800);
    expect(node().style.left).toBe('80px');

    // Drag to (150, 210): store-1's axes land 10px off every neighbour
    // (no alignment guide), so the grid snap wins → (144, 216).
    fireEvent.mouseDown(node(), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 70, clientY: 70 });
    expect(node().style.left).toBe('144px');
    openRackPanel('edit'); expect(screen.getByText('Undo (Ctrl+Z)')).toBeInTheDocument(); // move pushed an entry

    fireEvent.keyDown(canvas(), { key: 'Escape' });

    // The move is undone — node returns to its start position, and the
    // drag's history entry is popped (undo would otherwise be a no-op).
    expect(node().style.left).toBe('80px');
    expect(screen.queryByText('Undo (Ctrl+Z)')).toBeNull();
    // The selection survives the cancel (Figma keeps it selected).
    expect(node().classList.contains('node-selected')).toBe(true);
  });

  it('a completed move is NOT cancelled by a later Escape', () => {
    renderEditor();
    mockCanvasSize(1200, 800);

    fireEvent.mouseDown(node(), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 70, clientY: 70 });
    fireEvent.mouseUp(canvas(), { button: 0 });
    // The raw landing (144px) overlaps the preset's Retail POS card, so the
    // drop settles clear of it (round 140) — capture the committed value.
    const settledLeft = node().style.left;
    const settledTop = node().style.top;

    fireEvent.keyDown(canvas(), { key: 'Escape' });

    // The move was committed — a later Escape must NOT yank it back.
    expect(node().style.left).toBe(settledLeft);
    expect(node().style.top).toBe(settledTop);
  });

  it('a plain Escape with no drag in flight still clears the selection', () => {
    renderEditor();
    mockCanvasSize(1200, 800);

    fireEvent.mouseDown(node(), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseUp(canvas(), { button: 0 });
    expect(node().classList.contains('node-selected')).toBe(true);

    fireEvent.keyDown(canvas(), { key: 'Escape' });

    expect(node().classList.contains('node-selected')).toBe(false);
  });
});

// ── Auto-fit on load ────────────────────────────────────────────

describe('NodeTopologyEditor — auto-fit on load', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const viewport = () => document.querySelector('.node-canvas-viewport') as HTMLElement;

  it('zooms out to fit an overflowing loaded diagram', async () => {
    // Two nodes 2000px apart — way past the 800px canvas.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'a', type: 'store', name: 'A', x: 0, y: 0 },
        { id: 'b', type: 'workspace', name: 'B', x: 2000, y: 100, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [],
    } as never);
    renderEditor();
    mockCanvasSize(800, 600);
    await waitFor(() => expect(getNodeCount()).toBe(2));

    // fitZoom = min(680/2240, 480/340, 1.5) → 0.30 → clamped to 0.4.
    expect(viewport().style.transform).toContain('scale(0.4)');
  });

  it('leaves the view at identity when the diagram fits the viewport', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [{ id: 'a', type: 'store', name: 'A', x: 80, y: 140 }],
      wires: [],
    } as never);
    renderEditor();
    mockCanvasSize(1200, 800);
    await waitFor(() => expect(getNodeCount()).toBe(1));

    expect(viewport().style.transform).toBe('translate(0px, 0px) scale(1)');
  });

  it('never refits after the user has interacted, even when the content changes', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'a', type: 'hardware', name: 'A', x: 0, y: 0 },
        { id: 'b', type: 'workspace', name: 'B', x: 2000, y: 100, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [],
    } as never);
    renderEditor();
    mockCanvasSize(800, 600);
    await waitFor(() => expect(getNodeCount()).toBe(2));
    expect(viewport().style.transform).toContain('scale(0.4)'); // fitted on load

    // Interact: plain mousedown on node 'a' disarms auto-fit.
    fireEvent.mouseDown(nodeAt(0), { button: 0 });
    fireEvent.mouseUp(nodeAt(0), { button: 0 });

    // Delete node 'a': the content key changes, but the user is driving now
    // — the view must not jump (a refit would zoom 'b' alone to scale(1.5)).
    // A wire-less hardware node deletes immediately (no confirm dialog).
    const target = nodeAt(0);
    target.focus();
    fireEvent.keyDown(target, { key: 'Delete' });
    await waitFor(() => expect(getNodeCount()).toBe(1));

    expect(viewport().style.transform).toContain('scale(0.4)');
  });
});

// ── Load fallback determinism ───────────────────────────────────

describe('NodeTopologyEditor — load fallback determinism', () => {
  // The TopologyScreen parent passes EMPTY arrays for both seeds on its
  // first render (its lists load async). The load must treat that as "no
  // real instances yet" — fall back to the saved diagram / preset — and
  // never wipe the canvas to empty before the real seeds arrive.

  const savedFixture = {
    nodes: [
      { id: 'store-1', type: 'store', name: 'TOKO TEST', x: 80, y: 80 },
      { id: 'ws-1', type: 'workspace', name: 'Store POS', x: 380, y: 80, metadata: { typeKey: 'store-pos' } },
    ],
    wires: [],
  } as never;

  it('empty seeds fall back to the SAVED diagram instead of wiping the canvas', async () => {
    mockLoadTopology.mockResolvedValueOnce(savedFixture);
    renderEditor({ workspaceInstances: [], branchLocations: [] });

    // The saved store + workspace render (the empty arrays are NOT treated
    // as "no branches exist" — they are just not-loaded-yet).
    await waitFor(() => expect(getNodeCount()).toBe(2));
    expect(document.querySelector('.topology-node[data-node-id="store-1"]')).not.toBeNull();
    expect(document.querySelector('.topology-node[data-node-id="ws-1"]')).not.toBeNull();
  });

  it('empty seeds with no saved data show the onboarding state instead of demo data', async () => {
    mockLoadTopology.mockResolvedValue(null);
    renderEditor({ workspaceInstances: [], branchLocations: [] });

    // A parent that explicitly resolved to no branches owns the graph — the
    // empty canvas + onboarding hint, never the demo preset.
    await waitFor(() => expect(getNodeCount()).toBe(0));
    expect(screen.getByText('Build your store topology')).toBeInTheDocument();
  });

  it('a genuinely empty branch list still drops the store when instances exist', async () => {
    // Regression pin: deleting the LAST branch (locations [] while a stale
    // workspace instance lingers) must keep wiping the store card — the
    // empty-locations delete semantics are preserved.
    mockLoadTopology.mockResolvedValueOnce(savedFixture);
    renderEditor({
      workspaceInstances: [{ instanceId: 'ws-1', typeKey: 'store-pos', storeId: 'store-1', name: 'Store POS' }],
      branchLocations: [],
    });

    await waitFor(() => expect(getNodeCount()).toBe(1));
    expect(document.querySelector('.topology-node[data-node-id="store-1"]')).toBeNull();
    expect(document.querySelector('.topology-node[data-node-id="ws-1"]')).not.toBeNull();
  });

  it('clears a saved diagram when the parent marks the branch unassigned', async () => {
    mockLoadTopology.mockResolvedValueOnce(savedFixture);
    renderEditor({
      branchId: 'unassigned',
      workspaceInstances: [],
      branchLocations: [],
    });

    await waitFor(() => expect(getNodeCount()).toBe(0));
    expect(document.querySelector('.topology-node[data-node-id="store-1"]')).toBeNull();
    expect(screen.getByText('Build your store topology')).toBeInTheDocument();
  });
});

describe('topology export / import / templates (clipboard + localStorage)', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const readText = vi.fn();

  const stubClipboard = () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText, readText },
      configurable: true,
    });
  };
  const unsetClipboard = () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  };

  const validPayload = JSON.stringify({
    format: 'oz-topology',
    version: 1,
    nodes: [
      { id: 'imp-1', type: 'store', name: 'Imported Branch', x: 80, y: 140 },
      { id: 'imp-2', type: 'workspace', name: 'Imported POS', x: 400, y: 80 },
    ],
    wires: [{ id: 'imp-w1', fromNodeId: 'imp-1', toNodeId: 'imp-2', direction: 'one-way' }],
  });

  beforeEach(() => {
    writeText.mockClear();
    readText.mockReset();
    stubClipboard();
    localStorage.clear();
  });

  it('exports the current diagram as the versioned envelope', async () => {
    renderEditor();
    expect(getNodeCount()).toBe(3); // retail preset

    openRackPanel('share'); fireEvent.click(screen.getByText('Export'));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const json = writeText.mock.calls[0]![0] as string;
    const parsed = JSON.parse(json);
    expect(parsed.format).toBe('oz-topology');
    expect(parsed.version).toBe(1);
    expect(parsed.nodes).toHaveLength(3);
    expect(parsed.nodes[0]!.id).toBe('store-1');
    expect(screen.getByText('Topology copied to clipboard')).toBeInTheDocument();
  });

  it('toasts when the clipboard API is unavailable', async () => {
    unsetClipboard();
    renderEditor();

    openRackPanel('share'); fireEvent.click(screen.getByText('Export'));

    await waitFor(() =>
      expect(screen.getByText('Clipboard is not available')).toBeInTheDocument(),
    );
  });

  it('imports a valid payload, replaces the canvas, and is undoable', async () => {
    readText.mockResolvedValue(validPayload);
    renderEditor();

    openRackPanel('share'); fireEvent.click(screen.getByText('Import'));

    await waitFor(() => expect(getNodeCount()).toBe(2));
    expect(document.querySelector('.topology-node[data-node-id="imp-1"]')).not.toBeNull();
    expect(document.querySelector('.topology-node[data-node-id="imp-2"]')).not.toBeNull();
    expect(document.querySelector('.topology-node[data-node-id="store-1"]')).toBeNull();
    expect(screen.getByText('Topology imported')).toBeInTheDocument();

    // Undo restores the retail preset.
    openRackPanel('edit'); fireEvent.click(screen.getByText('Undo (Ctrl+Z)'));
    await waitFor(() => expect(getNodeCount()).toBe(3));
  });

  it('rejects clipboard content that is not a valid topology', async () => {
    readText.mockResolvedValue('garbage { not json');
    renderEditor();

    openRackPanel('share'); fireEvent.click(screen.getByText('Import'));

    await waitFor(() =>
      expect(screen.getByText('Clipboard does not contain a valid topology')).toBeInTheDocument(),
    );
    expect(getNodeCount()).toBe(3);
  });

  it('saves the current diagram as a named template', async () => {
    renderEditor();

    openRackPanel('share'); fireEvent.click(screen.getByText('Save template'));
    fireEvent.change(screen.getByPlaceholderText('Template name'), { target: { value: 'My Layout' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(screen.getByText('Template saved')).toBeInTheDocument(),
    );
    const raw = localStorage.getItem('oz-topology-template:My Layout');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).nodes).toHaveLength(3);
  });

  it('loads and deletes a saved template', async () => {
    localStorage.setItem('oz-topology-template:Import Me', validPayload);
    renderEditor();

    openRackPanel('share'); fireEvent.click(screen.getByText('Templates'));
    expect(screen.getByText('Import Me')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Load'));
    await waitFor(() => expect(getNodeCount()).toBe(2));
    expect(document.querySelector('.topology-node[data-node-id="imp-1"]')).not.toBeNull();

    openRackPanel('share'); fireEvent.click(screen.getByText('Templates'));
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() =>
      expect(screen.getByText('Template deleted')).toBeInTheDocument(),
    );
    expect(localStorage.getItem('oz-topology-template:Import Me')).toBeNull();
  });
});

// ── Tier-limit error is node-scoped (round 103 follow-up) ─────────

describe('NodeTopologyEditor — tier-limit error node scoping', () => {
  // Round 103: the contract scopes warehouse-tier-limit to the SECOND
  // warehouse, so the editor must render it as a node-scoped card note +
  // panel item with a jump button — never the graph-level banner. This
  // pins that bucketing; a regression to banner-level would re-introduce
  // the dead-end banner this follow-up removed.
  const twoWarehouseDiagram = {
    nodes: [
      { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
      { id: 'ws-1', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
      { id: 'wh-1', type: 'warehouse', name: 'WH 1', x: 680, y: 140 },
      { id: 'wh-2', type: 'warehouse', name: 'WH 2', x: 680, y: 400 },
    ],
    wires: [
      {
        id: 'w-1',
        from_node_id: 'store-1',
        to_node_id: 'ws-1',
        from_port_id: 'location-out',
        to_port_id: 'location-in',
        relationship_type: 'location',
        direction: 'one-way',
      },
    ],
  } as never;

  it('renders the tier-limit error as a node-scoped panel item with a working jump', async () => {
    mockLoadTopology.mockResolvedValueOnce(twoWarehouseDiagram);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(4));

    // The error is node-scoped: no graph-level banner may appear.
    expect(document.querySelector('.topology-validation-banner')).toBeNull();

    // Open the validation panel via the Issues button.
    fireEvent.click(document.querySelector('.topology-issues-btn')!);
    const panel = document.querySelector('.topology-validation-panel');
    expect(panel).not.toBeNull();

    // The message lives in exactly ONE node-scoped item (named, not
    // static), pointing at WH 2 — the second Stock Room the contract flags.
    const matching = Array.from(panel!.querySelectorAll('.topology-validation-item')).filter((el) =>
      el.textContent?.includes('Multiple Warehouses require a Pro Tier license.'),
    );
    expect(matching).toHaveLength(1);
    const item = matching[0]!;
    expect(item.querySelector('.topology-validation-item-node')?.textContent).toBe('WH 2');
    expect(item.querySelector('.topology-validation-item-static')).toBeNull();

    // The jump button selects WH 2 (the card gains node-selected) and
    // closes the panel — the node is now front and center.
    const wh2Card = Array.from(document.querySelectorAll('.topology-node')).find((el) =>
      el.textContent?.includes('WH 2'),
    )!;
    expect(wh2Card.className).not.toContain('node-selected');

    fireEvent.click(item.querySelector('.topology-validation-item-select')!);

    expect(wh2Card.className).toContain('node-selected');
    expect(document.querySelector('.topology-validation-panel')).toBeNull();
  });

  it('renders one jumpable panel item per excess warehouse (three Stock Rooms)', async () => {
    // Round 106: the cap flags every warehouse beyond the first, so three
    // Stock Rooms on standard tier must produce TWO panel items — one per
    // excess node — each jumping to its own card. A regression to
    // single-error emission would leave WH 3 silently unflagged.
    const threeWarehouseDiagram = {
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-1', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
        { id: 'wh-1', type: 'warehouse', name: 'WH 1', x: 680, y: 140 },
        { id: 'wh-2', type: 'warehouse', name: 'WH 2', x: 680, y: 400 },
        { id: 'wh-3', type: 'warehouse', name: 'WH 3', x: 980, y: 400 },
      ],
      wires: [
        {
          id: 'w-1',
          from_node_id: 'store-1',
          to_node_id: 'ws-1',
          from_port_id: 'location-out',
          to_port_id: 'location-in',
          relationship_type: 'location',
          direction: 'one-way',
        },
      ],
    } as never;

    mockLoadTopology.mockResolvedValueOnce(threeWarehouseDiagram);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(5));

    // Still no graph-level banner — every tier-limit error is node-scoped.
    expect(document.querySelector('.topology-validation-banner')).toBeNull();

    fireEvent.click(document.querySelector('.topology-issues-btn')!);
    const panel = document.querySelector('.topology-validation-panel');
    expect(panel).not.toBeNull();

    const matching = Array.from(panel!.querySelectorAll('.topology-validation-item')).filter((el) =>
      el.textContent?.includes('Multiple Warehouses require a Pro Tier license.'),
    );
    expect(matching).toHaveLength(2);
    expect(matching.map((el) => el.querySelector('.topology-validation-item-node')?.textContent)).toEqual([
      'WH 2',
      'WH 3',
    ]);

    // The second item jumps to WH 3's card and closes the panel.
    const wh3Card = Array.from(document.querySelectorAll('.topology-node')).find((el) =>
      el.textContent?.includes('WH 3'),
    )!;
    expect(wh3Card.className).not.toContain('node-selected');

    fireEvent.click(matching[1]!.querySelector('.topology-validation-item-select')!);

    expect(wh3Card.className).toContain('node-selected');
    expect(document.querySelector('.topology-validation-panel')).toBeNull();
  });

  it('shows an excess-count badge on the flagged Stock Room card', async () => {
    // Round 113: the tier-limit card note says WHAT is wrong; the badge
    // says HOW MANY Stock Rooms are in play at a glance, without opening
    // the panel.
    mockLoadTopology.mockResolvedValueOnce(twoWarehouseDiagram);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(4));

    const wh2Card = document.querySelector('.topology-node[data-node-id="wh-2"]')!;
    expect(wh2Card.querySelector('.node-validation-note')).not.toBeNull();
    // The excess-count badge rides the header tooltip (portal to body)
    expect(document.querySelector('.node-validation-tip .node-validation-count-badge')?.textContent).toBe(
      '2 Warehouses — 1 allowed',
    );
  });
});

// ── Extra-branch error is node-scoped (round 108 follow-up) ──────

describe('NodeTopologyEditor — extra-branch error node scoping', () => {
  const twoBranchDiagram = {
    nodes: [
      { id: 'store-1', type: 'store', name: 'Branch A', x: 80, y: 140, store_profile_id: 'store-1' },
      { id: 'store-2', type: 'store', name: 'Branch B', x: 80, y: 400, store_profile_id: 'store-2' },
      { id: 'ws-a', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
    ],
    wires: [
      {
        id: 'w-1',
        from_node_id: 'store-1',
        from_port: 'right',
        to_node_id: 'ws-a',
        to_port: 'left',
        direction: 'one-way',
      },
    ],
  } as never;

  it('renders the multiple-branch error as a node-scoped panel item with a working jump', async () => {
    // Round 108: the contract scopes multiple-branch-locations to the
    // SECOND Branch Location, so the editor must render it as a card note
    // + panel item with a jump button — never the graph-level banner.
    // This pins that bucketing; a regression to banner-level would
    // re-introduce the dead-end banner this audit removed.
    mockLoadTopology.mockResolvedValueOnce(twoBranchDiagram);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));

    // The error is node-scoped: no graph-level banner may appear.
    expect(document.querySelector('.topology-validation-banner')).toBeNull();

    // Open the validation panel via the Issues button.
    fireEvent.click(document.querySelector('.topology-issues-btn')!);
    const panel = document.querySelector('.topology-validation-panel');
    expect(panel).not.toBeNull();

    // The message lives in exactly ONE node-scoped item, pointing at
    // Branch B — the second Branch Location the contract flags.
    const matching = Array.from(panel!.querySelectorAll('.topology-validation-item')).filter((el) =>
      el.textContent?.includes('Keep exactly one Branch Location node in this graph.'),
    );
    expect(matching).toHaveLength(1);
    const item = matching[0]!;
    expect(item.querySelector('.topology-validation-item-node')?.textContent).toBe('Branch B');
    expect(item.querySelector('.topology-validation-item-static')).toBeNull();

    // The jump button selects Branch B (the card gains node-selected) and
    // closes the panel — the node is now front and center.
    const branchBCard = Array.from(document.querySelectorAll('.topology-node')).find((el) =>
      el.textContent?.includes('Branch B'),
    )!;
    expect(branchBCard.className).not.toContain('node-selected');

    fireEvent.click(item.querySelector('.topology-validation-item-select')!);

    expect(branchBCard.className).toContain('node-selected');
    expect(document.querySelector('.topology-validation-panel')).toBeNull();
  });

  it('shows an excess-count badge on the extra Branch card', async () => {
    mockLoadTopology.mockResolvedValueOnce(twoBranchDiagram);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));

    const branchBCard = document.querySelector('.topology-node[data-node-id="store-2"]')!;
    expect(branchBCard.querySelector('.node-validation-note')).not.toBeNull();
    expect(document.querySelector('.node-validation-tip .node-validation-count-badge')?.textContent).toBe(
      '2 Branch Locations — 1 allowed',
    );
  });
});

// ── Wire-level validation items are jumpable (round 109 follow-up) ──

describe('NodeTopologyEditor — wire-level validation panel jump', () => {
  // A workspace-to-workspace stock-routing wire: the contract flags w-bad
  // with exactly ONE invalid-semantic-connection error (wireId-only), and
  // the wire RENDERS (both endpoints exist → it carries a canvas marker).
  const invalidWireDiagram = {
    nodes: [
      { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
      { id: 'ws-a', type: 'workspace', name: 'POS A', x: 380, y: 140, metadata: { typeKey: 'store-pos' } },
      { id: 'ws-b', type: 'workspace', name: 'POS B', x: 380, y: 400, metadata: { typeKey: 'store-pos' } },
    ],
    wires: [
      {
        id: 'w-loc-a',
        from_node_id: 'store-1',
        to_node_id: 'ws-a',
        from_port_id: 'location-out',
        to_port_id: 'location-in',
        relationship_type: 'location',
        direction: 'one-way',
      },
      {
        id: 'w-loc-b',
        from_node_id: 'store-1',
        to_node_id: 'ws-b',
        from_port_id: 'location-out',
        to_port_id: 'location-in',
        relationship_type: 'location',
        direction: 'one-way',
      },
      {
        id: 'w-bad',
        from_node_id: 'ws-a',
        to_node_id: 'ws-b',
        from_port_id: 'stock-out',
        to_port_id: 'stock-in',
        relationship_type: 'stock-routing',
        direction: 'one-way',
      },
    ],
  } as never;

  it('turns a wireId-only validation item into a jump that selects the wire', async () => {
    // Round 109 follow-up: wireId-only errors (invalid-semantic-connection,
    // duplicate-wire, ambiguous-legacy-wire, invalid-location-connection,
    // unknown-wire-endpoint) rendered as STATIC panel rows — the user saw
    // the message but had no way to find the offending wire. They now
    // render as jumpable items that select the wire.
    mockLoadTopology.mockResolvedValueOnce(invalidWireDiagram);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));

    fireEvent.click(document.querySelector('.topology-issues-btn')!);
    const panel = document.querySelector('.topology-validation-panel');
    expect(panel).not.toBeNull();

    // The wire error renders as a JUMPABLE item (a select button), not a
    // static row.
    const wireItem = Array.from(panel!.querySelectorAll('.topology-validation-item')).find((el) =>
      el.textContent?.includes('This wire uses an incompatible port and relationship type.'),
    )!;
    expect(wireItem.querySelector('.topology-validation-item-static')).toBeNull();
    const jump = wireItem.querySelector('.topology-validation-item-select');
    expect(jump).not.toBeNull();

    fireEvent.click(jump!);

    // The offending wire is selected (wire-selected on its group) and the
    // panel closes — the wire is now front and center.
    const badGroup = Array.from(document.querySelectorAll('.wire-group')).find((g) =>
      g.querySelector('.wire-hitbox')?.getAttribute('data-wire-id') === 'w-bad',
    )!;
    expect(badGroup.classList.contains('wire-selected')).toBe(true);
    expect(document.querySelector('.topology-validation-panel')).toBeNull();

    // Keyboard parity: focus lands on the wire's hitbox (tabIndex=0) so
    // the keyboard user can act immediately — cycle direction, Delete,
    // relabel — without hunting for the wire after the jump.
    expect(document.activeElement?.getAttribute('data-wire-id')).toBe('w-bad');
  });

  it('keeps a renderable wire-level error out of the banner', async () => {
    // Round 110 follow-up: a wireId-only error on a RENDERABLE wire is
    // carried by its canvas marker + jumpable panel row, so the banner is
    // decluttered. The ghost-wire case (no geometry → no marker) must keep
    // the banner — pinned by the 'shows a canvas banner for a wire
    // referencing a ghost node' test.
    mockLoadTopology.mockResolvedValueOnce(invalidWireDiagram);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));

    expect(document.querySelector('.topology-validation-banner')).toBeNull();

    // The error is still live in the panel as a jumpable item.
    fireEvent.click(document.querySelector('.topology-issues-btn')!);
    const panel = document.querySelector('.topology-validation-panel');
    expect(panel).not.toBeNull();
    const wireItem = Array.from(panel!.querySelectorAll('.topology-validation-item')).find((el) =>
      el.textContent?.includes('This wire uses an incompatible port and relationship type.'),
    )!;
    expect(wireItem.querySelector('.topology-validation-item-select')).not.toBeNull();
  });
});

// ── Drop-overlap resolution (round 140) ───────────────────────────
//
// The editor's own invariant is that node cards never overlap: palette
// spawns settle into a collision-free spot (findFreeSpawnSpot) and loads
// spread on a grid. But a DRAG could drop a node on top of another card,
// stacking it invisibly (the bottom card becomes unselectable except by
// grip). The drop must settle the dragged node into the nearest
// collision-free spot — flush alignment (0 gap, produced deliberately by
// the alignment guides) is NOT an overlap and must survive.
describe('NodeTopologyEditor — drop-overlap resolution', () => {
  beforeEach(() => {
    mockLoadTopology.mockResolvedValue(null);
  });

  const canvas = () => document.querySelector('.node-canvas-container') as HTMLElement;
  const nodeBy = (id: string) =>
    document.querySelector(`.topology-node[data-node-id="${id}"]`) as HTMLElement;
  const boxesOverlap = (a: HTMLElement, b: HTMLElement) => {
    const ax = parseFloat(a.style.left);
    const ay = parseFloat(a.style.top);
    const bx = parseFloat(b.style.left);
    const by = parseFloat(b.style.top);
    return ax < bx + NODE_WIDTH && ax + NODE_WIDTH > bx
      && ay < by + NODE_HEIGHT && ay + NODE_HEIGHT > by;
  };

  it('settles a node dropped onto another node into the nearest free spot', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'a', type: 'store', name: 'A', x: 80, y: 80 },
        { id: 'b', type: 'workspace', name: 'B', x: 380, y: 80, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));
    mockCanvasSize(1200, 800);

    // Drag A from (0,0) — offset (−80,−80). Dropping at (400,100) lands A
    // at snap(480, 180) = (480, 192): box [480..720]×[192..432], which
    // intersects B's box [380..620]×[80..320]. Pre-fix the drop leaves the
    // cards stacked.
    fireEvent.mouseDown(nodeBy('a'), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 400, clientY: 100 });
    fireEvent.mouseUp(canvas(), { button: 0 });

    // The drop must settle A clear of B (the exact landing spot is the
    // nearest free cell — assert the invariant, not the coordinate).
    expect(boxesOverlap(nodeBy('a'), nodeBy('b'))).toBe(false);
  });

  it('leaves a flush-aligned drop (alignment guide landing) untouched', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'a', type: 'store', name: 'A', x: 200, y: 200 },
        { id: 'b', type: 'workspace', name: 'B', x: 440, y: 200, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));
    mockCanvasSize(1200, 800);

    // B sits flush against A's right edge (B.x === A.x + NODE_WIDTH) — the
    // exact geometry the alignment guide produces deliberately. A drag of B
    // that lands it back flush must NOT be nudged away.
    fireEvent.mouseDown(nodeBy('b'), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 0, clientY: 0 });
    fireEvent.mouseUp(canvas(), { button: 0 });

    expect(nodeBy('b').style.left).toBe('440px');
    expect(nodeBy('b').style.top).toBe('200px');
  });
});

// ── resolveDropOverlaps (round 140) ──────────────────────────────
describe('resolveDropOverlaps (drop-overlap resolution)', () => {
  it('returns null when nothing overlaps (no state write needed)', () => {
    const nodes = [
      { id: 'a', x: 80, y: 80 },
      { id: 'b', x: 380, y: 80 },
    ];
    expect(resolveDropOverlaps(nodes, new Set(['a']))).toBeNull();
  });

  it('treats flush alignment (zero gap) as NOT an overlap — the guide landing survives', () => {
    const nodes = [
      { id: 'a', x: 200, y: 200 },
      // B flush against A's right edge: B.x === A.x + NODE_WIDTH.
      { id: 'b', x: 200 + NODE_WIDTH, y: 200 },
    ];
    expect(resolveDropOverlaps(nodes, new Set(['b']))).toBeNull();
  });

  it('settles an overlapping dragged node to a collision-free spot and reports the change', () => {
    const nodes = [
      { id: 'a', x: 80, y: 80 },
      // A dropped onto B: A's box [480..720]×[192..432] intersects B's.
      { id: 'a-moved', x: 480, y: 192 },
      { id: 'b', x: 380, y: 80 },
    ];
    const result = resolveDropOverlaps(nodes, new Set(['a-moved']));
    expect(result).not.toBeNull();
    const moved = result!.find((n) => n.id === 'a-moved')!;
    const overlaps = moved.x < 380 + NODE_WIDTH && moved.x + NODE_WIDTH > 380
      && moved.y < 80 + NODE_HEIGHT && moved.y + NODE_HEIGHT > 80;
    expect(overlaps).toBe(false);
    // The other nodes are untouched and the result keeps every node.
    expect(result!.find((n) => n.id === 'a')).toEqual({ id: 'a', x: 80, y: 80 });
    expect(result!.find((n) => n.id === 'b')).toEqual({ id: 'b', x: 380, y: 80 });
  });

  it('moves only the dragged member that overlaps — a group member clear of others stays put', () => {
    const nodes = [
      { id: 'a', x: 80, y: 80 },
      { id: 'b', x: 380, y: 80 },
      // 'c' dropped onto 'a' (overlap), 'd' moved but clear of everything.
      { id: 'c', x: 100, y: 100 },
      { id: 'd', x: 700, y: 300 },
    ];
    const result = resolveDropOverlaps(nodes, new Set(['c', 'd']));
    expect(result).not.toBeNull();
    const c = result!.find((n) => n.id === 'c')!;
    const overlapsA = c.x < 80 + NODE_WIDTH && c.x + NODE_WIDTH > 80
      && c.y < 80 + NODE_HEIGHT && c.y + NODE_HEIGHT > 80;
    expect(overlapsA).toBe(false);
    expect(result!.find((n) => n.id === 'd')).toEqual({ id: 'd', x: 700, y: 300 });
    expect(result!.find((n) => n.id === 'b')).toEqual({ id: 'b', x: 380, y: 80 });
  });
});

// ── Nudge-overlap blocking (round 141) ───────────────────────────
//
// Round 140 settled dropped nodes clear of other cards, but the keyboard
// path could still step a selected node INTO a neighbour (1px/8-24px steps
// where auto-resolving to a distant spot would be jarring). The least-
// jarring behavior: block the whole nudge (the selection stays put, no
// history entry) — the user hits a wall and goes around. Flush alignment
// (zero gap) is NOT an overlap and remains reachable, and nudges away
// from the neighbour still work.
describe('NodeTopologyEditor — nudge-overlap blocking', () => {
  beforeEach(() => {
    mockLoadTopology.mockResolvedValue(null);
  });

  it('blocks an arrow nudge that would step the selection into another card', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'a', type: 'store', name: 'A', x: 80, y: 80 },
        // B sits flush against A's right edge (0 gap — the guide landing).
        { id: 'b', type: 'workspace', name: 'B', x: 80 + NODE_WIDTH, y: 80, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const nodeA = document.querySelector('.topology-node[data-node-id="a"]') as HTMLElement;
    selectFirstNode();

    // One grid step right (80 → 104) would push A's box [104..344] into B's
    // [320..560] — the nudge must be blocked, not stepped into the card.
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    expect(nodeA.style.left).toBe('80px');
    // A blocked nudge is not an edit: no undo entry is created.
    expect(screen.queryByText('Undo (Ctrl+Z)')).toBeNull();

    // Nudging AWAY from the neighbour still works (only the overlapping
    // direction is blocked).
    fireEvent.keyDown(canvas, { key: 'ArrowLeft' });
    expect(parseFloat(nodeA.style.left)).toBeLessThan(80);
  });

  it('a fine Shift+nudge flush against a neighbour stays reachable (guide landing)', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'a', type: 'store', name: 'A', x: 80, y: 80 },
        // B one 1px step away from flush: A's right edge at 320, B's left
        // at 321 — a 1px fine nudge right lands FLUSH (0 gap), which is NOT
        // an overlap and must be allowed (the alignment guide's landing).
        { id: 'b', type: 'workspace', name: 'B', x: 321, y: 80, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const nodeA = document.querySelector('.topology-node[data-node-id="a"]') as HTMLElement;
    selectFirstNode();

    fireEvent.keyDown(canvas, { key: 'ArrowRight', shiftKey: true });
    // A's right edge lands exactly on B's left edge — flush, allowed.
    expect(nodeA.style.left).toBe('81px');
  });
});

// ── Pre-existing overlap indicator (round 143) ───────────────────
//
// Rounds 140-142 guard NEW movement (drops settle, nudges block, layout is
// collision-free), but a SAVED diagram can still load with cards stacked —
// the invariant only prevents creating new overlaps, never repairs old
// data. Auto-moving on load would be a silent jump (deliberately avoided),
// so the least-surprising surface is a non-destructive badge on each
// offending card. It is derived from live geometry, so dragging a card
// clear makes its badge disappear.
describe('NodeTopologyEditor — pre-existing overlap indicator', () => {
  beforeEach(() => {
    mockLoadTopology.mockResolvedValue(null);
  });

  const canvas = () => document.querySelector('.node-canvas-container') as HTMLElement;
  const nodeBy = (id: string) =>
    document.querySelector(`.topology-node[data-node-id="${id}"]`) as HTMLElement;
  const badgeCount = () => document.querySelectorAll('.node-overlap-badge').length;

  it('badges cards that overlap from a saved diagram, without moving them', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'a', type: 'store', name: 'A', x: 80, y: 80 },
        // b overlaps a: b [200..440]×[80..320] vs a [80..320]×[80..320].
        { id: 'b', type: 'workspace', name: 'B', x: 200, y: 80, metadata: { typeKey: 'store-pos' } },
        { id: 'c', type: 'warehouse', name: 'C', x: 680, y: 80 },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(3));

    // Both members of the overlapping pair are badged; the clear card is not.
    expect(badgeCount()).toBe(2);
    expect(nodeBy('a').querySelector('.node-overlap-badge')).not.toBeNull();
    expect(nodeBy('b').querySelector('.node-overlap-badge')).not.toBeNull();
    expect(nodeBy('c').querySelector('.node-overlap-badge')).toBeNull();
    // Non-destructive: positions are untouched (no silent auto-move).
    expect(nodeBy('a').style.left).toBe('80px');
    expect(nodeBy('b').style.left).toBe('200px');
  });

  it('clears the badge once the user drags the node clear', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'a', type: 'store', name: 'A', x: 80, y: 80 },
        { id: 'b', type: 'workspace', name: 'B', x: 200, y: 80, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));
    mockCanvasSize(1200, 800);
    expect(badgeCount()).toBe(2);

    // Drag B clear of A (offset −200,−80; drop at 600,0 → lands ~(792,72),
    // well outside A's box). The badge must disappear — the indicator is
    // derived from live geometry, not load state.
    fireEvent.mouseDown(nodeBy('b'), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas(), { clientX: 600, clientY: 0 });
    fireEvent.mouseUp(canvas(), { button: 0 });

    expect(badgeCount()).toBe(0);
  });
});

describe('NodeTopologyEditor — peer group badge', () => {
  const nodeBy = (id: string) =>
    document.querySelector(`[data-node-id="${id}"]`) as HTMLElement;

  it('renders a peer group badge on workspace nodes with peerGroup metadata', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'My Store', x: 80, y: 80 },
        { id: 'pos-1', type: 'workspace', name: 'POS #1', x: 380, y: 80, metadata: { typeKey: 'store-pos', peerGroup: 'Front Counter' } },
        { id: 'pos-2', type: 'workspace', name: 'POS #2', x: 380, y: 200, metadata: { typeKey: 'store-pos', peerGroup: 'Front Counter' } },
        { id: 'kds-1', type: 'workspace', name: 'KDS', x: 680, y: 140, metadata: { typeKey: 'kds' } },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(4));

    // POS nodes should show peer group badges; KDS should not.
    const pos1 = nodeBy('pos-1');
    const pos2 = nodeBy('pos-2');
    const kds1 = nodeBy('kds-1');
    expect(pos1.querySelector('.node-peer-group-badge')).toBeTruthy();
    expect(pos1.querySelector('.node-peer-group-badge')?.textContent).toBe('Front Counter');
    expect(pos2.querySelector('.node-peer-group-badge')).toBeTruthy();
    expect(kds1.querySelector('.node-peer-group-badge')).toBeNull();
  });

  it('does not render peer group badge when peerGroup is empty', async () => {
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'My Store', x: 80, y: 80 },
        { id: 'pos-1', type: 'workspace', name: 'POS #1', x: 380, y: 80, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(2));

    const pos1 = nodeBy('pos-1');
    expect(pos1.querySelector('.node-peer-group-badge')).toBeNull();
  });
});

// ── Input-controller disarm & teardown characterization (Phase 3.4) ──
// Characterization tests pinning the CURRENT disarm/teardown behavior of the
// input controllers before they are extracted: (1) tab-hidden disarms a held
// Space, (2) pointercancel ends a touch node drag with the position intact,
// (3) unmount tears down every document-level gesture listener, (4) wheel
// zoom-to-cursor compensates the pan so the content point under the cursor
// stays visually fixed.

describe('NodeTopologyEditor — input controller disarm and teardown', () => {
  it('document visibilitychange to hidden disarms a held Space so the next left-drag marquees', () => {
    // Regression: Space arming had keydown/keyup writers plus a window-blur
    // disarm, but a tab switch to another window delivers keyup to the NEW
    // document — and neither keyup nor blur fires — so spacePanArmed stuck
    // true across the visibilitychange. The hidden-tab disarm closes that
    // third gap: cursor class drops and the next left-drag marquees instead
    // of panning.
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const viewport = document.querySelector('.node-canvas-viewport') as HTMLElement;

    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    expect(canvas.className).toContain('canvas-space-pan');

    // Hide the tab WITHOUT any keyup or window blur.
    const visibilityStateSpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      fireEvent(document, new Event('visibilitychange'));
    } finally {
      visibilityStateSpy.mockRestore();
    }

    // The pan must disarm: cursor class gone, and a left-drag on empty
    // canvas opens a marquee instead of panning the viewport.
    expect(canvas.className).not.toContain('canvas-space-pan');
    fireEvent.mouseDown(canvas, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 650, clientY: 420 });
    fireEvent.mouseUp(canvas, { button: 0 });

    expect(document.querySelector('.topology-marquee')).toBeNull(); // marquee is transient; released already
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(2);
    expect(viewport.style.transform).toContain('translate(0px, 0px)');
  });

  it('pointercancel during a one-finger touch node drag ends the gesture with the node position restored', () => {
    // A system gesture (edge-swipe, notification shade) steals the touch
    // mid-drag: the OS dispatches pointercancel and the finger is already
    // gone. The cancel must finish the gesture exactly like a lift — drag
    // state cleared, no dangling listeners — and since the pointer never
    // moved past the drag threshold, the node stays at its start position
    // and a later pointermove for the dead pointer re-drags nothing.
    renderEditor();
    const firstNode = document.querySelector('.topology-node') as HTMLElement;
    const viewport = document.querySelector('.node-canvas-viewport') as HTMLElement;
    const beforeLeft = firstNode.style.left;

    fireEvent.pointerDown(firstNode, { pointerId: 7, pointerType: 'touch', clientX: 0, clientY: 0 });
    fireEvent.pointerCancel(document, { pointerId: 7, pointerType: 'touch', clientX: 40, clientY: 20 });

    // No movement crossed the threshold before the cancel → position intact.
    expect(firstNode.style.left).toBe(beforeLeft);
    expect(viewport.style.transform).toContain('translate(0px, 0px)');

    // No dangling listeners: a move+up for the cancelled pointer re-arms
    // nothing — the node never re-drags and the viewport never pans.
    fireEvent.pointerMove(document, { pointerId: 7, pointerType: 'touch', clientX: 300, clientY: 300 });
    fireEvent.pointerUp(document, { pointerId: 7, pointerType: 'touch' });
    expect(firstNode.style.left).toBe(beforeLeft);
    expect(viewport.style.transform).toContain('translate(0px, 0px)');
  });

  it('unmount tears down the pan, node-drag, bend-drag, and touch document listeners (no post-unmount firing)', () => {
    // The unmount sweep must disarm EVERY document-level gesture listener.
    // The marquee mouseup teardown is pinned separately; this pins the other
    // four controllers. After unmount, dispatching each controller's
    // document-level events must produce no state changes or errors — the
    // closures were removed, not merely orphaned.
    const { unmount } = renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    // Arm pan: a middle-button drag arms document mousemove/mouseup without
    // releasing (panCleanupRef stays armed).
    fireEvent.mouseDown(canvas, { button: 1, clientX: 100, clientY: 100 });
    // Arm node-drag: mousedown on a node arms the document mouseup
    // finalizer (dragCleanupRef) with the drag still in flight.
    fireEvent.mouseDown(document.querySelector('.topology-node')!, { button: 0, clientX: 0, clientY: 0 });
    // Arm bend-drag: select the first wire, create a bend, grab its handle,
    // and leave the move/up listeners armed mid-drag.
    fireEvent.click(document.querySelector('.wire-hitbox')!);
    const ghost = document.querySelector('.wire-bend-ghost') as Element;
    expect(ghost).not.toBeNull();
    fireEvent.mouseDown(ghost, { button: 0, clientX: 350, clientY: 289 });
    // Arm touch cleanup: a single touch pointer arms the document
    // pointermove/pointerup/pointercancel listeners.
    fireEvent.pointerDown(canvas, { pointerId: 3, pointerType: 'touch', clientX: 200, clientY: 200 });

    unmount();

    // Each controller's document-level events fire on the unmounted page.
    // None may throw or mutate anything observable: the removed closures
    // cannot resurrect pan state (a fresh editor's viewport stays at
    // translate(0px, 0px) — the old listeners no longer drag it).
    expect(() => {
      fireEvent.mouseMove(document, { clientX: 500, clientY: 400 }); // pan mousemove
      fireEvent.mouseUp(document, { button: 1 });                    // pan mouseup
      fireEvent.mouseMove(document, { clientX: 60, clientY: 60 });   // node-drag mousemove
      fireEvent.mouseUp(document, { button: 0 });                    // node-drag/marquee mouseup
      fireEvent.mouseMove(document, { clientX: 420, clientY: 300 }); // bend-drag mousemove
      fireEvent.mouseUp(document, { button: 0 });                    // bend-drag mouseup
      fireEvent.pointerMove(document, { pointerId: 3, pointerType: 'touch', clientX: 260, clientY: 240 });
      fireEvent.pointerCancel(document, { pointerId: 3, pointerType: 'touch' });
      fireEvent.pointerUp(document, { pointerId: 3, pointerType: 'touch' });
    }).not.toThrow();

    // The definitive no-op proof: mount a fresh editor — its viewport must
    // be untouched at the identity transform. If any leaked mousemove
    // closure survived, it would set pan and the fresh viewport would show
    // a non-zero translate.
    cleanup();
    renderEditor();
    const freshViewport = document.querySelector('.node-canvas-viewport') as HTMLElement;
    expect(freshViewport.style.transform).toContain('translate(0px, 0px)');
  });

  it('wheel zoom-to-cursor adjusts the pan so the content point under the cursor stays visually fixed', () => {
    // The existing wheel test pins the zoom level only; this pins the pan
    // compensation. Content point C under the cursor (400, 300), identity
    // view: C_screen = C·zoom + pan. After zooming k at the cursor the SAME
    // content point must still project to (400, 300), i.e. pan' = cursor −
    // (cursor − pan)·k.
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const viewport = document.querySelector('.node-canvas-viewport') as HTMLElement;
    // Cursor over the ws-1 card (380..620 × 80..320), NOT the viewport
    // center — the whole point of zoom-to-cursor.
    const CX = 400;
    const CY = 300;
    const contentAtCursor = (tx: string) => {
      const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(tx);
      if (!m) throw new Error('unparsable viewport transform: ' + tx);
      return {
        x: (CX - parseFloat(m[1]!)) / parseFloat(m[3]!),
        y: (CY - parseFloat(m[2]!)) / parseFloat(m[3]!),
      };
    };

    const before = contentAtCursor(viewport.style.transform);
    fireEvent.wheel(canvas, { deltaY: -100, clientX: CX, clientY: CY });
    expect(document.querySelector('.canvas-zoom-level')?.textContent).toBe('110%');

    const after = contentAtCursor(viewport.style.transform);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);

    // Explicit pan coordinates for the same event, k = 1.1 from pan 0:
    // pan' = (400 − 400·1.1, 300 − 300·1.1) = (−40, −30).
    expect(viewport.style.transform).toContain('scale(1.1)');
    const tm = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale/.exec(viewport.style.transform);
    expect(tm).not.toBeNull();
    expect(parseFloat(tm![1]!)).toBeCloseTo(-40, 6);
    expect(parseFloat(tm![2]!)).toBeCloseTo(-30, 6);
  });
});

// ── Rename machinery characterization (pre-G5 extraction) ──────────
// Pins the CURRENT behavior of the two inline rename clusters (node card +
// wire relabel) before they move out of the editor: (a) the wire blur /
// click-away commit path, (b) an empty relabel DELETING the label field,
// (c) the keyboard focus-return to the wire hitbox, (d) the renameSaving
// double-submit guard, (e) a rejected card commit keeping the draft open,
// (f) the relabel's single undo entry.

describe('NodeTopologyEditor — rename machinery characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTopology.mockResolvedValue(null);
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  /** Open a wire's floating relabel input through its context menu (the same
   *  entry point the shipped wire tests drive). */
  const openWireRename = (wireId = 'w-1') => {
    const hitbox = document.querySelector(`.wire-hitbox[data-wire-id="${wireId}"]`) as HTMLElement;
    fireEvent.contextMenu(hitbox, { clientX: 400, clientY: 300 });
    fireEvent.click(screen.getByText('Rename wire'));
    return document.querySelector('.wire-rename-input') as HTMLInputElement;
  };

  const wireTitles = () =>
    [...document.querySelectorAll('.wire-hitbox title')].map((t) => t.textContent ?? '');

  const pillTexts = () =>
    [...document.querySelectorAll('.wire-label-pill')].map((p) => p.textContent ?? '');

  it('a wire relabel commits on blur and a click-away keeps the focus it took', () => {
    // Gap (a): the onBlur commit path (the wire input's click-away) had no
    // coverage at all — only Enter and Escape did. The blur path is also the
    // one that must NOT return focus, so both halves are pinned together.
    renderEditor();
    const input = openWireRename();
    expect(input.value).toBe('Binds Store');

    fireEvent.change(input, { target: { value: 'Blur Backbone' } });

    // The honest click-away: focus moves to another card, and jsdom fires the
    // input's native blur on the way out — which is exactly React's onBlur
    // commit path (fromKeyboard = false). act() keeps the resulting update
    // synchronous instead of leaking a flush past this call.
    const otherCard = document.querySelectorAll('.topology-node')[2] as HTMLElement;
    act(() => { otherCard.focus(); });
    if (input.isConnected) fireEvent.blur(input);

    expect(wireTitles().some((t) => t.includes('Blur Backbone'))).toBe(true);
    expect(wireTitles().some((t) => t.includes('Binds Store'))).toBe(false);
    expect(document.querySelector('.wire-rename-input')).toBeNull();
    // A blur commit must NOT pull focus back to the wire hitbox.
    expect(document.activeElement).toBe(otherCard);
    expect(document.activeElement?.getAttribute('data-wire-id')).toBeNull();
  });

  it('an empty wire relabel deletes the label field, leaving the endpoint-name display', async () => {
    // Gap (b): commitWireRename DELETES the key (not label: ''), so the wire
    // carries no label at all into the Apply payload. Whitespace-only input
    // pins the trim as well.
    localStorage.setItem('oz-topology-view-wire-labels:unassigned', '1');
    const onSave = vi.fn();
    renderEditor({ onSave });
    expect(pillTexts().some((t) => t.includes('Binds Store'))).toBe(true);

    const input = openWireRename();
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(document.querySelector('.wire-rename-input')).toBeNull();
    // The pill falls back to the endpoint-name join, and the custom label is
    // gone from every surface that reads it.
    expect(pillTexts().some((t) => t.includes('Downtown Branch → Retail POS #1'))).toBe(true);
    expect(pillTexts().some((t) => t.includes('Binds Store'))).toBe(false);

    await applyWithPin();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const savedWires = onSave.mock.calls[0]![1] as Array<Record<string, unknown>>;
    const w1 = savedWires.find((w) => w['id'] === 'w-1')!;
    const w2 = savedWires.find((w) => w['id'] === 'w-2')!;
    expect('label' in w1).toBe(false);
    expect(w2['label']).toBe('Operation Feed');
  });

  it('a keyboard-driven wire rename close returns focus to that wire hitbox', () => {
    // Gap (c): the focus-return effect was never observed — Enter and Escape
    // both close as keyboard-driven, so both must land on the wire.
    renderEditor();
    const hitbox = () => document.querySelector('.wire-hitbox[data-wire-id="w-1"]') as HTMLElement;

    let input = openWireRename();
    fireEvent.change(input, { target: { value: 'Keyboard Backbone' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(document.activeElement).toBe(hitbox());
    expect(wireTitles().some((t) => t.includes('Keyboard Backbone'))).toBe(true);

    input = openWireRename();
    fireEvent.change(input, { target: { value: 'Never Applied' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(document.activeElement).toBe(hitbox());
    expect(wireTitles().some((t) => t.includes('Keyboard Backbone'))).toBe(true);
    expect(wireTitles().some((t) => t.includes('Never Applied'))).toBe(false);
  });

  it('renameSaving blocks a blur that races an in-flight Enter commit', async () => {
    // Gap (d): Enter arms renameSaving and awaits the parent; the still-open
    // input's blur must not fire a second rename for the same draft.
    let settle: (v: boolean) => void = () => {};
    const onRenameBranch = vi.fn(
      () => new Promise<boolean>((resolve) => { settle = resolve; }),
    );
    renderEditor({ onRenameBranch });

    const storeCard = document.querySelectorAll('.topology-node')[0] as HTMLElement;
    fireEvent.click(within(storeCard).getByRole('button', { name: 'topology-branch-rename-label' }));
    const input = within(storeCard).getByLabelText('topology-branch-rename-placeholder') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Double Submit' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onRenameBranch).toHaveBeenCalledTimes(1));
    // Still in flight and still mounted: without the guard this blurs into a
    // second identical rename round-trip.
    fireEvent.blur(input);
    expect(onRenameBranch).toHaveBeenCalledTimes(1);

    settle(true);
    await waitFor(() => expect(within(storeCard).queryByLabelText('topology-branch-rename-placeholder')).toBeNull());
    await waitFor(() => expect(within(storeCard).getByText('Double Submit')).toBeTruthy());
    expect(onRenameBranch).toHaveBeenCalledTimes(1);
  });

  it('a rejected card rename keeps the draft open and releases the guard for a retry', async () => {
    // Gap (e): the card path (commitNodeRename) keeps its form open on a false
    // return — the body-config rejection coverage does not reach it.
    const onRenameBranch = vi.fn().mockResolvedValue(false);
    renderEditor({ onRenameBranch });

    const storeCard = document.querySelectorAll('.topology-node')[0] as HTMLElement;
    fireEvent.click(within(storeCard).getByRole('button', { name: 'topology-branch-rename-label' }));
    const input = within(storeCard).getByLabelText('topology-branch-rename-placeholder') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Rejected HQ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onRenameBranch).toHaveBeenCalledWith('store-1', 'Rejected HQ'));
    const stillOpen = within(storeCard).getByLabelText('topology-branch-rename-placeholder') as HTMLInputElement;
    expect(stillOpen.value).toBe('Rejected HQ');
    // Still open means still no local write: the card title element is not
    // even rendered while the rename input owns that slot.
    expect(storeCard.querySelector('.node-title')).toBeNull();

    // The finally-released renameSaving is what makes the retry real: a second
    // Enter must reach the parent again instead of being swallowed.
    fireEvent.keyDown(stillOpen, { key: 'Enter' });
    await waitFor(() => expect(onRenameBranch).toHaveBeenCalledTimes(2));
    expect(within(storeCard).getByLabelText('topology-branch-rename-placeholder')).not.toBeNull();

    // Escape is the honest exit — and the canvas still holds the AUTHORITATIVE
    // name, never the rejected one.
    fireEvent.keyDown(stillOpen, { key: 'Escape' });
    await waitFor(() => expect(within(storeCard).getByText('Downtown Branch')).toBeTruthy());
  });

  it('a wire relabel pushes one undo entry and marks the canvas dirty', () => {
    // Gap (f): the relabel's dirty half was pinned; the pushHistory() half —
    // exactly ONE entry for the whole commit — was not.
    renderEditor();
    const input = openWireRename();
    fireEvent.change(input, { target: { value: 'Undoable Feed' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(document.querySelector('.topology-dirty-dot')).not.toBeNull();
    expect(wireTitles().some((t) => t.includes('Undoable Feed'))).toBe(true);

    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    expect(wireTitles().some((t) => t.includes('Undoable Feed'))).toBe(false);
    expect(wireTitles().some((t) => t.includes('Binds Store'))).toBe(true);
    // One entry consumed and the canvas is back on the applied snapshot.
    expect(document.querySelector('.topology-dirty-dot')).toBeNull();
  });
});
