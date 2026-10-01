#!/usr/bin/env node
/**
 * scripts/clean-build-cache.mjs — drop the caches a build reuses.
 *
 * WHY THIS EXISTS. The content layer caches RENDERED entries in `.astro/` and the
 * built site in `dist/`. Both persist between runs, so after changing a markdown
 * plugin, an Astro config key, or a content file, `npm run build` can reuse the old
 * output and the change appears to do nothing.
 *
 * That is not a tidiness problem, it is an EVIDENCE problem, and it cost two rounds:
 * a plugin reported as inert was working, and a plugin made deliberately inert
 * reported as working. A measurement taken over a warm cache is not a measurement of
 * the current tree, and the failure is silent in both directions.
 *
 * Use `npm run build:clean` whenever the thing you are testing is the build itself --
 * a markdown/remark/rehype change, a config change, anything whose effect is only
 * visible in `dist/`. Ordinary iteration should keep the warm cache.
 *
 * Deletes only these two directories, only under `website/`, resolved from this file
 * so it cannot be run against a path assembled from the working directory.
 */

import { rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targets = ['.astro', 'dist'];

for (const name of targets) {
  const target = join(websiteRoot, name);
  if (!target.startsWith(websiteRoot)) {
    throw new Error(`refusing to remove ${target}: outside the website root`);
  }
  if (!existsSync(target)) {
    console.log(`clean: ${name} absent, nothing to remove`);
    continue;
  }
  rmSync(target, { recursive: true, force: true });
  console.log(`clean: removed ${name}`);
}
