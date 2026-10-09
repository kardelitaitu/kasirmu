// ── The receipt toggles must not promise the PAPER (F22) ──────────────
//
// D6 proves six of this screen's twelve toggles cannot reach the printer: their
// switch reaches only the on-screen preview. The `-desc` copy nevertheless said
// "Print …" for all of them, on a screen titled "Receipt & Printer Settings".
//
// For `showStaffName` that was the strongest form of the lie — the printer has NO
// staff field at all, so "Print serving staff or cashier name" described a line that
// can never appear on paper. For `showReceiptCode` / `showDateTime` / `showItemNotes`
// the lines DO print, but UNCONDITIONALLY, so switching the toggle off hides them from
// the preview while the paper keeps them — the preview and the paper move in OPPOSITE
// directions.
//
// This guard reads the two sources of truth directly rather than restating them: the
// printer's own field list (`ReceiptConfig`, `crates/kasirmu-hal/src/drivers/receipt.rs`),
// and the FTL. A toggle whose description promises printing must have a printer field
// that can honour it — otherwise the copy is the defect.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Found by walking up until both anchors exist — the approach the EOD drift pin uses,
// and never anchored to a checkout path. `__dirname` is NOT usable here: under this
// suite's jsdom environment the module URL is not a `file:` scheme.
function findRoot(): string {
  const markers = [
    'shared-ui/locales/products.ftl',
    'crates/kasirmu-hal/src/drivers/receipt.rs',
  ];
  let dir = process.cwd();
  for (let up = 0; up < 6; up += 1) {
    if (markers.every((m) => fs.existsSync(path.join(dir, m)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not locate the repo root from ' + process.cwd());
}

const ROOT = findRoot();
const EN = 'shared-ui/locales/products.ftl';
const ID = 'shared-ui/locales/products.id.ftl';
const PRINTER = 'crates/kasirmu-hal/src/drivers/receipt.rs';

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

/** One `key = value` line from an FTL file, or null when absent. */
function ftl(rel: string, key: string): string | null {
  const m = read(rel).match(new RegExp(`^${key}\\s*=\\s*(.*)$`, 'm'));
  return m ? m[1]!.trim() : null;
}

/**
 * Toggles the D6 measurement shows the printer cannot honour, each with the reason.
 * Mirrors `receiptPreviewPrintAgreement.test.ts`; kept explicit so a NEW unhonourable
 * toggle must be added here deliberately rather than passing by omission.
 */
const CANNOT_REACH_PAPER: Record<string, string> = {
  'restaurant-toggle-staff': 'the printer has no staff field at all',
  'restaurant-toggle-receipt-code': 'the printer prints the number unconditionally',
  'restaurant-toggle-datetime': 'the printer prints the date unconditionally',
  'restaurant-toggle-item-notes': 'the printer prints notes unconditionally',
  'restaurant-toggle-thousands-sep': 'the printer has no grouping at all',
  'restaurant-toggle-decimals': 'the printer renders the canonical exponent, not a preference',
};

describe('receipt toggle copy does not promise the paper (F22)', () => {
  it('the printer really has no staff line (guards the guard)', () => {
    // If this ever changes, the staff entry above must be revisited rather than
    // silently constraining copy that became accurate.
    expect(/staff|cashier/i.test(read(PRINTER))).toBe(false);
  });

  it('every toggle description naming printing belongs to a printer field', () => {
    const offenders: string[] = [];
    for (const [key, why] of Object.entries(CANNOT_REACH_PAPER)) {
      for (const [locale, file] of [['en', EN], ['id', ID]] as const) {
        const desc = ftl(file, `${key}-desc`);
        expect(desc, `${key}-desc missing from ${locale}`).not.toBeNull();
        // The defect is a sentence that OPENS by claiming the switch prints something
        // — "Print serving staff…" / "Cetak nama staf…". An accurate sentence may still
        // MENTION the printer ("…The printer always prints it."), so match the IMPERATIVE
        // at the start rather than any occurrence of the verb.
        if (/^\s*(print|cetak)\b/i.test(desc!)) {
          offenders.push(`${locale} ${key}-desc: "${desc}" (${why})`);
        }
      }
    }
    expect(
      offenders,
      'these descriptions promise printing, but the printer cannot honour them ' +
        '(D6). Say what the switch actually does — it drives the PREVIEW: ' +
        offenders.join(' | '),
    ).toEqual([]);
  });
});