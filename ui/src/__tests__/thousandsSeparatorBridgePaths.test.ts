// ── Every store-settings load writes the localStorage bridge ──────────────
//
// The thousands separator reaches `formatMoney` through localStorage, because that
// formatter is synchronous and is called from 149 non-test sites — it cannot await an
// IPC load. `SettingsContext` is the only thing that seeds the bridge, and it loads the
// store settings on TWO paths, one per shell:
//
//   1. the unscoped load — the web shell. Inside a `Promise.allSettled`, so the value
//      arrives as `sR.value` and its bridge write sits in the `if (sR.status === ...)`
//      block, not beside the call.
//   2. the SCOPED load — desktop and mobile, via `scopes.has('store')`.
//
// Round 50 patched only (1) at first; (2) was patched in the same round once the gap
// was found. Left alone, the desktop and mobile shells would group money differently
// from the web shell on the SAME store — the "one seam, two paths" shape F2 records,
// and one that is invisible until two shells are compared.
//
// ── Why this is a COUNT and not a structural extraction ──
//
// The first two drafts of this guard located each load by brace-matching outward from
// the `store:` merge. Both were wrong in different ways: the merge's own brace closes
// the object LITERAL, so the enclosing `if` block — where the write actually lives — is
// one level further out than the extractor looked. The property that matters is not the
// nesting, it is that the two are in PAIRS. Counting them says that directly and cannot
// be fooled by a re-indent.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(__dirname, '../../..');
const CONTEXT = readFileSync(resolve(REPO, 'ui/src/contexts/SettingsContext.tsx'), 'utf-8');
const STORAGE = readFileSync(resolve(REPO, 'ui/src/utils/storage.ts'), 'utf-8');

/** Every `setSettings((prev) => ({ ...prev, store: … }))` — one per store load. */
const storeMerges = Array.from(
  CONTEXT.matchAll(/setSettings\(\(prev\) => \(\{ \.\.\.prev, store: /g),
);

/** Every bridge write, i.e. a DTO value handed to setThousandsSep. */
const bridgeWrites = Array.from(
  CONTEXT.matchAll(/setThousandsSep\(thousandsSepFor\(/g),
);

describe('every store-settings load writes the thousands-separator bridge', () => {
  it('there is one bridge write per store load — no more, no fewer', () => {
    // The pairing is the whole assertion. One load without a write means a shell that
    // groups money its own way; one write without a load means a merge that dropped out
    // from under a live write.
    expect(storeMerges.length, 'store merges found').toBeGreaterThan(0);
    expect(
      bridgeWrites.length,
      'store loads=' + storeMerges.length + ' but bridge writes=' + bridgeWrites.length +
        ' — every store load must seed the bridge, or that shell disagrees with the paper.',
    ).toBe(storeMerges.length);
  });

  it('still has exactly the two loads this guard was written for', () => {
    // A THIRD load path is the thing that would break the pairing silently, so it
    // fails here and the author adds a write rather than discovering it on a device.
    expect(storeMerges.length).toBe(2);
  });

  it('each write reads the DTO field rather than a hardcoded value', () => {
    // A write of a literal would keep the counts above correct and pin the bridge to
    // one separator forever.
    for (const m of Array.from(
      CONTEXT.matchAll(/setThousandsSep\(thousandsSepFor\(([^)]*)\)\)/g),
    )) {
      expect(
        m[1],
        'the bridge must be seeded from the DTO value, not a literal',
      ).toMatch(/thousandsSeparator/);
    }
  });

  it('each write is protected by a stale() guard somewhere before it', () => {
    // Not "in the same if-block". The two shapes differ deliberately:
    //   · the scoped load's guard is INSIDE its handler, immediately above;
    //   · the unscoped load's is one ENCLOSING `try` up, because that path takes its
    //     value from a destructured `allSettled` result rather than its own handler.
    //
    // Asserting the near-distance version was this file's first draft, and it failed on
    // the unscoped path — correctly, because it assumed the nesting instead of reading
    // it. What must hold for BOTH is that a superseding store switch cannot leave a
    // write behind, i.e. a stale check appears before the write.
    for (const m of Array.from(CONTEXT.matchAll(/setThousandsSep\(/g))) {
      const before = CONTEXT.slice(0, m.index!);
      expect(
        before,
        'a bridge write appeared with no preceding stale() guard',
      ).toMatch(/if \(stale\(\)\) return;/);
    }
  });

  it("the reader's default is 'none', matching formatMoney's own default", () => {
    // Both must be none: a caller passing no argument gets the LOCALE's grouping, and
    // the bridge must not invent one.
    expect(STORAGE).toMatch(/VALID_THOUSANDS_SEPS/);
    const reader = STORAGE.slice(STORAGE.indexOf('export function getThousandsSep'));
    expect(reader).toMatch(/return 'none';/);
  });
});
