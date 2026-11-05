#!/usr/bin/env node
/**
 * scripts/__tests__/generate-ownership-map.test.mjs
 *
 * Tests the REFUSALS and the FORMATTING of scripts/generate-ownership-map.mjs.
 *
 * Two claims this module makes and nothing used to check:
 *
 *  1. "modules/ownership.json must not name a table twice." Until 2026-11-06 no
 *     case proved that branch could fail, so deleting it would have kept every
 *     gate green until two modules actually claimed a table -- the state the
 *     check exists to prevent. Each refusal is asserted here by its message.
 *  2. Two rustfmt (edition 2024) thresholds decide how a tuple renders: the
 *     slice literal expands at 56 chars, the slice then one-table-per-line when
 *     its indented line reaches 74. Those numbers are measured, not obvious, and
 *     a drift of one either way makes the generated file fail `cargo fmt
 *     --check`. The three shapes are pinned at their boundaries.
 *
 * The committed map itself is already graded by `--check` in scripts/check.sh;
 * the last case runs that same command so the refactor that made this file
 * importable is proven not to have changed the live answer.
 *
 * Run:  node --test scripts/__tests__/generate-ownership-map.test.mjs
 *   Or: npm run test:scripts   (from ui/)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSource, render } from '../generate-ownership-map.mjs';

const SCRIPT = join(dirname(dirname(fileURLToPath(import.meta.url))), 'generate-ownership-map.mjs');
// Newlines are built, never typed: an escape inside a regex literal is exactly
// the kind of invisible detail this file is pinning, and it bit once already.
const NL = String.fromCharCode(10);

/** Write a temp ownership.json and parse it, returning the entries or the error. */
function parseJson(body) {
  const root = mkdtempSync(join(tmpdir(), 'ownership-'));
  try {
    const p = join(root, 'ownership.json');
    writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body));
    try {
      return { entries: parseSource(p) };
    } catch (e) {
      return { error: e.message };
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('parseSource() — refusals that keep the single source trustworthy', () => {
  it('accepts a valid source and keeps JSON order', () => {
    const { entries, error } = parseJson({ owners: { reporting: [], sales: ['sales', 'sale_lines'] } });
    assert.strictEqual(error, undefined);
    assert.deepStrictEqual(entries, [['reporting', []], ['sales', ['sales', 'sale_lines']]]);
  });

  it('refuses one table claimed by two modules, naming both', () => {
    const { error } = parseJson({ owners: { sales: ['sales'], sync: ['sales'] } });
    assert.match(error, /table sales is claimed by both sales and sync/);
  });

  it('refuses an empty owners map', () => {
    assert.match(parseJson({ owners: {} }).error, /owners must not be empty/);
  });

  it('refuses a source with no owners object', () => {
    assert.match(parseJson({ nope: true }).error, /must have an owners object/);
  });

  it('refuses an invalid module id', () => {
    assert.match(parseJson({ owners: { 'Sales-Core': [] } }).error, /invalid module id/);
  });

  it('refuses an invalid table name', () => {
    assert.match(parseJson({ owners: { sales: ['sales lines'] } }).error, /invalid table name/);
  });

  it('refuses a module that does not map to an array', () => {
    assert.match(parseJson({ owners: { sales: 'sales' } }).error, /must map to an array/);
  });
});

describe('render() — the two rustfmt thresholds', () => {
  const blockFor = (tables) => render([['m', tables]]);
  const has = (text, fragment) => assert.ok(text.includes(fragment), 'expected fragment:' + NL + fragment + NL + 'in:' + NL + text);

  it('keeps a slice of 55 chars on one line', () => {
    // 3 names of 14: two quotes + 14 = 16 each, 2 joins of ', ' = 4, brackets 3 -> 55.
    const names = ['aaaaaaaaaaaaaa', 'bbbbbbbbbbbbbb', 'cccccccccccccc'];
    has(blockFor(names), '    ("m", &[' + names.map((n) => '"' + n + '"').join(', ') + ']),');
  });

  it('flips at exactly 56 chars — the boundary itself, not a value near it', () => {
    // 14 + 14 + 15 names -> slice is exactly 56, so '< 56' must be false.
    const names = ['a'.repeat(14), 'b'.repeat(14), 'c'.repeat(15)];
    const expected = ['    (', '        "m",', '        &[' + names.map((n) => '"' + n + '"').join(', ') + '],', '    ),'].join(NL);
    has(blockFor(names), expected);
  });

  it('expands the tuple at 56 chars, keeping the slice on one line while it fits', () => {
    // 3 names of 17 -> slice 64 chars, indented slice line 73 (< 74) -> expanded tuple.
    const names = ['a'.repeat(17), 'b'.repeat(17), 'c'.repeat(17)];
    const expected = ['    (', '        "m",', '        &[' + names.map((n) => '"' + n + '"').join(', ') + '],', '    ),'].join(NL);
    has(blockFor(names), expected);
  });

  it('puts one table per line when the indented slice line reaches 74', () => {
    // 4 names of 14 -> slice 73 chars, indented slice line 82 (>= 74).
    const names = ['a'.repeat(14), 'b'.repeat(14), 'c'.repeat(14), 'd'.repeat(14)];
    const expected = ['    (', '        "m",', '        &[', ...names.map((n) => '            "' + n + '",'), '        ],', '    ),'].join(NL);
    has(blockFor(names), expected);
  });

  it('flips at exactly 74 for the indented slice line, one char before it does not', () => {
    // 17 + 17 + 18 -> slice 65, indented line 8 + 65 + 1 = 74, so '< 74' must be false.
    const over = ['a'.repeat(17), 'b'.repeat(17), 'c'.repeat(18)];
    const expected = ['    (', '        "m",', '        &[',
      ...over.map((n) => '            "' + n + '",'), '        ],', '    ),'].join(NL);
    has(blockFor(over), expected);
    // One char shorter lands on 73 and keeps the slice on a single line.
    const under = ['a'.repeat(17), 'b'.repeat(16), 'c'.repeat(18)];
    const flat = ['    (', '        "m",', '        &[' + under.map((n) => '"' + n + '"').join(', ') + '],', '    ),'].join(NL);
    has(blockFor(under), flat);
  });

  it('always emits owner_of() and the tests module, so the file compiles as a whole', () => {
    const text = blockFor(['sales']);
    has(text, 'pub const TABLE_OWNERS: &[(&str, &[&str])] = &[');
    has(text, 'pub fn owner_of(table: &str) -> Option<&' + "'" + 'static str> {');
    has(text, '#[path = "ownership_tests.rs"]');
    has(text, '];' + NL);
  });
});

describe('the live generator', () => {
  it('--check still agrees with the committed map (exit 0)', () => {
    const res = spawnSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, (res.stdout || '') + (res.stderr || ''));
    assert.match(res.stdout || '', /matches modules\/ownership\.json/);
  });
});
