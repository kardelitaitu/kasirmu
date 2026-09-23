# Wizard retirement — RESOLVED

**Status: DONE. Option 1 taken and completed in `badd31d2e`.**

The blocker below was real and the inset gap it found was fixed rather than deleted around.
See "Outcome" at the foot for what the retirement actually required — it was larger than the
deletion set first estimated, and two live dependencies would have been broken by the naive delete.

---

# (Original blocker, kept for the record)

**Status: was STOPPED before deleting anything.** The deletion set is verified safe *except* for one
live contract the wizard's stylesheet is silently carrying. Deleting now would drop it.

Commits so far this session: `6ac851dd4` (preset derivation fix, D), `9ef032fb2` (plan doc).

---

## What is verified safe to delete

| Path | Evidence |
|---|---|
| `ui/src/features/setup/SetupWizard.tsx` | No production importer. Every external reference is a *comment*. <!-- dead-ref: ok: deleted by the retirement; table kept as the evidence record --> |
| `ui/src/features/setup/components/StepAccount.tsx` | Only referenced by `SetupWizard.tsx` (2 lines) and its own tests. <!-- dead-ref: ok: deleted by the retirement; table kept as the evidence record --> |
| `ui/src/__tests__/SetupWizard.test.tsx` | 27 tests for the wizard only. <!-- dead-ref: ok: deleted by the retirement; table kept as the evidence record --> |
| `ui/src/__tests__/SetupWizardRender.test.tsx` | 3 tests, wizard only. <!-- dead-ref: ok: deleted by the retirement; table kept as the evidence record --> |
| `ui/src/__tests__/stepAccountCopy.test.tsx` | 3 tests, StepAccount only. <!-- dead-ref: ok: deleted by the retirement; table kept as the evidence record --> |

**Already done, uncommitted:** `Preset` was the *one* real coupling — `ProvisioningFlow.tsx:19`
imported the type from `SetupWizard.tsx`. It has been relocated to `ui/src/api/settings.ts` beside
`LocationKind`/`ProvisioningMode`, and the import repointed. That edit is staged in the working
tree and **not yet committed** — it must not be lost.

## What is NOT safe yet — the blocker

`ui/src/__tests__/setupWizardLandscape.test.ts` (12 tests) pins **two** contracts by reading <!-- dead-ref: ok: test file deleted by the retirement; prose is the historical record -->
`SetupWizard.css` as its reference full-screen sheet:

1. the landscape media-query literal duplicated between CSS and `useOrientation.ts`, and
2. **the safe-area inset contract.**

Contract 2 is the problem. `ui/src/theme/tokens.css:395-399` states the rule:

> *Every FULL-SCREEN surface applies these itself, because they do not inherit through a component
> boundary: the shell (`tablet.css`) and the setup wizard (`SetupWizard.css`) — the wizard renders
> **instead of** the shell on a fresh device, so it inherits none of the shell's padding.*

Measured against the tree today:

| Full-screen surface | `--inset-*` uses | Status |
|---|---|---|
| `app/tablet/tablet.css` | 11 | covered |
| `features/setup/SetupWizard.css` | 2 | **DEAD** — no longer rendered |
| `features/setup/ProvisioningFlow.css` | **0** | **LIVE** — the actual fresh-device surface |

`ProvisioningFlow.css:37` uses a flat `padding: var(--space-8)`. It does **not** apply the insets.

**So the wizard's stylesheet is the last thing holding a rule that its live replacement does not
implement.** Deleting `SetupWizard.css` removes the only in-tree consumer of that contract besides
the shell, and `setupWizardLandscape.test.ts` would have to be deleted with it — taking the
assertion with it. The gap would then be invisible.

**This is a pre-existing defect, not one the retirement creates.** It is a consequence of the
half-done §2.3 collapse the audit found: the *sheet* was left behind, so the inset rule reads as
covered when it is not.

## The decision needed

**Option 1 — fix, then delete (recommended).** Add the inset padding to
`ProvisioningFlow.css`'s `.provisioning-container` (the `--setup-gutter`-style
`calc(var(--space-N) + var(--inset-*))` pattern `SetupWizard.css:22-25` already demonstrates),
repoint `setupWizardLandscape.test.ts` at `ProvisioningFlow.css`, then delete the wizard files.

- Confirms on-device: on a notched/handset-inset tablet the provisioning card currently risks
  sitting under the status bar or gesture bar.
- Cost: small CSS + a test repoint.

