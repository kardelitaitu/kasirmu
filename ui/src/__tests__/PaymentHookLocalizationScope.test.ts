// ── The payment path has TWO copies of the same failure messages ────────────
//
// Round 14 fixed four raw English literals in PaymentModal's finalize/void
// handlers. Round 15 swept addToast() across the POS surface and reported clean.
//
// Both were wrong about the same thing. PaymentModal's QR state was later
// extracted "verbatim" into ./payment/useAutoQr.ts (the file says so: "State +
// handlers moved verbatim to ./payment/useAutoQr (slice W3-a)"), so the SAME two
// messages exist in two places:
//
//   addToast({ message: `Void also failed: ${...}` })        (PaymentModal, fixed)
//   addToast({ message: `Void also failed: ${...}` })        (useAutoQr, missed)
//
// Round 15's guard read only *.tsx, so a hook file (.ts) was outside its scope,
// and its ROOTS did not cover ./payment/ either. The defect was not subtle — it
// was the identical string, one directory away.
//
// WHY THIS IS USABILITY: "Void also failed" is the message that tells a cashier a
// pending QR sale is STILL OPEN after a failed charge. Reading it in the wrong
// language means a lingering pending sale nobody clears.
//
// SCOPE: .ts AND .tsx, and ./payment included — the two omissions that hid this.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const UI_SRC = resolve(__dirname, '..');
const ROOTS = ['features/sales', 'features/restaurant', 'features/tables', 'features/kds'];

function collect(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (!/__tests__|node_modules/.test(e.name)) collect(full, out);
    } else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

const SOURCES: Array<[string, string]> = ROOTS.flatMap((root) =>
  collect(join(UI_SRC, root)).map((abs) => {
    const rel = relative(UI_SRC, abs).split('\\').join('/');
    return [rel, readFileSync(abs, 'utf-8')] as [string, string];
  }),
);

describe('the localization guard covers hooks and the payment directory', () => {
  it('scans .ts files, not only .tsx', () => {
    // The exact gap that hid useAutoQr: a hook is a .ts file, and round 15's
    // guard collected *.tsx only.
    const ts = SOURCES.filter(([rel]) => rel.endsWith('.ts'));
    expect(ts.length, 'no .ts source was collected — hooks are outside the scan again').toBeGreaterThanOrEqual(3);
  });

  it('scans features/sales/payment', () => {
    const payment = SOURCES.filter(([rel]) => rel.includes('features/sales/payment/'));
    expect(payment.length, 'the payment directory is not scanned').toBeGreaterThanOrEqual(3);
  });

  it('finds no raw void-failure or QR-failure literal anywhere in the surface', () => {
    // Asserted on the MESSAGE, not on a file, so a third copy of the extracted
    // handler fails here without anyone having to know its name.
    const offenders: string[] = [];
    for (const [rel, src] of SOURCES) {
      src.split(/\r?\n/).forEach((line, i) => {
        if (!/message:\s*`(Void also failed|QR payment failed)/.test(line)) return;
        offenders.push(rel + ':' + (i + 1) + '  ' + line.trim().slice(0, 90));
      });
    }
    expect(
      offenders,
      'These interpolate a raw backend message into a cashier-facing string, so ' +
        'the cashier sees English in every locale. Use the localized key and log ' +
        'the cause, as the PaymentModal copies now do.',
    ).toEqual([]);
  });
});
