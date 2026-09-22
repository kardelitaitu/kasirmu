# Setup Wizard — Audit & Review

**Date:** 2026-09-08 · **Scope:** `ui/src/features/setup/**`, its FTL keys, its CSS, its tests
**Verdict:** The **live** first-run path is healthy. The **9-step `SetupWizard.tsx` is not
reachable from any application entry point** — it is imported only by its own tests. That is
the headline finding, and it is a deliberate supersession (ADR #56 §2.3) that was never
followed through in the code, the docs, or the tests.

## Executive summary

**ADR #56 executed a retirement bottom-up and stopped halfway.** §2.2 deleted the three Rust
commands that persisted wizard state (`complete_setup`, `get_setup_status`,
`dismiss_setup_wizard`); §2.3 replaced the wizard's critical path with `ProvisioningFlow`. Both
halves of the backend decision shipped. What was left behind is the *front* half: an 839-line
`SetupWizard.tsx` with no mount point, a `WizardState` contract whose only consumer is
`vi.fn()`, and **49 passing tests that assert behaviour of a screen no user can reach.**

The live path (`ProvisioningFlow`) is genuinely well-built — offline is a hard honest block,
the tablet/desktop split is a shell flag rather than a prop, and a failed verification keeps
the code field so retrying costs no second email. The audit found **no defect in it**, one
missing test, and one whole dead sibling.

| Rank | Finding | Severity |
|---|---|---|
| F1 | `SetupWizard.tsx` + `.css` + `StepAccount.tsx` unreachable; 49 green tests guard a dead screen | 🔴 |
| F4 | `WizardState` → `onComplete` → nobody. Its persistence commands were retired, so the state is **unpersistable by design** | 🔴 |
| F2 | `StepAccount` nests `.setup-step-panel` inside the wizard's own → double animation | 🔴 latent |
| F3 | `setup-complete-desc` gets a translated preset name in an English sentence frame | 🟡 |
| F5 | `StepFeatures`'s `title` prop computed → passed → overwritten; prop is dead | 🟡 |
| F6/F7 | Naming drift; empty CSS rule; stale "8-step" doc on a 9-step array | 🟢 |

**Do not delete anything on this report alone** — F1 is a product decision, and
`components/LiveSetupPreview.*` is *live* (used by `FeatureToggleScreen`, route `features`) and
must survive any cleanup. The verified, deletion-safe set is spelled out in §2 F1.

---

## 1. What is actually live

| Surface | Files | Rendered by | Status |
|---|---|---|---|
| **ProvisioningFlow** | `ProvisioningFlow.tsx` (649 L), `ProvisioningFlow.css` | `AppShell.tsx:586`, `tablet/TabletAppShell.tsx:300` | **LIVE** — the real first-run gate |
| **SetupWizard** | `SetupWizard.tsx` (839 L), `SetupWizard.css`, `components/StepAccount.tsx` | **nothing** (tests only) | **DEAD in production** |
| **LiveSetupPreview** | `components/LiveSetupPreview.tsx` (215 L), `.css` | `FeatureToggleScreen.tsx:415` (route `features`) | **LIVE** — despite living in `setup/` |

Evidence — every non-test reference to `SetupWizard` across `ui/src`:

```
ProvisioningFlow.tsx:19 : import type { Preset } from './SetupWizard';   // type-only
```

That is a *type* import. No application file ever renders `<SetupWizard />`. The first-run
gate is an unconditional branch:

```tsx
// ui/src/app/AppShell.tsx:581
if (!setupKnownComplete) {
  return (<><LazyBoundary>
    <ProvisioningFlow onProvisioned={() => setSetupKnownComplete(true)} />
  </LazyBoundary></>);
}
```

`git log` confirms the intent: `9b5799a13 feat(setup): replace the wizard's critical path
with first-run provisioning (ADR 56 2.3)`. The replacement landed; the old component was left
standing.

The FTL bundle agrees that the wizard is history — `shared-ui/locales/settings.ftl:49`:

> `### First-run provisioning (ADR #56 §2.3). The flow asks three things and then provisions;
> the nine-step wizard's later stages became in-app settings on an already-working terminal.`

### ⚠️ One file in this directory is NOT dead — and it splits the deletion

`components/LiveSetupPreview.tsx` **has a second, live consumer**:

```tsx
// ui/src/features/settings/FeatureToggleScreen.tsx:415
<LiveSetupPreview selectedFeatures={activeFeatureSet} />
```

`FeatureToggleScreen` is a real registered page — `settings/register.tsx:21`
(`route: 'features'`, owner-only). So its header comment ("Embedded in SetupWizard (Review
step) and FeatureToggleScreen") is **accurate**, and it must be **kept** when the wizard is
deleted. Its own suite (`LiveSetupPreview.test.tsx`) stays with it.

The safe deletion set is therefore **`SetupWizard.tsx` + `SetupWizard.css` +
`components/StepAccount.tsx` + their four test files** — *not* the whole `setup/` directory.

---

## 2. Findings, ranked

### F1 — `SetupWizard.tsx` is production-dead but ships in the bundle (~1,700 LOC) 🔴

`SetupWizard.tsx` (839 L) + `SetupWizard.css` + `components/StepAccount.tsx` (214 L) are
never rendered by any application entry point. They are not tree-shaken: nothing marks the
module side-effect-free from the app graph, and five test files keep importing it, so the
source, the stylesheet, and the `setup-*` FTL keys only they read stay in the shipped bundle.
(`components/LiveSetupPreview.*` is **excluded** from this finding — see the note above.)

**Cost:** dead source that every reader must triage, a whole FTL namespace maintained in two
languages for a screen no user can reach, and 49 green tests that assert behaviour of a
component the product does not run — a false-green surface that will hide a real
`ProvisioningFlow` regression from anyone who trusts the suite.

**Fix:** delete `SetupWizard.tsx`, `SetupWizard.css`, `components/StepAccount.tsx`, and the
four test files that exist only for them (`SetupWizard.test.tsx`, `SetupWizardRender.test.tsx`,
`setupWizardFeatureLabels.test.ts`, `stepAccountCopy.test.tsx`, `setupWizardLandscape.test.ts`) —
**keep** `components/LiveSetupPreview.*` and `LiveSetupPreview.test.tsx`.

Then repoint the FTL cleanup. `LiveSetupPreview` reads `lsp-*` keys (not `setup-*`), but
`ProvisioningFlow` is a **much broader `setup-*` consumer than its name suggests** — an
enumerated grep of `ProvisioningFlow.tsx` yields **51 keys**, of which these `setup-*` families
must survive:

- `setup-provision-*` (title, desc, account-section, account-hint, account-required,
  offline-warn, mode-section, store-type, location-label, owner-name-label,
  owner-username-label, pin-label, pin-confirm-label, submit, success)
- `setup-mode-{local,linked}-{title,desc}`
- `setup-tab-{pair,email}`
- **`setup-account-*` (11 keys)** — `code, email, failed, google, linked, send, sending,
  tablet, verify, verifying, waiting`

That last family is the trap: `setup-account-*` reads like wizard-step copy (and the dead
`StepAccount.tsx` uses 10 of the same 11), but its live owner is `ProvisioningFlow`. **Do not
delete it with the wizard.** `setup-tagline` is also used by the wizard header only and should
go. Verify with `grep -o "first-run keys" ` before removing anything.

**Do not** delete on this report alone: this is a product decision. The wizard is a
planned-looking 9-step preset flow; someone may intend to re-mount it. But today it is
unreachable, and that should be either fixed or admitted.

### F2 — `StepAccount` renders a nested `.setup-step-panel` inside the wizard's own 🔴 (latent)

`SetupWizard.tsx:474` wraps every step in `<div className="setup-step-panel">`.
`StepAccount.tsx:81` opens **another** `<div className="setup-step-panel">` at its root.
On step 7 (Account) the panel therefore nests inside itself. Two consequences:

1. `SetupWizard.css:129` animates `.setup-step-panel` with `setup-fade-slide-in`. On step 7
   **both** nodes run the animation, so the account step fades and slides in twice.
2. `SetupWizard.css:643` `.setup-step-panel:has(.lsp-root)` — the landscape two-column
   rule — matches the wrong element when a nested panel contains the preview.

Every other step component returns a `<>` fragment; `StepAccount` alone returns a panel div.

**Fix (one line):** make `StepAccount` return a fragment like its siblings, or give it a
distinct class. Note this is **latent while F1 holds** — it becomes a real defect only if the
wizard is re-mounted.

### F3 — `SetupWizard`'s completion screen passes a variable the message ignores 🟡

`SetupWizard.tsx:433` sends `vars={{ preset: requiredLocalized(l10n, \`setup-preset-${preset}\`) }}`
to `setup-complete-desc`:

```ftl
# shared-ui/locales/settings.ftl:248
setup-complete-desc = Your { $preset } POS is configured and ready...
```

The message uses the **localized preset name string** where the sentence wants a plain word.
`requiredLocalized` returns the *translation*, so an Indonesian user setting "Restoran" gets
`"Your Restoran POS is ready"` — an English frame wrapped around a localised noun, and the
English case reads awkwardly too ("Your Simple Retail POS"). The component's visible fallback
text at `:434-436` already hardcodes `PRESET_NAMES[preset]`, so the FTL path and the fallback
disagree.

### F4 — `WizardState` is delivered to a callback nobody supplies — **the upstream that consumed it was deliberately retired** 🔴

`handleComplete` (`:364`) calls `onComplete?.({ preset, features, default_currency })`.
`onComplete`, `onSkip`, and `onLaunch` are optional props, and **no production caller passes
any of them** (F1). The entire `WizardState → default_currency` contract — the snake_case field
that `:330-331` carefully documents as matching the Rust backend — terminates in a `vi.fn()`.
I found **no code path that persists the user's chosen features or currency**. The wizard's
configured state is discarded on completion.

### F5 — `StepFeatures`'s `title` prop is computed then overwritten 🟡

`SetupWizard.tsx:632` builds `localizedTitle` from `setup-features-section-${sectionId}`, and
`636-638` passes it as the `{ $title }` variable to `setup-features-title`. But
`setup-features-title = { $title }` (`settings.ftl:128`) — an FTL message that is *only* a
variable. So the entire localisation indirection resolves to the value it was handed, and the
component's `title` prop is destructured but never read. The static `title` fields in
`STEP_FEATURES` are dead as well. The correct fix is for the component to emit
`setup-features-section-${sectionId}` directly and drop `setup-features-title`.

### F6 — Systematic FTL naming drift: `step-`/singular vs. the component's own ids 🟢

`STEP_IDS` (`:54-64`) builds `setup-step-store-type` … `setup-step-review` for the progress
dots, while the feature sections use `setup-features-section-*` (**plural** `features`) and the
account step's *own* heading is `setup-account-title`, not `setup-step-account` — even though
`setup-step-account` exists and is the dot's label. Both resolve, so nothing is broken; it is
consistent-but-confusing naming that makes "which key does step N show?" require two greps.

### F7 — Cosmetic / hygiene

- `SetupWizard.css:125` `.setup-step-panel { }` — an empty rule body.
- `SetupWizard.tsx:611` and `:683` — stray `</div>` trailing on the same line as the closing
  brace (`))}          </div>`). Formatting noise, survives `cargo fmt` because it is TSX.
- `SetupWizard.tsx:314-322` — the doc comment says "**8-step** Setup Wizard" and lists 8 steps;
  `STEPS` has **9** and includes Account and Review. Stale doc.
- `LiveSetupPreview.tsx:1` — the file's opening line is a lone space before the module doc.
- `LiveSetupPreview.tsx:103-107` — `WorkspaceIcon` re-checks a `known` array that duplicates
  the `WORKSPACES` keys already in scope, then delegates to the shared component.

---

## 3. What is genuinely well-built (ProvisioningFlow, the live path)

Worth saying plainly, because these are the patterns the dead wizard lacks:

- **Offline is a hard, honest block.** `isOffline` is read from `navigator.onLine` *and*
  kept current by online/offline listeners; the submit path refuses rather than failing
  opaquely mid-provision.
- **Tablet/desktop split is a shell flag, not a prop** (`StepAccount.tsx:24-33`). The comment
  explains *why* a prop would be wrong: a caller could re-enable a Google control that the ADR
  excludes on tablet. That is a correct refusal to over-parameterise.
- **Failed verification keeps the code field** (`StepAccount.tsx:41-43`), with a regression
  test whose comment names the exact user cost — "retrying costs no second email and no second
  rate-limit slot".
- **Rate-limit and expiry are surfaced**, pairing codes read as `XXXX - XXXX` Crockford, and
  an expired session offers a refresh rather than a dead end.

---

## 4. Verification performed

| Check | Result |
|---|---|
| `npx vitest run` on 5 wizard suites | **49 passed** (5 files) — green, but see F1 |
| Every wizard-referenced FTL id vs. `settings.ftl` + `settings.id.ftl` | **0 missing** in either bundle |
| Grep for non-test `SetupWizard` importers | **none** (type-only import in ProvisioningFlow) |
| `AppShell.tsx:581` first-run branch | renders `ProvisioningFlow` unconditionally |
| `setup-complete-desc` FTL body vs. call site | **mismatch confirmed** (F3) |
| `.setup-step-panel` in `StepAccount.tsx:81` vs `SetupWizard.tsx:474` | **nested** (F2) |
| Rust side: `complete_setup` / `get_setup_status` / `dismiss_setup_wizard` | **retired** (ADR #56 §2.2) — comments only remain |
| `navigator.onLine` mocked in any test touching `ProvisioningFlow` | **zero** — the offline hard-block is untested |

**Resolved during the audit:** `FeatureToggleScreen.tsx:415` **does** consume
`LiveSetupPreview` (route `features`, `settings/register.tsx:21`) — so that component is live
and stays. `ProvisioningFlow` owns the `setup-account-*` FTL family.

**Resolved — the F4 open question is closed.** There is **no** Rust-side persistence path for
`WizardState`, and this is by design, not by omission:

```
apps/desktop-tauri/src/commands/setup.rs:37-49   // Retired by ADR #56 §2.2
  complete_setup        REMOVED — "wrote the two booleans §2.1 retires
                                  (SETUP_COMPLETE, SHOW_SETUP_WIZARD), and nothing
                                  called it once the first-run path became
                                  provision_device (§2.3)"
  get_setup_status      REMOVED — the forgeable boolean read
  dismiss_setup_wizard  REMOVED — the Skip escape hatch
```

`crates/kasirmu-bridge/src/setup.rs:387-394` carries the matching note, and the
replacement is `get_first_run_state`, which reads a provisioning row rather than a boolean
("a failed read cannot forge it, because an unreadable database yields no row").

So F1 and F4 are **the same fact seen from two sides**: ADR #56 §2.2 retired the Rust commands
that persisted wizard state, and §2.3 replaced the wizard's critical path — but the
`SetupWizard.tsx` component, its `WizardState` contract, and 49 tests that exercise the
now-orphaned `onComplete` callback were all left in the tree. The retirement was executed
**bottom-up and stopped halfway.**

---

## 5. Recommendation

1. **Decide F1 first.** Either re-mount the wizard behind a real route, or delete it and its
   49 tests. Leaving an 1,800-LOC unreachable flow guarded by green tests is the worst of the
   three states — it costs maintenance and it *lies about coverage*.
2. If deleted, purge the `setup-*` FTL namespace down to the 30-ish keys `ProvisioningFlow`
   reads (§2 F1 lists the families), keeping `LiveSetupPreview`'s `lsp-*` keys. Re-point the
   dead test files at `ProvisioningFlow` rather than deleting the coverage outright.
3. F2/F3 are one-line fixes and should ride along whichever way F1 goes.
4. `ProvisioningFlow` needs **one added test**: the offline hard-block, which is its most
   important safety behaviour and currently has no direct assertion I could find.

*No code was changed by this audit.*
