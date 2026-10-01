<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file: 34 lines, and it is the shortest document this campaign has audited and probably the highest value-per-line in the repository. It exists because `AGENTS.md` carries a rule — no linter sees `.css` — and the rule is exactly the kind that is true, important, and routinely ignored. · THE PROOF IS CHECKED, AND IT HOLDS. The document claims no CSS linter exists in the repository, and that is verifiable rather than rhetorical: `ui/package.json` contains no stylelint, no prettier, no lint-staged and no husky, so the `lint` script can only be running eslint. The six walker suites it names as the replacement all exist as test files — the five grade token compliance, composed-rule-identical pairs, popup backgrounds, animation compliance and noise dithering, plus the separate reduced-motion escape suite. A method document whose named tools have all been renamed or deleted would be the standard failure, and none has. · WHY IT MATTERS, and the reason is not stylistic. Without this page, an agent or developer editing a stylesheet runs the linter, sees it pass, and concludes the CSS is fine — and the linter genuinely passed, having graded nothing. That is a check that cannot fail, which is the same failure mode the tablet-driving record in this campaign identified in a completely different context: a measurement that reports success regardless of the truth. Two documents in this repository now name that pattern independently, which suggests it is the characteristic hazard here. · IT ALSO DOES THE THING THAT MAKES A METHOD DOCUMENT TRUSTWORTHY, which is state its limits. The caveats section says each suite grades a fixed set of shapes rather than the whole sheet, and instructs the reader to say plainly that no linter saw the file and to say so when an edit introduces a property none of the suites asserts. A method page that oversold its coverage would produce exactly the false confidence it exists to prevent. · The reduced-motion case being called out as a SEPARATE shape — the five walkers do not grade it, so it needs its own run — is the kind of boundary that only gets written by someone who has been caught by it. · NOT re-measured: whether the suites currently pass. That is a `vitest` run with a real dependency tree, and the document's own instruction to report the pass counts it prints implies it is the reader's job at the moment of use, not a claim cached in a document. That separation is correct. · No stamp existed; this is the first. -->
# Agent Ops Handbook — CSS Verification

> For the statement of the rules, read root `AGENTS.md` (one line: no linter sees `.css`).
> This page is the evidence and the caveats behind it.

## Why `eslint exit 0` proves nothing about a stylesheet

- No CSS linter exists in the repo: `ui/package.json` lint is `eslint .`, and neither its scripts nor `devDependencies` name stylelint/postcss/prettier/lint-staged/husky. `ui/eslint.config.js` has no `.css` glob or CSS processor, so ESLint prints "File ignored because no matching configuration was supplied" and exits 0 (measured: `cd ui && npx eslint src/features/sales/VoidOrdersScreen.css`).
- CI's `UI lint` step (`dev-ci.yml#ui-test`) runs the same `eslint .` and is blind the same way.
- No hook step sees stylesheets either: steps 2–7 of `.githooks/pre-commit` are extension-locked to `.tsx|.ts`, `*.ftl`, `migrations/*.sql`, `apps/license-server/*.go`; only step 1 (line endings) touches every path and it asserts nothing about content.
- History: since 2026-09-13, dozens of commits touching `.css` named `eslint` in the body — each also carried `.tsx` files where eslint genuinely graded the source. The false part is the reach: one surface verified, a second silently covered by the same clause.

## The replacement: five walker suites

```powershell
cd ui
npx vitest run src/__tests__/themeTokenCompliance.test.ts src/__tests__/composedRuleIdenticalPair.test.ts src/__tests__/popupBackgroundCompliance.test.ts src/__tests__/animationCompliance.test.ts src/__tests__/noiseDitherCompliance.test.ts
```

Report the pass counts they print, then state plainly that no linter saw the file. If the edit introduces a property none of the suites asserts, say that rather than implying coverage.

Reduced-motion escapes are a **separate shape** the five walkers do not grade, so run it too when the edit touches a `transition`/`animation` declaration that is `!important`:

```powershell
npx vitest run src/__tests__/motionImportantEscapes.test.ts
```

It flags any motion-enabling `!important` declaration that sits outside a `prefers-reduced-motion` block. Such a declaration outranks the blanket kill in `reset.css` — that rule is an `!important` longhand on `*` at specificity (0,0,0), so any `!important` declaration on a selector of ≥(0,1,0) wins the cascade and keeps animating for a reduced-motion user (WCAG 2.1 §2.3.3). Six such escapes existed until 2026-09-25 (`tokens.css` theme crossfade + KDS pill slide, `KdsScreen.css` switch and knob).

## Caveats

- Each suite grades a fixed set of shapes, not the whole sheet: `composedRuleIdenticalPair` and `animationCompliance`/`noiseDitherCompliance` print graded-of-composed denominators; `themeTokenCompliance` prints what it read, not what it skipped. A printed denominator is not a widened scope — animation never reads `transition` declarations (so a sheet full of `transition` bugs prints a perfectly green animation line; that gap is what `motionImportantEscapes.test.ts` was added for, and it covers the reduced-motion `!important` shape only, not jank or timing), and hardcoded (untokenised) shadows escape the dither gate by design.
- Walkers read the working tree through node `fs` with no channel to any revision: record which `.css` paths were dirty (`git status --porcelain -- '*.css'`) alongside any result, and never present a scoped green as a claim about a commit.
- CI is not blind to CSS: `dev-ci.yml#ui-test` runs `npm test` (gated on the `changes` router matching `^ui/` by directory), and `scripts/check.sh` runs the same suite locally. What is missing is a linter and a commit-time gate — closing that is a workflow edit plus a `scripts/gates.json` row, an owner decision this page does not propose.

> last audited 29-09-26 by docs-auditor
