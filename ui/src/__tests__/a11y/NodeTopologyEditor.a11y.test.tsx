//! A11y regression tests for NodeTopologyEditor.
//!
//! The editor is a custom canvas (role="application") whose cards, wires,
//! and minimap are hand-rolled interactive elements — the highest-risk
//! surface in the stores feature for ARIA misuse. Unlike most screens it
//! renders a large Fluent surface, so @fluent/react is mocked with the
//! TOPOLOGY_EN map (same pattern as the editor's behavioral suites) while
//! the axe assertion comes from the shared a11y helper.
//!
//! History: the node cards exposed aria-selected on role="group", which
//! the ARIA spec does not allow (role=group supports no aria-selected) —
//! axe flagged it as a critical aria-allowed-attr violation on every card.
//! role="option" (the multi-select item role, already used by the editor's
//! own finder) carries the selection state legitimately.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, checkA11y } from './axe-helper';
import NodeTopologyEditor from '@/features/locations/NodeTopologyEditor';
import { loadTopology } from '@/api/topology';

vi.mock('@/api/topology', () => ({
  loadTopology: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({
    settings: {
      receipt: { showCurrency: false, decimalSeparator: 'dot', showTax: true, footer: '', paperWidth: 'standard', showTableNumber: false, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 },
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

/** Minimal en fallback surface — enough keys that the initial canvas
 *  renders real labels instead of raw Fluent ids. Localized children act
 *  as the fallback text for the rest. */
const TOPOLOGY_EN: Record<string, string> = {
  'topology-canvas-aria-label': 'Topology editor canvas. Use arrow keys to nudge selected nodes, Ctrl+Z to undo.',
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
  'topology-tool-hardware': '+ Hardware Node',
  'topology-tool-hardware-desc': 'Peripheral device',
  'topology-ws-type-store-pos': 'Retail POS',
  'topology-ws-type-restaurant-pos': 'Restaurant POS',
  'topology-ws-type-kds': 'Kitchen Display (KDS)',
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
  'topology-wire-toggle-aria': 'Toggle wire direction',
  'topology-zoom-in': 'Zoom in',
  'topology-zoom-out': 'Zoom out',
  'topology-minimap-aria': 'Diagram minimap',
  'topology-sim-start': 'Test Order Simulation',
  'topology-sim-stop': 'Stop Simulation',
  'topology-undo': 'Undo',
  'topology-redo': 'Redo',
  'topology-auto-layout': 'Auto-layout',
  'topology-export': 'Export',
  'topology-import': 'Import',
  'topology-shortcuts-aria': 'Keyboard shortcuts',
  'topology-shortcuts-help': 'Show keyboard shortcuts',
  'topology-rack-share-title': 'Share',
  'topology-save-template': 'Save template',
  'topology-templates': 'Templates',
  'topology-apply': 'Apply',
  'topology-validation-details': 'Issues ({count})',
  'topology-validation-panel-aria': 'Diagram issues',
  'topology-validation-dismiss': 'Dismiss',
  'topology-inspector-title': 'Node Properties',
  'topology-inspector-node-name': 'Node Name',
  'topology-inspector-subtitle': 'Subtitle / Location',
  'topology-inspector-close-aria': 'Close inspector',
  'topology-empty-state-title': 'Build your store topology',
  'topology-empty-state-body': 'Drag tools from the palette onto the canvas.',
  'topology-snap-toggle': 'Snap to grid',
  'topology-finder-aria': 'Find node',
  'topology-finder-placeholder': 'Search nodes…',
  'topology-unsaved': 'Unsaved changes',
  'topology-sim-aria': 'Test order simulation',
  'topology-shortcuts-title': 'Shortcuts',
  'topology-zoom-level-aria': 'Zoom level ({count})%',
  'topology-zoom-slider-aria': 'Zoom level',
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

beforeAll(() => {
  (loadTopology as ReturnType<typeof vi.fn>).mockResolvedValue(null);
});

const COMPARE_OVERLAY = {
  ghosts: [{ id: 'ghost-1', name: 'Back Office', x: 1100, y: 320 }],
  onlyHere: ['ws-1'],
  differing: [],
  otherWires: [],
  sharedByOtherId: [],
};

describe('NodeTopologyEditor a11y', () => {
  it('has no axe violations on initial render', async () => {
    const { container } = renderWithProviders(<NodeTopologyEditor currentTier="plus" />);
    await checkA11y(container);
  });

  it('has no axe violations with the node finder open', async () => {
    const { container } = renderWithProviders(<NodeTopologyEditor currentTier="plus" />);
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
    const input = container.querySelector('.topology-finder-input') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    // A query with matches AND one with no matches both render option lists.
    fireEvent.change(input!, { target: { value: 'ware' } });
    await checkA11y(container);
    fireEvent.change(input!, { target: { value: 'zzz-none' } });
    await checkA11y(container);
  });

  it('has no axe violations with the branch-compare overlay active', async () => {
    const { container } = renderWithProviders(
      <NodeTopologyEditor currentTier="plus" compareOverlay={COMPARE_OVERLAY} compareFocus />,
    );
    // Ghost layer + only-here markers + the compare panel all render.
    expect(container.querySelector('.topology-overlay-ghost-layer')).not.toBeNull();
    await checkA11y(container);
  });

  it('has no axe violations with the validation panel open', async () => {
    // A diagram with a real issue (workspace with no Location In) so the
    // issues widget + panel render.
    // Canonical store identity opts the canvas into strict validation; the
    // unwired workspace then yields a per-node issue (missing Location In).
    (loadTopology as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      nodes: [
        { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140, store_profile_id: 'store-1' },
        { id: 'ws-1', type: 'workspace', name: 'POS', x: 380, y: 80, metadata: { typeKey: 'store-pos' } },
      ],
      wires: [],
    } as never);
    const { container } = renderWithProviders(<NodeTopologyEditor currentTier="plus" />);
    // Wait for the async load to land the two-node diagram (the preset
    // placeholder validates clean, so the widget only appears post-load).
    await waitFor(() => {
      expect(container.querySelectorAll('.topology-node')).toHaveLength(2);
    });
    const issuesBtn = container.querySelector('.topology-issues-btn') as HTMLButtonElement | null;
    expect(issuesBtn).not.toBeNull();
    fireEvent.click(issuesBtn!);
    expect(container.querySelector('.topology-validation-panel')).not.toBeNull();
    await checkA11y(container);
  });
});
