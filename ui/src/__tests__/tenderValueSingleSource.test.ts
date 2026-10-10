// ── Guard: a field sent to TWO consumers must be derived once ────────
//
// Rounds 28 and 29 found the same defect three times in `PaymentModal`: one value used
// for both a persisted enum and a human-readable label, or one field derived
// independently at several send sites until the spellings diverged.
//
//   · `paymentMethod` (the DB column) was lowercased on the first submission but
//     `method.toUpperCase()` on the shortfall RETRY — same attempt, two spellings, and
//     the backend normalises only `payment_splits`, so both reached the column.
//   · `method` on the receipt was lowercased alongside the enum, so a cash sale
//     printed 'cash' where it printed 'CASH'.
//   · the retry built its OWN `PrintSalesReceiptArgs` and hard-coded upper case,
//     dropping the merchant's configured QRIS label that the normal path resolves.
//
// WHY A STATIC GUARD. The behavioural tests could not catch the third one: for a CASH
// sale the correct label IS 'CASH', which the buggy `toUpperCase()` also produces, so
// a cash assertion passes either way (measured — the first two attempts at such a test
// passed against the bug). The distinguishing tender is QRIS with a custom rail label,
// and the QRIS tab would not mount inside that suite. A source-level check does not
// depend on which tender a test happens to drive.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const MODAL = path.resolve(
  process.cwd(),
  'src/features/sales/PaymentModal.tsx',
);

describe('PaymentModal — the two tender values stay derived once', () => {
  const source = fs.readFileSync(MODAL, 'utf-8');
  const lines = source.split(/\r?\n/);

  it('derives storedMethod and methodLabel exactly once each', () => {
    const count = (re: RegExp) => lines.filter((l) => re.test(l)).length;
    expect(count(/const storedMethod\b/)).toBe(1);
    expect(count(/const methodLabel\b/)).toBe(1);
  });

  it('never re-derives the tender inline at a send site', () => {
    // The shapes that diverged. A send site must reference the derived value, not
    // rebuild it — that is the whole failure mode these three bugs share.
    const offenders = lines
      .map((l, i) => ({ l, n: i + 1 }))
      .filter(({ l }) => /method\.toUpperCase\(\)/.test(l))
      .filter(({ l }) => /method:/.test(l));
    expect(
      offenders.map((o) => `:${o.n}  ${o.l.trim().slice(0, 90)}`),
      'A send site rebuilds the tender from `method.toUpperCase()` instead of using ' +
        '`methodLabel`. That is exactly how the receipt and the shortfall retry drifted ' +
        'apart from the normal path (rounds 28-29). Reference the derived value.',
    ).toEqual([]);
  });

  it('sends the receipt and the stored column from the named values', () => {
    // The receipt must carry the label; the column must carry the enum. If either
    // line disappears the two facts have been re-merged, which is the original bug.
    expect(
      lines.some((l) => /method: methodLabel,/.test(l)),
      'no receipt site sends `method: methodLabel`',
    ).toBe(true);
    expect(
      lines.some((l) => /paymentMethod: storedMethod,/.test(l)),
      'no complete_sale site sends `paymentMethod: storedMethod`',
    ).toBe(true);
    expect(
      lines.some((l) => /paymentMethod=\{storedMethod\}/.test(l)),
      'the shortfall retry does not send `paymentMethod={storedMethod}`',
    ).toBe(true);
  });
});