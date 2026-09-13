# Uptime Monitoring — license server gate statuses

<!-- Audit stamp: 2026-08-18 · Buffy · status: ACCURATE · payload fields verified
     against health.go (smtp.verified, paddle.*, midtrans.*, rsa.*, discord.*); keyword
     `"verified":false` matches Go's json.Marshal output (no space after colon);
     v2 API params per https://uptimerobot.com/api/legacy/ (type=2 keyword,
     keyword_type 1=exists / 2=not-exists, interval in minutes, free-plan min 5) -->

The license server's `GET /api/health` reports every boot-gate status, but by
design **none of them fail the HTTP check** — only a DB outage returns non-200.
That means a broken relay or a missing secret is *invisible* to a plain
"is it up?" monitor. The keyword monitor below is the piece that closes that
gap: it alerts the moment the SMTP sender-identity probe stops passing.

## What to create (two monitors)

### 1. Liveness — `GET /api/health` responds 200

| Setting | Value |
|---|---|
| Monitor type | HTTP(s) |
| URL | `https://<license-host>/api/health` |
| Interval | 5 min (free-plan minimum) |
| Alert contact | your email / Discord / Slack |

Catches outages and the DB-degraded state (non-200).

### 2. SMTP sender verified — keyword monitor (the important one)

| Setting | Value |
|---|---|
| Monitor type | **Keyword** |
| URL | `https://<license-host>/api/health` |
| Keyword | `"verified":false` |
| Alert when | **Keyword exists** |
| Interval | 5 min |
| Alert contact | your email / Discord / Slack |

**Why this works**

- The payload's `smtp` block is exactly `{"configured":true,"verified":true,"error":""}`
  (Go's `json.Marshal` — no space after the colon), so `"verified":false`
  appears only when the last probe **failed or was never configured**.
- The probe result is cached server-side for 60s (`smtpHealthRefreshInterval`),
  so alert latency is at most `monitor interval + 1 minute` — no extra load on
  the relay from the monitor.
- When SMTP env is missing entirely (`configured:false`), `"verified":false` is
  present too — so the same monitor doubles as a "SMTP env lost" alert. That's
  desirable: production always has SMTP configured (the boot gate fails the
  deploy otherwise).

> Prefer the inverse? Use keyword `"verified":true` with "alert when keyword
> **does not exist**" instead. The exists-on-`false` form is more precise: it
> can't false-positive on a truncated/timeout response that happens to lack the
> true string.

## Verify the payload first

```bash
curl -s https://<license-host>/api/health | python3 -m json.tool
# smtp:  { "configured": true, "verified": true, "error": "" }
```

To see the alerting state, break it on purpose (local test only):

```bash
OZ_SMTP_HOST=127.0.0.1 OZ_SMTP_PORT=9 OZ_SMTP_FROM=verified@example.com ./license-server serve --http=127.0.0.1:8090
curl -s http://127.0.0.1:8090/api/health   # smtp.verified:false — this is the state that pages you
```

### 3. Midtrans gate — keyword monitor (C3.1)

| Setting | Value |
|---|---|
| Monitor type | **Keyword** |
| URL | `https://<license-host>/api/health` |
| Keyword | `"server_key_configured":false` **or** `"price_tiers_configured":false` |
| Alert when | **Keyword exists** |
| Interval | 5 min |
| Alert contact | your email / Discord / Slack |

**Why this works**

- The payload's `midtrans` block is `{"server_key_configured":true,"price_tiers_configured":true,"price_tiers_mappings":6,"error":""}`
  when the C3.1 billing switch is live — so either `false` string appears only
  when the gate is broken.
- A rotated/missing `MIDTRANS_SERVER_KEY` flips `server_key_configured`; a
  dropped/malformed `MIDTRANS_PRICE_TIERS` flips `price_tiers_configured` and
  puts the parse error in `error`. Both are status, not liveness — the HTTP
  check stays 200, so this keyword monitor is what pages you.

## Create via the dashboard (no code)

1. UptimeRobot → **Add New Monitor**.
2. Type **Keyword**; URL `https://<license-host>/api/health`.
3. Keyword: `"verified":false`; **Alert when: the keyword exists**.
4. Interval 5 minutes; attach your alert contact; save.

## Or create via API (v2)

Read-write API key: UptimeRobot → **Integrations & API → API**.

```bash
# 1 — liveness monitor (type 1 = HTTP(s))
curl -X POST "https://api.uptimerobot.com/v2/newMonitor" \
  -d "api_key=<READ-WRITE-KEY>&format=json" \
  -d "friendly_name=OZ-POS license - liveness" \
  -d "url=https://<license-host>/api/health" \
  -d "type=1&interval=5&alert_contact=<CONTACT_ID>"

# 2 — SMTP verified keyword monitor (type 2 = Keyword, keyword_type 1 = exists)
curl -X POST "https://api.uptimerobot.com/v2/newMonitor" \
  -d "api_key=<READ-WRITE-KEY>&format=json" \
  -d "friendly_name=OZ-POS license - SMTP sender verified" \
  -d "url=https://<license-host>/api/health" \
  -d "type=2&interval=5" \
  -d "keyword_type=1&keyword_value=%22verified%22:false" \
  -d "alert_contact=<CONTACT_ID>"
```

Notes:

- `interval` is in **minutes** (free plan minimum 5).
- `alert_contact` — list your contacts with `GET /v2/getAlertContacts`; omit to
  use the account default.
- The v2 API is legacy but stable; UptimeRobot's newer v3 API (OpenAPI spec at
  https://uptimerobot.com/api/) exposes the same monitor with `keyword` as an
  object — use whatever your account prefers.

## Other gate fields worth watching (optional)

The same endpoint also exposes `paddle.secret_configured`, `paddle.price_tiers_configured`,
`midtrans.server_key_configured`, `midtrans.price_tiers_configured`, `rsa.configured`,
and `discord.configured`. Only `smtp.verified` needs a keyword monitor in
practice — the rest are enforced at boot (the deploy fails fast if they're
missing) — but keyword monitors on `"server_key_configured":false` (Midtrans)
and `"secret_configured":false` (Paddle) page you if a billing secret is ever
rotated out from under the running service.

> last audited 18-08-26 by Buffy
