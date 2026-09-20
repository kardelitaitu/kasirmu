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
That guard lives **inside creation** (`createTenant`, `web_otp.go:696-698`), so a new
resolver inherits it for free on the create path and inherits nothing on the link path —
which is why §2.3 refuses before linking.

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
>
> **Deviation (2026-09-19): the collection is created programmatically, and only
> there.** `ensureTenantIdentitiesCollection` runs at boot for a fresh volume and
> an existing one alike, so one code path covers both and the collection definition
> cannot drift from the code that reads it. `pb_schema.json` is deliberately left
> alone; it is not added to `requiredCollections`, because nothing at boot requires
>
> **The collection needs its `created` / `updated` autodate fields explicitly.**
> `core.NewBaseCollection` does not add them, and the dashboard list sorts by `-created`:
> without them the endpoint answers 500 `invalid sort field "created"` at query time. Caught
> by a test, not by inspection — a reminder that this list is a schema, so a later field
> addition needs its own `ensure*Field` migration the way the tenants collection has them.
> the table and listing it there would turn a missing identity table into a
> failed deployment.

Email is deliberately *not* the identity key: Google emails change, and our own account email
is changeable from the dashboard. `tenants.email` stays `UNIQUE` and stays the account key.

### 2.3 One resolution rule on every surface

Resolve a demonstrated identity (Google `sub`, or an emailed code) to a tenant:

1. `(provider, subject)` already bound → that tenant. **Success, idempotent.**
2. Bound to a *different* tenant → `409`. Never rebind.
3. Email is in `reservedAdminEmails` → refuse, exactly as `request-otp` does
   (`web_otp.go:595-600`). Never create and never link. **This check must precede the link
   step**: creation is already guarded inside `createTenant` (`web_otp.go:696-698`), but
   nothing guards *linking*, and the admin's own `tenants` row already exists with

**Shipped 2026-09-19 (audit trail):** `identity_events` records one row per resolution —
provider, subject, provider address, outcome, and the tenant when there is one — written from
`resolveIdentity`'s single exit rather than from each branch, so a branch added later cannot be
audited by omission. **Refusals are recorded too**: `refused_reserved`, `refused_unverified`,
`refused_mismatch` and `conflict` are precisely what an investigation into "why can't I sign
in?" or "who attached this account?" needs, and they are the rows a happy-path-only trail would
have dropped. Two tests pin it: one drives all five outcomes and checks the rows, one drops the
collection and proves linking still succeeds.

The write is **best-effort by design** — a failed insert is logged loudly and the sign-in
proceeds. Refusing a legitimate sign-in because the audit sink hiccuped costs the user more than
the gap it leaves. The reader is the licence server's own PocketBase admin console; no bespoke
audit UI is built, and none is promised here.
   `email_verified = false` — so a link attempt would attach a Google identity to the admin
   tenant and flip it verified.
4. Not bound, but the email resolves to a tenant → **link** (insert the identity row), flip
   `email_verified` to true if it was false, and audit both. Requires
   `email_verified = true` as asserted by Google.
5. Otherwise → **create** via the existing shared creation path
   (`createTenantForEmail`, `web_otp.go:642`) and then set `email_verified = true`,
   because Google proved the mailbox and the code round-trip is redundant. One creation
   function for both signups, so they cannot drift.

Auto-link at step 4 is not a convenience, it is a correctness requirement: if the same email
arrives through two doors, both must resolve to one account, or "use Google or your own
email" silently produces two accounts for one person and the second one has no licence.

**Shipped 2026-09-19 (server half):** `apps/license-server/identities.go` implements the table
above as one function, `resolveIdentity(app, provider, subject, email, emailVerified,
claimedTenantID)`, returning a typed outcome (`bound` / `linked` / `created` /
`refused_reserved` / `refused_unverified` / `refused_mismatch` / `conflict`) so both the web
flow and the desktop device-link flow consume the same decision instead of re-deriving it.
`identities_test.go` pins eight cases — the create, the idempotent re-sign-in, the link that
flips `email_verified`, the reserved-address refusal (including a case-variant address, since
the reservation compares normalised), the unverified-address refusal, the ordering guard that
the reservation fires *before* the verification gate, the conflict that never rebinds, and the
device path's email-match requirement. A further case pins that a re-sign-in **refreshes `last_login`** rather than being a
silent no-op — a stale stamp misreports when an identity was last used, which is the value an operator
reads mid-incident.

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

