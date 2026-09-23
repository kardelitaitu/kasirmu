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

### Round 12 — three defects in the setup flow, found by delegating

**On subagents.** Three audits were fanned out in round 11. All three were slow enough that I
interrupted them; one nonetheless delivered a report, and it found things I had walked past.

**Every finding was reproduced before being fixed.** The audit's own numbers were checked against
the source rather than relayed.

| # | Defect | Verification |
|---|---|---|
| 1 | **The store-type labels could never translate.** `label: 'Shop'` / `blurb: 'Barcode, cash…'` were TSX literals rendered raw at `:593-594`, while every sibling string on the same screen used `<Localized>`. An Indonesian merchant read English on the first screen of setup. | Read the literals and the render site. Fixed with keys in both bundles + a fallback map. |
| 2 | **A failed pairing dead-ended the tablet's default tab.** `pairingError` renders the message with no retry, and the auto-start effect is gated on `!pairingError` (`:139`) so it never retries. The only way back was re-clicking the QR Pairing tab that already looked selected. | Reproduced, then **proved the new test fails with the button removed** and passes with it. |
| 3 | **The "hard block if offline" contract was stale, not the code.** The doc claimed a hard block; `canSubmit` has no `isOffline` term. | Traced `provision_device`: it takes a DB lock and writes local SQLite, **with zero network calls in its body**. So the guard would refuse a provision that would have succeeded. **Corrected the doc**, not the code — and the audit had flagged exactly this caveat. |

Finding 1 is the one I should have caught myself: it sat 13 lines from code I had edited in a
previous round, and the audit found it because I never framed "is this string translatable?" as a
question. Fixing my own blind spot, not just the file.

**Commit:** `ffbb9a24a`. **Verification:** `tsc` clean · `lint:i18n` no issues · **380 tests pass
across 15 suites**.

### Round 13 — the feature preview now reads the registry (was: drift)

The drift recorded in round 12 is fixed. `LiveSetupPreview` kept its own table of 34
`{route,label,feature}` rows duplicating what every `registerPage`/`registerNavItem` call already
declares. It now calls `getNavItems` — **the same call `AppLayout.tsx:118` makes** — so the
"X / N items unlocked" count cannot disagree with the sidebar it describes.

**What the duplication had accumulated:**

| | Duplicated table | Reality |
|---|---|---|
| Missing routes | — | **9 registered routes absent** |
| Route `pos` | `'POS'` | `'POS Terminal'` |
| Route `tables` | gated `restaurant` | gated `table-management` |
| `'Inventory'`, `'Tables'` chips | present | **no register call creates them** |

**Two mistakes I made in the same pass, both kept because the reasoning matters more than the diff:**

1. **Passing no role.** `getNavItems` fails CLOSED on role-gated items, so the first version
   counted **10 total instead of 39** — I had introduced a *worse* under-count while fixing an
   under-count. The role is now threaded and defaults to `'owner'`, which is the only role that
   can open this screen (`settings/register.tsx:21` registers it `requiredRole: 'owner'`).
2. **Assuming the old tests were right.** Eight assertions encoded the duplicated table's labels
   rather than the product's. Each was re-pointed at the registry **only after checking the real
   registration** — and two turned out to be my own errors: `'Dashboard'` is correct for route
   `sales-dashboard`, and `'Tables'` is real but gated on `table-management`.

**Commit:** `de29bb600`. **Verification:** `tsc` clean · lint 0 errors · **323 tests pass across 4
suites**. The new test pins the denominator to `getNavItems`; verified to fail by reintroducing a
hardcoded `34`, which reproduced exactly the old buggy string (`22 / 34` vs `22 / 39`).

**Superseded note, kept for the record:**
copy of the app's nav registry, and it has drifted — **9 registered routes are missing**
(`analytics`, `menu-engineering`, `kds-expo`, `sales`, `dashboard`, `custom-report`,
`security-trail`, `design`, `tooltips`). The screen renders "X / 34 items unlocked" on the live
features page, so the denominator under-reports. Two of the nine are dev/tool pages
(`design`, `tooltips`) that legitimately should not appear, so a blanket "add all nine" would be
wrong — this needs a decision about which routes the preview is meant to describe.

### Round 14 — my round-13 suggestion was wrong, and the real defect was narrower

I ended round 13 proposing to "replace the WORKSPACES table with an authoritative source, the same
class of defect I just fixed for nav items." **Investigating first showed there is no such source:**
workspaces arrive from the server as `WorkspaceDto[]` (`WorkspaceContext`), and the
feature→workspace mapping in this component is genuinely preview-only knowledge — it *predicts*
which feature unlocks which workspace, which is the component's job. Acting on my own suggestion
would have deleted working behaviour to satisfy a pattern.

**What was actually wrong, and it was narrower:** the table declared `features: string[]`, so any
literal compiled. A typo would silently never match — the workspace never lights up, with no type
error and no failing test.

**Proved it before fixing it.** Planting `'inventory-trackin'`:

```
tsc --noEmit        clean
vitest              12 passed
```

The four literals now use the typed `FEATURES` constant (`hooks/useFeatures.ts`) and the field is
`FeatureKey[]`. The same typo now fails typecheck with a suggestion:

```
error TS2551: Property 'INVENTORY_TRACKIN' does not exist ... Did you mean 'INVENTORY_TRACKING'?
```

**Commit:** `94a6a8706`. **Verification:** `tsc` clean · lint 0 errors · 12 tests pass.

**The lesson worth keeping:** my own "same class of defect" instinct was wrong here. Two components
can look alike (duplicated tables) while one is duplication and the other is domain knowledge. The
check that separated them was asking *where the authoritative data lives* — and for workspaces,
nothing does.

### Round 15 — the provisioning E2E blocker is RESOLVED (was: needs a product decision)

Rounds 9-10 concluded this needed a product owner's call because reaching `ProvisioningFlow`
required changing the dev-mock's deliberate answer. **Re-examining it, there was a narrower way
that changes no default**: the dev-mock now honours `?unprovisioned=1`.

**Why a flag was enough.** The two blockers were separate:

| Blocker | Resolution |
|---|---|
| Desktop bypasses the flow under `import.meta.env.DEV` | Not defeated — and does not need to be. The suite drives the **tablet entry** (`/index.mobile.html`), which has no bypass. |
| The tablet shell reads `get_first_run_state`, whose mock answer was hardcoded `provisioned` | The flag. |

