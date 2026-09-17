#!/usr/bin/env bash
# scripts/verify-docker-persistence.sh — Docker volume persistence gate.
#
# Verifies that BOTH OZ-POS container images survive a full container
# replacement on their named volumes, exactly as production restarts them:
#
#   cloud   — SQLite at OZ_DB_PATH=/data/kasir.db on a named volume.
#             Creates a product via the API, replaces the container,
#             asserts the product is still readable.
#   license — PocketBase at /pb/pb_data on a named volume. Creates a
#             superuser + a license key record, replaces the container,
#             asserts the key survived and the superuser still authenticates.
#
# Usage:
#   OZ_LICENSE_PRIVATE_KEY="$(cat crates/oz-core/oz-license-private.pem)" \
#     bash scripts/verify-docker-persistence.sh
#
# A throwaway RSA key is generated if OZ_LICENSE_PRIVATE_KEY is unset.
#
# Host ports used (overridable, avoid 3099/8080 used by the dev stack):
#   OZ_PERSIST_CLOUD_PORT   (default 3210)
#   OZ_PERSIST_LICENSE_PORT (default 8380)

set -euo pipefail
cd "$(dirname "$0")/.."

CLOUD_PORT="${OZ_PERSIST_CLOUD_PORT:-3210}"
LICENSE_PORT="${OZ_PERSIST_LICENSE_PORT:-8380}"
CLOUD_IMG="oz-pos-cloud:persist-verify"
LICENSE_IMG="oz-pos-license:persist-verify"
CLOUD_VOL="oz-persist-verify-cloud"
LICENSE_VOL="oz-persist-verify-license"
CLOUD_CONTAINER="oz-persist-verify-cloud-1"
LICENSE_CONTAINER="oz-persist-verify-license-1"

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
pass() { printf "${GREEN}✔ %s${NC}\n" "$1"; }
fail() { printf "${RED}✘ %s${NC}\n" "$1"; exit 1; }

