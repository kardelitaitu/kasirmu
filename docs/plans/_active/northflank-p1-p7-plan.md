# Northflank Cloud Deployment — P1–P7 Plan

## P1 — Single-volume SQLite scaling bottleneck

**Condition:**
Both the sync server (Rust, `/data/oz-pos.db`) and the auth server (PocketBase, `/data/pb_data/`) use SQLite on the same persistent volume. The `server_performance_analysis.md` targets 200–400 terminals on the Northflank free tier, but with two separate SQLite databases sharing the same disk I/O, the actual ceiling is lower. Northflank provides a **free PostgreSQL addon** (`DATABASE_URL`) that eliminates the single-writer lock bottleneck — but the unified image defaults to `OZ_DB_PATH=/data/oz-pos.db` (SQLite), and the §8 env table has no `DATABASE_URL` row (P3). The `Dockerfile.unified` line 19 says "set DATABASE_URL to switch to the managed Postgres addon", but the operation's primary config document doesn't document it.

**Strategy:**
Three-part fix covering the configuration gap, not the migration itself:
1. Add `DATABASE_URL` to the runbook §8 env table (see P3).
2. Add a one-paragraph note in §8 explaining when to switch: "When the free tier's 200–400 terminal ceiling is reached, or when you observe SQLite lock contention in production, enable the Northflank PostgreSQL addon and set `DATABASE_URL` to the connection string. See `docs/archived/2026-08-15-unify-auth-and-sync.md` §Phase 3.5 for the full cutover procedure including the RLS migration."
3. Consider adding a `Dockerfile.unified` build-time check that fails early if `DATABASE_URL` is unset and `OZ_ENFORCE_PLANS=1` (current SQLite works for dev; production should be on PG).

**Effect after:**
A deployer reading §8 knows exactly when and how to switch to PostgreSQL. The scaling path is documented, not hidden in an offhand Dockerfile comment. The free tier remains usable for smaller deployments.

---

## P2 — Dockerfile prime layer fragility under workspace changes

**Condition:**
`Dockerfile.server` and `Dockerfile.unified` each maintain a manual cache-priming stage that copies each workspace member's `Cargo.toml` and creates dummy source files to pre-build dependencies. Every new crate added to the workspace must be added to:
- The `COPY` manifest block in both Dockerfiles
- The `mkdir -p` + `echo "// dummy"` source block in both Dockerfiles

The `scripts/verify-dockerfile-workspace.py` CI check validates `Dockerfile.server` against the workspace members list, but does **not** validate `Dockerfile.unified`. A drift in `Dockerfile.unified` goes undetected — the prime build silently fails (best-effort per DOCKER-09), the cache layer becomes dead weight, and every subsequent build pays the full compile time.

