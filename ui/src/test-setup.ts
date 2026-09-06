// Vitest global setup: load jest-dom matchers and any browser API
// polyfills the components need.

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { beforeEach, afterEach, vi } from 'vitest';
import type * as WorkspaceContextModule from '@/contexts/WorkspaceContext';
import type * as SubscriptionContextModule from '@/contexts/SubscriptionContext';
import { HARNESS_SESSION_TOKEN } from '@/__tests__/test-utils/harnessDefaults';

// ── Global mock: echarts-for-react ────────────────────────────────
// jsdom lacks Canvas 2D context support, which causes zrender (ECharts'
// rendering engine) to throw. This mock renders a simple placeholder div
// so component tests can validate UI structure (KPIs, tables, labels)
// without real charts. Tests needing actual chart rendering should use
// Playwright E2E tests instead.
vi.mock('echarts-for-react', () => ({
  default: ({ style, ...props }: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { option, notMerge, lazyUpdate, onEvents, onChartReady, theme, ...rest } = props as Record<string, unknown>;
    return {
      type: 'div',
      props: {
        ...rest,
        'data-testid': 'echarts-mock',
        style: { ...(style as object), border: '1px dashed var(--color-border)' },
      },
    };
  },
}));

// ── Global mock: echarts/core (for the minimal bundle imports) ─────
vi.mock('echarts/core', () => ({
  use: vi.fn(),
  init: vi.fn(() => ({
    setOption: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
    getOption: vi.fn(() => ({})),
  })),
  graphic: { LinearGradient: vi.fn() },
}));

vi.mock('echarts/charts', () => ({
  BarChart: {},
  LineChart: {},
  PieChart: {},
  HeatmapChart: {},
}));

vi.mock('echarts/components', () => ({
  GridComponent: {},
  TooltipComponent: {},
  LegendComponent: {},
  VisualMapComponent: {},
}));

vi.mock('echarts/renderers', () => ({
  CanvasRenderer: {},
}));

// ── Global mock: @tauri-apps/api/event ─────────────────────────
// SettingsContext uses a dynamic import('@tauri-apps/api/event')
// which per-file vi.mock() cannot intercept.  This global mock
// ensures the dynamic import resolves to a stub rather than the
// real Tauri module (which calls transformCallback, undefined in
// jsdom, and throws "Cannot read properties of undefined").
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  once: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(() => Promise.resolve()),
  emitTo: vi.fn(() => Promise.resolve()),
}));

// ── Global mock: @/contexts/WorkspaceContext ──────────────────────
// Many component tests render screens that call `useWorkspace()`
// or `useWorkspaceScope()` without wrapping the tree in a real
// `<WorkspaceProvider>`. To avoid wrapping every test we keep the
// real exports (`WorkspaceProvider`, `WorkspaceContext`,
// `WorkspaceScopeContext`, `WorkspaceScope`, types) and override
// only the hooks to return a safe no-op default.
//
// Rationale for always returning the safe default from the hooks:
//   * Any value passed via `renderWithWorkspace({ workspace })` or
//     an explicit `<WorkspaceContext.Provider value=...>` is
//     ignored by hooks in this fallback. Tests that need custom
//     workspace values can override per-test via
//     `vi.mocked(useWorkspace).mockReturnValue(...)`.
//   * This keeps the mock robust against problems detected in the
//     React.useContext path (e.g. `React.useContext is not a
//     function` when `importOriginal('react')` returns a proxy
//     object without the real hooks).
//
// Tests that intentionally exercise the real provider
// (currently `WorkspaceContext.test.tsx`) opt out with
// `vi.unmock('@/contexts/WorkspaceContext')` at the top.
vi.mock('@/contexts/WorkspaceContext', async (importOriginal) => {
  const actual = await importOriginal<typeof WorkspaceContextModule>();

  const safeWorkspaceDefault = {
    activeWorkspace: null,
    setActiveWorkspace: vi.fn(),
    activeInstance: null,
    setActiveInstance: vi.fn(),
    availableWorkspaces: [],
    workspaceScreens: [],
    loading: false,
    error: null,
    retry: vi.fn(),
    lastWorkspace: null,
    switchStore: vi.fn(),
    resolvedStoreId: 'default',
    sessionToken: HARNESS_SESSION_TOKEN,
    swapSessionToken: vi.fn(() => Promise.resolve()),
  };

  // Non-null scope keeps components like KioskScreen and KdsScreen
  // (which dereference .storeId/.instanceId/.typeKey) safe under the
  // global stub — null would crash with a different NPE than the
  // provider error we are replacing. typeKey is intentionally
  // generic ('default') so components that branch on typeKey
  // (e.g. KdsScreen vs. RestaurantMenu routing) do not silently
  // render the wrong variant. Tests that need a specific typeKey
  // should use vi.mocked(useWorkspaceScope).mockReturnValue(...).
  const safeScopeDefault = {
    storeId: 'default',
    instanceId: 'default',
    typeKey: 'default',
  };

  return {
    ...actual,
    useWorkspace: vi.fn().mockImplementation(() => safeWorkspaceDefault),
    useWorkspaceScope: vi.fn().mockImplementation(() => safeScopeDefault),
  };
});

