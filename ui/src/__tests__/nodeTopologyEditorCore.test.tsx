// ── NodeTopologyEditor: Core ──
//
// Split out of the 12,246-line NodeTopologyEditor.test.tsx (2026-10-12).
//
// Vitest parallelises by FILE. That single file measured 49.2s — 46% of the full
// suite's 107.6s wall clock — so it was a HARD FLOOR no worker count could beat.
// The describes are spread over four files, time-balanced against the measured
// per-describe durations so none becomes the new floor.
//
// ⚠️ Each top-level describe moves WHOLE. Do NOT promote a nested describe here:
// 62 of the 94 describes read helpers (`nodes`, `pos`, `selected`, `selectNode`,
// `nodeCount`) from an OUTER scope, so a promoted child loses them and fails with
// a ReferenceError. That is why the big Component block moves as one unit.
//
// The shared harness is topologyEditorTestHarness.tsx; the `vi.mock` prologue
// cannot move there, because vi.mock is hoisted and file-scoped.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, act, within, cleanup } from '@testing-library/react';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import NodeTopologyEditor from '../features/locations/NodeTopologyEditor';
import { loadTopology, type TopologyData } from '@/api/topology';
import type * as nodeTopologyEditorState from '../features/locations/nodeTopologyEditorState';
import multiStoreFtl from '@/locales/multi-location.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import { resolveDropOverlaps, NODE_HEIGHT, NODE_WIDTH } from '../features/locations/nodeTopologyClamp';
import { TOPOLOGY_EN, RETAIL_SEED, renderEditor, getNodeCount, getWireCount, nodeAt, portOf, connectRows, previewLine, selectFirstNode, mockCanvasSize, confirmDialogAction, openRackPanel, applyWithPin, ReloadingHarness } from './topologyEditorTestHarness';

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


const settingsProviderPresent = vi.hoisted(() => ({ value: true }));

// Hoisted so BOTH accessors below can share it: the settings cards rendered
// inside the inspector call `useSettings()` and dereference
// `settings.store.currency` on mount, so a receipt-only stub crashes them.
// It is a hoisted FACTORY, not a value, because `vi.mock` factories run before
// any plain `const` in this file is initialized.
const settingsContextValue = vi.hoisted(() => () => ({
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
}));


vi.mock('@/contexts/SettingsContext', () => ({
  // The settings cards under the inspector (WorkspaceStorePosSettings et al.)
  // render inside a provider, so this is the throwing accessor for them.
  useSettings: () => settingsContextValue(),
  // The editor itself reads the OPTIONAL accessor: null stands for "no
  // SettingsProvider mounted", which is the Android/topology-route case.
  useOptionalSettings: () => (settingsProviderPresent.value ? settingsContextValue() : null),
}));

// The Apply flow now requires PIN verification before onSave (the redesign
// added a PIN confirmation popup). Mock verifyPin to accept any 4+ digit PIN
// so Apply tests drive the real popup flow instead of bypassing it.

vi.mock('@/api/staff', () => ({
  verifyPin: vi.fn(async () => true),
}));


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

