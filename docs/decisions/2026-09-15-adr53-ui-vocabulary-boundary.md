---
num: 53
area: architecture
title: ADR #53: The UI Vocabulary Boundary — what the application layer may say about a renderer
status: Proposed (2026-09-15) — measurements recorded, rule NOT written, owner decision pending; the Option A premise was corrected ~22:55, see Correction
---
# ADR #53: The UI Vocabulary Boundary

**Status:** Proposed 2026-09-15. Nothing here is implemented; the measurements are.
**Date:** 2026-09-15
**Recorded against:** branch `0.0.39` @ tip after `93c1738fd`
**Tags:** architecture, renderer, slint, tauri, gates, oz-bridge

> **Cite this record by filename, not by number.** `docs/decisions/README.md` documents that
> numbering has collisions; filename-plus-number is the only safe form.

> last audited 15-09-26 by Budak-Korporat

## Context

The product horizon is Tauri v2 across Windows/macOS/Linux/Android/iOS for years 1–3, Slint for
embedded and headless Linux, and possibly Slint or another renderer in years 4–5. The stated goal
is **separation between app and UI: the UI must be replaceable.**

Two pieces of that separation are already enforced:

- **ADR #49** moved command bodies into `crates/oz-bridge`, headless by dependency (no `tauri`,
  `gtk`, `webkit2gtk`), with events crossing the seam through `pub trait EventSink`
  (`crates/oz-bridge/src/ctx.rs:45,84`).
- **`5e4183fa5`** added rule `bridge-toolkit-purity` to
  `scripts/verify-architecture-boundaries.py`, so a toolkit dependency or reference in
  `crates/oz-bridge` now fails the gate. It was previously asserted only in prose.
- **`93c1738fd`** removed 23 UI-framework references from comments in 17 files across `crates/`
  and `modules/` (the `.tsx` caller citations and the "which React component to render" wording).

The open question this ADR exists to answer: **should a rule also forbid UI vocabulary in the
natural-language layer (comments and doc comments) of `crates/`, `modules/`, `platform/` and
`foundation/`?** That was item 1C of `todo-review-type.md`, deferred to last because a `--strict`
gate in `dev-ci.yml#static-gates` is shared blast radius.

## Measurements (all re-taken on this tree, 902 `.rs` files)

Every count below is taken **through `mask_comments_and_strings`**, the helper at
`scripts/verify-architecture-boundaries.py`, because that is what a code-scanning rule sees.

| Pattern | Raw | Survives the mask | What the survivors are |
|---|---|---|---|
| `window.` | 65 in 32 files | 24 | **All false positives** — field access on a tax domain struct named `window` (`window.effective_from`, `write.window.effective_to`) |
| `document.` | 76 in 6 files | **0** | The real ones are `document.getElementById(...)` inside Rust **strings**, in the untracked foreign crate `crates/qris-core` — exactly what the mask deletes |
| `react` (bare, no word boundary) | 50 in 15 files | 13 | **All false positives** — the domain verb `reactivate` / `reactivated` in test names and locals |
| `\bReact\b` + `.tsx` + `.css` + "component to render" | — | **0** | The 1B commit removed every genuine instance |

Two conclusions follow, and they pull in opposite directions:

1. **A word list is the wrong unit.** `window.`, `document.` and `reactivate` are all ordinary
   non-UI code. Any rule keyed on those words fires on domain code and is blind to the one real
   UI surface that exists (JavaScript inside string literals).
2. **A word list is also nearly free right now.** After 1B, the narrow pattern
   (`\bReact\b`, `.tsx`, `.css`, "component to render") yields **zero** findings — so it can land
   with **no baseline rows and no expiry clock**, which is the property that makes a gate cheap.

## Correction — the Option A premise was measured with the inverse instrument (added 2026-09-15 ~22:55)

**This corrects the sentence "yields **zero** findings" / "no baseline rows and no expiry clock" in
conclusion 2, the recommendation's "Because it lands at zero findings", and the last row of the table
above. Nothing else in this record is withdrawn, and no option is re-scored here.**

The table's last row (`:51`) reads **0** for `\bReact\b` + `.tsx` + `.css` + "component to render"
*through `mask_comments_and_strings`*. That helper **strips comments**
(`scripts/verify-architecture-boundaries.py:301-306`) while preserving code. Option A's subject **is**
the comments. So the row measures the layer the mask keeps, and Option A scans the layer the mask
deletes: the instrument is the inverse of the claim, and a zero through the mask says nothing
whatever about prose. Two further notes on that row, both visible without running anything: it is the
**only** row in the table whose **Raw** column is empty — the one number this option needed is the
one that was never taken — and it is the only row whose subject is a *layer* rather than a *token*,
which is why a token-shaped measurement could be substituted for it unnoticed.

