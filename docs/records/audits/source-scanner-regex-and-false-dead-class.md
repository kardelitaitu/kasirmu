# The shared source scanner read a regex as a comment, and a dead class that was not dead

**Round 26 · 2026-10-11 · UI test infrastructure · sourceAudit**

## The lead

Rounds 24 and 25 each found a guard whose claim was broader than its assertion, and both
were found by *deleting the code the guard protected and re-running*. This round applied
that probe to the wider class: 143 test files read source text, too many to inspect one
by one. The leverage point is the one primitive they share —
`ui/src/__tests__/test-utils/sourceAudit.ts`, whose `stripCommentsAndStrings` every
source audit runs first.

Reading it raised a specific question: it handles `//`, `/* */`, `'`, `"` and
backticks, but **not regex literals**. A regex containing a slash — `/^#\//` — begins
with `/` followed by something that is not `/`… except the slash inside it is.

## Finding 1 — content after a regex-with-slash was silently discarded

```
PROBE1 input    = 'const a = x.replace(/\\//g, "-"); const b = 1;'
PROBE1 stripped = 'const a = x.replace(/\\'
```

The scanner read the regex's second `/` as the start of a line comment and dropped the
**rest of that line**. Scope measured precisely rather than assumed:

```
PROBE sameLineKept= false   nextLineKept= true
```

So the loss is confined to the remainder of the offending line — but that is enough to
matter, because the pattern occurs in production source with a trailing call:

| File:line | Exposed tail |
|---|---|
| `features/staff/StaffManagementScreen.tsx:247, :294` | `.split('?')[0]` |
| `app/AppShell.tsx:374`, `app/tablet/TabletAppShell.tsx:311` | trailing statements |
| `utils/app-error.ts:410` | a redaction `.replace(...)` |
| `api/client/client.ts:75` | `.replace(/\/+$/, '')` |

Measured on the real file, not a synthetic fixture:

```
PROBE splitCallInStripped= false   inOriginal= true
```

`.split(` was present in `StaffManagementScreen.tsx` and **absent** from what every audit
sees. Any guard scanning that file was blind to that code.

**Fixed** in `stripCommentsAndStrings` via a new `slashStartsRegex` helper implementing
the standard heuristic: a `/` opens a regex where an expression may begin (after `(`,
`,`, `=`, an operator, a keyword like `return`), and is division after something that
can end one (identifier, number, `)`, `]`, quote). Regex bodies are skipped honouring
`[class]` and escapes, then flags.

The first attempt was **wrong and caught by measurement**: I gated the branch on
`n === '/'`, which meant a plain `//` comment stopped being stripped at all
(`commentRemoved= false`). Corrected to `n !== '/' && n !== '*'`, and the inverse
direction is now pinned by tests so a future over-correction fails loudly.

## Finding 2 — a "dead class" that is not dead

With the scanner fixed, `screenExtraction.test.ts` reported:

```
AssertionError: Dead classes: btn: expected [ 'btn' ] to deeply equal []
```

I first assumed my change had surfaced it and set out to prove that. It had not:
running the same test with **HEAD's unmodified scanner** produced the identical failure.
It is pre-existing and independent of the fix.

The finding itself is a **false positive**, and proving that took following the class
rather than the message:

- `features/tables/TableManagementScreen.css:746` defines
  `.tables-detail-actions .btn { width:100%; justify-content:center }` — a descendant
  rule whose subject is `btn`.
- `TableManagementScreen.tsx:1335-1351` puts `<Button>` elements inside
  `<div className="tables-detail-actions">`.
- `components/Button.tsx:112-121` **prepends `btn`** to every className it renders.

So the rule matches live elements. The audit scans the screen's own TSX and cannot see a
class contributed by an imported component — a limitation the resolver states and tests
at `screenExtraction.utils.test.ts:515` (*"a callee imported from another file credits
nothing"*).

**Fixed** by declaring it, not by deleting the CSS:
`externalClasses: ['btn']` on the `TableManagementScreen` entry, with the reasoning
inline. This required two things to be true and both were checked:

1. the base rule lives at `theme/components.css:9`, **outside** the entry's own sheet —
   the condition the ledger case at `screenExtraction.test.ts:3486` enforces;
2. `externalClasses` was the right field at all.

I first also added a ledger entry, and the suite rejected it:
`expected [ 'TableManagementScreen: btn' ] to deeply equal []`. That was correct — the
ledger is only for values that **fail** the outside-the-entry check, and `btn` passes it.
Removed the ledger member; the count returned to 4 and all 323 cases passed.

## Verification

The stripper tests were written after the fix, so they were **kill-tested against HEAD's
scanner**:

| Test | Under HEAD's scanner |
|---|---|
| `keeps code that follows a regex literal on the same line` | **red** |
| the five preserved-behaviour tests | green (as intended) |

The exemption was **kill-tested by removal**: `Dead classes: btn` returns immediately.

- `sourceAudit.test.ts` **14 passed** (6 new), `screenExtraction.test.ts` **323 passed**,
  `screenExtraction.utils.test.ts` — 3 files / **382 passed**
- Wider scanner-consumer sweep: **12 files / 422 passed**
- ESLint **0 errors**

## Method notes

- **A shared primitive is the highest-leverage thing to probe.** 143 files read source
  text; one flaw in `stripCommentsAndStrings` reached all of them at once. Reading the
  helper's branches and asking *which token type is missing* took one step, where probing
  files one by one would have taken dozens.
- **"My change caused it" is a hypothesis, not a finding.** I believed the `btn` failure
  was mine. Re-running the single case against `git show HEAD:` of the file disproved it in
  one command — and the same trick later confirmed exactly which of the new tests were
  load-bearing.
- **A false positive is a finding about the checker.** The tempting fix was to delete
  `.tables-detail-actions .btn` as dead. It is live. Declaring it in the mechanism the
  audit already has (`externalClasses`, with a citation) fixes the report without
  destroying working CSS.
- The suite's own self-grading design did real work here: rejecting my unnecessary ledger
  entry is what taught me the difference between the two lists.

> last audited 16-10-26 by docs-auditor
