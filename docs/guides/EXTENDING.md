# Extending OZ-POS — Scripting & Integration Guide

<!-- Audit stamp: 2026-09-08 · DSH · status: ACCURATE (3 findings, all repaired) · re-verified the 2026-09-03 audit rather than trusting it, and it held on ~20 claims: READ_KEY_MAP in crates/oz-api/src/read_tiers.rs, require_admin_write at routes/tokens.rs:134, ApiTokenClaims at auth.rs:58, DEFAULT_EXPIRY_HOURS=24, JWT_CACHE_TTL_SECS=60, OZ_TERMINAL_READ_TIER at routes/tokens.rs:205, plan endpoint really is free|pro only (plans.rs:111; enterprise -> 400 unknown_plan), the six-event vocabulary matches EVENT_ACTIONS exactly and in order (apps/cloud-server/src/outbound_webhooks.rs:36-43), 10 s receiver timeout, backoff 120*2^attempt capped at 3600 s (outbox.rs:45-48), Lua INSTRUCTION_LIMIT=100_000 and MEMORY_LIMIT=10 MiB (crates/oz-lua/src/lib.rs:53-57), sale.before_complete at crates/oz-plugin/src/manager.rs:411, ErrorEnvelope forward-declared while handlers emit flat errors, all six reserved tags still declare zero paths so §10.2 stands five days on · REPAIRED: §2.2 resolved the served store via store_profiles.is_primary but the query is SELECT id FROM locations WHERE is_primary = 1 (apps/desktop-client/src/local_api.rs:95-98), the store->location rename; §1 said 505 IPC commands, registered is 450 (425 desktop / 297 tablet / 272 both); §3.2 omitted the three /api/v1/memos/* routes from the 2026-09-07 cloud-read ruling, which spec/paths.rs already declared · EVIDENCE CORRECTION: the previous stamp claimed §7 is executed verbatim by target/smoke-local-api.ps1 (22/22) — that file is untracked inside a gitignored build dir (.gitignore:2 /target/), so the claim was true once and is unreproducible by anyone else; promote it to scripts/ before citing it as proof · original 2026-09-03 anchors retained: crates/oz-api/src/{lib.rs,auth.rs,read_tiers.rs,api_audit.rs,spec/mod.rs}, crates/oz-api/src/routes/{tokens.rs,terminals.rs,sales.rs,settings.rs,products.rs,tax_rates.rs,exchange_rates.rs,users.rs,images.rs}, apps/cloud-server/src/{main.rs,openapi.rs,openapi_tests.rs,sync_api.rs,outbound_webhooks.rs,outbox.rs}, apps/desktop-client/src/{local_api.rs,commands/local_api.rs}, foundation/src/money.rs, docs/specs/_active/0047-openapi-drift-guard-and-read-tiers.md -->

This guide is for people writing **their own scripts** against an OZ-POS
installation — automation on the counter machine, a dashboard against the
cloud, or an in-process business-rule extension. It maps the extension
surfaces, the auth model, the wire conventions, and the honest current
status of each (what is live today vs. wired-but-not-started).

## 1. Which surface do I use?

| You want to… | Surface | Status |
|---|---|---|
| Change discounts / tax / order validation **inside** the register flow | Lua plugin (`crates/oz-lua` + `crates/oz-plugin`) | Stable — see [plugin-guide.md](./plugin-guide.md) |
| Read/write products, stock, sales, rates from an **external process** (KDS, scanner, dashboard, sync job) | REST API (`crates/oz-api`) | Live on **cloud-server**; on the **desktop app** it runs loopback-only behind Settings → Local API (off by default, §2.1); tablet: not started |
| Batch maintenance against the local SQLite DB (migrations, backup, import/export, CRUD) | `oz` CLI (`crates/oz-cli`) | Stable — see [oz-cli README](../../crates/oz-cli/README.md) |
| Drive custom hardware (printer, scanner, drawer, display) | Rust HAL traits (`crates/oz-hal`) | Stable — plugin-guide §HAL |
| Call the app's internals (Tauri IPC commands — 450 registered as measured 08-09-26: 425 desktop, 297 tablet, 272 in both. **This moves with every command**; re-run `.agents/skills/docs-auditor/scripts/check-api-surface.py`, which prints the current three numbers) | **Not an extension surface** — internal front-end↔backend contract, no stability guarantee for third parties | — |

## 2. REST API at a glance

- **Format:** JSON over HTTP. OpenAPI 3.1 document served live (§2.3).
- **Base path:** `/api/v1/` — breaking changes ship under a new prefix; the
  old version stays ≥ 6 months (policy stated in the OpenAPI `info.description`).
- **Auth:** JWT bearer (`Authorization: Bearer <token>`), HS256 (§4).

### 2.1 Where it runs today

| Host | What it serves | Evidence |
|---|---|---|
| **Cloud server** (`oz-cloud-server`, the unified deployment) | The full surface: `oz-api` router + sync + webhooks + docs + metrics | `apps/cloud-server/src/main.rs` `build_router()` merges `oz_api::router(...)` with `sync_router`, `webhooks_router`, `docs_router` |
| **Desktop app** (`oz-pos-app`) | The `oz-api` router **only**, bound to `127.0.0.1` (default port 3099), **off by default** — enable in Settings → Local API. Tokens are minted in that panel; the server signs with a per-install secret generated on first enable | `apps/desktop-client/src/local_api.rs` (embeds `oz_api::router()`; never `serve()`, which binds 0.0.0.0) |
| **Tablet app** | Nothing yet — no `local_api` module | grep `local_api` → only `apps/desktop-client` |

Production cloud origin: `https://license.ozpos.my.id` (the Northflank
origin per spec 0049; your deployment may differ — use the URL configured
in the terminal's Settings → Cloud Sync).

### 2.2 Local options: built-in server vs playground

**Built-in (recommended for "script against the register on my desk"):**
open the desktop app → Settings → System → **Local API** → enable. The
panel shows the base URL (`http://127.0.0.1:3099/api/v1` by default) and
mints 30-day read tokens for your scripts. Differences from the cloud
deployment, by design:

- **loopback-only** bind — nothing on your LAN can reach it;
- it serves **one store's database at a time** — by default the
  **primary store**, the same `store-{id}.sqlite` file the register
  reads (resolved via `locations.is_primary` in the **global** DB — `primary_store_id()`
  at `apps/desktop-client/src/local_api.rs:95` runs
  `SELECT id FROM locations WHERE is_primary = 1 LIMIT 1`); multi-store
  installs can switch the served store in the same Settings panel
  (restarts the server against the new file). Scripts see exactly what
  the UI shows. One caveat: `POST /api/v1/users` writes the store DB's
  `users` table, while the register's login accounts live in the global
  identity DB — create staff accounts through the UI, not scripts;
- **API writes land in the served store's audit log** (`api.write`
  entries with method, path, status, and the minted token's label), so
  script mutations are visible in the merchant's audit review UI;
- tokens are signed with a **per-install secret** generated on first
  enable (persisted, so they survive restarts); a token forged with the
  known dev fallback constant is rejected;
- the secret doubles as the `X-Admin-Key` for master-data writes (§5) and
  for token minting over HTTP — it lives in the settings table and is
  deliberately not shown in the UI;
- no `/api/sync/*`, no webhooks, and no Swagger/Scalar UI pages — those
  are cloud-server extras. `GET /api/openapi.json` **is** served: the
  machine-readable contract for exactly this surface, every operation
  tagged `x-oz-scope: "both"` (§2.3).

**Standalone playground (develop against the full cloud surface):**

```bash
# SQLite-backed dev server, admin key unset => token minting is OPEN (dev mode)
cargo run -p oz-cloud-server
# env knobs: OZ_API_PORT (default 3099), OZ_DB_PATH (default oz-pos.db),
#            OZ_ADMIN_KEY, OZ_API_SECRET, OZ_CORS_ORIGINS, OZ_PRODUCTION
```

Never expose a dev-mode server (no `OZ_ADMIN_KEY`, no `OZ_API_SECRET`) to a
network: it falls back to a hard-coded dev signing secret and an open token
mint. `OZ_PRODUCTION=1` refuses to boot unless both are set
(`validate_production_secrets` in `crates/oz-api/src/lib.rs`).

### 2.3 Interactive documentation & the shared spec

| URL | Cloud server | Desktop local API |
|---|---|---|
| `GET /api/openapi.json` | merged superset (both + cloud scopes) | base document only (all `x-oz-scope: "both"`) |
| `GET /api/docs` | Swagger UI | — |
| `GET /api/docs/scalar` | Scalar API reference | — |

These are public (no auth). Since 2026-09-03 the spec has a **single
source of truth**: `crates/oz-api/src/spec/` (`mod.rs` + `paths.rs` +
`schemas.rs`) builds the shared
document; `apps/cloud-server/src/openapi.rs` merges its cloud-only
paths (sync, webhooks, docs UI, host health/metrics) on top. Every
operation carries `x-oz-scope`:

- `"both"` — served by the cloud server **and** the desktop local API;
- `"cloud"` — cloud-server-only.

Scripts can therefore discover from the running server which surface
they are talking to. Drift-guard tests in `openapi_tests.rs` (spec 0047)
keep it honest in **both** directions: spec→router liveness, security
declarations, read-key coverage, scope correctness, `$ref` resolution
across the split, and router→spec coverage (a compile-time source scan
of every `.route()` registration — added 2026-09-03 after the guard's
original one-directional design let `settings` and `snapshot` drift
undocumented).

## 3. Endpoint map

### 3.1 Public / admin-key endpoints (no JWT)

| Method | Path | Gate | Notes |
|---|---|---|---|
| GET | `/api/v1/health` | none | status + version |
| POST | `/api/v1/tokens` | `X-Admin-Key` when `OZ_ADMIN_KEY` set; open in dev | mint a JWT (§4.1) |
| POST | `/api/v1/terminals` | same | register a terminal, returns `device_secret` **once**; re-register **rotates** the secret |
| PUT | `/api/v1/tenants/{tenant_id}/plan` | same | set tenant plan `free`/`pro` |
| GET/PUT | `/api/v1/settings` | same (checked inside the handler) | per-tenant SMTP/report-schedule/store-name provisioning |

### 3.2 JWT-protected endpoints

`oz-api` crate routes (served by the cloud today; the intended local-terminal
subset when it is wired):

| Method | Path | Read key (GET) | Write tier |
|---|---|---|---|
| GET | `/api/v1/products` | `products:read` | — |
| POST | `/api/v1/products` | — | **operator** (§5.2) |
| GET | `/api/v1/products/{sku}` | `products:read` | — (returns JSON `null` body when unknown) |
| PATCH | `/api/v1/products/{sku}/stock` | — | **operator** (`{"delta": <i64>}`) |
| GET | `/api/v1/categories` | `categories:read` | — |
| POST | `/api/v1/tax-rates` | — | **operator** |
| GET | `/api/v1/exchange-rates` | `reference:read` | — |
| POST | `/api/v1/exchange-rates` | — | **operator** |
| GET | `/api/v1/exchange-rates/latest` | `reference:read` | — |
| GET | `/api/v1/exchange-rates/latest/{from}/{to}` | `reference:read` | — |
| DELETE | `/api/v1/exchange-rates/{id}` | — | **operator** |
| GET | `/api/v1/tenants/me/plan` | `plan:read` | — |
| POST | `/api/v1/users` | — | **operator** |
| POST | `/api/v1/sales` | — | any valid token (terminals sell) |
| GET | `/api/v1/sales/{id}` | `sales:view` (PII-marked) | — |
| PATCH | `/api/v1/sales/{id}/status` | — | any valid token |
| PUT | `/api/v1/images` | — | any valid token (raw WebP ≤ 32 KB) |
| POST | `/api/v1/images` | — | any valid token (batch: ≤ 16 files / 512 KB, length-prefixed frames) |
| GET | `/api/v1/images:pack?hashes=…` | `products:read` | ≤ 64 files / 2 MB, binary frames |
| GET | `/api/v1/images:missing?hashes=…` | `products:read` | set-difference helper |
| GET | `/api/v1/images/{hash16}` | `products:read` | immutable WebP, `Cache-Control: max-age=31536000, immutable` |
| POST | `/api/v1/memos/sync` | — | **operator-adjacent**: `require_tenant_write` — desktop pushes its COMPLETE memo state, server reconciles by upsert + delete-by-omission. `tenant_id` comes from the claims, never the body, so a terminal token cannot spoof another tenant |
| GET | `/api/v1/memos/active?terminal_id=` | any valid token | the memos a terminal should currently display, same DTO shape as the desktop command so the banner consumes one type on every surface |
| POST | `/api/v1/memos/{memo_id}/ack` | — | **terminal tokens only** — an admin-minted token has no terminal identity and cannot ack |

> The three `memos` routes were added by the 2026-09-07 cloud-read ruling, four days
> after this page's last audit, and were missing from it until 08-09-26. Note that
> `crates/oz-api/src/spec/paths.rs` already declared them: the machine-readable
> contract stayed current while the prose table drifted. When the two disagree,
> `GET /api/openapi.json` wins — that is what the router→spec coverage guard enforces,
> and it has no reason to police a Markdown table.

Cloud-only additions (not part of the `oz-api` crate):

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health`, `/api/health` | none | richer health (DB ping, sync queue depth) |
| GET | `/metrics` | none | Prometheus text format |
| POST | `/api/sync/push` | JWT | push offline-queue items |
| POST | `/api/sync/pull` | JWT | pull other terminals' items (`since` cursor) |
| GET | `/api/sync/status` | JWT | pending/conflict counts |
| GET | `/api/sync/snapshot` | JWT | full snapshot pull (ETag/304, 15-min per-tenant cache) |
| POST | `/api/webhooks/stripe`, `/api/webhooks/square` | HMAC signature | **inbound** payment-provider events only |
| GET/POST | `/api/webhooks` · DELETE `/api/webhooks/{id}` | admin key | **outbound** webhook endpoint registry for your scripts (§7.4) |

> The OpenAPI spec also declares tag groups (Inventory, Orders, Reports,
> Customers, Notifications, Analytics) with **no paths behind them** —
> forward-looking labels, not endpoints. Do not code against them.

## 4. Authentication

### 4.1 Two mint paths

**A. Admin-key mint** (dashboards, scripts you run yourself):

```bash
curl -X POST https://<server>/api/v1/tokens \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: <OZ_ADMIN_KEY>" \
  -d '{"label": "my-script", "expiry_hours": 12, "read_preset": "dashboard"}'
```

- `OZ_ADMIN_KEY` unset ⇒ endpoint is open (dev mode only).
- Optional `read_preset` (`terminal` | `dashboard` | `audit`) or explicit
  `read_permissions` (wins over preset). Unknown values → 422
  `unknown_preset` / `unknown_permission`.
- Omit both ⇒ legacy **full-read** token (grandfathered, §5.1).

**B. Terminal client-credentials mint** (device tokens, no admin key at
runtime):

```bash
# one-time registration (operator action, admin-key gated)
curl -X POST https://<server>/api/v1/terminals \
  -H "X-Admin-Key: <OZ_ADMIN_KEY>" -H "Content-Type: application/json" \
  -d '{"terminal_id": "pos-1", "label": "Front counter"}'
# -> {"terminal_id":"pos-1","device_secret":"<shown once>"}

# every session: mint a short-lived token
curl -X POST https://<server>/api/v1/tokens \
  -H "Content-Type: application/json" \
  -d '{"label":"pos-1","client_id":"pos-1","client_secret":"<device_secret>","expiry_hours":24}'
```

`client_id` is the `terminal_id`. The tenant comes from the terminal's
registration, never the request body. These tokens bind the `terminal`
read preset server-side and **cannot self-elevate**.

**C. Desktop built-in mint** (scripts against your own register): the
Settings → Local API panel mints tokens in-process (same HS256 shape,
30-day default, full-read) — no admin key needed in the UI because the
Tauri command itself is permission-gated (`settings:edit`). Over HTTP on
that server, path A works with `X-Admin-Key` set to the per-install
secret (§2.2).

### 4.2 Token shape and lifecycle

Claims (`ApiTokenClaims` in `crates/oz-api/src/auth.rs`):
`sub` (label) · `jti` (token id, UUID v7) · `iat` / `exp` · `tenant_id?` ·
`terminal_id?` · `permissions?` (read-tier keys).

- Default expiry **24 h**; there is **no revocation list** — a leaked token
  is valid until `exp`. Mint short-lived tokens and re-mint.
- Validation cache TTL is 60 s: an expired token may pass up to 60 s past
  `exp` (documented tradeoff, API-2).

### 4.3 401 taxonomy (act on the code, not the message)

| `error` | Meaning | Client action |
|---|---|---|
| `missing_token` | no `Authorization: Bearer` header | fix config |
| `invalid_token` | signature/claims rejected | fix config |
| `token_expired` | past `exp` (± 60 s cache) | **re-mint** — the only refresh-worthy code |

All 401s carry `WWW-Authenticate: Bearer`.

## 5. Authorization tiers

### 5.1 Read tiers (spec 0047)

When a token carries `permissions`, every GET is checked against a static
route→key map (`READ_KEY_MAP` in `crates/oz-api/src/read_tiers.rs`); a
missing key returns **403 `insufficient_scope`**. A token *without* the
claim keeps full read (legacy).

| Key | Unlocks |
|---|---|
| `products:read` | products list/get, images get/pack/missing |
| `categories:read` | categories list |
| `reference:read` | exchange-rates reads |
| `plan:read` | `GET /api/v1/tenants/me/plan` |
| `sales:view` | `GET /api/v1/sales/{id}` (PII-marked) |
| `reports:view`, `analytics:view`, `audit:view` | registered keys used by the `dashboard`/`audit` presets — **no REST routes consume them yet** |

Presets: `terminal` = products+categories+reference+plan reads ·
`dashboard` = products+reports+analytics · `audit` = audit+reports.
Escape hatch `OZ_TERMINAL_READ_TIER=full` restores legacy terminal reads —
deprecated, removal after one release cycle.

### 5.2 Write tiers (D1 residual campaign)

Master-data writes require **both** a valid JWT **and** the `X-Admin-Key`
header (when configured), and reject terminal-scoped tokens outright
(`require_admin_write` in `routes/tokens.rs`):

- `POST /api/v1/products` · `PATCH /api/v1/products/{sku}/stock`
- `POST /api/v1/tax-rates` · `POST|DELETE /api/v1/exchange-rates…`
- `POST /api/v1/users`

Denials: 401 `invalid_admin_key` · 403 `insufficient_scope`.
**Sales are exempt by design** — a terminal token can create sales and move
sale status; that is the device's job.

## 6. Wire conventions

- **Money is always integer minor units.** JSON shape:
  `{"minor_units": 19900, "currency": "IDR"}`. Never floats. IDR/JPY/KRW
  have exponent 0 (minor unit *is* the rupiah/yen). Source:
  `foundation/src/money.rs`.
- **Rates:** tax in basis points (`rate_bps`, 1000 = 10 %). Exchange rates
  in 6-decimal fixed point (`rate_millionths`, 16000000 = 16.0).
- **Timestamps** ISO-8601 / RFC-3339. **IDs** UUID v7 strings.
- **Errors are currently flat:** `{"error": "machine_readable_or_message"}`.
  The spec declares a target `ErrorEnvelope`
  (`{"error":{"code","message","details"}}`) but the `oz-api` handlers all
  emit the flat form today — treat the flat string as the live contract and
  match on the stable codes seen in §4.3/§5.2.
- **No pagination yet.** List endpoints return flat arrays. The
  `limit`/`offset`/`sort`/`q` parameters and `PaginatedResponse` envelope in
  the OpenAPI components are forward-declared, not wired.
- **CORS** is an allowlist (`OZ_CORS_ORIGINS`; defaults to the website +
  Tauri origins). Empty ⇒ deny all cross-origin; `"*"` ⇒ dev opt-in.
- **Security headers** on every response: `nosniff`, `X-Frame-Options: DENY`,
  CSP `default-src 'self'`, HSTS in production.
- Cloud sync endpoints surface `X-RateLimit-Remaining` / `X-RateLimit-Reset`
  / `Retry-After` when nearing the per-tenant limit.

## 7. Recipes

**Get a token first (two paths).** Cloud / standalone playground: mint
over HTTP as in the recipes below (open in the dev playground; with
`X-Admin-Key: $OZ_ADMIN_KEY` in production). Desktop Local API: click
**Generate Token** in Settings → Local API — HTTP minting there requires
the per-install secret as `X-Admin-Key`, and the panel deliberately
never displays it. When scripts need the secret itself (HTTP minting,
master-data writes), read it from the global database:

```bash
sqlite3 "$APPDATA/com.ozpos.app/oz-pos.db" \
  "SELECT value FROM settings WHERE key='local_api.secret'"
```

The desktop server binds `127.0.0.1` only — use that literal IP in
scripts; `localhost` may resolve to `::1` first on IPv6-preferring
stacks, where nothing listens.

### 7.1 Python — read catalog, write a sale

```python
import requests

BASE = "http://127.0.0.1:3099/api/v1"  # desktop; or your cloud origin
ADMIN_KEY = "..."                      # dev playground: omit header;
                                       # desktop: the per-install secret
                                       # (see "Get a token first" above)

tok = requests.post(f"{BASE}/tokens",
    headers={"X-Admin-Key": ADMIN_KEY},
    json={"label": "python-script", "expiry_hours": 4}
    ).json()["token"]["token"]   # response nests TokenResponse under "token"
H = {"Authorization": f"Bearer {tok}"}

products = requests.get(f"{BASE}/products", headers=H).json()["products"]

sale = requests.post(f"{BASE}/sales", headers=H, json={"lines": [
    {"sku": "COFFEE-001", "qty": 2,
     "unit_price": {"minor_units": 19000, "currency": "IDR"}},
]}).json()
print(sale["id"], sale["status"])

# The sale state machine is Pending → Active → Completed (or
# Active → Voided); skipping a step returns 422.
requests.patch(f"{BASE}/sales/{sale['id']}/status", headers=H,
               json={"status": "active"})
requests.patch(f"{BASE}/sales/{sale['id']}/status", headers=H,
               json={"status": "completed"})
```

### 7.2 Node — stock watch (operator write needs the admin key too)

```js
const BASE = "http://127.0.0.1:3099/api/v1";
const H = { Authorization: `Bearer ${process.env.OZ_TOKEN}` };

const low = (await (await fetch(`${BASE}/products`, { headers: H })).json()).products
  .filter(p => p.stock_qty !== undefined && p.stock_qty <= 5);
console.table(low.map(p => [p.sku, p.stock_qty]));

// restock: operator-tier write — JWT + X-Admin-Key, terminal tokens rejected
await fetch(`${BASE}/products/${low[0].sku}/stock`, {
  method: "PATCH",
  headers: { ...H, "Content-Type": "application/json", "X-Admin-Key": process.env.OZ_ADMIN_KEY },
  body: JSON.stringify({ delta: 50 }),
});
```

### 7.3 curl — terminal lifecycle

```bash
HOST=http://127.0.0.1:3099   # or your cloud origin
ADMIN=...                    # OZ_ADMIN_KEY (cloud) / per-install secret (desktop, §7 intro)
SECRET=...                   # the client_secret returned by the register call

# register (once, operator)
curl -sX POST $HOST/api/v1/terminals -H "X-Admin-Key: $ADMIN" \
  -H 'Content-Type: application/json' -d '{"terminal_id":"kds-1"}'

# mint device token (recurring; binds terminal read preset automatically)
curl -sX POST $HOST/api/v1/tokens -H 'Content-Type: application/json' \
  -d '{"label":"kds-1","client_id":"kds-1","client_secret":"'$SECRET'","expiry_hours":6}'
```

### 7.4 Outbound webhooks (cloud surface)

The cloud server pushes events to your scripts — no polling. The
**desktop local API does not deliver webhooks** (a loopback POS gains no
unsolicited outbound path); scripts against §2.2 poll instead.

**Register an endpoint** (admin key, like token minting):

```bash
HOST=https://your-cloud.example.com   # or http://127.0.0.1:3099 (playground)
curl -sX POST $HOST/api/webhooks -H "X-Admin-Key: $ADMIN" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://scripts.example.com/oz-events","events":["complete_sale","stock.adjusted"]}'
# → 201 {"endpoint":{...,"id":"01a..."},"secret":"<32 hex>","note":"shown exactly once"}
```

`events` is the queue-action vocabulary — `complete_sale`, `void_sale`,
`refund_sale`, `product.created`, `stock.adjusted`, `stock.movement` —
or `["*"]` for all. Manage with `GET /api/webhooks` (secrets redacted)
and `DELETE /api/webhooks/{id}`.

**Events fire when terminals sync** (the push path), so they reflect
register activity — including offline work that syncs later. Sales
created directly through the REST API on cloud do not (v1 limitation).

**Delivery contract**: `POST` JSON

```json
{"id":"01event","type":"complete_sale","occurred_at":"2026-09-03T12:00:00Z",
 "tenant_id":"default","data":{ ...the synced item payload... }}
```

with headers `X-OZ-Event`, `X-OZ-Event-Id`, and
`X-OZ-Signature: sha256=<hex HMAC-SHA256(secret, raw body)>`. Your
receiver must answer 2xx within 10 s; anything else retries with
exponential backoff (2^n minutes, 5 attempts) and then dead-letters in
the outbox for operator inspection. Ordering is not guaranteed — dedupe
on `id`. (Backoff is `120 * 2^attempt` seconds, capped at 3600 s by
`BACKOFF_CAP_SECS` in `apps/cloud-server/src/outbox.rs:48` — the cap never binds inside
the 5-attempt budget, so the formula above is the whole story in practice.)

**Verify in Python** (Flask receiver):

```python
import hmac, hashlib
from flask import request, jsonify

@app.post("/oz-events")
def oz_events():
    body = request.get_data()                     # raw bytes, not parsed
    expected = "sha256=" + hmac.new(
        SECRET.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, request.headers.get("X-OZ-Signature", "")):
        return "bad signature", 401
    event = request.get_json()                    # {"id","type","occurred_at","data"}
    ...                                           # handle event["type"]
    return "", 200
```

Node is the same shape: `crypto.createHmac("sha256", secret)
.update(rawBody).digest("hex")` against the header, constant-time
compare.

### 7.5 Polling fallback

For surfaces without webhooks (desktop §2.2), poll
`POST /api/sync/pull` with a `since` cursor (cloud) to observe other
terminals' writes, or re-`GET /api/v1/sales/{id}` for a sale you track.

## 8. Lua plugins (in-process scripting)

For rules that must run **inside** the sale flow (discounts, per-line tax,
order validation), don't use the REST API — write a plugin. Sandboxed
(Lua 5.4, 100 000-instruction / 10 MiB limits, no fs/network), permission-
gated `oz` table, hooks like `sale.before_complete`, loaded from `plugins/`
at startup. Full reference: [plugin-guide.md](./plugin-guide.md); runtime
details: [crates/oz-lua/README.md](../../crates/oz-lua/README.md).

## 9. `oz` CLI (local batch scripting)

Migrations, backup/restore, CSV export, encrypted `.ozpkg` export/import,
and product/category/inventory/sale/customer/user CRUD straight against the
SQLite DB — the right tool for cron-style maintenance on the terminal
itself. Subcommand table and conventions (minor units, `--db`):
[crates/oz-cli/README.md](../../crates/oz-cli/README.md).

## 10. Known gaps (verified 2026-09-03)

Documented so scripts don't build on sand:

1. **Local API scope (desktop v1).** Desktop-only (the tablet app does
   not wire it yet). It serves **one store at a time** (primary by
   default, switchable in Settings; §2.2) — the same file the register
   UI reads (regression-tested: an API write is visible through the
   UI's connection path and never touches the global identity DB);
   `POST /api/v1/users` is therefore not the register's account store
   (see §2.2). API writes are audited into the served store's
   `audit_log`. Loopback-only: LAN exposure would need the
   `lan_server` PSK pattern first (§2.1).
2. **Reserved tags without paths** — Inventory/Orders/Reports/Customers/
   Notifications/Analytics appear in the spec's tag list but declare no
   operations.
3. **Webhook v1 limits** (cloud, §7.4) — events fire on the sync-push
   path only (REST-created sales don't emit); fan-out runs just after
   the push commits (a crash in that window loses the fan-out, not the
   data); no per-endpoint delivery history UI yet (outbox rows are the
   record).
4. **No token revocation** — keep `expiry_hours` short for third-party
   scripts.
5. **utoipa migration** (generating the spec from handler code) is recorded
   in spec 0047 as the eventual permanent fix; deliberately not done yet.

> **Repaired 2026-09-03** (same day these were first recorded here):
> **outbound webhooks are live on the cloud surface** (§7.4) — endpoint
> registry (`/api/webhooks`, admin-key gated), sync-push fan-out through
> the transactional outbox (ADR #43 D7 — `2026-09-02-adr43-cloud-sync-performance-scaleout-roadmap.md`;
> note `#43` is claimed by two ADRs, see `docs/decisions/README.md`), HMAC-SHA256 signed delivery with
> retry/backoff/dead-letter, and the PG outbox drainer wired (previously
> built but never started);
> the local terminal API is now **wired** — the desktop app embeds
> `oz_api::router()` on loopback behind Settings → Local API (§2.2), with
> stateful JWT validation (`auth_middleware_with_state`) so it signs with
> a per-install secret instead of the process env; the OpenAPI document
> moved to a **single source of truth** (`crates/oz-api/src/spec/`)
> with per-operation `x-oz-scope` tagging, served by the local API at
> `/api/openapi.json` and merged with cloud paths by the cloud server
> (§2.3);
> `GET|PUT /api/v1/settings`, `GET /api/sync/snapshot` and the three
> `/api/docs*` paths are now in the OpenAPI spec; the drift guard gained
> its router→spec direction (source-scan equality); and the spec's
> schema-level lies were corrected against code — terminal registration
> returns `device_secret` with 200 and **rotates** on re-register (was
> `secret`/201/409), `label` is optional, and the sync push/pull/status
> response schemas now match `PushResponse`/`PullResponse`/
> `SyncStatusResponse` as serialized.

---

**Related:** [plugin-guide.md](./plugin-guide.md) ·
[ARCHITECTURE.md](./ARCHITECTURE.md) ·
[spec 0047](../specs/_active/0047-openapi-drift-guard-and-read-tiers.md) ·
[oz-api README](../../crates/oz-api/README.md)

> last audited 08-09-26 by DSH
