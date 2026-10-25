# Agent Ops Handbook — Accessibility Coverage

> For the rule, read root `AGENTS.md` (ARIA labels on components; pass `eslint-plugin-jsx-a11y`).
> This page is the evidence behind what the axe suites actually grade, and what they do not.

## What `checkA11y` is

`ui/src/__tests__/a11y/axe-helper.tsx` runs axe against a rendered container and calls
`toHaveNoViolations()`. It therefore fails closed on any violation axe reports — a green
means "axe found nothing", not "the assertion was skipped".

36 suites call it. They all run under `npm test`: `ui/vite.config.ts` sets
`include: ['src/**/*.{ts,tsx}']` and excludes only `e2e/**` and `node_modules/**`, so the
`src/__tests__/a11y/` directory is inside the default run and is not skipped.

## The four rules the isolated suites mute, and where each one is actually graded

`axe-helper.tsx` disables four rules by default (`DISABLED_RULES`). The comment above that
constant used to say colour contrast and the landmark rules were "tested in E2E".
**That was false, and it was false in a way no gate could see** — it was a comment.
Measured 2026-10-25:

- `ui/e2e/` holds 109 files (about 40 specs) and contains **zero** occurrences of `axe`,
  `toHaveNoViolations` or `contrast`. `@axe-core/playwright` is not a dependency; the only
  axe package in `ui/package.json` is `jest-axe`, which is a unit-test tool.
- So no E2E suite has ever graded contrast, landmark structure, or anything else by axe.

Where the coverage really is:

| Rule | Graded by | Note |
|---|---|---|
| `color-contrast` | `ui/src/__tests__/colorContrastCompliance.test.ts` | Token pairs read from `tokens.css` for the three `THEMES` (Default/Dark, Light, Dark Solid), measured against WCAG AA floors (4.5:1 normal, 3.0:1 large). jsdom cannot compute colours, so axe's own rule cannot run — this suite grades the declared values instead. |
| `landmark-one-main` | `ui/src/__tests__/a11y/ShellLayout.a11y.test.tsx` | Re-enables the rule via `SHELL_GLOBAL_RULES` and mounts the real `AppLayout` / `TabletAppLayout`. |
| `page-has-heading-one` | `ui/src/__tests__/a11y/ShellLayout.a11y.test.tsx` | Same suite, same override. |
| `region` | `ui/src/__tests__/a11y/ShellLayout.a11y.test.tsx` | Same suite; the three shell cases include a modal-open state. |

## Caveats

- **`colorContrastCompliance` grades base tokens, not derived variants.** Its own header
  records this: the family's `-dim` and `-border` variants were ungraded until a floor was
  added for them, and a green there has never meant every variant is legible. A passing
  contrast run is a statement about the pairs the file builds, not about the whole sheet.
- **The shell suite stubs leaf components.** `StatusBar`, `UpdateBanner`, `StoreSwitcher`,
  `StockAlertBell` and `RoleBadge` are mocked with minimal accessible equivalents, so the
  landmark/heading result is about the SHELL's structure. Those leaves are covered by their
  own isolated suites, where the global rules are muted — so a landmark defect introduced
  inside one of them would not be caught by either suite.
- **`region` is not a reliable signal in isolated suites** and is muted for that reason:
  a component rendered alone is by definition not inside a landmark.
- Contrast in a real browser (composited colours, gradients, images behind text) is not
  graded anywhere. The token suite reads declared pairs. Treat a green as "the declared
  pairs meet AA", never as "the running UI is legible".

## How this was caught

Not by a gate. The claim sat in a comment for as long as it took someone to grep the E2E
tree for the word it named. The generalisable trap: **a comment that justifies a disabled
check by pointing at another suite is a claim about coverage, and coverage claims rot** —
the E2E suite never had the coverage, so the comment was wrong from the day it was written,
and every reader who trusted it inherited a false picture of what is tested.

Both sites are now corrected to name `colorContrastCompliance.test.ts` and
`ShellLayout.a11y.test.tsx` directly, and each names what it grades.

> last audited 25-10-26 by docs-auditor
