import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ADR #45 §4.3 — the TypeScript validator and the Rust validator must not drift
 * on WHICH rules exist, not just on what a rule means.
 *
 * This test exists because the audit it encodes was originally done by hand, with
 * greps, over two rounds — and round 31's first pass produced "ten validation
 * rules exist only in the UI", which was wrong nine times out of ten. Four of
 * those were a regex too narrow to see a code emitted through a conditional
 * expression; three were enforced at another layer on purpose; two were rules the
 * backend enforces under a different name. A manual audit is a snapshot, and the
 * next validation code added would have made it stale silently.
 *
 * So: every code the UI can emit must either appear in the core validator, or
 * appear below with a named home and a reason. Both halves are checked, so an
 * exception goes stale the moment the core validator grows the check — which is
 * the direction drift actually happens in.
 */

// Paths are written repo-root-relative so the exception table reads clearly.
// Vitest runs with cwd = ui/, so the root is its parent. Getting this wrong is
// loud rather than subtle — every test in the file errors out identically, which
// is exactly what the first two versions did (ui/ui/src/..., then ui/crates/...).
const repoRoot = join(process.cwd(), '..');
const read = (relative: string): string => readFileSync(join(repoRoot, relative), 'utf8');

/** Codes the core validator does not emit, and where the rule actually lives. */
const ENFORCED_ELSEWHERE: Readonly<Record<string, { file: string; why: string }>> = {
  'unsupported-schema-version': {
    file: 'apps/desktop-client/src/commands/topology/semantics.rs',
    why: 'a read gate on the contract envelope, not a graph rule — see the two '
      + 'independent schema-version axes in ADR #45 §2',
  },
  'warehouse-at-capacity': {
    file: 'apps/desktop-client/src/commands/topology/persistence.rs',
    why: 'an apply-path limit; the core validator has no view of live state',
  },
  'warehouse-missing-stock-routing': {
    file: 'apps/desktop-client/src/commands/topology/persistence.rs',
    why: 'an apply-path limit, same reason',
  },
  'unknown-wire-endpoint': {
    file: 'crates/oz-core/src/topology.rs',
    why: 'the CONDITION is enforced, under a different code: a wire pointing at a '
      + 'nonexistent node is refused as invalid-location-connection (probed, not '
      + 'inferred). A naming mismatch, not a gap — but the two surfaces do name '
      + 'the same defect differently, which the checklist work should reconcile',
  },
  'warehouse-tier-limit': {
    file: 'apps/desktop-client/src/commands/topology/commands.rs',
    why: 'the CONDITION is enforced by validate_warehouse_quota against the '
      + 'verified subscription tier inside apply_topology_diff, with its own test '
      + 'suite. The backend never spells the UI code string, which is exactly how '
      + 'this was misread as a client-only entitlement in the first audit',
  },
};

describe('topology validation code parity (TS ↔ Rust)', () => {
  const tsSource = read('ui/src/features/locations/topologyContract.ts');
  const coreSource = read('crates/oz-core/src/topology.rs');

  const tsCodes = [...new Set(
    [...tsSource.matchAll(/code:\s*'([a-z][a-z0-9-]*)'/g)].map((m) => m[1] ?? '').filter(Boolean),
  )];

  // Narrower than "any quoted string in the file", which is what this first used.
  // The looser form was checked by hand and happened to be correct — all 19 codes
  // it counted really are emitted — but "happened to be correct" is not a
  // property. A code appearing only as a comparison value, or in a comment, would
  // have been counted as enforced. So the extraction now mirrors what was
  // verified: strings inside a `topology_validation(...)` call.
  //
  // The window is generous rather than exact because a code can be emitted
  // through a conditional expression (`if is_kds { "missing-operation-input" }
  // else { ... }`) — the form the original hand audit's narrower pattern missed
  // entirely.
  const coreStrings = new Set(
    [...coreSource.matchAll(/topology_validation\(/g)]
      .flatMap((call) => {
        const window = coreSource.slice(call.index ?? 0, (call.index ?? 0) + 500);
        return [...window.matchAll(/"([a-z][a-z0-9-]*)"/g)].map((m) => m[1] ?? '');
      })
      .filter(Boolean),
  );

  it('extracts a meaningful set from both sides, so nothing below passes vacuously', () => {
    // A source-parsing test whose regex silently stops matching is worse than no
    // test: it reads like coverage. Same guard topologyContract.test.ts uses.
    expect(tsCodes.length).toBeGreaterThan(20);
    expect(coreStrings.size).toBeGreaterThan(20);
  });

  it('has a core check or a named home for every code the UI can emit', () => {
    const orphaned = tsCodes.filter(
      (code) => !coreStrings.has(code) && ENFORCED_ELSEWHERE[code] === undefined,
    );
    expect(orphaned, `codes with no backend enforcement and no justification: ${orphaned.join(', ')}`)
      .toEqual([]);
  });

  it('keeps every recorded exception still necessary', () => {
    // The drift guard. When the core validator grows one of these checks, this
    // fails and the exception has to be deleted — so the table cannot quietly
    // accumulate entries that no longer describe reality.
    const nowInCore = Object.keys(ENFORCED_ELSEWHERE).filter((code) => coreStrings.has(code));
    expect(nowInCore, `exceptions now redundant, remove them: ${nowInCore.join(', ')}`).toEqual([]);
  });

  it('records exceptions only for codes the UI actually emits', () => {
    // Guards the other direction: an exception for a code that was renamed or
    // dropped is dead weight that misleads the next reader.
    const stale = Object.keys(ENFORCED_ELSEWHERE).filter((code) => !tsCodes.includes(code));
    expect(stale, `exceptions for codes that no longer exist: ${stale.join(', ')}`).toEqual([]);
  });

  it('names a real file for every exception', () => {
    for (const [code, entry] of Object.entries(ENFORCED_ELSEWHERE)) {
      expect(() => read(entry.file), `${code} points at a missing file`).not.toThrow();
    }
  });

  it('enforces the great majority of rules in the shared core validator', () => {
    // A ratio, not a count, so it survives both sides growing. If enforcement
    // keeps migrating out of the core validator into per-caller checks, this
    // drops and someone has to look at whether that is deliberate — the exact
    // shape of the two warehouse limits above, which are legitimate but are also
    // two more places a future caller can forget.
    const inCore = tsCodes.filter((code) => coreStrings.has(code)).length;
    expect(inCore / tsCodes.length).toBeGreaterThan(0.7);
  });
});