// ── Global mock: @/contexts/SubscriptionContext ─────────────────
// C2.2 tier gates read `useSubscription()`. The safe default renders
// every gate OPEN (`caps: null` + `state: 'active'`) so existing tests
// are unaffected — the neutral rendering default, not a policy claim;
// the §B fail-closed policy lives in the production context and command
// layer, and gate tests override per-test (e.g.
// `mockReturnValue({ …makeSubscriptionCaps(), state: 'grace' })`).
vi.mock('@/contexts/SubscriptionContext', async (importOriginal) => {
  const actual = await importOriginal<typeof SubscriptionContextModule>();
  const safeSubscriptionDefault = {
    caps: null,
    state: 'active',
    loading: false,
    refresh: vi.fn(),
  };
  return {
    ...actual,
    useSubscription: vi.fn().mockImplementation(() => safeSubscriptionDefault),
    useAdminGate: vi.fn().mockImplementation(() => ({ locked: false, state: 'active' })),
  };
});

// ── Global beforeEach: clean mocks and browser state ────────────
// Every test starts with a clean slate. Individual test files that
// need additional setup (e.g. mockImplementation overrides) add
// their own beforeEach after this global one runs.
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();

  // Reset theme-related DOM pollution that can leak between test files
  // in the same vitest worker (e.g. ThemeProvider leaves data-theme and
  // test-injected style tags behind). This prevents cross-file flakes.
  const html = document.documentElement;
  html.removeAttribute('data-theme');
  html.classList.remove('is-theme-transitioning');
  document.querySelectorAll('style#theme-test-styles').forEach((el) => el.remove());
});

// ── Global afterEach: remove rendered React trees ─────────────────
// Vitest does not auto-cleanup testing-library renders the way Jest
// does. Leaving portals/overlays mounted can pollute the DOM for the
// next test and cause order-dependent flakes.
//
// PERF-08: the catalog cache is module-level state — reset it between
// tests so a cached product/category snapshot never leaks. This must be
// a DYNAMIC import: a top-level import here would load `catalog-cache`
// (and its real `@/api/products` bindings) before test files' hoisted
// `vi.mock('@/api/products')` runs, so every test would silently bind to
// the real module instead of the file's mock.
afterEach(async () => {
  cleanup();
  const { invalidateCatalog } = await import('@/utils/catalog-cache');
  invalidateCatalog();
});

// ── PointerEvent polyfill ────────────────────────────────────────
// jsdom (even v24) does not implement PointerEvent, so fireEvent.pointer*
// would throw "PointerEvent is not defined". The topology editor's touch
// parity uses pointer events; this minimal polyfill (MouseEvent subclass
// carrying the pointer fields) lets component tests drive touch gestures.
if (typeof window !== 'undefined' && !window.PointerEvent) {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;
    width: number;
    height: number;
    pressure: number;
    tangentialPressure: number;
    tiltX: number;
    tiltY: number;
    twist: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? 'mouse';
      this.isPrimary = init.isPrimary ?? true;
      this.width = init.width ?? 1;
      this.height = init.height ?? 1;
      this.pressure = init.pressure ?? 0.5;
      this.tangentialPressure = init.tangentialPressure ?? 0;
      this.tiltX = init.tiltX ?? 0;
      this.tiltY = init.tiltY ?? 0;
      this.twist = init.twist ?? 0;
    }
  }
  // Expose the same name jsdom would use for the global constructor so
  // testing-library's createEvent resolves it via window.PointerEvent.
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

