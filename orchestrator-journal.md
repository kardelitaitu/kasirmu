# Orchestrator Journal — Tauri UI Improvement

## Goal Objective & High-Level Architecture
- Goal ID: goal-42260c8f-3c21-461e-8c2d-797fe2025ec7 (rev 1, max 12 rounds)
- Objective: carefully improve the Tauri UI (ui/ React front-end of OZ-POS) via scouted, delegated, verified workstreams; pathspec commits; never push.
- Repo: C:/dev/ozpos/0.0.35/oz-pos · branch 0.0.37 · hooksPath=.githooks (10 pre-commit gates ACTIVE)
- UI: React+TS in ui/src; features lazily registered via ui/src/features/*/register.tsx; ships in apps/desktop-client + apps/tablet-client; i18n @fluent/react (en + .id.ftl); a11y via eslint-plugin-jsx-a11y; CBM index "oz-pos" available.
- CONCURRENT AGENT ALERT (expanded 2x — re-check git status before every commit): other agent's dirty set = ui/src/api/license.ts, ui/src/components/StatusBar.tsx, ui/src/hooks/useAuthConnection.ts, ui/src/hooks/useSyncConnection.ts, ui/src/dev-mock/tauri-api.ts, ui/src/__tests__/useAuthConnection.test.tsx, ui/src/__tests__/StatusBarDegraded.test.tsx (new), ui/src/__tests__/connectionHealth.test.ts (new), ui/src/hooks/connectionHealth.ts (new), ui/src/locales/shared.ftl, ui/src/locales/shared.id.ftl, .gitignore, .prime/** (deletions), scripts/verify-agents-mirrors.py, apps/desktop-client+tablet-client/src/commands/*, crates/oz-core/*. ALL of these are OUT OF FENCE for our workers.
- OUR RULE: new i18n keys go in PER-FEATURE bundles (<feature>.ftl + <feature>.id.ftl), NEVER shared.ftl (contested). Verify dirty list with git status immediately before each commit; commit only with explicit pathspec.

## Live Execution Dashboard
| Agent | Assignment | Fence | Status |
|---|---|---|---|
| scout-1 | UI structure + design map | ro | DONE (dossier ingested) |
| scout-3 | Tests + verification harness | ro | DONE (dossier ingested) |
| scout-4 | UX/visual consistency | ro | DONE (dossier ingested) |
| scout-5 | History + known debt | ro | DONE (dossier ingested) |
| scout-2 | Quality gap hunt | ro | DONE (dossier ingested: production screens fully localized; 13 hardcoded aria/placeholder strings; 2 IPC-layer violations; 2 any's) |
| ui-coder-1 (f7a2011a) | WS-1 dead-token-refs | 9 css files (locations/memos/reports/settings/auth) | in-flight |
| ui-coder-2 (07f1f479) | WS-2 kds tokens + exit anims | features/kds/** (5 files) | in-flight |
| ui-coder-6 (5a1d99f8) | WS-6 lint/type hygiene + ratchet | 16 test/src files + Tooltip + baseline.json | in-flight |
| ui-coder-3 (7bcfd330) | WS-3 warehouse/inventory | WarehouseConsole.css, ShiftBar.{tsx,css}, 3 loading screens, inventory.ftl(+id) | in-flight |
| ui-coder-4 (3555bc32) | WS-4 sales css + modifier modal | PosScreen.css, CartPanel.brand.css, ItemModifierModal.{tsx,css} | in-flight |
| ui-coder-5 | cfd12398 + 59fab444 | COMPLETE — drag scoped to header (grip stays aria-hidden: keyboard reorder already existed in card menu; dragend must live on source element; no :has() for old webview); palette via exported readCSSVar with legacy hex fallbacks (jsdom byte-identical), TS2322 tuple leak fixed pre-commit after my heads-up; mission C verified no-op (0 type-position any in analytics); declared deviations: 3 drag tests retargeted to header (assertions untouched), donut #fff literal kept (fixed-light --analytics-* surface invisible to :root readCSSVar); 193 scoped tests | COMPLETE |

Pre-audit evidence (round 5): Coder-1 working diff verified on-spec (59/59 line swaps, 9/9 fence files, e.g. SessionLockScreen.css --duration-120→--duration-100). Coder-6: 12/12 test files + 4/4 locations tsx + Tooltip dirty (in progress).

Queued briefs (fences reserved, dispatch when a slot frees):
- WS-5 analytics (coder-5): AnalyticsScreen.css + AnalyticsScreen.tsx (DRAG AFFORDANCE ONLY, grip-only drag per docs/plans/notes.md:35, lines ~1315/1332) + AnalyticsCardContent.tsx (20 hex) + analytics-cache.ts (the 'any') + analytics.ftl/.id.ftl if keys needed.
- WS-9 a11y (coder spare, NARROWED after direct verification): scout-2's auth/PIN i18n claims were FALSE POSITIVES — FastPINOverlay :477/:506/:575/:579, CreatePinScreen :116/:157, StaffLoginScreen :525 are all inside <Localized attrs> wrappers (keys in staff.ftl/staff.id.ftl, verified round 4). Remaining real items: FastPINOverlay.tsx:522-528 add role="presentation" tabIndex={-1} to overlay click-catcher + delete both eslint-disable comments (pattern = components/Modal.tsx:62-71, verified); TooltipPreview.tsx:348 is ALREADY a real <button> with localized aria-label (scout-2 wrong). Optional: dev-surface localization (TooltipPreview/DesignSystem/DevToolbar) — low user value; IPC-layer moves (SettingsContext:483 listen, ProductThumb:28 appCacheDir) — real, medium risk, wave-3 candidate.
- WS-8 modal exit gate (coder spare): components/Modal.tsx:62 snap-unmount; overlay styles in frontend/themes/components.css; 22 ConfirmDialog consumers inherit. Test surface pre-scouted: ui/src/__tests__/{Modal,ConfirmDialog,modalGuard,popoverSurfaceCompliance}.test.* — Modal.test.tsx:76/:135 assert not.toBeInTheDocument AFTER close, so the exit gate must either run with animDuration()===0 in jsdom (reduced-motion default) or tests need the established fake-timer/act pattern used by existing useExitAnimation consumers. Mirror the closest consumer's test handling; do not weaken assertions.

Mid-flight verification (round 3): whole-tree npm run typecheck GREEN (exit 0); ratchet verify-exhaustive-deps.py passes at cap 5; python 3.14.5 available.

Baseline evidence: typecheck CLEAN at session start; eslint 61 warnings (0 errors); scoped vitest works (Tooltip 35 tests, 1.19s).

## Synthesized DAG (from scout dossiers 1e,3,4,5 + lint baseline)

### Constraints (bind all coders)
- Gates: themeTokenCompliance baseline=0 (no new hardcoded values; var(#hex) fallbacks currently invisible), animationCompliance (reduced-motion), screenExtraction allowlists, FTL orphan+parity+i18n-lint, exhaustive-deps RATCHET scripts/verify-exhaustive-deps.py (cap 5; only Tooltip align is sanctioned to fix; KdsScreen:372 + StaffLogin:170 + NodeTopologyEditor:2220/3242 assessed-NO-TOUCH).
- Token truth: ui/src/frontend/themes/tokens.css. design-language.html token NAMES are demo-only. Dark = :root default, light = [data-theme=light].
- DO NOT TOUCH: other agent's dirty files (see alert) · KdsScreen.tsx:372 deps · NodeTopologyEditor.tsx (churn) · PosScreen.tsx:815 / RetailPosScreen.tsx:930 tax bug (product decision pending) · shared.ftl/shared.id.ftl.
- Commits: explicit pathspec only; never -a/amend/stash/push; conventional subject; if pre-commit fails on files we didn't touch (other agent WIP), STOP and report.

### Wave 1 (dispatched now, disjoint fences)
| WS | Coder | Fence (exact) | Scope | Commit plan |
|---|---|---|---|---|
| WS-1 dead-token-refs | ui-coder-1 | features/locations/TopologyRevisionBrowser.css, TopologyScreen.css, features/memos/MemosScreen.css, features/reports/CustomReportScreen.css (+ reports dir css), features/settings/WorkspaceSettingsModal.module.css, LicenseSettings.css, RoleAuthoringScreen.css, features/auth/SessionLockScreen.css, StaffLoginScreen.css | repoint 83 broken var() refs: --font-size-*→--text-*; --color-surface/-secondary/-hover→--color-bg-surface*; --color-text-primary/-tertiary,--color-muted→--color-fg-*; --color-error→--color-danger; --duration-120→--duration-100 or 150, --duration-250→--duration-200 or 300 (pick by usage). ZERO visual redesign. | fix(ui): repoint dead css token references to real tokens |
| WS-2 kds-polish | ui-coder-2 | features/kds/**: KdsScreen.css, components/KdsEnrollmentModal.{tsx,css}, KdsProductPickerModal.{tsx,css}, KdsDeviceStatusIndicator.css | hex/var-fallback→tokens migration preserving [data-theme=light] overrides + exit animations on KdsEnrollmentModal + KdsProductPickerModal per exit-animation-pattern skill (4 components each) | style(ui): migrate kds surfaces to design tokens; feat(ui): exit animations for kds enrollment and picker modals |
| WS-6 lint-typ-hygiene | ui-coder-6 | __tests__/{AuditLogScreen,BundleManagementScreen,DataManagementExport,EditProductModal,GiftCardsScreen,MemosScreen,PurchaseOrderForm,SuppliersScreen,TopologyApplyConfirm.characterization,useCanvasChart,useKeyboardAvoidance,usePullToRefresh}.test.{ts,tsx}, features/locations/topology{CanvasZoomControls,ContextMenu,Header,ToolRack}.tsx, frontend/shell/Tooltip.tsx, scripts/exhaustive-deps-baseline.json | CTI import-type conversions (~45 sites); Tooltip:171 add align dep; update ratchet baseline (remove Tooltip entry); verify ratchet green | test(ui): convert inline import type annotations; fix(ui): supply Tooltip align dep and update deps ratchet |

### Wave 2 (queued; fences finalized after scout-1/2 full dossiers)
- WS-3 warehouse+inventory: WarehouseConsole.css tokens+surface-refs, ShiftBar exit anim, TransactionLog/TransitAudit Loading→LoadingStatus (+ per-feature ftl + real .id.ftl translations)
- WS-4 sales: PosScreen.css, CartPanel.brand.css, ItemModifierModal tokens + exit anim
- WS-5 analytics: AnalyticsScreen.css + AnalyticsCardContent.tsx tokens + drag affordance (grip-only drag, a11y handle) per docs/plans/notes.md:35
- WS-7 (candidate): test-setup.ts global @/api/branding mock (kills 928 invoke logs) — needs broad vitest validation
- WS-8 (candidate): components/Modal.tsx exit gate (22 ConfirmDialog consumers inherit) — leverage high, needs popoverSurfaceCompliance check

## Completed Workstreams & Commit Ledger
| Worker | SHA | Scope | Status |
|---|---|---|---|
| ui-coder-1 | 5080ae95 | fix(ui): repoint dead css token references to real tokens — 9 files, 59/59 swaps, 61 dead uses (found 8 extra phantoms); fence deviations memo/ + staff/ (real paths); 3 documented judgment calls (fg-tertiary, border-dim collapse, duration-100); 933+281 scoped tests, typecheck x2, compliance gates green before+after | COMPLETE |
| ui-coder-6 | 3406a50e + 546f6756 | fix(ui): Tooltip align dep + ratchet 5→4 (2 files); test(ui): CTI conversions (16 files, 28+/22-) — eslint 0 warnings on whole fence verified by orchestrator QA | COMPLETE |
| ui-coder-3 | 9cf8fce0 | style(ui): repoint warehouse console css to real tokens — 1 file, 184/184 symmetric; --color-surface*→--color-bg-surface + fallback strips verified in diff | LANDED; token gates 71 tests green |
| ui-coder-2 | 47182b68 + d30d1635 + 145e0265 | COMPLETE — tokens (148 hex→8; dark-mode root-cause fix) + exit anims (controlled-component deviation, justified) + QR follow-up 145e0265 (fix(ui): pin kds qr pairing to scannable paper-white — root cause: qrcode.react SVG fill attrs drop var() to inherited black = solid square; literals + --color-pos-on-primary quiet zone; 2 files) | COMPLETE |
| ui-coder-7 | dc6687f3 + a986bc27 + 77b32e4c | COMPLETE — FastPIN backdrop a11y; shared Modal exit gate (useExitAnimation + trap released during fade; modal-overlay/modal-panel exit rules reduced-motion-gated; Modal/ConfirmDialog tests upgraded to waitFor — assertions preserved NOT weakened; ConfirmDialog inherits without edit); KDS popover surface registration | COMPLETE |

## Live Execution Dashboard — FINAL
All 8 coders COMPLETE. All 17 orchestrator-driven commits landed, fence-audited (git show --stat), ancestry-verified (git merge-base --is-ancestor), 10 pre-commit gates green on each. Zero fence violations across the entire session despite a concurrent agent (which landed 8 more commits of its own).

## Verification Gate Status — FINAL
- Typecheck: exit 0 (whole tree)
- Lint: 61 → 44 warnings (0 errors): consistent-type-imports 16→0; exhaustive-deps ratchet 5→4 (Tooltip fixed; 4 assessed survivors untouched); react-refresh (40) out of scope by design
- DEFINITIVE SCOPED SWEEP: 19 test files / 555 tests ALL GREEN over every touched area (token/color/forced-color/animation/reduced-motion/screen-extraction/loading compliance + Modal/ConfirmDialog/modalGuard/popover/FastPIN/KDS/ShiftBar/Analytics/ItemModifier/SettingsContext/Tooltip)
- Token system: 0 phantoms introduced (KDS aliases verified); 0 new hardcoded values (themeTokenCompliance baseline 0 held)
- i18n: no keys added (bundles untouched); i18n-lint green
- Known follow-ups recorded in coder journals: --color-paper token proposal (QR quiet zone smell), module-load palette resolution vs mid-session theme switch (pre-existing pattern), 42 dead mock keys, test-setup.ts:63 stale comment
| ui-coder-4 | d9a7b0d7 + 06cb7988 | COMPLETE — tokens (58 fallback values stripped; zero repoints needed — scouted dead names matched zero occurrences in sales; CartPanel.brand.css documented no-change: hexes are comment-block deployer recipes) + exit animation (94+/9-; mirror keyframes, sync-onClose deviation documented because 3 tests outside fence assert synchronous close; trap suspended while exiting; animDuration timer). 255 scoped tests, gates green, no skip flag | COMPLETE |
| (other agent) | 32e474b5, 04407b60 | test(ui) tools-IA parity test + docs(audit) — not ours, audited for fence safety | observed |
| ui-coder-3 | 9cf8fce0 + 8ab57a0a + 36fcc7d8 | COMPLETE — warehouse tokens (143 fallbacks dropped, 8 undefined names repointed, --animation-play no-token candidate documented); ShiftBar exit anim (TDZ bug caught by its own test pre-commit); loading states DEVIATION evidence-backed: sites were already <Localized id=inv-loading> (scout false-positive class) — real fix was a11y semantics (role=status/aria-live/aria-busy + LoadingStatus on 2 screens); FTL untouched (specs outside fence pin copy; orphan gate stays green). 54 scoped tests + i18n lint + typecheck green; honored typecheck gate during another agent's breakage | COMPLETE |

### Final sweep state (round 12)
- Batch compliance gate: 6 suites / 224 tests GREEN over all landed CSS+animation work.
- Typecheck RED transiently: TransactionLogScreen.tsx JSX-comment-inside-ternary (TS1005@214) — exact fix relayed to coder-3; must be green before its commit (pre-commit gate 9 also blocks it).
- Lint: 46 problems (2 errors = the same transient file; 44 warnings = 16 CTI fixed, deps ratcheted 4, react-refresh out of scope).
- Round-12 incident chain (all handled): (1) coder-3 TransactionLogScreen JSX-comment-inside-ternary TS1005 — exact fix relayed, coder-3 healed + staged 3 screens 13:11; (2) coder-5 palette tuples (readonly [token, hex]) leaking into a string-typed field at AnalyticsCardContent :939/:1115 TS2322 — diagnosis relayed, coder-5 fixing; coder-4 BLOCKED on whole-tree tsc for commit 2 — told to HOLD, no OZPOS_SKIP_TYPECHECK.
| ui-coder-7 (8e03210b) | WS-8+WS-9 | FastPINOverlay.tsx (role=presentation, delete disables) + Modal.tsx exit gate + components.css modal rules + Modal/ConfirmDialog/modalGuard/popoverSurface tests | in-flight |
| ui-coder-6 | 3406a50e + 546f6756 | COMPLETE — 16 CTI→0 (two shapes, verified legal via throwaway tsc check), Tooltip align dep + ratchet 5→4; blast radius: 228 direct + 586 topology + 262 tooltip-consumer tests; corrected baseline arithmetic (61 = 16 CTI + 40 react-refresh + 5 deps); journal left untracked deliberately (fence discipline) | COMPLETE |
| ui-coder-8 | 2a9c733a | COMPLETE — refactor(ui): route tauri event and path calls through the api layer (8 files, +109/-53): onSettingsUpdated in api/settings.ts (two-tier browser-dev fallback preserved), api/cache.ts getAppCacheDir; zero @tauri-apps/api outside api/dev-mock/__tests__; 63 tests, eslint 0/0 on 8 files; documented deviation: a11y SettingsPage test mounts SettingsProvider indirectly (3-line mock); noted plugin-updater/plugin-dialog imports are a different rule, out of scope | COMPLETE |
| other agent | 80a2168c | test(licensing): its own 3 files this time (sweep NOT repeated) | observed |

### INCIDENT (round 9, resolved without loss)
Concurrent agent ran git reset --mixed twice (35cf7fa3=reset HEAD~1, then reset to 108704d9) unwinding coder-6's 525a29f1 and coder-1's c0faee34. First 35cf7fa3 SWEPT coder-6's 16 CTI files into a licensing-test commit; after unwind everything re-landed cleanly within 90s as separate commits. Mixed reset preserved all content in the working tree. Lesson reaffirmed: pathspec commits only; re-check git log+status immediately before/after each commit.

## Verification Gate Status
- Typecheck: not yet run (ui/node_modules present)
- Scoped tests: not yet run
- Git audit: baseline dirty tree = other agent's; do not include in our commits