cleanup() {
    docker rm -f "$CLOUD_CONTAINER" "$LICENSE_CONTAINER" >/dev/null 2>&1 || true
    docker volume rm "$CLOUD_VOL" "$LICENSE_VOL" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

# ── Build both images ────────────────────────────────────────────────
echo "── Building images ──"
docker build -q -f Dockerfile.server -t "$CLOUD_IMG" . >/dev/null
echo "cloud image built"
docker build -q -f apps/license-server/Dockerfile -t "$LICENSE_IMG" apps/license-server >/dev/null
echo "license image built"

# ── License key (throwaway if not provided) ─────────────────────────
if [ -z "${OZ_LICENSE_PRIVATE_KEY:-}" ]; then
    OZ_LICENSE_PRIVATE_KEY=$(openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 2>/dev/null | awk '{printf "%s\\n", $0}')
fi

# ═══════════════════════════════════════════════════════════════════
# PART 1 — Cloud server (SQLite persistence)
# ═══════════════════════════════════════════════════════════════════
echo "── Cloud: boot on fresh volume ──"
docker volume create "$CLOUD_VOL" >/dev/null
MSYS_NO_PATHCONV=1 docker run -d --name "$CLOUD_CONTAINER" \
    -v "$CLOUD_VOL:/data" \
    -e OZ_DB_PATH=/data/kasir.db \
    -e OZ_API_SECRET=persist-test-secret \
    -e OZ_API_PORT="$CLOUD_PORT" \
    -p "$CLOUD_PORT:$CLOUD_PORT" \
    "$CLOUD_IMG" >/dev/null

for i in $(seq 1 30); do
    if curl -sf "http://localhost:$CLOUD_PORT/api/v1/health" >/dev/null 2>&1; then break; fi
    [ "$i" -eq 30 ] && { docker logs "$CLOUD_CONTAINER" 2>&1 | tail -20; fail "cloud never became healthy"; }
    sleep 1
done
pass "cloud healthy"

# Create a product via the API.
TOKEN=$(curl -sf -X POST "http://localhost:$CLOUD_PORT/api/v1/tokens" \
    -H "Content-Type: application/json" \
    -d '{"label":"persist-verify","expiry_hours":1}' | python -c "import sys,json; print(json.load(sys.stdin)['token']['token'])")
PRODUCT_ID=$(curl -sf -X POST "http://localhost:$CLOUD_PORT/api/v1/products" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"sku":"PERSIST-VERIFY-001","name":"Persistence Probe","price":{"minor_units":1234,"currency":"USD"}}' \
    | python -c "import sys,json; print(json.load(sys.stdin)['id'])")
pass "product created ($PRODUCT_ID)"

echo "── Cloud: replace container on same volume ──"
docker rm -f "$CLOUD_CONTAINER" >/dev/null
MSYS_NO_PATHCONV=1 docker run -d --name "$CLOUD_CONTAINER" \
    -v "$CLOUD_VOL:/data" \
    -e OZ_DB_PATH=/data/kasir.db \
    -e OZ_API_SECRET=persist-test-secret \
    -e OZ_API_PORT="$CLOUD_PORT" \
    -p "$CLOUD_PORT:$CLOUD_PORT" \
    "$CLOUD_IMG" >/dev/null
for i in $(seq 1 30); do
    if curl -sf "http://localhost:$CLOUD_PORT/api/v1/health" >/dev/null 2>&1; then break; fi
    [ "$i" -eq 30 ] && fail "cloud did not recover after restart"
    sleep 1
done
TOKEN2=$(curl -sf -X POST "http://localhost:$CLOUD_PORT/api/v1/tokens" \
    -H "Content-Type: application/json" \
    -d '{"label":"persist-verify-2","expiry_hours":1}' | python -c "import sys,json; print(json.load(sys.stdin)['token']['token'])")
if curl -sf "http://localhost:$CLOUD_PORT/api/v1/products/PERSIST-VERIFY-001" \
    -H "Authorization: Bearer $TOKEN2" | grep -q "Persistence Probe"; then
    pass "cloud product survived restart"
else
    fail "cloud product LOST after restart"
fi
docker rm -f "$CLOUD_CONTAINER" >/dev/null
docker volume rm "$CLOUD_VOL" >/dev/null 2>&1

# ═══════════════════════════════════════════════════════════════════
# PART 2 — License server (PocketBase persistence + first-boot schema)
# ═══════════════════════════════════════════════════════════════════
echo "── License: boot on fresh volume (auto-provision check) ──"
docker volume create "$LICENSE_VOL" >/dev/null
MSYS_NO_PATHCONV=1 docker run -d --name "$LICENSE_CONTAINER" \
    -v "$LICENSE_VOL:/pb/pb_data" \
    -e "OZ_LICENSE_PRIVATE_KEY=$OZ_LICENSE_PRIVATE_KEY" \
    -e PADDLE_WEBHOOK_SECRET=dummy \
    -e PADDLE_PRICE_TIERS=pri_dummy:pro \
    -e MIDTRANS_SERVER_KEY=dummy-server-key \
    -e MIDTRANS_PRICE_TIERS=99000:free:month,149000:plus:month \
    -p "$LICENSE_PORT:8080" \
    "$LICENSE_IMG" >/dev/null

for i in $(seq 1 30); do
    if curl -sf "http://localhost:$LICENSE_PORT/api/health" >/dev/null 2>&1; then break; fi
    [ "$i" -eq 30 ] && { docker logs "$LICENSE_CONTAINER" 2>&1 | tail -20; fail "license never became healthy"; }
    sleep 1
done
pass "license healthy"

# First-boot auto-provision: collections must exist WITHOUT a manual import.
MSYS_NO_PATHCONV=1 docker exec "$LICENSE_CONTAINER" /pb/pocketbase superuser upsert admin@persist.test StrongPass-123 >/dev/null 2>&1
LIC_TOKEN=$(curl -sf -X POST "http://localhost:$LICENSE_PORT/api/collections/_superusers/auth-with-password" \
    -H "Content-Type: application/json" \
    -d '{"identity":"admin@persist.test","password":"StrongPass-123"}' \
    | python -c "import sys,json; print(json.load(sys.stdin)['token'])")
COLLS=$(curl -sf "http://localhost:$LICENSE_PORT/api/collections" \
    -H "Authorization: Bearer $LIC_TOKEN" | python -c "
import sys,json
names = {c['name'] for c in json.load(sys.stdin)['items']}
need = {'license_keys','tenants','subscriptions','tenant_machines'}
print('OK' if need <= names else 'MISSING:' + ','.join(sorted(need - names)))
")
[ "$COLLS" = "OK" ] || fail "license collections not auto-provisioned: $COLLS"
pass "license collections auto-provisioned on first boot"

# Create a license key record.
KEY_ID=$(curl -sf -X POST "http://localhost:$LICENSE_PORT/api/collections/license_keys/records" \
    -H "Authorization: Bearer $LIC_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"key":"OZ-PERSIST-VERIFY-001","tier_key":"pro","status":"unused","max_stores":2,"max_pos_instances":3,"allowed_types":["restaurant-pos","store-pos"],"expires_at":"2027-08-03 00:00:00.000Z"}' \
    | python -c "import sys,json; print(json.load(sys.stdin)['id'])")
pass "license key created ($KEY_ID)"

echo "── License: replace container on same volume ──"
docker rm -f "$LICENSE_CONTAINER" >/dev/null
MSYS_NO_PATHCONV=1 docker run -d --name "$LICENSE_CONTAINER" \
    -v "$LICENSE_VOL:/pb/pb_data" \
    -e "OZ_LICENSE_PRIVATE_KEY=$OZ_LICENSE_PRIVATE_KEY" \
    -e PADDLE_WEBHOOK_SECRET=dummy \
    -e PADDLE_PRICE_TIERS=pri_dummy:pro \
    -e MIDTRANS_SERVER_KEY=dummy-server-key \
    -e MIDTRANS_PRICE_TIERS=99000:free:month,149000:plus:month \
    -p "$LICENSE_PORT:8080" \
    "$LICENSE_IMG" >/dev/null
for i in $(seq 1 30); do
    if curl -sf "http://localhost:$LICENSE_PORT/api/health" >/dev/null 2>&1; then break; fi
    [ "$i" -eq 30 ] && fail "license did not recover after restart"
    sleep 1
done
LIC_TOKEN2=$(curl -sf -X POST "http://localhost:$LICENSE_PORT/api/collections/_superusers/auth-with-password" \
    -H "Content-Type: application/json" \
    -d '{"identity":"admin@persist.test","password":"StrongPass-123"}' \
    | python -c "import sys,json; print(json.load(sys.stdin)['token'])")
if curl -sf "http://localhost:$LICENSE_PORT/api/collections/license_keys/records" \
    -H "Authorization: Bearer $LIC_TOKEN2" | grep -q "OZ-PERSIST-VERIFY-001"; then
    pass "license key survived restart"
else
    fail "license key LOST after restart"
fi

echo
printf "${GREEN}✔ Persistence verified: cloud SQLite + license PocketBase both survive container replacement.${NC}\n"
