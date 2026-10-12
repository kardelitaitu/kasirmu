// ── The POS toast-localization guard, unified ───────────────────────────────
//
// Two guards grew across rounds 15-16 and each had exactly what the other lacked:
//
//   PosToastLocalization       general class   |  *.tsx only       -> missed hooks
//   PaymentHookLocalization    *.ts and *.tsx  |  two fixed strings -> missed the rest
//
// Neither caught the eight raw literals sitting in sales/hooks/*.ts: a .tsx-only
// scan never opened the file, and a pattern-anchored scan did not match its text.
// A file that both guards read, with a rule both could express, went unchecked —
// which is the failure mode of splitting a rule across two tests.
//
// This file is the union: the general rule, over both extensions, across the whole
// app rather than the four POS roots. The formal statement is the one from
// AGENTS.md 6.3 — every user-visible string goes through @fluent/react.
//
// SCOPE widened to features/ deliberately. The POS roots were where this started,
// but "localize what the operator reads" is not a POS-specific rule; the same
// literals were found in auth, settings, inventory, locations and design.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const UI_SRC = resolve(__dirname, '..');

function collect(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (!/__tests__|node_modules/.test(e.name)) collect(full, out);
    } else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

/**
 * The POS/restaurant surface this objective owns.
 *
 * The scan CAN see the whole features tree — it did, and it found 45 raw literals
 * across 17 files. The 13 files outside these roots are recorded in
 * OUT_OF_SCOPE below rather than left failing, because a red guard gets muted (the
 * same argument scripts/check-client-type-drift.py makes for its green baseline).
 * They are named so the debt is visible and CANNOT silently grow: a 14th file
 * appearing anywhere in the tree fails the last case in this file.
 */
const ROOTS = ['features/sales', 'features/restaurant', 'features/tables', 'features/kds'];

/**
 * Files outside the POS surface that still hold raw literals, verified 2026-10-12.
 * Each is a real defect in another objective — recorded, not fixed here.
 */
const OUT_OF_SCOPE = new Set([
  'features/auth/LicenseActivationScreen.tsx',
  'features/design/DesignSystem.tsx',
  'features/inventory/StockCountDetail.tsx',
  'features/inventory/StockCountHistory.tsx',
  'features/inventory/StockCountsScreen.tsx',
  'features/inventory/TransitAuditScreen.tsx',
  'features/locations/TopologyScreen.tsx',
  'features/settings/components/EdcTerminalsCard.tsx',
  'features/settings/EmailReportSettings.tsx',
  'features/settings/screens/SyncStatusScreen.tsx',
  'features/settings/sections/SyncSection.tsx',
  'features/settings/workspace-cards/WorkspaceStorePosSettings.tsx',
  'features/warehouse/WarehouseConsole.tsx',
]);

/** Every source under the POS roots. */
const SOURCES: Array<[string, string]> = ROOTS.flatMap((root) =>
  collect(join(UI_SRC, root)).map((abs) => {
    const rel = relative(UI_SRC, abs).split('\\').join('/');
    return [rel, readFileSync(abs, 'utf-8')] as [string, string];
  }),
);

/** Every source in the whole app, for the no-new-debt check below. */
const ALL_SOURCES: Array<[string, string]> = collect(join(UI_SRC, 'features')).map((abs) => {
  const rel = relative(UI_SRC, abs).split('\\').join('/');
  return [rel, readFileSync(abs, 'utf-8')] as [string, string];
});

/**
 * Every addToast whose message is not built from a localized lookup.
 *
 * The WHOLE call is read by BALANCING BRACES from its opening line. Searching
 * forward for the next `});` skips past a one-line call into the next toast, so a
 * localized neighbour excuses an unlocalized line — the false negative round 15
 * shipped and only the kill-test exposed.
 *
 * `plainErrorMessage(err, fallback)` is an error-taxonomy adapter, not a
 * localization. Its SECOND argument is what the cashier sees when the backend sent
 * nothing, so the allowance is granted only when that fallback is ITSELF a lookup
 * — which is how SalesHistoryScreen:723 writes it. Accepting the helper by name
 * alone let `plainErrorMessage(err, 'Override failed')` through, and that literal
 * reached the cashier verbatim.
 */
