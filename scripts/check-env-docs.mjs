#!/usr/bin/env node
/**
 * scripts/check-env-docs.mjs — every OZ_* variable the services READ is documented.
 *
 * Why this exists: adding a capability usually adds an environment variable, and the variable is
 * the part nobody notices is missing until a deployment half-works. That happened once — the
 * sync-service address shipped before anything named it — and the fix is a check rather than a
 * resolution to remember.
 *
 * Rules:
 *   - Reads are `os.Getenv("OZ_*")` (Go) and `env::var("OZ_*")` (Rust).
 *   - Test scaffolding does not count as configuration: `*_test.go`, `*_tests.rs` and anything
 *     under a `tests/` directory are skipped, so a child-probe knob never forces an entry into
 *     the deployment file.
 *   - A name is documented when it appears in `.env.example` (the canonical deployment list),
 *     `apps/license-server/DEPLOY.md`, or `docs/operations/runbook.md`.
 *
 * Exit 0 when everything is documented; 1 with the offenders and their read sites otherwise.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = ['.env.example', 'apps/license-server/DEPLOY.md', 'docs/operations/runbook.md'];
const SKIP_DIRS = new Set(['node_modules', 'target', 'dist', 'dist-mobile', '.git', 'gen']);

/** Every source file that can read configuration, with test scaffolding excluded. */
function walk(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name === 'tests') continue;
      walk(join(dir, entry.name), found);
    } else if (/\.rs$/.test(entry.name) && !/_tests\.rs$/.test(entry.name)) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

const reads = new Map();
function record(name, site) {
  if (!reads.has(name)) reads.set(name, []);
  reads.get(name).push(site);
}

// Rust: crates + app shells.
for (const base of ['crates', 'apps']) {
  for (const file of walk(join(root, base))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/env::var\("(OZ_[A-Z0-9_]+)"\)/g)) {
      record(m[1], file.slice(root.length + 1));
    }
  }
}

// Go: the licence server only (the other Go trees are scripts).
for (const file of walk(join(root, 'apps', 'license-server'))) {
  if (!/\.go$/.test(file) || /_test\.go$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/os\.Getenv\("(OZ_[A-Z0-9_]+)"\)/g)) {
    record(m[1], file.slice(root.length + 1));
  }
}

const documented = new Set();
for (const doc of DOCS) {
  let text = '';
  try {
    text = readFileSync(join(root, doc), 'utf8');
  } catch {
    console.error(`env-docs: cannot read ${doc}`);
    process.exit(2);
  }
  for (const m of text.matchAll(/OZ_[A-Z0-9_]+/g)) documented.add(m[0]);
}

const missing = [...reads.keys()].filter((name) => !documented.has(name)).sort();

if (missing.length === 0) {
  console.log(`env-docs: OK — ${reads.size} OZ_* variable(s) read, all documented`);
  process.exit(0);
}

console.error(`env-docs: ${missing.length} OZ_* variable(s) are read but undocumented`);
console.error(`  documented surfaces: ${DOCS.join(', ')}`);
for (const name of missing) {
  const sites = [...new Set(reads.get(name))].slice(0, 3).join(', ');
  console.error(`  - ${name}  (read in ${sites})`);
}
console.error(
  'Add each to .env.example (or the deploy/runbook docs) with the failure it prevents, or the',
);
console.error('deployment that needs it will half-work with no clue why.');
process.exit(1);