A query param rather than a localStorage key, deliberately: an explicit per-navigation opt-in that
cannot persist on a developer's machine, and it adds no key for `storageKeyPins.test.ts` to police.
**The default is unchanged** — the dev-mock and boot-gate suites (30 tests) confirm it.

**Measured before trusting it.** A throwaway probe showed the flag working only on the tablet entry
(`FLAG_ON {"provisioning":1}` vs desktop `{"provisioning":0}`), which is why the spec navigates
there explicitly rather than relying on the Playwright project.

**`ui/e2e/provisioning.spec.ts` — 5 tests, 10 total across both projects:**

- the flow renders on an unprovisioned terminal, offering both store types;
- an incomplete form cannot be submitted;
- **an offline setup completes end to end and leaves the flow**;
- a PIN mismatch is named, with `aria-invalid`, instead of a silently dead button;
- a too-short PIN is named.

**This is the surface the objective names, verified in a browser for the first time.** The audit's
central subject now has real end-to-end coverage.

**Commit:** `f331101cf`. **Verification:** `tsc` clean · lint 0 errors · **10/10 E2E pass on
desktop and tablet** · 30 dev-mock/boot unit tests unchanged.

### Remaining, and honestly not mine to claim

- **The website auth islands are unaudited by me.** Another agent owns that surface and has
  built a substantial gate (landmarks, accessible names, resolving ARIA refs, keyboard order)
  over 89 built pages. Their gate is **static**: it cannot see the runtime error→field
  association class of defect this round fixed four times on the app side. That class may well
  exist in `AuthForm.tsx` / `SignupForm.tsx` and is worth a look — but it is a collision, so it
  needs a decision about ownership before I start.
- **No end-to-end run on a real device.** Every fix here is asserted at the DOM level. The visual
  result of the new error borders is unverified on any real screen.

---

## Round 17 — three defects fixed in the tablet account-linking leg

Resumed the audit of `ProvisioningFlow.tsx` by reading it end to end rather than grepping for
suspected problems. All three findings below are in the **tablet email path**, which the flow's
own tests had reached only through `getByPlaceholderText` — the symptom of the first defect.

### 17.1 The tablet email and code fields had no accessible name

`<input type="email" placeholder={...}>` and the code field beside it were labelled **only by a
`placeholder`. A placeholder is not an accessible name: a screen reader announced two unlabelled
text boxes, and it is a *false* label besides — the browser erases it the moment the user types,
leaving nothing to say what the field was for (WCAG 3.3.2).

The tell was in the suite: the only way the existing test could address those fields was
`getByPlaceholderText`, in a file where every other field is reached by `getByLabelText`. That
asymmetry is what an unlabelled control looks like from the outside.

**Fix:** visually-hidden `<label>` + `sr-only` for each, `setup-account-email-label` /
`setup-account-code-label` in both bundles, and the test now queries by accessible name. The
walker's `screenExtraction` entry gains `parentCss: ['../theme/components.css']` — the same
citation `KdsScreen` and `SettingsSelect` carry, since `.sr-only` is a global utility and not a
class this feature's sheet should own.

### 17.2 `link.kind === 'failed'` was written and never read

`linkWithGoogle`'s catch set `{ kind: 'failed' }` and **nothing in the component ever read that
member**. The union branch existed, the state was set, and the screen drew the same idle button
as the first paint — so a merchant whose Google window closed early saw a control that looked
untouched. The only signal was the form-wide banner at the top of the card.

**Fix:** render the failure inline beside the button with a `Try again` retry (`setup-account-retry`),
mirroring the escape the pairing branch already had — and dropped the now-duplicated `setErrorMsg`,
which had been drawing the *same sentence twice on one screen*.

### 17.3 One `failed` state for two different problems, reported two sections away

`sendCode` and `verifyCode` both set `emailState = 'failed'` and both wrote the
`setup-account-failed` sentence into the **form-wide banner**, while the fields that failed sit
two sections below it. So an unreachable mail server and a mistyped code produced the identical
message, in the wrong place. Worse, on a failed **send** the code row never rendered at all
(`sent || (failed && codeSent)`, and `codeSent` is false), so there was no feedback near the
field at all.

**Fix:** split into `sendFailed` / `verifyFailed`, render each under its own field with copy that
names the step that actually failed (`setup-account-send-failed`, `setup-account-verify-failed`,
both bundles), `role="alert"` because these follow a submit the user is waiting on — not the
`role="status"` the PIN messages use, which follow live keystrokes.

### Verification

`ProvisioningFlow.test.tsx` **19/19** · full UI suite **606 files / 10,320 tests pass** ·
`tsc` clean · lint **0 errors** (58 pre-existing warnings) · parity **0 missing** · i18n lint
clean · `screenExtraction` **272/272**.

Every fix carries a **negative control**: reverting each one individually makes its new test fail
(unlabelled field → `Unable to find a label`; removed retry → `Unable to find role="button"`;
collapsed state → `Unable to find ... /Could not send the code/`).

**Commits:** `ba2f8fafe` (accessible names), `a709969cc` (inline link retry), `adeac4976` (email-leg failures).

### ⚠️ Process failure worth recording

While building a negative control I read `ProvisioningFlow.tsx` with the `read` tool, which caps
at **800 lines**, and wrote that truncated string back — destroying the file's last ~25 lines.
This is the **same trap recorded in an earlier round for `settings.ftl` (which caps at ~1080 of
1192)**, now hit a second time against a different file. It was caught immediately because the
next `tsc` failed, not because I was watching for it.

**Rule that should have prevented it:** never write back a string obtained from `read` without
checking `totalLines` against the number of lines actually returned. The file was restored from
`git show HEAD:<path>` and confirmed byte-clean by diffing against HEAD.

### Still open

- **No progress/step indicator** in the flow. It is a single card, so this is a genuine design
  question rather than an omission — a step rail over a non-linear form is decoration.
- **`CreatePinScreen` E2E** remains blocked by the dev-mock hardcoding `has_users: true`
  (`dev-mock/handlers/staff.ts:306`); the screen renders only when no users exist.
- **Website auth islands** (`AuthForm.tsx`, `SignupForm.tsx`): the round-16 investigation found
  and fixed a real runtime-config defect in `AccountView`. The same
  runtime-URL-arrives-after-mount class should be checked in `PairView.tsx` and `SignupForm.tsx`.

---

