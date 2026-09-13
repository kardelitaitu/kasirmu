import { type ComponentProps } from 'react';
import type { TopologyNodeCard as NodeCardComponent } from '../features/locations/topologyNodeCard';
import type { TopologyWireGroup as WireGroupComponent } from '../features/locations/topologyWireGroup';
import { fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProvidersSync, rerenderWithProviders } from '@/__tests__/test-utils/render';
import NodeTopologyEditor from '../features/locations/NodeTopologyEditor';
import { loadTopology } from '@/api/topology';
import multiStoreFtl from '@/locales/multi-location.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

// Render-count probes. Each mock wraps the REAL memo'd component with a
// counting boundary that (like the production React.memo) re-renders only
// when its props change. A flat count for an unrelated card/wire proves the
// editor hands the layers referentially-stable props — the useCallback
// contract the memo depends on — so hover/selection re-renders only the
// affected element instead of the whole canvas.
const { nodeCounts, wireCounts, stableL10n, stableSettings } = vi.hoisted(() => ({
  nodeCounts: {} as Record<string, number>,
  wireCounts: {} as Record<string, number>,
  // Production @fluent/react returns a referentially-stable Localization
  // object; the mock must mirror that or the l10n prop itself defeats the
  // memo every render.
  stableL10n: { getString: (id: string) => id },
  // Same for SettingsContext: the editor's getTelemetry takes `settings` as
  // a useCallback dep, so a fresh object per call would churn every card.
  stableSettings: {
    receipt: { showCurrency: false, decimalSeparator: 'dot', showTax: true, footer: '', paperWidth: 'standard', showTableNumber: false, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 },
    store: { name: 'Test Store', address: '', taxId: '', currency: 'IDR', branch: '' },
    sync: { serverUrl: null, hasApiKey: false, enabled: false },
    brand: { colour: '#147EFB', storeName: 'Test Store' },
    preferences: { cardSize: 0, fontSize: 0, fontSmoothing: 'antialiased' },
    currencies: [],
    appVersion: '0.0.19',
  },
}));

// Last props object each memoized layer actually rendered with. The render
// counters above prove WHETHER a layer re-rendered; these prove WHY by
// letting a test compare a callback's identity across a rerender. Captured
// only as `unknown` so the probes stay type-independent of the components.
const { lastNodeProps, lastWireProps } = vi.hoisted(() => ({
  lastNodeProps: {} as Record<string, { onSelect: unknown; onCardMouseDown: unknown }>,
  lastWireProps: {} as Record<string, { onStartBendDrag: unknown; onStartGhostBend: unknown }>,
}));

vi.mock('../features/locations/topologyNodeCard', async (importOriginal) => {
  // The mocked module's type shape (only the component export is read).
  const actual = await importOriginal<{ TopologyNodeCard: typeof NodeCardComponent }>();
  const { memo: memoize } = await import('react');
  const RealCard = actual.TopologyNodeCard;
  return {
    ...actual,
    TopologyNodeCard: memoize((props: ComponentProps<typeof RealCard>) => {
      nodeCounts[props.node.id] = (nodeCounts[props.node.id] ?? 0) + 1;
      lastNodeProps[props.node.id] = props;
      return <RealCard {...props} />;
    }),
  };
});

vi.mock('../features/locations/topologyWireGroup', async (importOriginal) => {
  const actual = await importOriginal<{ TopologyWireGroup: typeof WireGroupComponent }>();
  const { memo: memoize } = await import('react');
  const RealWire = actual.TopologyWireGroup;
  return {
    ...actual,
    TopologyWireGroup: memoize((props: ComponentProps<typeof RealWire>) => {
      wireCounts[props.wire.id] = (wireCounts[props.wire.id] ?? 0) + 1;
      lastWireProps[props.wire.id] = props;
      return <RealWire {...props} />;
    }),
  };
});

vi.mock('@/api/topology', () => ({
  loadTopology: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('@fluent/react', async () => {
  const actual = await vi.importActual('@fluent/react');
  return {
    ...actual,
    Localized: ({ children }: { id: string; children: React.ReactNode }) => <>{children}</>,
    useLocalization: () => ({
      l10n: stableL10n,
    }),
  };
});

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({
    settings: stableSettings,
    loading: false,
    error: null,
    hasPartialError: false,
    refetch: vi.fn(),
    lastChangedKeys: [],
    markSettingsUpdated: vi.fn(),
  }),
}));