**The falsifying command was already printed in this file, and running it takes one line.** The
`## Verification commands` block at the foot of this record carries
`grep -rn "\bReact\b\|\.tsx\b" --include="*.rs" crates modules platform foundation | grep -v "reactivate"`,
which tonight prints **17 lines**: the four comment sites named below, the extension array, and the
twelve string-literal citations in `platform/sync/src/queue_tests.rs`. So the premise was not merely
unmeasured — it is contradicted by a command this record instructs its reader to run, and the claim it
falsifies sits eight lines above that block. What the command *cannot* do is separate comment from
code, and that separation is the entire content of Option A; the record skipped exactly the step it
could not do by hand.

Re-measured with a comment-preserving inverse of that helper, over `crates modules platform
foundation --include='*.rs'` (902 files):

| Reading | Comment-layer hits | Sites |
|---|---|---|
| **HEAD `ceaafae01`** | **2** | `crates/oz-bridge/src/settings.rs:199`, `:200` |
| **Working tree, 22:51** | **4** | the two above, plus `crates/oz-bridge/src/settings.rs:157` and `crates/oz-bridge/src/settings_tests.rs:95` |

All four are `///` doc comments citing a `.tsx` path — the exact shape Option A forbids:

- `crates/oz-bridge/src/settings.rs:199-200` — `features/retail/RetailModals.tsx:375-389`,
  `RetailPosScreen.tsx:1274`
- `crates/oz-bridge/src/settings.rs:157` — `WorkspaceRestaurantPosSettings.tsx:100-111`
- `crates/oz-bridge/src/settings_tests.rs:95` — `WorkspaceRestaurantPosSettings.tsx:100-111`

**The two working-tree sites were written tonight, after 1B landed, by a lane that had no reason to
know this ADR exists.** `93c1738fd` stripped the app-layer comments at **12:49**; by **22:51** a lane
fixing `tax_rounding_mode` had added two new doc comments below the bridge citing `.tsx` files. That
is the regression Option A exists to catch, observed live inside the ten hours after the cleanup —
and it is the strongest argument for the rule in this record. It also settles a question the Context
leaves open: **1B was not sufficient on its own.**

**What this changes, and what it does not.** Option A does **not** land at zero findings. Adopted as
written tonight it arrives with a **2-row baseline** at HEAD, and would have arrived with **4** had
it been adopted an hour later — so the "no baseline rows and no expiry clock" argument is void, and
the cheapness claim rests on the rule's own ~4-line cost rather than on an empty baseline. Two honest
paths, and the choice is the owner's: **(a)** adopt Option A with a 2-row baseline, or **(b)** clean
the four sites first so the empty-baseline claim becomes true and then adopt. **Neither path is taken
here**; this section records a measurement, and no consequence in it is approved.

**Three adjacent numbers in this record have also moved, and only one of them bears on Option B.**
The path-shape census reads **46** under `crates modules platform` and **47** with `foundation`
(22 distinct paths, 12 of them `.tsx` in `platform/sync/src/queue_tests.rs`, as already stated) rather
than 44 — a 5% drift that changes no argument, since Option B was rejected on the *character* of the
sites (kept DTO-mirror citations, string literals a comment-masked scan cannot see) and not on their
number. The string-literal extension array this record cites at `settings_tests.rs:773` sits at
**`:826`** in tonight's working tree, because that file gained 53 lines after the citation was
written — this record's own demonstration that a line number into a live file is a timestamp, and
again not an argument either way.

**The number that does bear on Option B is one this record never had: how many of the cited paths are
dead.** `crates/oz-core/src/topology.rs:194` and `:203` both cite `ui/src/features/stores/topologyCard.ts`,
which does not exist; that pair is the concrete harm a path-shape rule would have caught. Re-measured
tonight, both lines read `ui/src/features/locations/topologyCard.ts` — the file moved and the citation
followed it — and `git cat-file -e HEAD:<path>` over every distinct path in the current census returns
**0 dead of 46 sites / 22 paths**. So the *one* demonstrated instance of the harm Option B exists to
prevent is closed, and Option B would tonight land at zero findings as well. That weakens Option B's
urgency without touching its merit, and it is recorded here because a proposal whose motivating example
has been repaired should say so.