## Round 18 — the `CreatePinScreen` E2E blocker is RESOLVED (was: needs a dev-mock change)

Rounds 16-17 recorded this as blocked: `CreatePinScreen` renders only when the shell reads
`has_users: false`, and the dev-mock answered a hardcoded `true`, so the screen had **no browser
coverage at all**. The proposed remedy in round 10 was rejected as "needs a product decision"
because it appeared to require changing that answer.

**It did not.** The provisioning flow's own blocker was solved one round earlier with a
per-navigation query flag (`?unprovisioned=1`, round 15). `has_users` needed exactly the same
seam, and the pattern was already in the tree to copy — `unprovisionedRequested()` in
`dev-mock/handlers/system.ts`.

### The change

`?nousers=1` on the tablet entry (`/index.mobile.html`) flips the answer. Read at **call time**,
not module load, so a test can navigate then assert; guarded with try/catch because the handler
also runs under jsdom where `search` may be empty. The comment records that `null` — an
UNANSWERED read — is deliberately *not* reachable this way: unknown is not "no users", and the
shell must keep treating it as such.

**The default is unchanged, and that is the load-bearing half.** A dev preview that silently
reported no accounts would drop every developer into first-run bootstrap. Four unit tests pin it:
true by default, true under an unrelated query, false only under the flag, and a call-time read.

### `ui/e2e/provisioning.spec.ts` — 9 tests, 18 total across both projects

New:
- the owner-bootstrap screen opens when no accounts exist (the store really has none, so a login
  could never succeed — the shell must offer bootstrap, not a dead form);
- every bootstrap field has an accessible name, addressed by `<label>` rather than placeholder;
- an incomplete bootstrap will not submit;
- a mismatched confirm PIN is refused and reported through `aria-invalid` on the field itself.

Plus the 5 provisioning tests from round 15, unchanged.

### Verification

**18/18 E2E pass on desktop and tablet** · `dev-mock-auth-contract.test.ts` 30/30 · full UI suite
**606 files / 10,324 tests pass** · `tsc` clean · lint **0 errors** (58 pre-existing warnings).

**Negative control:** forcing `has_users` to an unconditional `false` makes **3** of the new tests
fail — the default is genuinely asserted, not merely described.

**Commit:** `73c3d17b9`.

### Round 18 also closed the round-16 loose end

Round 16 fixed a runtime-config defect in `AccountView` and flagged `PairView.tsx` /
`SignupForm.tsx` as possibly carrying the same class. **Checked, and they do not:**
- `PairView` reads `API` during render but its mount effect never touches it — it only resolves a
  session token — so there is no stale capture.
- `SignupForm` uses `API` exclusively inside event handlers (`register`, `verify`, resend), which
  read the current render's value at call time. It has no mount-effect fetch.

So `AccountView` was the only instance. The stated suspicion was wrong, and the negative result is
recorded here so it is not re-investigated.

### Still open

- **No progress/step indicator** in the provisioning flow — a deliberate design question, not an
  omission (a step rail over a single non-linear card is decoration).
- **No end-to-end run on a real device.** Every fix across these rounds is asserted at the DOM or
  browser level. The visual result — error borders, the bootstrap card on real Android — is
  unverified on physical hardware.

---

## Round 19 — the progress rail was NOT decoration; it was a defect

Rounds 17-18 recorded "no progress/step indicator" as a *design question*, reasoning that a step
rail over a single card would be decoration. **That reasoning was never measured, and it was
wrong.**

### The measurement that settled it

A throwaway Playwright probe, at the tablet's own viewport (1024x1366):

```
MEASURED {"cardH":1423,"viewportH":1366,"scrollH":1479,"clientH":1366}
```

The card is **1423px tall in a 1366px viewport** — 57px taller than the screen, with 113px of
scroll. The submit button and the last two fields (`Login name`, both PIN fields) begin **below
the fold**. So the merchant sees a heading, a mode choice, and part of a form — with the primary
action off-screen, no indication of how much is left, and no signal that anything is still
required below. That is not a candidate for a nice-to-have indicator; it is a form whose exit is
invisible on first paint.

### The fix

A rail of three steps — **Account, Shop, Owner** — matching the three decision groups the form
already gates `canSubmit` on.

**The load-bearing property is that the rail is derived from the SAME values as `canSubmit`**, not
from a second state machine. `stepOwnerDone` reuses the exact expressions (locationName, pin
length, `pin === confirmPin`) that the submit gate uses, so the rail cannot claim "finished" while
the button still refuses. That would be the dead-control defect the PIN messages fixed,
reintroduced by the very thing meant to help.

Accessibility, matching the file's existing contract that state is never colour-only:
- `aria-current="step"` on the active `<li>` — a position, not a decoration;
- `Step {current} of {total}` as text, so the fact survives without colour;
- a check glyph on completed steps, not just a fill change.

### Verification

**20/20 E2E pass on desktop and tablet** (the rail test asserts it is *visible*, not merely in the
DOM) · `ProvisioningFlow.test.tsx` **22/22** · `screenExtraction` **272/272** · full UI suite **606
files / 10,328 tests pass** · `tsc` clean · lint **0 errors** · parity **0 missing** · i18n clean.

### Two things I got wrong mid-round, and caught

1. **My first linkage test was fiction.** `never marks a step done while submit is still disabled`
   filled only step 1, so it never exercised the PIN half of the gate. The **negative control** —
   deleting the PIN check from `stepOwnerDone` — left it GREEN, which is exactly what a tautological
   test looks like. Rewritten to fill everything except the PIN agreement; the same negative control
   now fails with `expected [span, span] to have a length of 2 but got 3`.
2. **I clobbered a live FTL key.** Inserting the step keys replaced `setup-provision-mode-section`
   rather than preceding it, because my `edit` old_string was that key's own line. The parity gate
   caught it (`1 missing key(s)`) — and it is worth noting the walker found it, not me: I had
   already run typecheck and lint clean before parity reported it.

Also corrected: I first wrote `var(--color-on-primary)`, which does not exist. The real token is
`--color-pos-on-primary`; the CSS walker's parent-sheet check surfaced it.

**Commit:** `0c7a17f68`.

---

## Round 20 — measured where the height actually goes; the fix was smaller than hoped

Round 19 established the card is 1423px tall in a 1366px viewport and added a rail. The bigger
question, left open as a product decision, was whether the form should simply be shorter. This
round I measured that instead of guessing.

