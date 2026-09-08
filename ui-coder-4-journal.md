# ui-coder-4 Journal — sales panel token migration + ItemModifierModal exit animation

Branch: 0.0.37 · Fence: PosScreen.css, CartPanel.brand.css, ItemModifierModal.tsx, ItemModifierModal.css

## Commits (verified ancestors of HEAD at write time)
| SHA | Subject | Files |
|---|---|---|
| d9a7b0d7 | style(ui): migrate sales panel css to design tokens | ui/src/features/sales/PosScreen.css, ui/src/features/sales/components/ItemModifierModal.css (65+/65-) |
| 06cb7988 | feat(ui): exit animation for item modifier modal | ui/src/features/sales/components/ItemModifierModal.tsx (+CSS exit block) (94+/9-) |

Both proven with `git merge-base --is-ancestor <sha> HEAD` per the orchestrator reset-guard protocol. Pre-commit: all 10 gates green (incl. step 9 UI typecheck on the staged TSX in commit 2; i18n lint, bundle parity 0 missing keys on both).

## Mission A — token migration outcome
- **PosScreen.css**: all raw fallback values stripped (34 hex + rgba values, 39 var() sites). **Zero repoints were needed** — every var name present was already a defined token in tokens.css (--color-success, --color-danger, --color-danger-bg, --color-danger-hover, --color-accent, --color-accent-hover, --color-accent-fg, --color-fg, --color-fg-tertiary, --color-bg, --color-bg-surface); the briefed undefined-name map (--color-surface to --color-bg-surface, --color-text-primary to --color-fg, --font-size-* to --text-*, --duration-120/250...) matched zero occurrences. The two-line P1-5 progressive-enhancement pairs (plain var() line + color-mix() override) were kept; only the raw fallback VALUES inside them were dropped.
- **ItemModifierModal.css**: all 19 hex fallbacks + numeric fallbacks (--font-weight-semibold 600, --font-weight-medium 500, --font-weight-bold 700, --radius-full 9999px) stripped.
- **CartPanel.brand.css — NO active-code change (deliberate).** The scouted "17 hex" are ALL inside /* */ deployer-recipe comment blocks (restaurant amber / tech-cool / monochrome / per-tenant examples); themeTokenCompliance strips comments before scanning, so they are baseline-neutral documentation vocabulary. Active code references only defined tokens (--color-accent*, --primary-600/700, --radius-*, --shadow-*) plus two rgba(255,255,255,0.12/0.18) white-glass inset highlights inside :root custom-property definitions (--cart-pay-shadow) — **no-token candidates, left per instruction** (deliberate brand cosmetics; the scanner exempts :root custom-property definitions; inventing a white-alpha token would be design-system drift). var(--color-accent-hover, var(--primary-600)) nested token fallback also kept (token-to-token, not a raw value).
- No-token candidates journaled: white-glass pay-button highlights (CartPanel.brand.css:83-86); z-index 100/110 raw values in PosScreen.css/ItemModifierModal.css (z-index is not scanner-checked and changing would alter stacking vs the --z-* ladder — flagged for a future scope decision, NOT changed); font-size 16px (documented iOS zoom-threshold exception) and 0.125rem sub-token gaps left as-is.

## Mission B — exit animation (ItemModifierModal)
- CSS: mirror keyframes modifier-overlay-out (exact reverse of modifier-overlay-in) + modifier-slide-down (exact reverse of modifier-slide-up); .modifier-overlay--exiting (animation-fill-mode both + pointer-events none, inherited by the panel) + .modifier-modal--exiting, source-ordered AFTER entry rules; existing prefers-reduced-motion: reduce block extended to cover both --exiting classes (file keeps its Pattern-B compliance; animationCompliance green). Class names static (modifier-overlay--exiting, modifier-modal--exiting) — screenExtraction green.
- TSX: conditional --exiting class strings on overlay + panel; requestClose() shared by backdrop / X / Cancel / Escape (focus-trap onEscape); trap suspended while exiting (open && !exiting); aria-hidden={!open} on overlay (WorkspaceSettingsModal precedent); render gate (open || exiting) = shouldRender semantics; animDuration(200) timer ref + empty-deps unmount cleanup + reopen-during-fade cancel effect (mirrors useExitAnimation) + re-entrancy guard.
- **DEVIATION (reasoned, not accidental):** did NOT consume the shared useExitAnimation hook directly. The hook defers onClose until after the 200ms fade; ItemModifierModal.test.tsx (:193-207, :267-273) asserts onClose SYNCHRONOUSLY after click and that test file is outside my fence (unmodifiable). Resolution: mirror the hook's internals exactly (exiting flag, animDuration(200) timer ref, reopen-cancel effect keyed on open only, unmount cleanup, shouldRender-style gate) but notify the parent synchronously inside requestClose(), letting the exiting flag keep the surface mounted through the fade. Single onClose call per dismissal; reduced-motion snaps via animDuration()===0. Confirm/Add-to-Order intentionally keeps direct onConfirm (forward "next state" flow = snap, per the hook's documented semantics). No new tokens, no new keyframe values, transform+opacity only.

## Verification evidence
- Scoped vitest (post-Mission-B, whole set): themeTokenCompliance, animationCompliance, screenExtraction (142), reducedMotion, ItemModifierModal (31/31), PosScreen, PosScreenCoreFlow (known it.skip left), RetailPosScreen → **8 files, 255 passed / 1 skipped**.
- Baseline before edits: 5 files, 184 passed (same suites subset).
- npm run typecheck from ui/: transiently red mid-session due to OTHER agents' WIP (inventory ThresholdConfigScreen/TransactionLogScreen mid-edit, then analytics AnalyticsCardContent) — never any error in my fence files; waited for whole-tree green (0 errors) before staging, per no-skip rule. Parent confirmed no OZPOS_SKIP_TYPECHECK. Commit 2's pre-commit step 9 re-ran typecheck on the staged TSX and passed.
- git status after both commits: my 4 fence files clean; remaining dirty files belong to other agents.

## Files NOT touched
CartPanel.brand.css (unmodified — see Mission A), PosScreen.tsx, PaymentModal*, CartPanel.tsx, retail/**, and everything in the DO-NOT-TOUCH list.
