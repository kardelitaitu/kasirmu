<!-- Audit stamp: 2026-09-29 · docs-auditor · status: ACCURATE — 0 findings, no repairs needed · Audited on branch 0.0.40. This is a Future Plan (2026-09-02), so its falsifiable surface is its references and its security model, not its proposals. All three related documents resolve: ADR #43 is `docs/decisions/2026-09-02-adr43-cloud-sync-performance-scaleout-roadmap.md`, Spec 0046b is `docs/specs/_active/0046b-product-menu-images.md`, and Spec 0047 is `docs/specs/_active/0047-openapi-drift-guard-and-read-tiers.md` — the last is cited in §8 without its `_active/` prefix, which still reads correctly in context. The env-var names in §5.2 (`OZ_API_SECRET`, `OZ_ADMIN_KEY`) match what the servers actually read, consistent with the `OZ_*` finding recorded against AGENTS.md elsewhere in this campaign. · ONE THING I CHECKED BECAUSE IT LOOKED LIKE A FINDING, AND WAS NOT: §5.2 says the relay does not know "the Stripe/Square webhook secrets", while the codebase's dominant providers are Paddle and Midtrans. That reads like a leftover from an earlier payment design, so I counted providers across the tree — stripe appears in 57 files, square in 45, paddle in 50, midtrans in 78. All four are present, so the security inventory is accurate rather than stale, and the relay design is unaffected: the claim is that the relay holds NONE of them, which holds regardless of which providers are live. Recorded because "this looked wrong and I was about to file it" is exactly the reasoning error this skill warns about, and the check cost one command. · The caching table in §3.1 is internally consistent and its security reasoning is sound: the tenant-aware cache key (`$uri|tenant:{tenant_id}`) with base64 JWT-claim decoding and no signature verification is correctly paired with an explicit, bounded risk acceptance in §3.2, and the table marks every write endpoint as never-cacheable. The forged-JWT cache-poisoning attack in §5.3 is named rather than glossed over, which is rare and good. · NOT re-measured: the endpoint paths against the live server, the Cloudflare DNS layout, and the VPS sizing, which are deployment facts outside the repository. The hostnames are illustrative. · No stamp or footer existed on this file before this pass. -->

# 0049 — Edge Relay Network

**Status:** Future Plan  
**Author:** Architecture Team  
**Date:** 2026-09-02  
**Depends on:** ADR #43 (origin optimisations), Spec 0046b (content-addressed images)

---

## 1. Motivation

The Northflank origin (`license.ozpos.my.id`, 0.2 vCPU / 512 MB) handles all terminal traffic today. A cluster of cheap, disposable VPSes ($1–2/mo, 2c/4GB/40GB SSD each) placed geographically closer to terminals can:

- **Absorb the bulk of request volume** — cache images, snapshots, and status responses so the tiny origin only sees cache misses + writes.
- **Lower latency** — terminals connect to a nearby relay instead of a distant Northflank DC.
- **Provide resilience** — if one relay disappears, the next in the list takes over, and the origin is the final fallback.
- **Cost almost nothing** — each VPS is disposable, holds no secrets, needs no persistent storage beyond a cache directory.

---

## 2. Architecture

### 2.1 Subdomain layout

```
relay1.ozpos.my.id  ──→ VPS #1  (35.xxx.1)
relay2.ozpos.my.id  ──→ VPS #2  (35.xxx.2)
relay3.ozpos.my.id  ──→ VPS #3  (35.xxx.3)
relay4.ozpos.my.id  ──→ VPS #4  (35.xxx.4)
     │
     │  (Cloudflare DNS — each A record points to its VPS IP)
     │
     ▼
license.ozpos.my.id  ──→ Northflank origin (app + PG + PocketBase)
```

- **Cloudflare** handles DNS + TLS termination (Flexible SSL mode for the VPSes, Full (strict) for the origin).
- **Relays** listen on HTTP port 80 behind Cloudflare.
- **Origin** terminates its own TLS or sits behind Cloudflare Full Strict.

### 2.2 Terminal configuration

Each terminal holds an **ordered fallback list:**

```
relay1.ozpos.my.id  →  relay2  →  relay3  →  relay4  →  license.ozpos.my.id
```

The terminal tries the first relay; if it fails (timeout, 5xx, connection refused), it moves to the next. If all relays fail, the origin serves as the final fallback. The terminal probes the current relay's `/health` endpoint periodically and rotates on failure.

### 2.3 Relay anatomy

```text
Cloudflare (TLS) ──→ Port 80
                        │
                    Caddy / Nginx
                        │
                    ┌───────────────┐
                    │  Cache (disk)  │  ← hot paths
                    │  40 GB SSD     │
                    └───────────────┘
                        │  (miss or pass-through)
                        ▼
                  Northflank origin
                  license.ozpos.my.id:3099
```

