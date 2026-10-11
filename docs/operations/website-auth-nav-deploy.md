# Deploying the website auth-nav fix

How to ship the pre-paint signed-in hint, and prove the cookie actually
survived the Cloudflare edge.

## The problem this solves

Two commits on `0.0.41` changed what the header does on the **first frame**:
`257a4978b` (one session probe per view, plus the Worker hint cookie and the
`is:inline` script in `Header.astro`) and `8045046e6` (the disclosure rebind
pinned to `after-swap` alone). Both are verified locally — but one half of the
fix is unverifiable from any local build:

`oz_signed_in` is set by the Worker on a **JSON response** (`/__oz/session`,
and the login redirect). Nothing in this repository proves that Cloudflare
round-trips a `Set-Cookie` on a non-document response. If it does not, the
site does **not** break — it silently degrades to the pre-fix behaviour, one
wrong-label frame on the first view of a signed-in session. That is exactly
why a deploy without the checks below is indistinguishable from success, and
why they are mandatory rather than advisory.

## Before you start

**Read the `Node` line the script now prints before anything else.** The
deploy banner reports the Node it is actually about to build with, because
`node` inside a build can differ from the one the calling shell reports —
most often because the deploy is run from Ubuntu/WSL (whose `node` is apt's
v18.19.1) while the version check was run in a Windows shell (nvm's
v22.23.2). Measured 2026-10-12: `node --version` printed v22.23.2 in the
Windows window while the build ran under v18.19.1, and nothing in the output
said so. Expected: `v22.23.2` or `v24.x`. Anything starting `v18` means you
are in the wrong shell and the build will fail at the prebuild guard.

**Do not run `npm run build` in the agent sandbox.** `prebuild` →
`scripts/prebuild.mjs` phase 3 spawns a **vitest pool**, and spawning node
children fails there with EBUSY. Run the deploy where that works. The sandbox
used `npm run build:fast`, which skips the gate entirely: fine for inspecting
the emitted HTML, never acceptable for a deploy.

Credentials, from `.env` or the environment:

| Var | Why |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Workers Scripts:Edit — the deploy hard-fails without it |
| `CLOUDFLARE_ACCOUNT_ID` | same; also appears in the dashboard URL the script prints |
| `PUBLIC_PADDLE_ENVIRONMENT` | baked in at build time, defaults to `sandbox` — confirm before a production deploy |
| `PUBLIC_PADDLE_CLIENT_TOKEN`, `PUBLIC_LICENSE_API_URL` | baked in at build time |

## Deploy

```
bash scripts/wrangler-deploy.sh --message "auth-nav: pre-paint signed-in hint" --tag v0.0.42
```

- `--message` / `--tag` land in the Cloudflare dashboard's Version column. The
  default message is `Coding Agent — <sha> (<branch>)`, which is traceable but
  says nothing about *what* changed; prefer an explicit message.
- `SKIP_BUILD=1` re-deploys the existing `website/dist/`. Only use it after a
  successful build in the same tree — it will happily ship a stale bundle,
  and the inline hint script is invisible in the bundle listing.
- The script ends by running `website/scripts/verify-deploy.mjs`, which
  derives one origin per route in `website/wrangler.toml` and fetches each.
  **Do not set `SKIP_VERIFY=1` for a production deploy.** Measured 2026-09-23:
  `wrangler deploy` replaces the zone's whole route set with the `routes`
  array, which then omitted the apex, so every kasir.mu URL answered 522
  (~19.5 s) while `admin.kasir.mu` and `dashboard.kasir.mu` kept answering
  200 from the same Worker — and the deploy itself reported success. A
  healthy Worker with a missing route is invisible from the dashboard.

## Verify the fix landed

### 1 — the cookie is issued (no browser, no session needed)

```
curl -sD - -o /dev/null https://kasir.mu/__oz/session | grep -i '^set-cookie'
```

Signed out, this must show **no** `oz_signed_in=1` — an empty or absent
`oz_signed_in`. The signed-in direction cannot be checked this way without
borrowing a real session cookie, which is fine: the signed-out response is
the load-bearing half, because it proves the Worker is on the code path that
writes the header at all. A 200 body of `{"token":null}` with no
`oz_signed_in` is the signed-out steady state.

Then, in a real signed-in session, the same probe must show
`oz_signed_in=1; ...`. That is the fix.

### 2 — the bundle contains the pre-paint script

```
grep -c oz_signed_in website/dist/id/index.html    # expect >= 1
```

`Header.astro`'s `is:inline` script is what reads the cookie before first
paint. If this is 0, the deploy shipped an old bundle and every other check
is measuring the wrong build.

### 3 — in a browser, on a real signed-in session

- `document.cookie` contains `oz_signed_in=1`.
- Hard-reload a page: the **first** frame must already read the signed-in
  label, not "Sign in". Watch for the flip rather than the steady state — a
  correct second frame proves nothing.
- Log out, then confirm `oz_signed_in` is gone and the label is still
  correct. The Worker expires it on the logout redirect.

## If the cookie is not round-tripped

If step 1 shows no `Set-Cookie` on the JSON response, the hint is inert and
you are back to one flip per first view. Nothing is broken; the fix simply
is not in effect. Two options, in order of preference:

1. **Accept it.** The residual cost is one wrong-label frame on the first
   view of a session, roughly one round trip to `/__oz/session`. For a
   mostly-anonymous marketing site this is the correct answer, and it is what
   the pre-hint build did anyway.
2. **Move the hint onto the document response.** This closes the first load
   too, but a `Set-Cookie` on cacheable HTML forks the cache per session, or
   forces the HTML to stop being cached. Only worth it if a production
   measurement shows the flip is expensive enough to matter.

Do **not** "fix" it by having the page read the session cookie directly. It is
httpOnly by design; the hint exists precisely so the label can be painted
without that.

## Rollback

The reliable path is redeploying the pre-fix commit: `git switch --detach
<sha-before-257a4978b>` then `bash scripts/wrangler-deploy.sh` (a plain
`SKIP_BUILD=1` re-deploy is not a rollback, it re-serves whatever is in
`dist/`). `wrangler rollback` in `website/` is the faster route if the target
deployment is still in the Workers Versions list. Either way, re-run the
verify steps above afterwards — a rollback that restores an old bundle is
itself a wrong-build risk.

## Where the logic lives

| Concern | Where |
|---|---|
| The hint cookie, signed-in flag, expiry | `website/worker.ts` → `signedInHintHeader` |
| Pre-paint read of the cookie | `website/src/components/Header.astro` (`is:inline`) |
| Label application and revalidate | `website/src/lib/header-nav.ts` |
| Session ownership (single reader) | `website/src/lib/session.ts` |
| Cookie spelling pinned by test | `website/src/__tests__/worker.test.ts` |
| Listener set pinned by test | `website/src/components/__tests__/header-auth-nav.test.ts` |

`hasSession()` is not a header-only concern. It is re-exported from
`website/src/components/paddle.ts` (which re-exports it from
`../lib/session.ts`, the single owner of session state), and
`website/src/components/CheckoutButton.tsx:106` gates checkout on it:
`if (!(await hasSession()))`. That is why the fix removed a redundant probe
instead of caching the result — a cached `true` there is a checkout bypass,
whereas one fewer call has no failure mode.
