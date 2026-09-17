#!/usr/bin/env bash
# ── OZ-POS Dev Up (Linux / macOS) ───────────────────────────────────
#
# One-command local development startup:
#   1. Resolves the compose-required secrets (JWT secret + admin key):
#      generated once into the gitignored repo .env, reused on every run
#   2. Starts PostgreSQL, Redis, license-server, cloud-server via Docker
#   3. Waits for all health checks to pass
#   4. Prints service URLs + next steps
#
# Usage:
#   bash scripts/dev-up.sh              # SQLite mode (default)
#   bash scripts/dev-up.sh --pg         # PostgreSQL mode
#   bash scripts/dev-up.sh --build      # Rebuild images before starting
#   bash scripts/dev-up.sh --down       # Stop and clean volumes

set -euo pipefail

# ── Parse flags ───────────────────────────────────────────────────
PG_MODE=false
BUILD=false
DOWN=false

for arg in "$@"; do
  case "$arg" in
    --pg)    PG_MODE=true ;;
    --build) BUILD=true ;;
    --down)  DOWN=true ;;
    *)       echo "Unknown flag: $arg"; echo "Usage: dev-up.sh [--pg] [--build] [--down]"; exit 1 ;;
  esac
done

# cd to repo root
cd "$(dirname "$0")/.."

# ── Tear-down mode ────────────────────────────────────────────────
if $DOWN; then
  echo "👋 Tearing down OZ-POS dev environment..."
  if $PG_MODE; then
    docker compose -f docker-compose.yml -f docker-compose.pg.yml down -v
  else
    docker compose down -v
  fi
  echo "✅ Done. Volumes removed."
  exit 0
fi

# ── Prerequisites check ───────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo "❌ Docker is required. Install from https://docker.com"
  exit 1
fi

# ── Generate the required secrets once, persist them, reuse on next run ──
#
# docker-compose.yml hard-requires OZ_API_SECRET (:55) and OZ_ADMIN_KEY (:70)
# with the fail-closed `:?` interpolation form. That requirement IS the fix:
# admin_key_authorised() in crates/kasirmu-api/src/routes/tokens.rs returns TRUE
# when no admin key is configured, so an unset OZ_ADMIN_KEY made
# POST /api/v1/tokens an unauthenticated mint. Compose refusing to parse
# without one must stay. What dev-up owes a developer is a value to run with,
# and it now supplies both the same way it always supplied OZ_API_SECRET.
#
# Where they persist: the repo-root .env — excluded by .gitignore:66, so a
# generated secret never lands in a tracked file. Compose reads that .env on
# its own, and reusing the stored value is what keeps already-minted tokens
# valid across restarts instead of rotating the signing key every run.
ENV_FILE=".env"
GENERATED_SECRETS=""

# new_secret_hex — 32 random bytes as 64 hex chars.
new_secret_hex() {
  if command -v openssl &>/dev/null; then
    openssl rand -hex 32
  else
    # Fallback without openssl: 32 bytes of /dev/urandom as hex = 64 chars.
    # (The previous uuidgen fallback produced only 32 hex chars, half the
    # intended 64-char secret strength.)
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

# _rewrite_env_line NAME VALUE — replace the existing NAME= line in $ENV_FILE
# in place, keeping every other line byte-for-byte. VALUE is passed through the
# environment, never interpolated into the script, so no metacharacter in it
# can rewrite anything but that one line.
_rewrite_env_line() {
  local name="$1"
  # umask 077 around the redirect: awk writes a NEW file, and without it that
  # temp copy of a secret file is created 0644 for the instant before mv.
  ( umask 077
    OZ_ENV_WRITE_VALUE="$2" awk -v key="$name" '
      { if (!done && $0 ~ "^[[:space:]]*" key "=") { print key "=" ENVIRON["OZ_ENV_WRITE_VALUE"]; done = 1 }
        else print }
    ' "$ENV_FILE" > "$ENV_FILE.tmp.$$" ) && mv "$ENV_FILE.tmp.$$" "$ENV_FILE"
}

# env_value NAME — print NAME's current exported value (empty if unset).
# Written as an explicit case instead of `${!name}` indirect expansion, which
# macOS still ships as bash 3.2, where that form combined with a `:-` default
# is unreliable. NAME is always one of the literal constants passed at the
# bottom of require_secret, never user input.
env_value() {
  case "$1" in
    OZ_API_SECRET)  printf '%s' "${OZ_API_SECRET:-}" ;;
    OZ_ADMIN_KEY)   printf '%s' "${OZ_ADMIN_KEY:-}" ;;
    *)              printf '' ;;
  esac
}