### Where the pixels go (measured, per section, tablet viewport)

```
card 1478 | header 113 | nav-steps 41 | mode-box 151 | account-box 435
fieldset(store) 133 | five .provisioning-field @ 67 = 335 | submit 37 | padding 84 | gaps 21
```

And the position that matters — on the **default (linked)** path:

```
FOLD {"vh":1366,"cardTop":28,"firstInput":1013,"submit":1426,"scrollH":1534}
```

**The first text input sits at y=1013 in a 1366px viewport — 74% down the screen.** A merchant
scrolls past 1000px of mode selection and account linking before reaching the first thing they can
type into; the submit button is at y=1426, 60px below the fold entirely.

### What I changed

One thing: the header subtitle. It restated whichever mode was selected — while the card directly
beneath it was headed "Link your kasir.mu account", and the offline one said "No account needed"
above a card reading "Keep this terminal completely offline". On the linked path the merchant read
the same instruction **four times** before reaching a field: header, card title, card description,
account hint.

**The saving is 18px of 1478 — about 1%.** That is worth stating plainly: the subtitle was genuine
duplication and removing it is right, but it does almost nothing for the fold problem. I had
expected more and the measurement said otherwise. `setup-provision-desc` was orphaned by the
removal and is deleted from both bundles.

### What I did NOT change, and why

The remaining 1000px is **real content**, not padding: a mode choice (151), the account-linking
box (435 — the QR/email/Google path), a store-type fieldset (133), five inputs (335) and a submit
(37). Each is load-bearing.

- The **account box is already correctly gated**: `provisionMode === 'linked'` skips all 435px on
  the offline path. I checked before assuming this was a defect; it is not.
  
- Splitting the card into **genuine sequential steps** (one decision per screen) is the change that
  would actually fix the fold — 1000px of content cannot be trimmed into 1366px otherwise. But
  that is a redesign of a flow governed by ADR #56, it changes what a merchant sees on first boot,
  and it cannot be validated from a headless browser. **I am not making it unilaterally.**

### Verification

`ProvisioningFlow.test.tsx` **23/23** · **20/20 E2E** on desktop and tablet · full UI suite **606
files / 10,328 tests** · `tsc` clean · lint **0 errors** · parity **0 missing** · i18n clean.

Negative control: reintroducing the subtitle makes the new test fail (`expected <p></p> to be
null`).

**Note on suite flakiness:** two consecutive full runs each failed a *different* pre-existing test
(`SalesDashboardScreen`, then `useNewTicketSound`) under parallel load; each passes in isolation,
and neither touches setup or auth. Worth recording rather than reporting as green.

**Commit:** `0f0a36a21`.

---

## Round 21 — ⚠️ CORRECTION: rounds 19-20 measured the wrong viewport

I have to correct the record. Round 19 measured the card at `setViewportSize(1024, 1366)` and
reported "1423px against a 1366px viewport". Round 20 built on that. **Both used one viewport for
both Playwright projects, and that viewport is not what either project actually is.**

`ui/e2e/playwright.config.ts` defines:

```
desktop: viewport { width: 1366, height: 768 }   // a POS terminal, comment says so
tablet:  viewport { width: 1024, height: 1366 }
```

Measuring each project on its OWN configured viewport:

```
REAL desktop {"vp":"1366x768",  "cardH":1460, "overflow":748, "submitTop":1420, "firstInputTop":1006}
REAL tablet  {"vp":"1024x1366", "cardH":1633, "overflow":323, "submitTop":1587, "firstInputTop":1058}
```

**The desktop terminal overflows by 748px — the card is nearly two screens tall, and the submit sits
at y=1420 in a 768px viewport, 652px below the fold.** Round 19 reported the tablet's number and
called it "the" number, so the desktop case — the primary POS form factor, and the worse one — was
never characterised.

### What this round fixed

The card's `padding: var(--space-12)` (48px) and `gap: var(--space-6)` (24px) were desktop-sized and
applied at **every** height: 240px of a 768px screen — 31% — spent on padding and whitespace before
any content. A `@media (max-height: 900px)` block restates both at `--space-6` / `--space-4`.

Measured effect: **desktop 1460px → 1355px, overflow 748 → 643 (−105px).** The tablet is unchanged
and correctly so — at 1366px tall its padding is proportionate, and the query does not fire.

### What this does NOT fix, stated plainly

**643px of overflow remains on the desktop, and 323px on the tablet.** I measured the remaining
content section by section and found no waste: the mode box is already a 2-column grid; the account
box is 435px of real UI (an 181px QR, subtabs, code badge, pulse status) and is already gated on
`provisionMode === 'linked'` so the offline path skips it entirely; the five fields are 67px each.
Trimmed as far as it goes, this form is simply taller than a 768px screen.

The remaining fix is structural — split into genuine sequential steps, one decision per screen — and
that is a redesign of an ADR #56 flow that changes first-boot behaviour and cannot be validated from
a headless browser. **I am not doing it unilaterally.**

### Process note

Two rounds of analysis rested on a number I never checked against the config that defines it. The
lesson is narrow and worth keeping: *measure the viewport the project actually uses, not one you
chose.* A probe that sets its own viewport silently detaches from the thing under test.

### Verification

`fullScreenSurfaceInset.test.ts` **11/11** (new contract test asserts the compact body actually
restates both properties — the declaration-present-but-inert shape this repo has been bitten by) ·
`screenExtraction` + `ProvisioningFlow` **295/295** · **20/20 E2E** · full UI suite **606 files /
10,341 tests pass** · `tsc` clean · lint **0 errors** · parity **0 missing** ·
`orientationAdaptiveWalker` **0 violations** (a `max-height` query, not an orientation literal, so
the shell-owns-orientation fence is respected).

Negative control: deleting the compact block makes the contract test fail.

**Commit:** `77a955d9d`.

---

## Round 22 — a failed setup showed the merchant NOTHING (off-screen error)

This is the most consequential defect of the audit, and it was found by measuring the one thing
three previous rounds had never tested: **what a human actually sees when provisioning fails.**

### How it was found

Rounds 19-21 all measured geometry. None of them forced a *failure*. The E2E suite's completion
test succeeds, and Playwright auto-scrolls, so both had always looked fine.

Forcing `provision_device` to reject (by patching the dev-mock's own `handlers` registry in-page —
`window.__TAURI_INTERNALS__` is the wrong seam, it bypasses the mock entirely and nothing renders)
and then measuring where the error lands:

