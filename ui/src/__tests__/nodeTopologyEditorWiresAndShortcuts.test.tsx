// ── NodeTopologyEditor: WiresAndShortcuts ──
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
import { loadTopology, type TopologyData } from '@/api/topology';
import type * as nodeTopologyEditorState from '../features/locations/nodeTopologyEditorState';
import multiStoreFtl from '@/locales/multi-location.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import { NODE_HEIGHT, NODE_WIDTH } from '../features/locations/nodeTopologyClamp';
import { TOPOLOGY_EN, RETAIL_SEED, renderEditor, getNodeCount, getWireCount, nodeAt, portOf, portRowOf, previewLine, selectFirstNode, mockCanvasSize, confirmDialogAction, openRackPanel, applyWithPin, ReloadingHarness } from './topologyEditorTestHarness';

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
    renderEditor({ currentTier: 'premium', ...props });
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
    renderEditor({ currentTier: 'premium', onSave, branchId: 'b-dismiss' });
    await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(3));

    expect(document.querySelector('.node-validation-note')).toBeNull();
    await applyWithPin();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });
});

// ── Warehouse capacity tier gate ────────────────────────────────

describe('NodeTopologyEditor — warehouse capacity tier notice', () => {
  const renderGraph = async (tier: 'plus' | 'pro' | 'premium', metadata: Record<string, unknown>) => {
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

  it('shows the notice on Pro tier with the same numbers (capacity is Premium+)', async () => {
    // Pro is no longer the capacity-aware tier: the warehouse workspace is
    // Premium+ since 2026-09-29, so Pro reads exactly like plus here.
    await renderGraph('pro', { stock: 500, capacity: 1000 });
    expect(document.querySelector('.topology-tier-notice')).not.toBeNull();
  });

  it('hides the notice on Premium tier with the same numbers', async () => {
    await renderGraph('premium', { stock: 500, capacity: 1000 });
    expect(document.querySelector('.topology-tier-notice')).toBeNull();
  });

  it('hides the notice on plus tier without capacity numbers', async () => {
    await renderGraph('plus', { stock: 500 });
    expect(document.querySelector('.topology-tier-notice')).toBeNull();
  });

  it('applies a capacity-tracked warehouse on Premium tier, with no notice and no block', async () => {
    // The notice is informational for tiers that cannot hold a warehouse at
    // all, so the property worth pinning is the inverse: on the tier that CAN
    // (Premium), there is no notice and Apply succeeds with capacity numbers.
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
        // Premium enforces the capacity guards, so the room must actually be
        // serviced (the missing-stock-routing prompt would otherwise block
        // Apply and this test would prove nothing about the notice).
        { id: 'w-stock', from_node_id: 'ws-1', to_node_id: 'wh-1', from_port_id: 'stock-out', to_port_id: 'stock-in', relationship_type: 'stock-routing', direction: 'one-way' },
      ],
    } as never);
    renderEditor({ currentTier: 'premium', onSave });
    await waitFor(() => expect(document.querySelectorAll('.topology-node')).toHaveLength(3));

    expect(document.querySelector('.topology-tier-notice')).toBeNull();
    await applyWithPin();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });
});

// ── Zoom controls behavior ──────────────────────────────────────

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
    const WH_TOAST = 'Warehouse nodes require a Premium Tier license.';

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
      renderEditor({ currentTier: 'premium' });
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
    // R1 (2026-09-16): the read carries the session first — this harness
    // renders with MOCK_SESSION_TOKEN, so that is what the mock receives.
    await waitFor(() => expect(mockLoadTopology).toHaveBeenCalledWith('mock-session-token', 'branch-a'));
  });
});

// ── Node finder (Ctrl+F) ────────────────────────────────────────

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
    // The unmount hook-tail effects (pointer/touch/bend, plus the editor's
    // own install-and-clean effects) must disarm EVERY document-level gesture
    // listener — no parent sweep exists anymore.
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

