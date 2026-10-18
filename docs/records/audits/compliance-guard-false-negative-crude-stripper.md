# A compliance guard with a false negative, found by asking who else re-implements the stripper

**Round 27 · 2026-10-11 · UI test infrastructure · noMinorUnitsInUxCompliance**

## The lead

Round 26 fixed `stripCommentsAndStrings` in the shared scanner, which read a regex
literal's inner slash as the start of a line comment and discarded the rest of that line.
It reported that the fix "likely unmasked others".

Checked first, and it had not: the shared scanner has exactly one production consumer
(`topologyHistoryEntryAudit`), which passes.

The productive question was the adjacent one: **who else re-implements comment stripping
instead of using the shared primitive?** A `grep` for line-comment regexes across
`ui/src/__tests__` found three:

| File | Stripper |
|---|---|
| `noMinorUnitsInUxCompliance.test.ts:122` | `.replace(/\\/\\/.*$/gm, '')` — scans **all** `features/` + `components/` |
| `loadFailureSeedsBaseline.test.ts:49` | `.replace(/\\/\\/.*$/, '')` — brace-depth counting over `src` |
| `mockTierParity.test.ts:131` | `.replace(/\\/\\/.*$/, '')` — scans **Rust** |

## The false negative, measured

`noMinorUnitsInUxCompliance` is a compliance guard: jargon like "minor units" must never
reach user-visible text. It strips comments, then tests every remaining line. Its crude
stripper has the same defect as the scanner had:

```
PROBE original= "const route = window.location.hash.replace(/^#\\//, '').split('?')[0];"
PROBE crude   = "const route = window.location.hash.replace(/^#\\"
```

Everything after the regex is erased. Three production files under the scanned roots
carry that shape — `settings/hooks/useSettingsHashSection.ts:77`,
`staff/StaffManagementScreen.tsx:247` and `:294` — so the blind spot is reachable.

**The decisive measurement** was a fixture with a genuine violation written after such a
regex, run through both strippers:

```
PROBE hitCrude= false   hitShared= true
```

Same content, opposite verdicts. The guard had a real **false negative** — a violation on
a line containing a regex literal went unreported.

I also checked the honest alternative before claiming a fix was needed: the crude stripper
erases 12,321 characters from `StaffManagementScreen.tsx`, but `linesCrudeErased=0` —
no whole line of code was lost, and no forbidden pattern currently sits in the erased span
(`forbiddenOrig=0`). So the exposure was **latent**, and the fixture above is what proves
it was reachable rather than theoretical.

## The fix

`noMinorUnitsInUxCompliance` now strips via the shared scanner:

```ts
const lines = stripCommentsAndStrings(content).stripped.split('\\n');
```

The scanner preserves newlines, so line numbers in the failure message still point at real
source lines — confirmed in the kill-test output, which named `Line 3` correctly.

## The test that did not guard anything

Three regression cases were added, and they **passed immediately** — the round-22 warning
sign, so they were kill-tested by reverting the audit to the crude stripper. **They stayed
green.**

The reason: they called `stripCommentsAndStrings` directly, pinning the shared scanner
(already correct) and staying blind to which stripper the audit body used. A test that
reimplements the thing it is meant to guard is the same failure this whole series has been
chasing.

Fixed by extracting `scanForForbiddenJargon(content)` and having **both** the per-file
loop and the regression cases call it. Re-kill-tested, and now correct:

```
× finds a violation written after a regex literal on the same line
AssertionError: expected [] to deeply equal [ 'minor unit(s)' ]
```

## Verification

| Check | Result |
|---|---|
| crude stripper restored in the helper | regression case → **red** |
| violation after a regex, crude vs shared | `false` vs `true` |
| `noMinorUnitsInUxCompliance` | **428 passed** |
| Scanner-adjacent sweep (8 files) | **790 passed** |
| ESLint / typecheck | **0 errors** / clean |

## Method notes

- **"Did my change unmask anything?" was the wrong first question; "who else duplicates
  this?" was the right one.** The fix's own consumer was clean. The value was in the three
  files that had copied the logic and would never receive the fix.
- The first version of the regression test was **decoration**. It went green on
  introduction, stayed green when the code it was supposed to protect was reverted, and the
  fix was to make it call the same function the audit calls. Extracting the scan step was
  what made the test meaningful — the helper is the seam.
- Two near-misses worth recording: the first kill-test fixture was a `.ts` file (only
  `.tsx`/`.jsx` are scanned) and the second put the violation inside a quote the scanner
  correctly strips. Both looked like "the guard is broken" and were my fixture being wrong.
  A kill-test that fails to fire must be diagnosed, not accepted as a passing guard — and
  equally, not reported as a defect before checking the fixture.
- `loadFailureSeedsBaseline` (brace-depth counting) and `mockTierParity` (Rust) were
  examined and left alone: no exposed line carries a brace after a regex slash, and the two
  comment-only hits in `dev-mock/` are inside block comments already stripped first. They
  remain duplication worth consolidating, recorded rather than silently changed.

> last audited 16-10-26 by docs-auditor
