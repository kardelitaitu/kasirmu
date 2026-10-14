#!/usr/bin/env bash
# scripts/wrangler-deploy.sh — Build + deploy the kasir.mu website to Cloudflare Workers.
#
# Usage:
#   bash scripts/wrangler-deploy.sh [--message "My deploy note"] [--tag v1.2.3]
#
# The --message value appears in the Cloudflare dashboard under
# Workers → oz-pos → Deployments → "Version" column. Defaults to
# "Coding Agent — <git sha> (<branch>)" so every deploy is traceable
# without logging into GitHub.
#
# Required env vars (read from the repo-root .env when not already in the
# environment, or export them before calling):
#   CLOUDFLARE_API_TOKEN   — Workers Scripts:Edit token
#   CLOUDFLARE_ACCOUNT_ID  — Cloudflare account id
#
# Optional env vars:
#   PUBLIC_LICENSE_API_URL      — baked into the Astro bundle at build time
#   PUBLIC_PADDLE_CLIENT_TOKEN  — Paddle.js v2 client token
#   PUBLIC_PADDLE_ENVIRONMENT   — "sandbox" (default) or "production"
#   DEPLOY_MESSAGE              — override the auto-generated message
#   DEPLOY_TAG                  — set a short version tag (e.g. "v0.0.31")
#   SKIP_BUILD                  — set to "1" to skip npm run build (re-deploy existing dist/)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WEBSITE_DIR="$REPO_ROOT/website"

# ── Read the repo-root .env ───────────────────────────────────────────
# The header and the error message below have always said "can be set in
# .env", but nothing here ever read the file: a perfectly correct .env
# produced the "must be set" exit and the message blamed the caller.
# Measured 2026-10-12 with credentials present and correct in ./.env.
#
# Deliberately NOT `source .env`: that executes the file, and one malformed
# line anywhere in it (an unquoted space, a stray backtick) would kill the
# deploy under `set -e` with an error naming neither the var nor the line.
# This extracts only the two names this script needs and never evaluates
# the rest. A real environment variable always wins — the .env is a
# fallback, so `CLOUDFLARE_API_TOKEN=x bash …` still overrides it.
dotenv_get() { # dotenv_get <KEY> — print the value, or nothing
  local key="$1"
  [ -f "$REPO_ROOT/.env" ] || return 0
  sed -n "s/^[[:space:]]*\(export[[:space:]]\+\)\?${key}[[:space:]]*=[[:space:]]*//p" \
    "$REPO_ROOT/.env" | head -1 \
    | sed -e 's/[[:space:]]*$//' -e 's/\r$//' \
          -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

: "${CLOUDFLARE_API_TOKEN:=$(dotenv_get CLOUDFLARE_API_TOKEN)}"
: "${CLOUDFLARE_ACCOUNT_ID:=$(dotenv_get CLOUDFLARE_ACCOUNT_ID)}"

# ── Parse optional CLI flags ─────────────────────────────────────────
EXTRA_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --message)  DEPLOY_MESSAGE="${2:-}"; shift 2 ;;
    --tag)      DEPLOY_TAG="${2:-}";     shift 2 ;;
    --skip-build) SKIP_BUILD="1";        shift   ;;
    *) EXTRA_ARGS+=("$1");               shift   ;;
  esac
done

# ── Credential check ─────────────────────────────────────────────────
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]] || [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "❌  CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set."
  echo "    Export them or add them to your .env file and re-run."
  exit 1
fi

# ── Auto-generate deploy message ─────────────────────────────────────
GIT_SHA="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")"
GIT_BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")"
DEPLOY_MESSAGE="${DEPLOY_MESSAGE:-"Coding Agent — ${GIT_SHA} (${GIT_BRANCH})"}"
DEPLOY_TAG="${DEPLOY_TAG:-}"

echo "🚀  kasir.mu Website Deploy"
echo "    Message : ${DEPLOY_MESSAGE}"
[[ -n "$DEPLOY_TAG" ]] && echo "    Tag     : ${DEPLOY_TAG}"
echo "    Account : ${CLOUDFLARE_ACCOUNT_ID}"
# Announce the toolchain. `node` inside a build can differ from the one the
# calling shell reports -- most often because the deploy is run from WSL
# while the version check was run in a Windows shell. Measured 2026-10-12:
# `node --version` reported v22.23.2 in the Windows window while the build
# itself ran under WSL's apt node v18.19.1, and nothing in the output said so.
# The website needs >= 22.6 (see root .nvmrc), so this line is the first
# place to look when prebuild complains about `--experimental-strip-types`.
echo "    Node    : $(node --version 2>/dev/null || echo 'not on PATH') ($(command -v node 2>/dev/null || echo '?'))"
echo "    npm     : $(npm --version 2>/dev/null || echo 'not on PATH')"
echo ""

# ── Build ─────────────────────────────────────────────────────────────
if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  echo "🔨  Building Astro site…"
  cd "$WEBSITE_DIR"
  PUBLIC_LICENSE_API_URL="${PUBLIC_LICENSE_API_URL:-}" \
  PUBLIC_PADDLE_CLIENT_TOKEN="${PUBLIC_PADDLE_CLIENT_TOKEN:-}" \
  PUBLIC_PADDLE_ENVIRONMENT="${PUBLIC_PADDLE_ENVIRONMENT:-sandbox}" \
  npm run build
  echo ""
fi

# ── Deploy ────────────────────────────────────────────────────────────
echo "☁️   Deploying to Cloudflare Workers…"
cd "$WEBSITE_DIR"

WRANGLER_ARGS=(
  "--message" "${DEPLOY_MESSAGE}"
)
[[ -n "$DEPLOY_TAG" ]] && WRANGLER_ARGS+=("--tag" "${DEPLOY_TAG}")
# Pass through any extra flags (e.g. --env staging)
WRANGLER_ARGS+=("${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}")

CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN}" \
CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID}" \
npx wrangler deploy "${WRANGLER_ARGS[@]}"

echo ""

# ── Verify ───────────────────────────────────────────────────────────
# `wrangler deploy` reports success even when it has just replaced the zone's
# route set with the `routes` array in wrangler.toml — which on 2026-09-23
# deleted the apex kasir.mu/* route it did not name, and the site answered 522
# on every URL while the Worker itself was healthy. The guard fetches one
# origin per declared route, so a route that did not survive the deploy fails
# the deploy. Set SKIP_VERIFY=1 to skip it (e.g. when deploying to a host that
# is not publicly resolvable yet).
if [[ "${SKIP_VERIFY:-0}" != "1" ]]; then
  echo "🔎  Verifying the deployed routes answer…"
  node "$WEBSITE_DIR/scripts/verify-deploy.mjs"
  echo ""
fi

echo "✅  Deploy complete!"
echo "    View at: https://dash.cloudflare.com/${CLOUDFLARE_ACCOUNT_ID}/workers/services/view/oz-pos"
