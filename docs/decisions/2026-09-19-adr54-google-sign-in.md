---
num: 54
area: security
title: "ADR #54: Google Sign-In — web sign-in/sign-up and desktop setup-wizard account linking"
status: Proposed (2026-09-19) — nothing implemented
---

# ADR #54: Google Sign-In — web sign-in/sign-up and desktop setup-wizard account linking

**Status:** Proposed (2026-09-19). Nothing below is implemented; §1 is measurement, §1.7 is
upstream constraint.
**Date:** 2026-09-19
**Recorded against:** branch `0.0.39` @ `1569a67ad`
**Tags:** auth, oauth, google, identity, website, desktop-tauri, setup-wizard, security

> Cite this record by filename, not by number. `docs/decisions/README.md` records that
> numbering in this directory has collided before (#43) and that filename-plus-number is the
> only safe citation form.

## 1. Context

### 1.1 One auth authority, already

The Go licence server (`apps/license-server/`, PocketBase v0.39.6) is the sole account
authority. Its whole surface is 44 route registrations in `main.go`, of which the web half is
`register`, `login`, `request-otp`, `verify-otp`, `set-password`,
`request-password-reset`, `reset-password`, `logout`, `me`, and the F1
`exchange-issue`/`exchange-consume` pair (`apps/license-server/main.go:278-302`).

Sessions live in memory — `webOtpStore` (`web_otp.go:84`), 24 h default
`OZ_WEB_SESSION_TTL` (`web_otp.go:44-47`), active-use refresh (`:128`). They do not
survive a deployment. That is survivable for a browser tab and is one of the reasons this
ADR mints no desktop session (§2.4).

### 1.2 Email is already the account root, not merely one method

`tenants` **is** the account record (`pb_schema.json:306`): `email` (unique —
`CREATE UNIQUE INDEX idx_tenants_email`, `pb_schema.json:462`), `phone`, `api_key`,
`status`, `email_verified`, `password_hash`, `password_reset_at`.

Three facts make the email the root credential rather than a peer of the others:

- `POST /web/request-otp` **creates the account** when the email is unknown
  (`createTenantForEmail`, `web_otp.go:642`, reached from `:604`) and answers a bare
  `{"status":"ok"}` either way, so the endpoint is enumeration-safe.
- `verify-otp` flips `email_verified` (`web_otp.go:821`).
- An empty `password_hash` is the documented normal state ("Empty for OTP-only accounts",
  `pb_schema.json:414`), so the code path needs no password to exist.

Consequence: **every account is reachable by email by construction.** Password is an
optional layer (`set-password`), and Google becomes a third, symmetrical door — not a
replacement for either.

One reservation already exists: the deployment admin identity's email is reserved and must
never be self-provisioned (`reservedAdminEmails`, "ONE SET, ONE READER",
`admin_tenant_lifecycle.go:78-80`; `web_otp.go:595-600` returns ok without provisioning).
Any Google resolver must consult the same set (§2.3).

### 1.3 The web front is a Worker that already owns session handoff

`website/worker.ts` fronts three hosts: `kasir.mu` (marketing, **no** `/api/v1`
proxy — `:693`), `admin.kasir.mu` (`DASHBOARD_HOSTS`, `:73`), and the API origin
`https://license.kasir.mu` (default at `:226`).

The F1 hardening already exists and is the reason this ADR adds no session transport: a
login mints a short-lived single-use 48-hex code, redirects with `?code=`, and the Worker
consumes it via `/web/exchange-consume`, sets the httpOnly cookie for the receiving
hostname with a 30-day Max-Age, and continues to a clean URL (`:709-752`).

Two CSP facts constrain the web UI: `script-src 'self' https://static.cloudflareinsights.com`
(`:140`) and `form-action 'self'` (`:147`). A Google button that is a cross-origin
`<form>` would be blocked, and a Google-hosted script would require widening `script-src`.

### 1.4 Desktop: the wizard runs *after* activation

`ui/src/app/AppShell.tsx` gates in this order:

| Order | Condition | Screen |
|---|---|---|
| 1 | `!bootAllowed` | `ActivationFlow` — `LicenseActivationScreen` → `CreatePinScreen` (`:509-516`) |
| 2 | `!session` | `StaffLoginScreen` (`:518-545`) |
| 3 | `!setupKnownComplete` | `SetupWizard` (`:548-557`) |

By the time the wizard opens, `POST /api/v1/license/activate` has already returned the
tenant `api_key`, and `crates/kasirmu-bridge/src/license.rs` has stored it encrypted under
`license.api_key` with the machine id (`:151`). **Google sign-in in the wizard therefore
cannot replace the licence-key step**; it can only attach an identity to an
already-provisioned device. The boot-gate reorder that *would* replace activation is a
different record (§2.10, non-goal).

The wizard's step 7, "Data & Cloud" (`SetupWizard.tsx:166-179`), already carries the
`cloud-sync` feature toggle, and cloud sync is already plan-gated
(`docs/decisions/2026-08-09-sync-plan-gating.md`).

The durable settings landing zone for a terminal identity already exists and is already
classified: `SYNC_TERMINAL_SECRET` is in `SECRET_KEY_DENY_LIST` (encrypted, never
plaintext, never exportable — `platform/core/src/settings/keys.rs:268`), `SYNC_TERMINAL_ID`
and `MACHINE_ID` are in `NON_EXPORTABLE_DEVICE_KEYS` (`:295-296`), and
`crates/kasirmu-bridge/src/settings_tests.rs` fails if a credential constant is missing from
either list. Storing a linked terminal credential needs no new storage decision.

### 1.5 Tablet

`ui/src/app/tablet/TabletAppShell.tsx` mounts the **same** `SetupWizard` (`:206`) —
`vite.mobile.config.ts` builds the same `ui/src` tree with a different entry — and never
imports `LicenseActivationScreen` at all; its gate is `StaffLoginScreen` (`:198`) then the
wizard. So any Google control placed in the wizard ships to Android unless it is excluded
deliberately, and there is no platform-detection helper in `ui/src` today.

### 1.6 Prior art

`docs/plans/website-plan.md:749` has listed "OAuth login (Google, GitHub)" at P2 since the
plan was written. No OAuth code exists anywhere in the repository: zero matches for
`oauth`/`OIDC` outside a BigQuery service-account token helper
(`crates/kasirmu-core/src/export/cloud_destination.rs:676-734`).

### 1.7 Upstream constraints (Google, current as of 2026-05-22)

These are the constraints that decide the shape, not preferences:

| Constraint | Source |
|---|---|
| **Embedded webviews are prohibited.** "A developer must not direct a Google OAuth 2.0 authorization request to an embedded user-agent under the developer's control." The error is `disallowed_useragent`. | OAuth 2.0 Policies |
| **Custom URI schemes are no longer supported on Android and Chrome apps.** | OAuth 2.0 for Mobile & Desktop Apps |
| **Loopback IP redirect on mobile apps is DEPRECATED.** | ibid. |
| Desktop loopback is supported: `http://127.0.0.1:<port>` on "a random available port"; the custom scheme, where used, must contain a period (reverse-DNS). | ibid. |
| In the token exchange for installed apps, `client_secret` is **Optional** — PKCE is the authenticator. | ibid., step 5 |
| With only `openid email profile`: External+Testing admits any user (the 100-user allowlist cap does not apply to basic scopes) but shows a testing warning; External+Published+**Unverified** shows no danger UI (that applies to sensitive/restricted scopes) but does **not** display the app name or logo; verified branding does. | App verification to use Google Authorization APIs |
| Consent-screen requirements include a homepage on a **verified domain** and a privacy policy. | OAuth 2.0 Policies |

Consequence: the tablet cannot use either browser redirect path. The desktop can use
loopback. Nothing may use a Tauri webview.

## 2. Decision

### 2.1 Google is a credential; the licence server stays the authority

No Google API scope beyond identity is requested (`openid email profile`), no offline
access is requested, and **no Google token is ever stored**. Google is used once, to learn a
verified `sub` and a verified email address.

### 2.2 Identity is stored as `(provider, subject)`, never as email

New PocketBase collection `tenant_identities`:

| Field | Notes |
|---|---|
| `tenant` | relation → `tenants` |
| `provider` | select: `google` (GitHub/Apple later) |
| `subject` | Google `sub` — the durable key |
| `email_at_provider` | provenance only, never a join key |
| `created`, `last_login` | audit trail |

Unique index on `(provider, subject)`. Added to `pb_schema.json` **and** as an idempotent
`ensureTenantIdentitiesCollection` boot step in `main.go`, following the established
`ensureEmailVerifiedField` / `ensurePasswordHashField` pattern (`main.go:134-200`), so
existing `pb_data` volumes upgrade in place.

Email is deliberately *not* the identity key: Google emails change, and our own account email
is changeable from the dashboard. `tenants.email` stays `UNIQUE` and stays the account key.

### 2.3 One resolution rule on every surface

Resolve a demonstrated identity (Google `sub`, or an emailed code) to a tenant:

1. `(provider, subject)` already bound → that tenant. **Success, idempotent.**
2. Bound to a *different* tenant → `409`. Never rebind.
3. Not bound, but the email resolves to a tenant → **link** (insert the identity row) and
   audit it. Requires `email_verified = true` as asserted by Google.
4. Email is in `reservedAdminEmails` → refuse, exactly as `request-otp` does
   (`web_otp.go:595-600`). Never create, never link.
5. Otherwise → **create** via the existing shared creation path
   (`createTenantForEmail`, `web_otp.go:642`) and then set `email_verified = true`,
   because Google proved the mailbox and the code round-trip is redundant. One creation
   function for both signups, so they cannot drift.

Auto-link at step 3 is not a convenience, it is a correctness requirement: if the same email
arrives through two doors, both must resolve to one account, or "use Google or your own
email" silently produces two accounts for one person and the second one has no licence.

### 2.4 Web: server-side redirect, reusing the F1 handoff

```
[Continue with Google]  (anchor, not <form> — CSP form-action 'self')
  → GET license.kasir.mu/api/v1/web/oauth/google/start?next=<path>
      pending record { state → next, verifier }, SameSite=Lax state cookie, 302
  → Google
  → GET license.kasir.mu/api/v1/web/oauth/google/callback?code&state
      state verified against cookie + one-time record; server exchanges the code;
      email_verified required; §2.3 resolution; audit
      mint F1 code → 302 https://kasir.mu/en/account?code=<48 hex>
  → worker.ts:709-752 consumes it → httpOnly cookie → clean URL
```

No new Worker code: the callback lands on the licence host (the marketing host has no
`/api/v1` proxy) and rejoins the existing consumer. `next` must be validated against an
allowlist of our hosts and relative paths or it is an open redirect.

No Google-hosted script, so `script-src` and `frame-src` are untouched and `form-action`
is respected by using a link.

### 2.5 Desktop: loopback + PKCE, exchanged server-side, handed off once

The wizard's step 7 offers *link this device to my account*. The Google variant:

1. Bind a listener on `127.0.0.1:0`, read the assigned port. **Bind before requesting**, so
   the exact `redirect_uri` is known.
2. Generate a PKCE verifier/challenge (S256) and a random state.
3. `POST /api/v1/desktop/link/google/start` with the device's own credentials
   (`machine_id` + the stored `license.api_key`), the `code_challenge`, the `state`, and
   the `redirect_uri`. The **device proves the tenant**; the user then proves the email.
4. Open the returned URL with the existing `tauri-plugin-opener` (already a dependency and
   already used for ADR #38's external image search — `crates/kasirmu-bridge/src/browser.rs:9-14`).
5. Google → `/api/v1/desktop/link/google/callback`: the **server** exchanges the code, so
   no client secret ships in the bundle and no JWKS verification is needed in Go; requires
   `email_verified`; binds per §2.3; `302` to
   `http://127.0.0.1:<port>/?link_code=<one-time>`.
6. The listener hands the code to the app, which calls `/api/v1/desktop/link/consume` with
   `machine_id`. The server registers the terminal (`POST /api/v1/terminals`,
   admin-key gated — `crates/kasirmu-api/src/spec/paths.rs:46-60`; hash-only storage at
   `pg.rs:922` / `verify_terminal_credentials` `pg.rs:974`) and returns the
   `device_secret`, shown once.
7. The app writes `sync_terminal_id` + `sync_terminal_secret`. Both are already on the
   credential/device lists (§1.4), so encryption and non-export are inherited, not invented.
   The listener closes; the page says "return to the app".

**No session is created and none is stored.** The transient state is a one-time code with a
short TTL. Consequence: the in-memory `webOtpStore` and its restart behaviour (§1.1) never
become a desktop problem, and there is no refresh-token model to design.

**Identity must match the tenant's account email.** The device proves *which* tenant; the
user proves they own `tenants.email`. Binding a *different* verified identity to the
device's tenant is refused, because otherwise anyone with two minutes of physical access
could attach a personal Google account to the shop's tenant and keep access.

### 2.6 Desktop alternative: an emailed code, same destination

The same step offers *email me a code instead*, because not every account is Google and
forcing Google would degrade the email path that is the account root (§1.2). The user enters
the account email; the server sends a code to `tenants.email`; the app submits it and lands
on the identical `link/consume` and the identical terminal credential.

**Link codes are purpose-bound.** A code issued for device linking must not be replayable
into `/web/verify-otp`, and vice versa; the store keys by purpose, not just by email. Rate
limiting and lockout reuse `login_lockout.go` and the `request-otp` limiter
(`web_otp.go:575`), counted per device + email.

### 2.7 Tablet: the email path, never the Google one

The Google control is excluded from the tablet build. Google closes both browser routes on
Android (§1.7), and there is no platform helper today, so one is introduced for the wizard
(the mobile seams are `main.mobile.tsx` / `index.mobile.html`).

The tablet keeps account linking **via the emailed code**, which needs no browser redirect
and therefore still works on Android. Excluding the whole feature on tablet would be the
lazier choice and is rejected.

Native Android Google sign-in (Android-type client + SHA-1 + Credential Manager behind a
Tauri mobile plugin) is future work, and iOS is out of scope until it is paired with Sign in
with Apple, which App Store Review Guideline 4.8 requires when third-party social login is
offered.

### 2.8 Console configuration

| Client | Type | Redirect | Secret |
|---|---|---|---|
| Web | Web application | `https://license.kasir.mu/api/v1/web/oauth/google/callback` | server env only |
| Desktop | **Desktop app** | none registered — loopback, app-chosen port | optional per Google; server-side only if present |

Consent screen: External, scopes `openid email profile` only, published to Production. No
sensitive-scope review is required for basic identity scopes; brand verification (verified
domain, homepage, privacy policy) is what replaces a bare project id with our name and logo
on the consent screen.

### 2.9 Secrets

`client_secret` lives only in the licence server environment (Northflank / the
`KASIRMU_*` pattern). It is never committed and never enters a desktop or tablet bundle. The
desktop flow is PKCE-protected and the client is public by design (§1.7).

### 2.10 Non-goals

- **Not a replacement for licence-key activation.** The wizard runs after `ActivationFlow`
  (§1.4). Reordering the boot gate so sign-in can precede activation is a separate record.
- **No account session, no account UI, no account screen** in the desktop app. The wizard is
  the only entry point. (See §9 O2 for the repair-path consequence.)
- **No sign-up from the app.** An identity with no matching account is refused with the
  registered address named, and the user is pointed at the web.
- **No Android or iOS Google sign-in**, as scoped in §2.7.
- **No new entitlement logic.** Whatever the existing signup path provisions, this ADR
  provisions; it adds no tier, trial, or billing behaviour.

## 3. Sign-in resolution matrix

| Account state | Attempt | Result |
|---|---|---|
| Any | Google, `sub` already bound to this tenant | signed in (idempotent) |
| Any | Google, `sub` bound to another tenant | `409` |
| password/OTP account | Google, email matches, `email_verified` true | identity linked, signed in |
| webhook/purchase account, `email_verified` false | Google, email matches | linked **and** `email_verified` flips true |
| no account | Google, basic scopes, `email_verified` true | account created, signed in |
| no account | Google, `email_verified` false | refused — never link an unproven address |
| reserved admin email | either method | refused, as `request-otp` refuses it |
| Google-created account | later uses email code | works — email is the root (§1.2) |
| Google-created account | later sets a password | works — `set-password` is unchanged |
| password account | later unlinks Google | safe; OTP remains |

**Invariant: there is no last-credential lockout.** Because OTP on `tenants.email` always
exists, unlinking Google is unconditionally safe and clearing a password is unconditionally
safe. This is a property of the existing design and is recorded so a future change does not
quietly remove it.

## 4. Consequences

- Web gains a third door with no new session transport, no Worker change, and no CSP
  widening.
- Desktop gains a real per-terminal credential in place of the tenant-wide `api_key`,
  which is the client ADR #50 P3 was written for but never had.
- The tablet gets account linking after all, because the email variant crosses no browser
  boundary.
- The identity record is provider-shaped, so GitHub (`website-plan.md:749`) and Apple are
  rows, not migrations.
- Wave F/i18n: every new string is Fluent (`shared-ui/locales/*.ftl`), every control carries
  an ARIA label, and UI calls go through `ui/src/api/`, never `invoke` in a component.

## 5. Tradeoffs / risks

- **`createTenantForEmail` is now reached from two resolvers.** Step 5 of §2.3 must call it
  and then flip `email_verified`; if a future change adds provisioning to one path, the
  two signups drift. Mitigation: no second creation path is permitted, and a test asserts
  both doors produce equivalent rows.
- **Auto-link merges a password account with a Google identity on first Google sign-in.**
  Accepted: the account *is* the email (`idx_tenants_email` unique) and Google asserts
  verified control of it. Audit-logged, and the dashboard must offer unlink.
- **Loopback any-port behaviour for a Desktop-type client is assumed, not yet proven here.**
  It is how installed-app CLIs work and the doc describes a random available port, but it is
  the first thing to confirm in the sandbox (§8). If it proves false, the fix is
  configuration only — a Web-type client with one pinned, registered port — not a code
  change.
- **A wizard-only entry point has no in-app repair path.** See §9 O2.
- **The licence server makes one outbound call to `kasirmu-api`** to register the terminal
  (§2.5 step 6), adding a cross-service dependency and an admin key to the licence server's
  environment. If that hop is unwanted, the fallback is to keep cloud sync on the
  tenant-wide `api_key` and defer the terminal credential — accepting that the link is then
  cosmetic.
- **Enumeration**: the web already answers uniformly (`web_otp.go:600-604`); the desktop
  link endpoints must do the same and must not confirm whether an arbitrary email has an
  account.

## 6. Alternatives considered

| Alternative | Why rejected |
|---|---|
| Google Identity Services button + ID token POST | Requires `accounts.google.com` in `script-src`/`frame-src` and a JS-origin registration, for UX we can reach by redirect; adds a third-party script to the marketing site. |
| `tauri-plugin-deep-link` (custom `mu.kasir.desktop://` scheme) | Unnecessary on desktop (loopback works), unsupported on Android (§1.7), and adds OS scheme registration plus a plugin to both apps. |
| Sign-in inside the Tauri webview | Prohibited — `disallowed_useragent` (§1.7). |
| Exchange the Google code in the desktop app and verify the ID token server-side | Moves a JWT/JWKS dependency into the Go server and puts the flow's outcome partly in the client, for no gain over the server-side exchange. |
| A `google_sub` column on `tenants` | Cheaper now, a migration when GitHub or Apple arrives; also loses link/unlink/last-login as first-class facts. |
| Bind any verified Google identity to the device's tenant | Anyone with brief physical access could attach a personal account and retain access. Refused in favour of the email match (§2.5). |
| Wizard-only, with no repair path ever | A revoked credential, a reimaged machine, or a second terminal becomes unsupportable. Named as O2 rather than silently accepted. |

## 7. Implementation plan

Each phase ships independently.

- **P1 — Licence server.** `tenant_identities` collection + `ensureTenantIdentitiesCollection`;
  the shared resolver (§2.3); `web/oauth/google/{start,callback}`; reuse of the F1 code.
- **P2 — Web.** The button and the `next` allowlist on `src/pages/[locale]/login.astro` and
  the signup page; the *Sign-in methods* card on the account portal. **Shippable alone**, and
  the half that converts.
- **P3 — Desktop.** `crates/kasirmu-bridge/src/oauth.rs` (PKCE, URL build, state validation —
  `uuid` + `hex` + `sha2` are already bridge dependencies; the bridge is contractually
  Tauri-free, `browser.rs:9-14`); `apps/desktop-tauri/src/commands/account_link.rs` (socket
  + opener) registered in `lib.rs`; `ui/src/api/account.ts`; the wizard step; terminal
  registration on consume.
- **P4 — Email variant + tablet exclusion.** The purpose-bound link code (§2.6) and the
  platform helper that keeps the Google control off Android.

## 8. Verification

- Go: resolver matrix (§3) as a table test, including reserved-admin refusal, `409` on
  foreign `sub`, `email_verified=false` refusal, and equivalence of the two creation doors.
- Go: state single-use and expiry; purpose-bound link codes rejected by `/web/verify-otp`.
- Bridge: `oauth_tests.rs` for PKCE derivation, URL construction, and `redirect_uri`
  validation (loopback only; a non-loopback or non-ephemeral redirect is refused).
- UI: the wizard step's states (idle, browser opened, awaiting, linked, refused, cancelled,
  timeout) and the tablet exclusion.
- Sandbox end-to-end, before P2 lands: the exact redirect-URI behaviour of the Desktop-type
  client, the consent screen with basic scopes only, and the `hostname`-scoped cookie
  surviving the `?code=` handoff.
- Gates as usual: `npm run check:all` from `ui/`, the Go gate, and the seven pre-commit
  steps — none of which this record's own commit should trip (documentation only).

## 9. Open questions

- **O1 — Which host set is canonical?** The code says `kasir.mu` / `admin.kasir.mu` /
  `license.kasir.mu` (`worker.ts:73-79`, `:226`); ADR #42 and the in-flight rebrand say
  `ozpos.my.id`. Redirect URIs and the consent screen's verified domain must be pinned
  before P2, and re-pinned is cheap only while nothing is in production.
- **O2 — Repair path.** The wizard is the only entry point (§2.10). A second terminal, a
  reimaged machine, or a revoked device secret then has no in-app remedy. Recommendation:
  keep the wizard as the only *entry point* surface but let Settings → Sync re-run the same
  one-shot link (§2.5/§2.6) — still no session, still no account UI. Otherwise the dead end
  is deliberate and should be stated in the support runbook.
- **O3 — Email mismatch in the wizard.** Recommended: refuse and name the registered
  address, offering the email-code method. The alternative is to allow a mismatch whenever
  the device presents a valid `api_key`, which re-opens §2.5's physical-access risk.
- **O4 — One Google identity per tenant, or many?** This record assumes one. Staff or
  co-owners needing their own identity would change that, and it should be decided before the
  unique indexes are created.

## 10. References

- `docs/decisions/2026-09-11-adr50-sync-auth-hardening.md` — P3 terminal registration and
  client credentials; the client this ADR finally gives a real terminal credential to.
- `docs/decisions/2026-09-11-adr51-sealed-settings-ingest-policy.md` and
  `2026-09-12-adr52-tracked-settings-funnel-refuses-cleartext-credentials.md` — why the
  device secret is written through the credential-family machinery and not as a plain setting.
- `docs/decisions/2026-08-28-adr42-website-admin-and-user-dashboard.md` — the account portal
  and admin surface this ADR adds a door to.
- `docs/decisions/2026-08-28-adr41-app-lifecycle-device-onboarding-topology-home-gating.md`
  and `2026-08-20-adr40-multi-terminal-peer-model.md` — the lifecycle gate and peer model the
  tablet's exclusion rests on.
- `docs/plans/website-plan.md:749` — the P2 backlog item this record implements.
- Google: *OAuth 2.0 for Mobile & Desktop Apps*, *OAuth 2.0 Policies*, *App verification to
  use Google Authorization APIs* (retrieved 2026-09-19).
