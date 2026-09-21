import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for OZ-POS E2E tests.
 *
 * Tests run against the Vite dev server (port 1420) which serves the
 * React app with mocked Tauri IPC (`dev-mock/tauri-api.ts`).  No Rust
 * backend is needed for browser-based UI tests.
 *
 * API-level integration tests (api.spec.ts) target the cloud-server
 * running via Docker Compose (`ops/docker/docker-compose.e2e.yml`).
 *
 * Usage:
 *   # Start the Vite dev server first:
 *   cd ui && npm run dev
 *
 *   # In another terminal, run tests:
 *   cd ui && npx playwright test --config e2e/playwright.config.ts
 *
 *   # With the Playwright UI mode for debugging:
 *   cd ui && npx playwright test --config e2e/playwright.config.ts --ui
 *
 *   # Headed mode (watch the browser):
 *   cd ui && npx playwright test --config e2e/playwright.config.ts --headed
 */
export default defineConfig({
  // Look for test files in the e2e directory.
  testDir: '.',

  // Fail the build on CI if you leave test.only in the source code.
  forbidOnly: !!process.env['CI'],

  // Retry twice on CI to reduce flaky-test noise.
  retries: process.env['CI'] ? 2 : 0,

  // Run all tests in parallel (up to 4 workers).
  workers: process.env['CI'] ? 2 : 4,

  // Per-test timeout. loginAs() (helpers.ts) is a SEQUENTIAL chain of
  // condition-based waits that can consume up to 60s on a cold Vite dev
  // server (30s first render + 5s input + 10s PIN pad + 15s workspace
  // home), before a spec body runs a single step. The old local value
  // (30s) was SMALLER than the helper's own budget, so the test could be
  // killed mid-login — the inversion that produced the observed
  // "[tablet] sale.spec.ts:83 timed out in loginAs" flake, with
  // retries: 0 locally to hide it. One value for local and CI: 90s
  // dominates that 60s budget with 30s of headroom. This raises local
  // only; CI already ran 90s, so CI is unchanged (not narrowed).
  timeout: 90_000,

  // Reporters: list output in terminal, produce JSON + HTML on CI.
  // Paths are resolved against this config's directory (ui/e2e/), NOT the
  // CWD (ui/) — so they must step up one level to land in ui/e2e-results/,
  // which is what .gitignore, scripts/run-e2e.sh and the e2e-pr.yml
  // "Upload E2E test results" artifact path all point at. Without the ../
  // the artifact upload silently ships nothing (observed 2026-08-31).
  reporter: process.env['CI']
    ? [['list'], ['json', { outputFile: '../e2e-results/results.json' }], ['html', { outputFolder: '../e2e-results/html' }]]
    : [['list'], ['html', { open: 'never' }]],

  // Shared base URL — override with BASE_URL env var for custom dev ports.
  use: {
    baseURL: process.env['BASE_URL'] ?? 'http://localhost:1420',
    // Force English locale so tests can rely on English labels and
    // avoid failures when the dev environment/browser defaults to
    // another language (e.g. Indonesian).
    locale: 'en-US',
    // ADR #22 E2E-2: workspace-home animates continuously (bg-shift,
    // particle float), which makes Playwright's "element is stable"
    // actionability check time out on the workspace-card click. Emulating
    // reduced motion disables CSS animations/transitions at the browser
    // level — the standard fix for animation-induced E2E flakiness.
    reducedMotion: 'reduce',
    // Collect trace on first failure (screenshots + DOM snapshots).
    trace: 'retain-on-failure',
    // Capture screenshot on failure for debugging.
    screenshot: 'only-on-failure',
  },

  // Auto-start the Vite dev server (no more manual second terminal).
  // Reuse existing server if running (e.g. started by run-e2e.mjs runner or dev workflow).
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: true,
    timeout: 120_000,
    cwd: '..',
    // Hide the dev-mode DevToolbar overlay: it floats bottom-right at
    // tooltip z-index and would otherwise intercept clicks on POS action
    // buttons (App.tsx reads VITE_DEV_TOOLBAR to disable it).
    env: { ...process.env, VITE_DEV_TOOLBAR: '0' },
  },

  // Configure projects for desktop and tablet viewports.
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        // 1366×768 is a common POS terminal resolution.
        viewport: { width: 1366, height: 768 },
      },
    },
    {
      name: 'tablet',
      use: {
        ...devices['iPad Pro 11'],
        // 1024×1366 portrait — typical tablet POS orientation.
        viewport: { width: 1024, height: 1366 },
      },
    },
  ],
});
