# A cross-file citation the line checker cannot see — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 183 · status: one stale cross-file
     citation repaired; the two BLOCKED headings in the plan corpus re-checked and both still
     valid; no device available · branch: 0.0.41 · commit: 9daffcd88 -->

<!-- Scope: sweep the plan corpus for the stale-heading class round 182 proved real. -->

## The heading sweep: 3 hits, 0 stale

Round 182 found a heading that said OPEN for 92 rounds after its fix. I generalised the check
across all **22** root plan files, matching any level-2..4 heading carrying OPEN/TODO/BLOCKED/
NOT FIXED/STILL. Exactly three hits, and I read all three rather than sampling:

| heading | verdict |
|---|---|
| `todo-docs-restructure.md:179` — A2 notes.md BLOCKED | **still valid** — blocked on another session committing that directory hourly; its own re-check instruction says to re-read a commit table |
| `todo-docs-restructure.md:910` — 8b step 6 STRUCTURALLY blocked | **still valid** — "structurally", with the reason |
| `todo-restaurant-pos-reliability.md:5786` — F40 device verification BLOCKED | **still valid**, and the sharpest of the three |

The F40 one is worth keeping because it draws a distinction the other two imply: *"a verification
that cannot run is not the same as a verification that has not run."* It records that the
instrument is healthy and the blocker is a **missing fixture** — the tablet has exactly one
workspace card ("Retail POS"), so the restaurant Payments screen is unreachable. That is
blocked-on-fixture, not unverified, and the heading says which.

So the class round 182 found is real but rare: one instance in 78 item headings. Not a pattern to
sweep repeatedly — recorded here so it is not re-swept without a new reason.

## What the sweep did find: a citation pointing at the wrong file position

While verifying the floating cart bar (a component on the always-visible restaurant bar, so
merchant-facing), I checked the citation its own prop doc leans on:

```ts
// RestaurantFloatingCartBar.tsx:13
* Table field renders on restaurant POS unconditionally (CartPanel.tsx:864), so
```

Measured:

```
CartPanel.tsx:864 -> "}}"                                       <- not the table field
CartPanel.tsx:898 -> "{(showTableNumberSetting || activeWorkspace ==="  <- the ONLY such site
```

The claim is true; the pointer had drifted 34 lines. And `:864` is not merely close to
wrong — it is the closing of an unrelated block, which is the shape that reads as verified.

**Why the line-number checker cannot catch this class.** `featureCommentPaths.test.ts` extracts
same-file citations and deliberately skips anything carrying a `name.ts:` prefix — that is
explicit at `:213`, and rightly so, since a path+line token is normally a claim about
ANOTHER file. The other pass in that suite resolves PATHS and finds them present; `CartPanel.tsx`
does exist. So a cross-file citation gets one of two checks — the path exists — and never the
other. **A cross-file line number is the one citation shape with no checker at all**, and this is
a live instance of it, not a hypothetical.

## What was verified, not assumed

- `orderType` genuinely reaches the component: `PosScreen.tsx:2397` passes it, so the
  dine-in-only table pill at `:91` is live and not an unreachable branch — the F49
  question, asked of this component.
- The component has real coverage: `RestaurantFloatingCartBar.test.tsx`, the a11y suite,
  and `RestaurantOrderTypeFieldConsumers.test.ts` — all green (22 passed of 23; the one
  failure is the known cross-lane `PosScreen` citation case, unrelated to this file).
- Bundle parity on the committed path: 0 missing keys.

## Evidence

- 22 plan files scanned, 3 heading hits, all three read in full.
- The drift: `:864` reads `}}`; `:898` is the only
  `showTableNumberSetting || activeWorkspace` site in the file — verified by grepping the
  whole file for the pattern, so there is no second candidate.
- The exemption that hides it: `featureCommentPaths.test.ts:213`, read in source.
- Committed as `9daffcd88`, one file, 1 line.

## Carried forward

1. **A cross-file line citation has no guard.** Either the line-number pass should stop skipping
   `name.ts:NN` when the name resolves to a file in this repo, or the class should be
   declared unguarded. Right now it silently reads as checked.
2. The round-177 Escape defect remains the top open reliability item, still blocked:
   `PosScreen.tsx` dirty at hash `ff144486f`, re-verified this round.
3. No Android device is attached (`adb devices` empty), so the tablet-verification lane
   — including F40 device confirmation — cannot run this round. Blocked on hardware, not tooling.

> last audited 18-10-26 by docs-auditor