describe('NodeTopologyEditor — viewport machinery characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTopology.mockResolvedValue(null);
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  const viewKey = (branch?: string) => `oz-topology-viewport:${branch ?? 'unassigned'}`;
  const zoomLevel = () => document.querySelector('.canvas-zoom-level')?.textContent;
  const transform = () => (document.querySelector('.node-canvas-viewport') as HTMLElement).style.transform;
  const canvas = () => document.querySelector('.node-canvas-container') as HTMLElement;
  /** The live pan/zoom as rendered — the same numbers a persist must capture. */
  const readTransform = () => {
    const m = /translate\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px\s*\)\s*scale\(\s*([-\d.]+)\s*\)/.exec(transform());
    if (!m) throw new Error(`unparsable viewport transform: ${transform()}`);
    return { x: parseFloat(m[1]!), y: parseFloat(m[2]!), zoom: parseFloat(m[3]!) };
  };
  type SavedView = { zoom: number; pan: { x: number; y: number } };
  const readSavedView = (key: string): SavedView | null => {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as SavedView);
  };

  it('defers the viewport write until the 250ms debounce has elapsed', () => {
    // Gap (b), first half: the write is debounced, not per-change. An
    // extraction that drops the timer (or fires it synchronously) turns
    // every pointer-move into a localStorage write.
    vi.useFakeTimers();
    const key = viewKey('branch-a');
    renderEditor({ branchId: 'branch-a' });
    expect(localStorage.getItem(key)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));

    act(() => { vi.advanceTimersByTime(249); });
    expect(localStorage.getItem(key)).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(readSavedView(key)?.zoom).toBeCloseTo(1.25, 5);
  });

  it('flushes the pending viewport write on unmount, inside the debounce window', () => {
    // Gap (b), the half that actually loses data: a branch switch (which
    // remounts the editor) landing < 250ms after the last pan must not drop
    // that pan. Two mutations after mount, so the flush has to carry the
    // LATEST value — not the mount identity, not the intermediate 1.1.
    vi.useFakeTimers();
    const key = viewKey('branch-a');
    const first = renderEditor({ branchId: 'branch-a' });

    fireEvent.wheel(canvas(), { deltaY: -100, clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    const live = readTransform();
    expect(live.zoom).toBeCloseTo(1.375, 5); // 1 → 1.1 (wheel) → 1.375 (+25%)
    expect(localStorage.getItem(key)).toBeNull(); // still inside the window

    first.unmount();

    const saved = readSavedView(key);
    expect(saved).not.toBeNull();
    expect(saved!.zoom).toBeCloseTo(live.zoom, 5);
    expect(saved!.pan.x).toBeCloseTo(live.x, 5);
    expect(saved!.pan.y).toBeCloseTo(live.y, 5);

    // And the remount lands exactly where the user left the canvas.
    renderEditor({ branchId: 'branch-a' });
    expect(zoomLevel()).toBe('138%');
  });

  it('clamps an out-of-range saved zoom into the 0.4..2.0 band on restore and keeps the saved pan', () => {
    // Gap (c): the clamp lives in the useState initializer, so a stale or
    // hand-edited 5x / 0.05x value can never reach the transform. The pan is
    // deliberately NOT clamped — restoring it verbatim is the contract.
    localStorage.setItem(viewKey('branch-hi'), JSON.stringify({ zoom: 5, pan: { x: 120, y: -40 } }));
    const hi = renderEditor({ branchId: 'branch-hi' });
    expect(zoomLevel()).toBe('200%');
    expect(transform()).toBe('translate(120px, -40px) scale(2)');
    hi.unmount();

    localStorage.clear();
    localStorage.setItem(viewKey('branch-lo'), JSON.stringify({ zoom: 0.05, pan: { x: 0, y: 0 } }));
    renderEditor({ branchId: 'branch-lo' });
    expect(zoomLevel()).toBe('40%');
    expect(transform()).toBe('translate(0px, 0px) scale(0.4)');
  });

  it('mounts at identity when the saved view is unparsable or only half-shaped', () => {
    // Gap (c), the reject half: a corrupt record must not leave the canvas
    // unusable, and a zoom with no pan is rejected as a whole — no partial
    // restore that moves the diagram without the user asking.
    localStorage.setItem(viewKey('bad'), '{not json');
    const first = renderEditor({ branchId: 'bad' });
    expect(zoomLevel()).toBe('100%');
    expect(transform()).toBe('translate(0px, 0px) scale(1)');
    first.unmount();

    localStorage.clear();
    localStorage.setItem(viewKey('half'), JSON.stringify({ zoom: 1.5 }));
    renderEditor({ branchId: 'half' });
    expect(zoomLevel()).toBe('100%');
    expect(transform()).toBe('translate(0px, 0px) scale(1)');
  });

  it('Reset View anchors the Branch Location card at the fixed margin instead of the canvas origin', () => {
    // Gap (d), the anchor half: reset is not "identity", it is
    // margin(60) − store position. The expectation is computed from the
    // card's own canvas coords so the pin survives preset drift.
    renderEditor();
    const store = document.querySelectorAll('.topology-node')[0] as HTMLElement;
    const storeX = parseFloat(store.style.left);
    const storeY = parseFloat(store.style.top);

    fireEvent.wheel(canvas(), { deltaY: -100, clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(transform()).not.toBe('translate(0px, 0px) scale(1)');

    fireEvent.click(screen.getByText('Reset View'));

    expect(zoomLevel()).toBe('100%');
    expect(transform()).toBe(`translate(${60 - storeX}px, ${60 - storeY}px) scale(1)`);
  });

  it('Reset View falls back to the identity transform when the diagram has no Branch Location', async () => {
    // Gap (d), the fallback half: with no 'store' node the ternary must land
    // on {0,0} — and still reset zoom to 1.
    mockLoadTopology.mockResolvedValueOnce({
      nodes: [{ id: 'n-solo', type: 'workspace', name: 'Solo POS', x: 900, y: 700, metadata: { typeKey: 'store-pos' } }],
      wires: [],
    } as never);
    renderEditor();
    await waitFor(() => expect(getNodeCount()).toBe(1));

    fireEvent.wheel(canvas(), { deltaY: -100, clientX: 10, clientY: 10 });
    expect(transform()).not.toBe('translate(0px, 0px) scale(1)');

    fireEvent.click(screen.getByText('Reset View'));

    expect(zoomLevel()).toBe('100%');
    expect(transform()).toBe('translate(0px, 0px) scale(1)');
  });

  it('does not auto-fit an overflowing diagram whose view came back from storage', async () => {
    // Gap (e): restoredViewRef is the second suppression gate and had no
    // coverage. The same geometry that the auto-fit suite expects to land on
    // scale(0.4) must stay put when this branch already has a saved view.
    localStorage.setItem(viewKey(), JSON.stringify({ zoom: 1, pan: { x: 500, y: 500 } }));
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

    expect(transform()).toBe('translate(500px, 500px) scale(1)');
  });

  it('keeps the zoom slider popover open through a mousedown inside the zoom controls', () => {
    // Gap (f): the toolbar/slider stopPropagation is what makes a slider drag
    // possible at all — the document-level close listener must not fire on it.
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: /zoom level/i }));
    const slider = document.querySelector('.canvas-zoom-slider-pop input[type="range"]') as HTMLInputElement;
    expect(slider).not.toBeNull();

    fireEvent.mouseDown(document.querySelector('.canvas-zoom-controls')!);
    expect(document.querySelector('.canvas-zoom-slider-pop')).not.toBeNull();
    fireEvent.mouseDown(slider);
    expect(document.querySelector('.canvas-zoom-slider-pop')).not.toBeNull();

    // The same gesture one node away in the tree IS an outside click.
    fireEvent.mouseDown(canvas());
    expect(document.querySelector('.canvas-zoom-slider-pop')).toBeNull();
  });

  it('closes the zoom slider popover when the zoom level button is clicked again', () => {
    // Gap (f), the toggle half: the button owns a `v => !v` toggle AND stops
    // its own mousedown. Drop either half and the second click re-opens the
    // popover (the document close fires first, then the toggle flips back on).
    renderEditor();
    const btn = screen.getByRole('button', { name: /zoom level/i });
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');

    fireEvent.mouseDown(btn);
    expect(document.querySelector('.canvas-zoom-slider-pop')).not.toBeNull();
    fireEvent.click(btn);
    expect(document.querySelector('.canvas-zoom-slider-pop')).toBeNull();
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  it('Escape closes the zoom popover and is NOT handed to the canvas Escape ladder', async () => {
    // Gap (f), the ownership half. The popover listens on document and calls
    // stopPropagation; the canvas ladder listens on window (bubble phase), so
    // that stop is what keeps the keystroke exclusive — an Escape aimed at the
    // popover must not also clear the selection underneath it. Move the
    // popover listener to window, or drop the stopPropagation, and this reddens.
    renderEditor();
    mockCanvasSize(1200, 800);
    const live = () => screen.getByTestId('topology-live-region').textContent;
    selectFirstNode();
    await waitFor(() => expect(live()).toBe('Downtown Branch selected'));
    const btn = screen.getByRole('button', { name: /zoom level/i });
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(document.querySelector('.canvas-zoom-slider-pop')).toBeNull();
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    // The selection survives the keystroke: no 'Selection cleared' announce,
    // and the card is still the inspector's subject.
    let cleared = false;
    try {
      await waitFor(() => expect(live()).toBe('Selection cleared'), { timeout: 600, interval: 50 });
      cleared = true;
    } catch { cleared = false; }
    expect(cleared).toBe(false);
    expect(live()).toBe('Downtown Branch selected');
  });
});


// ── Touch gesture characterization (3.4e touch hook protection) ──
// Pins the POST-threshold semantics of the touch loop. coder-21's disarm
// block already pinned the pre-threshold half (cancel restores, tap, pan,
// basic zoom); this block pins what happens PAST the 8px
// TOUCH_DRAG_THRESHOLD and the exact pinch math.

describe('NodeTopologyEditor — clipboard cluster characterization (G13-prep)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTopology.mockResolvedValue(null);
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  // Preset (mockLoadTopology null) renders in array order
  // [store-1 (80,140), ws-1, wh-1]; copies APPEND, so index 0..2 stay
  // the originals for the whole lifetime of a test (pinned by the
  // existing clipboard describe's assertions at the same coordinates).
  const selectNode = (i: number) => {
    const nodes = [...document.querySelectorAll('.topology-node')] as HTMLElement[];
    fireEvent.mouseDown(nodes[i]!, { button: 0 });
  };
  const nodeCount = () => document.querySelectorAll('.topology-node').length;
  const nodePos = () => [...document.querySelectorAll('.topology-node')]
    .map((n) => ({
      x: parseInt((n as HTMLElement).style.left, 10),
      y: parseInt((n as HTMLElement).style.top, 10),
    }));
  const countAt = (x: number, y: number) =>
    nodePos().filter((p) => p.x === x && p.y === y).length;
  const typeCount = (type: 'store' | 'workspace' | 'warehouse') =>
    document.querySelectorAll(`.topology-node.node-type-${type}`).length;
  const WH_TOAST = 'Warehouse nodes require a Premium Tier license.';

  it('Ctrl+C snapshots the selection: a later move of the ORIGINAL never reaches the clipboard', async () => {
    // clipboardRef stores per-node object copies taken at COPY time
    // (nodes.filter(...).map(n => ({ ...n }))), so what lands is anchored
    // to the copy-time position even though the live node has since moved.
    renderEditor();
    selectNode(1); // ws-1
    const atCopy = nodePos()[1]!;

    fireEvent.keyDown(document, { key: 'c', ctrlKey: true });
    // Mutate the live canvas AFTER the copy: a grid nudge moves the source.
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    await waitFor(() => expect(nodePos()[1]).not.toEqual(atCopy));

    fireEvent.keyDown(document, { key: 'v', ctrlKey: true });
    await waitFor(() => expect(nodeCount()).toBe(4));
    // Snapshot semantics: exactly one grid step (24) from the copy-time
    // position — a live-reference clipboard would land one step from the
    // POST-NUDGE position instead.
    expect(countAt(atCopy.x + 24, atCopy.y + 24)).toBe(1);
  });

  it('Ctrl+V pastes what was COPIED, never what is selected now', async () => {
    renderEditor();
    selectNode(0); // the store anchor at (80,140)
    fireEvent.keyDown(document, { key: 'c', ctrlKey: true });

    selectNode(1); // move the selection to the workspace
    fireEvent.keyDown(document, { key: 'v', ctrlKey: true });
    await waitFor(() => expect(nodeCount()).toBe(4));
    // The new card is a STORE copy (workspace count unchanged) one grid
    // step from the store — proof the paste reads clipboardRef, not
    // selectedNodeIds, at paste time.
    expect(typeCount('store')).toBe(2);
    expect(typeCount('workspace')).toBe(1);
    expect(countAt(104, 164)).toBe(1);
    const selected = [...document.querySelectorAll('.topology-node.node-selected')] as HTMLElement[];
    expect(selected).toHaveLength(1);
    expect(selected[0]!.className).toContain('node-type-store');
  });

  it('a fresh Ctrl+C resets the paste cascade to ONE grid step; every paste mints unique ids', async () => {
    renderEditor();
    selectNode(0);
    fireEvent.keyDown(document, { key: 'c', ctrlKey: true });
    fireEvent.keyDown(document, { key: 'v', ctrlKey: true });
    await waitFor(() => expect(nodeCount()).toBe(4));
    fireEvent.keyDown(document, { key: 'v', ctrlKey: true });
    await waitFor(() => expect(nodeCount()).toBe(5));
    expect(countAt(104, 164)).toBe(1); // cascade step 1
    expect(countAt(128, 188)).toBe(1); // cascade step 2

    // Re-copy the ORIGINAL (copies append, so index 0 is still store-1):
    // copySelection resets pasteCascadeRef, so the next paste is step ONE
    // again — not step three.
    selectNode(0);
    fireEvent.keyDown(document, { key: 'c', ctrlKey: true });
    fireEvent.keyDown(document, { key: 'v', ctrlKey: true });
    await waitFor(() => expect(nodeCount()).toBe(6));
    expect(countAt(104, 164)).toBe(2); // reset landed: two tenants, one cell
    expect(countAt(152, 212)).toBe(0); // an unreset counter would land here

    // Three pastes of one snapshot mint fresh crypto identities each time:
    // the cascade counter never leaks into id generation.
    const ids = [...document.querySelectorAll('.topology-node[data-node-id]')]
      .map((n) => (n as HTMLElement).getAttribute('data-node-id'));
    expect(new Set(ids).size).toBe(6);
  });

  it('Ctrl+C on an empty selection is a no-op that PRESERVES the clipboard', async () => {
    renderEditor();
    selectNode(1); // ws-1
    const atCopy = nodePos()[1]!;
    fireEvent.keyDown(document, { key: 'c', ctrlKey: true });

    fireEvent.keyDown(document, { key: 'Escape' }); // clears the selection
    expect(nodeCount()).toBe(3);
    // A guardless impl would overwrite the clipboard with an empty
    // snapshot here and silently kill the next paste.
    fireEvent.keyDown(document, { key: 'c', ctrlKey: true });

    fireEvent.keyDown(document, { key: 'v', ctrlKey: true });
    await waitFor(() => expect(nodeCount()).toBe(4));
    expect(typeCount('workspace')).toBe(2);
    expect(countAt(atCopy.x + 24, atCopy.y + 24)).toBe(1);
  });

  it('Ctrl+V before anything was copied is a silent no-op that leaves the cluster healthy', async () => {
    renderEditor();
    selectNode(0);

    fireEvent.keyDown(document, { key: 'v', ctrlKey: true });
    expect(nodeCount()).toBe(3); // nothing pasted from an empty clipboard
    expect(countAt(104, 164)).toBe(0);
    expect(screen.queryAllByText(WH_TOAST)).toHaveLength(0); // and it stays silent

    // The early return must not corrupt any state: a real copy→paste after
    // it still lands at cascade step one.
    fireEvent.keyDown(document, { key: 'c', ctrlKey: true });
    fireEvent.keyDown(document, { key: 'v', ctrlKey: true });
    await waitFor(() => expect(nodeCount()).toBe(4));
    expect(countAt(104, 164)).toBe(1);
  });

  it('a refused warehouse paste adds NO undo entry and NO nodes (gate runs before history)', async () => {
    // Standard tier (renderEditor's default) caps warehouses at one.
    renderEditor();
    // One real, undoable edit first: duplicating a workspace is allowed.
    selectNode(1);
    fireEvent.keyDown(document, { key: 'd', ctrlKey: true });
    await waitFor(() => expect(nodeCount()).toBe(4));

    // Copying the warehouse is NEVER gated (copy mutates nothing) — the
    // gate is a creation-path check shared by duplicate/paste/Alt+drag.
    selectNode(2); // wh-1 — copies append, originals keep indices 0..2
    fireEvent.keyDown(document, { key: 'c', ctrlKey: true });
    expect(screen.queryAllByText(WH_TOAST)).toHaveLength(0);

    // The paste is refused before any history entry or cascade offset.
    fireEvent.keyDown(document, { key: 'v', ctrlKey: true });
    await waitFor(() => expect(screen.queryAllByText(WH_TOAST).length).toBeGreaterThanOrEqual(1));
    expect(nodeCount()).toBe(4);
    expect(typeCount('warehouse')).toBe(1);

    // Exactly ONE undo still reverts the duplicate: had the refused paste
    // pushed an entry, the first Ctrl+Z would pop that ghost and leave
    // the canvas at 4 nodes.
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(nodeCount()).toBe(3));
  });

  it('the inspector Duplicate button drives the same selection path (and hides on the store)', async () => {
    // Same useCallback as Ctrl+D — the extraction must keep every driver
    // (keyboard, rack item, inspector button) on ONE implementation.
    renderEditor();
    selectNode(0); // the store anchor never offers duplication
    let drawer = document.querySelector('.node-inspector-drawer') as HTMLElement;
    expect(drawer).not.toBeNull();
    expect(within(drawer).queryByRole('button', { name: 'Duplicate' })).toBeNull();

    selectNode(1); // ws-1 — the button appears
    drawer = document.querySelector('.node-inspector-drawer') as HTMLElement;
    const atClick = nodePos()[1]!;
    fireEvent.click(within(drawer).getByRole('button', { name: 'Duplicate' }));

    await waitFor(() => expect(nodeCount()).toBe(4));
    expect(countAt(atClick.x + 24, atClick.y + 24)).toBe(1);
    // Selection moved to the copy (the cascade-Ctrl+D contract).
    const selected = [...document.querySelectorAll('.topology-node.node-selected')] as HTMLElement[];
    expect(selected).toHaveLength(1);
    expect(selected[0]!.style.left).toBe(`${atClick.x + 24}px`);
  });
});
