# Two scanner regressions: the regex arm ate JSX, and interpolations were discarded

**Round 28 · 2026-10-11 · UI test infrastructure · sourceAudit**

Rounds 26-27 fixed the shared source scanner's handling of regex literals, then found a
compliance guard whose local stripper had the same flaw. This round asked which other
**directory-walking audits** re-implement stripping. Six do. The first one checked,
`unreadStateFlag.test.ts`, reported seven production flags as SET-BUT-NEVER-READ.

They were not. Chasing that false positive exposed **two defects in the shared scanner**,
one of them my own regression from round 26.

## The trail

`unreadStateFlag` guards against a control whose `useState(false)` flag is set but never
read. Routing it through the shared scanner produced seven offenders. Verifying the first
by hand:

```
Button.tsx
  79: const [spinnerExiting, setSpinnerExiting] = useState(false);
 135: className={`btn__spinner${spinnerExiting ? ' btn__spinner--exiting' : ''}`}
```

The flag **is** read at :135 — inside a template interpolation. That pinned defect 1.

## Defect 1 — template interpolations were discarded, not emitted

`stripCommentsAndStrings` skipped `${...}` without emitting its contents:

```
input : const c = `base${flag ? " x" : ""}`;
before: const c = ;                          // the expression vanished
after : const c = ${flag ? " x" : ""};     // emitted, braces balanced
```

An interpolation is **code**, not string content. Anything scanning for an identifier, a
class name or a call site was blind to interpolated code — which in a React tree is a
large fraction of real references. Fixed by emitting the interpolation verbatim, braces
included, so bracket-balancing consumers still see a matched pair (verified: `braces= 2 2`).

This alone cleared six of the seven false positives.

## Defect 2 — `</div>` was read as a regex literal (my own regression)

The seventh offender was `SalesHistoryScreen.tsx :: detailLoading`, whose read at :1646
is plain JSX. Binary-searching the source showed the read was absent from the stripped
output entirely, and the same code stripped correctly when the line was moved. Isolating
the difference:

```
input : x = 1; </div> {flag} </p> tail
output: x = 1; <> tail        // {flag} erased
control, same line without closing tags: preserved
```

`slashStartsRegex` — the helper **I added in round 26** — saw the slash in `</div>`,
found `<` where an expression may begin, and classified it as a regex literal. The
scanner then swallowed every character up to the next unescaped slash, which in JSX is
**the next closing tag**.

So for one round, every audit over JSX silently dropped the code between adjacent closing
tags. Fixed by returning false for `prev === '<'`, since a JSX/markup closing tag is never
a regex.

**This was found only because I insisted on explaining a false positive rather than
suppressing it.** The tempting fix for seven flags that look unread would have been to
exempt them. Two of the seven were real scanner bugs.

## Verification

| Check | Result |
|---|---|
| JSX arm removed | both new cases -> **red** (`expected 'x = 1; <> tail' to contain 'flag'`) |
| `detailLoading` count in stripped output | **1 -> 2** |
| `sourceAudit.test.ts` | **16 passed** (2 new) |
| `unreadStateFlag.test.ts` | **6 passed**, offenders **7 -> 0** |
| Scanner sweep (11 files) | **809 passed** |
| Wider stripper-adjacent sweep (9 files) | **547 passed** |
| ESLint / typecheck | **0 errors** / clean |

Typecheck caught three leftover probe files I had failed to delete (`tmpB`, `tmpIdx2`,
`tmpVerify2`), which is worth noting: a scratch file left in the tree is a finding, and
the compiler is what surfaced it. Removed.

## Method notes

- **A false positive from a guard is a finding about the guard's scanner.** Seven rows
  that should not exist led to two real defects in a shared primitive. Suppressing the
  output would have hidden both.
- Both defects share one shape: the scanner **removes more than it should** — interpolated
  code and code between closing tags. The round-26 regex fix caused the second; a fix to
  an over-removing scanner can itself over-remove, so each arm needs its own kill-tested
  case in both directions.
- Isolating defect 2 took many probes because I kept testing *shapes I guessed* rather
  than the file itself. The measurement that settled it in one step was binary-searching
  the source for the line where a known identifier's count dropped — locate by bisection,
  then minimise the reproducer.
- Two of my probes reported misleading results (`strippedGrowth=14` measured length, not
  presence; `linesCrudeErased=0` counted whole lines). A probe that measures the wrong
  quantity is worse than no probe, because it reads as evidence.

> last audited 16-10-26 by docs-auditor
