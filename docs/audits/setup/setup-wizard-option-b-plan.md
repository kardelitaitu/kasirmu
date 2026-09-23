# Setup wizard — decision record and plans

## ⚠️ DONE FIRST: the real defect was not the wizard

**Committed `6ac851dd4` — `fix(setup): derive the terminal's feature set from the chosen store type`.**

While planning, a live user-facing bug surfaced and was repaired before any wizard
decision was taken. `ProvisioningFlow` collected the merchant's store type at step 1
and then sent `features: []` unconditionally (`:259`), so **every freshly provisioned
terminal opened with no features enabled** — no kitchen display for a restaurant, no
cash, no barcode scanning. The preset string was persisted
(`provisioning.rs:622`) but nothing ever read it back.

Fixed by giving the preset→features fact its one owner and letting the asking screen
read it:

| Layer | Change |
|---|---|
| `kasirmu-core/src/features.rs` | `preset_registry(slug)` / `preset_feature_keys(slug)` — **sorted** at the boundary, because `enabled_features()` documents itself unordered |
| `kasirmu-bridge/src/setup.rs` | `get_preset_features` — pre-session, so no auth (a static table, not tenant state) |
| both shells | command + registration |
| `ui/src/api/settings.ts` | `getPresetFeatures` |
| `ProvisioningFlow.tsx` | submits the derived set; **degrades to `[]`** on lookup failure rather than stranding the merchant |

Deliberately **not** done in core: `ProvisionDeviceArgs::preset`'s doc (`provisioning.rs:332-338`)
says the derivation "lives with the wizard that asks the question", because re-deriving
it in core "would give the same fact two owners and let them drift". The fix honours that.

Verified: `tsc --noEmit` clean · lint 0 errors · 194 UI tests pass · 83 core + 8 bridge
Rust tests pass. A `mockFactorySurface.test.ts` gate caught the new export and was
satisfied by adding it to the factory rather than to `KNOWN_GAPS`.

**Consequence for the options below:** the TS `PRESET_FEATURES` is now provably
redundant — a subset of the Rust constructors, which are live and tested. Option A's
only stated cost (losing preset curation) is **void.**

---

# Option B — re-admit the SetupWizard post-login (plan)

**Status: SUPERSEDED — see the note above and the recommendation in §2.** Companion to `docs/audits/setup/setup-wizard-audit.md` and the
2026-09-23 amendment under ADR #56 §2.3.

---

## 1. What recon found (and it changes the plan)

Option B was scoped in the audit as "mount the wizard post-login and wire `onComplete`". Recon
shows the second half is largely **already built**, and the first half is smaller than assumed.

### 1.1 The wizard's feature toggles have a live, more capable twin

`FeatureToggleScreen` (route `features`, owner-only, `settings/register.tsx:21`) already:

| Capability | Wizard | FeatureToggleScreen |
|---|---|---|
| Toggle individual features | ✅ 27 keys | ✅ all 32 flags |
| Group features by category | ✅ 6 sections | ✅ **10 groups** (Core, Payments, Products, Staff, Hardware, Restaurant, Scaling, Reporting, Advanced) |
| Bulk enable/disable a whole group | ❌ | ✅ **`setFeaturesBulk` in one transaction** (`:250-278`) |
| Search | ❌ | ✅ |
| Live preview of unlocked nav | ✅ `LiveSetupPreview` | ✅ same component (`:415`) |
| Preset → feature-set curation | ✅ **`PRESET_FEATURES`** | ❌ |
| Default-currency selector | ✅ (review step) | ✅ `GeneralSection.tsx:178-196` — **already covered** |

**So the wizard's toggling UI is a strict subset of a screen that already exists and is reachable.**
Rebuilding it as a second settings screen would duplicate working surface — against the ladder.

### 1.2 `PRESET_FEATURES` is the one genuinely unique asset

I grepped: `PRESET_FEATURES` has exactly **2 references, both inside `SetupWizard.tsx`**
(`:180` definition, `:333` consumer). It is the only preset→feature-set map in the tree.
`ProvisioningFlow` sends a store *type*, never a feature set.

**This is the thing worth saving — not the wizard shell around it.**

### 1.3 The write path is live and permission-gated

- `set_features_bulk` (`crates/kasirmu-bridge/src/features.rs:133`) — transactional, returns the
  refreshed list, requires session + `SETTINGS_EDIT`.
- `ui/src/api/features.ts:45` — `setFeaturesBulk(sessionToken, keys, enabled)`.
- `Settings::set_default_currency` — verified live in `kasirmu-core`.

---

## 2. The revised recommendation

**Do not re-mount the 9-step wizard.** Recon does not support it:

1. Its toggle UI duplicates `FeatureToggleScreen`, which is live, richer, and already writes.
2. Re-mounting requires moving the wizard past the login gate on **both** shells — i.e. editing
   the boot order that ADR #56 §1 argues over and that ADR #41 §2.1 / ADR #54 §1.4 are cited as
   authorities for. That is the highest-risk surface in this area, for a screen that would
   immediately be redundant.
3. §2.3's "its later stages become in-app settings on a working terminal" is **already satisfied**
   in substance by `FeatureToggleScreen` + the settings route. The ADR's *intent* is met; only
   the literal component was left over.

**Instead, do the smaller thing that captures the real value:**

### Proposal — port `PRESET_FEATURES` into `FeatureToggleScreen` as one-click bundles

Add preset rows above the existing group list: picking "Simple Retail" enables exactly
`PRESET_FEATURES['simple-retail']` in one `setFeaturesBulk` call. Reuses:

- the existing `setFeaturesBulk` handler pattern (`:250-278`),
- the existing flash + toast feedback,
- the existing `LiveSetupPreview`,
- the existing route, nav entry, and permission gate.

New code: a constant (moved from the wizard) + one handler + one small UI block. **No boot-order
change. No new route. No new permission surface.**

Then **retire the wizard shell** (`SetupWizard.tsx`, `.css`, `StepAccount.tsx`, the 4 suites) —
which finally makes §3.1's deletion bullet true, with the one caveat now resolved: the asset it
uniquely held has been relocated rather than dropped.

---

## 3. What this means for the ADR

The amendment currently lists A (retire) and B (re-admit) and recommends B. Recon changes the
recommendation. A **third** option is what the evidence supports:

| # | Resolution | Verdict |
|---|---|---|
| A | Retire outright | Loses `PRESET_FEATURES` |
| B | Re-admit post-login | Boot-order risk for a redundant screen |
| **C** | **Port presets into `FeatureToggleScreen`, then retire** | **Recommended — captures the asset, deletes the rest, no boot-order change** |

---

## 4. Open questions for the user

1. **Confirm C over B.** B was the original recommendation; recon undercut it. C is strictly less
   risky and keeps the thing B was meant to preserve.
2. **Preset bundles in `FeatureToggleScreen`** — acceptable to add a curated one-click row, or is
   that scope creep for a settings screen?
3. **Step 8 (Account)** — the ADR already says "No account step" (§2.3). Confirmed for deletion?
4. ~~**`StepReview` / currency**~~ — **RESOLVED by recon: already covered.**
   `features/settings/sections/GeneralSection.tsx:178-196` renders the same default-currency
   selector and writes through `Settings::set_default_currency` (via `CurrencyContext`). The
   wizard's review-step currency picker is a **third** copy of a control that already exists in
   Settings and in the store-scoped path. Nothing needs porting.

**Nothing here is started. No code changed.**
