# A guard I mis-scoped, and the orphan it could not see — 2026-10-18

<!- - Audit stamp: 2026-10-18 - autonomous goal round 163 - status: 1 live rule violation
     fixed on a public origin, 1 orphan sweep added, 1 of my own leads REFUTED - branch:
     0.0.41 - commits: 5fc7bc7ce 493f06646 -->

<!- - Scope: followed the two leads round 162 named. The first one was wrong, and chasing
     it is what found the real defect. -->

## Lead 1 was based on a misreading, and I should have read the guard first

Round 162's record says the native-dialog guard "scans `ui/src/features` only", so sites
outside it must exist. That was a guess from memory. Reading the file shows
`sourceFiles(UI_SRC)` walking `ui/src` **recursively** and filtering only `__tests__`, with a
population floor of 200 files. The guard was never scoped to `features/`.

The prediction happened to produce a hit anyway, which is the uncomfortable part: I found a
real defect while looking in the wrong place for the wrong reason. The lesson is the same one
round 161 taught and I failed to apply immediately — **read the guard before reasoning about
what it cannot see.** A guess about a scanner's scope is worth nothing; the file is three
lines of reading.

## What is actually outside it, and why that matters here

The guard covers `ui/src`. Two other trees hold shippable front-end code: `website/src` and
`prototypes/`. `website/src` is clean. `prototypes/` was not.

`website/scripts/sync-dev-files.mjs` copies the whole repo-root `prototypes/` folder into
`website/public/dev/` with `cpSync(..., { recursive: true })`, filtered only on `node_modules`,
`.git` and `dist` — so **every tracked file under `prototypes/` is published at
https://kasir.mu/dev/.** That is the fact that turns this from a dev-folder tidy-up into a
deployed-surface question, and it is the reason the "dev-only" framing in
`themeTokenCompliance.test.ts` does not settle it: dev-only means no app shell boots these
pages, not that nobody can fetch them.

## The defect

`prototypes/kds-prototype-plugin.js:139` asked consent for overriding unchecked KDS items with
`window.confirm()`. The class the UI guard forbids — off-design, unlocalized, and it blocks the
event loop — sitting on a public origin where the UI guard cannot see it.

The sibling HTML page had already solved the identical problem in a styled modal, which its own
comment labels "P4: styled replacement for window.confirm". So the two copies had DIVERGED: the
maintained page moved off the native dialog and the plugin never did.

**Fixed by removing the native dialog without adding a dependency.** The button now arms on the
first tap and completes on the second, with the label changing to say so. A 201-line file that
nothing loads has no business growing a modal component, and a two-step tap is the standard
desktop-POS idiom this codebase already prefers elsewhere. `node --check` passes, and the file
has exactly one changed line.

## The orphan sweep, and the off-by-one I shipped first

Chasing the plugin's reachability produced a second finding: **nothing in the entire
repository references it.** `git grep` for its name returns nothing; it exports `apply(ctx)` and
registers through `slots.inject('tool.view.cordis', ...)`, and `git grep tool.view.cordis`
matches only inside the file itself — it targets a plugin-host API that does not exist here.

No guard covers file-level orphans, so `scripts/check-orphan-prototype-files.py` now does. Its
**first version was wrong and reported a false positive**: it assumed the `git ls-files` path
output was part of the corpus and tested `hits <= 1`, so `styles.css` — genuinely loaded by
`design-language.html:10`, exactly once — was listed as an orphan. The corpus is file CONTENTS,
so a file never names itself and the baseline is **0**, not 1. Corrected, and the measurement is
recorded in the docstring so the next reader does not re-derive it.

The sweep's own limit is printed rather than hidden: a name appearing only in PROSE counts as
referenced, because a text scan cannot tell a mention from a load.
`prototypes/kds-prototype-server.bat` is exactly that case — its one occurrence is a sentence in
a completed plan doc, and no page loads it. The report is a floor on the orphans, not an exact
count.

## What I deliberately did NOT do

I did not delete the orphan. The restructure plan (`done-todo-project-folder-restructure.md:243`)
names it as one of the ten intended files in that folder, so it is a component whose host wiring
was never completed rather than stray debris — and `git log --diff-filter=D -- prototypes/` shows
nothing has ever been deleted from that tree. Deleting someone's documented file on my own
authority would be the wrong call; the sweep now reports it every run, which is the right
pressure. The finding is recorded here instead.

## Evidence

- The reachability claim was measured four ways, not inferred: `git grep` for the filename
  (0 hits), `git grep tool.view.cordis` (only self), both HTML pages'' `<script` tags (inline
  or `app.js` only), and the sync filter (`node_modules`/`.git`/`dist` — no match).
- Sweep self-tested by injection: adding `<script src="kds-prototype-plugin.js">` to
  `kds-prototype.html` drops the report from 1 orphan to 0; restoring the file returns it to 1
  byte-identically.
- `node --check prototypes/kds-prototype-plugin.js` -> SYNTAX_OK after the edit.
- Tree-wide re-scan: `git grep window.confirm` across `prototypes`, `website/src` and `ui/src`
  now returns only comments and test stubs — no live call.
- Gates: website `npm run check` PASS (72 files, 1565 tests, 0 errors), UI `npm run lint` PASS
  (0 errors, 116 warnings), `npm run typecheck` PASS (0), full UI suite **815 files, 12966
  passed, 0 failed** — the green baseline from round 162 held.
- Commits: `5fc7bc7ce` (plugin) and `493f06646` (sweep), each verified with `git show --name-only`.

## Carried forward

The directory-level question this round opened but did not answer: **`prototypes/` is deployed
but only two of its files are reachable as pages** (`kds-prototype.html`,
`design-language.html`). `app.js`, `sw.js`, `manifest.json` and `styles.css` are loaded BY those
pages so they are fine, but the plugin and the `.bat` are not, and the sweep now says so on every
run. Whether the folder should keep shipping wholesale, or the sync should copy a page list
instead of `cpSync(recursive: true)`, is a real design question for whoever owns that tree.

For my own lane: the second lead from round 162 — grading the dither walk through the element
name — is still open and is the one with recurring evidence behind it, since every tripwire
breach in that file has been a symptom of the hand-synced both-sides rule.

> last audited 18-10-26 by docs-auditor
