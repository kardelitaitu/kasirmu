# OZ-POS Website

<!-- Audit stamp: 2026-09-09 · DSH · status: ACCURATE AFTER REPAIR (3 findings, 1 verified-true section) · One deployment claim inverted and two script descriptions fixed; the file is short so all of it was checked. · FINDING 1 (the load-bearing one): the page said CI deploys on every push to main via .github/workflows/website.yml. website.yml exists only as website.yml.bak (retired by 23c96330 on 09-02, and GitHub never executes a .bak file), the dev-ci.yml website job is literally named 'Website Check + Build' (L137-L165: checkout, asset hygiene, setup-node, install, Playwright for Mermaid, typecheck & lint, unit tests, build), and it references ZERO secrets.* values, so it cannot publish anything. Compounding it, dev-ci.yml has no push trigger at all - grep of its on: block returns pull_request + workflow_dispatch only - so a push to main runs nothing. Deploy is manual: npm run deploy, which is the previously-undocumented bash ../scripts/wrangler-deploy.sh. A README that promises an automatic deploy is the kind of claim someone relies on while a site silently stops shipping. · FINDING 2: npm run check was described as astro check plus the i18n gate; it is astro check plus an automatic npm precheck hook that also runs scripts/check-password-policy.mjs and vitest run. FINDING 3: npm run build was credited with the i18n audit gate, which belongs to precheck; build's hooks are prebuild (scripts/prebuild.mjs) and postbuild (bust-admin-cache.mjs, inject-module-preloads.mjs). Corrected from website/package.json scripts verbatim. · CODE FINDING recorded not patched: npm run deploy invokes bare bash, which resolves to WSL on this workstation and can hang rather than fail (AGENTS.md documents the hazard). · VERIFIED-TRUE and left alone: every referenced path exists (website/.env.example, worker.ts, wrangler.toml, public/_headers, public/_redirects, scripts/audit-i18n.mjs, scripts/wrangler-deploy.sh); dev/build/check/preview all exist; the four PUBLIC_ variables and the runtime-config mechanism in website/worker.ts (/__oz/runtime-config.js from the LICENSE_API_URL vars binding) match the file; the graceful-degradation descriptions for unset vars were checked against worker.ts and the layout. · Two claims I did not write down as findings because they were my own near-misses: an early grep suggested no deploy step exists anywhere in dev-ci.yml, which is true of the website job but not of northflank-deploy - a different job deploying a different thing - and the first script dump looked like it had no precheck at all because a shell quoting error truncated the output. -->

Astro marketing site (en + id locales) with docs, pricing, and the license
dashboard. Static build — deployed to Cloudflare Workers static assets.

## Local development

```bash
npm install        # first time
npm run dev        # http://localhost:4321
npm run check      # astro check, preceded by precheck:
                   #   scripts/audit-i18n.mjs + scripts/check-password-policy.mjs + vitest run
npm run build      # astro build, with prebuild (scripts/prebuild.mjs) and postbuild
                   #   (bust-admin-cache.mjs, then inject-module-preloads.mjs)
```

> npm runs a `pre<script>`/`post<script>` hook automatically, so `precheck` gates
> `npm run check` and `prebuild`/`postbuild` gate `npm run build`. The i18n audit is
> `scripts/audit-i18n.mjs`, also runnable alone as `npm run check:i18n`; there is also
> `npm run check:links`. Earlier text here attributed the i18n gate to `npm run build`, which
> is what `prebuild`/`postbuild` do not do.

`npm run dev` and `npm run build` will print a Vite warning about unset
`PUBLIC_*` vars — expected. The site degrades gracefully:

- `PUBLIC_LICENSE_API_URL` unset → login/account pages render a
  "not configured" state instead of failing.
- `PUBLIC_PADDLE_CLIENT_TOKEN` unset → checkout buttons fall back to a
  contact link (the whole checkout path is dead-code-eliminated at build).
- `PUBLIC_CONTACT_ENDPOINT` unset → contact form falls back to mailto.

## Environment variables

See `.env.example` for the full list with comments.

| Variable | Purpose |
|----------|---------|
| `PUBLIC_LICENSE_API_URL` | License server web API (OTP auth + license status) |
| `PUBLIC_PADDLE_CLIENT_TOKEN` | Paddle.js v2 client token (empty = mailto fallback) |
| `PUBLIC_PADDLE_ENVIRONMENT` | Paddle SDK env: `sandbox` or `production` (default `production`) |
| `PUBLIC_CONTACT_ENDPOINT` | Contact-form target on the license server (empty = mailto) |

`PUBLIC_LICENSE_API_URL` is resolved at **runtime** when served by the Worker:
`website/worker.ts` exposes `/__oz/runtime-config.js` from the `LICENSE_API_URL`
`[vars]` binding (wrangler.toml), loaded by the layout head before the bundle.
Change that var — dashboard or wrangler.toml — to repoint the site; **no rebuild
needed**. The build-time value above is only the fallback (local preview /
static hosts, or an unset var).

## Deploy (Cloudflare Workers static assets)

**Nothing deploys this site from CI.** `.github/workflows/website.yml` was retired to
`website.yml.bak` by `23c96330` (09-02) and never restored, and GitHub never executes a
`.bak` file. The live `.github/workflows/dev-ci.yml` does have a `website` job — but it is
"Website Check + Build": it compiles and tests, references no Cloudflare secret, and runs no
deploy step. `dev-ci.yml` also has **no `push` trigger** (only `pull_request` to `main` and
`workflow_dispatch`), so pushing to `main` runs nothing at all. Deploy is therefore a manual
step, and the repo provides a script for it:

```bash
cd website
PUBLIC_LICENSE_API_URL=https://license.ozpos.my.id \
PUBLIC_PADDLE_CLIENT_TOKEN=<token> \
PUBLIC_PADDLE_ENVIRONMENT=sandbox \
npm run build
npm run deploy        # -> bash ../scripts/wrangler-deploy.sh
                      # needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
```

`npm run deploy` wraps `scripts/wrangler-deploy.sh` (which reads `wrangler.toml`); calling
`npx wrangler deploy` directly works too but skips whatever the wrapper validates.

⚠️ **Code finding, recorded not fixed:** that script is invoked as bare `bash`, which on this
Windows workstation resolves to WSL rather than Git bash and can hang without failing — see the
"Running CLI Tools on Windows" section of `AGENTS.md`. The same hazard is already recorded for
`website/package.json` elsewhere; `npm run deploy` inherits it.

`public/_headers` (CSP) and `public/_redirects` (301s) are honored by
Workers static assets exactly as on Pages. Cloudflare Pages (Git
integration) also works — same build command/output; `wrangler.toml` is
then ignored and env vars go in Pages → Settings → Builds.

> last audited 09-09-26 by docs-auditor
