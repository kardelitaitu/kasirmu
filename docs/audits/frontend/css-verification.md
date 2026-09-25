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
