---
name: deploy-cloudflare
description: Deploy, verify and rotate credentials for the kasir.mu marketing site and website Worker on Cloudflare (Astro static build in website/, worker.ts, the dashboard/admin routes, the runtime LICENSE_API_URL config, the CF_API_KEY Worker secret, and the Cloudflare API token). Use when asked to deploy the website, publish the site, run wrangler, change the licence-server URL the site talks to, verify what is live on kasir.mu, or rotate an expired/rejected Cloudflare token. This is a MANUAL deploy — no workflow ships the site.
---

# Deploying the kasir.mu website to Cloudflare

The site is an Astro static build in `website/` served from a Cloudflare Worker named
`oz-pos`. `worker.ts` serves the built `dist/` through an `ASSETS` binding and adds a small
dynamic surface (the runtime config, the health-tab deployment/log/traffic proxies).

| Setting | Value |
|---|---|
| Worker name | `oz-pos` |
| Config | `website/wrangler.toml` |
| Entry | `website/worker.ts` (`main`), assets from `./dist` (binding `ASSETS`) |
| Public names | `https://kasir.mu` and `https://ozpos.my.id` |
| Extra routes | `dashboard.kasir.mu/*`, `admin.kasir.mu/*` |
| Deploy command | `npm run deploy` from `website/` |
| Credentials | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` from the environment |

## When to use

- "Deploy the website", "publish the site", "push the site live", "run wrangler".
- The live site looks stale, or a page that should exist 404s.
- You are changing the licence-server URL the site calls, the Worker's routes, or a build-time
  `PUBLIC_*` value.
- `wrangler deploy` fails on credentials, or you are rotating the Cloudflare API token.
- You need to prove what is actually live before blaming the Worker.

Not covered here: the **backend** deploy (that is `deploy-northflank`) and the site's *content*
(same workflow — build then deploy, but the changes are Markdown/Astro, not infrastructure).

## Golden rules

| # | Rule | Why |
|---|------|-----|
| 1 | **This deploy is manual. Nothing in CI ships the site.** | `dev-ci.yml#website` installs, typechecks, lints, tests and **builds** — it stops short of deploying (`grep -rn wrangler .github/workflows/*.yml` is zero hits). A green PR run is not a published site, and a forgotten deploy is invisible from GitHub. |
| 2 | **Run it from `website/`, never the repo root.** | `wrangler.toml` lives there; a root invocation picks up the wrong config (or none). |
| 3 | **On Windows, invoke the script through Git's bash by full path.** | `npm run deploy` shells out to `bash ../scripts/wrangler-deploy.sh`. Bare `bash` resolves to WSL, which here hangs until killed or runs Linux node against the Windows-built `website/node_modules`. |
| 4 | **Never hardcode or commit a token.** | `CLOUDFLARE_API_TOKEN` comes from the environment; `.env` is gitignored and never committed. The account id in `wrangler.toml` is not a credential. |
| 5 | **Verify the token *before* a deploy, and the live site *after*.** | Nothing validates the token at deploy time any more — the fail-fast step died with the retired website workflow. |
| 6 | **Require an explicit order to publish.** | Deploying the site is user-visible and reaches production immediately. |

## Prerequisites

```bash
# Tokens: in .env under the UNPREFIXED names, or from the user-scope KASIRMU_* variables
# AGENTS.md documents. wrangler reads CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID directly.
export CLOUDFLARE_API_TOKEN=$(grep -m1 '^CLOUDFLARE_API_TOKEN=' .env | cut -d= -f2- | tr -d '\r\n')
export CLOUDFLARE_ACCOUNT_ID=$(grep -m1 '^CLOUDFLARE_ACCOUNT_ID=' .env | cut -d= -f2- | tr -d '\r\n')
```

The token needs exactly **Account → Workers Scripts → Edit** (full CRUDL on the Worker; no
Zone/DNS/Pages/KV permission). `node_modules` must exist in `website/` — if it is missing,
`npm ci --no-audit --no-fund` from `website/`.

## Deploying

The supported route is the script, which builds then deploys and stamps a traceable message:

```bash
# From the repo root, on Windows use Git's bash explicitly:
& 'C:\Program Files\Git\bin\bash.exe' scripts/wrangler-deploy.sh --message "Docs: refresh pricing FAQ" --tag v0.0.39
```

```bash
# On a POSIX host (or inside Git bash):
bash scripts/wrangler-deploy.sh [--message "..."] [--tag v0.0.39] [--skip-build]
```

The script (`scripts/wrangler-deploy.sh`):

- Fails immediately if `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` is unset.
- Defaults the deploy message to `Coding Agent — <short sha> (<branch>)`, so every deploy is
  traceable from the Cloudflare dashboard without GitHub.
- Builds unless `--skip-build` / `SKIP_BUILD=1`, passing the `PUBLIC_*` values through.
- Runs `npx wrangler deploy` with `--message` / `--tag`.
- Extra flags are passed through (e.g. `--env staging`).

Two equivalent manual forms, useful when debugging:

```bash
cd website
npm run build              # prebuild → astro build → postbuild (admin cache bust, module preloads)
npx wrangler deploy --message "manual"          # deploy the existing dist/
npx wrangler deploy --dry-run                    # validate the config/bundle WITHOUT publishing
```

`npx wrangler deploy --dry-run` is the cheap pre-flight — it catches a malformed
`wrangler.toml`, a missing `worker.ts`, or a broken assets path with no production change.
Pair it with `npx wrangler whoami` when a token is suspected.

## Build-time vs runtime configuration

Two different knobs, and confusing them is the usual cause of "it still talks to the old host":

