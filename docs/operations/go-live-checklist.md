# kasir.mu Go-Live — Northflank Env Checklist

<!-- Audit stamp: 2026-09-09 · DSH · status: VERIFIED-TRUE, no content change (1 cross-ref added) · First audit evidence this page ever carried. Nearly every claim on it is checkable, so all of them were. · The fail-fast headline is TRUE and traced, not assumed: the two Paddle variables are not merely request-path errors. paddle_webhook.go:400 verifyPaddleConfig is called at boot from main.go:110 and its own comment at :388 says so; the only other boot Fatals are OZ_LICENSE_PRIVATE_KEY (main.go:71,76,86,91). So the stated apply order - env in Northflank before or with the deploy that ships the image - is correct and load-bearing. health.go:74 keeps /api/health in sync with the same gate, which is why the §0 probe table reads the way it does. · Every OZ_/PADDLE_ name on the page exists in code except two, and both are deliberate: OZ_SMTP_STARTTLS and OZ_SMTP_IMPLICIT_TLS appear here only in the line telling you NOT to set them, so their absence from the binary is the point. My first pass flagged four names as absent from the code, which was my scan scope, not the doc: OZ_HEALTH_SMTP_MAX_FAILS and OZ_HEALTH_PADDLE_MAX_FAILS are real and read by apps/unified/healthcheck.sh:62 and :100, a different app directory. · The one genuine gap was not this page but the coverage it defers to: five variables the server reads were in no document at all (three of them the login lockout). Fixed in apps/license-server/DEPLOY.md section 7.7, and now gated by .agents/skills/docs-auditor/scripts/check-env-docs.py, so the deferral in the next paragraph is enforceable rather than a promise. · §0 probed 2026-08-17 is left exactly as written: a dated observation of a deployed image, not a claim about this tree. The date is already inline, which is what makes it re-readable. -->

