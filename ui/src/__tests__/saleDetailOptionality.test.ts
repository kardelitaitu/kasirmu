// ── The sale-detail DTO's non-optional numbers ──────────────────────────
//
// `crates/kasirmu-bridge/src/history.rs:188-199` declares three fields as
// NON-optional with `#[serde(default)]`:
//
//     pub discount_percent: i64        // "0 means no discount"
//     pub tip_minor: i64               // "(default 0)"
//     pub service_charge_minor: i64    // "(default 0)"
//
// `#[serde(default)]` means the JSON ALWAYS carries them — an absent key deserialises
// to 0 on the way in, and the serialiser emits the field on the way out. There is no
// wire state in which they are missing.
//
// The TypeScript type said `discountPercent?: number` / `tipMinor?: number` /
// `serviceChargeMinor?: number`, which is why the UI grew `?? 0` guards and `!`
// assertions around values that cannot be absent. An inaccurate optional invites
// exactly that defensiveness, and it hides a real difference the other way: a value of
// 0 and a value that never arrived read the same.
//
// These cases pin the TYPE, so a future change to the Rust field is caught here rather
// than at a call site that assumed the wrong shape.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(__dirname, '../../..');
const RUST = readFileSync(resolve(REPO, 'crates/kasirmu-bridge/src/history.rs'), 'utf-8');
const TS = readFileSync(resolve(REPO, 'ui/src/api/sales.ts'), 'utf-8');

/** The Rust field declaration line for a snake_case name. */
function rustField(name: string): string {
  const m = RUST.match(new RegExp('pub ' + name + ': [^,\\n]+'));
  expect(m, 'no Rust field ' + name + ' — repoint this guard').not.toBeNull();
  return m![0];
}

/** The TS property block for a camelCase name, including its doc comment. */
function tsProperty(name: string): string {
  // Matches either spelling, so the assertion below reports WHICH one is present
  // rather than failing on a lookup miss. Searching only for \`?:\` would make a
  // fixed field look like a missing one.
  const at = TS.search(new RegExp('\\n  ' + name + '\\??:'));
  expect(at, 'no TS property ' + name + ' — repoint this guard').toBeGreaterThan(-1);
  const line = TS.slice(at, TS.indexOf(';', at) + 1);
  return line;
}

const PAIRS: Array<[rust: string, ts: string]> = [
  ['discount_percent', 'discountPercent'],
  ['tip_minor', 'tipMinor'],
  ['service_charge_minor', 'serviceChargeMinor'],
];

describe('sale-detail numbers are non-optional on both sides', () => {
  it.each(PAIRS)('%s is a plain i64 in Rust, so %s must not be optional in TS', (rustName, tsName) => {
    // The Rust side: a bare integer, never Option.
    const field = rustField(rustName);
    expect(field, rustName + ' became optional in Rust: ' + field).not.toMatch(/Option</);
    expect(field).toMatch(/: i64/);
    // Which means serde emits it unconditionally, defaulted.
    expect(RUST).toMatch(new RegExp('#\\[serde\\(default\\)\\][\\s\\S]{0,120}pub ' + rustName));

    // The TS side must agree: a required number.
    const prop = tsProperty(tsName);
    expect(prop, tsName + ' is still optional in TS: ' + prop).not.toMatch(/\?/);
    expect(prop).toMatch(/: number;/);
  });

  it('the three fields are documented as defaulted, not as maybe-absent', () => {
    // The Rust comments say so ("default 0"), and the TS docs should not contradict them.
    expect(RUST).toMatch(/default 0/);
  });
});