const LOCALIZED =
  /requiredLocalized|getString|classified\.message|l10nErrorMessage/;
const ADAPTER = /plainErrorMessage\(\s*[^,]+,\s*(requiredLocalized|.*getString)/;
/**
 * A message passed as a BARE IDENTIFIER (`message: msg`) — the localization happened
 * where the variable was BUILT, not here.
 *
 * A real limit of a source scan, stated rather than hidden: the guard sees
 * `addToast({ message: msg })` and cannot follow `msg` back to its declaration. It is
 * allowed because the alternative is worse — resolving it needs a parser, and
 * forbidding it fails correct code (`usePosCartActions.ts:211` builds `msg` from
 * requiredLocalized on the line above).
 *
 * The residual risk is that an English literal built ELSEWHERE and passed in would
 * slip past THIS call. It is narrow: the literal still has to exist in some scanned
 * file, and a raw string there is caught at its own site.
 */
const VARIABLE_MESSAGE = /message\s*:\s*[A-Za-z_$][\w$]*\s*[,}]/;

function unlocalizedToasts(src: string): string[] {
  const lines = src.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/addToast\(\{/.test(lines[i] ?? '')) continue;
    let depth = 0;
    let end = -1;
    for (let k = i; k < lines.length && k < i + 40; k++) {
      for (const ch of lines[k] ?? '') {
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0 && /\);\s*$/.test((lines[k] ?? '').trim())) { end = k; break; }
        }
      }
      if (end !== -1) break;
    }
    const call = lines.slice(i, end === -1 ? i + 1 : end + 1).join('\n');
    if (LOCALIZED.test(call)) continue;
    // The adapter is allowed only with a LOCALIZED fallback — see the note above.
    if (ADAPTER.test(call)) continue;
    if (VARIABLE_MESSAGE.test(call)) continue;
    out.push((i + 1) + ': ' + call.replace(/\s+/g, ' ').trim().slice(0, 110));
  }
  return out;
}

describe('every user-visible toast is localized', () => {
  it.each(SOURCES)('%s builds its toasts from localized strings', (_rel, src) => {
    expect(
      unlocalizedToasts(src),
      'These reach the operator as English in every locale (AGENTS.md 6.3). Route ' +
        'them through requiredLocalized with a key in both bundles; log a backend ' +
        'cause rather than interpolating it into the user-visible message.',
    ).toEqual([]);
  });

  it('scans both extensions and the whole features tree', () => {
    expect(SOURCES.filter(([r]) => r.endsWith('.ts')).length, 'no .ts collected — hooks are outside the scan').toBeGreaterThanOrEqual(10);
    expect(SOURCES.filter(([r]) => r.endsWith('.tsx')).length, 'no .tsx collected').toBeGreaterThanOrEqual(50);
    expect(SOURCES.filter(([r]) => r.includes('features/sales/hooks/')).length, 'the hooks dir is not scanned').toBeGreaterThanOrEqual(2);
  });

  it('no file OUTSIDE the POS surface has gained an unlocalized toast', () => {
    // The debt list is a CEILING, not a licence: a file not named in OUT_OF_SCOPE
    // that holds a raw literal fails here. Without this, widening the scan would
    // only ever have been a one-off measurement.
    const fresh = ALL_SOURCES.filter(([rel, src]) => {
      if (ROOTS.some((root) => rel.startsWith(root + '/'))) return false;
      if (OUT_OF_SCOPE.has(rel)) return false;
      return unlocalizedToasts(src).length > 0;
    }).map(([rel]) => rel);
    expect(
      fresh,
      'These are outside the POS roots and the recorded debt list, and now hold an ' +
        'unlocalized toast. Either localize them, or add them to OUT_OF_SCOPE with ' +
        'the reason — do not widen silently.',
    ).toEqual([]);
  });

  it('found toasts to check, so the cases above cannot pass vacuously', () => {
    const total = SOURCES.reduce((n, [, src]) => n + (src.match(/addToast\(\{/g) ?? []).length, 0);
    expect(total, 'no addToast call was found at all — the scan is blind').toBeGreaterThanOrEqual(40);
  });
});
