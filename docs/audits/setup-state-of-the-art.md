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
4. ~~**Review the whole login surface for a11y**~~ — **IN PROGRESS, round 3.** The app-side auth
   screens were audited and a consistent defect found and fixed across all three (see §6).
   The **website** islands (`AuthForm.tsx`, `SignupForm.tsx`) remain unaudited HERE — another
   agent is working that surface (`website/src/lib/accessibility.ts`, `html-scan.ts`, and
   commit `a6e3bf49a build a pre-build accessibility gate`), so it is deliberately left to them.

---

## 6. Round 3 — the app-side auth surfaces: a failed input never marked the field

Three screens, one defect class, found by census then verified individually:

| Screen | Defect | Fix |
|---|---|---|
| `StaffLoginScreen` | A wrong PIN showed a CSS shake (invisible to a screen reader) + a toast. The PIN region itself never became invalid. | `aria-invalid` on the dots row, derived from the same condition the existing toast gate resets on. |
| `SessionLockScreen` | Same, **plus** its four dot spans had no `aria-hidden` while the login screen's did — so its row was announced and then four unlabelled elements inside it. | `aria-invalid` on the row + `aria-hidden` on the spans. |
| `CreatePinScreen` | The banner named the RULE ("All fields are required") but never which input broke it; no input was marked. | Validation now records the offending field(s); each bad input carries its own `aria-invalid` and error border, cleared as soon as that field is edited. |
| `LicenseActivationScreen` (round 4) | **The app's own email validation was DEAD**: no `noValidate` + `type="email"` meant native constraint validation refused to fire submit, so `handleActivate` never ran and `auth-validation-invalid-email` — translated in **both** bundles — was unreachable. The user got the browser's untranslated bubble. | `noValidate` hands validation to the app, whose branch already shows localized copy; plus the offending field is marked. |

**All four app-side auth screens now carry `aria-invalid`** (verified individually — StaffLogin 1, SessionLock 1, CreatePin 5, LicenseActivation 3 occurrences).

### Finding the dead branch was the point of the test

The round-4 test failed with **no banner at all**, which *no branch of the handler can produce* — every path sets a message. That impossibility is what pointed at native constraint validation rather than at my own code. Chasing it instead of weakening the assertion is what surfaced a dead translated string.

**A test that only asserts "the happy path still works" would have shipped that branch dead forever.**

**The mismatch case is deliberately asymmetric with the others**: on a PIN mismatch
`CreatePinScreen` marks **both** PIN fields, because the screen cannot know which one holds the
typo. Marking only the confirm field would assert something it does not know.

**Every fix was proved to fail first.** Each new test was run against the source with the
`aria-invalid` attribute removed — StaffLogin 2 red, SessionLock 2 red, CreatePin 4 red — then
restored and re-run green. A test that cannot go red is not coverage.

**Verification:** `tsc --noEmit` clean · `npm run lint` 0 errors · the five CSS walkers pass with
the new `[aria-invalid='true']` selectors · **the FULL UI suite: 603 files, 10,295 tests, 0
failures.**

Commits: `d8666db1e` (staff login), `eb632399f` (session lock), `b705afed1` (create owner),
`f968914a0` (activation + dead branch).

### Round 5 — the website auth islands: two labels that never localized

Having confirmed the surface was free, I checked the website forms for the same defect classes and
found the surface **much better built than I assumed** — most of my hypotheses were wrong, which is
worth recording:

| Hypothesis | Reality |
|---|---|
| No live password feedback (silent-disable, like the app) | **Wrong.** `PasswordStrength` renders a 4-segment meter with a label, so the rule is visible. |
| No mismatch feedback | **Wrong.** `PasswordField:128` shows a live mismatch hint. |
| Email has no feedback either | **Wrong.** `SignupForm:391` shows a live ✓ for a valid address. |
| `required type="email"` with no `noValidate` is the app's dead-branch bug again | **Wrong, and correctly so.** `AuthForm`'s handlers do NO client-side email validation — the native gate is the only one, so it is load-bearing rather than shadowing. The app's bug came from having *both* a JS check and the native gate; the website has only one. |

**The defect that WAS real:** two accessible names were literal English in the JSX of otherwise
fully localized islands —

- `PasswordField` `aria-label="Passwords match"`
- `SignupForm` `aria-label="Valid email"`

A screen reader announced English to an Indonesian user while every visible string around them was
translated. Both are now keys the component declares and its owning islands spread (the pattern
`PASSWORD_FIELD_LABELS` already used for `password.mismatch`), added to **both** dictionaries with
real translations.

The proving test renders the field in **both locales** and asserts the Indonesian bundle's own word
appears and the English one does not — the assertion that was impossible while the string was
hardcoded. Verified to go red with the label hardcoded again.

