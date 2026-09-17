/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Tauri expects a fixed port; fail if it isn't available.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(({ command }) => ({
  plugins: [react()],

  resolve: {
    // Use the explicit regex form for the `@/` alias (instead of the
    // shorthand `'@': path`). The shorthand is honored by Vite's
    // dev/build resolver but NOT by Vitest 1.6.x's pool-worker
    // resolver — imports like `@/components/Badge` fall through to
    // Node's ESM resolver and fail with `Cannot find package`.
    // Trailing slashes on both `./src/` and `replacement` keep the
    // path join clean (`…/foo`, never `…/srccomponents/foo`).
    //
    // The Tauri API mocks are DEV-SERVER-ONLY: they let the app be
    // previewed in a plain browser (and drive E2E) without the Rust
    // backend. They must never be bundled into production builds —
    // `vite build` (packaged app) resolves the real @tauri-apps/api
    // packages, otherwise the shipped app silently runs on mock data.
    // Inside a real Tauri webview (packaged app or `tauri dev`) the
    // mock itself delegates to window.__TAURI_INTERNALS__, so the dev
    // server still talks to the real backend when one is present.
    alias: [
      ...(command === 'serve'
        ? [
            {
              find: /^@tauri-apps\/api\/core$/,
              replacement: `${fileURLToPath(new URL('./src/dev-mock/tauri-api.ts', import.meta.url))}`,
            },
            {
              // Dev event bridge — the real @tauri-apps/api/event module needs
              // window.__TAURI_INTERNALS__ (undefined in a plain browser) and
              // crashes the KDS screen's kds:orders-changed listener. The mock
              // provides in-memory pub/sub so E2E dev flows work end to end.
              find: /^@tauri-apps\/api\/event$/,
              replacement: `${fileURLToPath(new URL('./src/dev-mock/tauri-event.ts', import.meta.url))}`,
            },
          ]
        : []),
      // P9a: the Fluent corpus no longer lives under ui/. It is plain data that any
      // toolkit can consume (Fluent ships Rust bindings too), so it sits at
      // shared-ui/locales/ beside the repo root. This entry MUST precede the generic
      // `@/` rule below — Vite/rollup take the first matching alias, so `@/locales/…`
      // would otherwise resolve to ./src/locales/ and every one of the 165 `?raw`
      // imports would fail to resolve.
      {
        find: /^@\/locales\//,
        replacement: `${fileURLToPath(new URL('../shared-ui/locales/', import.meta.url))}`,
      },
      {
        find: /^@\//,
        replacement: `${fileURLToPath(new URL('./src/', import.meta.url))}/`,
      },
    ],
  },

  // Vite options tailored for Tauri development.
  clearScreen: false,

  // ── Build: vendor chunking + code-splitting (PERF-05) ─────────────
  // Lazy-loaded routes (PERF-01) already split feature screens into
  // per-route chunks. manualChunks additionally isolates the heavy
  // vendor libraries so their long-lived cache stays stable and the
  // entry bundle stays small.
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-fluent': ['@fluent/bundle', '@fluent/react'],
          'vendor-charts': ['recharts'],
          'vendor-search': ['fuse.js'],
          'vendor-window': ['react-window'],
        },
      },
    },
    // The recharts vendor chunk legitimately exceeds Vite's default 500 kB
    // raw threshold; real enforcement lives in scripts/check-bundle.mjs
    // (PERF-02), which measures gzip against explicit budgets.
    chunkSizeWarningLimit: 600,
  },

  server: {
    port: 1420,
    strictPort: true,
    // P9a: the Fluent corpus sits at shared-ui/locales/, OUTSIDE this package, so the
    // dev server and Vitest both refuse to serve it ("Denied ID …/shared.ftl?raw")
    // unless it is allowed here. Naming an entry REPLACES Vite's default (the
    // workspace root), so the package root is listed too.
    fs: {
      allow: [
        fileURLToPath(new URL('.', import.meta.url)),
        fileURLToPath(new URL('../shared-ui', import.meta.url)),
      ],
    },
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 1421 }
      : undefined,
    watch: {
      // Tell vite to ignore watching `apps/` so the Rust change
      // watcher doesn't trigger a Vite reload.
      ignored: ['**/apps/**'],
    },
  },

  test: {
    // ── Pool ─────────────────────────────────────────────────────────────
    // worker_threads instead of child_process forks: lower process overhead,
    // better CPU utilization on high-core-count machines (32-thread host).
    // maxConcurrency controls parallel tests per-worker, helping files with
    // many tests (DataManagementScreen: 55) finish faster.
    pool: 'threads',
    fileParallelism: true,

    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    css: false,

    // Exclude Playwright e2e tests (run via `npm run test:e2e`) and
    // node_modules package tests picked up by the broad glob.
    exclude: ['e2e/**', 'node_modules/**'],

    // Per-test timeout (ms). Default 5000 is fine for most tests;
    // DataManagementScreen (55 tests, ~225ms each) is the heaviest
    // file and stays well within this budget. Bumped to 10s for CI
    // headroom on slow runners.
    testTimeout: 10_000,

    // Per-hook timeout (ms) for beforeEach / afterEach. Default 5000
    // is generous — no test file has hooks that take longer.
    hookTimeout: 5_000,

    // ── Coverage ────────────────────────────────────────────────────────
    //
    // Run with `npm run test:coverage` (or `vitest run --coverage`).
    // Uses the v8 provider (native to Node; faster than istanbul).
    // HTML + JSON reports land in `../coverage/ui/` so they sit beside
    // the Rust coverage report produced by `scripts/coverage.{sh,ps1}`.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json', 'json-summary', 'lcov'],
      reportsDirectory: '../coverage/ui',
      // Only count source files — never the test code itself.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        '**/node_modules/**',
        '**/*.test.{ts,tsx}',
        '**/__tests__/**',
        '**/test-setup.ts',
        '**/i18n/test-utils.tsx',
        // Type-only modules (Fluent locale bundles are just strings). Path-agnostic,
        // so it kept matching after P9a moved the corpus to shared-ui/locales/.
        '**/locales/**',
      ],
    },
  },
}));
