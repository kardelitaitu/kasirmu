# ui-coder-12 Journal — theme-invariant --color-paper token

Branch: 0.0.37 (nothing created/switched, no stash, no amend, no push).
Fence (only files edited): ui/src/frontend/themes/tokens.css, ui/src/features/kds/components/KdsEnrollmentModal.css.
Skill loaded first: ui-components.

## Mission

Close the design-system smell recorded by ui-coder-2 (ui-coder-2-journal.md, follow-up line 217): the KDS QR
quiet zone (.kds-enrollment-qr-wrapper) was painted with var(--color-pos-on-primary) — a FOREGROUND token
standing in for a SURFACE — because at 145e0265 it was the only theme-invariant white in the system (verified
#ffffff in all three theme blocks: tokens.css :276 / :465 / :588). ui-coder-2 explicitly deferred the honest
fix to a future feat(tokens) change; this ticket is that change.

## Changes

### 1. ui/src/frontend/themes/tokens.css (+8 lines, :root block ONLY)

Added --color-paper: #ffffff; at the end of the Semantic: Surfaces block (right after --color-bg-subtle),
value column aligned with the rest of the block (col 28). Comment states the three load-bearing facts:
  - theme-invariant ON PURPOSE, like the --text-* scale — declared in :root only, never given a per-theme
    override (dark is the default so :root already carries the dark value; [data-theme='light'] and
    [data-theme='dark'] inherit it unchanged, which is exactly what a QR quiet zone needs);
  - meaning: the scannable-surface white — QR quiet zones, printed-code surfaces;
  - pairing rule: anything drawn on it takes --color-ink (also theme-invariant #000000), NOT --color-fg.
No per-theme override added anywhere — that would demote it to an ordinary surface and reintroduce the bug.

### 2. ui/src/features/kds/components/KdsEnrollmentModal.css (+10 / -5)

.kds-enrollment-qr-wrapper background repointed: var(--color-pos-on-primary) -> var(--color-paper).
Comment rewritten to explain why the quiet zone must be paper white in every theme, that --color-pos-on-primary
was the pre-token borrowing (and why that reads as a bug in a palette audit), that raw hex is not an option
(themeTokenCompliance baseline 0), and it preserves the reason the .tsx literals stay: qrcode.react writes SVG
fill PRESENTATION ATTRIBUTES, where var() never resolves (documented in 145e0265). KdsEnrollmentModal.tsx
untouched, per fence.

## Token-name / liveness audit the brief asked for

| Gate | Scope | Verdict for --color-paper |
|---|---|---|
| shadowTokenLiveness.test.ts | parses only --shadow* definitions, flags zero-alpha shadow geometry | Not a shadow token; no consumer rule exists there. Mine is consumed immediately anyway. PASS (4 tests). |
| themeTokenCompliance.test.ts | walks features/, frontend/, components/ CSS but SKIPS tokens.css by name (L419) and skips :root / [data-theme rules (L239) | Definition site exempt by design; consumer went var() -> var(), so my violation delta is 0. |
| topologyThemeParity.test.ts | phantom-token + light-resolution checks scoped to NodeTopologyEditor.css ONLY; accepts a token defined in :root OR light | No global token-name lint. Also proves a :root-only definition is the accepted shape in this repo. |
| colorContrastCompliance.test.ts | named fg/bg pairs in buildPairs() only, no exhaustive token enumeration | Unaffected — an opaque white joins no pair. |
| popoverSurfaceCompliance.test.ts | explicit POPOVER_SURFACES list; contains .kds-enrollment-modal (still --color-bg-popover), NOT the QR wrapper | Unaffected. PASS (3 tests). |
| utils/color.ts runtime injection | BRAND_PALETTE_PROPS (13 accent/primary props) + applyThemeContrasts() (10 named pairs) | --color-paper is in neither list, so no brand-palette or contrast override can touch it. |

## Verification

- npx vitest run themeTokenCompliance shadowTokenLiveness KdsEnrollment* popoverSurfaceCompliance topologyThemeParity
  (globbed first: there is NO src/__tests__/KdsEnrollmentModal.test.tsx — the four real files are
  KdsEnrollmentModalPure.test.ts, KdsEnrollmentAndStatus.test.tsx, KdsEnrollmentAddStation.test.ts,
  KdsEnrollmentCountdown.test.ts)
  - PASS: shadowTokenLiveness (4), popoverSurfaceCompliance (3), KdsEnrollmentModalPure (20),
    KdsEnrollmentAndStatus (3), KdsEnrollmentAddStation (12), KdsEnrollmentCountdown (9).
  - FAIL 3 tests, all in files OUTSIDE my fence, none naming my files:
    * themeTokenCompliance > all CSS values use design tokens — 8 violations, every one in
      ui/src/components/ImpersonationBanner.css (untracked new file from another agent: #fff, rgba() borders,
      1rem / 0.5rem / 0.875rem literals).
    * topologyThemeParity > uses only tokens that actually exist, and > resolves every colour token it uses in the
      light theme too — both report --color-surface, a phantom token used by NodeTopologyEditor (that agent's WIP;
      --color-surface is defined in no theme block).
    My diff is one :root token definition plus one var() -> var() repoint and cannot produce either failure.
    Retried after a delay: same 3 failures on the same foreign files, so it is in-flight work, not a transient
    race. Reported, not worked around — editing those files is outside my fence and would risk another agent's
    uncommitted work.
- npm run typecheck (from ui/): CLEAN (tsc --noEmit, no output). This commit stages no .ts/.tsx, so pre-commit
  step 9 does not even fire.
- git diff --stat: 2 files, +18 / -5 — exactly the fence.

## Commit

- 2a56f84f6108e4b2792b2d9be413334e79f50505 — feat(ui): add theme-invariant paper token for scannable surfaces
  (git merge-base --is-ancestor -> OK; git log -1 --stat -> exactly the 2 fence files, +18/-5)
- Pathspec-limited to the two fence files. At commit time the index held another agent's staged
  todo-refactor-topology.md and ui/src/__tests__/NodeTopologyEditor.test.tsx, so a bare commit would have
  swallowed them; git commit -- <paths> kept the commit to my 2 files.
- Post-commit re-run of the same scoped batch: 52 passed / 1 failed — the single failure is still
  themeTokenCompliance on ImpersonationBanner.css (foreign). colorContrastCompliance (69) and
  noiseDitherCompliance (8) also green, so the new token disturbed neither the WCAG pair scan nor the dither scan.
- tokens.css carries exactly one --color-paper definition (grep count 2 = 1 definition + 1 comment mention).

## Follow-ups for the orchestrator

1. --color-surface phantom in NodeTopologyEditor (topology agent) — reddens 2 topologyThemeParity tests until it
   becomes --color-bg-surface.
2. ImpersonationBanner.css hardcoded values (that component's agent) — themeTokenCompliance is baseline 0, so the
   whole-tree CSS gate stays red until it is tokenized. Not a pre-commit gate (vitest is not in the hook), so it
   does not block commits, but it will redden npm run test for everyone.
3. --color-pos-on-primary keeps ~20 legitimate FOREGROUND consumers (RetailPosScreen.css, KdsScreen.css,
   PriceOverrideModal.css, WarehouseConsole.css, ProductManagementScreen.css) — untouched; only the surface misuse
   moved. Anyone adding a new white SURFACE should now use --color-paper, never --color-pos-on-primary.
4. Optional generalisation of this fix (not built, out of fence): a lint that flags a token whose name carries
   on- or -fg appearing in a background: declaration — the general shape of the smell this ticket closed.

