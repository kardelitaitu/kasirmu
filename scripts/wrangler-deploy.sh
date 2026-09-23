#!/usr/bin/env bash
# scripts/wrangler-deploy.sh — Build + deploy the OZ-POS website to Cloudflare Workers.
#
# Usage:
#   bash scripts/wrangler-deploy.sh [--message "My deploy note"] [--tag v1.2.3]
#
# The --message value appears in the Cloudflare dashboard under
# Workers → oz-pos → Deployments → "Version" column. Defaults to
# "Coding Agent — <git sha> (<branch>)" so every deploy is traceable
# without logging into GitHub.
#
# Required env vars (can be set in .env or exported before calling):
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

echo "🚀  OZ-POS Website Deploy"
echo "    Message : ${DEPLOY_MESSAGE}"
[[ -n "$DEPLOY_TAG" ]] && echo "    Tag     : ${DEPLOY_TAG}"
echo "    Account : ${CLOUDFLARE_ACCOUNT_ID}"
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