That clause shipped as code on 2026-09-19, and it shipped because it was not merely
aspirational: `website/src/lib/safe-next.ts` resolves `?next=` by **origin comparison**, and the

**Shipped 2026-09-19 (OAuth security core):** `apps/license-server/web_oauth_google.go` carries
the parts that decide whether a callback may sign anyone in, and every one of them is testable
without Google or a network: the single-use 10-minute state store (an expired or replayed state
is refused exactly like an unknown one); the PKCE pair with its S256 challenge; a
fixed-parameter authorize URL (`openid email profile`, no offline access, and
`prompt=select_account` so a shared browser never silently reuses whoever is signed into
Google); the server-side code exchange, whose token endpoint is a *parameter* so tests drive a
fake; and the ID-token claims check — `iss`, `aud` (string or array), `exp`, a subject, and a
normalised email, with `email_verified` carried through for the resolver to enforce.

The signature is deliberately **not** verified, which is the direct consequence of §2.5's own
choice to exchange server-side: the token arrives over TLS from Google's token endpoint in
response to our request, so no third party can inject one — and that is also why no JWKS
machinery is needed in Go. The claim checks stay, because a token minted for a different client,
or an expired one replayed out of a log, must not authenticate here. Ten tests pin this,

**Shipped 2026-09-19 (routes):** `GET /api/v1/web/oauth/google/start` and
`.../callback` are registered in `main.go` and mirrored in the test app's route table, so the
whole flow is exercised through the real router. `/start` mints the state, records the pending
flow, binds the state to the browser with an HttpOnly/Secure/SameSite=Lax cookie, and redirects
to the consent screen; `/callback` checks the state against **both** the store and that cookie
(a leaked state is useless without the browser that started the flow), exchanges the code
server-side, validates the claims, calls `resolveIdentity`, and hands the marketing host a
single-use F1 code — never a session token in a URL. A declined consent returns the user to the
login page with the reason rather than to a JSON error.