**Strategy:**
1. Extend `verify-dockerfile-workspace.py` to also validate `Dockerfile.unified` — same checks (COPY manifest + dummy src dir presence).
2. Add a `"skip"` list or separate validation: the unified image excludes `giftcards`, `kitchen`, `promotions`, `purchasing` modules (cloud-server doesn't depend on them). The script should accept a per-file exclusion list.
3. Alternatively, simplify: generate the prime section from `Cargo.toml` workspace members at build time. A small script that emits the `mkdir` + `COPY` + `echo` lines would eliminate the drift risk entirely.

**Effect after:**
A new crate added to the workspace triggers a CI failure if either Dockerfile is missing the corresponding `COPY` + dummy source lines. The prime layer stays effective on every build. Option 3 (generation) would remove the manual maintenance burden entirely.

---

## P3 — Missing `DATABASE_URL` in the §8 env table

**Condition:**
The runbook §8 env table (the authoritative config document for the Northflank deployment) lists every `OZ_*`, `PADDLE_*`, and `OZ_SMTP_*` variable but does **not** list `DATABASE_URL`. The only reference to PostgreSQL is in `Dockerfile.unified` line 19 ("set DATABASE_URL to switch to the managed Postgres addon") and in the separate `docs/archived/2026-08-15-unify-auth-and-sync.md`. A deployer reading only §8 has no way to know they can switch from SQLite to the free PostgreSQL addon.

**Strategy:**
Add a single row to the §8 env table:

```
| `DATABASE_URL` | `postgres://user:pass@host:5432/db?sslmode=require` | optional — switch from SQLite to the managed PostgreSQL addon (free on Northflank). Requires `sslmode=require` (fail-fast at boot). See `docs/archived/2026-08-15-unify-auth-and-sync.md` §Phase 3.5 for the full cutover. |
```

**Effect after:**
The env table is complete. A deployer can see the PG option without reading separate docs. The "sslmode=require" requirement is enforced at boot (fail-fast) and documented in the table.

---

## P4 — Full Rust workspace rebuild on every backend push

**Condition:**
`deploy.yml` triggers a Northflank build of `Dockerfile.unified` on every push to `main` that touches backend paths (`crates/**`, `apps/**`, `modules/**`, etc.). The Docker build runs a **full Rust workspace compilation** (prime + real build) which takes ~15 minutes on Northflank's 4-core/16GB builders. The deploy workflow's timeout is 90 minutes with a 50-minute poll limit. This is not a bug — it's the expected cost of a multi-crate workspace — but it's worth documenting and optimizing where possible.

**Strategy:**
1. **Document the expected build time** in the runbook §8.5 (trigger step) so a deployer knows a 15-minute build is normal.
2. **Add a Cargo workspace-level `sccache`** to the Docker builder stage. The prime layer already caches dependency downloads; `sccache` would cache the actual compilation artifacts across builds (Northflank's builder instances are ephemeral, so this only helps if the builder node is reused within the cache TTL — Northflank does not guarantee this, but it's a no-regret add).
3. **Set `CARGO_INCREMENTAL=1`** in the Dockerfile builder for the real build — it's already default for debug builds, but the Dockerfile uses `--release` which disables incremental. This is a tradeoff: incremental adds ~10% to binary size but speeds up the non-cached portions of the build.

**Effect after:**
The build time is documented, reducing surprise. `sccache` may speed up re-builds on the same builder node. The incremental compilation flag is a tradeoff — worth applying only if the 15-minute build is a bottleneck.

---

## P5 — `healthcheck.sh` greps raw JSON (fragile)

**Condition:**
`apps/unified/healthcheck.sh` parses the PocketBase `/api/health` JSON response with:
```sh
smtp_block="$(printf '%s' "$license_health" | grep -o '"smtp":{[^}]*}' || true)"
smtp_configured="$(printf '%s' "$smtp_block" | grep -c '"configured":true' || true)"
```
This is fragile: a JSON key order change, a newline in the smtp block, or a nested object with braces would break the parse. The unified image (debian:bookworm-slim) does not install `jq`. The deploy workflow's smoke test uses `jq` (GitHub runner has it), but the container's `HEALTHCHECK` does not.

**Strategy:**
1. **Install `jq`** in the unified runtime image (one line in `Dockerfile.unified` line 148: `jq` added to the `apt-get install` list).
2. **Rewrite the grep-based parsing** in `healthcheck.sh` to use `jq`:
   ```sh
   smtp_configured=$(printf '%s' "$license_health" | jq -r '.smtp.configured // false' 2>/dev/null)
   smtp_verified=$(printf '%s' "$license_health" | jq -r '.smtp.verified // false' 2>/dev/null)
   paddle_secret=$(printf '%s' "$license_health" | jq -r '.paddle.secret_configured // false' 2>/dev/null)
   ```
3. **Update `test-healthcheck.sh`** to mock the new `jq`-based parsing (the test harness currently uses `wget` mock; the `jq` calls would need to be available in the test environment or mocked).

**Effect after:**
The healthcheck is robust against JSON shape changes. `jq` is available in the container for any future JSON parsing needs. The healthcheck test verifies the `jq` path.

---

## P6 — Minimal debug/tracing in the running container

**Condition:**
Supervisord logs go to `/dev/null` and `/dev/stdout`. The `OZ_LOG_FORMAT=json` env var exists (runbook §8) but is not set in the Northflank dashboard. There is no structured logging, no log aggregation destination configured, and no crash-log retention beyond the container's stdout. If a process crashes and supervisord restarts it, the crash log is only in the container stdout (which Northflank buffers but does not guarantee retention).

**Strategy:**
1. **Set `OZ_LOG_FORMAT=json`** in the runbook §8 env table as the recommended value for the Northflank deployment — make it the default, not a footnote.
2. **Add a runbook section §8.6** "Logging & Debugging" that documents:
   - Northflank's log viewer (dashboard → service → logs) for real-time tailing.
   - How to enable `RUST_LOG=debug` temporarily for diagnosis.
   - Where crash dumps go (container stdout, retained by Northflank per their retention policy).
3. **Optional**: Add a `console-subscriber` feature gate to the unified image's `supervisord.conf` (commented out, with a note explaining how to enable tokio-console for deep debugging).

**Effect after:**
A deployer can find and interpret logs without guessing. The `json` format makes structured log queries possible. The optional tokio-console path is documented for deep debugging sessions.

---

## P7 — `su` fallback quoting in entrypoints

**Condition:**
Both `Dockerfile.server`'s entrypoint (`scripts/docker-entrypoint.sh`) and the license-server entrypoint (`apps/license-server/docker-entrypoint.sh`) have a fallback path when `gosu`/`su-exec` is unavailable:
```sh
exec su -s /bin/sh ozpos -c "$*"
```
The `$*` collapses all positional arguments into a single string, which works for simple commands like `/app/oz-cloud-server` but breaks if the `CMD` contains quoted arguments (e.g., `CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8080"]` would be collapsed to `/pb/pocketbase serve --http=0.0.0.0:8080` — which is fine for this case, but patterns like `--http="0.0.0.0:8080"` would break). The `gosu`/`su-exec` primary path is correct; the fallback is only reached if the tools are missing from the runtime image.

**Strategy:**
1. **Replace `"$*"` with `"$@"`** in both fallback `su` paths:
   ```sh
   exec su -s /bin/sh ozpos -c "$*"    →    exec su -s /bin/sh ozpos -- "$@"
   ```
   `"$@"` preserves each argument as a separate word, matching the `exec` behavior of `gosu`/`su-exec`. The `--` prevents `su` from interpreting arguments as its own options.
2. Verify the `CMD` in both Dockerfiles is compatible with the `su -c` pattern (it is: simple commands without quoted-argument edge cases).

**Effect after:**
If `gosu`/`su-exec` is somehow missing from the runtime image, the fallback behaves identically to the primary path. No argument quoting surprises. The change is a one-character substitution (`$*` → `$@`) plus a `--` separator.

---

## Summary table

| Item | Scope | Effort | Risk | Effect |
|------|-------|--------|------|--------|
| P1 | Runbook §8 + performance doc | 1 paragraph | None | Documented PG scaling path |
| P2 | `verify-dockerfile-workspace.py` + `Dockerfile.unified` | ~30 lines | Medium (CI change) | CI catches unified-image prime drift |
| P3 | Runbook §8 env table | 1 row | None | Complete env table |
| P4 | Runbook §8.5 + `Dockerfile.unified` | 2 lines + doc | Low | Documented build time; optional sccache |
| P5 | `Dockerfile.unified` + `healthcheck.sh` + test | 10 lines + 1 apt pkg | Low | Robust JSON parsing in healthcheck |
| P6 | Runbook §8.6 | 1 doc section | None | Documented logging path |
| P7 | `scripts/docker-entrypoint.sh` + `apps/license-server/docker-entrypoint.sh` | 2 lines | None | Correct argument passing in fallback |

Want me to execute any of these? (P3, P5, P7 are the smallest with highest impact; P2 is the most impactful but requires CI workflow changes.)