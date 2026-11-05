#!/usr/bin/env node
/**
 * scripts/__tests__/generate-records-index.test.mjs
 *
 * Pins the records-index DRIFT REPORT, not the index itself.
 *
 * RI-2 in docs/records/findings/audit-open-findings.md: `--check` compared the
 * committed file to the generated one by POSITION, so inserting one row near the
 * top of a sorted table shifted every line after it and the report claimed
 * hundreds of differing lines. Measured on the real index with one row inserted:
 * the old comparison reported 676 differing lines, the content comparison below
 * reports 1 and names it. Exit code alone never told a reader which row moved,
 * and the first ten "shown" pairs were consecutive noise.
 *
 * Driven through KASIRMU_RECORDS_ROOT against a throwaway tree — the live
 * generator, never a copy of its logic (house precedent:
 * scripts/test-records-index-escaping.sh).
 *
 * Run:  node --test scripts/__tests__/generate-records-index.test.mjs
 *   Or: npm run test:scripts   (from ui/)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const GENERATOR = join(dirname(dirname(fileURLToPath(import.meta.url))), 'generate-records-index.mjs');

/** A minimal but real docs tree: one ADR plus one record. */
function makeTree() {
  const root = mkdtempSync(join(tmpdir(), 'records-index-'));
  for (const d of ['docs/records', 'docs/decisions', 'docs/observability', 'docs/audits']) {
    mkdirSync(join(root, d), { recursive: true });
  }
  writeFileSync(join(root, 'docs/decisions/2026-01-01-adr99-probe.md'), [
    '---', 'num: 99', 'title: "Probe ADR"', 'status: Accepted', 'area: sync', '---', '',
    '# Probe', '',
  ].join('\n'));
  writeFileSync(join(root, 'docs/records/probe-record.md'), [
    '---', 'title: "Probe Record"', 'status: Current', 'area: sync', '---', '', '# Probe', '',
  ].join('\n'));
  return root;
}

/** Run the generator against a tree; returns {status, output}. */
function runGenerator(root, args) {
  const res = spawnSync(process.execPath, [GENERATOR, ...args], {
    encoding: 'utf8',
    env: { ...process.env, KASIRMU_RECORDS_ROOT: root },
  });
  return { status: res.status, output: (res.stdout || '') + (res.stderr || '') };
}

describe('generate-records-index --check drift report', () => {
  it('a freshly generated index checks clean, exit 0', () => {
    const root = makeTree();
    try {
      assert.strictEqual(runGenerator(root, []).status, 0, 'write mode should succeed');
      const check = runGenerator(root, ['--check']);
      assert.strictEqual(check.status, 0, check.output);
      assert.match(check.output, /matches the generator/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('one inserted row is reported as ONE differing line, with its line number', () => {
    // The RI-2 scenario: insert near the top of a table, so a position-based
    // comparison would flag every following line.
    const root = makeTree();
    try {
      assert.strictEqual(runGenerator(root, []).status, 0);
      const readme = join(root, 'docs/records/README.md');
      const before = readFileSync(readme, 'utf8').split('\n');
      const at = before.findIndex((l) => l.startsWith('| '));
      assert.ok(at > 0, 'expected a markdown table in the generated index far enough down to shift lines');
      const inserted = [...before.slice(0, at), '| **Tampered** | [probe](./audit-open-findings.md) | Open |', ...before.slice(at)];
      writeFileSync(readme, inserted.join('\n'));

      const check = runGenerator(root, ['--check']);
      assert.strictEqual(check.status, 1, check.output);
      assert.match(check.output, /1 differing lines/, 'the count must be the number of rows that actually differ');
      assert.match(check.output, /first difference at line \d+/);
      // The extra row exists only in the COMMITTED file, so it is a removal:
      // '-' lines are committed lines the generator no longer produces,
      // '+' lines are generated lines the committed file is missing.
      assert.match(check.output, /- \| \*\*Tampered\*\*/);
      assert.doesNotMatch(check.output, /\d{3} differing lines/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('a single edited line is reported as one remove plus its replacement', () => {
    const root = makeTree();
    try {
      assert.strictEqual(runGenerator(root, []).status, 0);
      const readme = join(root, 'docs/records/README.md');
      const text = readFileSync(readme, 'utf8');
      writeFileSync(readme, text.replace('Probe Record', 'Tampered Record'));

      const check = runGenerator(root, ['--check']);
      assert.strictEqual(check.status, 1, check.output);
      assert.match(check.output, /2 differing lines/, 'one removed + one added = two lines that differ');
      // The edit was made to the COMMITTED file: the tampered text is what the
      // committed side carries (removed), the generator's text is restored (+).
      assert.match(check.output, /- .*Tampered Record/);
      assert.match(check.output, /\+ .*Probe Record/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