const mockLoadTopology = vi.mocked(loadTopology);

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
    expect(locked!.textContent).toContain('Premium');

    const before = getNodeCount();
    fireEvent.click(screen.getByText('+ Warehouse'));
    // handleAddNode guards the tier: toast, no new node.
    expect(getNodeCount()).toBe(before);
    expect(
      screen.getByText('Warehouse nodes require a Premium Tier license.'),
    ).toBeInTheDocument();
  });

  it('unlocks the warehouse tool-card on Premium tier and adds a warehouse', () => {
    renderEditor({ currentTier: 'premium' });

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
    renderEditor({ currentTier: 'premium', onDirtyChange });
    // Wait for the post-load clean snapshot so the edit is the only delta.
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    selectWarehouse();

    fireEvent.change(screen.getByLabelText(/Capacity/), { target: { value: '500' } });

    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it('persists capacity and low-stock threshold through Apply', async () => {
    const onSave = vi.fn();
    // Capacity edits are Pro-gated (round 78) — render at Pro so the edits land.
    renderEditor({ currentTier: 'premium', onSave });
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
    renderEditor({ currentTier: 'premium' });
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
    renderEditor({ currentTier: 'premium' });
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
    renderEditor({ currentTier: 'premium' });
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
    renderEditor({ currentTier: 'premium' });
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
    renderEditor({ currentTier: 'premium' });
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
    renderEditor({ currentTier: 'premium' });
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

  it('replaces the capacity note with the tier-limit note below Premium', async () => {
    // The capacity guards and the warehouse tier cap now exclude each other by
    // tier: below Premium the cap is 0, so the card carries the tier-limit note
    // instead of the capacity note — the capacity wire marker stays off.
    await renderStandard();

    // The chip renders an icon; the message itself is the chip's title and the
    // screen-reader span, so read the title.
    const note = document.querySelector('.node-type-warehouse .node-validation-note');
    expect(note?.getAttribute('title')).toContain('Warehouse nodes require a Premium Tier license.');
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

    // The missing-wire prompt is suppressed below Premium, but the tier-limit
    // note is not: this diagram cannot be applied on this tier at all.
    const note = document.querySelector('.node-type-warehouse .node-validation-note');
    expect(note?.getAttribute('title')).toContain('Warehouse nodes require a Premium Tier license.');
    expect(note?.getAttribute('title')).not.toContain('stock');
  });
});

// ── Warehouse capacity tier notice ──────────────────────────────

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
    // Correction: that parent unmount effect has since been retired — the
    // pointer/touch/bend hook-tail effects own the pan/drag/touch/marquee
    // disarm now, and the fresh-node timers live in the add-node hook. This
    // test pins that the hook-owned disarm still leaves no leaked mouseup.
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

    // One node-scoped item per excess Stock Room (named, not static). Below
    // Premium the cap is ZERO, so BOTH Stock Rooms are flagged — there is no
    // allowed first one to skip.
    const matching = Array.from(panel!.querySelectorAll('.topology-validation-item')).filter((el) =>
      el.textContent?.includes('Warehouse nodes require a Premium Tier license.'),
    );
    expect(matching).toHaveLength(2);
    expect(
      matching.map((el) => el.querySelector('.topology-validation-item-node')?.textContent),
    ).toEqual(['WH 1', 'WH 2']);
    const item = matching[1]!;
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
    // Round 106, re-cut for the zero cap: below Premium EVERY Stock Room is
    // excess, so three of them produce THREE panel items — one per node, each
    // jumping to its own card. A regression to single-error emission would
    // leave WH 3 silently unflagged.
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
      el.textContent?.includes('Warehouse nodes require a Premium Tier license.'),
    );
    expect(matching).toHaveLength(3);
    expect(matching.map((el) => el.querySelector('.topology-validation-item-node')?.textContent)).toEqual([
      'WH 1',
      'WH 2',
      'WH 3',
    ]);

    // The last item jumps to WH 3's card and closes the panel.
    const wh3Card = Array.from(document.querySelectorAll('.topology-node')).find((el) =>
      el.textContent?.includes('WH 3'),
    )!;
    expect(wh3Card.className).not.toContain('node-selected');

    fireEvent.click(matching[2]!.querySelector('.topology-validation-item-select')!);

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
// Characterization tests pinning the disarm/teardown behavior of the input
// controllers (now hook modules): (1) tab-hidden disarms a held
// Space, (2) pointercancel ends a touch node drag with the position intact,
// (3) unmount tears down every document-level gesture listener, (4) wheel
// zoom-to-cursor compensates the pan so the content point under the cursor
// stays visually fixed.

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

  // ── Live-bound rename path (persistNodeRename + renameBaselineRef) ──
  // The inspector Node Name field and the card's headless body-config input
  // are LIVE-BOUND: the value is already edited on blur, so renameBaselineRef
  // (the focus-time snapshot) is what separates an unedited blur from a real
  // rename. persistNodeRename routes through the same parent callback the
  // card form uses, reverts the live-bound name when the parent refuses, and
  // advances the baseline at the commit boundary so a re-blur cannot
  // double-commit. (No renameSaving guard here — that is card-form-only.)

  it('an inspector rename persists through the parent and marks the canvas dirty', async () => {
    const onRenameBranch = vi.fn();
    renderEditor({ onRenameBranch });

    fireEvent.mouseDown(document.querySelectorAll('.topology-node')[0]!, { button: 0 });
    const nameInput = document.querySelector('.inspector-field input[type="text"]') as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    expect(nameInput.value).toBe('Downtown Branch');

    // Focus snapshots the baseline, the keystroke edits the live-bound name,
    // and the blur commits through the same parent callback the card uses.
    fireEvent.focus(nameInput);
    fireEvent.change(nameInput, { target: { value: 'Inspector HQ' } });
    fireEvent.blur(nameInput);

    await waitFor(() => expect(onRenameBranch).toHaveBeenCalledWith('store-1', 'Inspector HQ'));
    const storeCard = document.querySelectorAll('.topology-node')[0] as HTMLElement;
    await waitFor(() => expect(within(storeCard).getByText('Inspector HQ')).toBeTruthy());
    expect(document.querySelector('.topology-dirty-dot')).not.toBeNull();

    // The baseline advanced at the commit boundary: a second blur (the input
    // is still mounted) is a no-op, not a duplicate round-trip.
    fireEvent.blur(nameInput);
    expect(onRenameBranch).toHaveBeenCalledTimes(1);
  });

  it('an unedited inspector blur never round-trips the focus-time name', () => {
    // The baseline (written on focus) is what tells an unedited blur from a
    // real rename — without it, every tab-through the field would fire a
    // redundant rename through the parent.
    const onRenameBranch = vi.fn();
    renderEditor({ onRenameBranch });

    fireEvent.mouseDown(document.querySelectorAll('.topology-node')[0]!, { button: 0 });
    const nameInput = document.querySelector('.inspector-field input[type="text"]') as HTMLInputElement;
    fireEvent.focus(nameInput);
    fireEvent.blur(nameInput);

    expect(onRenameBranch).not.toHaveBeenCalled();
  });

  it('a whitespace-only inspector commit is a no-op, unlike the wire relabel that deletes', () => {
    // persistNodeRename trims and returns on empty — the node-name path has
    // no delete semantics (that is wire-label-only behavior, pinned by the
    // empty-relabel test above).
    const onRenameBranch = vi.fn();
    renderEditor({ onRenameBranch });

    fireEvent.mouseDown(document.querySelectorAll('.topology-node')[0]!, { button: 0 });
    const nameInput = document.querySelector('.inspector-field input[type="text"]') as HTMLInputElement;
    fireEvent.focus(nameInput);
    fireEvent.change(nameInput, { target: { value: '   ' } });
    fireEvent.blur(nameInput);

    expect(onRenameBranch).not.toHaveBeenCalled();
  });

  it('a rejected inspector rename reverts the live-bound name and stays retryable', async () => {
    // A false parent return reverts the canvas to the focus-time baseline
    // (a blurred input has no draft to keep) — and consumes nothing, so a
    // re-edit reaches the parent again.
    const onRenameWorkspace = vi.fn().mockResolvedValue(false);
    renderEditor({ onRenameWorkspace });

    const wsCard = document.querySelectorAll('.topology-node')[1] as HTMLElement;
    fireEvent.mouseDown(wsCard, { button: 0 });
    const nameInput = document.querySelector('.inspector-field input[type="text"]') as HTMLInputElement;
    expect(nameInput.value).toBe('Retail POS #1');

    fireEvent.focus(nameInput);
    fireEvent.change(nameInput, { target: { value: 'Rejected POS' } });
    fireEvent.blur(nameInput);

    await waitFor(() => expect(onRenameWorkspace).toHaveBeenCalledWith('ws-1', 'Rejected POS'));
    await waitFor(() => expect(within(wsCard).getByText('Retail POS #1')).toBeTruthy());
    expect(nameInput.value).toBe('Retail POS #1');

    // The retry is real: focus re-snapshots the baseline and the second
    // commit reaches the parent instead of being swallowed by a one-shot guard.
    fireEvent.focus(nameInput);
    fireEvent.change(nameInput, { target: { value: 'Rejected POS II' } });
    fireEvent.blur(nameInput);
    await waitFor(() => expect(onRenameWorkspace).toHaveBeenCalledWith('ws-1', 'Rejected POS II'));
    expect(onRenameWorkspace).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(within(wsCard).getByText('Retail POS #1')).toBeTruthy());
  });

  it('an inspector rename followed by a card rename costs a single undo entry', async () => {
    // The inspector's first keystroke pushes the selection session's only
    // history entry; commitNodeRename writes without pushing — so BOTH
    // renames undo together and the canvas lands back on the applied snapshot.
    const onRenameBranch = vi.fn();
    renderEditor({ onRenameBranch });

    fireEvent.mouseDown(document.querySelectorAll('.topology-node')[0]!, { button: 0 });
    const nameInput = document.querySelector('.inspector-field input[type="text"]') as HTMLInputElement;
    fireEvent.focus(nameInput);
    fireEvent.change(nameInput, { target: { value: 'Inspector HQ' } });
    fireEvent.blur(nameInput);
    const storeCard = document.querySelectorAll('.topology-node')[0] as HTMLElement;
    await waitFor(() => expect(within(storeCard).getByText('Inspector HQ')).toBeTruthy());

    // Card-level rename stacked on top of the inspector one.
    fireEvent.click(within(storeCard).getByRole('button', { name: 'topology-branch-rename-label' }));
    const cardInput = within(storeCard).getByLabelText('topology-branch-rename-placeholder') as HTMLInputElement;
    fireEvent.change(cardInput, { target: { value: 'Inspector HQ II' } });
    fireEvent.keyDown(cardInput, { key: 'Enter' });
    await waitFor(() => expect(within(storeCard).queryByLabelText('topology-branch-rename-placeholder')).toBeNull());
    await waitFor(() => expect(within(storeCard).getByText('Inspector HQ II')).toBeTruthy());

    // One undo reverts BOTH renames: history holds a single pre-inspector
    // snapshot, and the card commit never pushed a second entry.
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(within(storeCard).getByText('Downtown Branch')).toBeTruthy());
    expect(document.querySelector('.topology-dirty-dot')).toBeNull();
  });
});

