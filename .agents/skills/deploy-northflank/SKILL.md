---
name: deploy-northflank
description: Ship or re-ship the kasir.mu backend (the unified auth + sync container) to Northflank, and prove the deploy actually landed. Use when asked to deploy/redeploy the backend, when a merge to main should have deployed but the live service looks stale, when triggering or polling a Northflank build, when verifying a deploy with scripts/verify-deployment.py, or when changing the service's environment or Dockerfile. For a FAILED build — retrieving its log, pkg-config or shared-library failures, Dockerfile divergence — read `northflank-deploy-diagnosis` instead; this skill assumes the build succeeds.
---

<!-- Audit stamp: 2026-09-22 · Budak-Korporat · status: ACCURATE — 0 findings (first audit stamp for this skill; it shipped without one) · Audited against branch `0.0.39` at `e56bf8307`, working tree clean. Re-measured this pass: all three paths the file cites exist — `ops/docker/Dockerfile.unified`, `scripts/verify-deployment.py`, `apps/license-server/DEPLOY.md`. The `oz-pos` project id is NOT rebrand drift: the file says explicitly that `oz-pos` is the Northflank project id rather than the brand, that renaming it turns working URLs into 404s, and that it is allow-listed in the drift guard's crate-prefix check. Left alone deliberately. Cross-reference integrity checked: the sibling skill `northflank-deploy-diagnosis` that this file's failure path points at does exist. · NOT re-measured (would need live Northflank credentials or a deploy): the build/poll API behaviours, the environment-change steps, and the deploy-verification claims. No network call or deploy was attempted during this audit. -->

# Deploying the kasir.mu backend to Northflank

One service, one image, two functions. `ops/docker/Dockerfile.unified` produces a container
where caddy fronts the Go licence server (PocketBase, internal :8080) and the Rust sync
server (internal :3099) on a single public port. A **successful build auto-deploys** — there
is no separate deploy step to invoke.

| Setting | Value |
|---|---|
| API base | `https://api.northflank.com/v1` |
| Project id | `oz-pos` |
| Service id | `cloud` — a **combined** service |
| Build source | the service's linked branch, currently `main` |
| Dockerfile | `ops/docker/Dockerfile.unified` |
| Public host | `https://license.kasir.mu` (canonical) and `https://license.ozpos.my.id` (alias) |

> **`oz-pos` is the Northflank project id, not the brand.** The brand is `kasir.mu`; the
> project id was never renamed, every endpoint takes it as a path segment, and changing the
> string turns working URLs into 404s. `oz-pos` is allow-listed in the drift guard's
> crate-prefix check, so naming it here is expected, not drift.

## When to use

- "Deploy the backend", "redeploy", "ship it", "trigger a Northflank build", "push to production".
- A change is on `main` and the live service does not show it.
- You need to confirm what is actually running *before* blaming a client or a code change.
- You are changing the service's environment variables, Dockerfile path, or branch.
- You want a post-deploy health verdict, not a build verdict.

Do **not** use this skill to debug a build that failed — that is `northflank-deploy-diagnosis`
(the build-log endpoint, the `lineLimit` ceiling, the closure/pkg-config method).

## Golden rules

| # | Rule | Why |
|---|------|-----|
| 1 | **Never `git push` without an explicit order from the user.** | Repo policy, AGENTS.md. Code reaches production by landing on `main`, so a push *is* a production deploy here. |
| 2 | **Never create or switch branches.** | Repo policy. The service builds `main`; a branch push changes nothing. |
| 3 | **Confirm the target commit is on `main` before triggering a build.** | Northflank builds the linked branch. A build of a sha that is not on `main` is irrelevant to production and burns ~10–15 minutes. |
| 4 | **Read the build log before theorising about a failure.** | A previous session burned two deploy cycles on a toolchain hypothesis the log disproved outright. |
| 5 | **A green build is not a healthy deploy.** Run the verification probes (§Verifying). | The build says the image exists; the probes say the release works. |
| 6 | **Treat an env change as a restart, and a build as the deploy.** | `PATCH` on the service replaces the running container but starts **no** build, so new code still needs its own deploy. |
| 7 | **Require an explicit order to deploy production, even when it is technically one API call.** | A deploy is user-visible and hard to unnoticed; ask first. |

## Path 1 — the normal deploy: land on `main`

`dev-ci.yml#northflank-deploy` is the auditable route. It runs on a **push to `main`** and on
**`workflow_dispatch`**, and both are gated on `github.ref == 'refs/heads/main'`.

