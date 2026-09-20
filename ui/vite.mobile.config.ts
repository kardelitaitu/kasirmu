/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Tauri expects a fixed port; fail if it isn't available.
const host = process.env.TAURI_DEV_HOST;

/**
 * Serve this build's entry at `/`, and emit an `index.html` alias for it.
 *
 * Tauri's webview loads the app **root**, and its asset resolver maps that to
 * `index.html`. This build's entry is `index.mobile.html`, so nothing existed
 * at `/` and the installed Android app opened to a blank screen.
 *
 * Measured 2026-09-19 against the dev server: `GET /` returned **200 with 0
 * bytes** while `GET /index.mobile.html` returned the page. `dist-mobile/`
 * likewise contained only `index.mobile.html`.
 *
 * `scripts/check-bundle.mjs` already accepts either basename, preferring
 * `index.html`, so emitting the alias does not disturb the bundle budget gate.
 */
function mobileEntryAtRoot(): Plugin {
  return {
    name: 'kasirmu-mobile-entry-at-root',
    // `vite:build-html` emits the HTML asset from its own generateBundle, which
    // runs after normal user plugins. Without this the bundle has no
    // `index.mobile.html` yet and the alias is silently never emitted.
    enforce: 'post',
    configureServer(server) {
      // Runs before Vite's internal middlewares, so this wins over the
      // html-fallback middleware that would otherwise look for index.html.
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/' || req.url === '/index.html') {
          req.url = '/index.mobile.html';
        }
        next();
      });
    },
    generateBundle(_options, bundle) {
      const entry = bundle['index.mobile.html'];
      if (entry && entry.type === 'asset') {
        this.emitFile({ type: 'asset', fileName: 'index.html', source: entry.source });
      }
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [react(), mobileEntryAtRoot()],

  resolve: {
    // P9a: the Fluent corpus lives at shared-ui/locales/, outside ui/.
    //
    // This MUST be the array + regex form, not the object shorthand. With the
    // object form a string key is tested as `importee.startsWith(key + '/')`, so
    // the key '@/locales/' becomes '@/locales//' and never matches anything; the
    // generic '@' entry then swallows '@/locales/…' and every `?raw` import
    // resolves to ./src/locales/…, which does not exist. Measured 2026-09-19:
    // `vite build --config vite.mobile.config.ts` died with
    // "Could not load …/ui/src/locales/shared.ftl?raw". vite.config.ts uses the
    // same two entries in this form — keep them in step.
    alias: [
      // The Tauri API mocks are DEV-SERVER-ONLY, exactly as in vite.config.ts — they let the
      // tablet shell be previewed and driven in a plain browser with no Rust backend, and they
      // must never reach a build (a packaged APK resolving the mock would run on fake data).
      //
      // This config carried NEITHER entry until 2026-09-20: `npm run dev:mobile` therefore served
      // a shell whose every invoke() hit the real `@tauri-apps/api/core`, where a plain browser
      // has no `__TAURI_INTERNALS__`, so each call threw
      // "Cannot read properties of undefined (reading 'invoke')" and the app's retry loop
      // re-issued it forever. The wizard rendered; nothing behind it ever answered. Keep these
      // two entries in step with vite.config.ts.
      ...(command === 'serve'
        ? [
            {
              find: /^@tauri-apps\/api\/core$/,
              replacement: `${fileURLToPath(new URL('./src/dev-mock/tauri-api.ts', import.meta.url))}`,
            },
            {
              find: /^@tauri-apps\/api\/event$/,
              replacement: `${fileURLToPath(new URL('./src/dev-mock/tauri-event.ts', import.meta.url))}`,
            },
          ]
        : []),
      {
        find: /^@\/locales\//,
        replacement: fileURLToPath(new URL('../shared-ui/locales/', import.meta.url)),
      },
      {
        find: /^@\//,
        replacement: fileURLToPath(new URL('./src/', import.meta.url)),
      },
    ],
  },

  // Vite options tailored for Tauri development.
  clearScreen: false,

  // Use the tablet entry point.
  build: {
    outDir: 'dist-mobile',
    rollupOptions: {
      input: fileURLToPath(new URL('./index.mobile.html', import.meta.url)),
      output: {
        // PERF-05: isolate vendor libraries so they cache independently
        // of app code and stay out of the tablet entry bundle.
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-fluent': ['@fluent/bundle', '@fluent/react'],
          'vendor-charts': ['recharts'],
          'vendor-search': ['fuse.js'],
          'vendor-window': ['react-window'],
        },
      },
    },
  },

  server: {
    port: 1422,
    strictPort: true,
    // P9a: same reason as vite.config.ts — the corpus is outside this package.
    fs: {
      allow: [
        fileURLToPath(new URL('.', import.meta.url)),
        fileURLToPath(new URL('../shared-ui', import.meta.url)),
      ],
    },
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 1423 }
      : undefined,
    watch: {
      ignored: ['**/apps/**'],
    },
  },
}));