**Option 2 — delete anyway, record the gap.** Faster, but knowingly ships a full-screen surface
that violates a documented invariants rule, and deletes the test that would catch it.

**I recommend Option 1**, because Option 2 deletes the *evidence* along with the code — which is
exactly the shape of failure this audit has been unpicking all session.

## Not done (at the time of writing)

No files deleted. No inset change made. Awaiting the call. **Superseded by the Outcome below.**

---

## Outcome — committed `badd31d2e` (18 files, +283 / −2,641)

**Option 1 was taken: fix the inset gap, then retire.** The deletion was substantially larger
than the original estimate, because three live dependencies surfaced only while doing it.

### What the reconnaissance missed, and what caught it

| Discovery | What it would have broken | Guard that caught it |
|---|---|---|
| `AccountSetupGate.tsx` renders `StepAccount` (AppShell:641) | A **live** post-provisioning account screen | `tsc` — `Cannot find module StepAccount` |
| `StepAccount` styles come **only** from `SetupWizard.css` | The live screen's entire form, unstyled | `screenExtraction` dead-class walk |
| `orientationAdaptiveWalker` exempts `SetupWizard.css` **by name** | A vacuous licence; its own meta-test asserts an exemption must resolve | `orientationAdaptiveWalker` denominator test |

The first was the serious one. `StepAccount` is **not** dead — `AccountSetupGate` uses it — and my
audit had classified it as wizard-only. The naive deletion would have removed a live screen.

### Final change set

**Deleted:** `SetupWizard.tsx` (840 L), `SetupWizard.css` (656 L), and the 4 suites that tested
only them.

**Moved, not deleted:** `StepAccount`'s six form atoms (`.setup-step-title`, `-desc`, `-note`,
`-error`, `.setup-account-field`, `.setup-account-input`) → `ProvisioningFlow.css`, the sheet
`AccountSetupGate` already imports. Byte-identical.``

**Repointed:** `setupWizardLandscape.test.ts` → `fullScreenSurfaceInset.test.ts`, now grading the
live surface's real contract (it asserts the surface declares **no** orientation literal, which is
what ADR-0001 Slice 4 requires of a feature sheet).

**Fixed (the Option-1 blocker):** `.provisioning-container` now applies `--inset-*` via a
`--provisioning-gutter` custom property, matching `tokens.css`'s full-screen contract. It used a
flat `padding` before, so on an inset tablet the card could sit under the status or gesture bar.

**Empty'd:** the `SLICE_0_EXEMPT_SHEETS` carve-out. The tree now holds **zero** orientation rules
outside the shell — the state the fence wanted.

**Purged:** 143 orphaned `setup-*` FTL keys from both bundles (36 kept: the provisioning family
plus the `setup-account-*` keys `ProvisioningFlow` and `StepAccount` read).

**Updated:** four shrink-only ledgers (`themeTokenCompliance`, `popupBackgroundCompliance`,
`focusVisibleCompliance`, `touchTargetSizing`) and the `screenExtraction` SCREENS table, where
`StepAccount` gained its own entry.

### Verification

`tsc --noEmit` clean · `npm run lint` 0 errors · `npm run lint:i18n` no issues ·
`verify-bundle-parity` **0 missing** · `verify-ftl-orphans` **OK** · **494 tests pass** across
13 suites (incl. all five CSS walkers, `screenExtraction` 275, `i18nBundle` 20).

### A process note worth keeping

Two of my own FTL rewrites silently truncated the bundles mid-session, because the file-read tool
caps its response around ~1080 lines while `settings.ftl` is 1192. Both were caught by
`verify-bundle-parity` (378 then 90 missing keys) and restored from git. The final purge used
paged reads and asserted the exact line delta before writing. **Any future bulk edit of an FTL
bundle must page its reads and verify the delta.**


### Verification

tsx clean; lint 0 errors; lint:i18n no issues; verify-bundle-parity 0 missing; verify-ftl-orphans OK; 494 tests pass across 13 suites (all five CSS walkers, screenExtraction 275, i18nBundle 20).

### A process note worth keeping

Two of my own FTL rewrites silently truncated the bundles mid-session, because the file-read tool caps its response near 1080 lines while settings.ftl is 1192. Both were caught by verify-bundle-parity (378 then 90 missing keys) and restored from git. The final purge used paged reads and asserted the exact line delta before writing. Any future bulk edit of an FTL bundle must page its reads and verify the delta.
