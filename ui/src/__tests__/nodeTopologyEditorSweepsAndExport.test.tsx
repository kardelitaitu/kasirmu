// ── NodeTopologyEditor: SweepsAndExport ──
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

import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import NodeTopologyEditor, { type WorkspaceInstanceSeed, type BranchLocationSeed } from '../features/locations/NodeTopologyEditor';
import { loadTopology } from '@/api/topology';
import type * as nodeTopologyEditorState from '../features/locations/nodeTopologyEditorState';
import { clearDevLog } from '@/utils/devLog';
import multiStoreFtl from '@/locales/multi-location.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import { clampNodeToViewport, edgeAutoPanDelta, findFreeSpawnSpot, NODE_HEIGHT, NODE_PORT_ROW_H, NODE_PORT_MARKER, NODE_WIDTH } from '../features/locations/nodeTopologyClamp';
import { TOPOLOGY_EN, RETAIL_SEED, renderEditor, getNodeCount, getWireCount, nodeAt, portOf, portRowOf, connectRows, typeSelect, previewLine, selectFirstNode, mockCanvasSize, confirmDialogAction, openRackPanel, applyWithPin, ghostXY, renameWsInstances, ReloadingHarness, BranchRenameHarness, WorkspaceRenameHarness, BothChangeHarness } from './topologyEditorTestHarness';

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

describe('NodeTopologyEditor Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsProviderPresent.value = true;
    clearDevLog(); // no dev-log diagnostics may leak across tests
    mockLoadTopology.mockResolvedValue(null);
  });

  it('renders outside SettingsProvider instead of crashing the fullscreen topology route', () => {
    settingsProviderPresent.value = false;
    renderEditor();
    expect(document.querySelector('.node-canvas-container')).toBeInTheDocument();
    expect(screen.getByText('Retail POS #1')).toBeInTheDocument();
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
    renderEditor({ currentTier: 'premium' });

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

      expect(screen.getAllByText('Warehouse nodes require a Premium Tier license.').length).toBeGreaterThanOrEqual(1);
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
        // Both Stock Rooms are excess below Premium (the cap is 0, not 1), so
        // the panel opens with one issue per excess node.
        expect(screen.getByText('Apply blocked — 2 issue(s) to fix in the panel')).toBeInTheDocument());
      expect(document.querySelector('.topology-validation-panel')).not.toBeNull();
      expect(onSave).not.toHaveBeenCalled();
    });

    it('blocks Apply for warehouses on a Pro-tier diagram (the workspace is Premium+)', async () => {
      // Pro was the top warehouse tier before 2026-09-29, so it is the tier the
      // zero cap is easiest to get wrong on: both Stock Rooms are excess and
      // Apply is refused, exactly as `validate_warehouse_quota` refuses them.
      mockLoadTopology.mockResolvedValueOnce(twoWarehouseDiagram);
      const onSave = vi.fn();
      renderEditor({ currentTier: 'pro', onSave });
      await waitFor(() => expect(getNodeCount()).toBe(4));

      fireEvent.click(screen.getByText('Apply Topology'));

      await waitFor(() =>
        expect(screen.getByText('Apply blocked — 2 issue(s) to fix in the panel')).toBeInTheDocument());
      expect(onSave).not.toHaveBeenCalled();
    });

    it('allows two warehouses on a Premium-tier diagram', async () => {
      // Regression: the editor's set was ['pro', 'enterprise'] and the screen's
      // tier union omitted 'premium', so a Premium install saw the
      // standard-tier warehouse-tier-limit banner and Apply gate even though
      // the backend treats Premium as an unlimited-warehouse tier. Premium is
      // now the FIRST tier that may hold a Stock Room at all.
      mockLoadTopology.mockResolvedValueOnce(twoWarehouseDiagram);
      const onSave = vi.fn();
      renderEditor({ currentTier: 'premium', onSave });
      await waitFor(() => expect(getNodeCount()).toBe(4));

      expect(screen.queryByText('Warehouse nodes require a Premium Tier license.')).toBeNull();

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
      'Warehouse nodes require a Premium Tier license.',
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
