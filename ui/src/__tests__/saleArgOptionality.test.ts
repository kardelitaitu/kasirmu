// ── A TS field must match the RUST STRUCT IT ACTUALLY MAPS TO ───────────
//
// Round 57 fixed three genuinely-optional TS fields on `SaleDetail` and, in the same
// pass, made `CompleteSaleArgs.tipMinor` REQUIRED — citing `history.rs:194-199`.
//
// Those line numbers are real: `SaleDetail` does carry a bare `i64` there. But
// `CompleteSaleArgs` maps to a DIFFERENT struct, `pos/checkout.rs:46`, where
// `tip_minor` is `Option<i64>` (:73). Two structs, the same field name, opposite
// contracts — and a comment citing the wrong one is exactly how the error survived
// review.
//
// The lesson is about the guard, not just the fix: "the Rust side" is not one thing.
// A check that greps the bridge for a field name will find SOME declaration of it and
// pass, whichever struct it came from. So this file resolves each TS interface to its
// own Rust struct BY NAME and reads the field only there.
//
// The three structs below are the ones the POS checkout path touches. Each row pairs
// a TS interface with the Rust struct it is the wire shape of.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(__dirname, '../../..');
const TS = readFileSync(resolve(REPO, 'ui/src/api/sales.ts'), 'utf-8');
const HISTORY = readFileSync(resolve(REPO, 'crates/kasirmu-bridge/src/history.rs'), 'utf-8');
const CHECKOUT = readFileSync(resolve(REPO, 'crates/kasirmu-bridge/src/pos/checkout.rs'), 'utf-8');

/** The body of a Rust struct, from its header to the matching close brace. */
function rustStruct(src: string, name: string): string {
  const at = src.indexOf('pub struct ' + name);
  expect(at, 'no Rust struct ' + name + ' — repoint this guard').toBeGreaterThan(-1);
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  throw new Error('unbalanced braces in ' + name);
}

/** The body of a TS interface. */
function tsInterface(name: string): string {
  const m = TS.match(new RegExp('export interface ' + name + ' \\{[\\s\\S]*?\\n\\}'));
  expect(m, 'no TS interface ' + name + ' — repoint this guard').not.toBeNull();
  return m![0];
}

/**
 * [TS interface, Rust struct, its source, field pairs].
 *
 * The pairs are the fields whose nullability has actually been got wrong at least
 * once. A row is added when a mistake teaches it, so every row is load-bearing.
 */
const CONTRACTS: Array<{
  ts: string;
  rust: string;
  src: string;
  fields: Array<[rustField: string, tsField: string]>;
}> = [
  {
    ts: 'SaleDetail',
    rust: 'SaleDetail',
    src: HISTORY,
    // Bare i64 with #[serde(default)]: always present, so required in TS.
    fields: [
      ['tip_minor', 'tipMinor'],
      ['service_charge_minor', 'serviceChargeMinor'],
      ['discount_percent', 'discountPercent'],
    ],
  },
  {
    ts: 'CompleteSaleArgs',
    rust: 'CompleteSaleArgs',
    src: CHECKOUT,
    // Option<i64>: genuinely nullable, so optional AND | null in TS.
    fields: [
      ['tip_minor', 'tipMinor'],
      ['service_charge_minor', 'serviceChargeMinor'],
    ],
  },
  {
    ts: 'CompleteSaleWithResolvedShortfallsArgs',
    rust: 'CompleteSaleWithResolvedShortfallsArgs',
    src: CHECKOUT,
    fields: [
      ['tip_minor', 'tipMinor'],
      ['service_charge_minor', 'serviceChargeMinor'],
    ],
  },
];

describe('each TS field matches the Rust struct it maps to', () => {
  it('every contract row resolves on both sides', () => {
    // Non-vacuity: a renamed struct or field must fail here rather than let the
    // per-field cases below pass against nothing.
    for (const row of CONTRACTS) {
      const rust = rustStruct(row.src, row.rust);
      const ts = tsInterface(row.ts);
      for (const [rf, tf] of row.fields) {
        expect(rust, row.rust + ' lost ' + rf).toMatch(new RegExp('pub ' + rf + ':'));
        expect(ts, row.ts + ' lost ' + tf).toMatch(new RegExp(tf + '\\??:'));
      }
    }
  });

  it.each(CONTRACTS.flatMap((row) => row.fields.map((f) => [row.ts, row.rust, row.src, f[0], f[1]] as const)))(
    '%s.%s matches %s.%s',
    (tsName, rustName, src, rustField, tsField) => {
      const rust = rustStruct(src, rustName);
      const ts = tsInterface(tsName);
      const rustDecl = rust.match(new RegExp('pub ' + rustField + ': ([^,\\n]+)'))![1]!;
      const tsDecl = ts.match(new RegExp('\\b' + tsField + '(\\??): ([^;\\n]+)'))!;
      const rustOptional = /Option</.test(rustDecl);
      const tsOptional = tsDecl[1] === '?';
      const tsNullable = /null/.test(tsDecl[2]!);

      expect(
        tsOptional,
        tsName + '.' + tsField + ' is ' + (tsOptional ? 'optional' : 'required') + ' but ' +
          rustName + '.' + rustField + ' is ' + rustDecl.trim() + '. An inaccurate optional ' +
          'hides a real distinction; an inaccurate required makes the null case unrepresentable.',
      ).toBe(rustOptional);

      // An Option means BOTH an absent key and an explicit null are accepted, so the
      // TS side must admit null too — '?' alone leaves the second case unspellable.
      if (rustOptional) {
        expect(
          tsNullable,
          tsName + '.' + tsField + ' must include "| null": ' + rustName + '.' + rustField +
            ' is an Option, so the wire accepts an explicit null as well as an absent key.',
        ).toBe(true);
      }
    },
  );
});
