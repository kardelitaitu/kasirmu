// ── The money path's failure messages must be localized ─────────────────────
//
// PaymentModal finalizes the pending sale after QR/terminal confirmation. When
// finalize fails it must VOID the pending sale (otherwise the customer is charged
// for a sale that never completes), and both failures are reported to the cashier:
//
//   } catch (finalizeErr) {
//     addToast({ message: `Finalize failed, attempting void: ${...}` });
//     if (voidOnFinalizeFailure) {
//       try { await voidPendingSale(...); }
//       catch (voidErr) {
//         addToast({ message: `Void also failed: ${...}` });
//       }
//     }
//   }
//
// Both messages are built as raw template literals, so they reach the cashier in
// English regardless of locale — in the one flow where the money outcome is
// genuinely uncertain and the instruction has to be understood immediately.
//
// WHY THIS IS THE HIGHEST-VALUE LOCALIZATION FIX ON THE SCREEN: the other toasts
// here tell the cashier something they can undo at leisure (points, a receipt).
// These two describe a HALF-COMPLETED PAYMENT — "Finalize failed" means the
// customer may have been charged, "Void also failed" means the pending sale is
// still open and must be settled by hand. A cashier who cannot read that message
// in their own language cannot act on it.
//
// The upstream cause is `err.message`, which arrives from the backend in English
// and cannot be localized here — so it is DROPPED from the user-facing string and
// logged instead. The toast carries only the localized instruction.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MODAL = readFileSync(
  resolve(__dirname, '../features/sales/PaymentModal.tsx'),
  'utf-8',
);

/**
 * Every addToast whose message is neither a localized lookup nor a value that
 * arrived already-classified (an error taxonomy's message).
 */
function unlocalizedToasts(src: string): string[] {
  const lines = src.split(/\r?\n/);
  // Read the WHOLE call, not the line that opens it. A one-line matcher flags
  // every multiline `addToast({` as unlocalized because its message sits on the
  // next line — a matcher keyed to FORM, which this session has now hit five
  // times (docs/records/audits/guard-authoring-practice.md). Six of the nine
  // hits the first draft reported were that false positive.
  const joined = lines.join('\n');
  const out: string[] = [];
  for (const [i, line] of lines.entries()) {
    if (!/addToast\(\{/.test(line)) continue;
    const at = joined.indexOf(line) + line.length;
    // Balanced-ish read: up to the first `});` at the same or later depth. A toast
    // body is short and never contains a nested object literal that closes early,
    // which the assertion below is written to survive if it ever does.
    const end = joined.indexOf('});', at);
    const call = joined.slice(joined.indexOf(line), end === -1 ? at + 400 : end + 3);
    if (/requiredLocalized|l10n\.getString|current\.getString|classified\.message/.test(call)) continue;
    out.push((i + 1) + ': ' + call.replace(/\s+/g, ' ').trim().slice(0, 130));
  }
  return out;
}

describe('PaymentModal reports every failure in the operator\'s language', () => {
  it('builds no toast message from a raw template literal', () => {
    expect(
      unlocalizedToasts(MODAL),
      'These toasts interpolate a raw string, so the cashier sees English in any ' +
        'locale. Route them through requiredLocalized (with the backend cause ' +
        'logged, not shown) or through the l10n lookup already used on this screen.',
    ).toEqual([]);
  });

  it('names the finalize and void failures explicitly', () => {
    // Asserted by key so the failure cannot regress to a bare literal again.
    expect(MODAL).toContain("payment-toast-finalize-failed");
    expect(MODAL).toContain("payment-toast-void-failed");
  });

  it('finds the toasts at all, so the scan cannot pass vacuously', () => {
    const all = MODAL.match(/addToast\(\{/g) ?? [];
    expect(
      all.length,
      'no addToast call was found — the scan is blind and the case above proves nothing.',
    ).toBeGreaterThanOrEqual(10);
  });
});
