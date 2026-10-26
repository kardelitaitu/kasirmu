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
| `landmark-one-main` | `ui/src/__tests__/a11y/ShellLayout.a11y.test.tsx` | Via `checkA11yDocument`, which targets `document.documentElement` — the rule matches only the `<html>` element, so BOTH a container-scoped and a `document.body`-scoped call are inert. See below. |
| `page-has-heading-one` | `ui/src/__tests__/a11y/ShellLayout.a11y.test.tsx` | Same suite, same override. |
| `region` | `ui/src/__tests__/a11y/ShellLayout.a11y.test.tsx` | Same suite; the three shell cases include a modal-open state. |

## The trap: page-level rules silently ignore a container

The three global rules are **not** graded by passing a container element, however the
options are configured. axe declares them with a selector that can only match the page
root:

| Rule | axe selector |
|---|---|
| `landmark-one-main` | `html:not(html *)` |
| `page-has-heading-one` | `html:not(html *)` |
| `region` | `body *` |

`checkA11y(container, SHELL_GLOBAL_RULES)` merges the caller's rules correctly — the
merge was never the problem — but the rule has nothing to match inside a `<div>`. axe
does not warn; the rule simply does not appear in `results.violations` or even in
`results.passes`.

### How it was caught (mutation, not inspection)

1. Convert the only `<main>` element in `ui/src/app/AppLayout.tsx` to a `<div>`.
2. Run `ShellLayout.a11y.test.tsx` — the suite named *"has exactly one main landmark"*.
3. **Result: 3/3 passed.** axe reported a `main` count of 0 and zero violations.

That is a check that cannot fail. The first attempt at the mutation was useless, and
worth recording as its own trap: converting only the opening tag made esbuild fail with
`Unexpected closing "main" tag`, so the suite went red for a **syntax error** and looked
like a successful mutation test. A red must be read, not just counted — the failure
message has to be the one you were trying to provoke.

### The fix, and the second half of it

`checkA11yDocument(options)` runs axe against the PAGE rather than a container. Two
corrections were needed, and the first one alone was not enough:

| Target | `region` | `landmark-one-main` | `page-has-heading-one` | verdict |
|---|---|---|---|---|
| `container` (`<div>`) | silent | silent | silent | inert — round 239 |
| `document.body` | **runs** | silent | silent | half-fixed — round 251 |
| `document.documentElement` | runs | **runs** | **runs** | correct |

`document.body` is a CHILD of `<html>`, and the two landmark/heading rules select
`html:not(html *)` — so they matched nothing and appeared in neither `violations` nor
`passes`. Only `region` (which selects `body *`) started running. Passing the `<html>`
element does make the two rules *select*, which is what the third row originally claimed
as a fix. **They still do not grade.** Measured on a clean tree (round 34):

```
PROBE passes=["region"] violations=[] incomplete=["landmark-one-main","page-has-heading-one"]
```

The `incomplete` node carries `none: ["error-occurred"]` with
`TypeError: document.elementFromPoint is not a function`. axe's `isModalOpen` helper
calls that method, **jsdom does not implement it**, and the throw lands in
`method: "page-has-main#evaluate"` — the check that carries `landmark-one-main` and its
heading sibling. So both rules abort on every page, in every suite, regardless of the
markup. The control confirms it: a document WITH an `<h1>` and one WITHOUT return the
identical `incomplete` bucket. Nothing in the DOM can move either rule out of
`incomplete`, so an assertion on them is not weak evidence — it is no evidence.

What this means for the helper: `checkA11yDocument` grades exactly one page-level rule,
`region`. That is still worth having (it is the only global rule that genuinely fires),
but the name over-promises. The structural assertions in
`ShellLayout.a11y.test.tsx` — exactly one non-empty `<h1>` — exist precisely because
`page-has-heading-one` cannot grade; they are the substitute, not a duplicate.

**The measuring tool then broke its own measurement.** Running the suite with the fixed
target produced `landmark-no-duplicate-main` failures on two of three cases — a real rule,
a real violation, and the wrong cause. The landmark count across one file's cases rose
**1 → 2 → 3**: each test left its `<main>` behind. `jest-axe`'s `axe()` wrapper calls
`mount()`, which does `document.body.innerHTML = originalHTML` whenever the element it is
given is not inside `document.body` — and `documentElement` never is. That assignment
detaches React's root, so the global `afterEach(cleanup())` in `test-setup.ts` finds
nothing to unmount and the tree stays mounted.

