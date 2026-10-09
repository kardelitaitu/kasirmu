// ── Settings controls must have a READER (F19) ────────────────────────
//
// Rounds 52-54 found three controls whose value the runtime ignored (F16, F17,
// F18). This guard generalises the check so the class cannot come back silently.
//
// The defect shape is always the same: `RestaurantPaymentsScreen` WRITES a key into
// a rail's `parameters` bag (via `updateRailParams`), READS it back into its own
// toggle, and NOTHING ELSE EVER READS IT. The operator configures a behaviour that
// does not happen, and the screen looks like it works.
//
// A grep-based guard, deliberately: the alternative is a runtime assertion, and
// "this key is never read" is a property of the whole tree, not of a render. The
// test reads the source, so it fails on the commit that ADDS an unwired control
// rather than on a customer's tablet.
//
// Escape hatch: add the key to ALLOWED_UNWIRED with a reason. That list is the
// honest record of what is knowingly inert, and it should only ever shrink.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const UI_SRC = resolve(__dirname, '..');
const SCREEN = 'features/restaurant/screens/RestaurantPaymentsScreen.tsx';

/**
 * Keys knowingly written-and-never-read, each with the reason it is still here.
 *
 * An entry here is a DEBT, not a licence. If you add one, say who owes the reader.
 */
const ALLOWED_UNWIRED: Record<string, string> = {
  // ── Duplicated credentials, harmless ────────────────────────────
  // These are ALSO saved properly, encrypted, through
  // `setPaymentGatewayConfigScoped` (screen :737-754). The rail-param copy is a
  // redundant second home that nothing reads, so the control still WORKS at
  // checkout — it just stores the value twice. Redundant, not inert: no operator
  // can configure a behaviour that fails to happen. Listed rather than fixed
  // because removing them is a storage-format change, not a bug fix.
  merchantId: 'duplicate of the encrypted gateway config (screen :738)',
  clientKey: 'duplicate of the encrypted gateway config (screen :739)',
  serverKey: 'duplicate of the encrypted gateway config (screen :740)',
  publishableKey: 'duplicate of the encrypted gateway config (screen :751)',
  secretKey: 'duplicate of the encrypted gateway config (screen :752)',
  nmid: 'duplicate of the encrypted gateway config (screen :1135 region)',
  channels: 'duplicate of the encrypted gateway config (:701 save)',

  // ── Genuinely INERT — the F19 defect ────────────────────────────
  // No implementation reads these, on the client OR the server (`grep` over
  // `*.rs`: zero hits). The operator changes a switch and nothing changes.
  // They stay listed, not fixed, because wiring each one is a product decision:
  //   · verifyDrawer  — prompts the cashier to verify a drawer? needs UI flow
  //   · acceptedCards — filter card networks? needs the EDC/terminal path
  //   · requireTrace  — refuse a sale without an approval code? needs EDC flow
  //   · autoConfirm   — auto-confirm a gateway charge? needs the gateway path
  //   · printReceipt  — print on a QRIS tender? needs the receipt path
  verifyDrawer: 'INERT: no reader client or server — needs a cashier flow',
  acceptedCards: 'INERT: no reader — needs EDC card-network filtering',
  requireTrace: 'INERT: no reader — needs the EDC approval-code path',
  autoConfirm: 'INERT: no reader — needs the gateway auto-confirm path',
  printReceipt: 'INERT: no reader — needs the QRIS receipt path',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** The keys the screen writes into a rail's `parameters` bag. */
function writtenRailParams(): string[] {
  const src = readFileSync(join(UI_SRC, SCREEN), 'utf-8');
  const keys = new Set<string>();
  // updateRailParams('cash', { autoKick: val })  ->  autoKick
  const re = /updateRailParams\([^,]+,\s*\{\s*([A-Za-z_$][\w$]*)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) keys.add(m[1]!);
  return [...keys].sort();
}

/**
 * Files that may legitimately name a key without being its reader: the settings
 * screen itself (it writes and reloads the value) and any file that only passes it
 * through the save payload.
 */
const WRITER_FILES = new Set([SCREEN]);

describe('rail parameters have a reader (F19)', () => {
  const files = walk(UI_SRC).map((f) => ({
    path: f.slice(UI_SRC.length + 1).split('\\').join('/'),
    text: readFileSync(f, 'utf-8'),
  }));

  it('extracts the keys the screen writes (guards the guard)', () => {
    const keys = writtenRailParams();
    // If the regex stops matching, every case below passes vacuously.
    expect(keys.length).toBeGreaterThanOrEqual(8);
    expect(keys).toContain('autoKick');
  });

  it('every written rail parameter is READ somewhere other than the writer', () => {
    const keys = writtenRailParams();
    const unwired: string[] = [];

    for (const key of keys) {
      if (ALLOWED_UNWIRED[key]) continue;
      // Word-boundary so 'mode' does not match 'model'.
      const re = new RegExp(`\\b${key}\\b`);
      const readers = files.filter(
        (f) => !WRITER_FILES.has(f.path) && re.test(f.text),
      );
      if (readers.length === 0) unwired.push(key);
    }

    expect(
      unwired,
      'these settings are saved but never read, so the operator can configure a ' +
        'behaviour that does not happen: ' + unwired.join(', '),
    ).toEqual([]);
  });

  it('has no STALE allow-list entry: a listed key that gained a reader must be removed', () => {
    // ⚠️ THE MISSING DIRECTION, added 2026-10-09. The case above only checks one
    // way: a written key with no reader must be listed. It never checked the
    // INVERSE, so an entry could stay in ALLOWED_UNWIRED after its control was
    // wired — leaving the file asserting a defect that no longer exists, which is
    // the rot this plan has now been caught by four times (rounds 74-77).
    //
    // Every sibling guard in this suite carries the rule: `baselineLoadSignal`
    // fails a stale exemption, `deadSettingsKey` fails an entry that gains a
    // reader, `planStatusAccuracy` fails a stale header. This one did not.
    const keys = writtenRailParams();
    const stale: string[] = [];

    for (const key of keys) {
      if (!ALLOWED_UNWIRED[key]) continue;
      // An entry is stale when a real reader exists outside the writer files.
      const re = new RegExp('\\b' + key + '\\b');
      const readers = files.filter(
        (f) => !WRITER_FILES.has(f.path) && re.test(f.text),
      );
      if (readers.length > 0) {
        stale.push(key + ' -> ' + readers.map((r) => r.path).join(', '));
      }
    }

    expect(
      stale,
      'these ALLOWED_UNWIRED keys now HAVE a reader, so the entry and its INERT ' +
        'comment are out of date. Delete the entry (and update the F19 record) so ' +
        'the list cannot outlive the condition it records: ' + stale.join('; '),
    ).toEqual([]);
  });

  it('the allow-list is not empty-by-accident (guards the case above)', () => {
    // Without this, a typo that emptied ALLOWED_UNWIRED would make the stale
    // check above iterate nothing and pass, while every INERT control went
    // unrecorded and the first case still failed only for NEW keys.
    expect(Object.keys(ALLOWED_UNWIRED).length, 'the allow-list lost its entries').toBeGreaterThan(5);
  });
});
