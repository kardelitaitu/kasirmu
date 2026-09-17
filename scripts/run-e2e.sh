#!/usr/bin/env bash
# ── OZ-POS E2E Test Runner ────────────────────────────────────────────
#
# Orchestrates the full E2E test suite:
#   1. Start Docker backend (cloud server, license server, Redis)
#   2. Start Vite dev server (with Tauri IPC mock)
#   3. Run Playwright tests (UI + API)
#   4. Cleanup and report results
#
# Usage:
#   bash scripts/run-e2e.sh                    # full suite
#   bash scripts/run-e2e.sh --headed           # watch browser
#   bash scripts/run-e2e.sh --api-only         # API tests only
#   bash scripts/run-e2e.sh --ui-only          # UI tests only
#   bash scripts/run-e2e.sh --no-docker        # skip Docker (use existing servers)
#
# Prerequisites:
#   - Docker & Docker Compose
#   - Node.js >= 22
#   - Playwright browsers installed (npx playwright install chromium)
#   - License keys generated (scripts/generate-license-keys.sh)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
UI_DIR="$ROOT_DIR/ui"

# ── Parse arguments ──────────────────────────────────────────────────
HEADED=false
API_ONLY=false
UI_ONLY=false
NO_DOCKER=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --headed) HEADED=true; shift ;;
    --api-only) API_ONLY=true; shift ;;
    --ui-only) UI_ONLY=true; shift ;;
    --no-docker) NO_DOCKER=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Cleanup handler ──────────────────────────────────────────────────
cleanup() {
  echo ""
  echo "==> Cleaning up..."

  # Kill Vite dev server if running.
  if [ -n "${VITE_PID:-}" ]; then
    echo "    Stopping Vite dev server (PID $VITE_PID)..."
    kill "$VITE_PID" 2>/dev/null || true
    wait "$VITE_PID" 2>/dev/null || true
  fi

  # Stop Docker services (only if we started them).
  if [ "$NO_DOCKER" = false ]; then
    echo "    Stopping Docker E2E services..."
    docker compose -f "$ROOT_DIR/docker-compose.e2e.yml" down -v 2>/dev/null || true
  fi

  echo "    Done."
}

trap cleanup EXIT SIGINT SIGTERM

# ── Step 1: Start Docker backend ─────────────────────────────────────
if [ "$NO_DOCKER" = false ]; then
  echo "==> Step 1: Starting Docker E2E backend..."

  # Check if Docker is available.
  if ! command -v docker &>/dev/null; then
    echo "    ERROR: Docker is not installed. Install it first."
    exit 1
  fi

  # Check if license private key is set (required by license server).
  if [ -z "${OZ_LICENSE_PRIVATE_KEY:-}" ]; then
    KEY_FILE="$ROOT_DIR/crates/kasirmu-core/oz-license-private.pem"
    if [ -f "$KEY_FILE" ]; then
      echo "    Reading license key from $KEY_FILE"
      export OZ_LICENSE_PRIVATE_KEY=$(cat "$KEY_FILE")
    else
      echo "    WARNING: OZ_LICENSE_PRIVATE_KEY not set. License server may fail."
      echo "    Generate keys: bash $ROOT_DIR/scripts/generate-license-keys.sh"
    fi
  fi

  docker compose -f "$ROOT_DIR/docker-compose.e2e.yml" up -d

  echo "    Waiting for services to become healthy..."
  echo "    (this may take 30-60s on first build)"

  # Wait for cloud server healthcheck.
  echo -n "    Waiting for cloud server..."
  for i in $(seq 1 30); do
    if curl -sf http://localhost:3099/api/v1/health > /dev/null 2>&1; then
      echo " ready (attempt $i)"
      break
    fi
    if [ "$i" -eq 30 ]; then
      echo " FAILED (attempt $i)"
      echo "    Check docker logs:"
      docker compose -f "$ROOT_DIR/docker-compose.e2e.yml" logs e2e-cloud-server --tail=20
      exit 1
    fi
    echo -n "."
    sleep 2
  done

  # Wait for license server healthcheck.
  echo -n "    Waiting for license server..."
  for i in $(seq 1 15); do
    if curl -sf http://localhost:8080/api/health > /dev/null 2>&1; then
      echo " ready (attempt $i)"
      break
    fi
    if [ "$i" -eq 15 ]; then
      echo " FAILED (attempt $i) — continuing without license server"
    fi
    echo -n "."
    sleep 2
  done
fi

# ── Step 2: Start Vite dev server ────────────────────────────────────
if [ "$API_ONLY" = false ]; then
  echo "==> Step 2: Starting Vite dev server..."

  cd "$UI_DIR"

  # Kill any leftover Vite process on port 1420.
  lsof -ti:1420 | xargs kill -9 2>/dev/null || true
  sleep 1

  # Start Vite in background.
  npm run dev &
  VITE_PID=$!

  # Wait for Vite to be ready.
  echo -n "    Waiting for Vite dev server..."
  for i in $(seq 1 30); do
    if curl -sf http://localhost:1420 > /dev/null 2>&1; then
      echo " ready (attempt $i)"
      break
    fi
    if [ "$i" -eq 30 ]; then
      echo " FAILED (attempt $i)"
      exit 1
    fi
    echo -n "."
    sleep 2
  done
fi

# ── Step 3: Run Playwright tests ──────────────────────────────────────
echo "==> Step 3: Running Playwright tests..."

cd "$UI_DIR"

PLAYWRIGHT_ARGS="--config e2e/playwright.config.ts"

if [ "$HEADED" = true ]; then
  PLAYWRIGHT_ARGS="$PLAYWRIGHT_ARGS --headed"
fi

PLAYWRIGHT_FILES=""

if [ "$API_ONLY" = true ]; then
  PLAYWRIGHT_FILES="e2e/api.spec.ts"
elif [ "$UI_ONLY" = true ]; then
  # Pass all spec files except api.spec.ts as positional arguments.
  PLAYWRIGHT_FILES="e2e/auth.spec.ts e2e/sale.spec.ts e2e/product.spec.ts e2e/shift.spec.ts e2e/settings.spec.ts"
fi

echo "    Running: npx playwright test $PLAYWRIGHT_ARGS $PLAYWRIGHT_FILES"
npx playwright test $PLAYWRIGHT_ARGS $PLAYWRIGHT_FILES

# ── Report ────────────────────────────────────────────────────────────
echo ""
echo "==> E2E tests complete!"
echo "    Results saved to: $UI_DIR/e2e-results/"
echo ""
echo "    To view the HTML report:"
echo "      npx playwright show-report ui/e2e-results/html"