# require_secret NAME — guarantee NAME is exported and non-empty:
#   already exported      -> left alone (an operator or CI value wins)
#   non-empty in .env     -> reused, stable across restarts
#   neither               -> generated once, written to .env, then exported
require_secret() {
  local name="$1" value=""

  if [ -n "$(env_value "$name")" ]; then
    return 0
  fi

  if [ -f "$ENV_FILE" ]; then
    # In a dotenv file the last assignment wins, so take the final match,
    # then drop any wrapping quotes and stray whitespace.
    # `|| true`: under `set -euo pipefail` a grep that matches nothing
    # exits 1, which would abort dev-up here instead of falling through to
    # generate-and-persist — the common fresh-machine case.
    value=$(grep -E "^[[:space:]]*${name}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)
    value="${value%\"}"
    value="${value#\"}"
    value="$(printf '%s' "$value" | tr -d '[:space:]')"
  fi

  if [ -n "$value" ]; then
    export "$name=$value"
    echo "🔑 $name reused from $ENV_FILE"
    return 0
  fi

  value="$(new_secret_hex)"
  if [ "${#value}" -lt 64 ]; then
    echo "❌ Could not generate a 64-char hex secret for $name."
    exit 1
  fi

  # 0600 from the moment it exists: this file is about to hold signing keys.
  if [ ! -f "$ENV_FILE" ]; then
    (umask 077 && : > "$ENV_FILE")
  fi
  # Fill in place if the key is already listed with an empty value — that is
  # the shape a .env copied from .env.example has — instead of stacking a
  # second assignment under it. Otherwise append once.
  if [ -f "$ENV_FILE" ] && grep -qE "^[[:space:]]*${name}=" "$ENV_FILE"; then
    _rewrite_env_line "$name" "$value"
  else
    # An append onto a file with no trailing newline would glue the new key
    # onto the last line and corrupt both, so make sure one is there.
    if [ -s "$ENV_FILE" ] && [ -n "$(tail -c 1 "$ENV_FILE")" ]; then
      printf '\n' >> "$ENV_FILE"
    fi
    printf '%s=%s\n' "$name" "$value" >> "$ENV_FILE"
  fi
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  export "$name=$value"
  # Only the NAME is recorded for the summary line — never the value, since
  # this output is captured in CI logs.
  GENERATED_SECRETS="$GENERATED_SECRETS $name"
}

require_secret OZ_API_SECRET
require_secret OZ_ADMIN_KEY

if [ -n "$GENERATED_SECRETS" ]; then
  echo "🧪 LOCAL DEV ONLY — scripts/dev-up.sh generated$GENERATED_SECRETS into the gitignored $ENV_FILE. These are throwaway values for THIS MACHINE, not production credentials: replace them before deploying anywhere."
fi

# ── Check license key ─────────────────────────────────────────────
LICENSE_KEY_PATH="crates/kasirmu-core/oz-license-private.pem"
if [ -z "${OZ_LICENSE_PRIVATE_KEY:-}" ]; then
  if [ -f "$LICENSE_KEY_PATH" ]; then
    export OZ_LICENSE_PRIVATE_KEY=$(cat "$LICENSE_KEY_PATH")
    echo "🔑 Loaded OZ_LICENSE_PRIVATE_KEY from $LICENSE_KEY_PATH"
  else
    echo "⚠️  OZ_LICENSE_PRIVATE_KEY not set and $LICENSE_KEY_PATH not found."
    echo "   Generate keys: bash scripts/generate-license-keys.sh"
  fi
fi

# ── Build (optional) ──────────────────────────────────────────────
if $BUILD; then
  echo "🔨 Building Docker images..."
  if $PG_MODE; then
    docker compose -f docker-compose.yml -f docker-compose.pg.yml build
  else
    docker compose build
  fi
fi

# ── Start services ────────────────────────────────────────────────
echo "🚀 Starting OZ-POS backend services..."
if $PG_MODE; then
  docker compose -f docker-compose.yml -f docker-compose.pg.yml up -d
else
  docker compose up -d
fi

# ── Wait for health checks ────────────────────────────────────────
echo "⏳ Waiting for services to become healthy..."

SERVICES="redis license-server pos-cloud-server"
if $PG_MODE; then SERVICES="redis pos-cloud-db license-server pos-cloud-server"; fi

TIMEOUT=120
ELAPSED=0
INTERVAL=3

while [ $ELAPSED -lt $TIMEOUT ]; do
  ALL_HEALTHY=true
  for SVC in $SERVICES; do
    STATUS=$(docker compose ps --format json "$SVC" 2>/dev/null | grep -o '"Health":"[^"]*"' | cut -d'"' -f4)
    if [ "$STATUS" != "healthy" ]; then
      ALL_HEALTHY=false
      break
    fi
  done
  if $ALL_HEALTHY; then break; fi
  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
done

if [ $ELAPSED -ge $TIMEOUT ]; then
  echo "⚠️  Health check timeout after ${TIMEOUT}s. Check logs: docker compose logs"
else
  echo "✅ All services healthy (${ELAPSED}s)"
fi

# ── Print service URLs ────────────────────────────────────────────
API_PORT="${OZ_API_PORT:-3099}"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  OZ-POS Backend — Ready                                  ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Cloud Server:    http://localhost:$API_PORT/api/health  ║"
echo "║  License Server:  http://localhost:8080/api/health       ║"
echo "║  Redis:           localhost:6379                         ║"
if $PG_MODE; then
  echo "║  PostgreSQL:      localhost:5432 (ozpos/ozpos)           ║"
fi
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Start desktop app: scripts/start-desktop.bat (cargo run)║"
echo "║  Stop services:    bash scripts/dev-up.sh --down         ║"
echo "║  View logs:        docker compose logs -f                ║"
echo "╚══════════════════════════════════════════════════════════╝"
