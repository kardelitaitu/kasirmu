// ── Shared harness for the NodeTopologyEditor suites ────────────────────────
//
// The editor is covered by 550 render-and-interact tests, which lived in ONE
// 12,246-line file. Vitest parallelises by FILE, so that single file was a hard
// floor on the whole suite's wall clock: measured 2026-10-12 at 49.2s, which is
// 46% of the full 107.6s run. No number of workers can beat the longest file.
//
// The describes are split across nodeTopologyEditor*.test.tsx; this module holds
// what ALL of them need, so the split did not fork the harness into copies that
// could drift apart:
//   * TOPOLOGY_EN   — the l10n map the <Localized> passthrough resolves against
//   * RETAIL_SEED   — the retail diagram every interaction test starts from
//   * renderEditor  — mount + open the Add panel, plus the DOM query helpers
//                     (getNodeCount, portRowOf, connectRows, mockCanvasSize, …)
//   * the *Harness components that simulate the TopologyScreen parent
//
// NOT here, deliberately: the `vi.mock` calls. `vi.mock` is hoisted and
// file-scoped — a mock declared in a module does not apply to its importers —
// so each test file carries its own small mock prologue. Keep those prologues
// identical; they are the one thing the split does have to repeat.

import { useState, type ComponentProps } from 'react';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import NodeTopologyEditor, { type WorkspaceInstanceSeed, type BranchLocationSeed } from '../features/locations/NodeTopologyEditor';
import multiStoreFtl from '@/locales/multi-location.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
export const TOPOLOGY_EN: Record<string, string> = {
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
  'topology-toast-multi-warehouse': 'Warehouse nodes require a Premium Tier license.',
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


export const RETAIL_SEED = {
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

export type TopologyTier = Exclude<ComponentProps<typeof NodeTopologyEditor>['currentTier'], undefined>;
export const renderEditor = (props?: {
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
export function ReloadingHarness({ next }: { next: WorkspaceInstanceSeed[] }) {
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
export const ghostXY = (el: HTMLElement) => {
  const m = /translate\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px\s*\)/.exec(el.style.transform);
  if (!m) return { x: NaN, y: NaN };
  return { x: parseFloat(m[1]!), y: parseFloat(m[2]!) };
};

/** Stable workspace seed — identity never changes, so only the
 *  branchLocations prop drives the load-effect re-run in the rename flow. */
export const renameWsInstances: WorkspaceInstanceSeed[] = [
  { instanceId: 'ws-rename', typeKey: 'store-pos', name: 'POS #1' },
];

/**
 * Harness simulating the TopologyScreen parent: a successful card rename
 * swaps the branchLocations identity (the parent's stores-state update),
 * re-triggering the editor's load effect with ONLY branch locations changed.
 */
export function BranchRenameHarness() {
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
export function WorkspaceRenameHarness() {
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
export function BothChangeHarness() {
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

export const getNodeCount = () => document.querySelectorAll('.topology-node').length;
export const getWireCount = () => document.querySelectorAll('.wire-group').length;

// Preset renders nodes in array order: [store-1, ws-1, wh-1].
export const nodeAt = (idx: number) =>
  document.querySelectorAll('.topology-node')[idx] as HTMLElement;
export const portOf = (node: HTMLElement, port: string) =>
  node.querySelector(`.node-port-row--${port}`) as HTMLElement;
/** The N-th stacked port row on a side (round 174). The first row (index 0)
 *  is the PRIMARY semantic for that side; use `portRowOf(node, port, i)` to
 *  click a specific semantic row (e.g. stock-in row on a warehouse left). */
export const portRowOf = (node: HTMLElement, port: string, index: number) =>
  node.querySelectorAll(`.node-port-row--${port}`)[index] as HTMLElement;
/** Click two specific semantic port rows to author a wire (round 174). Each
 *  stacked row is one semantic, so the drop commits directly — the old
 *  single-socket click (portOf) no longer opens the relationship picker. */
export const connectRows = (
  fromIdx: number, fromPort: string, fromRow: number,
  toIdx: number, toPort: string, toRow: number,
) => {
  fireEvent.click(portRowOf(nodeAt(fromIdx), fromPort, fromRow));
  fireEvent.click(portRowOf(nodeAt(toIdx), toPort, toRow));
};
export const typeSelect = () => document.querySelector('select.inspector-select') as HTMLSelectElement;
export const previewLine = () => document.querySelector('path.wire-path[opacity="0.5"]');

export const selectFirstNode = () => {
  const firstNode = document.querySelector('.topology-node');
  if (firstNode) fireEvent.mouseDown(firstNode as Element, { button: 0 });
};

/** Lay the canvas out in jsdom so viewport-relative clamping has a real size. */
export const mockCanvasSize = (width: number, height: number) => {
  const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
  Object.defineProperty(canvas, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(canvas, 'clientHeight', { value: height, configurable: true });
};

/**
 * Click the confirm button of an open confirm dialog. The dialog's confirm
 * button carries aria-label="Delete" while the inspector may also render a
 * Delete button for the selected node — scope the query to the dialog panel.
 */
export const confirmDialogAction = (label = 'Delete') => {
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
export const openRackPanel = (panel: 'add' | 'edit' | 'view' | 'share') => {
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
export const applyWithPin = async (pin = '1234') => {
  fireEvent.click(screen.getByText('Apply Topology'));
  const input = document.getElementById('topology-apply-pin') as HTMLInputElement | null;
  if (!input) throw new Error('Apply PIN input not found');
  fireEvent.change(input, { target: { value: pin } });
  fireEvent.click(screen.getByText('Apply'));
};
