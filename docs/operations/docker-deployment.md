# Docker Deployment Guide — Full-Stack kasir.mu

<!-- Audit stamp: 2026-08-31 · docs-auditor · status: ACCURATE (structural claims + all references verified) · verified against HEAD: all 4 services defined in ops/docker/docker-compose*.yml (pos-cloud-server/license-server/redis/pos-cloud-db); ports 3099/8080 match prod compose; scripts/generate-license-keys.{sh,ps1}, ops/docker/Dockerfile.server, apps/license-server/Dockerfile exist; ADR #10 + #11 links resolve with correct numbers. Scope: structural/reference claims verified; step-by-step deployment procedures not exhaustively executed · Repaired 12-09-26 (DSH, consistency vs 14a31a31f + license-server auth code): OZ_ADMIN_KEY added to every required-vars list (the compose `:?` default made the old "empty = dev mode open" row false); new admin-key / dev-fallback / OZ_PRODUCTION section — OZ_PRODUCTION is read by the cloud server only and appears in no compose artifact -->

> **ADR:** [ADR #11](../decisions/2026-07-13-zero-downtime-vps-migration.md)
> **Status:** Implemented (2026-07-20)
> **Target audience:** DevOps / system administrators

This guide covers deploying the complete kasir.mu backend stack using Docker
Compose: cloud server, license server, Redis cache, and optional PostgreSQL.

---

## Architecture Overview

```
                   ┌─────────────────────────────────────┐
                   │         Docker Compose (one host)     │
                   │                                       │
  POS Terminal ───►│  pos-cloud-server  (port 3099)       │
                   │        │                              │
                   │        ├──► redis (cache + pub/sub)   │
                   │        │                              │
                   │        └──► pos-cloud-db (PostgreSQL) │
                   │                     (optional, PG)    │
                   │                                       │
  POS Terminal ───►│  license-server    (port 8080)        │
                   │         │                              │
                   │         └──► (embedded SQLite)         │
                   └─────────────────────────────────────┘
```

### Service Summary

| Service | Language | Port | Purpose | DB |
|---------|----------|------|---------|----|
| `pos-cloud-server` | Rust | 3099 | Sync API, auth, webhooks | SQLite or PostgreSQL |
| `license-server` | Go | 8080 | License activation, renewal | Embedded SQLite (PocketBase) |
| `redis` | — | 6379 | Product cache, inventory pub/sub | In-memory (persistent RDB) |
| `pos-cloud-db` | — | 5432 | Enterprise database backend | PostgreSQL 16 (optional) |

### Port Map

| Port | Service | Protocol | Notes |
|------|---------|----------|-------|
| `3099` | pos-cloud-server | HTTP | Sync API + health endpoint |
| `8080` | license-server | HTTP | License API + PocketBase admin UI (`/_/`) |
| `6379` | redis | TCP | Redis protocol (internal only in production) |
| `5432` | pos-cloud-db | TCP | PostgreSQL protocol (internal only in production) |

---

## Quick Start (SQLite)

The fastest way to get the full stack running with no external dependencies:

```bash
# 1. Generate license keys (one time)
bash scripts/generate-license-keys.sh        # Linux/macOS
powershell -File scripts/generate-license-keys.ps1   # Windows

# 2. Export required secrets (Compose fails closed if absent — DOCKER-04)
export OZ_API_SECRET=$(openssl rand -hex 32)
export OZ_ADMIN_KEY=$(openssl rand -hex 32)
export OZ_LICENSE_PRIVATE_KEY="$(cat crates/kasirmu-core/oz-license-private.pem)"

# 3. Start all services
docker compose --project-directory . -f ops/docker/docker-compose.yml up -d

# 4. Verify health
curl http://localhost:3099/api/v1/health
curl http://localhost:8080/api/v1/license/status

# 5. Create admin user for license server
docker compose --project-directory . -f ops/docker/docker-compose.yml exec license-server \
  /pb/pocketbase superuser upsert admin@example.com password123

# 6. View logs
docker compose --project-directory . -f ops/docker/docker-compose.yml logs -f
```

The cloud server starts with SQLite (default) and connects to Redis at
`redis://redis:6379`. The license server uses embedded PocketBase SQLite.

`OZ_API_SECRET`, `OZ_ADMIN_KEY` and `OZ_LICENSE_PRIVATE_KEY` are required by Compose and
startup fails at parse time when any is missing, so the stack never boots with
an empty or well-known authentication secret.

### Step-by-Step

1. **Generate license signing keys** — These are required by the license
   server to sign subscription tokens. The script saves the private key
   to `crates/kasirmu-core/oz-license-private.pem`.

2. **Export secrets** — `OZ_API_SECRET` (JWT signing), `OZ_ADMIN_KEY`
   (admin/mint gate) and `OZ_LICENSE_PRIVATE_KEY` (license signing) are
   required. `docker compose --project-directory . -f ops/docker/docker-compose.yml up` fails fast with a clear message if any is
   unset.

3. **Start the stack** — `docker compose --project-directory . -f ops/docker/docker-compose.yml up -d` starts `pos-cloud-server`,
   `license-server`, and `redis` in the default profile. The cloud server
   waits for Redis to be healthy before starting. The license server starts
   immediately (no external dependencies).

3. **Create admin user** — The PocketBase admin UI at `http://localhost:8080/_/`
   needs a superuser. Use the `docker compose --project-directory . -f ops/docker/docker-compose.yml exec` command above.

4. **Health check** — Both services expose health endpoints:

   | Service | Endpoint | Response |
   |---------|----------|----------|
   | Cloud server | `GET /api/v1/health` | `{"status":"ok","version":"0.0.13",...}` |
   | License server | `GET /api/health` | `{"status":"ok","db_connected":true,"uptime_secs":...}` |

5. **Test license activation** — Once running, activate a license:

   ```bash
   curl -X POST http://localhost:8080/api/v1/license/activate \
     -H "Content-Type: application/json" \
     -d '{"key":"OZ-PRO-TEST-ABCD-EFGH-IJKL","tenant_id":"t1","machine_id":"m1"}'
   ```

---

## With PostgreSQL (Enterprise)

For production deployments requiring PostgreSQL instead of SQLite:

```bash
# 1. Generate keys
bash scripts/generate-license-keys.sh

# 2. Set required env vars
export OZ_API_SECRET=$(openssl rand -hex 32)
export OZ_ADMIN_KEY=$(openssl rand -hex 32)
export OZ_LICENSE_PRIVATE_KEY="$(cat crates/kasirmu-core/oz-license-private.pem)"
export PG_PASSWORD=$(openssl rand -hex 32)

# 3. Start with the pg override (PG_PASSWORD is required — DOCKER-04)
docker compose --project-directory . -f ops/docker/docker-compose.yml -f ops/docker/docker-compose.pg.yml up -d

# 4. Verify all services healthy
curl http://localhost:3099/api/v1/health
curl http://localhost:8080/api/v1/license/status
```

Environment variables for PostgreSQL:

| Variable | Default | Description |
|----------|---------|-------------|
| `PG_USER` | `ozpos` | PostgreSQL user |
| `PG_PASSWORD` | *(required)* | PostgreSQL password — Compose fails fast if unset |
| `PG_DATABASE` | `ozpos` | PostgreSQL database name |
| `DATABASE_URL` | *(auto-constructed)* | Full connection string |

When the `pg` override is merged, the cloud server connects to PostgreSQL
via the auto-constructed `DATABASE_URL` and waits for it to be healthy
before starting (`depends_on: pos-cloud-db: condition: service_healthy`).

---

## Production Hardening Profile (DOCKER-07)

For a deployment-grade posture, merge `ops/docker/docker-compose.prod.yml` on top of
the base stack. It never changes the developer defaults — it is a separate
profile that only applies when explicitly requested:

```bash
export OZ_API_SECRET=$(openssl rand -hex 32)
export OZ_ADMIN_KEY=$(openssl rand -hex 32)
export OZ_LICENSE_PRIVATE_KEY="$(cat crates/kasirmu-core/oz-license-private.pem)"
docker compose --project-directory . -f ops/docker/docker-compose.yml -f ops/docker/docker-compose.prod.yml up -d
```

| Hardening | Base stack | `+ ops/docker/docker-compose.prod.yml` |
|-----------|-----------|-----------------------------|
| Root filesystem | writable | **read-only** (+ tmpfs `/tmp`, writable volumes) |
| Capabilities | default | **drop ALL** except `CHOWN, SETUID, SETGID` |
| `no-new-privileges` | off | **on** (`security_opt`) |
| PID namespace | default | **`init: true`** (zombie reaping) |
| Resource limits | none | **CPU/memory caps** per service |
| Redis port 6379 on host | published | **internal only** (private network) |
| PostgreSQL port 5432 on host | published | **internal only** (private network) |
| Public API ports (3099/8080) | published | published (unchanged) |

`pos-cloud-db` in `ops/docker/docker-compose.pg.yml` carries the same hardening
directly, so the PostgreSQL path is secure whether or not the prod profile
is merged.

---

## Reverse Proxy & TLS (Caddy)

kasir.mu services speak **plain HTTP** — they are designed to sit behind a
reverse proxy that terminates TLS. This is the supported production
pattern; the stack itself never terminates TLS:

```
internet ── 443/TLS ──► reverse proxy ──► pos-cloud-server :3099
                        (Caddy)     └──► license-server   :8080
```

Any proxy works (nginx, Caddy, Traefik). Caddy is recommended because it
obtains and renews Let's Encrypt certificates automatically and has no
runtime dependencies (its healthcheck-style probes are built in).

### 1. Bind the app ports to localhost only

Once the proxy is in front, the app ports no longer need to be reachable
from the network. Bind them to the loopback interface so the proxy is the
only thing exposed to the host firewall:

```yaml
# Shown as an override file: save it as ops/docker/docker-compose.override.yml
# (or any name you like) and pass it as a SECOND -f — Compose no longer merges
# an override implicitly once the base file is named with -f:
#   docker compose --project-directory . -f ops/docker/docker-compose.yml #     -f ops/docker/docker-compose.override.yml up -d
# NOTE: `ports` is a multi-value key, so an
# override APPENDS to the base list unless tagged `!override` — without
# the tag you would publish both 0.0.0.0:3099 and 127.0.0.1:3099 and the
# second bind would fail. `!override` REPLACES the base bindings.
services:
  pos-cloud-server:
    ports: !override
      - "127.0.0.1:3099:3099"
  license-server:
    ports: !override
      - "127.0.0.1:8080:8080"
```

### 2. Start Caddy

Copy and edit the example config in
[`ops/gateway/Caddyfile.example`](https://github.com/kardelitaitu/kasirmu/blob/main/ops/gateway/Caddyfile.example) — replace
`example.com` with your real domains:

```bash
sudo cp ops/gateway/Caddyfile.example /etc/caddy/Caddyfile
sudo systemctl restart caddy        # distro package
```

Or run Caddy in Docker on the same Compose network (upstreams then resolve
by service name, as in the example file):

```bash
docker run -d --name oz-caddy \
  --network oz-pos_default \
  -p 80:80 -p 443:443 \
  -v /etc/caddy/Caddyfile:/etc/caddy/Caddyfile \
  -v caddy_data:/data \
  -v caddy_config:/config \
  caddy:2
```

> **Host-run Caddy:** if Caddy runs directly on the host instead of inside
> the Compose network, change the `reverse_proxy` upstreams to
> `127.0.0.1:3099` and `127.0.0.1:8080`.

### 3. Point clients at the HTTPS base URL

After TLS is live, configure POS terminals to use the `https://` base URL
of the proxy (`https://api.example.com`) instead of the raw `http://` host
ports. TLS is transparent to the backend services — they keep speaking
plain HTTP to the proxy, so no server-side configuration changes are
needed.

> **Private / non-public deployments:** if the host has no Let's Encrypt
> reachable DNS name (e.g. a VPN-only install), use `:443` as the site
> address with `tls internal` in Caddy and distribute Caddy's CA
> certificate to clients. The `ops/gateway/Caddyfile.example` file documents
> this in its header comment.

---

## Environment Variables Reference

### Required in Production

| Variable | Default | Service | Description |
|----------|---------|---------|-------------|
| `OZ_API_SECRET` | *(required)* | pos-cloud-server | JWT signing secret. Generate: `openssl rand -hex 32`. Compose fails fast if unset |
| `OZ_ADMIN_KEY` | *(required)* | pos-cloud-server | Admin key gating `POST /api/v1/tokens` and the plan admin endpoint (ADR sync-auth-hardening P2). Generate: `openssl rand -hex 32`. Compose fails at parse time if unset (`:?`, DOCKER-04) — unset is no longer "dev mode, endpoints open" |
| `OZ_LICENSE_PRIVATE_KEY` | *(required)* | license-server | PEM-encoded license signing private key. Generate with `scripts/generate-license-keys.*`. Compose fails fast if unset |
| `PG_PASSWORD` | *(required, pg override)* | pos-cloud-db | PostgreSQL password. Required only when `ops/docker/docker-compose.pg.yml` is merged |

### Optional

| Variable | Default | Service | Description |
|----------|---------|---------|-------------|
| `OZ_API_PORT` | `3099` | pos-cloud-server | HTTP listen port |
| `RUST_LOG` | `info` | pos-cloud-server | Log level (debug, info, warn, error) |
| `OZ_DB_PATH` | `/data/kasir.db` | pos-cloud-server | SQLite database path |
| `REDIS_URL` | `redis://redis:6379` | pos-cloud-server | Redis connection string |
| `REDIS_CACHE_TTL` | `300` | pos-cloud-server | Redis cache TTL (seconds) |
| `DATABASE_URL` | _(empty)_ | pos-cloud-server | PostgreSQL connection string |
| `OZ_ADMIN_KEY` | _(unset)_ | license-server | Bearer key for the Go server's admin API (`admin_dashboard.go`). **Not** passed through by `ops/docker/docker-compose.yml`, so on this stack key auth is closed (every bearer 401s); admin access is an admin-tenant web session. Empty/whitespace behaves the same — fail-closed, never "unset = open" |
| `OZ_ADMIN_EMAIL` | _(unset)_ | license-server | Admin tenant email anchoring the web-session admin path. Unset = the compiled-in fallback address is used — see the dev-fallback section below for a check |
| `OZ_ENFORCE_PLANS` | _(empty)_ | pos-cloud-server | When `1`/`true`/`on`, sync requests from tenants on the `free` plan (or with no plan row) are rejected with `403 {"error":"plan_required"}`. Unset = gating off (dev mode) |
| `PG_USER` | `ozpos` | pos-cloud-db | PostgreSQL user |
| `PG_DATABASE` | `ozpos` | pos-cloud-db | PostgreSQL database name |

---

## Admin Keys, `OZ_PRODUCTION`, and the Dev Fallback

### What an empty admin key does (per service)

- **pos-cloud-server** — `OZ_ADMIN_KEY` is parse-time **required** in
  `ops/docker/docker-compose.yml` (`${OZ_ADMIN_KEY:?...}`, DOCKER-04, since `14a31a31f`).
  An operator who sets nothing gets a compose error, not the old dev-mode open
  mint — the table row that said "empty (unset) = dev mode, endpoints stay
  open" described pre-`14a31a31f` behaviour and has been removed.
- **license-server** — the Go server reads `OZ_ADMIN_KEY`
  (`admin_dashboard.go:52`), but compose does not pass it through, so on this
  stack every `Authorization: Bearer` attempt against the admin API is
  answered 401 (`adminKeyOK` returns false when the configured key is empty or
  whitespace). An empty key is fail-closed here too — it is never treated as
  "unset = open". Server-to-server admin calls need the key passed through
  explicitly; otherwise admin access is the admin-tenant web session.

### The compiled-in dev fallback, and a check you can run

The fallback exists for local development: with `OZ_API_SECRET` unset and
`OZ_PRODUCTION` not enabled, the cloud server signs JWTs with the hard-coded
`oz-pos-dev-secret-change-in-production` constant
(`crates/kasirmu-api/src/auth.rs`) and prints a one-time WARNING containing
"dev signing secret" to its log. In the Compose stack the fallback is
unreachable (`OZ_API_SECRET` is parse-time required) — but verify the running
deployment rather than trusting the compose file:

```bash
docker compose --project-directory . -f ops/docker/docker-compose.yml logs pos-cloud-server | grep 'dev signing secret'
# no output  = a real secret is in use
# a WARNING  = the deployment is running on the compiled-in fallback
```

The Go license-server has no secret fallback (an unset `OZ_ADMIN_KEY` just
closes key auth, above), but it does compile in a fallback admin **identity**
(`defaultAdminEmail`, used whenever `OZ_ADMIN_EMAIL` is unset). `/api/health`
reports which one authentication anchors on:

```bash
curl -s http://localhost:8080/api/health | jq '.admin.source'
# "env"      = the deployment named its admin address via OZ_ADMIN_EMAIL
# "fallback" = admin auth anchors on the address compiled into the binary —
#              set OZ_ADMIN_EMAIL (and provision the matching tenants row) to fix it
```

### `OZ_PRODUCTION`

`OZ_PRODUCTION` is read by the cloud server (`crates/kasirmu-api/src/lib.rs`,
`apps/cloud-server/src/config.rs` — fail-closed boot unless both secrets are
set, implies DB TLS) but it appears in **no artifact of this guide**:
`ops/docker/docker-compose.yml` does not pass it through (neither does
`ops/docker/docker-compose.prod.yml`), and the Go license-server ignores it entirely.
The Compose stack gets its fail-closed guarantee from the `:?`
required-variable syntax instead; an operator who wants the flag must add it
to the service environment via an override file. Where the flag *is* set in
production, see the Northflank runbook ([`runbook.md`](./runbook.md) §6.2).

---

## Healthcheck Dependencies

The ops/docker/docker-compose.yml defines the following healthcheck chain:

```
redis (healthy)
  │
  └──► pos-cloud-server (waits for redis + optional PG)
         │
         └──► pos-cloud-db (only when pg profile active, required: false)
               │
               └──► depends_on: condition: service_healthy

license-server (no dependencies — standalone)
```

Key design decisions:
- **`depends_on` with `condition: service_healthy`** — The cloud server
  waits for Redis (and PostgreSQL when active) to pass healthchecks before
  starting. This prevents startup race conditions.
- **`required: false` on `pos-cloud-db`** — The pg profile is optional.
  When inactive, the dependency is ignored and the cloud server uses SQLite.
- **`license-server` has no `depends_on`** — It uses embedded SQLite
  (PocketBase) and starts immediately.

### Healthcheck Details

| Service | Test Command | Interval | Timeout | Retries | Start Period |
|---------|-------------|----------|---------|---------|-------------|
| pos-cloud-server | `wget --spider /api/v1/health` | 15s | 5s | 3 | 30s |
| license-server | `/pb/healthcheck /api/health` | 15s | 5s | 3 | 10s |
| redis | `redis-cli ping` | 10s | 3s | 5 | 5s |
| pos-cloud-db | `pg_isready -U ozpos -d ozpos` | 10s | 5s | 5 | 15s |

---

## Volume Management

| Volume | Service | Mount Point | Purpose |
|--------|---------|-------------|---------|
| `oz_cloud_data` | pos-cloud-server | `/data` | SQLite database + WAL files |
| `pb_data` | license-server | `/pb/pb_data` | PocketBase embedded SQLite |
| `redis_data` | redis | `/data` | Redis RDB persistence |
| `oz_pg_data` | pos-cloud-db | `/var/lib/postgresql/data` | PostgreSQL data directory |

### Backup Commands

```bash
# Backup SQLite database
docker run --rm -v oz_cloud_data:/data -v $(pwd):/backup alpine \
  cp /data/kasir.db /backup/oz-pos-$(date +%Y%m%d).db

# Backup PocketBase database
docker run --rm -v pb_data:/pb -v $(pwd):/backup alpine \
  cp /pb/pb_data/data.db /backup/pb-data-$(date +%Y%m%d).db
```

### Cleanup

```bash
# Stop and remove containers (preserves volumes)
docker compose --project-directory . -f ops/docker/docker-compose.yml down

# Stop and remove everything (DESTROYS DATA)
docker compose --project-directory . -f ops/docker/docker-compose.yml down -v
```

---

## Networking

All services are on the default Compose network (`oz-pos_default`). They
resolve each other by service name:

| Service | Internal hostname | Port |
|---------|-------------------|------|
| pos-cloud-server | `pos-cloud-server` | 3099 |
| license-server | `license-server` | 8080 |
| redis | `redis` | 6379 |
| pos-cloud-db | `pos-cloud-db` | 5432 |

### Internal Communication Examples

- Cloud server → Redis: `redis://redis:6379`
- Cloud server → PostgreSQL: `postgresql://ozpos:changeme@pos-cloud-db:5432/ozpos`
- Terminal → Cloud server: `http://pos-cloud-server:3099` (within Docker network)
- Terminal → License server: `http://license-server:8080` (within Docker network)

---

## Logs & Monitoring

```bash
# All services
docker compose --project-directory . -f ops/docker/docker-compose.yml logs -f

# Single service
docker compose --project-directory . -f ops/docker/docker-compose.yml logs -f pos-cloud-server
docker compose --project-directory . -f ops/docker/docker-compose.yml logs -f license-server

# Tail last 100 lines
docker compose --project-directory . -f ops/docker/docker-compose.yml logs --tail=100 pos-cloud-server
```

---

## Common Operations

### Add a License

```bash
# Create a license in PocketBase
curl -X POST http://localhost:8080/api/v1/license/activate \
  -H "Content-Type: application/json" \
  -d '{"key":"OZ-PRO-ABCD-EFGH-IJKL","tenant_id":"tenant_1","machine_id":"pos-01"}'
```

### View Redis Cache Stats

```bash
docker compose --project-directory . -f ops/docker/docker-compose.yml exec redis redis-cli INFO stats
```

### Run Migrations Manually

```bash
docker compose --project-directory . -f ops/docker/docker-compose.yml exec pos-cloud-server /app/oz-cloud-server --migrate
```

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `pos-cloud-server` exits immediately | Missing `OZ_API_SECRET` | Set the env var |
| `license-server` exits immediately | Missing `OZ_LICENSE_PRIVATE_KEY` | Run `scripts/generate-license-keys.*` and set the env var |
| Cloud server can't connect to Redis | Redis not healthy yet | Check `docker compose --project-directory . -f ops/docker/docker-compose.yml logs redis`; wait for healthcheck |
| `redis-cli ping` fails | Redis not responding | `docker compose --project-directory . -f ops/docker/docker-compose.yml restart redis` |
| License activation returns 401 | Wrong or missing private key | Regenerate keys |
| Port 3099 already in use | Another service using the port | Set `OZ_API_PORT=3100` and update firewall |
| Port 8080 already in use | Another service using the port | Edit `ops/docker/docker-compose.yml` port mapping |
| Can't access PocketBase admin UI | No superuser created | Run the `superuser upsert` command |
| Slow product lookups | Redis cache cold | Wait for cache to warm up (first requests are slower) |
| `docker compose --project-directory . -f ops/docker/docker-compose.yml -f ops/docker/docker-compose.pg.yml up` fails | `PG_PASSWORD` not set or `pos-cloud-db` unavailable | Export `PG_PASSWORD` (required) and ensure `redis` is healthy |
| `docker run -e OZ_DB_PATH=/tmp/...` fails inside the container with `unable to open database file: C:/Users/...` | Git Bash rewrote the POSIX path into a Windows path before Docker saw it | Prefix the command with `MSYS_NO_PATHCONV=1` (see [Git Bash on Windows](#git-bash-on-windows-path-mangling-msys_no_pathconv)) |

---

## Git Bash on Windows: Path Mangling (`MSYS_NO_PATHCONV`)

When running `docker run` from **Git Bash** (MSYS2) on Windows, the shell
silently rewrites command-line arguments that look like POSIX paths into
Windows paths before handing them to native programs (like `docker.exe`).
This corrupts any path that is meant to be interpreted **inside the Linux
container**:

```bash
# BROKEN — Git Bash rewrites /tmp/test.db into a Windows path
$ docker run -e OZ_DB_PATH=/tmp/test.db oz-pos-cloud
# → failed to initialise database: SQLite error: unable to open database
#   file: C:/Users/<you>/AppData/Local/Temp/test.db
```

Git Bash maps `/tmp` to your Windows temp directory, so the container
receives `C:/Users/<you>/AppData/Local/Temp/test.db` — a relative path
whose parent directories do not exist inside the Linux filesystem, which
SQLite reports as `unable to open database file`. The same mangling
applies to bind mounts (`-v /path:/container/path`) and any other
path-looking argument.

**Fixes:**

| Approach | Command |
|----------|---------|
| Disable conversion for one command | `MSYS_NO_PATHCONV=1 docker run -e OZ_DB_PATH=/tmp/test.db ...` |
| Double the leading slash (MSYS leaves `//tmp` alone) | `docker run -e OZ_DB_PATH=//tmp/test.db ...` |
| Use a container-internal path that does not start with `/` | `docker run -e OZ_DB_PATH=data.db ...` (relative to the workdir) |
| Avoid `docker run` entirely | Use `docker compose` — YAML values are never shell-mangled |

> Note: `ops/docker/docker-compose.yml` values are **not** affected — Compose passes
> them through directly, so the shipped `OZ_DB_PATH=/data/kasir.db`
> (see the environment table above) works from any shell. The gotcha only
> bites ad-hoc `docker run` invocations typed into Git Bash. Prefer
> `MSYS_NO_PATHCONV=1` as the one-shot fix.

---

## Security Notes

1. **Set strong secrets** — `PG_PASSWORD` is required (no default) in
   `ops/docker/docker-compose.pg.yml`; `OZ_API_SECRET`, `OZ_ADMIN_KEY` and
   `OZ_LICENSE_PRIVATE_KEY` are required in the base stack. Compose fails at
   parse time when any of them is absent, so a stack never boots with an
   empty/well-known secret.

2. **Do not expose Redis or PostgreSQL ports externally** — Set
   `ports: ["6379:6379"]` only for local development. In production,
   remove the port mapping or bind to `127.0.0.1`.

3. **Use secrets for sensitive env vars** — Prefer your orchestrator's
   secret store (Northflank secret group — runbook §8) over plain env vars.
   The app reads its secrets as **env strings only** — it does not read
   Docker secret files, so the `secrets:` + `/run/secrets/...` file-mount
   pattern does not apply. Compose's required-variable syntax (already used
   in `ops/docker/docker-compose.yml`) fails fast when a secret is missing:

   ```yaml
   environment:
     OZ_API_SECRET: "${OZ_API_SECRET:?OZ_API_SECRET is required}"
   ```

4. **TLS termination** — These services speak HTTP. Use a reverse proxy
   (nginx, Caddy, Traefik) in front for TLS termination in production.
   See [Reverse Proxy & TLS (Caddy)](#reverse-proxy--tls-caddy).

5. **License private key** — Treat `oz-license-private.pem` as a
   critical secret. Store it in a password manager or secrets vault.
   If compromised, all existing licenses are invalidated.

---

## Related

- [VPS Migration Guide](./vps-migration.md) — Zero-downtime server migration
- [ADR #11: VPS Migration Strategy](../decisions/2026-07-13-zero-downtime-vps-migration.md)
- [ADR #10: Sync Performance Strategy](../decisions/2026-07-13-sync-performance-compression-batching.md)
- [`ops/docker/Dockerfile.server`](https://github.com/kardelitaitu/kasirmu/blob/main/ops/docker/Dockerfile.server) — Cloud server Docker build
- [`apps/license-server/Dockerfile`](https://github.com/kardelitaitu/kasirmu/blob/main/apps/license-server/Dockerfile) — License server Docker build
- [`scripts/generate-license-keys.sh`](https://github.com/kardelitaitu/kasirmu/blob/main/scripts/generate-license-keys.sh) — License key generation

> last audited 31-08-26 by docs-auditor
