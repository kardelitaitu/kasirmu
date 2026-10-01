// ── RECEIPT_ELEMENT_CODES parity (Rust ↔ TS) ───────────────────────
//
// The closed receipt-element enum is defined TWICE:
//   • Rust: crates/kasirmu-core/src/db/receipt_formats.rs
//     (`pub const RECEIPT_ELEMENT_CODES`) — the validated source of truth;
//       `validate_content` rejects any write carrying a code not in this list.
//   • TS:   ui/src/features/settings/screens/ReceiptFormatSettingsCard.tsx
//     (`const RECEIPT_ELEMENT_CODES`) — the checkboxes the card renders.
//
// Nothing generated one from the other, so they could drift silently: the card
// would offer a code the backend rejects (the whole save 500s) or omit a valid
// one (the statutory element is unreachable). This test parses BOTH source
// files and asserts the lists are identical, so any change to either side must
// be mirrored in the same commit.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(process.cwd(), '..');

const RUST_PATH = path.join(repoRoot, 'crates/kasirmu-core/src/db/receipt_formats.rs');
const TS_PATH = path.join(repoRoot, 'ui/src/features/settings/screens/ReceiptFormatSettingsCard.tsx');

/** Extract the quoted string literals of a `const NAME ... = [ ... ]` block. */
function extractList(source: string, startMarker: string): string[] {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`marker not found: ${startMarker}`);
  // The declaration may carry a type annotation containing brackets
  // (`&[&str]`), so anchor on the FIRST quoted literal and take the enclosing
  // array bounds from there — the opener is the last '[' before the literal,
  // the closer the first ']' after it.
  const firstLiteral = source.slice(start).search(/["']/);
  if (firstLiteral === -1) throw new Error(`no quoted literal after: ${startMarker}`);
  const literalAt = start + firstLiteral;
  const open = source.lastIndexOf('[', literalAt);
  const close = source.indexOf(']', literalAt);
  if (open === -1 || close === -1) throw new Error(`list bounds not found after: ${startMarker}`);
  const body = source.slice(open + 1, close);
  return Array.from(body.matchAll(/"([a-z_]+)"|'([a-z_]+)'/g)).map((m) => (m[1] ?? m[2]) as string);
}

describe('RECEIPT_ELEMENT_CODES parity', () => {
  it('the Rust and TS element lists are identical and non-empty', () => {
    const rust = extractList(fs.readFileSync(RUST_PATH, 'utf8'), 'pub const RECEIPT_ELEMENT_CODES');
    const ts = extractList(fs.readFileSync(TS_PATH, 'utf8'), 'const RECEIPT_ELEMENT_CODES');

    expect(rust.length).toBeGreaterThan(0);
    expect(ts).toEqual(rust);
  });
});