Each relay runs **one stateless container** — no database, no secrets, no persistent state beyond the cache directory. The origin URL is the only config (not a secret — just a DNS name).

---

## 3. Caching strategy

### 3.1 What to cache and how

| Endpoint | Cache | Cache key | TTL | Rationale |
|---|---|---|---|---|
| `GET /api/v1/images/{hash16}` | ✅ | `$uri` | 365d | Content-addressed → immutable; same hash = same bytes across all tenants. No auth bypass risk (image is already distributable by hash). |
| `GET /api/v1/images:pack?hashes=…` | ✅ | `$request_uri` | 365d | Same reasoning — hash-keyed. |
| `GET /api/v1/images:missing?hashes=…` | ✅ | `$request_uri` | 30s | Short TTL; hash-keyed, but missing-set changes over time. |
| `GET /api/sync/snapshot` | ⚠️  | See §3.2 below | 15min | Per-tenant, ETag/304 already at origin. Cache MUST be tenant-aware. |
| `GET /api/sync/status` | ✅ | `$uri + tenant_id` | 60s | Per-tenant, but the response is small and stable. Cache at relay with tenant-aware key. |
| `POST /api/sync/push` | ❌ | — | — | Write — never cache. |
| `POST /api/sync/pull` | ❌ | — | — | Write — never cache. |
| `POST /api/v1/tokens` | ❌ | — | — | Write — never cache. |
| `POST /api/v1/products`, `tax-rates`, `users`, etc. | ❌ | — | — | Write — never cache. |

### 3.2 Snapshot caching — the hard problem

The snapshot endpoint (`/api/sync/snapshot`) is:

```
GET /api/sync/snapshot
Authorization: Bearer <JWT>
```

The JWT contains `tenant_id` in its payload (base64-encoded, readable without verification). The response body is the full reference data snapshot for that tenant. The response includes `ETag` (hash of the body).

**The problem:** two different tenants call the same URL with different JWT. A dumb cache that keys by URL alone would serve Tenant A's snapshot to Tenant B — a data leak.

**The solution — Phase 2 (see §4):** the relay extracts `tenant_id` from the JWT payload (base64-decode, no signature verify — the origin validates) and uses it as part of the cache key:

```
cache_key = "$uri|tenant:{tenant_id}"
```

The relay also stores the `ETag` from the previous origin response. On a cache hit (stale-while-revalidate):

1. Relay serves the cached bytes immediately (fast).
2. Relay forwards `If-None-Match: <stored_etag>` to the origin in the background.
3. If origin returns 304 → refresh TTL, keep serving cached.
4. If origin returns 200 → update cache, next request gets fresh bytes.