**Commit:** `7de6f582a`. **Verification:** `npx tsc --noEmit` clean · **1,250 website tests pass
across 62 files** · the island-label-coverage gate passes with the new keys.

### Round 6 — device-level verification, and a gap in my own round-3 work

**A gap in my own fix.** Round 3 gave `StaffLoginScreen` an `aria-invalid` but **no visual
styling**, unlike `CreatePinScreen` and `LicenseActivationScreen` where the same round added an
error border. The mark reached assistive tech; a sighted user saw an unchanged PIN row and had to
read the toast. Fixed in `ec9b31939`.

**Real-browser verification now exists for the auth surface.** Two Playwright tests, running on
both desktop and tablet projects against the dev-mock:

1. the failed-PIN mark survives the real React commit (`e2e/auth.spec.ts`);
2. the dot's computed `border-color` actually becomes the danger colour.

**22/22 auth E2E pass.** The suite runs with `npm run e2e:ui -- --no-docker e2e/auth.spec.ts`.

#### Writing test 2 took three wrong versions — worth keeping

Each passed or failed for the wrong reason, and the pattern is the lesson:

| Version | Why it was wrong |
|---|---|
| "the colour changed from the empty row" | **Passed with the CSS deleted.** Entering digits fills the dots, which changes `border-color` on its own. |
| "equals `--color-danger` read from `<body>`" | Failed on tablet: the token is theme-dependent (desktop `rgb(255,107,104)` vs tablet `rgb(244,108,111)`), so it pinned the theme, not the behaviour. |
| reading immediately after the attribute appears | Returned a **mid-transition blend**, `rgb(192,112,143)` — the dot transitions `border-color` (`StaffLoginScreen.css:455`), so it differed from the valid colour whether or not the rule existed. |

The final version polls until the transition settles and compares against the danger token read
from a probe outside the dot. Verified to fail with the rules removed (expected danger, received
the valid colour) and pass with them present.

**A failing screenshot was also read directly** during diagnosis, confirming the dots really render
red — the visual evidence the DOM tests could not provide.

### Round 7 — the session-lock failure path, and a coverage boundary

**Added:** `1a5e5fc2c` — E2E for the Session Lock **failure** path. The pre-existing test
(`new-flows.spec.ts`, E2E-27) covered only the success case (correct PIN → unlock), so the
round-3 field-marking fix had no end-to-end coverage at all. The new test asserts the row is
marked after a rejected PIN **and** that the mark clears when the user starts retrying.

Verified to fail with the `aria-invalid` attribute removed (`received null, expected "true"`) and
pass with it present, **on both desktop and tablet** — 4/4 for the Session Lock suite, 6/6 for the
whole spec file.

**Checked and deliberately NOT added — a real reachability boundary:**

| Screen | Why it has no E2E |
|---|---|
| `CreatePinScreen` | The dev-mock hardcodes `has_users: true` (`dev-mock/handlers/staff.ts:306`); the screen renders only when there are **no** users. Reaching it would mean editing the mock so the test passes — fitting the fixture to the assertion. Its coverage stays at the unit level. |

`SessionLockScreen` was reachable because `AppShell` listens for an `app:lock` event explicitly
provided "to exercise this screen" (`AppShell.tsx:163-170`), which `new-flows.spec.ts` already used
for the success case.

### Round 8 — the unasserted link in the website's i18n chain

I set out to build browser-level verification for the website auth islands. Investigating first
showed that the wrong investment: the island-label gate already covers key↔list↔locale, and a
Playwright harness for the website does not exist at all. What I found instead was a **precise
gap in an existing gate**.

**The chain, and where it was unguarded:**

```
  component reads t(labels, 'signup.title')
    → island declares it in SIGNUP_FORM_LABELS        ✅ graded by island-label-coverage
    → the key resolves in en.json AND id.json         ✅ graded by island-label-coverage
    → signup.astro imports that list                  ❌ UNGRADED
    → labelMap(locale, LIST) builds the map           ❌ UNGRADED
    → <SignupForm labels={thatMap} /> receives it     ❌ UNGRADED
```

The existing gate **names its cases by page** ("signup (signup.astro)") but never opens the page —
so the final three links were asserted nowhere. And the failure is silent: `t()` falls back to
the key itself (`src/i18n/labels.ts:19-21`), so a mis-wired page renders `signup.title` to a real
visitor while every one of the 234 website tests stays green.

**Fixed:** `c3e35ec15` — `src/__tests__/island-page-wiring.test.ts`, 13 tests over the six
`[locale]` islands that receive a `labels` prop. Both real failure modes were injected and
confirmed to fail:

| Injected defect | Result |
|---|---|
| `signup.astro` builds its map from `AUTH_FORM_LABELS` | ❌ caught |
| `signup.astro` builds the map but passes `labels={{}}` | ❌ caught |

