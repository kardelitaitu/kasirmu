// ── NodeTopologyEditor: WarehouseAndCanvas ──
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
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import { loadTopology } from '@/api/topology';
import type * as nodeTopologyEditorState from '../features/locations/nodeTopologyEditorState';
import { getDevLog } from '@/utils/devLog';
import multiStoreFtl from '@/locales/multi-location.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import { NODE_HEIGHT, NODE_WIDTH } from '../features/locations/nodeTopologyClamp';
import { TOPOLOGY_EN, RETAIL_SEED, renderEditor, getNodeCount, getWireCount, nodeAt, portOf, connectRows, typeSelect, previewLine, mockCanvasSize, openRackPanel, applyWithPin, ReloadingHarness } from './topologyEditorTestHarness';

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

describe('NodeTopologyEditor — Pro-tier warehouse fallback label', () => {
  it('allows a second workspace→warehouse wire with the fallback label on Pro', () => {
    renderEditor({ currentTier: 'premium' });
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
    renderEditor({ currentTier: 'premium' });
    selectWarehouse();

    expect(screen.getByLabelText(/Capacity/)).toBeEnabled();
    expect(screen.getByLabelText(/Low-Stock Threshold/)).toBeEnabled();
    expect(screen.getByLabelText(/Current Stock/)).toBeEnabled();
    expect(document.querySelector('.inspector-lock-badge')).toBeNull();
  });
});

// ── Warehouse low-stock telemetry ───────────────────────────────

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
    renderEditor({ currentTier: 'premium' });
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

describe('NodeTopologyEditor — undo history cap', () => {
  // This case drives 51 adds + 50 undos synchronously: 5.4 s on an idle runner,
  // which the 10 s global testTimeout (ui/vite.config.ts) does not cover under
  // full-suite load, so the cap budget is raised here, not the assertions.
  it('caps the undo stack at 50 entries, evicting the oldest', { timeout: 30_000 }, () => {
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

describe('NodeTopologyEditor — tool-slot shortcuts', () => {
  const lastNodeType = () => {
    const nodes = document.querySelectorAll('.topology-node');
    return nodes[nodes.length - 1]?.className ?? '';
  };

  it('1 spawns a store node, 2 a workspace, 3 a warehouse, 4 hardware', () => {
    // Pro tier: the standard-tier preset already owns a warehouse, which
    // would block the '3' slot on the multi-warehouse gate.
    renderEditor({ currentTier: 'premium' });
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
    renderEditor({ currentTier: 'premium' });
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