// matchMedia is not implemented in jsdom; Fluent uses it for
// responsive layouts. Stub it.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// ResizeObserver is not implemented/simulated in jsdom; stub it so virtualised grids render.
if (typeof window !== 'undefined') {
  window.ResizeObserver = class MockResizeObserver {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(element: HTMLElement) {
      this.callback(
        [
          {
            target: element,
            contentRect: {
              width: 1024,
              height: 768,
              top: 0,
              left: 0,
              bottom: 768,
              right: 1024,
              x: 0,
              y: 0,
              toJSON: () => {},
            },
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          },
        ],
        this
      );
    }
    unobserve() {}
    disconnect() {}
  };
}

// ── Suppress @fluent/react missing-key console errors ────────────
//
// Components may render <Localized id="…"> with dynamic action keys
// (e.g., audit log action labels, status badges) that aren't in
// every test's FluentBundle. The real app provides all keys via the
// joined .ftl bundles, but individual tests load only the subset
// they need.  Suppressing the console.error avoids noisy test
// output while still allowing tests that need specific translations
// to set up their own bundles via <LocalizationProvider>.
const originalError = console.error;
const originalWarn = console.warn;

console.error = (...args: unknown[]) => {
  const arg0 = args[0];
  const msg =
    typeof arg0 === 'string'
      ? arg0
      : arg0 && typeof arg0 === 'object' && 'message' in arg0
        ? String((arg0 as { message?: unknown }).message)
        : String(arg0 ?? '');
  if (msg.includes('[@fluent/react]') && msg.includes('did not match any messages')) {
    return;
  }
  if (msg.includes('was not wrapped in act') || msg.includes('flushSync was called from inside')) {
    return;
  }
  if (msg.includes('validateDOMNesting') || msg.includes('punycode module is deprecated')) {
    return;
  }
  originalError(...args);
};

console.warn = (...args: unknown[]) => {
  const arg0 = args[0];
  const msg =
    typeof arg0 === 'string'
      ? arg0
      : arg0 && typeof arg0 === 'object' && 'message' in arg0
        ? String((arg0 as { message?: unknown }).message)
        : String(arg0 ?? '');
  if (msg.includes('[@fluent/react]') && msg.includes('did not match any messages')) {
    return;
  }
  if (msg.includes('was not wrapped in act') || msg.includes('flushSync was called from inside')) {
    return;
  }
  if (msg.includes('validateDOMNesting') || msg.includes('punycode module is deprecated')) {
    return;
  }
  originalWarn(...args);
};

// ── Canvas mock ───────────────────────────────────────────────
// jsdom does not implement HTMLCanvasElement.prototype.getContext.
// Stub it so components that use canvas charts (CanvasPieChart,
// CanvasHeatmap, CanvasLineChart, NodeTopologyEditor) don't throw.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() => {
    // Return a minimal mock that chart/canvas code can call without
    // crashing. Individual tests that need real canvas behaviour
    // should override this mock.
    return null;
  }) as typeof HTMLCanvasElement.prototype.getContext;
}

// ── Unhandled rejection handler ────────────────────────────────────
//
// Replaces the old `dangerouslyIgnoreUnhandledErrors: true` in vite.config.ts
// which silently swallowed ALL unhandled promise rejections. This targeted
// handler filters known noise (Fluent missing keys, React act() warnings)
// while logging unknown rejections as warnings so they're visible in test
// output without failing the suite.
//
// If an unknown rejection appears, investigate the root cause — it may be
// a real bug in application code that the test doesn't properly catch.
process.on('unhandledRejection', (reason: unknown) => {
  const msg =
    reason instanceof Error
      ? reason.message
      : typeof reason === 'string'
        ? reason
        : String(reason ?? '');

  // Filter known noise patterns (same as console.error filter above).
  if (msg.includes('[@fluent/react]') && msg.includes('did not match any messages')) {
    return;
  }
  if (msg.includes('was not wrapped in act') || msg.includes('flushSync was called from inside')) {
    return;
  }
  if (msg.includes('validateDOMNesting') || msg.includes('punycode module is deprecated')) {
    return;
  }

  // Log everything else as a warning so it's visible but doesn't crash.
  console.warn('[test-setup] Unhandled promise rejection:', reason);
});
