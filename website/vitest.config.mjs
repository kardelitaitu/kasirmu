import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Website unit/regression tests. Node environment by default (SSR render
// tests, pure logic); storage/browser-dependent tests opt into jsdom with a
// `// @vitest-environment jsdom` pragma.
//
// These are the regression net for the SSR-flash bug class: tests render the
// auth forms server-side and assert the "not configured" fallback can never
// appear in the first paint HTML (see src/components/__tests__/ssr-flash).
//
// The react() plugin is required because astro/tsconfigs/strict sets
// `jsx: preserve`, which Vite's import analysis refuses to transform on its
// own (same plugin ui/ uses for its .tsx tests).
//
// Thread pool: on the 7950X (32 logical cores) we use up to 24 workers so
// the OS + IDE keep 8 threads headroom. vitest's default is ceil(cpus/2)
// which on 32 cores = 16. Bumping to 24 shaves ~30% off the 623-test run.
//
// `testTimeout` is 20s, not vitest's 5s default, because 24 workers is more
// than this machine can always feed: the heaviest suites (account-view,
// signup-form, password-strength, ssr-flash, account-bundle — each rendering a
// whole island and awaiting its mocked fetches) starve and time out as a GROUP
// when another process is competing for cores. Measured 2026-09-23 on a working
// tree, running the real `npm run prebuild`: two runs in four failed the build
// with "Test timed out in 5000ms" — 70 and 18 failures, whole files at once,
// the same files passing in ~1s when run alone. A genuine hang still fails, just
// slower; raising this is the honest fix while the worker count stays tuned for
// speed. Lower VITEST_MAX_THREADS if the whole-file starvation comes back.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    pool: 'threads',
    maxThreads: parseInt(process.env.VITEST_MAX_THREADS ?? '24', 10),
    minThreads: parseInt(process.env.VITEST_MIN_THREADS ?? '4', 10),
    testTimeout: 20_000,
  },
});
