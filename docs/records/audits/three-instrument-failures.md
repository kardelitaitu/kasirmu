# Three ways an instrument lied, and the tell for each (round 226)

## Why this record

Nine of the thirty-six records this session wrote name an error in the **measuring instrument**
rather than in the code — a proportion that matches the project's whole history (47 of 185 audit
records name one). Each of those nine explains its own case; none states the pattern, so the
pattern stays invisible to anyone reading one of them.

This is the consolidated version. It is worth its length because **the same three mistakes
recurred all session**, two of them within one round of each other.

## Class 1 — the matcher sees text, not syntax

A regex over source is a claim about characters, and it is wrong whenever the same characters
mean something else where they sit.

| Case | The matcher read | The truth |
|---|---|---|
| Round 180 | `role="tab"` inside `querySelectorAll('button[role="tab"]')` and inside a COMMENT | a selector string and prose, not attributes |
| Round 175 | `(?:test|spec)\.(ts|tsx)` matched the shorter `ts` branch from `.tsx` | 14 citations invented as dead |
| Round 218 | a `::before` with `transform: translate(-50%, -50%)` | the minus sign is a centring offset, not a hit-area reach |
| Round 224 | `data-testid="qris-mode-static"` searched literally | the spec writes `data-testid=\`qris-mode-${mode}\`` |

**The tell: the matcher's output contradicts what a sibling artefact already recorded.**
Round 224's scan said the QRIS pair was uncovered when round 191 had written a spec for it. That
contradiction is the signal — not the number itself.

## Class 2 — the probe read at the wrong moment

A UI probe is a snapshot, and a snapshot taken before a state settles describes a screen that no
longer exists.

| Case | The probe saw | The truth |
|---|---|---|
| Round 177 | `TABLE_COUNT=0`, looked broken | the tables had not loaded yet |
| Round 213 | `OPEN_SHIFT=0` | a shift WAS open; the row read *Close* |
| Round 214 | no toast, no dialog, "nothing happened" | the toast had already faded |
| Round 225 | `sel.locator('option')` → `[]` twice | the control is a custom dropdown; its options are in a portal while OPEN |

**The tell: "nothing happened" from a probe that has not been shown to be able to detect
"something".** Round 214 polled for a toast class after the toast's lifetime; round 225 looked
for `<option>` elements in a widget that has none at any time.

The corrective that worked, repeatedly: **read STATE, not absence.** Instead of "is the error
shown?", ask "what does the banner say?". Instead of "did the toast appear?", read the store the
action writes.

## Class 3 — the assertion passed for a reason other than its name

The most consequential, because it is green. A test that does not bind looks exactly like a test
that does until something is deliberately broken.

| Case | The assertion | Why it survived the mutation |
|---|---|---|
| Round 196 | merge destination's option COUNT | a count cannot see identity |
| Round 196 | `--available` carrying the source name | the plan already had four available tiles |
| Round 197 | `.tables-table--available` + `hasText` | `Table 1` is a substring of `Table 12` |
| Round 225 | "picking a terminal arms Save" | `computeRailsDirty` returns true on the ID alone, so the arm proves nothing about persistence |

**The tell: the mutation survives.** There is no other way to find this class — reading a passing
test cannot distinguish it from a bound one. The corrective in every case was to name the
**value that must change** and address its subject uniquely: by index captured before the action,
by testid, or by reading the store afterwards.

## The cross-cutting rule

Classes 1 and 2 are both **a negative result read as a fact about the subject when it was a fact
about the instrument.** The single habit that catches both: *before acting on an empty or
surprising reading, make the instrument find a case where the answer is known to be positive.*

Round 225 did exactly that in the end — called `listEdcTerminalsScoped` directly and got 2 rows,
which proved the mock fine and the probe wrong. That check takes one call and would have saved a
round.

## Verified

| Item | Result |
|---|---|
| Records consolidated | 9 from this session |
| Classes | 3, each with 3-4 instances |
| Source changed | none |
| New tests | zero |