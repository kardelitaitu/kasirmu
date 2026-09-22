# Setup wizard + login/signup — state-of-the-art working notes

**Goal:** "our app should have a state-of-the-art setup wizard and login/signup system".
**Status:** in progress. Round 1 corrected a bad commit and landed one UX improvement.

---

## 1. What already exists (the objective is mostly satisfied — this is NOT a greenfield build)

The census below matters because the goal reads like a build and is mostly a **polish** job.

### Website (`website/`) — the merchant account surface
| Surface | File | Verdict |
|---|---|---|
| Signup | `components/SignupForm.tsx` (440 L) | **Strong.** Password + confirm, live strength meter mirroring the server policy (≥8 chars, ≥3 of 4 classes), region picker, OTP verification step, 409 handling for existing accounts. |
| Login | `components/AuthForm.tsx` (720 L) | **Strong.** Three routes: email OTP (self-signup), password, forgot-password with the server's 7-day cooldown. Google OAuth with state-expiry and refusal handling. |
| Supporting | `PasswordField`, `PasswordStrength`, `OtpInput`, `lib/passwordPolicy`, `lib/safe-next` | Present and factored. |

### App (`ui/`) — the terminal surface
| Surface | File | Verdict |
|---|---|---|
| First-run provisioning | `features/setup/ProvisioningFlow.tsx` (~700 L) | Functional: store type, shop/owner/PIN, mode selection, account linking (Google desktop, QR pairing + email code tablet), offline hard-block. |
| Staff login | `features/auth/StaffLoginScreen.tsx` (615 L) | Two-step username→PIN, rate limiting, last-login display, logo handling. |
| Other gates | `CreatePinScreen`, `SessionLockScreen`, `LicenseActivationScreen`, `RevokedScreen` | Present. |

**Conclusion:** the login/signup system is genuinely comprehensive. The gaps are in the
*first-run setup flow's* interaction polish, not in missing capability.

---

## 2. Gap census of `features/setup/` (measured, not asserted)

| Capability | Before this round |
|---|---|
| Offline hard-block | ✅ present (online/offline listeners) |
| Currency / timezone | ✅ sent (hardcoded 'IDR' / 'Asia/Jakarta') |
| **Inline validation feedback** | ❌ **ABSENT — fixed this round** |
| Owner username availability pre-check | ❌ absent (server validates, UI does not) |
| Back navigation between steps | ❌ absent (single-page form) |
| Progress indication | ❌ absent (single-page form) |
| Skip / "do this later" | ❌ absent |

### Fixed this round — inline PIN validation
`canSubmit` silently disabled the submit button on a short or mismatched PIN, so the merchant
saw a dead control with no explanation. Added:
- `setup-provision-pin-mismatch` and `setup-provision-pin-too-short` in **both** bundles.
- `pinError` state, gated so neither message appears before the user has typed enough to have
  the problem (a mismatch notice on first paint is an accusation, not help).
- `aria-invalid` + `aria-describedby` on the confirm field, and `role="status"` (not `alert`)
  because the message follows the user's own keystrokes.
- `.provisioning-field-error` + an `[aria-invalid='true']` border, so the signal is not colour-only.
- 4 tests: mismatch, too-short, silence-on-first-paint, clears-when-agreed.

---

## 3. ⚠️ Open coordination problem — uncommitted peer work

**Committed:** `7eb188f83` (FTL copy + CSS) — the three files only this session touched.
**NOT committed:** `ProvisioningFlow.tsx` and `ProvisioningFlow.test.tsx` also carry an
**active PIN-validation implementation** from this session, entangled with **another agent's
uncommitted** change:

> the peer flips the first-run default from `'local'` to `'linked'`, reorders the two mode
> cards so the linked card is first, and rewrites the mode copy.

Their FTL copy for that change is **already committed** (`setup-mode-linked-desc` etc.), but
their component change is not. Both changes occupy the same 14 hunks of one file.

**Combined state is verified green:** 12/12 tests, `tsc` clean, lint 0 errors, parity 0 missing.

**Why nothing was forced:** hunk-splitting one file between two authors is fragile, and
`git add` is banned in this checkout. Per AGENTS.md a pathspec commit records the
working-tree copy, so committing the file would file the peer's work under my message.

**Resume point:** once the peer commits their component change, commit
`ProvisioningFlow.tsx` + `ProvisioningFlow.test.tsx` on top. If they abandon it, the
PIN-validation hunks need re-applying to a clean file.

---

## 4. Round-1 correction (important)

The previous session committed claims that `components/StepAccount.tsx` was **live** because
`features/setup/AccountSetupGate.tsx` rendered it. **That file never existed in git history** —
it was another agent's transient scratch file, created and deleted within the session.

So the reasoning was false, and `StepAccount` was in fact **dead** (the retired wizard was its
only importer). Corrected in `7e917671d`: `StepAccount.tsx` deleted, its six now-unused CSS
atoms removed from `ProvisioningFlow.css`, and the false comments in three test ledgers and the
`screenExtraction` SCREENS table replaced with the accurate account.

**Lesson:** a file observed in the working tree is not evidence it is part of the product.
Verify against `git ls-files` / `git log -- <path>` before citing it as a live dependency.

---

## 5. Candidate next steps

1. ~~**Owner username availability pre-check**~~ — **INVESTIGATED AND REJECTED as a non-problem**
   (round 2). Two independent reasons:
   - `checkUsername` (`@/api/staff`) is deliberately **anti-enumeration**: its own doc says it
     "always returns `{ proceed: true }` — the pre-check never reveals whether an account exists",
     so it cannot answer an availability question by design. Wiring it here would either be a
     no-op or would defeat the property STAFF-06 introduced it for.
   - A collision is **impossible at first run anyway**. `provision_device` is a first-run-only
     path (the step-1 guard refuses an already-provisioned terminal), so it runs on a fresh
     install holding no users, and `create_owner_in_tx` cannot conflict.
   The gap was in my census, not in the product.
2. **Offline hard-block has no test** — the flow's most important safety behaviour is unasserted
   (no `navigator.onLine` mock in any suite touching it). Cheap and high value.
3. ~~**Currency/timezone are hardcoded**~~ — **NOT A GAP** (round 2). ADR #56 §2.3 names this
   explicitly as one of "two deliberate omissions from the flow": *"No currency or timezone field.
   The flow sends the preset's defaults. §2.3's 'evaluated, not interrogated' rule is the reason:
   the merchant answers a business question (what kind of shop is this) rather than a technical
   one. A later slice resolves them from the scope chain."* The hardcoded `'IDR'` / `'Asia/Jakarta'`
   at `ProvisioningFlow.tsx:288-289` is that decision implemented, not drift.
4. **Review the whole login surface for a11y** — the website auth islands are unaudited for
   focus order and error announcement.