const mockLoadTopology = vi.mocked(loadTopology);

/** Render result of the last renderWithPreset — lets the round-157
 *  regression test rerender with new props (the parent handing instances
 *  after first visibility) to exercise the settle-aware baseline. */
let renderResult: ReturnType<typeof renderWithProvidersSync> | null = null;

/** Baseline = the counts accumulated during mount; tests assert interactions
 *  only change the elements they target. */
const snapshot = () => ({ ...nodeCounts, ...wireCounts });

const nodeCount = (id: string, base: Record<string, number>) => (nodeCounts[id] ?? 0) - (base[id] ?? 0);
const wireCount = (id: string, base: Record<string, number>) => (wireCounts[id] ?? 0) - (base[id] ?? 0);

/** Total renders across every card and wire — the quiescence signal. */
const totalRenders = () =>
  Object.values(nodeCounts).reduce((sum, n) => sum + n, 0)
  + Object.values(wireCounts).reduce((sum, n) => sum + n, 0);

/**
 * Wait for render-count quiescence: two consecutive samples 60ms apart with
 * no growth. The editor's mount can settle AFTER first visibility — async
 * settings invokes resolve on a ~50ms timer, and a parent can hand the
 * editor real instances right after load (a re-apply that re-renders every
 * wire). A baseline snapshotted mid-settle makes the exact-delta assertions
 * below flaky under machine load (round 157: `expected 2 to be 1` in the
 * cycle test). Each 60ms wait yields to the event loop, so pending timers
 * fire inside the settle and their renders land in the baseline. The
 * quiescence check alone is not enough — a timer armed just before the
 * settle (the re-apply's 100ms load) can fire AFTER a single stable
 * sample — so the settle also enforces a ~150ms floor, longer than the
 * longest known mount-time timer (the 50ms settings invoke).
 */
const settleCounts = async (): Promise<void> => {
  const startedAt = Date.now();
  let previous = -1;
  let current = totalRenders();
  while (previous !== current || Date.now() - startedAt < 150) {
    previous = current;
    await new Promise((resolve) => setTimeout(resolve, 60));
    current = totalRenders();
  }
};