- Push entry: `on.push.branches: [main]`. A merge to `main` runs the workflow and deploys.
- Dispatch entry: dispatch it **from `main`**. A dispatch off a `0.0.*` branch is refused on
  purpose — a release branch must never ship this container.
- The job `needs` seven jobs and is skipped loudly without `NORTHFLANK_API_TOKEN`.

So the deploy path is: land the commit on `main` (with the user's explicit push order), then
watch `dev-ci.yml#northflank-deploy` to conclusion. Nothing else reaches production by itself.

## Path 2 — manual trigger from a shell (no GitHub)

The same API call the workflow makes. Use this to redeploy the current `main` head or a
specific commit after an env change.

```bash
TOKEN=$(grep -m1 '^NORTHFLANK_API_TOKEN=' .env | cut -d= -f2- | tr -d '\r\n')
PROJECT=oz-pos
SERVICE=cloud
API=https://api.northflank.com/v1

# Trigger a build of a specific commit (use the sha you verified is on main):
curl -sS -X POST "$API/projects/$PROJECT/services/$SERVICE/build" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"sha\":\"$(git rev-parse HEAD)\"}"

# Or an empty body = build the latest commit of the service's linked branch:
curl -sS -X POST "$API/projects/$PROJECT/services/$SERVICE/build" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
```

- The token lives in the repo `.env` under the **unprefixed** key `NORTHFLANK_API_TOKEN`
  (the `KASIRMU_`-prefixed user-scope variable AGENTS.md documents may be empty in a bash
  tool session — fall back to `.env`).
- **HTTP 409 means a build is already active** (the service's native git trigger can beat you
  to it). Do not retry blindly — list builds and adopt the in-flight one for your sha:
  ```bash
  curl -sS "$API/projects/$PROJECT/services/$SERVICE/build" \
    -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("\n".join(f"{b.get(\"id\")}  {b.get(\"sha\",\"\")[:8]}  {b.get(\"status\")} concluded={b.get(\"concluded\")}" for b in (d.get("data",{}).get("builds") or d.get("data",{}).get("items") or [])))'
  ```
  Take the entry whose `sha` matches and `concluded == false`.

## Watching a build

```bash
BUILD_ID=<id from the trigger response: .data.id>
curl -sS "$API/projects/$PROJECT/services/$SERVICE/build/$BUILD_ID" \
  -H "Authorization: Bearer $TOKEN" \
| python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]; print(d.get("status"), "concluded=", d.get("concluded"))'
```

- Done when `.data.concluded == true`; success is `.data.status` in `SUCCESS` / `COMPLETED`.
  Anything else is a **FAILURE** and there is no deploy — go to `northflank-deploy-diagnosis`.
- The CI job polls **60 times at 10-second intervals (~10 minutes)** and then exits with
  `Timed out waiting for Northflank build`. The runbook sizes a **cold-cache unified build at
  roughly 15 minutes** (warm cache ~10), so a cold build can legitimately outlive the CI poll
  window — re-poll the build id from a shell before calling it a failure. Do not "fix" a
  timeout by re-triggering: that queues a second build.
- Build resources are the 4-core / 16 GB plan; `Cargo.toml` / `Cargo.lock` changes invalidate
  the layer cache and are the usual reason a build is slow.

## Changing service configuration (env, Dockerfile)

The service is **combined**, so its update route is the `combined` path:

```bash
# Partial env update. Send the COMPLETE runtimeEnvironment, not just the new keys:
# that is idempotent whether the route merges or replaces, so it cannot drop a secret.
curl -sS -X PATCH "$API/projects/$PROJECT/services/combined/$SERVICE" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"runtimeEnvironment":{"variables":{ /* all keys, old and new */ }}}'
```

Verified behaviour (measured 2026-09-20 while adding the Google keys):

- A PATCH **redeploys the running image** — a brief `503`, then healthy with a low
  `uptime` — and **starts no build**. New code still needs its own trigger.
- The generic `/projects/{project}/services/{service}` path answers **405** with
  `Allow: HEAD, GET, DELETE`. Read that as "wrong path", not "no update endpoint".
- Do **not** use `POST .../build-options` — deprecated, and a partial payload silently clears
  fields.
- After any change, re-`GET` the service and confirm what you set actually moved.

Dockerfile path changes go through the same route as
`{"buildSettings":{"dockerfile":{"dockerFilePath":"/ops/docker/Dockerfile.unified"}}}`.

**Before a build that adds a boot-gated variable, the env must already be set.** The licence
server fails fast at startup on missing Paddle config (`PADDLE_WEBHOOK_SECRET`,
`PADDLE_PRICE_TIERS`) and, once `OZ_SMTP_HOST` is set, on an unverified `OZ_SMTP_FROM`.
Set the env before or with the deploy that ships the image, or the rollout fails by design.
The paste-ready block is `docs/operations/go-live-checklist.md` §2; the full variable
reference is `apps/license-server/DEPLOY.md` §7.

## Verifying the deploy landed

Start with the shipped probe, which knows the route list and the correct methods:

```bash
python3 scripts/verify-deployment.py                  # default base https://license.kasir.mu
python3 scripts/verify-deployment.py --base https://license.kasir.mu   # --base is repeatable
python3 scripts/verify-deployment.py --self-test      # proves the classifier itself
```

Verdicts: `deployment COMPLETE` (exit 0), `INCOMPLETE` / `BROKEN` (exit 1), usage or transport
error (exit 2). `503` on `/api/health` means the container is mid-rollout — wait a minute and
re-run rather than reporting every route broken.

Manual probes, with what each answer means:

```bash
BASE=https://license.kasir.mu
curl -s  -o /dev/null -w '%{http_code} /health\n'    "$BASE/health"      # sync (Rust)  → 200
curl -s  -o /dev/null -w '%{http_code} /api/health\n' "$BASE/api/health" # auth (PB)    → 200
curl -s  -o /dev/null -w '%{http_code} /_/\n'         "$BASE/_/"         # admin UI     → 200
curl -s  -X POST -o /dev/null -w '%{http_code} paddle webhook\n' \
  "$BASE/api/v1/paddle/webhook"                                          # 503 not-configured, never 404
```

- **Probe with the right method.** PocketBase answers **404, not 405**, for a wrong method on
  an existing route, so `GET /api/v1/web/request-otp` looks dead while `POST` returns 400.
- **A 404 on `/api/v1/desktop/*` is the "stale deploy" signature** — the running image
  predates the route. Rebuild and deploy, then re-run the script.
- **Do not burst-probe the alias.** `license.ozpos.my.id` is fronted by Cloudflare, whose
  rate limiting answers **403** for every `/api/v1/*` path from one IP under a burst — that is
  a property of the edge, not of the deployment. The canonical `license.kasir.mu` carries no
  `cf-ray` and tolerates spaced requests. `scripts/verify-deployment.py` spaces its probes and
  stops at the first throttle for exactly this reason.
- `/health` reports the **sync** function and `/api/health` the **licence** function; a failure
  in one with the other healthy tells you which half to look at. If `/api/health` fails while
  the container looks healthy, suspect a missing `OZ_ADMIN_KEY` (supervisord restarts the sync
  program three times and leaves it FATAL, while the container keeps serving).

## Rolling back

There is **no documented API rollback**, and the image is one deployable unit — rolling back
restores both functions together. Two supported moves:

1. **Redeploy a prior image** from the Northflank dashboard (build/image history on the
   service). Fastest, and it does not change `main`.
2. **Revert the offending commit on `main`.** This is honest about what production runs, but
   it costs a full rebuild cycle, so prefer (1) when the failure is acute.

Either way, record which image is live afterwards — the next deploy will silently overwrite it.

## Common pitfalls

1. **Triggering a build of a sha that is not on `main`.** Northflank builds the linked branch;
   the build is then irrelevant to production. Verify first: `git branch -r --contains <sha>`.
2. **Reading a green build as a shipped release.** A successful build auto-deploys, but
   "deployed" is only proven by the probes. The only ground truth for what shipped is the
   route surface.
3. **Assuming a 405 means "no update endpoint exists".** It means you used the non-combined
   path. Use `services/combined/{service}`.
4. **Sending a partial `runtimeEnvironment` to a route that replaces.** Always send the whole
   object; a dropped secret is invisible until the next boot fails.
5. **Re-triggering after a poll timeout.** The build is probably still running. Re-poll the
   build id; a second trigger only queues contention (or answers 409).
6. **Blaming the client for a missing route.** A tablet that "cannot reach auth or sync" was,
   in the measured case, a container predating the routes. Run the verification script before
   debugging the app.
7. **Probing the alias in a loop.** Cloudflare throttles the alias for a burst and you will
   read 403 as an outage. One paced request, canonical host.
8. **Forgetting that an env change restarts the container.** Users see a short 503 — say so in
   the change note, and do not chase it as a deploy failure.
9. **Changing `OZ_ADMIN_EMAIL` after first boot.** It is write-once: admin sessions resolve
   through it, and a change orphans every existing admin session.

> last audited 22-09-26 by Budak-Korporat
