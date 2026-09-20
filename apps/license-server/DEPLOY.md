<!-- Audit stamp: 2026-09-09 · DSH · status: ACCURATE AFTER REPAIR (2 findings, 1 gate added) · Section 7 opens by claiming this section documents every variable in full, and on 09-09-26 that was false: five names the binary reads appeared in no document anywhere in the repo (LOGIN_LOCKOUT_MIN_GAP, LOGIN_LOCKOUT_MAX_COOLDOWN, LOGIN_LOCKOUT_DISABLED, OZ_ADMIN_EMAIL, OZ_ENTERPRISE_MRR_USD). Three are the login lockout, so the only control that slows credential stuffing had no operator-facing description at all; the fourth names a tenant the code deliberately refuses to let be renamed or deleted. Added section 7.7 with defaults, citing source lines. · TWO CODE FINDINGS RECORDED, NOT PATCHED: LOGIN_LOCKOUT_DISABLED is production-reachable and its off state is invisible in both logs and /api/health; OZ_ENTERPRISE_MRR_USD parses a USD price into a float64, against the AGENTS.md money rule. · NEW GATE .agents/skills/docs-auditor/scripts/check-env-docs.py: 27 names scanned, 0 undocumented, 9 self-test cases over synthetic strings only. · Two claims I nearly made and were wrong: four variables looked absent from the code because I scanned only apps/license-server while apps/unified/healthcheck.sh reads them; and OZ_SMTP_STARTTLS / OZ_SMTP_IMPLICIT_TLS appear once in this file precisely to tell the operator NOT to set them, so their absence from the code is the point. This skill own check-dead-refs.py is what caught me publishing a re-derive command for a script that did not exist yet. · SUPERSEDED, kept verbatim (rev 2026-07-22, re-audited 2026-08-31): 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings) · scripts/generate-license-keys.{ps1,sh} verified; Dockerfile uses golang:1.25-alpine -> alpine:3.22 (was 3.20, bumped for Trivy EOL); health.go (GET /api/health, returns status: ok) + healthcheck.go present; pb_schema.json present; go.mod is go 1.25.0; all build/deploy/env-var claims match the Go code · RE-AUDITED 2026-08-31 by docs-auditor: go.mod still 1.25.0, /api/health present, oz-license.key.pub committed; env-var section confirmed current (Midtrans/ADR #39, PADDLE_PRICE_TIERS six sandbox prices catalogued 08-31); corrected the body's alpine 3.20 -> 3.22 -->

# OZ-POS License Server — Northflank Deployment Guide

> **ADR:** [`docs/decisions/2026-07-10-license-server.md`](../../docs/decisions/2026-07-10-license-server.md)
> **Repository:** `apps/license-server/`
> **Target host:** Northflank (Hobby tier, ~$6–12/month)
> **Last updated:** 2026-07-11

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Generate RSA Key Pair](#2-generate-rsa-key-pair)
3. [Build the Docker Image](#3-build-the-docker-image)
4. [Push to a Container Registry](#4-push-to-a-container-registry)
5. [Create the Northflank Service](#5-create-the-northflank-service)
6. [Attach Persistent Volume](#6-attach-persistent-volume)
7. [Set Environment Variables](#7-set-environment-variables)
8. [Import the Collections Schema](#8-import-the-collections-schema)
9. [Create the Admin User](#9-create-the-admin-user)
10. [Configure Custom Domain](#10-configure-custom-domain)
11. [Test the Endpoints](#11-test-the-endpoints)
12. [Ongoing Maintenance](#12-ongoing-maintenance)

---

## 1. Prerequisites

Before starting, ensure you have:

- [ ] A **Northflank account** — [Sign up at northflank.com](https://northflank.com/)
- [ ] **Docker** installed locally — [Get Docker](https://docs.docker.com/get-docker/)
- [ ] A **GitHub account** (or any container registry) to store the Docker image
- [ ] A **domain** (optional, e.g., `license.ozpos.my.id`) for a custom URL
- [ ] **Go 1.25+** and **OpenSSL** installed locally (for key generation and testing)

---

## 2. Generate RSA Key Pair

The license server signs subscriptions with an RSA-2048 private key. The POS binary verifies them with the matching public key.

### 2.1 Generate the key pair

From the **repository root**, run the appropriate script for your OS:

```powershell
# Windows (PowerShell)
.\scripts\generate-license-keys.ps1
```

```bash
# Linux / macOS
bash scripts/generate-license-keys.sh
# Or: chmod +x scripts/generate-license-keys.sh && ./scripts/generate-license-keys.sh
```

This does:

1. Generates a `crates/kasirmu-core/oz-license-private.pem` file (RSA-2048, PKCS8 PEM).
2. Extracts the public key into `crates/kasirmu-core/oz-license.key.pub` (DER/SPKI format).
3. The private key file is **git-ignored** — never commit it.

### 2.2 Verify the keys exist

```
crates/kasirmu-core/oz-license.key.pub       ← committed, embedded in the binary
crates/kasirmu-core/oz-license-private.pem   ← git-ignored, loaded as env var on Northflank
```

### 2.3 Test locally (optional)

```bash
# Build the license server
cd apps/license-server
go build -o license-server .

# Run with the private key
$env:OZ_LICENSE_PRIVATE_KEY = (Get-Content -Raw ../../crates/kasirmu-core/oz-license-private.pem)
./license-server serve --http=0.0.0.0:8080
```

---

## 3. Build the Docker Image

The `Dockerfile` uses a **multi-stage build**: `golang:1.25-alpine` compiles the binary, then copies it into `alpine:3.22` for a ~25 MB final image.

### 3.1 Build locally

```bash
docker build -t oz-pos/license-server -f apps/license-server/Dockerfile apps/license-server
```

### 3.2 Test the image locally

```bash
docker run --rm -p 8080:8080 \
  -v license_pb_data:/pb/pb_data \
  -e OZ_LICENSE_PRIVATE_KEY="$(Get-Content -Raw crates/kasirmu-core/oz-license-private.pem)" \
  oz-pos/license-server
```

You should see:

```
RSA private key loaded successfully
[0.00ms] ... Server started at http://0.0.0.0:8080
```

Verify the health check:

```bash
curl http://localhost:8080/api/health
# → {"status":"ok","db_connected":true,"uptime_secs":42,"go_version":"go1.25","go_os":"linux","go_arch":"amd64"}
```

---

## 4. Push to a Container Registry

Northflank pulls from any public or private container registry. GitHub Container Registry (GHCR) is free with a GitHub account.

### 4.1 Tag and push to GHCR

```bash
# Tag with your GitHub username
docker tag oz-pos/license-server ghcr.io/YOUR_USERNAME/oz-pos-license-server:latest

# Login to GHCR
echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_USERNAME --password-stdin

# Push
docker push ghcr.io/YOUR_USERNAME/oz-pos-license-server:latest
```

> **Alternative registries:** Docker Hub, AWS ECR, Google Artifact Registry — all work. Northflank supports any registry with an authenticated URL.

---

## 5. Create the Northflank Service

### 5.1 Create a new project

1. Go to [Northflank Dashboard](https://app.northflank.com/).
2. Click **New Project** → name it `oz-pos-license`.
3. Select a region (pick one close to your users).

### 5.2 Create the Combined Service

1. In your project, click **Services** → **Create New Service**.
2. Choose **Combined Service**.
3. Under **Image Source**:
   - Select **External Registry**.
   - Enter the image URL: `ghcr.io/YOUR_USERNAME/oz-pos-license-server:latest`.
   - If using a private registry, add the credentials under **Registry Credentials**.

### 5.3 Configure the service

| Setting | Value |
|---|---|
| **Service Name** | `license-server` |
| **Port** | `8080` (HTTP) |
| **Public Access** | ✅ Enabled |
| **Compute Plan** | `nf-compute-10` (0.1 vCPU, 256 MB) — sufficient for the license server |

> 💡 **Pricing:** `nf-compute-10` is ~$2.70/month. The license server handles very low traffic (activation is a one-time event per customer).

### 5.4 Deploy

Click **Create & Deploy**. The service will start but **will crash** until you complete Step 6 (volume) and Step 7 (env var). That's expected.

---

## 6. Attach Persistent Volume

PocketBase stores its SQLite database and admin credentials in `/pb/pb_data`. This must survive container restarts.

1. **Stop the service** if it's running (it's crashing anyway, but ensure it's stopped).
2. Go to your service → **Volumes** tab.
3. Click **Create New Volume**.
   - **Name:** `pb-data`
   - **Type:** NVMe (faster, for a small SQLite file)
   - **Size:** 1 GB (more than enough for license management data)
   - **Mount Path:** `/pb/pb_data`
4. Click **Save**.

> 💡 **Pricing:** NVMe storage is $0.15/GB/month. A 1 GB volume costs ~$0.15/month.

---

## 7. Set Environment Variables

> **Going live?** The ordered, tick-box checklist of what is still missing (Brevo SMTP
> login id, verified sender, Paddle webhook secret) and the apply order is in
> [`go-live-checklist.md`](../../docs/operations/go-live-checklist.md). This section documents every variable
> in full.

The license server requires the RSA private key as an environment variable. **Never hardcode this in the Dockerfile or commit it.**

### 7.1 Create a Secret Group

1. Go to your project → **Secrets** tab.
2. Click **Create Secret Group** → name it `license-server-secrets`.
3. Add a secret:
   - **Key:** `OZ_LICENSE_PRIVATE_KEY`
   - **Value:** Paste the **entire** contents of `crates/kasirmu-core/oz-license-private.pem` (including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`).

   In PowerShell:

   ```powershell
   Get-Content -Raw crates/kasirmu-core/oz-license-private.pem | Set-Clipboard
   ```

4. (Optional) Add the support-contact webhook:
   - **Key:** `OZ_DISCORD_WEBHOOK`
   - **Value:** The **Discord channel webhook URL** (Discord → channel → Settings → Integrations → Webhooks → New Webhook). This is what `/api/v1/web/contact` forwards website support-form messages to. **Never expose this URL to the browser** — the website only talks to the license server, which keeps the secret server-side. If it is unset, `/api/v1/web/contact` returns `503 not configured` and the website's contact form falls back to a mailto link.
5. Add the **OTP email sender** (required for the website dashboard login — without it `POST /api/v1/web/request-otp` returns `503 email delivery is not configured` and the login page shows its "not configured" state):
   - **Key:** `OZ_SMTP_HOST` — your relay's hostname
   - **Key:** `OZ_SMTP_PORT` — default `587` (TLS/STARTTLS) if unset
   - **Key:** `OZ_SMTP_USER` / `OZ_SMTP_PASSWORD` — credentials for the relay (omit for unauthenticated relays)
   - **Key:** `OZ_SMTP_FROM` — sender address. **Must be set explicitly and verified with your relay** — the code defaults to `no-reply@ozpos.my.id`, which relays will reject or flag until that domain is yours. **Boot gate:** when `OZ_SMTP_HOST` is set, the server runs a sender-identity probe at startup (auth + `MAIL FROM` only — nothing is ever queued) and **fails fast** if `OZ_SMTP_FROM` is unset, is still the unowned default, or the relay permanently rejects it (e.g. Brevo `550 Sender address is not verified`). A transient relay outage only logs a warning, so a brief hiccup can't block a deploy. Unset `OZ_SMTP_HOST` skips the gate entirely (the endpoint answers 503 by design then).

   **No custom domain yet?** Northflank does **not** provide SMTP/email to apps — you need a third-party transactional relay, and `code.run` / `workers.dev` are not domains you can add DNS records to (no SPF/DKIM there). Until you own a domain, use a provider that works with a **verified sender email** instead:

   - **Brevo (current choice)** — SMTP login/username is a dedicated **SMTP login email** (Brevo → Settings → SMTP & API → copy the **Login** value; it is NOT your account email), password is the **SMTP key** (`xsmtpsib-…`). The `OZ_SMTP_FROM` address must be a **verified sender** in Brevo (Sender Identity → verify the email or domain) or sends fail. All three Brevo options work — **port 465 uses implicit TLS**, 587/2525 use STARTTLS (`smtp_mail.go` picks the transport by port). Example:
     ```
     OZ_SMTP_HOST=smtp-relay.brevo.com
     OZ_SMTP_PORT=587
     OZ_SMTP_USER=<brevo-smtp-login-email@smtp-brevo.com>
     OZ_SMTP_PASSWORD=xsmtpsib-…
     OZ_SMTP_FROM=<your-verified-sender@example.com>
     ```
   - **SendGrid (free tier)** — Settings → Sender Authentication → **Single Sender Verification** → verify the From address (e.g. your own email). SMTP: `smtp.sendgrid.net:587`, user `apikey`, password = your SendGrid API key, From = the verified sender.
   - **Amazon SES** — verify the sender **email address** (no domain required). Sandbox initially only delivers to verified recipients; request production access when live.

   > **Deliverability honesty:** without your own domain + SPF/DKIM/DMARC, inbox placement is best-effort — codes may land in spam. Once you own a domain: set `OZ_SMTP_FROM=noreply@<domain>`, add the provider's SPF include + DKIM records (and a DMARC policy), then the verified-sender fallback is no longer needed. This is the actual fix for "signup codes never land in spam".
6. (Optional) Web API CORS allowlist override:
   - **Key:** `OZ_WEB_ALLOWED_ORIGINS` — comma-separated origins allowed to call the web endpoints. **Defaults are already correct** for the current setup (`https://kasir.mu`, `https://dashboard.kasir.mu`, `https://admin.kasir.mu`, `http://localhost:4321`); only set this if you deploy the website to a different origin. **If you do set it, read §7.2 first** — a stale value silently breaks the whole login surface.
7. (Optional) Session lifetime override:
   - **Key:** `OZ_WEB_SESSION_TTL` — Go duration, default `24h` (e.g. `72h` to extend dashboard sessions).
7b. **Google sign-in (ADR #54).** Both keys enable it. With `OZ_GOOGLE_CLIENT_ID` unset
    both endpoints answer `503`, so the deployment is safe — but the sign-in button on the
    login page is gated on the **API URL**, not on this key, so it still renders and the
    click lands on that JSON `503`. Set the keys before announcing the feature; do not add a
    second switch to hide the button, because two switches that must agree is how they drift.
    - **Register BOTH callback URIs first**, in Google Cloud → APIs & Services →
      Credentials → the Web-application OAuth client. Redirect URIs match exactly, so a
      host that is live but unregistered fails every sign-in with `redirect_uri_mismatch`:
      - `https://license.kasir.mu/api/v1/web/oauth/google/callback`
      - `https://license.ozpos.my.id/api/v1/web/oauth/google/callback`
    - **Key:** `OZ_GOOGLE_CLIENT_ID` — the Web-application client id.
    - **Key:** `OZ_GOOGLE_CLIENT_SECRET` — its secret. Server-side only: the desktop flow
      is PKCE and never carries one.
    - **Key:** `OZ_GOOGLE_REDIRECT_URI` (optional) — pin the callback URL instead of
      deriving it from the request Host (set it when a proxy rewrites Host).
    - **Key:** `OZ_WEB_SITE_URL` (optional, default `https://kasir.mu`) — the host the flow
      returns to. It is the only place the return host is decided, which is why the
      post-login *path* is the only attacker-influenced part of the redirect.
    - **Scopes:** `openid email profile` only. No Google API is called and no offline access
      is requested, so no refresh token exists and no sensitive-scope review is needed; the
      consent screen shows the bare project id until brand verification passes.
    - **The admin login page deliberately has no Google button:** the deployment admin
      address is refused by the resolver (ADR #54 §2.3), so offering it would only yield a 403.
7c. **Sync credentials at link time (ADR #54 §2.5 step 6) — set this before onboarding devices.**
    Linking a device also registers it as a sync terminal, so the app leaves the wizard ready
    to sync.
    - **Key:** `OZ_SYNC_API_URL` — the sync service's base URL (the unified deployment serves
      both from one container). **No default**: addresses are declared, never guessed.
    - **Key:** `OZ_ADMIN_KEY` — already required above. The sync service reads the *same*
      variable, so one deployment needs one value; two different keys simply yield
      `terminal.issued: false`.
    - **Without it:** the link still succeeds and answers `terminal.issued: false` with a
      reason, which the server also logs. The account is linked — the device just holds no sync
      credential, so its sync will not work until this is set and the device links again.
8. Add the **billing webhook** secrets (required for the checkout → provisioning flow — Paddle for global, Midtrans for Indonesia, ADR #39):
   - **Key:** `PADDLE_WEBHOOK_SECRET` — the endpoint secret key from Paddle → Developer tools → Notifications → Edit destination. Without it the webhook answers `503 not configured`. **Boot gate:** the server fails fast at startup if this (or `PADDLE_PRICE_TIERS`) is missing or malformed, so a misconfigured deploy can never silently answer 503/500 on every event.
   - **Key:** `PADDLE_PRICE_TIERS` — comma-separated `price_id:tier_key:period[:bundle_id]` pairs mapping every Paddle price to a tier, e.g. `pri_01h7abc123:pro,pri_01h7def456:premium` (the `:period` segment is "month" or "year" — the webhook cross-checks it against billing_cycle.interval; the optional `:bundle_id` segment marks a vertical-bundle price, C3.2 — see below). **The six sandbox prices are catalogued (2026-08-31)** — the website carries the real ids for Plus/Pro/Premium × monthly/yearly; only the bundle and the Pro A/B variant still use `pri_placeholder_*` ids (degrading those checkouts to the mailto fallback). Current sandbox map (see also `docs/operations/go-live-checklist.md`):

     ```
     PADDLE_PRICE_TIERS=pro_01m1amcb41qkbr7zzd1kxa3qnd:plus:month,pro_01m1amdj2swb3q21r2mwcy3krh:plus:year,pro_01m1amdwp700jp6183k9zjsgaz:pro:month,pro_01m1ame8ckw8vzjnf8y4q15mww:pro:year,pro_01m1amema8yj6w5mfm8wx8jwhm:premium:month,pro_01m1amf0vpbyfndg5rkvxvyqj4:premium:year
     ```

     Do NOT ship the two legacy sandbox prices (`pri_01m05gdnqp30xze6db73qcracp` = old $19/mo Pro, `pri_01m05gdpk4hmnm0k8e6vxm8cec` = old $49/mo Premium) — they charge the superseded amounts. Unmapped prices make provisioning fail with 500 (Paddle retries) until this is fixed. For the Restaurant Starter bundle (C3.2), add a Plus+ bundle price: `pri_<plus_bundle_yearly>:plus:year:restaurant_starter` — the webhook cross-checks `custom_data.bundle` against the price's bundle segment and mints the kds-widened quota block; adding the entry makes the bundle purchasable.
   - **Key:** `PADDLE_API_KEY` (optional) — server-side Paddle API key. Only needed when the customer email isn't passed in `custom_data` at checkout; the webhook falls back to fetching it via `GET /customers/{id}`.
   - **Key:** `PADDLE_API_URL` (optional) — defaults to `https://api.paddle.com`.
   - **Key:** `MIDTRANS_SERVER_KEY` — the **server key** from Midtrans → Settings → Access Keys (production keys start `Mid-server-…`, sandbox `SB-Mid-server-…`). The key must belong to the **same account that owns the webhook URL** — sandbox notifications are signed with the sandbox key and production with the production key, so a mismatched key answers **401** on every notification (never 503). When the key is **unset**, the webhook answers `503 not configured` and Midtrans retries forever. **Boot gate:** the server fails fast at startup if this (or `MIDTRANS_PRICE_TIERS`) is missing or malformed.
   - **Key:** `MIDTRANS_PRICE_TIERS` — comma-separated `gross_amount:tier_key[:period][:bundle_id]` pairs. **The six fixed IDR prices (subscription-tiers.md §2) are the canonical values — the checkout's Snap endpoint and the webhook's amount cross-check both read this exact map, so every gross_amount a buyer can be charged must be mapped:**

     ```
     MIDTRANS_PRICE_TIERS=49000:plus:month,500000:plus:year,99000:pro:month,1000000:pro:year,199000:premium:month,2000000:premium:year
     ```

     The webhook normalizes Midtrans's `gross_amount` formatting (`"49000.00"` → `49000`) before lookup; an unmapped amount answers 500 so Midtrans retries until the operator fixes the map. **Restaurant Starter bundle (C3.2, optional — add ONLY when the bundle goes live, and the amounts must match the pricing-page display, currently placeholder Rp 74.000/mo + Rp 750.000/yr):**

     ```
     MIDTRANS_PRICE_TIERS=49000:plus:month,500000:plus:year,74000:plus:month:restaurant_starter,750000:plus:year:restaurant_starter,99000:pro:month,1000000:pro:year,199000:premium:month,2000000:premium:year
     ```

     An unknown bundle id in the map is rejected at boot (loud failure, never a silent no-op). Both vars are still read per-request, so a redeploy with fixed env recovers without a code change.
   - **Key:** `MIDTRANS_SNAP_URL` (optional) — Snap API base. Defaults to `https://app.midtrans.com` (production). **Sandbox testing:** set `https://app.sandbox.midtrans.com` — otherwise sandbox keys hit the production Snap API and fail token creation. Must match the `MIDTRANS_SERVER_KEY` environment (sandbox key + sandbox URL, production key + production URL).
9. Click **Save**.

### 7.2 CORS for the website

The website is served from `https://kasir.mu` — with the account portal at `https://kasir.mu/en/account/` and the admin panel at `https://admin.kasir.mu` — and calls the web endpoints (`/api/v1/web/contact`, `request-otp`, `verify-otp`, `/me`, `logout`) cross-origin.

- **Web OTP endpoints** enforce an **in-handler CORS allowlist** read from `OZ_WEB_ALLOWED_ORIGINS` (Step 6 above); `OZ_CORS_ORIGINS` is merged in, so one value covers the Go and Rust services. Its default already includes `kasir.mu`, `dashboard.kasir.mu`, `admin.kasir.mu` and `http://localhost:4321`, so **no configuration is needed** — just don't set the variable to an empty string, or the allowlist falls back to the default.
- **A stale override is worse than no override.** Every origin the allowlist omits gets `403 {"error":"origin not allowed"}` on login, signup, OTP, password reset and the exchange handoff. A rebrand that leaves these vars naming the **old** domain breaks the entire web login surface while every page still renders — the outage is silent, because the pages themselves are static. Never leave a *blank* value either: on the Rust side a blank `OZ_CORS_ORIGINS` means *deny every cross-origin request* (fail closed), not "use the defaults".
- **`OZ_CORS_ORIGINS` overrides rather than extends.** If you set it, include the Tauri webview origins `tauri://localhost` and `http://tauri.localhost` (see `DEFAULT_CORS_ORIGINS` in `crates/kasirmu-api/src/lib.rs`), or the desktop/mobile apps lose their allowance.
- **Diagnosing it:** probe one endpoint while varying only the `Origin` header — a non-browser caller (no `Origin`) is always allowed, so a bare `curl` proves nothing. Method: `ozpos-web-origin-allowlist-diagnosis`.
- **`/api/v1/web/contact`** relies on PocketBase's global CORS middleware, which allows all origins by default (stateless, no cookies). No configuration needed for the contact form to work. For hardening, restrict origins by adding the `--origins` flag to the `serve` command in the Dockerfile `CMD` (e.g. `--origins=https://kasir.mu,http://localhost:4321`).

### 7.3 Attach to the service

1. Go to your service → **Environment** tab.
2. Under **Secret Groups**, click **Attach**.
3. Select `license-server-secrets`.
4. Click **Save**.

### 7.4 Redeploy

Click **Redeploy** on the service. After deployment, the service should start without errors.

### 7.5 Configure the Paddle webhook

In the Paddle dashboard (**Developer tools → Notifications**):

1. Create a notification destination of type **URL (webhook)** pointing at `https://license.ozpos.my.id/api/v1/paddle/webhook`.
2. Subscribe to the **Subscription** events: `subscription.created`, `subscription.activated`, `subscription.trialing`, `subscription.updated`, `subscription.canceled`, `subscription.paused`, `subscription.resumed`, `subscription.past_due` — plus `transaction.completed` / `transaction.payment_failed` (currently acknowledged and logged; one-time purchases only provision once a lifetime tier ships).
3. Copy the **endpoint secret key** into the `PADDLE_WEBHOOK_SECRET` secret (Step 8 in §7.1).
4. **Signature verification:** every request carries a `Paddle-Signature` header (`ts=<unix>;h1=<hex>`). The server verifies HMAC-SHA256 over `ts:rawBody` with the endpoint secret and rejects timestamps older than 5 minutes. Nothing else is trusted.
5. **Idempotency:** Paddle retries non-2xx responses; the server dedups by `event_id` (24h in-memory window) and upserts on `paddle_sub_id`, so replays are no-ops.
6. **Customer email:** the website checkout passes `custom_data.email` (the email the customer types on the pricing card), which the webhook reads to upsert the tenant — **no `PADDLE_API_KEY` needed**. `PADDLE_API_KEY` remains an optional fallback for events whose `custom_data` lacks the email.

### 7.6 Configure the Midtrans webhook

In the Midtrans dashboard (**Settings → Configuration → Webhook Notification URL**):

1. Set the payment notification URL to `https://license.ozpos.my.id/api/v1/midtrans/webhook` (or your service's public URL — the same host as the Paddle webhook).
2. Enable the **Payment** notification type (`payment.status`/transaction notifications). Midtrans subscription (`subscription.status`) notifications are acknowledged but provisioning is keyed on settled transaction charges — see `midtrans_webhook.go`.
3. **Signature verification:** every notification carries `signature_key`; the server recomputes `SHA512(order_id + status_code + gross_amount + serverkey)` with the `MIDTRANS_SERVER_KEY` secret and compares constant-time. Nothing else is trusted — an unsigned or mismatched request answers **401** and provisions nothing.
4. **Idempotency:** Midtrans retries non-2xx responses; the server dedups by `transaction_id` (in-memory) and upserts on `midtrans_sub_id` / `midtrans_order_id`, so replays are no-ops.
5. **Sandbox vs production:** the sandbox dashboard sends test notifications signed with the sandbox key — point the sandbox webhook at the same URL and the server answers 401 unless `MIDTRANS_SERVER_KEY` is the matching sandbox key. Test end-to-end in sandbox first (§11.7), then flip `MIDTRANS_SERVER_KEY`/`MIDTRANS_SNAP_URL` to production values.

---

### 7.7 Optional tuning variables (none are required to boot)

§7 opens by claiming this section documents every variable in full. Until 09-09-26 it did
not: five names the binary reads appeared in no document in the repo — not here, not in
`go-live-checklist.md`, not in `.env.example`. Three of them govern the login lockout, so
the one control that slows credential stuffing had no operator-facing description at all.

Read from `apps/license-server/login_lockout.go`:

| Variable | Default | Effect |
|---|---|---|
| `LOGIN_LOCKOUT_MIN_GAP` | `5s` | Minimum gap between login attempts for one email. Go duration string; unparseable values log and fall back to the default (`:50`). |
| `LOGIN_LOCKOUT_MAX_COOLDOWN` | `15m` | Cap on the escalating lockout (`:66`). |
| `LOGIN_LOCKOUT_DISABLED` | unset (= limiter **on**) | Exact string `1` turns the limiter off entirely (`:151`). |

> ⚠️ **`LOGIN_LOCKOUT_DISABLED` is a production-reachable kill switch.** The function comment
> says it exists so the window-limiter tests can run in isolation and that the production
> default is enabled — but nothing checks the build or environment: setting it to `1` in a
> Northflank secret group disables brute-force protection on a live server, silently, and no
> log line or `/api/health` field reports that it is off. That asymmetry (a security control
> whose disabled state is invisible) is recorded here rather than patched, because the fix is
> a code decision: gate it on a non-release build, or surface it in `/api/health` next to
> `smtp`/`paddle`, which already report gate status.

Read from the admin surface:

- **`OZ_ADMIN_EMAIL`** — the email of the admin tenant, falling back to
  `defaultAdminEmail` when unset. Authentication reads it in four places
  (`addon_admin.go:278`, `admin_dashboard.go:87`, `admin_tenant_lifecycle.go`,
  `password_rotation.go:176`) and each anchors on **one** address: the env value, else the
  compiled default. The tenant-lifecycle guard is deliberately **wider**: `isAdminTenantRecord`
  tests membership in `reservedAdminEmails` — env UNION compiled default — so the guard is a
  superset of the auth anchor and is never unknown. Consequences worth knowing before you
  touch a deployment: an unset variable does **not** disable rename or delete of ordinary
  tenants (it did for exactly one commit, and that was an outage, not a protection — auth
  still anchors on the default, so the identity was never unknown); what unset means is that
  the admin identity is an address living in the binary.
  **This is the one environment value that must never change after first boot**: the admin
  auth mapping resolves sessions to that tenant, so changing it orphans every existing admin
  session, and deleting the tenant locks all of them out — `isAdminTenantRecord` exists
  precisely to refuse both. Renaming another tenant **into** a reserved address is refused
  too (`email is reserved for the deployment admin identity`): holding that address *is*
  holding the admin identity, and the contact-edit path is not gated by the signup
  reservation. Nothing in the deploy flow says any of this, which is why it is here.

- **`OZ_ENTERPRISE_MRR_USD`** — read once in `init()` (`admin_stats.go:702`) and, when it
  parses and is greater than zero, replaces `TierPriceUSD["enterprise"]`, so enterprise
  MRR thresholds can be re-priced without a rebuild.

> ⚠️ **CODE FINDING, recorded not fixed**: that override parses the value into a `float64`
> and writes it into a USD price map. AGENTS.md's currency rule is that monetary values are
> `Money` (`i64` minor units) and never `f32`/`f64`. It is a display-side threshold in the
> admin dashboard rather than a ledger amount, so no money is mis-added today — but the rule
> is not scoped to ledgers, and this is the kind of float that turns into an invoice.

> **Re-deriving this list** (why: an env var missing from the docs is invisible to every
> existing gate, and the drift checker only compares docs to *gates*):
>
> ```bash
> python3 .agents/skills/docs-auditor/scripts/check-env-docs.py          # 27 names, 0 undocumented
> python3 .agents/skills/docs-auditor/scripts/check-env-docs.py --self-test   # 9 cases, touches no files
> ```
>
> It exists now. `.agents/skills/docs-auditor/scripts/check-env-docs.py` reports every
> variable the code reads that appears in none of `DEPLOY.md`,
> `go-live-checklist.md`, `.env.example` or `verification-*.md`, and exits 1 when it finds
> one. Baseline 09-09-26: **27 names scanned, 0 undocumented** — which was 5 undocumented
> before section 7.7 was written, so the count is the proof the repair landed rather than a
> claim about it.
>
> Scope is **both apps on purpose**. The healthcheck variables live in `apps/unified/`, not
> `apps/license-server/`, so scanning only the service directory reported four *false*
> absences (`OZ_HEALTH_SMTP_MAX_FAILS`, `OZ_HEALTH_PADDLE_MAX_FAILS` and the two SMTP TLS
> names) — and two of those four were not even env-adjacent: `OZ_SMTP_STARTTLS` and
> `OZ_SMTP_IMPLICIT_TLS` appear once, in *this* file telling you **not** to set them.
> Both misreads are encoded in the script: the scan covers `apps/unified/healthcheck.sh`,
> and a line may carry `env-doc: ok: <reason>` to be exempted deliberately rather than by
> silence.

#### 7.7.1 Precondition: set `OZ_ADMIN_EMAIL` before the admin-gate repair ships

Web admin identity is an email comparison on this value (`admin_dashboard.go:87-91`, duplicated at
`addon_admin.go:278-282`, `admin_tenant_lifecycle.go`, `password_rotation.go:176`); unset, the
target is the built-in `defaultAdminEmail` (`password_rotation.go:42`) and no compose file or workflow
sets it. So set it — and be clear about what setting it does and does not do, because the
guard semantics changed twice in one day:

- **An unset variable does not brick the admin surface.** It used to: while the lifecycle guard
  failed closed on an unset `OZ_ADMIN_EMAIL`, every email rename answered 400 and every offboarding
  delete answered 403 on rows that are provably not the admin tenant, and the SPA renders a 403 as a
  global Access denied screen. The guard now tests membership in the reserved set (env UNION compiled
  default), so ordinary tenants stay editable and exactly one row — the reserved one — is not.
- **What unset actually costs you is hygiene, and `/api/health` says so.** The `admin` block reports
  `source` (`env` / `fallback`), `matching_rows` and `verified`, never the address itself.
  `verified: true` means deploy hygiene only — you named the address and exactly one row carries it.
  `source: "env"` with `matching_rows: 0` is the bricked shape: auth anchors on an address no row
  holds, so there is no web admin. `source: "fallback"` means you are running on an address that
  lives in the binary.
- **The address is write-once in both directions.** Changing it orphans existing admin sessions;
  renaming another tenant *into* it is refused, because holding that address is holding the identity.

Steps, in order, before deploying (unchanged — this is still how you prove the deployment is healthy):

```bash
B=https://license.ozpos.my.id; E='<admin-email>'   # must equal OZ_ADMIN_EMAIL in Northflank
# 1. the secret is set AND its email has a tenants row with status=active — admin self-signup is refused, so the row must already exist (warnAdminTenantState warns on a boot that finds none):
sqlite3 /data/pb_data/data.db "SELECT id,email,status,email_verified FROM tenants WHERE email='$E'"
# 2. prove the owner reads that mailbox — email_verified is false by migration default (main.go:467-484) and false for webhook-created rows (paddle_webhook.go:1188), and admin login never reads it:
curl -s -X POST "$B/api/v1/web/request-otp" -H 'Content-Type: application/json' -d "{\"email\":\"$E\"}"
curl -s -X POST "$B/api/v1/web/verify-otp"  -H 'Content-Type: application/json' -d "{\"email\":\"$E\",\"code\":\"<code>\"}"
# 3. that session must be admin (200, not 401/403) — also the proof the env value matches the row.
# 4. OZ_ADMIN_KEY must be present (with OZ_PRODUCTION=1 the fail-fast boot proves it), and OZ_ADMIN_EMAIL is write-once: it must never change after first boot.
curl -s -o /dev/null -w '%{http_code}\n' "$B/api/v1/admin/enterprise-codes" -H "Authorization: Bearer <token>"
```

**Break-glass, and its limit.** `OZ_ADMIN_KEY` authenticates the API with no session (`admin_dashboard.go:65`, `addon_admin.go:263`) but the admin SPA cannot use it — `website/public/admin/login.js` is session-only, so key-only recovery brings back the API, not the dashboard. Sessions are in-memory (`web_otp.go:13-19`), so a restart drops them: a session-path lockout self-heals on restart, and equally a revoked admin session cannot be killed without one. A restart is not a way to remove an attacker who has the mailbox — they just request another OTP.

## 8. Import the Collections Schema

PocketBase collections (`license_keys`, `tenants`, `subscriptions`, `tenant_machines`) are defined in `pb_schema.json`.

> ✅ **No action needed on a fresh deployment.** The server auto-imports the embedded `pb_schema.json` on first boot whenever any required collection is missing (see `ensureCollections` in `main.go`) — verified in the container log: `missing required collection "license_keys" — importing pb_schema.json`. The manual import below is only a fallback if you ever need to inspect or re-import by hand.

### 8.1 Via the Admin UI (Optional verification)

1. Navigate to your service's public URL: `https://<your-service>.code.run/_/`
2. Log in with the **admin user** created in Step 9 (you need to create it first).
3. Go to **Settings** → **Import Collections**.
4. Upload `apps/license-server/pb_schema.json`.
5. Click **Import**. All 4 collections should appear.

### 8.2 Via API (Alternative)

If you prefer automation, use PocketBase's collections API after creating the admin user:

```bash
# You'll need the admin token from Step 9
curl -X PUT https://<your-service>.code.run/api/collections/import \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d @apps/license-server/pb_schema.json
```

---

## 9. Create the Admin User

The PocketBase admin UI at `/_/` requires at least one superuser account. Create it via SSH.

### 9.1 Open the Northflank Shell

1. Go to your service → **Overview**.
2. Click **Shell** (opens an SSH session to the running container).

### 9.2 Create the superuser

```bash
/pb/pocketbase superuser upsert admin@ozpos.my.id YOUR_STRONG_PASSWORD
```

> ⚠️ **Use a strong, unique password.** This account has full admin access to all license key data.

### 9.3 Verify

1. Navigate to `https://<your-service>.code.run/_/`.
2. Log in with `admin@ozpos.my.id` and your password.
3. You should see the PocketBase admin dashboard.

---

## 10. Configure Custom Domain

Northflank provides a free `*.code.run` subdomain with auto-provisioned TLS. For production, configure a custom domain.

### 10.1 Add the domain

1. Go to your service → **Networking**.
2. Under **Custom Domains**, click **Add**.
3. Enter your domain: `license.ozpos.my.id`.
4. Northflank provides the DNS target (a `code.run` subdomain).

### 10.2 Configure DNS

In your DNS provider (Cloudflare, Route53, etc.), add a **CNAME record**:

| Type | Name | Value | TTL |
|---|---|---|---|
| CNAME | `license` | `<target-from-northflank>.code.run` | Auto/300s |

Northflank automatically provisions a Let's Encrypt TLS certificate within a few minutes.

---

## 11. Test the Endpoints

### 11.1 Generate a test license key

1. Open the admin UI (`/_/`).
2. Go to the **license_keys** collection.
3. Click **New Record** and fill in:
   - `key`: `OZ-PRO-TEST-ABCD-EFGH-IJKL`
   - `tier_key`: `pro`
   - `max_stores`: `2`
   - `max_pos_instances`: `3`
   - `allowed_types`: `["restaurant-pos", "store-pos", "inventory", "admin"]`
   - `status`: `unused`
   - `expires_at`: A date **1 year from now**

### 11.2 Test the activation endpoint

```bash
curl -X POST https://license.ozpos.my.id/api/v1/license/activate \
  -H "Content-Type: application/json" \
  -d '{
    "key": "OZ-PRO-TEST-ABCD-EFGH-IJKL",
    "tenant_id": "test-tenant-001",
    "machine_id": "machine-001",
    "business_name": "Test Cafe",
    "contact_name": "John Doe",
    "email": "john@testcafe.com"
  }'
```

**Expected response (200):**

```json
{
  "signed_payload": "{\"tenant_id\":\"test-tenant-001\",\"tier_key\":\"pro\",...}",
  "signature": "base64-encoded-rsa-signature...",
  "api_key": "oz_abc123..."
}
```

### 11.3 Test the status endpoint

`/status` is a **POST** endpoint authenticated with `Authorization: Bearer <api_key>` (the credential never appears in URLs, so it can't leak to access logs or Referer headers). Use the `api_key` returned by the activation call in §11.2:

```bash
curl -X POST https://license.ozpos.my.id/api/v1/license/status \
  -H "Authorization: Bearer <api_key_from_activation>" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id": "test-tenant-001"}'
```

**Expected response (200):**

```json
{
  "tenant_id": "test-tenant-001",
  "tier_key": "pro",
  "status": "active",
  "max_locations": 2,
  "max_stores": 2,
  "max_pos_instances": 3,
  "expires_at": "...",
  "grace_until": "..."
}
```

`max_locations` is the primary quota name (1g Store → Location wire
rename). The legacy `max_stores` key rides along with the same value
until the whole client fleet has rotated; storage (the `subscriptions`
record) keeps the historical `max_stores` field name.

### 11.4 Test rate limiting

Send 6 activation requests in quick succession. The 6th should return **429 Too Many Requests**.

### 11.5 Test key brute-force protection

Send 3 invalid key attempts. The 4th should return **429 Too Many Requests** with a "too many attempts for this key" message.

### 11.6 Test the Paddle webhook

Send a **signed** `subscription.created` event (compute `Paddle-Signature: ts=<now>;h1=<hex HMAC-SHA256 of "ts:body" with the endpoint secret>`):

```bash
curl -X POST https://license.ozpos.my.id/api/v1/paddle/webhook \
  -H "Paddle-Signature: ts=$(date +%s);h1=..." \
  -H "Content-Type: application/json" \
  -d '{"event_id":"evt_test_1","event_type":"subscription.created","data":{"id":"sub_test_1","status":"active","customer_id":"cus_test_1","custom_data":{"email":"buyer@test.com"},"items":[{"price":{"id":"<your_price_id>","product_id":"pro_1"},"quantity":1}],"current_billing_period":{"starts_at":"2026-08-16T00:00:00Z","ends_at":"2027-08-16T00:00:00Z"}}}'
```

The response must be **200** and a tenant + `OZ-PRO-...` license key + subscription must appear in the admin UI. An unsigned or tampered request must return **401** and create nothing.

### 11.7 End-to-end QRIS purchase smoke test (C3.1 billing switch)

Run this in **sandbox first** (ADR #39 verification). Tick every box before considering the switch live.

**Pre-flight (sandbox):**

- [ ] `MIDTRANS_SERVER_KEY` = `SB-Mid-server-…` from the sandbox dashboard (Settings → Access Keys) and `MIDTRANS_SNAP_URL=https://app.sandbox.midtrans.com` in the secret group (§7.1 step 8).
- [ ] `MIDTRANS_PRICE_TIERS` = the six IDR prices exactly as written in §7.1 step 8 (`49000:plus:month,500000:plus:year,99000:pro:month,1000000:pro:year,199000:premium:month,2000000:premium:year`).
- [ ] Redeploy and confirm the boot log line: `Midtrans webhook config verified: 6 amount→tier mapping(s)`. The server fails fast (no boot) if the map is malformed or the key is missing.
- [ ] Sandbox webhook URL set in the Midtrans dashboard (§7.6).
- [ ] Website Worker: `LICENSE_API_URL` [vars] binding points at the license server (`window.__OZ_CONFIG__.licenseApiUrl` is what the id-locale `CheckoutButton` calls for the snap token).

**Purchase walk (id-locale pricing page → Snap → webhook → POS):**

1. [ ] Open `https://<site>/id/pricing`, keep the **yearly** default, click **Choose Plus**.
2. [ ] No session → redirected to `/id/login` (register-first — the webhook needs a tenant email). Verify a throwaway email + OTP; then click **Choose Plus** again.
3. [ ] In DevTools → Network, the button POSTs `…/api/v1/midtrans/snap` with `{tier_key:"plus", period:"yearly"}` and answers `{token, redirect_url, order_id, amount:"500000"}` — **the amount must equal the price map**. Any other amount (or a 400 `not mapped`) means the map is wrong — stop. (Prefer shell? The same calls, with the exact expected JSON, are in §11.8.)
4. [ ] The Snap overlay opens (QRIS / VA / e-wallet / card). Pay with the sandbox QRIS — scan the QRIS image with the Midtrans sandbox mobile app, or use the sandbox dashboard's simulate-payment flow; the transaction settles within seconds.
5. [ ] `snap.pay`'s `onSuccess` fires; the webhook answers **200**. In the admin UI (`/_/`): a **tenant** was upserted by the checkout email, and a **license_keys** record exists with `key` = `OZ-PLUS-…`, `payment_provider=midtrans`, `midtrans_sub_id` set, and the plus quota block (max_stores=1, max_pos_instances=2, allowed_types without `kds`).
6. [ ] The **receipt email** with the license key lands at the buyer address (requires SMTP from §7.1 step 5; failure is non-fatal and logged).
7. [ ] **POS activation:** in the desktop app, activate with that key + email → the signed payload returns `tier_key=plus`, `max_locations=1` (legacy `max_stores` also present), `max_pos_instances=2`, and `payment_provider=midtrans` on the subscription record.
8. [ ] **Bundle (C3.2, only if the bundle entry is in the map):** toggle Restaurant Starter on the Plus card → snap `amount` is the bundle amount and `custom_field4=restaurant_starter`; after payment the key's `allowed_types` **includes `kds`** and `bundle_id=restaurant_starter`.

**Negative + lifecycle checks (curl against the webhook URL):**

- [ ] **Tampered amount** — a settled notification whose `gross_amount` is not in the map → **500** and no key minted (Midtrans retries until the map is fixed).
- [ ] **Bundle claim on a plain amount** — `custom_field4=restaurant_starter` with a plain Plus `gross_amount` → **500**, no key (the price map is authoritative).
- [ ] **Tampered custom_field3** — `1490000` (plus:year) with `custom_field3="month"` → **500**, no key (the period must match the price-map period).
- [ ] **Invalid signature** — wrong `signature_key` → **401**, nothing created.
- [ ] **Replay** — resend the same `transaction_id` → **200** with `{"status":"duplicate"}`, still exactly one license key.
- [ ] **Renewal** — a second settled charge with the same `subscription_id` but a new `order_id` → the **same** key is refreshed (no second key) and `expires_at` extends +1 year.
- [ ] **Failed charge** — a `cancel`/`expire` notification for the same subscription → the subscription record moves to `grace_period` with `grace_until` = the old `expires_at`.

**Going live:**

- [ ] Flip `MIDTRANS_SERVER_KEY` to the production `Mid-server-…` key and unset `MIDTRANS_SNAP_URL` (production default). Redeploy, confirm the boot log, then run steps 1–7 once against production with a real small charge.
- [ ] Remove the sandbox test tenant/keys from the admin UI (or keep a sandbox service for future tests).

### 11.8 Verify the checkout leg with curl (no browser)

The browser walk in §11.7 step 3 is the happy path; this section reproduces the exact same calls with curl so ops can verify the snap leg from a shell. The flow is **register-first** — the webhook needs a tenant email — so the session token comes from the same OTP login the website uses. No `Origin` header is needed: the CORS allowlist only governs browsers (`webOriginAllowed` passes for header-less callers).

**Step 1 — session token (register-or-login).** The 6-digit code arrives by email; the response is the same whether the account existed or not (no enumeration):

```bash
curl -X POST https://license.ozpos.my.id/api/v1/web/request-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"buyer@test.com"}'
```

**Expected 200:** `{"status":"ok"}`

```bash
# 1b. Exchange the emailed code for a session token
curl -X POST https://license.ozpos.my.id/api/v1/web/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"buyer@test.com","code":"123456"}'
```

**Expected 200:** `{"token":"<session token>","expires_at":"…","tenant":{…},"license":{…},"subscription":{…}}` — capture `token`; it is the Bearer credential for the snap call below.

**Step 2 — create the Snap charge (the checkout leg):**

```bash
curl -X POST https://license.ozpos.my.id/api/v1/midtrans/snap \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token from step 1b>" \
  -d '{"tier_key":"plus","period":"yearly"}'
```

**Expected 200:**

```json
{
  "token": "6f9d2c11-…-snap-token",
  "redirect_url": "https://app.midtrans.com/snap/v2/vtweb/…",
  "order_id": "OZ-PLUS-1755486000-1a2b3c",
  "amount": "500000"
}
```

**Cross-check every run:** `order_id` matches `OZ-<TIER>-<unix>-<hex>`; `amount` equals the §2/§7.1 price-map entry (Rp 500.000 for `plus:year`). Any other amount — or a `400 {"error":"tier … is not mapped in MIDTRANS_PRICE_TIERS"}` — means the map is wrong: **stop** (the endpoint refuses to mint an unbilled tier).

**Bundle variant** (only if the bundle entry is in the map, C3.2):

```bash
curl -X POST https://license.ozpos.my.id/api/v1/midtrans/snap \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"tier_key":"plus","period":"yearly","bundle":"restaurant_starter"}'
```

**Expected 200:** same shape with `"amount":"750000"` — the bundle amount, so the webhook mints `kds` in `allowed_types` (custom_field4 rides the charge).

**Failure modes (curl the same endpoint):**

| Call | Expected |
|---|---|
| No/malformed `Authorization` | `401 {"error":"missing or invalid session token"}`
| Expired/unknown session | `401 {"error":"invalid or expired session"}`
| Tier/period not in the map | `400 {"error":"tier "pro" (weekly, bundle=) is not mapped in MIDTRANS_PRICE_TIERS"}`
| Disallowed `Origin` header (browser only) | `403 {"error":"origin not allowed"}`
| Midtrans unreachable / wrong server key | `502 {"error":"checkout provider error"}` + server log `midtrans snap: token creation failed`

**Step 3 (optional) — the raw Midtrans leg**, to prove the server key + Snap account independently of the app (this is byte-for-byte what `createMidtransSnapHTTP` sends):

```bash
curl -X POST https://app.sandbox.midtrans.com/snap/v1/transactions \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -u "SB-Mid-server-…:" \
  -d '{
    "transaction_details": {"order_id": "OZ-PLUS-1755486000-1a2b3c", "gross_amount": "500000"},
    "item_details": [{"id": "plus-year", "price": "500000", "quantity": 1, "name": "OZ-POS PLUS (year)"}],
    "customer_details": {"email": "buyer@test.com"},
    "custom_field1": "plus",
    "custom_field2": "buyer@test.com",
    "custom_field3": "year",
    "custom_field4": "",
    "enabled_payments": ["qris", "bank_transfer", "echannel", "gopay", "shopeepay", "credit_card"],
    "credit_card": {"secure": true}
  }'
```

**Expected 201:** `{"token":"…","redirect_url":"…"}` (use `https://app.midtrans.com` for production; the base must match the `MIDTRANS_SERVER_KEY` environment — sandbox key + sandbox URL, production key + production URL). A 401 here means the server key is wrong or belongs to a different environment.

**Webhook failure modes (curl the webhook endpoint with a signed body):**

| Call | Expected |
|---|---|
| Invalid signature | `401 {"error":"invalid signature"}` |
| Tampered amount (not in map) | `500`; log: `gross_amount "…" is not mapped in MIDTRANS_PRICE_TIERS` |
| Bundle claim on plain amount | `500`; log: `custom_field4 bundle "…" disagrees with price-mapped bundle ""` |
| **Tampered custom_field3** | `500`; log: `custom_field3 period "…" disagrees with price-mapped period "…"` |
| Replay (same `transaction_id`) | `200 {"status":"duplicate"}` |
| Renewal (same `subscription_id`) | `200`; same key refreshed, `expires_at` extended |
| Failed charge (`cancel`/`expire`) | `200`; subscription → `grace_period` |

---

## 12. Ongoing Maintenance

### Backup

Northflank provides **volume snapshots**. Enable them:

1. Go to **Volumes** → your `pb-data` volume.
2. Click **Backups** → **Create Backup Schedule**.
3. Set daily backups with 7-day retention.

Alternatively, export manually from the admin UI (`/_/` → **Settings** → **Export Collections**).

### Monitoring

- **Northflank Dashboard:** CPU, memory, and request logs are available in the service overview.
- **PocketBase Logs:** Viewable via the Shell (`less /pb/pb_data/logs.db`) or the admin UI.
- **Uptime Monitoring:** Add a health check endpoint monitor (e.g., UptimeRobot on `https://license.ozpos.my.id/api/health`, which returns `{"status":"ok"}`). The payload also includes per-gate status objects: `smtp` (`configured`/`verified`/`error` — runtime sender-identity probe, re-run at most every 60s so monitors don't hammer the relay), `paddle` (`secret_configured`/`price_tiers_configured`/`price_tiers_mappings`/`error`), `rsa` (`configured`), and `discord` (`configured`). These are status, not liveness — only a DB outage fails the check. **Copy-paste monitor config (including the keyword monitor that alerts when `smtp.verified` flips to false): see [`uptime-monitor.md`](./uptime-monitor.md).**
- **Midtrans (C3.1):** `/api/health` now exposes a `midtrans` gate object — `server_key_configured` / `price_tiers_configured` / `price_tiers_mappings` / `error` — mirroring the boot-time `verifyMidtransConfig` (a missing or rotated `MIDTRANS_SERVER_KEY` flips `server_key_configured` to false; a dropped/malformed `MIDTRANS_PRICE_TIERS` flips `price_tiers_configured` to false and surfaces the parse error). **Keyword monitor:** alert on `"server_key_configured":false` or `"price_tiers_configured":false` (copy-paste row in [`uptime-monitor.md`](./uptime-monitor.md)). These are status, not liveness — a broken Midtrans config never fails the HTTP check, so the keyword monitor is what catches it. Also still watch the service logs for `Midtrans webhook config verified: 6 amount→tier mapping(s)` after every deploy, and alert on webhook **5xx** (a 500 on a settled charge means provisioning failed and Midtrans is retrying — the payload says which `order_id`).

### Updating the service

1. Make changes to `apps/license-server/`.
2. Rebuild the Docker image:

   ```bash
   docker build -t oz-pos/license-server -f apps/license-server/Dockerfile apps/license-server
   docker tag oz-pos/license-server ghcr.io/YOUR_USERNAME/oz-pos-license-server:latest
   docker push ghcr.io/YOUR_USERNAME/oz-pos-license-server:latest
   ```

3. In Northflank, go to your service → **Deployments** → **Redeploy**.
   - Northflank will pull the latest image and restart the container.
   - The persistent volume preserves all data across redeploys.

### Generating new license keys

1. Open the admin UI (`/_/`).
2. Go to **license_keys** → **New Record**.
3. Fill in the tier, quotas, allowed types, and set status to `unused`.
4. Send the key to the customer.

---

## Cost Summary

| Item | Monthly Cost |
|---|---|
| **Compute** (`nf-compute-10`, 256 MB) | ~$2.70 |
| **NVMe Storage** (1 GB) | ~$0.15 |
| **Data Transfer** (low — only activation calls) | ~$0 |
| **Custom Domain TLS** | Free |
| **Total** | **~$2.85/month** |

> Northflank's Sandbox tier includes 2 free services, so the license server may qualify for $0/month if it stays within Sandbox limits.

---

## Troubleshooting

| Issue | Solution |
|---|---|
| Service crashes immediately | Check logs: the most common cause is missing `OZ_LICENSE_PRIVATE_KEY` env var. |
| `OZ_LICENSE_PRIVATE_KEY environment variable is required` | The secret group is not attached or the env var name is misspelled. |
| `failed to decode PEM block` | The private key is not valid PEM. Ensure you pasted the entire file including `-----BEGIN`/`-----END-----`. |
| `failed to parse RSA private key` | The key format is wrong. Generate PKCS#8 using the script in Step 2. |
| Can't log into admin UI | Create the superuser via the Shell (Step 9). |
| Collections not showing | Shouldn't happen on fresh boots — the schema auto-imports on first boot. If collections are missing anyway (e.g. a partially-provisioned volume), import `pb_schema.json` via Settings → Import Collections (Step 8). |
| Rate limited in testing | Wait 1 hour for IP bucket to refill, or restart the container (rate limiter is in-memory). |
| Health check failing | The Go healthcheck binary pings `/api/health` with a 5s timeout. If the server is slow to start (e.g., first boot after volume attach), the container may flap as unhealthy for ~15s until PocketBase finishes initialisation. In the **unified image**, the shell healthcheck also fails the container after `OZ_HEALTH_SMTP_MAX_FAILS` (default 3) consecutive SMTP `verified:false` probes — check `docker inspect` → `State.Health` and the healthcheck stderr for `SMTP sender identity not verified`. Run `docker inspect` to check `State.Health`. |

> 💡 **Tip:** The Dockerfile healthcheck uses the standalone `/pb/healthcheck` Go binary (no curl dependency). It pings `/api/health` which returns `{"status":"ok"}` when PocketBase is healthy. The healthcheck was set up correctly in the Dockerfile.

> last audited 09-09-26 by docs-auditor