describe('topology memoized render layers — hover/selection touch only the affected element', () => {
  // The load effect can fire more than once on mount (the editor shows a
  // placeholder preset while the async load resolves), so the mock ALWAYS
  // returns this diagram — every call resolves to the same nodes/wires.
  const renderWithPreset = async () => {
    // Resolve on a ~100ms timer: the editor's mount (and the re-apply a
    // parent can trigger by handing instances) settles on a MACROTASK, like
    // the async settings invokes in the real tree. A baseline snapshotted
    // before that settle lands is what flaked under load (round 157).
    mockLoadTopology.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({
        nodes: [
          { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
          { id: 'ws-1', type: 'workspace', name: 'POS 1', x: 380, y: 80 },
          { id: 'ws-2', type: 'workspace', name: 'POS 2', x: 380, y: 260 },
        ],
        wires: [
          { id: 'w1', from_node_id: 'store-1', to_node_id: 'ws-1', direction: 'one-way' },
          { id: 'w2', from_node_id: 'store-1', to_node_id: 'ws-2', direction: 'one-way' },
        ],
      } as never), 100)),
    );
    renderResult = renderWithProvidersSync(
      <NodeTopologyEditor currentTier="free" />,
      multiStoreFtl,
      sharedFtl,
    );
    // Wait on a node id only THIS preset has (the placeholder is a retail
    // preset with wh-1, not ws-2), so the counts baseline is post-load.
    await waitFor(() =>
      expect(document.querySelector('.topology-node[data-node-id="ws-2"]')).not.toBeNull(),
    );
    // Round 157: the naive baseline (taken at first visibility) could be
    // followed by mount-time settling that inflated an interaction delta.
    // Wait for quiescence so the baseline is stable under any load.
    await settleCounts();
    return snapshot();
  };

  const nodeEl = (id: string) => document.querySelector(`.topology-node[data-node-id="${id}"]`) as HTMLElement;
  const wireEl = (id: string) => document.querySelector(`.wire-hitbox[data-wire-id="${id}"]`) as HTMLElement;

  it('pointer hover over a card re-renders no card and no wire', async () => {
    const base = await renderWithPreset();

    fireEvent.mouseEnter(nodeEl('ws-1'));
    fireEvent.mouseLeave(nodeEl('ws-1'));

    // Hovering dims only the elements NOT connected to ws-1: the non-neighbor
    // ws-2 and its wire w2 (2 renders each — dim on enter, restore on leave).
    // The hovered card, its neighbor store-1, and the connected wire w1 get
    // no prop change — the memo boundary absorbs them entirely.
    expect(nodeCount('store-1', base)).toBe(0);
    expect(nodeCount('ws-1', base)).toBe(0);
    expect(nodeCount('ws-2', base)).toBe(2);
    expect(wireCount('w1', base)).toBe(0);
    expect(wireCount('w2', base)).toBe(2);
  });

  it('selecting a card re-renders only that card, not its neighbors or wires', async () => {
    const base = await renderWithPreset();

    fireEvent.mouseDown(nodeEl('ws-1'), { button: 0 });
    fireEvent.mouseUp(nodeEl('ws-1'), { button: 0 });

    expect(nodeCount('ws-1', base)).toBe(1);
    expect(nodeCount('store-1', base)).toBe(0);
    expect(nodeCount('ws-2', base)).toBe(0);
    expect(wireCount('w1', base)).toBe(0);
    expect(wireCount('w2', base)).toBe(0);
  });

  it('cycling a wire direction re-renders only that wire, not the other wire or any card', async () => {
    const base = await renderWithPreset();

    fireEvent.click(wireEl('w1'));

    // The clicked wire's data changed (direction cycle) — it re-renders.
    expect(wireCount('w1', base)).toBe(1);
    // The sibling wire keeps object identity; cards are untouched by a wire edit.
    expect(wireCount('w2', base)).toBe(0);
    expect(nodeCount('store-1', base)).toBe(0);
    expect(nodeCount('ws-1', base)).toBe(0);
    expect(nodeCount('ws-2', base)).toBe(0);
  });

  it('baseline is settle-aware — a late mount-time re-apply cannot inflate an interaction delta', async () => {
    // Round-157 full-suite flake: `expected 2 to be 1` in the cycle test —
    // a legitimate mount-time render landed after the first-visibility
    // baseline and inflated the click's delta by exactly one. The parent
    // handing the editor real instances right after load is the same class:
    // the load effect re-runs and re-applies the diagram, so every wire
    // re-renders once. A naive baseline reads that re-apply as part of the
    // click; a settle-aware baseline absorbs it.
    const base = await renderWithPreset();

    rerenderWithProviders(
      renderResult!,
      <NodeTopologyEditor
        currentTier="free"
        workspaceInstances={[
          { instanceId: 'ws-1', name: 'POS 1', typeKey: 'store-pos', purposeKey: 'general' },
          { instanceId: 'ws-2', name: 'POS 2', typeKey: 'store-pos', purposeKey: 'general' },
        ] as never}
      />,
      multiStoreFtl,
      sharedFtl,
    );
    // The re-apply's renders must land inside the settle-aware baseline.
    await settleCounts();
    const settled = snapshot();

    fireEvent.click(wireEl('w1'));

    // A baseline captured before the re-apply reads the re-apply + click as
    // 2 — the exact `expected 2 to be 1` signature of the round-157 flake.
    expect(wireCount('w1', base)).toBe(2);
    // The settle-aware baseline absorbs the re-apply: the click's true
    // delta is 1, and nothing else moved.
    expect(wireCount('w1', settled)).toBe(1);
    expect(wireCount('w2', settled)).toBe(0);
    expect(nodeCount('store-1', settled)).toBe(0);
    expect(nodeCount('ws-1', settled)).toBe(0);
    expect(nodeCount('ws-2', settled)).toBe(0);
  });

  // ── Viewport churn (Phase 3.4/3.5 extraction guards) ──────────────────
  // Pan/zoom are the ONE prop-identity churn the memoized layers live with
  // today, and the asymmetry is deliberate:
  //   * topologyEditorBendDrag's startBendDrag converts client coords with
  //     the CURRENT viewport, so its dep array is [pan, zoom, ...] — every
  //     pan or zoom step re-keys it and every wire group re-renders.
  //   * the card's drag/selection props (handleNodeMouseDown / selectOnly)
  //     read the viewport through panRef/zoomRef instead, so a pan must
  //     NEVER touch a card.
  // The pointer/keyboard/touch and viewport extractions on the refactor
  // ladder have to preserve exactly this split, so it is pinned here from
  // the outside — through the real editor and real gestures, not the hooks.

  const canvasEl = () => document.querySelector('.node-canvas-container') as HTMLElement;
  const viewportEl = () => document.querySelector('.node-canvas-viewport') as HTMLElement;
  const zoomLabel = () => document.querySelector('.canvas-zoom-level')?.textContent;

  /** The captured props of the LAST render of a layer — a throw with a named
   *  layer instead of a silent `undefined` if a gesture ever stops rendering
   *  it, which would otherwise read as a passing identity assertion. */
  const lastWire = (id: string) => {
    const props = lastWireProps[id];
    if (!props) throw new Error(`no props captured for wire ${id}`);
    return props;
  };
  const lastNode = (id: string) => {
    const props = lastNodeProps[id];
    if (!props) throw new Error(`no props captured for node ${id}`);
    return props;
  };

  /** One middle-button pan: the canvas starts the gesture, the editor's
   *  document-level mousemove (armed while the drag is in flight) moves it,
   *  mouseup tears it down. */
  const panStep = (dx = 50, dy = 30) => {
    fireEvent.mouseDown(canvasEl(), { button: 1, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 100 + dx, clientY: 100 + dy });
    fireEvent.mouseUp(document, { button: 1 });
  };

  it('panning re-keys the wire group onStartBendDrag identity (pre-existing viewport churn)', async () => {
    const base = await renderWithPreset();
    const bendBefore = lastWire('w1').onStartBendDrag;
    const ghostBefore = lastWire('w1').onStartGhostBend;
    const transformBefore = viewportEl().style.transform;

    panStep();

    // The gesture really moved the viewport (the transform is the proof, so
    // a test that silently no-ops on a canvas that ignores the drag fails).
    expect(viewportEl().style.transform).not.toBe(transformBefore);
    // Churn pinned: bends stay glued to the cursor while panned, which is
    // only possible because the handler re-keys with pan.
    expect(lastWire('w1').onStartBendDrag).not.toBe(bendBefore);
    expect(lastWire('w1').onStartGhostBend).not.toBe(ghostBefore);
    expect(wireCount('w1', base)).toBeGreaterThanOrEqual(1);
    expect(wireCount('w2', base)).toBeGreaterThanOrEqual(1);
  });

  it('the same pan leaves the node card drag/selection props referentially stable', async () => {
    const base = await renderWithPreset();
    const cardBefore = lastNode('ws-2');
    const transformBefore = viewportEl().style.transform;

    panStep();

    expect(viewportEl().style.transform).not.toBe(transformBefore);
    // The invariant: node-drag math reads pan through refs, so the props the
    // memoized card receives survive a pan unchanged.
    expect(lastNode('ws-2').onCardMouseDown).toBe(cardBefore.onCardMouseDown);
    expect(lastNode('ws-2').onSelect).toBe(cardBefore.onSelect);
    // And the memo boundary absorbs the pan outright — no card re-renders.
    expect(nodeCount('ws-2', base)).toBe(0);
    expect(nodeCount('ws-1', base)).toBe(0);
    expect(nodeCount('store-1', base)).toBe(0);
  });

  it('wheel zoom churns the wire props and leaves the card props stable, like a pan', async () => {
    const base = await renderWithPreset();
    const bendBefore = lastWire('w1').onStartBendDrag;
    const cardBefore = lastNode('ws-2');
    const zoomBefore = zoomLabel();

    fireEvent.wheel(canvasEl(), { deltaY: -100, clientX: 10, clientY: 10 });

    expect(zoomLabel()).not.toBe(zoomBefore);
    expect(lastWire('w1').onStartBendDrag).not.toBe(bendBefore);
    expect(wireCount('w1', base)).toBeGreaterThanOrEqual(1);
    expect(lastNode('ws-2').onCardMouseDown).toBe(cardBefore.onCardMouseDown);
    expect(lastNode('ws-2').onSelect).toBe(cardBefore.onSelect);
    expect(nodeCount('ws-2', base)).toBe(0);
  });
});