Search is excluded (mounted by `Header.astro`, not a `[locale]` page) and the exclusion is
asserted rather than left implicit, so a new island added to the other suite cannot leave this half
silently ungraded.

**Verification:** `npx tsc --noEmit` clean · **1,380 website tests pass across 64 files**.

### Round 9 — measuring the setup flow's inset fix instead of asserting it

I set out to add E2E for `ProvisioningFlow` — the actual setup wizard. It is **not reachable in
E2E**: `AppShell.tsx:214-217` sets `setupKnownComplete(true)` unconditionally in dev mode, which
is the mode E2E runs, so the `!setupKnownComplete` branch at `:581` never renders the flow. There
is no URL or storage hook to force it, and adding one to make a test pass is the same trap I
declined for `CreatePinScreen`. **Zero E2E specs reference it**, which is why it has no browser
coverage.

**What I did instead: measured the round-1 inset fix in a real browser.** That fix was never
verified visually, and the question is exactly the one a string assertion cannot settle — where
the card actually lands. Method from `docs/frontend/css-verification.md`, harness built **outside
the checkout**.

**Measured in Chromium**, 412x915 notched viewport, insets 44/0/34/0, gutter `var(--space-8)` = 32px:

| Rule | padding top | padding bottom | card top |
|---|---|---|---|
| `calc(gutter + inset)` — shipped | **76px** | **66px** | **y=459** |
| bare gutter — the pre-fix bug | 32px | 32px | y=415 |

The fix is real and load-bearing: without it the card starts **44px higher, under the notch**.
The counterfactual was measured, not assumed.

**Encoded** (`e64d9e28f`): the existing tests asserted the container *mentions* the four inset
tokens — a shape that passes for a rule naming them **without summing them**. The new assertion
pins the **sum** on all four edges. Verified red against the pre-fix padding (2 tests fail,
including the pre-existing one) and green against the shipped rule.

### Round 10 — closing the provisioning-E2E question definitively

Round 9 concluded `ProvisioningFlow` was unreachable in E2E from reading the source. This round
**measured it** rather than trusting that reading, and the answer is firmer than the one I gave:

**Three independent blockers, each verified:**

| # | Blocker | Evidence |
|---|---|---|
| 1 | Desktop: dev-mode bypass | `AppShell.tsx:214-217` sets `setupKnownComplete(true)` unconditionally under `import.meta.env.DEV`, so the `:581` branch never renders the flow. `import.meta.env.DEV` is a **compile-time** constant, so no runtime flag can avoid it while the dev server serves the app. |
| 2 | The tablet shell — which HAS no bypass — is not what E2E serves | `isTabletShell` is set by the entry point (`main.tsx` → `'desktop'`, `main.mobile.tsx` → `'tablet'`), and the E2E `baseURL` serves `index.html`. The `tablet` Playwright project is only a **viewport** (1024×1366), not an entry. |
| 3 | Even the tablet entry, fetched directly, does not reach it | `/index.mobile.html` returns **200** and mounts the shell, but `TabletAppShell.tsx:186-187` sets `hasCompletedSetup` from `get_first_run_state`, and the dev-mock answers `state: 'provisioned'` **by design** (`dev-mock/handlers/system.ts:457-468`: *"the mock reports a PROVISIONED terminal so the dev shell routes to a session rather than the first-run flow"*). |

**Measured, not inferred.** Two throwaway Playwright probes were run and deleted in-session:

```
probe 1 (desktop, /)                  PROBE {"provisioning":0,"signup":0,"login":1,...}
probe 2 (tablet project, /index.mobile.html)  MOBILE_PROBE status=200
                                      {"provisioning":0,"login":1,...}
```

**So the honest status is: reaching the setup flow end-to-end requires changing the dev-mock's
deliberate first-run answer** — a mock whose comment states the decision. That is fitting the
fixture to the assertion, and it is the same trade declined for `CreatePinScreen` in round 7. The
flow's browser coverage stays at: **unit level (15 tests), the CSS walkers, the SCREENS ledger, and
the round-9 measured inset verification** — no E2E, and now for a recorded reason rather than an
unexplained gap.

### Remaining, and honestly not mine to claim

- **The website auth islands are unaudited by me.** Another agent owns that surface and has
  built a substantial gate (landmarks, accessible names, resolving ARIA refs, keyboard order)
  over 89 built pages. Their gate is **static**: it cannot see the runtime error→field
  association class of defect this round fixed four times on the app side. That class may well
  exist in `AuthForm.tsx` / `SignupForm.tsx` and is worth a look — but it is a collision, so it
  needs a decision about ownership before I start.
- **No end-to-end run on a real device.** Every fix here is asserted at the DOM level. The visual
  result of the new error borders is unverified on any real screen.
