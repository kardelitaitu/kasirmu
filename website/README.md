# kasir.mu Website

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major) · Re-audit of the website README; the 2026-09-09 stamp is merged at the bottom as original evidence, delimiters stripped so it cannot nest. · MAJOR, and it is the one claim this page's own story says will move: the §Deploy section asserted "Nothing deploys this site from CI" — `.github/workflows/website.yml` retired to `.bak`, and "dev-ci.yml also has no push trigger, so pushing to main runs nothing at all". BOTH HALVES ARE NOW FALSE. `.github/workflows/website.yml` is LIVE and deploys the site to the Cloudflare Worker on a push to `main` that touches `website/**`; `attic/website.yml.bak` is the retired copy; and `dev-ci.yml` carries a `push` trigger on `main` (`on.push.branches: [main]`). The file that restored it says so in its own header (restored 2026-09-24, "the same way android.yml was"), and runbook §9 is the gap it closed. · WHY THIS ONE IS WORTH THE WORDS: the 2026-09-09 pass inverted this claim correctly — CI did not deploy then — and the inversion is what made it wrong later, because on 2026-09-24 the workflow came back and nothing re-read the paragraph. A page whose subject is "do not inherit a deploy claim" is exactly where an inherited deploy claim survives longest, so the repaired text now states the rule beside the fact rather than only the fact. · VERIFIED AND LEFT ALONE: every path the page names resolves — `website/.env.example`, `worker.ts`, `wrangler.toml`, `public/_headers`, `public/_redirects`, and the six scripts `{audit-i18n,check-password-policy,prebuild,bust-admin-cache,inject-module-preloads,wrangler-deploy}.sh|mjs`; `npm run deploy` really is `bash ../scripts/wrangler-deploy.sh` (repo-root `scripts/`, not `website/scripts/` — the leading `../` is correct and a naive lookup for `website/scripts/wrangler-deploy.sh` finds nothing); the `precheck`/`prebuild`/`postbuild` hook description matches `website/package.json` verbatim; the four `PUBLIC_*` variables and the graceful-degradation behaviour match `worker.ts`; the "Website Check + Build" job name is exact. · STILL OPEN, recorded not patched: `npm run deploy` invokes bare `bash`, which resolves to WSL on this Windows workstation and can hang rather than fail (AGENTS.md §5). That is a scripts change, not a documentation one. · NOT re-measured: an actual deploy run, and the live site's current content. · Superseded 2026-09-09 body follows as plain quoted text:

Audit stamp: 2026-09-09 · DSH · status: ACCURATE AFTER REPAIR (3 findings, 1 verified-true section) · One deployment claim inverted and two script descriptions fixed; the file is short so all of it was checked. · FINDING 1 (the load-bearing one): the page said CI deploys on every push to main via .github/workflows/website.yml. website.yml exists only as website.yml.bak (retired by 23c96330 on 09-02, and GitHub never executes a .bak file), the dev-ci.yml website job is literally named 'Website Check + Build' (L137-L165: checkout, asset hygiene, setup-node, install, Playwright for Mermaid, typecheck & lint, unit tests, build), and it references ZERO secrets.* values, so it cannot publish anything. Compounding it, dev-ci.yml has no push trigger at all - grep of its on: block returns pull_request + workflow_dispatch only - so a push to main runs nothing. Deploy is manual: npm run deploy, which is the previously-undocumented bash ../scripts/wrangler-deploy.sh. A README that promises an automatic deploy is the kind of claim someone relies on while a site silently stops shipping. · FINDING 2: npm run check was described as astro check plus the i18n gate; it is astro check plus an automatic npm precheck hook that also runs scripts/check-password-policy.mjs and vitest run. FINDING 3: npm run build was credited with the i18n audit gate, which belongs to precheck; build's hooks are prebuild (scripts/prebuild.mjs) and postbuild (bust-admin-cache.mjs, inject-module-preloads.mjs). Corrected from website/package.json scripts verbatim. · CODE FINDING recorded not patched: npm run deploy invokes bare bash, which resolves to WSL on this workstation and can hang rather than fail (AGENTS.md documents the hazard). · VERIFIED-TRUE and left alone: every referenced path exists (website/.env.example, worker.ts, wrangler.toml, public/_headers, public/_redirects, scripts/audit-i18n.mjs, scripts/wrangler-deploy.sh); dev/build/check/preview all exist; the four PUBLIC_ variables and the runtime-config mechanism in website/worker.ts (/__oz/runtime-config.js from the LICENSE_API_URL vars binding) match the file; the graceful-degradation descriptions for unset vars were checked against worker.ts and the layout. · Two claims I did not write down as findings because they were my own near-misses: an early grep suggested no deploy step exists anywhere in dev-ci.yml, which is true of the website job but not of northflank-deploy - a different job deploying a different thing - and the first script dump looked like it had no precheck at all because a shell quoting error truncated the output. -->

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

**CI deploys this site on a push to `main`.** `.github/workflows/website.yml` is LIVE
(it was retired to `attic/website.yml.bak` on 09-02 and **restored on 2026-09-24**, the same way
`android.yml` was — the `.bak` stays in `attic/` as the historical record). It builds the
Astro site and deploys it to the Cloudflare Worker on every push to `main` that touches the
site, and it is fail-closed: a missing or rejected `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`
fails the run in about a second, before `npm ci`.

> ⚠️ **This paragraph said the opposite until 2026-10-11, and the earlier version was correct
> when written.** The 2026-09-09 audit's headline finding was that the README promised an
> automatic deploy that did not exist; it inverted the claim to "nothing deploys from CI" and
> was right to. Then 2026-09-24 restored the workflow, which re-inverted the fact underneath a
> paragraph whose whole subject is *not* trusting a deploy claim. That is the failure this
> section warns about, one level down: **the deploy story is the thing most likely to have
> changed since this page was last read.** Verify it, do not inherit it.

The `.github/workflows/dev-ci.yml` `website` job is separate and still does not deploy: it is
"Website Check + Build" — it compiles, lints, unit-tests, and runs the link and SEO audits on
every PR touching `website/**`, and references no Cloudflare secret. `dev-ci.yml` also carries a
`push` trigger on `main` today.

Deploy by hand when CI cannot (a rotated secret, a hotfix, a non-`main` branch):

```bash
cd website
PUBLIC_LICENSE_API_URL=https://license.kasir.mu \
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

> last audited 11-10-26 by docs-auditor