Two bounds worth naming. `/start` is unauthenticated and writes into a map, so the store now
refuses past `oauthMaxPending` rather than growing without limit within its TTL. And the
A third bound followed from asking what the ceiling does *not* protect: it bounds **memory**, not
**availability**, so a host could still spend everyone else's sign-ins by filling the map and forcing
`503`s for a TTL window. `/start` now takes a per-IP bucket (30/15 min — looser than the OTP limiter's
10, because a shared office IP signs several people in and a withdrawn consent is a legitimate retry),
and a `503` from an unconfigured deployment deliberately does *not* consume that budget, or an operator
who sets the client id last would find every sign-in refused for fifteen minutes.
Both halves of that bound are now tested: the ceiling refuses the entry past it, and expired
entries are swept on insert, so a full map cannot wedge the endpoint shut.
post-login path is validated by `oauthNextPath`, the server-side twin of `lib/safe-next.ts` —
same shape, same rejections (`//`, `/\`, `/<tab>/`), because the two guards must not disagree
about what a same-site path is. The redirect *host* is never attacker-influenced: it comes from
`OZ_WEB_SITE_URL`, so only the path needed validating and no host allowlist was required.

**Shipped 2026-09-19 (website):** the login form offers "Continue with Google" above the
email/password tabs, with an "or use your email" divider — an **anchor, not a form**, since the
Worker CSP sets `form-action 'self'` and the link navigates to the licence host, which then
redirects to Google. It is hidden entirely when the API URL is absent, because offering an entry
that can only 404 is worse than not offering it. Strings live in both dictionaries (`en`/`id`),
declared in `AUTH_FORM_LABELS` and asserted used by the island-label-coverage guard.

**The admin login page deliberately gets no Google button.** The deployment admin address is
refused by the resolver (§2.3), so the entry would only ever produce a 403 — the refusal and the
absent button are the same decision seen from two sides.

**Configuration is documented before it is needed:** `.env.example` and the licence server's
`DEPLOY.md` (step 7b, inserted rather than renumbered so no existing cross-reference moves) carry
`OZ_GOOGLE_CLIENT_ID` / `OZ_GOOGLE_CLIENT_SECRET` / `OZ_GOOGLE_REDIRECT_URI` / `OZ_WEB_SITE_URL`,
each naming the failure it prevents. The console-first order is stated as a requirement: redirect
URIs match exactly, so registering both callback URIs **before** deploying is what keeps either
live host from failing every sign-in with `redirect_uri_mismatch`.
including the three refusals that matter most: replayed state, foreign audience, expired token.
guard it replaced was bypassable. `AuthForm.tsx` tested `next.startsWith('/') &&
!next.startsWith('//')`, which correctly rejects `//evil.com` — and passes `/[backslash]evil.com`
and `/<tab>/evil.com`, both of which the URL parser normalises into a protocol-relative
navigation to another origin (`[backslash]` becomes `/`, and tab/CR/LF are stripped before
parsing). All three were measured against the parser before the fix; two of them escaped.
Because the fix is an origin check rather than a new prefix test, it also covers the shapes
nobody enumerated. The OAuth callback returns through this same parameter, so §2.4 must reuse
that helper and must not write a second, weaker guard.

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
   no client secret ships in the bundle and no JWKS verification is needed in Go. The
   returned ID token is still checked for `iss`, `aud == client_id` and `exp`, and only
   `sub`, `email` and `email_verified` are read from it; `email_verified` is required;
   binds per §2.3; `302` to `http://127.0.0.1:<port>/?link_code=<one-time>`.
6. The listener hands the code to the app, which calls `/api/v1/desktop/link/consume` with
   `machine_id`. The code is single-use, TTL-bounded, and **bound to the `machine_id` that
   started the flow** — a mismatch is refused, so a code lifted out of the loopback URL is
   worthless on another device. The server registers the terminal (`POST /api/v1/terminals`,
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

**Shipped 2026-09-19 (desktop server side):** `apps/license-server/desktop_link_google.go`
implements all three endpoints — `/start` (device-authenticated, returns the consent URL),
`/callback` (Google's return, which binds and redirects to the loopback listener), and
`/consume` (loopback code in, linked account out). Five tests cover the properties that make
it safe: only a **loopback http redirect with an explicit port** is accepted (the value comes
from the app and the callback redirects to it verbatim, so anything else is an open redirect
that hands a one-time code to whoever asked); the tenant is proven by the device's `api_key`
**plus a machine registered to it**, never by the request; PKCE runs app → server → Google, so
the exchange stays server-side; and the code is single-use *and* bound to the machine that
started the flow.

Two decisions worth naming. A **mismatched consume burns the code**, like a one-time password:
the cost of a leaked code is a wasted two-minute window rather than a link, and the legitimate
device simply retries. And the pending-state store was **extracted** (`pending_store.go`) rather
than copied for this flow — a second copy of a security control is how one of them quietly
loses a bound the other still has.

> **The test earned its keep on the first run.** A comment edit to this handler dropped the
> `return` from the device-binding branch, so a foreign machine's consume fell through to `200`
> — an authorization bypass, caught because the test asserted the refusal rather than the happy
> path alone. Worth remembering when a "documentation only" edit touches a guard.

**Still to do on this path:** the client half (bridge PKCE, the Tauri loopback listener, the
wizard step) and the terminal credential of step 6 — the latter needs the sync API's admin-key
registration call, and is the piece ADR #55 §5 already flags as the first thing to cut.

**Shipped 2026-09-19 (client, pure half):** `kasirmu-core/src/desktop_link.rs` carries PKCE
plus the two calls. It lives in `kasirmu-core` rather than `kasirmu-bridge` for the same reason
the sync client does: the bridge deliberately has no HTTP stack, and every outbound call in this
repo goes core → bridge → shell. Five tests pin it, including **RFC 7636's own worked example** —
a challenge that merely round-trips against our verifier would pass everything and still fail
against Google.

> **That test caught a real interoperability bug.** `generate_pkce` first reused the crate's
> `generate_nonce`, which is a 32-character UUID — and RFC 7636 requires **at least 43**
> characters, so Google would have rejected every exchange with `invalid_request`. Reuse was the
> right instinct and the wrong helper; the length assertion is what said so. Now two UUIDv4s (64
> hex characters, 244 bits) from the same CSPRNG the crate already trusts.

**Still to do on this path:** the shell half — the loopback listener, launching the system
browser, and the wizard step that calls these two functions — and the terminal credential of
step 6.

**Shipped 2026-09-19 (loopback listener):** `kasirmu-bridge/src/desktop_link.rs` binds an
ephemeral port, hands out the literal `http://127.0.0.1:<port>` redirect URI, and waits for the
redirect — answering the browser with a static page and returning what it carried. Eight tests.

Three details that are the difference between working and nearly working:

- **The favicon is the trap.** Browsers request `/favicon.ico` immediately after the redirect, so a
  listener that ends its one-shot accept on the first request loses the callback and strands the
  user. A request carrying neither parameter is answered `404` and skipped — pinned by a test that
  sends the favicon first.
- **The served page is static and never reflects the query.** Anything can navigate the user's
  browser at the loopback port, so interpolating `link_error` would be script injection into a page
  they are looking at. A test drives a `<script>` payload through and asserts the page stays clean.
- **The accepted socket is set back to blocking explicitly.** Whether it inherits the listener's
  non-blocking mode is platform-defined; if it does, `read_line` returns empty before the request
  arrives and the callback is silently lost.

**Shipped 2026-09-19 (orchestration):** `link_device` runs the flow from bind to linked account —
bind, PKCE, start, hand the consent URL to the launcher, wait, consume — and takes the launcher
as an injected `FnOnce(String) -> Result<(), BridgeError>`. That injection is the point: it keeps
the function free of any UI toolkit and lets four tests drive the **whole flow against a stub
licence server and a fake browser** — including the PKCE verifier reaching the server, the code
from the loopback URL being what gets spent, the device named on both calls, and a declined
consent surfacing as `Invalid` rather than as a transport error. Twelve tests in this module now.

The browser is opened only *after* the server records the pending link: a browser that arrives
before the state exists has nothing to complete.

**Shipped 2026-09-19 (IPC surface):** `link_device_google` in the desktop shell is a shim — it
supplies the resolved licence origin and the app's own opener (ADR #38's https-only one) and
forwards to the bridge. The launcher is therefore **async** in `link_device`, because every real
opener is and wrapping one in a blocking call would park the runtime the command itself runs on.

Two shell gates had to be satisfied rather than argued with. The **registration gate** parses every
registered command name and demands each be gated or carried in a generated debt ledger, so the
new name needed a regenerated ledger row — `no_session_resolution`, which is the honest
classification: this command authorises through the device's licence key and its registered
machine, not through a session, and `REGISTERED_TOTAL` moved 458 → 459. The **IPC parity** gate
reports OK: the tablet shell does not register this command, and no UI file names it yet, so there
is no gap to allowlist — that entry arrives with the wizard step, which is the next piece.

**Shipped 2026-09-19 (wizard step):** the setup wizard gained a ninth step — Account — before
Review, with `StepAccount.tsx` calling `link_device_google`. It is optional by design and says
so: the app runs on its licence key alone, so the step never blocks Continue, and a failure
shows a fixed localized line rather than the raw IPC error (ERR-10; the reason is already
logged by `loggedInvoke`).

Two results fell out of wiring it. The **tablet shell needed the command too** — the wizard
lives in the shared `ui/`, so the step renders there and a desktop-only command would have
been a runtime parity gap; a forty-line mirror plus its own regenerated ledger row
(`REGISTERED_TOTAL` 320 → 322) fixes it. And the **dev-mock cannot answer this command**, so
`scripts/ipc-parity-allowlist.json` carries it with a reason: the real call opens a browser and
blocks on a loopback port, which nothing headless can do.

Four gate failures were fixed on the way and all four were real: the wizard's step arithmetic
(8 → 9), the dead-class walk needing `additionalTsx` for the new sub-component and
`externalClasses: ['lsp-root']` for a class the sheet only names inside a `:has()` (it belongs
to a child component), and the two locale dictionaries.

**Corrected the same day (credentials):** the command's first signature took `api_key` and
`machine_id` as arguments — modelled on `activate_license`, which is wrong here. That command
takes credentials because the *user types them*; this device already holds them, encrypted, in
Settings. The command now resolves them itself through a new `license::stored_credentials`, so
**no licence secret crosses the IPC boundary** and the renderer sees only the account it was
linked to. Reading them is also the honest precondition check: before activation there is no
tenant to bind an identity to, so an unactivated device gets `Invalid` rather than a 403 from
the server.

The unsealing rule (base64 ciphertext bound to the machine id, else legacy plaintext) was
**extracted into one function** shared with activation rather than copied: two copies of
"decrypt or fall back to plaintext" is exactly what drifts out of agreement in the
less-exercised copy.

### 2.6 Desktop alternative: an emailed code, same destination

The same step offers *email me a code instead*, because not every account is Google and
forcing Google would degrade the email path that is the account root (§1.2). The user enters
the account email; the server sends a code to `tenants.email`; the app submits it and lands
on the identical `link/consume` and the identical terminal credential.

**Link codes are purpose-bound.** A code issued for device linking must not be replayable
into `/web/verify-otp`, and vice versa; the store keys by purpose, not just by email.

Rate limiting and lockout cover **both** methods — state issuance on `start`, the emailed
code, and `consume` — reusing `login_lockout.go` and the `request-otp` limiter
(`web_otp.go:575`) and counted per device + email, so neither door is the cheaper one to
brute-force.

**Shipped 2026-09-26 (server half):** `desktop_link_email.go` — `POST /api/v1/desktop/link/email/request`
mails a code to the tenant's own address, and `.../consume` spends it and marks the account verified.
The store is now **purpose-keyed** (`purposeLogin` / `purposeLink`), which is what makes the §2.6 rule real:
a link code presented at `/web/verify-otp` is refused **and left in place**, so a mistaken login attempt
cannot destroy the code the user was just sent — both halves are pinned by
`TestStore_CodesArePurposeScoped`, and the HTTP refusal by `TestLinkCodesAreNotSpendableAsLogins`.

The address must be the **tenant's own**: the device proves which tenant it holds with its api_key, so the
submitted address is a confirmation rather than an identity claim, and a device can never aim a code at a
mailbox it does not hold. No `tenant_identities` row is written — nothing federated was linked — and the
proof of inbox control stays where the email flow already keeps it, `tenants.email_verified`.

> **A consequence worth knowing:** the login lockout is shared, as §2.6 requires. A user who tries their
> link code in the *login* form gets a 5-second (escalating) wait before the link door will answer. That is
> the intended coupling — the alternative makes this endpoint the cheaper door to guess at — but it is a
> real UX consequence, and it is why the test that pins refusal-without-consumption lives at the store level
> rather than in an HTTP sequence.

**Shipped 2026-09-27 (client half):** both shells expose the two calls, and the tablet's Account step
is now a real form — the address, *Email me a code*, then the code — decided by the same shell flag that
excludes the Google control, so a caller cannot re-enable either half. Five strings in both dictionaries;
the dev-mock cannot answer these commands, so `ipc-parity-allowlist.json` carries them with reasons, as it
does for the Google control.

**Shipped 2026-09-26 (terminal credential, step 6):** `/consume` now registers the device with the sync
service and returns a one-time `device_secret`; both shells store it through the typed encrypting setters
(`sync_terminal_id`, `sync_terminal_secret`), so the credential is encrypted at rest and the
credential-storage-form gate is satisfied rather than sidestepped.

> **Best-effort, and it says so.** This is the one cross-service call in the link path, so an
> unconfigured, unreachable or refusing sync service does NOT fail the link — the reply carries
> `terminal.issued: false` with a reason and the server logs it loudly. Four tests pin that: the
> registration reaching the stub with the admin key and the right body, the unconfigured case, a
> 401 from the sync service (with the identity still linked), and the email door issuing the same
> credential. `OZ_SYNC_API_URL` has no default — addresses are declared, never guessed (#55).
>
> **Verified, so the credential is not inert:** `apps/desktop-tauri/src/sync_bootstrap.rs:256-257`
> reads these two keys, and the push and pull paths read them again **on every operation**
> (`kasirmu-bridge/src/sync.rs:576-595` and `:908-927`) rather than caching them at daemon start —
> so a credential stored at link time is used by the next sync, and a rotation on re-link is picked
> up instead of leaving a stale secret in a running process. Same sentence as before:
>
> (the bootstrap's own read follows)
> reads exactly these two keys, which is what makes storing them at link time worth doing. That file
> also *writes* them on its own pairing path, so the two are two ways to the same state rather than a
> conflict: whichever ran last holds a credential the server has registered, and a superseded
> `sync_terminals` row is inert because verification looks up by `(terminal_id, secret_hash)`.
>
> **Why the registration carries a `tenant_id` when the bootstrap's does not.** Measured, because the
> two paths differ and only one of them can be right for a licensed device: `verify_terminal_credentials`
> is a **pre-tenant read** under a BYPASSRLS discovery role whose whole purpose is to *learn* the tenant
> from the row (`kasirmu-api/src/pg.rs:986-1023`), and `sync_terminals` is FORCE-RLS with
> `USING (tenant_id = current_setting('oz.tenant_id', true))` (`pg_tests.rs:1402-1403`). So the row's
> `tenant_id` is the authority for the tenant every token minted from that credential will act as: send
> the wrong one and the row exists but its own device cannot see it. The bootstrap's tenant-less
> registration (`sync_bootstrap.rs:325-331`) is the legacy/dev pairing whose own comment says the claim it
> produces "simply identifies no recipient row" — not a model for a licensed device.
>
> Not claimed: that the cloud holds a *plan* row for that tenant. Unknown tenants read as free, which the
> gate tolerates deliberately (`sync_client.rs:398`, "a free tenant is gated, not broken").
behind it — and the terminal credential both paths still owe (step 6).

### 2.7 Tablet: the email path, never the Google one

The Google control is excluded from the tablet build. Google closes both browser routes on
Android (§1.7), and there is no platform helper today, so one is introduced for the wizard
(the mobile seams are `main.mobile.tsx` / `index.mobile.html`).

The tablet keeps account linking **via the emailed code**, which needs no browser redirect
and therefore still works on Android. Excluding the whole feature on tablet would be the
lazier choice and is rejected.

Native Android Google sign-in (Android-type client + SHA-1 + Credential Manager behind a

**Enforced 2026-09-19:** the exclusion is now real and tested. The shell flag lives in
`ui/src/utils/shellKind.ts`, set by each entry point before the first render — `main.tsx` marks
desktop, `main.mobile.tsx` marks tablet — because the two builds share every component and differ
only in their entry, which is the seam this section names. `StepAccount` renders the Google
control on desktop and, on tablet, a line saying the account links itself when you sign in with
Google **on the web**. Two tests pin both halves.

> **Still owed from this section:** the tablet's own path — linking *via the emailed code* — is not
> built. The interim is truthful rather than a stand-in: §2.3's web flow attaches the identity to
> the tenant whose address the provider verified, so signing in on the web really does link the
> store's account. What is missing is doing it **from the device** without a browser round trip,
> which is the half that needs the emailed-code flow.
Tauri mobile plugin) is future work, and iOS is out of scope until it is paired with Sign in
with Apple, which App Store Review Guideline 4.8 requires when third-party social login is
offered.

### 2.8 Console configuration

| Client | Type | Redirect | Secret |
|---|---|---|---|
| Web | Web application | both names for the same deployment (ADR #55): both names for the same deployment (ADR #55): `https://license.kasir.mu/api/v1/web/oauth/google/callback` **and** `https://license.ozpos.my.id/api/v1/web/oauth/google/callback` **and** `https://license.ozpos.my.id/api/v1/web/oauth/google/callback` | server env only |
| Desktop | **Desktop app** | none registered — loopback, app-chosen port | optional per Google; server-side only if present |

Consent screen: External, scopes `openid email profile` only, published to Production. No
sensitive-scope review is required for basic identity scopes; brand verification (verified
domain, homepage, privacy policy) is what replaces a bare project id with our name and logo
on the consent screen.

> **Amended 2026-09-19 by ADR #55:** the Web flow cannot fall back between hosts — a browser
> redirect goes where it goes and Google matches redirect URIs exactly. Both callback URIs above
> must therefore be registered, and the Worker configured with whichever host serves the flow.
> Naming both hosts in the §2.4 `next` allowlist is the remaining half of O1.

### 2.9 Secrets

`client_secret` lives only in the licence server's environment — `OZ_*` at runtime
(Northflank), which the developer machine mirrors as `KASIRMU_*` user-scope variables. It is
never committed and never enters a desktop or tablet bundle. The desktop flow is
PKCE-protected and the client is public by design (§1.7).

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
| webhook/purchase account, `email_verified` false | Google, email matches | linked, `email_verified` flips true, both audited |
| no account | Google, basic scopes, `email_verified` true | account created, signed in |
| no account | Google, `email_verified` false | refused — never link an unproven address |
| reserved admin email | either method | refused **before** any link or create (§2.3 step 3) |
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

**Shipped 2026-09-19 (management endpoints):** `GET /api/v1/web/identities` lists the session
tenant's linked methods and `DELETE /api/v1/web/identities/{id}` unlinks one — the unlink this
paragraph promised. Both are scoped by the session rather than by anything in the request, so
one account cannot address another's identities, and a *foreign* id answers `404` rather than
`403`, because a distinguishable refusal would let a caller probe which ids exist. Six tests
cover the two refusals that matter plus the happy path. There is deliberately **no
last-credential guard**: the account email is the root credential, so unlinking the last
identity cannot lock anyone out and such a guard would protect no state.

**Shipped 2026-09-19 (account portal):** the dashboard now shows the linked methods and offers
**Unlink** per row (`AccountSignInMethods.tsx`), wired to those two endpoints from `AccountView`,
which owns the fetch and the call so the session lifecycle stays in one place — the same split
the devices section uses. The card ends with the sentence that makes the button safe to press:
*the email code always works, so unlinking cannot lock you out*. That is the §2.3 invariant
rendered where it is relied on, rather than left implicit in a server comment.

An unknown provider renders as its raw name instead of a blank row, so a future GitHub identity
degrades visibly rather than silently.
- **Loopback any-port behaviour for a Desktop-type client is assumed, not yet proven here.**
  It is how installed-app CLIs work and the doc describes a random available port, but it is
  the first thing to confirm in the sandbox (§8). If it proves false, the fix is
  configuration only — a Web-type client with one pinned, registered port — not a code
  change.
- **A wizard-only entry point has no in-app repair path.** See §9 O2.
- **The licence server makes one outbound call to `kasirmu-api`** to register the terminal
  (§2.5 step 6), adding a cross-service dependency and an admin key (`OZ_ADMIN_KEY`) to the
  licence server's environment. If that hop is unwanted, the fallback is to keep cloud sync on the
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
  **As shipped (2026-09-19), which differs from the sketch above:** the HTTP half lives in
  `kasirmu-core/src/desktop_link.rs`, not the bridge — the bridge is contractually free of an HTTP
  stack (its own `browser.rs` says why), so PKCE and the two calls sit beside the attestation client,
  and the bridge owns only the loopback listener. The command is `commands/desktop_link.rs` in BOTH
  shells, and the wrapper sits in `ui/src/api/license.ts`.
  platform helper that keeps the Google control off Android.

## 8. Verification

- Go: resolver matrix (§3) as a table test, including reserved-admin refusal, `409` on
  foreign `sub`, `email_verified=false` refusal, and equivalence of the two creation doors.
  **Shipped 2026-09-20:** `TestBothSignupDoorsProduceEquivalentTenantRows` drives both doors —
  request-otp creating a tenant, and the Google web flow creating one — and compares every field
  the schema carries, exempting only the row identity, the random credential material, and
  `email_verified`, which the doors reach at different moments (and which the test pins
  separately, so the exemption cannot quietly invert).
- Go: state single-use and expiry; purpose-bound link codes rejected by `/web/verify-otp`;
  link codes refused when replayed with a different `machine_id`.
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
