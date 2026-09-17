<!-- Audit stamp: 2026-08-31 · docs-auditor · status: MAJOR-DRIFT REPAIRED (supersedes Hermes-Agent 07-24 "0 findings") · the PostgreSQL section had gone stale against apps/cloud-server/src/db.rs: (1) "TLS is not currently supported / tokio_postgres::NoTls / all connections unencrypted / planned future enhancement" was FALSE — TLS now ships via rustls (db.rs:205-226), honouring `sslmode` in DATABASE_URL, with OZ_DB_REQUIRE_TLS=1 (implied by OZ_PRODUCTION=1) enforcing sslmode=require fail-closed (config.rs resolve_require_tls); Neon/Supabase/RDS are therefore supported, so the provider table's "not supported yet" rows were corrected; (2) "pool size: 8 connections" is now configurable via OZ_DB_POOL_SIZE (default 8). Still accurate: OZ_DB_PATH defaults kasir.db, DATABASE_URL postgres://|postgresql:// detection, /health + /metrics, and the DuckDNS terminal↔server TLS note (a separate concern). The old stamp's line-number citations (90/87/52) had all shifted and were dropped. -->

# VPS Migration Guide — Zero-Downtime Server Migration

**ADR:** [#11](../decisions/2026-07-13-zero-downtime-vps-migration.md)
**Status:** Implemented (2026-07-15)
**Target audience:** DevOps / system administrators

This guide walks through migrating `oz-cloud-server` to a new VPS with zero
manual reconfiguration on POS terminals. Every step is labelled with which
server to run it on.

---

## Quick Reference: The 3-Layer Strategy

```
Layer 1 — DNS (Primary, same domain)
  Clients connect via domain (e.g. sync.ozpos.com).
  Update the A record → clients follow automatically on next DNS TTL expiry.

Layer 2 — Server Auto-Redirect (Secondary, domain change)
  Old server returns {"error":"server_migrated","new_url":"https://new.com"}
  Client auto-updates its local sync_server_url and reconnects.

Layer 3 — Manual UI (Safety net, always available)
  Settings → Cloud Sync → Server URL input field.
```

---

## Getting a Domain (Free Option: DuckDNS)

Every POS terminal connects to the cloud server via a **domain name** —
never a raw IP address. This allows DNS-based migration (Layer 1) and
TLS/HTTPS for secure communication.

If you don't have a paid domain, you can use a free dynamic DNS service
like **[DuckDNS](https://www.duckdns.org)**. It gives you a permanent
subdomain (e.g., `my-ozpos.duckdns.org`) that always points to your VPS,
even if the IP address changes.

### Step 1: Register on DuckDNS

1. Go to [duckdns.org](https://www.duckdns.org)
2. Sign in with GitHub, Google, or Twitter (no separate account needed)
3. Create a subdomain — e.g., `my-ozpos` → full domain: `my-ozpos.duckdns.org`
4. Enter your VPS IP address in the `current ip` field
5. Click **update ip**

Your free domain is now live. Test it:

```bash
curl http://my-ozpos.duckdns.org:3099/health
# Should reach your VPS and return {"status":"ok",...}
```

### Step 2: Point POS terminals to the DuckDNS domain

When configuring POS terminals set the **Server URL** to your DuckDNS
subdomain:

```
http://my-ozpos.duckdns.org:3099
```

> ℹ️ **HTTP vs HTTPS:** DuckDNS does not provide TLS certificates. For
> production, run a reverse proxy (nginx, Caddy) on the VPS to terminate
> TLS with a free Let's Encrypt certificate. Without TLS, traffic between
> terminals and the server is unencrypted.

### Step 3: Keep the IP updated (VPS with dynamic IP)

If your VPS provider assigns a **dynamic IP** that changes periodically,
set up an auto-update job so the DuckDNS domain always points to the
correct address.

**Option A — Cron job (every 5 minutes):**

```bash
# Add to crontab (crontab -e)
*/5 * * * * curl -s "https://www.duckdns.org/update?domains=my-ozpos&token=YOUR_TOKEN&ip=" > /dev/null
```

Replace `my-ozpos` with your subdomain and `YOUR_TOKEN` with the token
shown on your DuckDNS dashboard.

**Option B — Systemd timer (more reliable):**

Create `/etc/systemd/system/duckdns-update.service`:

```ini
[Unit]
Description=DuckDNS IP updater
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/curl -s "https://www.duckdns.org/update?domains=my-ozpos&token=YOUR_TOKEN&ip="
```

Create `/etc/systemd/system/duckdns-update.timer`:

```ini
[Unit]
Description=DuckDNS IP update timer

[Timer]
OnCalendar=*-*-* *:0/5:00
Persistent=true

[Install]
WantedBy=timers.target
```

Enable and start:

```bash
sudo systemctl enable duckdns-update.timer
sudo systemctl start duckdns-update.timer
```

**Option C — DuckDNS container (Docker):**

```bash
docker run -d \
  --name duckdns \
  --restart unless-stopped \
  -e SUBDOMAINS=my-ozpos \
  -e TOKEN=YOUR_TOKEN \
  linuxserver/duckdns
```

### Step 4: Verify the auto-update is working

```bash
# Check the DuckDNS update log
curl "https://www.duckdns.org/update?domains=my-ozpos&token=YOUR_TOKEN&verbose=true"
# Response: OK (IP updated) or KO (no change needed)
```

### Using DuckDNS with the Migration Scenarios

| Scenario | How DuckDNS fits |
|----------|-----------------|
| **Scenario A** (same domain) | Update the DuckDNS IP to the new VPS. No paid domain needed — the DuckDNS subdomain is your permanent address. |
| **Scenario B** (domain change) | Register a second DuckDNS subdomain for the new server (e.g., `my-ozpos-v2.duckdns.org`). Use Layer 2 auto-redirect to move terminals from the old subdomain to the new one. |

The same 3-layer strategy applies regardless of whether you use a paid
domain or a free DuckDNS subdomain.

### Alternative Free Dynamic DNS Providers

DuckDNS is recommended for simplicity, but these alternatives also work:

| Provider | Subdomain format | Notes |
|----------|-----------------|-------|
| [DuckDNS](https://duckdns.org) | `name.duckdns.org` | Simplest setup. No account required — just OAuth login. |
| [No-IP](https://www.noip.com) | `name.ddns.net` | Free tier requires monthly confirmation. |
| [FreeDNS](https://freedns.afraid.org) | `name.mooo.com` | Many domain options. More complex UI. |
| [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) | Your own domain | Free, but requires a paid domain on Cloudflare. Excellent for production. |

---

## Database: SQLite vs PostgreSQL

The cloud server supports two database backends. The migration steps
differ depending on which one you use.

| Backend | Env var | Default | Migration step |
|---------|---------|---------|---------------|
| **SQLite** | `OZ_DB_PATH` | `/data/kasir.db` | `scp` the `.db` file to the new VPS |
| **PostgreSQL** | `DATABASE_URL` | (none) | Point the new server at the same PG instance — no file copy needed |

### SQLite (default)

The simplest setup. A single file on disk stores everything. During
migration, you must copy this file from the old VPS to the new VPS.

```bash
docker run -d \
  --name oz-cloud-server \
  -p 3099:3099 \
  -v oz-data:/data \
  -e OZ_DB_PATH=/data/kasir.db \
  oz-pos-cloud:latest
```

**Pros:** Zero external dependencies. **Cons:** Must copy the file during
migration. Single point of failure (the VPS disk).

### PostgreSQL (DATABASE_URL)

When `DATABASE_URL` is set and starts with `postgres://` or
`postgresql://`, the server connects to a managed PostgreSQL instance
using `deadpool-postgres` (pool size configurable via `OZ_DB_POOL_SIZE`, default 8).

```bash
docker run -d \
  --name oz-cloud-server \
  -p 3099:3099 \
  -e DATABASE_URL=postgres://user:pass@host:5432/ozpos \
  -e OZ_API_SECRET=<your-secret> \
  oz-pos-cloud:latest
```

**Connection string format:**

```
postgres://<user>:<password>@<host>:<port>/<database>
postgresql://<user>:<password>@<host>:<port>/<database>
```

> 🔒 **TLS is supported via rustls.** The connection honours the `sslmode`
> parameter in `DATABASE_URL` (`disable` | `prefer` | `require`; default
> `prefer`), so a local plaintext Postgres keeps working while production
> sets `sslmode=require` for an encrypted connection. Root certificates come
> from the platform trust store (`ca-certificates` in the container image).
> Set `OZ_DB_REQUIRE_TLS=1` (implied by `OZ_PRODUCTION=1`) to make startup
> fail closed unless `DATABASE_URL` specifies `sslmode=require`, preventing a
> silent plaintext fallback. TLS-required providers (Neon, Supabase, RDS) are
> therefore supported.

**Managed PostgreSQL providers compatible with kasir.mu:**

| Provider | Free tier | Connection string (example) |
|----------|-----------|----------------------------|
| [Neon](https://neon.tech) | Yes — 0.5 GB | TLS required — append `?sslmode=require` to the connection string |
| [Supabase](https://supabase.com) | Yes — 500 MB | TLS required — append `?sslmode=require` to the connection string |
| [AWS RDS](https://aws.amazon.com/rds/) | No (pay-as-you-go) | `postgres://user:pass@ozpos.xyz.us-east-1.rds.amazonaws.com:5432/ozpos?sslmode=require` |
| [Railway](https://railway.app) | Yes — $5 credit | `postgres://postgres:pass@containers-us-west-xyz.railway.app:5432/ozpos` |
| Self-hosted (same VPS) | N/A | `postgres://user:pass@localhost:5432/ozpos` |
| Self-hosted (private network) | N/A | `postgres://user:pass@10.0.0.5:5432/ozpos` |

**How migration changes with PostgreSQL:**

| Step | SQLite | PostgreSQL |
|------|--------|-----------|
| Copy database | `scp` the `.db` file | **Not needed** — both servers point to the same PG instance |
| Verify data | `sqlite3` query | `psql` or any PG client |
| Downtime | Brief (file copy) | **Zero** — the database is never moved |
| Rollback | Restore `.db` from backup | Point old server back at PG |

Because the database lives outside both VPSes, PostgreSQL migrations are
faster and safer. The old and new servers can even run simultaneously
against the same PG instance during the transition.

> ⚠️ **When using PostgreSQL, do NOT set `OZ_DB_PATH`** — it will be
> ignored in favor of `DATABASE_URL`.

---

## Data Transfer: Moving the SQLite Database

> PostgreSQL users can skip this section — with `DATABASE_URL`, both
> servers connect to the same managed instance and no file transfer is
> needed. See the PostgreSQL section above.

These steps cover downloading the database from the old VPS and uploading
it to the new VPS. Choose the method that works for your setup.

### Step 1: Prepare the Old VPS

**Stop the cloud server** on the old VPS first — SQLite does not tolerate
copying a live database file from a running process.

```bash
# On the old VPS
docker stop oz-cloud-server
```

**Flush WAL to the main database file.** kasir.mu enables SQLite WAL mode
(`journal_mode=WAL`), which means recent writes may be in separate `-wal`
and `-shm` files. Run a checkpoint to merge them into the `.db` file:

```bash
# On the old VPS
sqlite3 /data/kasir.db "PRAGMA wal_checkpoint(TRUNCATE);"
# Expected output: 0|0|0 (all pages checkpointed, WAL truncated)
```

After this, you only need to copy the `.db` file — the `-wal` and `-shm`
files (if they exist) can be ignored.

**Locate the database file.** The default path is `/data/kasir.db`. If you
used a custom `OZ_DB_PATH`, check your `docker run` command or env file.

```bash
# Confirm the file exists and note its size
ls -lh /data/kasir.db
# Example: -rw-r--r-- 1 ozpos ozpos 142M Jul 15 10:30 /data/kasir.db
```

### Step 2: Transfer the Database

Choose one of the methods below.

**Method A — Direct SCP (simplest, VPSes can reach each other):**

```bash
# On the old VPS: push the database to the new VPS
scp /data/kasir.db user@<new-vps-ip>:/data/kasir.db
```

**Method B — Pull via SCP from the new VPS:**

```bash
# On the new VPS: pull the database from the old VPS
scp user@<old-vps-ip>:/data/kasir.db /data/kasir.db
```

**Method C — Rsync (faster for large databases, supports resume):**

```bash
# On the old VPS — rsync with progress and compression
rsync -avz --progress /data/kasir.db user@<new-vps-ip>:/data/kasir.db
```

**Method D — Compressed tar over SSH (largest databases, slow connections):**

```bash
# On the old VPS: tar + gzip the database and pipe it directly to the new VPS
tar czf - /data/kasir.db | ssh user@<new-vps-ip> "tar xzf - -C /"
```

This compresses the file in transit — useful for databases over 500 MB or
slow network links.

**Method E — Cloud storage as intermediate (VPSes can't reach each other):**

If the old and new VPSes are on isolated networks (no direct SSH), use an
S3 bucket, Google Drive, or Dropbox as a temporary transfer point.

```bash
# On the old VPS: upload to S3
aws s3 cp /data/kasir.db s3://my-bucket/oz-pos-backup.db

# On the new VPS: download from S3
aws s3 cp s3://my-bucket/oz-pos-backup.db /data/kasir.db
```

Or with `rclone` (supports Google Drive, Dropbox, S3, and 40+ providers):

```bash
# On the old VPS
rclone copy /data/kasir.db gdrive:/backups/

# On the new VPS
rclone copy gdrive:/backups/kasir.db /data/
```

### Step 3: Verify Database Integrity

> ℹ️ **Prerequisite:** Install `sqlite3` on both VPSes if not already present:
> ```bash
> sudo apt install sqlite3 -y    # Debian/Ubuntu
> sudo yum install sqlite -y     # RHEL/CentOS
> ```

Run these checks on **both** the old VPS (before transfer) and the new VPS
(after transfer) to ensure data is intact and identical.

#### A. File-Level Check

```bash
# On both VPSes — compare file sizes
ls -lh /data/kasir.db

# Generate a SHA-256 checksum on the old VPS, then compare on the new VPS
# On the old VPS:
sha256sum /data/kasir.db | tee /tmp/old-checksum.txt
# Copy the checksum file alongside the database
scp /tmp/old-checksum.txt user@<new-vps-ip>:/tmp/

# On the new VPS:
sha256sum -c /tmp/old-checksum.txt
# Expected: /data/kasir.db: OK
```

If the checksums don't match, the file was corrupted during transfer —
try a different transfer method (rsync or tar+SSH).

#### B. Structural Integrity

```bash
# Run on both VPSes — must return "ok"
sqlite3 /data/kasir.db "PRAGMA integrity_check;"

# Check foreign key integrity
sqlite3 /data/kasir.db "PRAGMA foreign_key_check;"
# Expected: (no rows — zero violations)
```

If `foreign_key_check` returns rows, the database has orphaned references.
Each row shows the table, rowid, and parent table that is missing.

#### C. Row Count Comparison

Run these on **both** VPSes and compare the counts. They must match
exactly.

```bash
# On the old VPS — dump counts to a file
sqlite3 /data/kasir.db <<'EOF' > /tmp/old-counts.txt
.mode column
.headers on
SELECT 'products'        AS tbl, COUNT(*) AS cnt FROM products
UNION ALL
SELECT 'settings',        COUNT(*) FROM settings
UNION ALL
SELECT 'offline_queue',   COUNT(*) FROM offline_queue
UNION ALL
SELECT 'users',           COUNT(*) FROM users
UNION ALL
SELECT 'tax_rates',       COUNT(*) FROM tax_rates
UNION ALL
SELECT 'stock_movements', COUNT(*) FROM stock_movements
UNION ALL
SELECT 'stock_summary',   COUNT(*) FROM stock_summary;
EOF

# Copy to new VPS and compare
scp /tmp/old-counts.txt user@<new-vps-ip>:/tmp/

# On the new VPS — generate the same report and diff
sqlite3 /data/kasir.db <<'EOF' > /tmp/new-counts.txt
.mode column
.headers on
SELECT 'products'        AS tbl, COUNT(*) AS cnt FROM products
UNION ALL
SELECT 'settings',        COUNT(*) FROM settings
UNION ALL
SELECT 'offline_queue',   COUNT(*) FROM offline_queue
UNION ALL
SELECT 'users',           COUNT(*) FROM users
UNION ALL
SELECT 'tax_rates',       COUNT(*) FROM tax_rates
UNION ALL
SELECT 'stock_movements', COUNT(*) FROM stock_movements
UNION ALL
SELECT 'stock_summary',   COUNT(*) FROM stock_summary;
EOF

diff /tmp/old-counts.txt /tmp/new-counts.txt
# No output = identical counts. Any differences need investigation.
```

> 💡 If any table has a different count, the old server may have written
> new data after the transfer. Re-run the WAL checkpoint and re-transfer.

#### D. Application-Level Sanity Checks

Quick queries that verify key business data is readable and consistent.

> 💡 Adjust table and column names to match your schema if you have
> custom modules installed.

```bash
sqlite3 /data/kasir.db <<'EOF'
-- Every stock_movement must reference a valid product
SELECT COUNT(*) FROM stock_movements sm
  LEFT JOIN products p ON sm.sku = p.sku
  WHERE p.sku IS NULL;
-- Expected: 0 (no orphaned movements)

-- Sync queue should not have stuck items
SELECT COUNT(*) FROM offline_queue
  WHERE status = 'pending' AND retry_count > 10;
-- Stuck items may need manual review

-- Settings table should have rows (not empty)
SELECT COUNT(*) FROM settings;
-- Expected: > 0 (empty = migration likely failed)

-- Quick product count sanity check
SELECT COUNT(*) FROM products;
-- Should match your known inventory size
EOF
```

#### E. Set Permissions

```bash
# On the new VPS — ensure container user can read/write
chown 1000:1000 /data/kasir.db   # if UID 1000 is the ozpos user
chmod 644 /data/kasir.db
```

#### F. Quick Start & Health Check

After your migration scenario's restart step completes, smoke-test that
the server starts correctly with the migrated database:

```bash
# On the new VPS — check health (server should already be restarted)
curl http://localhost:3099/health
# Should return 200 with version info

# Check the server logs for migration-related errors
docker logs oz-cloud-server 2>&1 | tail -20
# Look for: "database opened and migrations applied"
# NOT: "panic", "corrupt", "FATAL"
```

### Step 4: Restart the Old Server (if needed)

If the old server needs to keep running (Scenario B — redirect-only mode),
restart it. For Scenario A (same domain), you can leave it stopped.

```bash
# Scenario B: restart old server in redirect-only mode
# Scenario A: leave it stopped — you'll shut it down permanently after migration
```

> ⚠️ **Do NOT restart the old server in normal mode** after copying the
> database to the new VPS. Data written to the old server after the copy
> will be lost unless you repeat the transfer.

### Common Issues

| Issue | Cause | Solution |
|-------|-------|---------|
| `PRAGMA integrity_check` returns errors | Copy was interrupted or file was in use | Re-checkpoint WAL and re-copy |
| File size is 0 on new VPS | Transfer failed silently | Retry with `rsync -avz --progress` to see progress |
| "Permission denied" on new VPS | Container user (ozpos, UID 1000) can't read the file | `chown 1000:1000 /data/kasir.db` |
| `scp` connection refused | Firewall blocking port 22 | Use Method E (cloud storage) or open firewall temporarily |
| Database has `-wal` file > 0 bytes | WAL wasn't checkpointed | Run `PRAGMA wal_checkpoint(TRUNCATE);` before copying |

---

## Data Transfer: Migrating PostgreSQL Between Instances

> SQLite users: see the [SQLite Data Transfer](#data-transfer-moving-the-sqlite-database) section above.

If you use `DATABASE_URL` and need to move the database to a **different**
PostgreSQL instance (e.g., switching from self-hosted to AWS RDS, or
migrating between providers), follow this section.

If both old and new VPSes connect to the **same** PG instance, no data
migration is needed — skip this section and just point the new server at
the same `DATABASE_URL`.

### Step 1: Stop Writes on the Old VPS

Stop the old cloud server to prevent new data from being written during
the migration.

```bash
# On the old VPS
docker stop oz-cloud-server
```

### Step 2: Dump the Old Database

Use `pg_dump` to export the entire database from the old PG instance.
Install `postgresql-client` if not present (`apt install postgresql-client`).

```bash
# Export from the old PG instance (custom format, compressed, with schema + data)
pg_dump \
  --dbname=postgres://user:pass@old-pg-host:5432/ozpos \
  --format=custom \
  --compress=9 \
  --file=/tmp/ozpos-migration.dump

# Note the file size
ls -lh /tmp/ozpos-migration.dump
```

**Alternative: Plain SQL dump** (easier to inspect, less efficient for large DBs):

```bash
pg_dump \
  --dbname=postgres://user:pass@old-pg-host:5432/ozpos \
  --format=plain \
  --no-owner \
  --no-acl \
  --file=/tmp/ozpos-migration.sql
```

### Step 3: Transfer the Dump File

Same transfer methods as SQLite — choose one:

```bash
# Direct SCP (push from old VPS to new VPS)
scp /tmp/ozpos-migration.dump user@<new-vps-ip>:/tmp/

# Or pull from the new VPS
# On the new VPS:
scp user@<old-vps-ip>:/tmp/ozpos-migration.dump /tmp/

# Or via cloud storage (if VPSes can't reach each other)
aws s3 cp /tmp/ozpos-migration.dump s3://my-bucket/  # from old
aws s3 cp s3://my-bucket/ozpos-migration.dump /tmp/  # to new
```

### Step 4: Restore to the New Database

Create an empty database on the new PG instance, then restore.

```bash
# On the new VPS — create the database (if not already created)
psql postgres://user:pass@new-pg-host:5432/postgres \
  -c "CREATE DATABASE ozpos;"

# Restore from the dump file (custom format)
pg_restore \
  --dbname=postgres://user:pass@new-pg-host:5432/ozpos \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --jobs=4 \
  /tmp/ozpos-migration.dump

# For plain SQL format, use psql instead:
# psql postgres://user:pass@new-pg-host:5432/ozpos < /tmp/ozpos-migration.sql
```

> ⚠️ **`--clean --if-exists`** drops existing tables before restoring.
> Only use this on a fresh/empty target database. For production,
> restore into a new empty database first, verify, then switch.

### Step 5: Verify on the New Database

```bash
# Row counts on old PG (before dump)
psql postgres://user:pass@old-pg-host:5432/ozpos <<'EOF'
SELECT 'products'        AS tbl, COUNT(*) FROM products
UNION ALL SELECT 'settings', COUNT(*) FROM settings
UNION ALL SELECT 'offline_queue', COUNT(*) FROM offline_queue
UNION ALL SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'tax_rates', COUNT(*) FROM tax_rates
UNION ALL SELECT 'stock_movements', COUNT(*) FROM stock_movements
UNION ALL SELECT 'stock_summary', COUNT(*) FROM stock_summary;
EOF

# Same query on new PG — counts must match exactly
psql postgres://user:pass@new-pg-host:5432/ozpos <<'EOF'
SELECT 'products'        AS tbl, COUNT(*) FROM products
UNION ALL SELECT 'settings', COUNT(*) FROM settings
UNION ALL SELECT 'offline_queue', COUNT(*) FROM offline_queue
UNION ALL SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'tax_rates', COUNT(*) FROM tax_rates
UNION ALL SELECT 'stock_movements', COUNT(*) FROM stock_movements
UNION ALL SELECT 'stock_summary', COUNT(*) FROM stock_summary;
EOF
```

### Step 6: Point the New Server at the New Database

Update the `DATABASE_URL` on the new VPS to point at the new PG instance:

```bash
# Stop, update env, restart
docker stop oz-cloud-server
docker rm oz-cloud-server

docker run -d \
  --name oz-cloud-server \
  -p 3099:3099 \
  -e DATABASE_URL=postgres://user:pass@new-pg-host:5432/ozpos \
  -e OZ_API_SECRET=<your-secret> \
  oz-pos-cloud:latest
```

### Step 7: Verify the Server Starts Correctly

```bash
curl http://localhost:3099/health
docker logs oz-cloud-server 2>&1 | tail -20
# Look for: "PostgreSQL database connected and tables initialised"
```

### Row Count Comparison Table

Before finalizing, record row counts from both instances:

```
Table             Old PG          New PG          Match?
─────────────────────────────────────────────────────────
products          ______          ______          [ ]
settings          ______          ______          [ ]
offline_queue     ______          ______          [ ]
users             ______          ______          [ ]
tax_rates         ______          ______          [ ]
stock_movements   ______          ______          [ ]
stock_summary     ______          ______          [ ]
```

---

## Pre-Migration Preparation

Complete these checks before starting any migration scenario. Each item
prevents a common failure mode.

### 1. Back Up the Database

```bash
# On the old VPS — create a dated backup
cp /data/kasir.db /data/oz-pos-backup-$(date +%Y%m%d-%H%M%S).db
ls -lh /data/oz-pos-backup-*.db
```

For PostgreSQL:
```bash
pg_dump --dbname=postgres://user:pass@host:5432/ozpos \
  --format=custom --file=/tmp/ozpos-pre-migration.dump
```

### 2. Verify SSH Access to Both VPSes

```bash
# Test SSH to new VPS from old VPS
ssh user@<new-vps-ip> "echo OK"

# Test SSH to old VPS from new VPS (for scp pull method)
ssh user@<old-vps-ip> "echo OK"
```

If SSH is blocked by firewalls, plan to use cloud storage as an
intermediate transfer (Method E in the Data Transfer section).

### 3. Check Domain Provider Access

- Log into your DNS provider (Cloudflare, Route53, DuckDNS, etc.)
- Confirm you can edit DNS records
- Note the current TTL values (lower to 60s during migration)
- For DuckDNS: verify your token is accessible (`curl https://www.duckdns.org/update?domains=...&token=...`)

### 4. Test the New Server Build

Build and health-check the cloud server on the new VPS **before** the
migration window:

```bash
# On the new VPS — build and start with a temporary port
cd oz-pos
docker build -f Dockerfile.server -t oz-pos-cloud:latest .
docker run -d --name oz-cloud-test -p 3099:3099 oz-pos-cloud:latest
sleep 5
curl http://localhost:3099/health
docker stop oz-cloud-test && docker rm oz-cloud-test
```

This catches build failures, missing dependencies, or port conflicts
before you start the real migration.

### 5. Install Required Tools on Both VPSes

```bash
# Debian/Ubuntu
sudo apt update && sudo apt install -y sqlite3 postgresql-client

# RHEL/CentOS
sudo yum install -y sqlite postgresql
```

- `sqlite3` — for SQLite integrity checks and WAL checkpoint
- `psql` / `pg_dump` / `pg_restore` — for PostgreSQL migration

### 6. Notify Store Managers (if applicable)

Send a brief heads-up before the migration window:

> "The cloud sync server will be migrated on [date] at [time]. No
downtime is expected — POS terminals will continue working normally.
If any terminal shows 'Connection Error' during the migration, it will
auto-recover within a few minutes."

### 7. Prepare a Rollback Plan

Before starting, write down:
- Old VPS IP address: `________`
- New VPS IP address: `________`
- Current DNS record value: `________`
- Database backup path: `/data/oz-pos-backup-________.db`
- Rollback command ready:
  ```bash
  # Quick DNS rollback command (fill in before starting)
  curl -X PUT "https://api.cloudflare.com/..." -d '...'
  ```

### Pre-Migration Checklist

```
□ Database backed up (dated file exists)
□ SSH access confirmed to both VPSes
□ Domain provider access confirmed
□ New server builds and /health returns 200
□ sqlite3 installed on both VPSes
□ pg_dump/pg_restore/psql installed (if using PostgreSQL)
□ Store managers notified
□ Rollback plan documented
□ Migration window scheduled (low-traffic period)
```

---

## Scenario A: Same Domain (Layer 1 — DNS)

Use when the sync server domain stays the same (e.g., `sync.ozpos.com`).

### On the New Server

**1. Deploy the cloud server**

```bash
# Build and run with Docker
docker build -f Dockerfile.server -t oz-pos-cloud:latest .
docker run -d \
  --name oz-cloud-server \
  -p 3099:3099 \
  -v oz-data:/data \
  -e OZ_API_SECRET=<your-secret> \
  -e RUST_LOG=info \
  oz-pos-cloud:latest
```

> **Note:** If running without Docker, the binary is built via `cargo build --package oz-cloud-server --release` and produces `target/release/oz-cloud-server`. Defaults: `OZ_API_PORT=3099`, `OZ_DB_PATH=/data/kasir.db`.

**2. Verify the new server is healthy**

```bash
curl https://<new-vps-ip>:3099/health
# Expected: {"status":"ok","version":"0.0.9","uptime_seconds":12,...}
```

**3. Transfer the database**

- **SQLite users:** Follow the [SQLite Data Transfer](#data-transfer-moving-the-sqlite-database) section.
- **PostgreSQL users:** If moving PG instances, follow the [PostgreSQL Data Transfer](#data-transfer-migrating-postgresql-between-instances) section. If both VPSes point to the same PG instance, skip this step.

**4. Restart the new server**

After the database file is in place, restart the server so it picks up
the transferred database:

```bash
docker restart oz-cloud-server
```

### On the Old Server

**5. Update DNS**

Go to your domain provider (Cloudflare, Route53, etc.) and:
- Change the `A`/`AAAA` record for `sync.ozpos.com` to the new VPS IP address
- Set TTL to **60 seconds** during the migration window
- Save the old IP — you'll need it for rollback

**6. Verify DNS propagation**

```bash
# Run from multiple locations to check propagation
dig sync.ozpos.com +short
# Should return the new VPS IP

# Or test with curl once propagated:
curl https://sync.ozpos.com/health
# Should return 200 from the new server
```

**7. Monitor old server traffic**

```bash
# On the old server — watch for declining sync requests
tail -f /var/log/oz-cloud-server.log | grep "POST /api/sync"
```

Once traffic drops to zero (typically within 1–6 hours with a 60s TTL),
all active terminals have migrated.

**8. Shut down the old server**

```bash
# After confirming zero traffic for 24 hours
docker stop oz-cloud-server && docker rm oz-cloud-server
```

> ⚠️ **Keep a snapshot/backup of the old database** before shutting down, in case
> rollback is needed. See the Rollback section below.

---

## Scenario B: Domain Change (Layer 2 — Auto-Redirect)

Use when moving to a completely different domain (e.g.,
`sync.ozpos.com` → `pos-cloud.com`).

### On the New Server

**1. Deploy the new server**

```bash
docker build -f Dockerfile.server -t oz-pos-cloud:latest .
docker run -d \
  --name oz-cloud-server \
  -p 3099:3099 \
  -v oz-data:/data \
  -e OZ_API_SECRET=<your-secret> \
  oz-pos-cloud:latest
```

**2. Verify health**

```bash
curl https://<new-vps-ip>:3099/health
# {"status":"ok","version":"0.0.9",...}
```

**3. Transfer the database**

- **SQLite users:** Follow the [SQLite Data Transfer](#data-transfer-moving-the-sqlite-database) section.
- **PostgreSQL users:** If moving PG instances, follow the [PostgreSQL Data Transfer](#data-transfer-migrating-postgresql-between-instances) section. If both VPSes point to the same PG instance, skip this step.

**4. Restart the new server**

```bash
docker restart oz-cloud-server
```

### On the Old Server

**5. Switch to redirect-only mode**

Stop the old server running in normal mode and restart it in redirect-only
mode. This starts a minimal service (~5 MB RAM) that only returns the
migration redirect — no database, no pruning, no metrics.

```bash
# Stop the normal server
docker stop oz-cloud-server
docker rm oz-cloud-server

# Start in redirect-only mode
docker run -d \
  --name oz-cloud-redirect \
  -p 3099:3099 \
  -e OZ_REDIRECT_ONLY=true \
  -e OZ_SYNC_REDIRECT_URL=https://pos-cloud.com \
  -e RUST_LOG=info \
  oz-pos-cloud:latest
```

> **Without Docker:** Set the env vars and run the binary directly:
> ```bash
> export OZ_REDIRECT_ONLY=true
> export OZ_SYNC_REDIRECT_URL=https://pos-cloud.com
> export OZ_API_PORT=3099
> ./oz-cloud-server
> ```

**6. Verify the redirect is working**

```bash
# Test push endpoint
curl -v https://sync.ozpos.com/api/sync/push \
  -d '[]' \
  -H 'Content-Type: application/json'
# Expected: HTTP 421 Misdirected Request
# Body: {"error":"server_migrated","new_url":"https://pos-cloud.com"}

# Test pull endpoint
curl -v https://sync.ozpos.com/api/sync/pull \
  -d '{"since":null}' \
  -H 'Content-Type: application/json'
# Expected: Same HTTP 421 response

# Test snapshot endpoint (used after anchor expiry)
curl -v https://sync.ozpos.com/api/sync/snapshot
# Expected: Same HTTP 421 response
```

**7. What happens on each POS terminal (automatic)**

When a terminal connects to the old server during its next sync cycle:

1. The old server returns **HTTP 421** with the redirect JSON
2. The terminal's sync daemon detects `"server_migrated"` and:
   - Calls `Settings::set_sync_server_url()` to update the local SQLite DB
   - Logs: `"server migrated — local config updated"`
3. The **next sync cycle** automatically connects to `https://pos-cloud.com`
4. The terminal continues normal operation — no interruption, no staff action

This works for all three sync paths: push, pull, and snapshot (anchor-expiry
recovery). Every transport method detects the redirect.

**8. Monitor migration progress**

```bash
# On the old server — count how many terminals have migrated
tail -f /var/log/oz-cloud-server.log | grep "server migrated"
# Each line = one terminal that auto-updated

# Also watch traffic declining
tail -f /var/log/oz-cloud-server.log | grep "POST /api/sync"
```

**9. Keep the old server running**

Keep it in redirect-only mode for **15–30 days** to catch terminals that
were powered off or offline during the migration window. The redirect-only
mode is extremely lightweight — no database, no sync processing, just the
HTTP 421 response.

**10. Shut down the old server**

```bash
# After the migration window (15-30 days) with zero remaining traffic
docker stop oz-cloud-redirect && docker rm oz-cloud-redirect
```

---

## Edge Case: Terminals Offline During Migration (Layer 3 — Manual)

For any terminal that was powered off or offline during the entire
migration window, a store manager can restore connectivity manually:

1. Open kasir.mu → **Settings** → **Cloud Sync**
2. Enter the new server URL in the **Server URL** field
3. Click **Save**
4. Click **Sync Now** to verify connectivity

The terminal immediately connects to the new server on the next cycle.
This is the safety net — it always works regardless of Layers 1 and 2.

---

## Environment Variables Reference

| Variable | Default | Purpose |
|----------|---------|---------|
| `OZ_DB_PATH` | `/data/kasir.db` | Path to the SQLite database file |
| `OZ_API_PORT` | `3099` | HTTP server listen port |
| `OZ_REDIRECT_ONLY` | (unset) | Run in redirect-only mode. Requires `OZ_SYNC_REDIRECT_URL`. |
| `OZ_SYNC_REDIRECT_URL` | (unset) | New server URL for migration redirect. |
| `OZ_API_SECRET` | (required) | JWT signing secret for API authentication |
| `RUST_LOG` | `info` | Log level filter (`debug`, `info`, `warn`, `error`) |

---

## Rollback

### Scenario A (DNS rollback)

1. Update the DNS `A` record back to the old VPS IP address
2. Set TTL to 60s for fast propagation
3. Clients revert on their next DNS TTL expiry
4. Once all traffic returns to the old server, shut down the new server

### Scenario B (Redirect rollback)

**If the new server has issues and you need to revert:**

1. Stop the new server:
   ```bash
   docker stop oz-cloud-server && docker rm oz-cloud-server
   ```

2. On the old server, switch back to normal mode:
   ```bash
   docker stop oz-cloud-redirect && docker rm oz-cloud-redirect
   docker run -d \
     --name oz-cloud-server \
     -p 3099:3099 \
     -v oz-data:/data \
     -e OZ_API_SECRET=<your-secret> \
     oz-pos-cloud:latest
   ```

3. **Terminals that already migrated:** These now try to connect to the new
   server (which is down). They'll get connection errors. On their next
   sync cycle, they'll log the error and retry with backoff. Two options:

   **Option A — Reverse redirect on the new VPS:**
   ```bash
   # On the new VPS, run the cloud server in redirect-only mode
   # pointing back to the old domain:
   docker stop oz-cloud-server && docker rm oz-cloud-server
   docker run -d \
     --name oz-cloud-redirect \
     -p 3099:3099 \
     -e OZ_REDIRECT_ONLY=true \
     -e OZ_SYNC_REDIRECT_URL=https://sync.ozpos.com \
     -e RUST_LOG=info \
     oz-pos-cloud:latest
   ```

   **Option B — Manual UI on each terminal:**

---

## Troubleshooting Common Issues

### During Deployment

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `docker build` fails | Missing Dockerfile or stale cache | Run `docker build --no-cache -f Dockerfile.server .` |
| `docker run` exits immediately | Missing `OZ_API_SECRET` | Add `-e OZ_API_SECRET=<your-secret>` |
| Port 3099 already in use | Another service on that port | `docker run -p 3090:3099` or `lsof -i :3099` to find the process |
| `/health` returns connection refused | Container not running or wrong port | `docker ps`, check `docker logs oz-cloud-server` |

### During Data Transfer

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `PRAGMA integrity_check` returns errors | Copy was interrupted or file was in use | Re-checkpoint WAL and re-copy |
| File size is 0 on new VPS | Transfer failed silently | Retry with `rsync -avz --progress` |
| "Permission denied" on new VPS | Container user can't read the file | `chown 1000:1000 /data/kasir.db` |
| `scp` connection refused | Firewall blocking port 22 | Use cloud storage method or open firewall temporarily |
| `-wal` file > 0 bytes after checkpoint | Server was still writing during checkpoint | `docker stop` first, then checkpoint |
| `pg_restore` fails with "already exists" | Target DB has existing tables | Use `--clean --if-exists` or restore to a fresh DB |
| Row counts don't match after PG restore | Dump was taken while writes were active | Stop the old server before `pg_dump` |

### During DNS Migration (Scenario A)

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `dig` still returns old IP | DNS cache (TTL hasn't expired) | Wait for TTL (reduce to 60s before migration) |
| Some terminals connect, others don't | Staggered DNS propagation | Wait 1-6 hours for full propagation |
| New server gets no traffic after DNS update | DNS provider cached old record | Check DNS propagation at [whatsmydns.net](https://www.whatsmydns.net) |
| Intermittent "Connection Error" on terminals | DNS flip-flop during propagation | Temporarily run both servers (old in redirect mode) |

### During Auto-Redirect (Scenario B)

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `curl` to old server returns 200, not 421 | Forgot to set `OZ_REDIRECT_ONLY=true` | Check env vars, restart container |
| Redirect returns 421 but wrong URL | `OZ_SYNC_REDIRECT_URL` misconfigured | Verify the env var, restart |
| Terminals not migrating after hours | Terminals are offline or have long sync intervals | Check `tail -f` logs on old server; wait up to 30 days |
| Old server OOM or crash in redirect mode | Very unlikely (~5 MB RAM usage) | Check `docker stats oz-cloud-redirect` |
| New server shows "database opened" but no data | DB wasn't transferred correctly | Re-run Data Transfer verification steps |

### After Migration

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `docker logs` shows "panic" after restart | Corrupted database | Restore from pre-migration backup |
| Health endpoint works but sync fails | Wrong `OZ_API_SECRET` on new server | Match the old server's secret |
| Old server still getting traffic after 48h | Some terminals have cached old IP | Wait longer (DNS TTL + sync interval) or use Layer 3 |
| Performance degradation | New VPS has fewer resources | Check `docker stats`, compare to old VPS specs |

---

## Verification Checklist

Use this checklist during every migration to confirm each step completed:

```
□ New server deployed and /health returns 200
□ Database copied and row counts match
□ (Scenario A) DNS updated, TTL set to 60s
□ (Scenario A) DNS propagated — curl to domain hits new server
□ (Scenario B) Old server in redirect-only mode
□ (Scenario B) curl to old server returns HTTP 421 + migration JSON
□ (Scenario B) curl to old server /api/sync/push returns redirect
□ (Scenario B) curl to old server /api/sync/pull returns redirect
□ (Scenario B) curl to old server /api/sync/snapshot returns redirect
□ Old server logs show "server migrated — local config updated" entries
□ Old server sync traffic declining
□ Old server shut down after migration window (15-30 days)
□ Rollback plan documented and tested
```

---

## Related

- [ADR #11: VPS Migration Strategy](../decisions/2026-07-13-zero-downtime-vps-migration.md)
- [ADR #10: Sync Performance Strategy](../decisions/2026-07-13-sync-performance-compression-batching.md)
- `apps/cloud-server/src/redirect.rs` — Redirect middleware
- `apps/cloud-server/src/main.rs` — `OZ_REDIRECT_ONLY` mode
- `platform/sync/src/transport.rs` — Client-side `parse_server_migrated()`
- `platform/sync/src/daemon.rs` — Auto URL-update handler
- `Dockerfile.server` — Cloud server Docker build

> last audited 31-08-26 by docs-auditor