Re-derive, do not trust:

```bash
git show HEAD:crates/oz-bridge/src/settings.rs | grep -nE '\.tsx|\.css|component to render'
grep -nE '\.tsx|\.css|component to render' crates/oz-bridge/src/settings.rs crates/oz-bridge/src/settings_tests.rs
for p in $(grep -rhoE 'ui/[A-Za-z0-9_./-]+\.(tsx|css|ts)' crates modules platform foundation --include='*.rs' | sort -u); do git cat-file -e HEAD:$p 2>/dev/null || echo "DEAD: $p"; done
```

### The alternative: a path-shape rule

Keyed on a `ui/**` token ending `.tsx`, `.css` or `.ts` inside Rust text:

- **44 sites** — 25 under `ui/src/api/*.ts`, 12 `.tsx`, 7 other `.ts`.
- The 25 `ui/src/api/*` citations are **DTO mirror references** — precisely the evidence a future
  `verify-dto-parity.py` (item 3b) would want to keep. Failing them is self-defeating.
- All **12 `.tsx` sites are in one file**, `platform/sync/src/queue_tests.rs:1694-1738`, inside
  **string literals** as evidence citations for where call sites live. They are not comments, and
  a comment-masked scan cannot see them at all.
- So the path-shape rule requires scanning text this checker deliberately discards, to flag
  citations that are arguably legitimate.

## Options

**A — Narrow comment-layer rule (recommended).** Add rule `ui-framework-vocabulary` that scans
**comments and doc comments only** (a new helper; the existing helpers remove comments, so this is
the inverse of both) for `\bReact\b`, `\.tsx`, `\.css` and "component to render", over `crates/`,
`modules/`, `platform/`, `foundation/`. Zero findings today, so it lands with an empty baseline.
**[[Premise corrected 2026-09-15 ~22:55 — it is not zero, and it does not land empty: see the
Correction section above. The recommendation's shape stands; its arithmetic does not.]]**
It catches the realistic regression — someone documenting a renderer-specific file or component
below the seam — and never touches code, so `window.`/`document.`/`reactivate` cannot fire.

One known site is deliberately **not** caught, and the ADR records rather than hides it:
`crates/oz-bridge/src/settings_tests.rs:773` lists `".css"` and `".tsx"` in a **string-literal
array** of file extensions. That is code, not a comment, so a comment-only rule cannot see it —
which is the correct outcome, since flagging an extension list would be a false positive.
Cost: ~1 new helper plus a rule, and the deliberate choice to inspect prose.

**B — Path-shape rule.** 44 sites, mostly citations we want to keep, living in masked-out text.
Rejected as the primary rule; worth revisiting only if item 3b decides the `ui/src/api/*`
citations should be machine-readable rather than prose.

**C — No rule.** Rely on ADR #49, `bridge-toolkit-purity`, and review. Cheapest, and defensible
now that the tree is clean; but nothing stops the 23 references from coming back.

## Recommendation

Adopt **A**, and adopt it only when the tree is quiet — the same reasoning that deferred it: a
false positive here is red CI for every agent in the checkout. Because it lands at zero findings,
it needs no baseline and carries no expiry debt, which is the whole argument for having done 1B
first.

**[[Corrected 2026-09-15 ~22:55: it does not land at zero findings, so it does carry a baseline —
see the Correction section above. The argument for having done 1B first survives and is in fact
strengthened; the "no baseline, no expiry debt" half of this paragraph does not.]]**

## Not decided here

- Whether `platform/sync/src/queue_tests.rs` should keep citing `.tsx` paths as string evidence
  (Option B's 12 sites). Left alone by 1B on purpose; if the ADR above is adopted, those are
  strings and stay invisible to it.
- Item 3b (`verify-dto-parity.py`), which would give the `ui/src/api/*` citations a machine-checked
  home instead of prose.

## Verification commands

```bash
python scripts/verify-architecture-boundaries.py --strict     # gate, expect exit 0
node --test scripts/__tests__/verify-architecture-boundaries.test.mjs
grep -rn "\bReact\b\|\.tsx\b" --include="*.rs" crates modules platform foundation | grep -v "reactivate"
grep -rnE '\bReact\b|\.tsx|\.css|component to render' --include='*.rs' crates modules platform foundation | wc -l
```