| Knob | Where | When it takes effect |
|---|---|---|
| `PUBLIC_LICENSE_API_URL`, `PUBLIC_PADDLE_CLIENT_TOKEN`, `PUBLIC_PADDLE_ENVIRONMENT` | environment at **build** time (`import.meta.env`) | only on a **rebuild + redeploy** |
| `LICENSE_API_URL` | `website/wrangler.toml` → `[vars]`, served as `/__oz/runtime-config.js` | on **deploy only**, no rebuild needed |

So when the licence-server host changes, update `[vars] LICENSE_API_URL` (or the Worker's
Variables in the dashboard) and redeploy — the shipped bundle stays valid. `PUBLIC_*` values
are baked into the JS and are **not** bindings; setting them without rebuilding changes
nothing.

Other committed `[vars]`: `CONTACT_WEBHOOK_URL` and `CLOUDFLARE_ACCOUNT_ID` (the latter feeds
the health-tab deployments proxy).

**Worker secret.** The health-tab proxies (`/__oz/cf-deploys`, the worker-log proxy, the
traffic proxy) read `CF_API_KEY`, which is a Worker **secret**, not a `[vars]` entry. Without
it those endpoints answer `503 … proxy not configured` — the site itself still works. Set it
with:

```bash
cd website
npx wrangler secret put CF_API_KEY
```

**`compatibility_date`.** Bump it deliberately — never forward-date it. `npx wrangler deploy`
warns when the configured date is more than a few days old; that warning is informational, not
a reason to edit the date in an unrelated change.

## Verifying what shipped

```bash
# 1. Is the token valid? (authoritative)
curl -s "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
# want: {"result":{"status":"active"},"success":true,...}
#
# SHORT-LIVED tokens (cfat_ prefix) are account-scoped: the /user/ endpoint answers 401
# while the token is fine. Probe them against their own account instead:
curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/tokens/verify" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"

# 2. Did the deploy actually land? (ground truth — a 404 means stale assets)
curl -sf -o /dev/null -w '%{http_code} docs-portal\n' https://ozpos.my.id/docs-portal/intro.html
curl -sf -o /dev/null -w '%{http_code} site\n'        https://kasir.mu/
curl -sf -o /dev/null -w '%{http_code} config\n'      https://kasir.mu/__oz/runtime-config.js

# 3. Did the host routing move? (ADR #42: both hosts route to this Worker)
curl -s -o /dev/null -w '%{http_code} dashboard\n' https://dashboard.kasir.mu/
curl -s -o /dev/null -w '%{http_code} admin\n'     https://admin.kasir.mu/
```

The docs-hub probe (#2) is the one to trust: it ships only with a successful deploy, so a 404
there while everything else looks fine means the assets are stale regardless of what the build
said.

## Rotating the Cloudflare token

1. **Create the new token first** — My Profile → API Tokens → Create Token, permission
   **Account → Workers Scripts → Edit**, and **set a TTL** (policy: ≤ 1 year; Cloudflare
   allows up to 10). Copy it immediately — it is shown once.
2. **Verify it before changing anything** with probe #1 → `"status": "active"`.
3. **Update wherever the deploy actually reads it**: the `.env` entry and the
   `KASIRMU_CLOUDFLARE_API_TOKEN` user-scope variable that feed
   `scripts/wrangler-deploy.sh`. Updating only the GitHub Actions secret rotates a credential
   nothing live consumes, and the manual deploy keeps using the revoked one.
4. **Confirm with a real deploy**, then re-run probe #2.
5. **Revoke the old token** only after the new one is proven.

A token with no TTL is a standing silent-rot risk — treat it as an incident to fix, not a
preference.

## Storage (R2) — do not assume it is wired

R2 credentials exist in the environment (`KASIRMU_CLOUDFLARE_ACCESS_KEY`,
`KASIRMU_CLOUDFLARE_SECRET_ACCESS_KEY`, `KASIRMU_CLOUDFLARE_S3_ENDPOINT`), but
`website/wrangler.toml` declares **no R2 binding**, so no bucket is reachable from the Worker
today. Before writing code that presumes one, confirm a binding exists; adding the credential
to the environment is not the same as binding a bucket.

## Common pitfalls

1. **Expecting CI to publish the site.** It does not, and there is no run to re-run and no
   Actions list to inspect. If a change is live in the repo but not on the site, the deploy
   simply was not run.
2. **`npm run deploy` hanging on Windows.** That is the bare-`bash`/WSL trap in rule 3, not a
   wrangler hang. Call the script through Git's bash by full path.
3. **Setting `PUBLIC_LICENSE_API_URL` without rebuilding.** It is baked in at build time. For a
   host change with no rebuild, use the runtime `LICENSE_API_URL` var instead.
4. **Reading a 403 on `/api/v1/*` as a broken site.** That is the *licence* host's Cloudflare
   edge throttling a burst — not the website Worker. Probe once, paced, canonical host.
5. **Reading a 401 from `/user/tokens/verify` as a dead token.** A `cfat_` short-lived token is
   account-scoped; use the `/accounts/{id}/tokens/verify` form.
6. **Editing the `compatibility_date` to silence a warning.** It is a behavioural contract with
   the Workers runtime; bump it deliberately, in its own change.
7. **Committing `.env`, a token, or a `wrangler secret` value.** Secrets live in the
   environment and in the Worker's secret store, never in the tree. `website/public/_headers`
   and `_redirects` are the shipped HTTP surface and are committed on purpose.
8. **Deploying from the repo root.** No config is picked up there; the command silently targets
   the wrong project or fails.

> last audited 21-09-26 by Buffy