This model gives terminals **instant local responses** while the origin still controls freshness. The relay never verifies JWT signatures — it only reads the tenant_id claim (base64, no secret). If an attacker forges a JWT claiming tenant X, the relay would cache under that key, but the origin would reject the forged JWT on revalidation, so the poison is limited to the cache window (and the relay would serve stale bytes only to requests that also claim tenant X — which requires the attacker to mint a valid-looking JWT, which they can't without the signing key).

**Risk accepted:** a relay that caches per-tenant data without signature verification can be poisoned by a forged JWT claiming a known tenant_id. The poison window is bounded by the cache TTL (15 min) and the attacker cannot read other tenants' data — only serve their own forged data to other requests claiming the same tenant. For an edge cache fronting product catalogs, this is acceptable. A more conservative deployment can skip snapshot caching and only cache images (Phase 1).

### 3.3 Status endpoint

`GET /api/sync/status` returns `{ "pending_count": N, "heartbeat_interval_secs": M }`. This is per-tenant, small, and stable over 60s. Cache the same way as snapshots (tenant-aware key, short TTL, revalidate).

---

## 4. Phased rollout

### Phase 1 — Static relay (images + passthrough)

**Effort:** 1 hour (Docker setup + DNS)

- Deploy Caddy/Nginx on one VPS.
- Cache images only (content-addressed → safe).
- Everything else pass-through to origin.
- No tenant-aware caching — relay is ignorant of JWT.
- Terminal config: one relay URL, fallback to origin.
- **Verification:** images load from cache (check `X-Cache: HIT`); writes still go to origin.

### Phase 2 — Tenant-aware snapshot + status cache

**Effort:** 2–3 hours (custom relay config or small Go helper)

- Add JWT payload parsing (base64 decode, extract `tenant_id`, no crypto).
- Cache key includes tenant_id for snapshot and status.
- Stale-while-revalidate pattern for snapshot.
- The relay logic can be:
  - A small Lua script in Nginx (OpenResty) reading JWT from Authorization header.
  - A small Go/Rust sidecar that the relay calls to decide cache keys.
  - Or a purpose-built minimal relay in Rust (avoids adding Lua to the stack).
- **Verification:** snapshot 304 responses served locally; origin sees fewer snapshot requests.

### Phase 3 — Multi-relay + health-based fallback

**Effort:** 1–2 hours (terminal config + DNS)

- Deploy 2–4 VPSes, each with the same relay container.
- Add a `/health` endpoint to the relay that returns `200 OK` and optionally cache hit-rate.
- Terminals rotate through the relay list, health-checking before sending traffic.
- DNS: `relay1-4.ozpos.my.id` → A records to VPS IPs.
- **Verification:** kill a relay → terminal moves to the next within one heartbeat cycle.

### Phase 4 — Observability

**Effort:** 1–2 hours

- Each relay exposes Prometheus metrics on a separate port (cache hit/miss, request latency, origin latency).
- The origin (`license.ozpos.my.id`) optionally scrapes relay metrics and aggregates them.
- Cache-hit-rate dashboard: aim for > 90% on images, > 70% on snapshot.

---

## 5. Security model

### 5.1 What the relay knows

- The origin URL (a DNS name — not a secret).
- The domain name of the relay itself (for caching).
- *Nothing else.* No database passwords, no API keys, no JWT signing secrets, no tenant data beyond what it caches in memory/disk.

### 5.2 What the relay does NOT know

- The JWT signing secret (`OZ_API_SECRET`).
- The admin key (`OZ_ADMIN_KEY`).
- The database URL or credentials.
- The Stripe/Square webhook secrets.

### 5.3 Attack surface

| Attack | Impact | Mitigation |
|---|---|---|
| Relay is compromised (root access) | Attacker can read cached snapshot data (product catalogs, user lists — not financial data, as sales go through POST). | Relay holds no keys. Rotate by replacing the VPS. |
| Relay is compromised, attacker modifies cache | Can serve poisoned images or snapshot data to terminals. | Terminal re-validates on sync; origin's ETag mismatch triggers a full refresh within one cycle. |
| DNS hijack of relay subdomain | Traffic goes to attacker's server. | Terminals authenticate via JWT signed by the origin; attacker cannot mint valid JWTs. |
| Forged JWT poisons tenant cache | Attacker claims tenant X, relay caches under tenant X, next legitimate X request gets poisoned snapshot. | Poisoned data is served only to requests claiming tenant X. The origin revalidates on cache-miss (stale-while-revalidate limits window). Attack requires knowing a valid tenant_id (not a secret — tenant_id is in the JWT the terminal already has). |

---

## 6. Non-goals (explicitly out of scope)

- **Relay talks to PostgreSQL directly.** The relay is a dumb cache, not a database proxy. All reads go through the application.
- **Relay terminates TLS.** Cloudflare handles TLS termination. The relay listens on plain HTTP behind Cloudflare's Flexible SSL. This keeps the relay secret-free and simplifies deployment.
- **Relay has its own authentication.** The relay does not authenticate terminals — it forwards the Authorization header to the origin. Authentication is the origin's job.
- **Relay is sticky / session-aware.** Requests are independent; any relay can serve any tenant. No session affinity needed.

---

## 7. Open questions

1. **Which relay proxy software?** Nginx (built-in `proxy_cache`, no custom build) vs Caddy (needs `cache-handler` plugin, custom Docker image) vs a purpose-built minimal relay in Rust/Go. Nginx is the simplest for Phase 1; a purpose-built relay may be needed for Phase 2's JWT parsing.
2. **DNS resolution on relays?** The relay needs to resolve `license.ozpos.my.id` at runtime. Should it use a resolver (e.g. `resolver 1.1.1.1;` in Nginx) or be configured with a static IP? Static IP is simpler but requires updating if the origin moves.
3. **Cache eviction policy?** 40 GB SSD with 30-day inactivity eviction for images; 15-min TTL for snapshot. Should we add a `/purge` endpoint (authenticated by a shared secret — but that's a secret) or just let TTL do its job?
4. **Do we need HTTP/2 or HTTP/3 on the relay?** Terminals may benefit from multiplexed connections. Cloudflare already supports HTTP/2/3 to the terminal; the relay only needs HTTP/1.1 to the origin.
5. **How many relays before diminishing returns?** For a terminal base of ~200–500, 2–4 relays provide good coverage. Beyond that, adding more relays reduces each one's cache hit rate (same tenants spread across more nodes).

---

## 8. Related documents

- ADR #43 — Cloud Sync Performance & Scale-Out Roadmap (origin optimisations)
- Spec 0046b — Product & Menu-Item Image Support (content-addressed image store)
- Spec 0047 — OpenAPI Drift Guard & JWT Read Tiers

> last audited 29-09-26 by docs-auditor