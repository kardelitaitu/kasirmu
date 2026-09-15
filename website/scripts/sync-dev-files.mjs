#!/usr/bin/env node
/**
 * sync-dev-files.mjs
 *
 * Copies the repo-root dev/ folder into website/public/dev/ so the
 * design-language and KDS-prototype pages are included in the Astro
 * build output and served at https://kasir.mu/dev/.
 *
 * Run automatically via `prebuild` — no manual invocation needed.
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const srcDir = resolve(repoRoot, 'dev');
const destDir = resolve(__dirname, '..', 'public', 'dev');

if (!existsSync(srcDir)) {
  console.error(`[sync-dev-files] Source not found: ${srcDir}`);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });

cpSync(srcDir, destDir, {
  recursive: true,
  filter: (src) => {
    const rel = src.slice(srcDir.length + 1);
    return !rel.startsWith('node_modules') && !rel.startsWith('.git') && !rel.startsWith('dist');
  },
});

console.log(`[sync-dev-files] Synced dev/ → public/dev/`);