```
BEFORE  desktop {"scrollTop":246, "errTop":-87, "errInView":false}
AFTER   desktop {"errTop":681, "errInView":true}
```

**On the desktop POS viewport the error rendered at `errTop: -87` — 87px ABOVE the viewport.** The
merchant scrolls ~250px down to reach "Finish setup", presses it, provisioning fails, and the screen
shows no change at all. The failure message existed, was correct, and was invisible.

### The fix

The submit failure now has its own state (`submitError`) rendered as a sibling of the submit
button, in the gap the user is already looking at. The form-wide banner at the top of the card is
kept for the errors raised *before* the user scrolls — chiefly
`setup-provision-account-required`, which fires while the merchant is still at the top choosing a
mode, where the banner is the right place. The two paths are deliberately not collapsed.

### Verification

**22/22 E2E** including a new test that asserts the error is `toBeInViewport` — not `toBeVisible`,
since an off-screen element is still "visible" to Playwright and off-screen was exactly the bug ·
`ProvisioningFlow.test.tsx` **25/25** · `screenExtraction` **272/272** · full UI suite **606 files /
10,347 tests pass** · `tsc` clean · lint **0 errors** · parity **0 missing**.

Negative control: routing the failure back to `setErrorMsg` makes the new test fail with
`Unable to find an element by: [data-testid="provision-submit-error"]`.

### What this says about the last three rounds

Rounds 19, 20 and 21 argued about pixels while this was sitting one probe away. Each of them
tuned a layout that a merchant could not use when anything went wrong. The lesson is not "measure
more" — I measured constantly — but **measure the failure path, not just the happy-path geometry.**

---

## Round 23 — the login screens printed internal error text to the cashier

Applying round 22's lesson (probe the FAILURE path), I forced the auth server to fail at the PIN
step:

```
BEFORE  toast text: "network down"
AFTER   toast text: "You appear to be offline. Check your connection and try again."
```

**The internal `Error.message` from the IPC boundary was rendered verbatim to the merchant.** The
consequences are worse than untidy copy: a cashier whose PIN is correct reads an internal string,
concludes the PIN is wrong, and retypes it until the rate limiter locks the terminal.

### Root cause, and why the existing gate missed it

`AuthContext` preferred the raw message over the project's user-safe mapper:

```ts
const message = (err as Record<string, unknown> | null)?.['message'] as string
  ?? plainErrorMessage(err, "Login failed");
```

`plainErrorMessage`'s own doc says it exists "so raw backend text never reaches a hook consumer" —
and this line defeated it, because every `Error` has a `.message`, so the `??` never fell through.

`errorPolicyCompliance.test.ts` (ERR-05/ERR-10) exists to catch exactly this and **passed anyway**.
Its two rules look for `err instanceof Error ? err.message` and for `\w+\.message`; this line uses
**bracket access** (`?.['message']`), which neither regex matches. A gate that cannot see the shape
of the leak it is guarding is worse than no gate, because it reports green.

### The fix, and the distinction it preserves

Two kinds of failure arrive at this provider and conflating them would be a regression:
- a server REFUSAL ("Invalid credentials", a rate-limit sentence) — copy written for the user, and
  what `e2e/auth.spec.ts` asserts verbatim;
- a TRANSPORT failure — an untyped `Error` whose message is internal.

`classifyRetry` already owns that distinction with a tested vocabulary, so the split is delegated to
it rather than re-derived. A retryable failure gets the shared offline copy; anything else keeps the
server's own sentence. The same fix was applied to `SessionLockScreen`, whose unlock handler had the
identical shape (`raw ?? l10n.getString(...)`) — the extended gate found it, not me.

### Widening the gate (two attempts)

A new bracket-access rule, plus `isWhitelisted`, plus whitelist entries for two legitimate
parse-not-display sites (`CreatePinScreen`'s "already exist" detection, `SessionLockScreen`'s
rate-limit parse).

**My first version of the rule was itself wrong.** It exempted any line containing a normalizer, so
`raw ?? plainErrorMessage(...)` — the exact leak — passed; the raw value wins and the mapper is dead
code. Verified by re-planting the leak and watching the gate stay green. The rule now treats
normalizer-after-`??` as a FAILURE, and re-planting the leak makes it report
`contexts/AuthContext.tsx:128`.

### Verification

