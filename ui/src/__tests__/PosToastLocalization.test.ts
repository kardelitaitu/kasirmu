// ── Cashier-facing messages must be localized across the WHOLE POS surface ───
//
// Round 14 found four raw English template literals in the PaymentModal money
// path. This file asks the wider question: is that one screen, or a class?
//
// It is a class. Six more sit in PosScreen.tsx — the cashier's main screen —
// including the cash-drawer result, which is the one action a cashier performs
// while looking at a customer:
//
//   addToast({ message: 'Cash drawer opened', type: 'success' });
//   addToast({ message: 'Cash drawer did not open: device returned unconfirmed' });
//   addToast({ message: 'Authentication required to open cash drawer' });
//
// WHY THIS IS USABILITY, NOT PEDANTRY: every one of these is a message the
// cashier has to ACT on. "Authentication required to open cash drawer" tells
// them to re-login; "Failed to update remaining tab balance" tells them a tab
// is now wrong. A literal renders in English in every locale (§6.3), so an
// operator running the Indonesian bundle is told nothing they can use.
//
// The guard is scoped to the POS surface rather than to one file, because the
// round-14 finding was ONE file and the class was the whole surface — the same
// lesson as the order-type rule (round 13: a list cannot notice what is missing
// from it).

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
    } else if (/\.tsx$/.test(e.name)) out.push(full);
  }
  return out;
}

/**
 * Every addToast whose message is neither a localized lookup, a value that
 * arrived already-classified by an error taxonomy, nor a helper that localizes.
 *
 * The WHOLE call is read, not the line that opens it: a one-line matcher flags
 * every multiline `addToast({` as unlocalized because its message sits on the
 * next line. That false positive was six of nine hits in round 14 — the same
 * form-coupling recorded in docs/records/audits/guard-authoring-practice.md.
 */
function unlocalizedToasts(src: string): string[] {
  const lines = src.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/addToast\(\{/.test(lines[i] ?? '')) continue;
    // The call's END is found by BALANCING BRACES from its own opening line, not by
    // searching for the next \`});\`.
    //
    // That distinction is the whole correctness of this function. When the call is
    // a one-liner — \`addToast({ message: 'Cash drawer opened', type: 'success' });\` —
    // searching forward for \`});\` skips past it to the NEXT toast's terminator, so
    // the slice contained a NEIGHBOUR's text. A localized neighbour then excused an
    // unlocalized line: the guard passed with the defect on disk. Found only because
    // the kill-test reverted a real site and the guard did NOT fire.
    let depth = 0;
    let end = -1;
    for (let k = i; k < lines.length && k < i + 40; k++) {
      for (const ch of lines[k] ?? '') {
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          // Closed back to the object literal's own brace, and the line ends the call.
          if (depth === 0 && /\);\s*$/.test((lines[k] ?? '').trim())) { end = k; break; }
        }
      }
      if (end !== -1) break;
    }
    const call = lines.slice(i, end === -1 ? i + 1 : end + 1).join('\n');
    if (/requiredLocalized|getString|classified\.message|l10nErrorMessage/.test(call)) continue;
    out.push((i + 1) + ': ' + call.replace(/\s+/g, ' ').trim().slice(0, 120));
  }
  return out;
}

const SOURCES: Array<[string, string]> = ROOTS.flatMap((root) =>
  collect(join(UI_SRC, root)).map((abs) => {
    const rel = relative(UI_SRC, abs).split('\\').join('/');
    return [rel, readFileSync(abs, 'utf-8')] as [string, string];
  }),
);

describe('every cashier-facing toast is localized', () => {
  it.each(SOURCES)('%s builds its toasts from localized strings', (_rel, src) => {
    expect(
      unlocalizedToasts(src),
      'These reach the cashier as English in every locale. Route them through ' +
        'requiredLocalized with a key in both bundles; log a backend cause rather ' +
        'than interpolating it into the user-visible message.',
    ).toEqual([]);
  });

  it('scans a surface with toasts in it, so the cases above cannot pass vacuously', () => {
    // A rename of addToast, or a root that stops matching, would leave every case
    // above green while checking nothing.
    const total = SOURCES.reduce((n, [, src]) => n + (src.match(/addToast\(\{/g) ?? []).length, 0);
    expect(total, 'no addToast call was found anywhere in the POS surface').toBeGreaterThanOrEqual(20);
  });
});