> One page to take the deployed license server from "pre-fail-fast image, no SMTP, no
> Paddle" to "sandbox live". Companion to [`DEPLOY.md`](https://github.com/kardelitaitu/kasirmu/blob/main/apps/license-server/DEPLOY.md) §7 (which documents
> every variable in full) and [`uptime-monitor.md`](https://github.com/kardelitaitu/kasirmu/blob/main/apps/license-server/uptime-monitor.md) (how to watch the
> gates once they're set).
>
> **Why order matters:** the current deployed image predates the fail-fast boot gates.
> The next image built from this branch **will not boot** without
> `PADDLE_WEBHOOK_SECRET` + `PADDLE_PRICE_TIERS` (and `OZ_SMTP_FROM` when
> `OZ_SMTP_HOST` is set). So the env must be in Northflank **before or with** the deploy
> that ships the new image — or the rollout fails fast (by design).

---

## 0. Current state (probed 2026-08-17 against `https://license.ozpos.my.id`)

| Endpoint | Result | Meaning |
|---|---|---|
| `GET /api/health` | no `smtp` / `paddle` / `rsa` / `discord` fields | deployed image predates the gate-status payload |
| `POST /api/v1/web/request-otp` | `503 email delivery is not configured` | **no SMTP env** |
| `POST /api/v1/paddle/webhook` | `503 paddle webhook is not configured` | **no Paddle env** |

`OZ_LICENSE_PRIVATE_KEY` is the one required variable already set (the server boots and
the RSA path works).

---

## 1. The three values only a human can copy

These are dashboard-only — no API returns them. Copy each into the Northflank secret
group (see §3), **before** the next deploy.

| # | Variable | Value | Where to copy it from |
|---|---|---|---|
| 1 | `OZ_SMTP_USER` | **THE ONE BLOCKER** — Brevo SMTP **login id**, format `7a5647001@smtp-brevo.com` (NOT your Gmail, NOT the key) | Brevo → **Settings → SMTP & API** → copy the **Login** field |
| 2 | `OZ_SMTP_FROM` | `adikaradwiatmaja@gmail.com` — but only after it is **verified** | Brevo → **Sender Identity** → verify the email (Brevo sends a confirmation link). Until verified, the relay rejects sends with `550 Sender address is not verified` |
| 3 | `PADDLE_WEBHOOK_SECRET` | (endpoint secret — shown once, never via API) | Paddle (sandbox) → **Developer tools → Notifications** → edit destination `ntfset_01m05htpgfq0qmcvb0er6byrsx` → **Endpoint secret** |

> If the login id is still missing, everything else can be prepared: the remaining
> values below are all known and can be entered now.

---

## 1b. Two Paddle dashboard actions (one-time, only you can click)

Both are dashboard-only clicks that unblock the sandbox end-to-end loop — no API call or
code change can do them. Do them **before** the §3 deploy so the checkout overlay and
webhook delivery work the moment the new image is up.

1. **Set the default payment link** — Paddle (sandbox) → **Checkout → Checkout settings →
   Default payment link** heading → enter a URL (the site homepage, e.g.
   `https://ozpos.my.id`) → Save. This is a **URL input field**,
   NOT a product picker. Without it the checkout service rejects every transaction with
   `transaction_default_checkout_url_not_set` and the overlay dies with
   **"Something went wrong"** before Paddle even opens. `https://localhost/` is also
   accepted for sandbox testing (docs: "If you don't have one, enter https://localhost/").
2. **Webhook destination — DONE (verified 2026-08-17 via the Paddle API):**
   `ntfset_01m05htpgfq0qmcvb0er6byrsx` now posts to
   `https://license.ozpos.my.id/api/v1/paddle/webhook` (the production custom
   domain for the unified auth+sync service). If it ever regresses: Paddle (sandbox) →
   **Developer tools → Notifications** → edit destination `ntfset_01m05htpgfq0qmcvb0er6byrsx` →
   **Endpoint URL** → the `license.ozpos.my.id` URL → Save. While in that same edit
   screen, copy the **Endpoint secret** into §1 #3 — it is shown once and never returned by any API.

---

## 2. Full env block (paste-ready)

```ini
# ── Paddle (sandbox) — REQUIRED at boot (fail-fast gates) ────────────
PADDLE_WEBHOOK_SECRET=<copy from §1 #3>
# NOTE (2026-08-31): the six sandbox prices are catalogued from the Paddle
# dashboard (Plus/Pro/Premium × monthly/yearly). PADDLE_PRICE_TIERS must
# list every price id → tier_key pair (plus_monthly/plus_yearly → plus,
# etc.) so the webhook can provision each one; the `:period` segment
# cross-checks the billing cycle.
PADDLE_PRICE_TIERS=pro_01m1amcb41qkbr7zzd1kxa3qnd:plus:month,pro_01m1amdj2swb3q21r2mwcy3krh:plus:year,pro_01m1amdwp700jp6183k9zjsgaz:pro:month,pro_01m1ame8ckw8vzjnf8y4q15mww:pro:year,pro_01m1amema8yj6w5mfm8wx8jwhm:premium:month,pro_01m1amf0vpbyfndg5rkvxvyqj4:premium:year
PADDLE_API_URL=https://sandbox-api.paddle.com
PADDLE_API_KEY=<copy from Paddle (sandbox) → Developer tools → Authentication>

# ── SMTP (Brevo) — required once OZ_SMTP_HOST is set ─────────────────
OZ_SMTP_HOST=smtp-relay.brevo.com
OZ_SMTP_PORT=587            # or 465 (implicit TLS) — both supported
OZ_SMTP_USER=<copy from §1 #1>
OZ_SMTP_PASSWORD=<copy from Brevo → SMTP & API → SMTP key (Master Password)>
OZ_SMTP_FROM=adikaradwiatmaja@gmail.com   # must be verified in Brevo Sender Identity first

# ── Optional (defaults are fine) ─────────────────────────────────────
# OZ_DISCORD_WEBHOOK=            # support-contact target (Discord channel webhook); unset → /contact 503s
# OZ_WEB_ALLOWED_ORIGINS=        # unset = defaults already include the deployed site origin
# OZ_WEB_SESSION_TTL=24h         # web session lifetime (Go duration)
# PADDLE_WEBHOOK_MAX_AGE=5m      # replay window for webhook ts
# OZ_HEALTH_SMTP_MAX_FAILS=3     # container healthcheck: fail after N consecutive smtp.verified:false
# OZ_HEALTH_PADDLE_MAX_FAILS=3   # container healthcheck: fail after N consecutive paddle.secret_configured:false
```

Notes:
- **Sandbox vs live:** the block above is for the sandbox go-live. When the live Paddle
  catalog exists, swap `PADDLE_API_URL` → `https://api.paddle.com`, the API key → a
  `pdl_live_…` key, and `PADDLE_PRICE_TIERS` → the **live** price ids (same shape).
- `OZ_LICENSE_PRIVATE_KEY` is already set — leave it untouched.
- Do **not** set `OZ_SMTP_STARTTLS` / `OZ_SMTP_IMPLICIT_TLS` — they are not read by the
  code; the transport is chosen by `OZ_SMTP_PORT` alone (465 = implicit TLS, anything
  else = STARTTLS).

---

## 3. Apply order (do this before the next deploy)

1. **Paddle dashboard actions** (§1b) — set the default payment link and repoint the
   webhook destination. Grab the **Endpoint secret** for `PADDLE_WEBHOOK_SECRET` while
   you're in the Notifications edit screen.
2. **Paddle gates** (unconditional boot requirements):
   - Copy `PADDLE_WEBHOOK_SECRET` (§1 #3) and `PADDLE_PRICE_TIERS` into the
     `license-server-secrets` secret group (Northflank → project → **Secrets** →
     `license-server-secrets` → Add secrets).
3. **Verify the Brevo sender** (blocking for SMTP):
   - Brevo → **Sender Identity** → verify `adikaradwiatmaja@gmail.com`.
4. **SMTP vars**: add `OZ_SMTP_HOST`, `OZ_SMTP_PORT`, `OZ_SMTP_USER` (§1 #1),
   `OZ_SMTP_PASSWORD`, `OZ_SMTP_FROM` to the same secret group.
5. **Optional extras**: `OZ_DISCORD_WEBHOOK`, session TTL / health max-fails overrides.
   Skip → defaults.
6. **Attach + redeploy**: confirm the secret group is linked to the service, then trigger
   the deploy (or restart) that ships the new image.
7. **Verify** (§4) — do not stop at a green deploy; the gates are *status*, so confirm
   the payload too.

> Env changes take effect on the next service redeploy/restart — there is no hot reload.
> If the deploy fails to boot, `/api/health` will 503 and Northflank will show the
> failing readiness probe; check the container logs for the fail-fast message naming the
> missing variable.

---

## 4. Post-deploy verification

```bash
B=https://license.ozpos.my.id

# 1. Gate statuses — expect all true (probe is cached ~60s after boot)
curl -sS "$B/api/health"

# 2. SMTP end-to-end — a real OTP email must land (check the inbox; also
#    confirms Brevo accepts the verified sender)
curl -sS -X POST "$B/api/v1/web/request-otp" \
  -H "Content-Type: application/json" -d '{"email":"you@gmail.com"}'

# 3. Webhook — the 503 is gone; a bogus body now fails with 401 (signature
#    check), proving PADDLE_WEBHOOK_SECRET is loaded
curl -sS -X POST "$B/api/v1/paddle/webhook" \
  -H "Content-Type: application/json" -d '{}'

# 4. Real delivery — with the destination repointed (§1b #2), send a test
#    notification from Paddle → Developer tools → Notifications → destination →
#    "Send test notification" and confirm the container log logs the event
```

| Check | Pass condition |
|---|---|
| `/api/health` | `"smtp":{"configured":true,"verified":true}`, `"paddle":{"secret_configured":true,"price_tiers_configured":true,"price_tiers_mappings":N}` (N = mapped prices; 2 today with the legacy ids, **6** once the new catalog ships), `"rsa":{"configured":true}` |
| `request-otp` | `200` and a real 6-digit code email arrives (not spam) |
| `paddle/webhook` | `401` (not `503`) — secret loaded, signature verified |
| test notification | Paddle's "Send test notification" reaches the container log (proves the repointed destination + secret) |

Then wire the alerting from `uptime-monitor.md` (`"verified":false` keyword monitor) so
a broken relay or rotated secret pages someone.

---

## 5. Remaining go-live items outside Northflank (pointers)

- **Website secrets** (GitHub Actions → Settings → Secrets, consumed by `website.yml`
  and baked at build time): `PUBLIC_LICENSE_API_URL` (the `code.run` URL),
  `PUBLIC_PADDLE_CLIENT_TOKEN` — **DONE (2026-08-17): minted via `POST /client-tokens`
  with the sandbox API key and set as a GH secret** (id `ctkn_01m07k8eyefpfbp3e3bf35qzvv`;
  dashboard path if ever regenerated: Paddle (sandbox) → **Developer tools →
  Authentication → Client-side tokens** → New — sandbox tokens start `test_`),
  `PUBLIC_PADDLE_ENVIRONMENT=sandbox`. The runtime override lives in `website/wrangler.toml` → `[vars] LICENSE_API_URL` — update it there (or the Worker dashboard) when the host changes; no rebuild needed.
- **Paddle sandbox checkout** is unblocked by the **default payment link** — now a
  checklist step in §1b #1 (do it before the §3 deploy).
- **Domain + SPF/DKIM/DMARC** is the real inbox-not-spam fix once `ozpos.my.id` is owned
  (see `DEPLOY.md` §7).
- **Auto-deploy wiring** — backend deploys are manual (Redeploy button) until
  `deploy.yml` is wired: set GitHub secret `NORTHFLANK_API_TOKEN` + vars
  `NORTHFLANK_PROJECT_ID` / `NORTHFLANK_SERVICE_ID` / `NORTHFLANK_SERVICE_URL`
  (see runbook §8.5). Until then, run the §3 apply order and click Redeploy.

> last audited 09-09-26 by docs-auditor