// ── Viewport machinery characterization (pre-3.5a extraction) ────────
// Pins the CURRENT behavior of the G2 viewport block (pan/zoom state,
// debounced per-branch persistence, restore clamping, reset/fit anchors,
// auto-fit suppression, zoom-picker popover ownership) before slice 3.5a
// moves it out of the editor. Gaps closed: (b) the unmount flush inside
// the 250ms persist window; (c) clamp-on-restore of an out-of-range saved
// zoom; (d) resetView's Branch-Location anchor and its no-store fallback;
// (e) the restored-view half of auto-fit suppression; (f) what the zoom
// picker does and does not own (inside mousedown, toggle-close).

describe('NodeTopologyEditor — touch gesture characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTopology.mockResolvedValue(null);
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('a pointercancel past the drag threshold commits the node drag exactly like pointerup', () => {
    // The touch cancel handler delegates to the up handler, so a system
    // gesture stealing the touch MID-DRAG (finger already past 8px) must
    // COMMIT the drag — identical end state to a normal release — not
    // restore the pre-drag position (that is the pre-threshold half).
    // Proven by comparing two identical gestures that differ ONLY in
    // up-vs-cancel on their final event.
    renderEditor();
    const node = () => document.querySelector('.topology-node') as HTMLElement;
    const canvas = () => document.querySelector('.node-canvas-container') as HTMLElement;
    const before = node().style.left;

    // Mount A: the pointerup reference gesture.
    fireEvent.pointerDown(node(), { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 });
    fireEvent.pointerMove(canvas(), { pointerId: 1, pointerType: 'touch', clientX: 48, clientY: 48 });
    fireEvent.pointerUp(canvas(), { pointerId: 1, pointerType: 'touch' });
    const committedByUp = node().style.left;
    expect(committedByUp).not.toBe(before);
    cleanup();

    // Mount B: the same gesture, cancelled instead of released.
    renderEditor();
    expect(node().style.left).toBe(before);
    fireEvent.pointerDown(node(), { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 });
    fireEvent.pointerMove(canvas(), { pointerId: 1, pointerType: 'touch', clientX: 48, clientY: 48 });
    fireEvent.pointerCancel(document, { pointerId: 1, pointerType: 'touch', clientX: 48, clientY: 48 });
    expect(node().style.left).toBe(committedByUp);
    cleanup();
  });

  it('after a past-threshold pointercancel the disposer really ran: a fresh touch gesture re-arms', () => {
    // endTouchGesture runs the cleanup disposer on every full release,
    // cancel included. A partial teardown (disposer never invoked, or the
    // listeners removed without a re-arm path) would leave the NEXT touch
    // gesture dead — pan must still work after a cancelled node drag.
    renderEditor();
    const node = document.querySelector('.topology-node') as HTMLElement;
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const viewport = document.querySelector('.node-canvas-viewport') as HTMLElement;

    fireEvent.pointerDown(node, { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 48, clientY: 48 });
    fireEvent.pointerCancel(document, { pointerId: 1, pointerType: 'touch', clientX: 48, clientY: 48 });

    fireEvent.pointerDown(canvas, { pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { pointerId: 2, pointerType: 'touch', clientX: 150, clientY: 130 });
    fireEvent.pointerUp(canvas, { pointerId: 2, pointerType: 'touch' });
    expect(viewport.style.transform).toContain('translate(50px, 30px)');
  });

  it('two-finger pinch zooms AND pans through pinchTransform about the pinch midpoint', () => {
    // The earlier touch describe pins only "zoom happened"; this pins the
    // exact pinchTransform output. Fingers at (0,0) + (60,80): midpoint
    // (30,40), distance 100 (exact 3-4-5 x20). Spread to distance 150 with
    // the midpoint dragged to (75,0): ratio 1.5 (dyadic, so no float
    // drift), zoom 1.5 and pan = mid1 - mid0*1.5 = (75,0) - (45,60) =
    // (30,-60).
    renderEditor();
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;
    const viewport = document.querySelector('.node-canvas-viewport') as HTMLElement;

    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 });
    fireEvent.pointerDown(canvas, { pointerId: 2, pointerType: 'touch', clientX: 60, clientY: 80 });
    fireEvent.pointerMove(canvas, { pointerId: 2, pointerType: 'touch', clientX: 150, clientY: 0 });

    expect(document.querySelector('.canvas-zoom-level')?.textContent).toBe('150%');
    expect(viewport.style.transform).toContain('translate(30px, -60px)');
    expect(viewport.style.transform).toContain('scale(1.5)');

    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerUp(canvas, { pointerId: 2, pointerType: 'touch' });
  });

  it('a pinch during an in-flight node drag commits the drag (finalize, not revert)', () => {
    // The second-finger branch calls finalizeNodeDrag() when a node drag is
    // in flight: the node STAYS at its dragged position (a revert would
    // restore 80px) and the drag's already-pushed history entry survives,
    // so one undo returns the card to its start position.
    renderEditor();
    const node = document.querySelector('.topology-node') as HTMLElement;
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    fireEvent.pointerDown(node, { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 48, clientY: 48 });
    expect(node.style.left).not.toBe('80px'); // drag in flight

    fireEvent.pointerDown(canvas, { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 200 });
    fireEvent.pointerMove(canvas, { pointerId: 2, pointerType: 'touch', clientX: 260, clientY: 200 });
    expect(node.style.left).not.toBe('80px'); // pinch did NOT revert the drag
    expect(document.querySelector('.canvas-zoom-level')?.textContent).not.toBe('100%');

    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerUp(canvas, { pointerId: 2, pointerType: 'touch' });

    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    expect(node.style.left).toBe('80px');
    expect(document.querySelector('.topology-dirty-dot')).toBeNull();
  });

  it('a touch drag below TOUCH_DRAG_THRESHOLD never arms a node drag', () => {
    // hypot(5,3) is about 5.83px of travel - under the 8px threshold: the
    // gesture must stay a tap candidate, never calling beginNodeDrag, so
    // the node cannot move and no history entry (dirty dot) may appear.
    // The tap selection from pointerdown is KEPT on release (node taps
    // never route through the empty-canvas clearAll).
    renderEditor();
    const node = document.querySelector('.topology-node') as HTMLElement;
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    fireEvent.pointerDown(node, { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 5, clientY: 3 });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch' });

    expect(node.style.left).toBe('80px');
    expect(document.querySelector('.topology-dirty-dot')).toBeNull();
    expect(node.className).toContain('node-selected');
  });

  it('a touch tap on a node selects it', () => {
    // Selection happens at pointerdown (an unselected node collapses the
    // selection to itself); the release with no movement must keep it,
    // unlike a background tap, which clears the selection.
    renderEditor();
    const node = document.querySelector('.topology-node') as HTMLElement;
    const canvas = document.querySelector('.node-canvas-container') as HTMLElement;

    fireEvent.pointerDown(node, { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch' });

    expect(node.className).toContain('node-selected');
    expect(within(node).getByText('Downtown Branch')).toBeTruthy();
    expect(document.querySelectorAll('.topology-node.node-selected')).toHaveLength(1);
  });
});

// ── G13-prep: clipboard/selection cluster characterization ───────────
// Pins the observable contracts of clipboardRef / pasteCascadeRef /
// copySelection / duplicateSelection / pasteClipboard BEFORE the G13-c
// hook extraction (doc Phase-0 rule). Read off the cluster at HEAD
// a7b0c5051 (~1798-1907). Where the extraction brief predicted behavior
// the code does not have it is journaled, not "fixed": there is NO
// time-window coalescing on pasteCascadeRef — it is a monotonic
// per-paste counter that a fresh Ctrl+C resets, and every paste mints
// fresh crypto ids, so duplicate cascade ids are structurally impossible.