So the helper now calls **axe-core's own `run()`**, which accepts any element and mutates
no DOM. The suite passes 3/3, the rules genuinely run, and the mutation (converting
`<main>` to `<div>`) still reddens 2 of 3 with the genuine message:

```
[a11y:document] moderate: region — All page content should be contained by landmarks
```

A scoped run lists the rules that actually executed among its `passes` — that list is the
honest answer to "did this rule run", and a container-scoped run will not show `region`
there. The generalisable trap: **a test harness that rewrites the DOM can manufacture the
very violation it is asked to detect**, so a sudden duplicate-landmark failure after
changing a target deserves the question "is the tool the cause" before "is the component".

### Two consequences worth carrying

- **jsdom's `<html>` has no `lang`**, so `html-has-lang` fires on every document-scoped
  run. Declare `document.documentElement.lang = 'en'` in a `beforeAll` rather than
  muting the rule — muting it would also hide a real regression.
- **A rule in `passes` is evidence; a rule in neither list is not.** When adding any new
  global rule to a suite, assert that it appears in `passes` on a clean tree, or you are
  adding a comment.

## The other half: a promoted heading can break `heading-order`

`page-has-heading-one` being ungradable is not the whole story, and round 35 shipped a
fix that was half wrong before the second half caught it. Two screens had no page title:
`KdsScreen` (no heading at all — its only h3s lived inside the hamburger panel) and the
topology editor, whose title sat at `topologyHeader.tsx:47` as an **`<h2>`** under a
comment claiming that kept "h2 → h3 Palette Tools" intact.

That comment was **true**, and that was precisely the defect: the screen had no `<h1>`, so
the outline *started* at level two and a screen reader had no page name. Promoting the
`<h2>` to `<h1>` — the obvious fix — turned three previously-green axe cases red:

```
[a11y] moderate: heading-order — Heading levels should only increase by one
Expected the HTML found at $('h3') to have no violations
```

The editor's internal groupings are `<h3>` (tool rack, empty state). With no `<h2>`
between them and the new `<h1>`, the outline jumps 1 → 3.

**The lesson is not "don't promote headings".** It is that a document tree has an
invariant — every level must have its parents — and fixing the root without filling the
gap *moves* the defect rather than removing it. The complete fix is three parts:

| Part | Where | Was | Now |
|---|---|---|---|
| Page title | `topologyHeader.tsx` | `<h2>` (sr-only) | `<h1>` (sr-only) |
| Grouping between them | `NodeTopologyEditor.tsx` | *absent* | `<h2>` (sr-only, localized) |
| Editor's own groups | `toolRack`, `topologyEmptyState` | `<h3>` | unchanged — correct once 1 and 2 exist |

Two process notes from the same change, both worth carrying:

- **`heading-order` DOES grade under jsdom**, unlike `page-has-heading-one`. So this class
  of defect is genuinely caught — but only if some suite renders the whole screen. The
  topology a11y suite renders `NodeTopologyEditor` directly, which is why it saw it; the
  KDS suite renders only child components, so `KdsScreen`'s new `<h1>` needed its own
  assertion in `KdsScreen.test.tsx`.
- **Mutation testing named the fix.** Flipping the new `<h1>`s back to `<h2>` left all 129
  cases in the two suites green **before** the assertions existed and failed exactly 2
  **after** — the same test-sees-nothing pattern this document opened with, reproduced in a
  new place. Removing only the level-two heading then failed 4 cases: the structural
  assertion (`heading levels may only increase by one: expected 2 to be less than or equal
  to 1`) plus three axe cases. Redundancy here is deliberate: the structural case names the
  rule, the axe case proves it.
- **The new `<h2>` tripped `check-hardcoded-copy`** (`NodeTopologyEditor.tsx: 1 hardcoded
  string(s), budget 0`) on its first commit. A sr-only heading is still copy; it went
  through `topology-editor-sections` with an `id` bundle entry in the follow-up commit.

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

> last audited 26-10-26 by docs-auditor
