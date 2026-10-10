// ── Guard: a flag that disables a control must have a way to be cleared ──
//
// Round 9 of todo-restaurant-pos-reliability.md found a class of defect rather
// than a single bug: FOUR `loadFailed` flags were added to gate Save and none of
// them could be cleared, so one transient read failure disabled Save for the rest
// of the session. Round 10 found the same shape in `app/UpdateBanner`'s
// `versionBlocked`, which was set once and never reset while its render branch
// returned EARLY — so the block outlived the condition that produced it.
//
// The rule this encodes: if a state flag can disable a control, the same
// component must contain a call that sets it back to a non-blocking value. A flag
// written in exactly one place is a latch by construction.
//
// ── WHAT THIS PROVES, and what it does not ──
//
// It proves the setter is never called with a value that could CLEAR the flag —
// every call passes the literal `true`, or there is only one call. It cannot
// prove a derived call (`setBlocked(expr)`) actually evaluates false, so a green
// run means "no flag is set to true and nothing else", not "every latch is
// fixed". The behavioural half is each component's own test; this is the floor.
//
// The ARGUMENT is read, not the call count. Counting calls flagged
// `app/UpdateBanner.tsx` immediately after its latch was fixed — a derived call
// can clear, so it is not a latch. Pinned by a self-test below.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(process.cwd(), 'src');

/** A flag whose name marks it as an error/blocked state. */
const FLAG_NAME = /(?:[Ff]ail\w*|[Ee]rror\w*|[Bb]locked\w*|[Ii]nvalid\w*)/;

/**
 * Find state flags that gate a `disabled` prop and are written from only ONE
 * site — i.e. latches. Returns "file :: flag" strings.
 *
 * Only `.tsx` is scanned: `disabled` is a JSX attribute, so a flag that gates one
 * cannot live in a `.ts` file.
 */
export function findLatchedDisabledFlags(text: string): string[] {
  const out: string[] = [];
  const decl = /const \[(\w+)\s*,\s*(\w+)\]\s*=\s*useState\(false\)/g;
  for (const m of text.matchAll(decl)) {
    const flag = m[1]!;
    const setter = m[2]!;
    if (!FLAG_NAME.test(flag)) continue;
    // Must actually gate a disabled prop, or it is not the shape at issue.
    if (!new RegExp('disabled=\\{[^}]*\\b' + flag + '\\b').test(text)) continue;
    // The ARGUMENT decides, not the call count. A latch is a flag only ever set
    // to the literal `true`. A call passing `false` clears it, and a call passing
    // an EXPRESSION (`setBlocked(blocked)`) derives it from its inputs — both can
    // un-block, so neither is a latch. Counting calls instead of reading arguments
    // flagged `app/UpdateBanner.tsx` immediately after it was fixed, which is how
    // this distinction was found.
    const args = [...text.matchAll(new RegExp('\\b' + setter + '\\(\\s*([^)]*?)\\s*\\)', 'g'))]
      .map((a) => (a[1] ?? '').trim());
    if (args.length > 0 && args.every((a) => a === 'true')) out.push(flag);
  }
  return out;
}

/** Production .tsx files under src/, minus tests and dev mocks. */
function collectTsx(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === '__tests__' || e.name === 'dev-mock') continue;
        walk(full);
      } else if (/\.tsx$/.test(e.name)) {
        out.push(full);
      }
    }
  };
  walk(SRC);
  return out;
}

describe('no state flag disables a control without a way to clear it', () => {
  // ── The detector must discriminate, or the empty result below means nothing ──
  it('flags a disabled-gating flag written from one site (the latch)', () => {
    const bad = [
      'const [loadFailed, setLoadFailed] = useState(false);',
      '<Button disabled={saving || loadFailed} />',
      'setLoadFailed(true);',
    ].join('\n');
    expect(findLatchedDisabledFlags(bad)).toEqual(['loadFailed']);
  });

  it('does NOT flag the same flag once it is also cleared', () => {
    const good = [
      'const [loadFailed, setLoadFailed] = useState(false);',
      '<Button disabled={saving || loadFailed} />',
      'setLoadFailed(true);',
      'setLoadFailed(false);',
    ].join('\n');
    expect(findLatchedDisabledFlags(good)).toEqual([]);
  });

  it('does NOT flag a flag DERIVED from its inputs (set from an expression)', () => {
    // `setBlocked(blocked)` recomputes on every effect pass, so it can clear.
    const derived = [
      'const [versionBlocked, setVersionBlocked] = useState(false);',
      '<Button disabled={versionBlocked} />',
      'setVersionBlocked(blocked);',
    ].join('\n');
    expect(findLatchedDisabledFlags(derived)).toEqual([]);
  });

  it('does NOT flag a flag that does not gate a disabled prop', () => {
    const unrelated = [
      'const [errorMessage, setErrorMessage] = useState(false);',
      '<span>{errorMessage}</span>',
      'setErrorMessage(true);',
    ].join('\n');
    expect(findLatchedDisabledFlags(unrelated)).toEqual([]);
  });

  it('scans a meaningful set of tsx files', () => {
    expect(collectTsx().length).toBeGreaterThan(50);
  });

  it('has no production latch gating a disabled control', () => {
    const offenders: string[] = [];
    for (const file of collectTsx()) {
      const text = fs.readFileSync(file, 'utf-8');
      for (const flag of findLatchedDisabledFlags(text)) {
        offenders.push(path.relative(SRC, file) + ' :: ' + flag);
      }
    }
    expect(
      offenders,
      'This flag gates a disabled control but is only ever set to TRUE, so once ' +
        'so once set it can never be cleared and the control is dead for the rest ' +
        'of the session. Add the clearing call (and a Retry affordance), or derive ' +
        'the flag from its inputs instead of latching it.',
    ).toEqual([]);
  });
});