**24/24 auth E2E** (including a new outage test that asserts the toast does NOT contain "network
down" and DOES match /offline|connection/) · `AuthContext.test.tsx` **20/20** ·
`errorPolicyCompliance` **4/4** · **22/22 provisioning E2E** · full UI suite **606 files / 10,350
tests pass** · `tsc` clean · lint **0 errors** · parity **0 missing**.

Every fix carries a negative control; the gate fix has one that proves it is not vacuously green.

**Commit:** `dfd9752ae`.
---

## Round 24 — the website auth islands: browser-verified SOUND (negative result)

Rounds 18-19 left the website auth islands open as "unaudited" and "worth a look". This round I
looked — against a real browser, which no test in either suite had ever done.

### What was missing

`website/package.json` declares `playwright ^1.61.1` as a **direct dependency** with **no E2E
directory, no spec, and no script that runs it**. The islands had unit tests (`auth-form.test.tsx`,
`signup-form.test.tsx`, `ssr-flash.test.tsx`) and a static accessibility gate over built pages, but
nothing had ever loaded the page in a browser.

### Method

`astro dev` (port 4322 — 4321 was taken, worth knowing for a future harness), driven by a throwaway
`playwright` script, standing in for the Worker's `/__oz/runtime-config.js` with `page.route`. All
four islands exercised on both the configured and unconfigured paths.

### Results — all four islands are sound

| Check | Result |
|---|---|
| `/en/login` with runtime config | form, 1 email input, 1 submit, 2 tabs, Google link, a real `<label>` — **0 page errors** |
| `/en/signup` with runtime config | form, 2 password inputs, 1 email input, region control |
| `/en/pair`, `/en/account` | render clean, no error text |
| All four, config absent | degrade to the not-configured notice |

**The anti-flash contract holds in real output, not just in a unit test.** With JavaScript
**disabled** — so the SSR HTML *is* the page — `/en/login` and `/en/signup` still contain the real
form (`hasForm: true`, one email input) and the notice is **absent**. `ssr-flash.test.tsx` asserts
this via `renderToString`; this is the first time it has been checked against bytes the server
actually sent.

### Honest scope

This is a **negative result**, and its value is closing a thread open since round 16 rather than
leaving "unaudited" standing. It is not a clean bill of health for the website: I checked that the
islands render, hydrate, degrade, and raise no page errors. I did **not** drive the full
OTP/password/reset flows against a live licence server, because there is no browser harness for
`website/` to hook into and building one is a larger change than this round justifies.

### ⚠️ Process failure — the read-cap trap, third time

Writing this section, I read the audit file with the 800-line-capped `read` tool and wrote the
truncated string back, **destroying the entire round-23 section**. It was committed before I noticed
(`5ccc32dbc`), and recovered from `git show HEAD~1:`.

This is the **third occurrence** of the same trap in this audit: the FTL corpus (round 8), the
provisioning flow (round 17), and now this file. Round 17 wrote the rule "never write back a string
from `read` without checking `totalLines`" and I failed to follow it twice more.

The rule is now mechanical, not aspirational: **append with a shell redirection or an `edit` on a
unique anchor — never with a `write` of `read` output** for any file longer than the read cap.

**No code commits this round.** The probe was deleted; nothing here warranted a source change,
which is the correct outcome when the code is right.

### Still open

- **The provisioning card is ~700px taller than the desktop viewport** (rounds 20-21). Structural,
  needs a product decision.
- **No website E2E harness.** Playwright is installed and unused; wiring one needs a licence-server
  stub to be worth having.
---

## Round 25 — two blockers behind one untested screen, and a misdiagnosis I caught

`RevokedScreen` is the ADR #58 §2.6 screen a SUSPENDED merchant sees to retrieve their data. It had
unit tests but had never been loaded in a browser, for a reason that turned out to be two reasons.

### Blocker 1 — the screen was unreachable

It renders only when `subscriptionState === 'revoked'`, and the dev-mock answered a hardcoded
`state: 'active'`. A new `?revoked=1` seam opens it, same shape as `?unprovisioned=1` and
`?nousers=1`; `unavailable` (a fail-closed transport reading) is deliberately not reachable this
way, because "we could not ask" is a different fact from "the subscription is revoked".

### Blocker 2 — and then the export did nothing at all

With the screen finally visible, pressing **"Export my data" did nothing**: no error, no toast, no
page error. The cause was one layer down. The real `tauri-plugin-dialog` invokes
`plugin:dialog|save`, which had **no mock handler**, so `mockDispatcher.invoke` hit its
unknown-command branch:

```ts
console.warn('[TAURI MOCK] Unhandled command:', cmd);
return null as T;
```

`pickExportPath()` therefore resolved `null`, and the screen reads `null` as "the user cancelled the
dialog" and returns early. Four flows share that shape — export, import, backup, image-pick — so
four dialog-driven paths were unreachable in dev and untestable in E2E. Registering the two dialog
commands fixes all four.

### ⚠️ A misdiagnosis I have to record

I first concluded this was a **shipped defect**: "the merchant clicks the one control that can save
their data and nothing happens". **That was wrong**, and I only found out by reading the real
plugin:

```js
async function save(options = {}) {
  return await invoke('plugin:dialog|save', { options });
}
```

On a real device the command IS registered, so it returns a path; if the dialog host were missing it
would **throw**, not resolve null, and the screen's catch would toast. The silent no-op existed only
because the *mock* returns null for unknown commands. So this was a **testability gap, not
shipped-broken behaviour** — and I had already written a paragraph asserting the stronger claim
before checking the packaged path. Recorded because the distinction matters: one of these is a bug,
the other is missing scaffolding, and conflating them inflates the fix.

### A wrong turn worth naming

I spent several probes trying to alias `@tauri-apps/plugin-dialog` to a mock module. It could not
work: **Vite pre-bundles bare specifiers into `node_modules/.vite/deps/` before `resolve.alias`
applies.** The served module kept importing
`/node_modules/.vite/deps/@tauri-apps_plugin-dialog.js`, and neither `optimizeDeps.exclude` nor a
cache purge changed that. Mocking at the IPC layer — where every other mock lives — was both
simpler and correct. The `vite.config.ts` experiment was fully reverted; `git diff` on it is empty.

### Verification

**8/8 new E2E** on desktop and tablet (screen renders with its explanation, the export control has an
accessible name, a successful export toasts, and a failed export shows "Export failed" **without**
leaking the internal `disk full`) · `dev-mock-auth-contract` **32/32** · full UI suite **606 files /
10,352 tests pass** · `tsc` clean · lint **0 errors** · parity **0 missing**.

Negative control: deleting the two dialog handlers makes both new unit tests fail.

**Commit:** `b3016f8f8`.
---

## Round 26 — the pairing screens told merchants to visit the literal text `{$url}`

Chasing round 25's theme (which screens are still unreachable in a browser), I enumerated the boot
gates and found `LicenseActivationScreen` unreachable the same way `RevokedScreen` was. Opening it
took three flags — `?license=inactive&nousers=1&unprovisioned=1` — because the boot ladder admits a
terminal on **any** of: usable licence, completed setup, or existing users. A seam for only the
licence leaves the other two admitting it.

The screen rendered on the first try after that, and showed the defect immediately.

### The defect

```
BEFORE:  Scan this QR code with your phone or visit {$url}
AFTER:   Scan this QR code with your phone or visit https://kasir.mu/pair?code=ABCD-1234
```

**The merchant was told to visit the literal string `{$url}`.** Fluent renders an unknown variable by
echoing the message pattern back, so the failure is silent and looks like copy.

**It looked plausible, which is why it survived.** The QR still drew — `QRCodeSVG` was handed
`undefined` and dutifully encoded the string `"undefined"` — so the screen had a QR, a readable
pairing code, and a sentence. A merchant scanning that code or typing that address gets nowhere.

### Root cause: the mock invented a DTO

`start_device_pairing` answered:

```js
{ code, poll_token, expires_at, base_url: '…', qr_payload: '…' }
```

The real contract is `PairingSessionStart` — `code`, `poll_token`, `expires_at`, **`qr_url`** — and
**`base_url` and `qr_payload` do not exist on it** (kasirmu-core/src/desktop_link.rs:38; the licence
server agrees at pairing.go:228). So `qr_url` was `undefined` everywhere it was read, and Fluent
printed the pattern.

### How it was found, and how it nearly wasn't

Four wrong hypotheses first, each killed by measurement rather than argument:
1. **"Fluent mis-parses the message."** No — the FTL matched a known-working example verbatim.
2. **"`vars` isn't reaching `Localized`."** No — a unit render of the identical markup interpolated
   correctly.
3. **"The bundled Fluent version is broken."** No — `formatPattern` with a real arg worked on both
   live bundles.
4. **"A prop-stripping wrapper."** No — both screens import `Localized` straight from
   `@fluent/react`.

Then the decisive one: reproducing the *exact* call the library makes with no args returned the raw
pattern plus `ReferenceError: Unknown variable: $url`. That pointed at the argument, not the
machinery — and dumping the DTO showed the field was simply absent.

A sub-experiment worth keeping: Fluent treats a **boxed `String` object** exactly like `undefined`
(raw pattern + error), but a primitive, a number, and a `new String()` differ. Measured, in case a
typed value ever flows into `vars`.

### Verification

**4/4 new E2E** on desktop and tablet, asserting the URL appears AND `{$url}` does not — on **both**
screens, since both read the same DTO and both were broken · `dev-mock-auth-contract` **34/34** ·
full UI suite **606 files / 10,354 tests pass** · `tsc` clean · lint **0 errors** · parity **0
missing**.

Negative control: restoring `qr_payload` in place of `qr_url` fails both new unit tests with the
key-list mismatch and `expected 'undefined' to be 'string'`.

**Commit:** `66486f339`.
---

## Round 27 — the account-linking flow could not be completed in dev at all

Continued the mock-drift seam, but this time asked the question structurally instead of finding
instances one at a time: **which commands does this objective's flow depend on, and what does the
mock actually answer for each?** Dumped the return shape of all fourteen commands the setup and
login paths call.

### The finding

Three commands came back as **unhandled** — meaning `invoke` fell through to its
`console.warn` + `return null` branch:

```
link_device_google           UNHANDLED
link_device_email_request    UNHANDLED
link_device_email_consume    UNHANDLED
```

`grep` over `ui/src/dev-mock` for all three names returned **zero** hits. So the entire account-
linking path — the thing ADR #56 §2.3 makes the DEFAULT first-run mode, and the reason the free plan
attaches to an account — was non-functional on any dev preview or E2E run. Measured in a browser:

- **Google**: `linkDeviceGoogle()` resolved `null`, so the button silently did nothing.
- **Email**: the address was accepted, the code field appeared, and then **every** code was rejected
  with "That code did not work" — because `link_device_email_consume` never returned
  `{ tenantId, email, verified }`.

A merchant following the recommended path could not link an account. After the fix:

```
BEFORE:  That code did not work. Check it and try again, or resend.
AFTER:   Linked to merchant@example.com.    (+ the flow completes)
```

### Shapes taken from the Rust structs, not invented

Which matters, because inventing shapes is what caused round 26. `LinkedAccount`
(kasirmu-core/src/desktop_link.rs:123) and `VerifiedAccount` (:137) are both `camelCase` on the wire,
and `terminal` is `Option<TerminalCredential>` — omitted when absent, not sent as `null`, matching
serde's skip-if-none. The handlers mirror that.

### Two smaller corrections in the same pass

1. **`check_license_status` did not match its own declared type.** `ServerLicenseStatus` requires
   `deviceRevoked`; the mock omitted it. Nothing reads the field today, so no user impact — but a
   registry typed `(args) => unknown` cannot catch a missing field, which is exactly how the
   `qr_url` defect shipped. Completed the DTO.
2. **A doc comment asserted enforcement that does not exist.** `deviceRevoked`'s doc said "the shell
   refuses to open a session while it is set". The shell never reads the field; the **backend** drops
   sessions (`kasirmu-bridge/src/license.rs:568` → `invalidate_all_sessions`), which is the correct
   place because a client-side check cannot stop a session already open on a stolen tablet. The
   comment invited someone to add a redundant client gate. Rewritten.

### Why no existing test caught it

There are ~50 `api-*-contract` test files, and the name is misleading: they assert that the right
**IPC command name** is called, never that the payload matches the DTO. `api-license-contract.test.ts:38`
hand-writes a `check_license_status` fixture that is missing `deviceRevoked` and nothing complains,
because `mockResolvedValue` accepts any object.

Confirmed the fix is available cheaply: annotating such a fixture with its interface **does** make
`tsc` reject it (`error TS2741: Property 'deviceRevoked' is missing`). 137 untyped DTO fixtures exist
across that family — typing them is a worthwhile follow-up, larger than this round.

### Verification

**24/24 provisioning E2E**, including a new test that links by emailed code and finishes the whole
first-run flow (the first time that path has been exercised end to end in a browser) · 47/47 across
the mock and license contract suites · full UI suite **606 files / 10,353 tests pass** · `tsc` clean ·
lint **0 errors** · parity **0 missing**.

**Note:** two full-suite runs each failed a *different* pre-existing test under parallel load
(`SubscriptionContext`, then `NodeTopologyEditorDevMock` + `SettingsPage`); all pass in isolation and
none touches setup, auth, or the dev-mock. Recorded rather than reported as green.

**Commit:** `27a2bc40e`.

---

## Round 27b — closed the contract-test blind spot with a DTO conformance guard

Round 27 identified the seam: the ~50 `api-*-contract` suites assert the IPC **command name**, never
the **payload shape**, so a mock DTO that disagrees with its declared interface passes every test.
Two real defects shipped through that hole (`qr_url`, `deviceRevoked`). This round closes it.

### The guard

`ui/src/__tests__/dev-mock-dto-conformance.test.ts` pairs each command with a fixture **typed as
its DTO**. Typing the fixture is what makes it work in both directions: `tsc` keeps the fixture
honest (add a field to the interface and this file stops compiling), and the runtime compares the
fixture's key set against what the mock actually returns, reported field-by-field.

Covering `get_license_status`, `check_license_status`, `has_users`, `provision_device`,
`link_device_google`, `link_device_email_consume` and `get_preset_features`, plus two bespoke cases:
`start_device_pairing` (the shape that actually shipped wrong) and `poll_device_pairing`, whose DTO is
**partial by design** — `tenant_id`/`email`/`terminal` are optional, so key equality would be the wrong
assertion; it checks the one required field, `status`.

### Independent verification that it works

Reintroducing **both historical defects at once** makes it fail and name them:

```
check_license_status must match ServerLicenseStatus:
  expected [...] to deeply equal [...] - "deviceRevoked",
start_device_pairing: - "qr_url",
```

That is the guard catching, by name, the exact two fields whose absence caused rounds 26 and 27 — not
a tautology.

### ⚠️ The full suite is not reliably green, and this round proved it

Mid-round, a full run reported **6 failed files / 8 failed tests** — more than the one-or-two flake I
had been seeing. Rather than assume, I measured: moved the new file aside and ran the suite on the
otherwise pristine tree. **The pristine tree failed worse — 5 files / 23 tests**, with an entirely
different set (PosScreenDeductionLocation, SessionLockScreen, i18nBundle, RetailPosScreenCheckout).
Two subsequent runs were **fully green: 607 files / 10,363 tests**.

So: the flakiness is pre-existing, load-dependent, and not attributable to any change in this audit.
Recorded because I reported earlier rounds as "green" on single runs where that was partly luck — the
honest statement is that this suite is green **most** of the time under parallel load, and a red run
needs an isolated re-run before it means anything.

### Verification

**607 files / 10,363 tests pass** on two consecutive full runs · `tsc` clean · lint **0 errors** ·
parity **0 missing** · the guard is 9/9.

**Commit:** `e2e4921f7`.
---

## Round 28 — verified the setup/auth command surface has no remaining unhandled commands

Two housekeeping items first, both caused by my own earlier mistakes:

1. **A duplicate of this file existed in the repo.** A peer's `cd7bdaef9` ("consolidate all audits
   into domain subfolders") added `docs/audits/setup/setup-state-of-the-art.md` as a NEW file without
   removing the old `docs/audits/setup-state-of-the-art.md`, and the copy it committed predated my
   round-27b repair (68821 vs 71532 bytes, missing that section). I completed their stated intent:
   synced the subfolder copy to current and dropped the root one. **One canonical path now:**
   `docs/audits/setup/setup-state-of-the-art.md`. **Commit:** `d05e296df`.
2. Round 27's repair commit (`a95ff05a8`) is what restored this file after I truncated it; it is
   intact at 1274 lines with 12 round sections.

### The substantive work: is the drift class closed?

Round 27 found three unhandled commands in the account-linking path. Rather than assume that was the
only instance, I scanned **every command the setup and auth surfaces call** and classified each by
whether it resolves:

```
SETUP (10 commands) — all resolve
  get_device_id, get_preset_features, provision_device, start_device_pairing,
  poll_device_pairing, link_device_google, link_device_email_request,
  link_device_email_consume, get_first_run_state, has_users

AUTH (10 commands) — all resolve or return a DELIBERATE null
```

**The setup path is clean** — round 27's three fixes closed it, and nothing else in that flow falls
through to the unknown-command branch.

### A false positive I caught before reporting it

The auth scan initially flagged three commands as unhandled: `destroy_session`, `get_staff_profile`,
and `get_own_avatar`. **All three are correct.** My probe was wrong, twice over:

- it called them with `{ args: {} }` while they take a `sessionToken`, so the call did not exercise
  the handler at all;
- and two of them (`destroy_session: () => null`, `get_own_avatar_scoped: () => null`) return `null`
  **by design** — the first is a `void` command, the second means "this user has no avatar", which
  `PosScreen.tsx:208-210` already falls back from to initials.

So a `null` return is not by itself evidence of a missing handler, and my first scan treated it as
such. Re-checked with realistic arguments and against the call site before concluding anything — the
lesson round 25 taught about misdiagnosis, applied here.

### Verification

**607 files / 10,363 tests pass** · the DTO conformance guard (round 27b) covers the nine DTO shapes
these commands return · `tsc` clean · lint **0 errors** · parity **0 missing**.

### Where the objective stands

Across rounds 16-28 the pattern has been consistent: **the product surfaces hold up; the scaffolding
around them does not.** Every defect found in that span was in the dev-mock, the test harness, or my
own documentation — not in the wizard or the login flow themselves. This round's scan found no new
product defect, which is the expected result now that the mock's command surface has been swept.

Remaining known items, unchanged:
- the provisioning card is ~700px taller than the desktop viewport (structural, needs a product call);
- no real-hardware verification of any fix.
---

## Round 29 — the website signup → setup handoff, driven end to end for the first time

Last round I said I was mostly testing my own infrastructure. This round I went back to the
objective's own surface and drove the flow a merchant actually takes — signup on the website through
to the app download — which no round had ever done. **It works, and I found no defect.**

### What was driven (real browser, `astro dev`, Worker + licence server stubbed)

```
/en/signup   fill email + password + confirm  →  POST register {email, password, password_confirm}
            advance to the 6-box OTP step     →  POST verify-otp {email, code: "123456"}
            redirect                           →  /en/account
/en/account authenticated dashboard, user's email shown, zero page errors
```

Every request payload was correct and no page error fired at any step.

### The handoff a brand-new merchant actually gets

The account page for a tenant with zero devices offers exactly the three paths that lead into the
setup wizard, and all three resolve:

| Control | Destination | Status |
|---|---|---|
| Download app | `/en/download` | 200, "Download kasir.mu" |
| Activation guide | `/en/docs/activation` | 200, "License Activation — Documentation" |
| Register terminal | `/en/pair` | 200, "kasir.mu — Pair a tablet" |

All three also resolve in Indonesian with the correct localized titles (`Unduh kasir.mu`,
`Aktivasi Lisensi — Dokumentasi`), so the handoff is not English-only.

**This matters because it is the seam between the two halves of the objective.** Signup is the
website's job; the setup wizard is the terminal's. A merchant crossing that seam is what round 27's
missing `link_device_*` handlers broke, and what the `qr_url` defect broke in round 26. Verified
intact.

### Incidentally confirmed as already correct

- **The OTP step is six separate inputs**, each with `aria-label="Digit N of 6"` and
  `autocomplete="one-time-code"` on the first. A single `inputmode="numeric"` query matched all six,
  which is how I noticed — a screen reader gets a properly-labelled sequence rather than one
  unlabelled box.
- **A failed hydration was my probe's fault, not the page's.** My first attempt queried the form
  after `networkidle` and saw none; waiting for the island to mount showed the full form. Worth
  recording because the instinct was to report "the signup island does not hydrate".

### Process

No code changes; the probe was deleted and the dev server stopped. `website/` shows four untracked
files (`acct-proof.*`) belonging to another session — left untouched per the shared-checkout rule.
The only commit this round is this record.