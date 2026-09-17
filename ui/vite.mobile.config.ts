/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Tauri expects a fixed port; fail if it isn't available.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      // P9a: the Fluent corpus lives at shared-ui/locales/, outside ui/. This entry
      // MUST precede the generic '@' one below, which prefix-matches every `@/…`
      // specifier and would otherwise resolve `@/locales/…` to ./src/locales/.
      '@/locales/': fileURLToPath(new URL('../shared-ui/locales/', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
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
});
