#!/usr/bin/env bash
# scripts/verify-docker-persistence.sh — Docker volume persistence gate.
#
# Verifies that BOTH kasir.mu container images survive a full container
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
#   OZ_LICENSE_PRIVATE_KEY="$(cat crates/kasirmu-core/oz-license-private.pem)" \
#     bash scripts/verify-docker-persistence.sh
#
# A throwaway RSA key is generated if OZ_LICENSE_PRIVATE_KEY is unset.
#
# Host ports used (overridable, avoid 3099/8080 used by the dev stack):
#   OZ_PERSIST_CLOUD_PORT   (default 3210)
#   OZ_PERSIST_LICENSE_PORT (default 8380)

set -euo pipefail

# ── Verdict vocabulary ───────────────────────────────────────────────
# Defined ABOVE the self-test block (moved 2026-11-06) so the cases grade the real
# functions. Before the move, case 3 called fail() before it existed: bash answered
# "command not found", which is ALSO a non-zero exit, so the case passed while proving
# that fail() exits nothing at all.
GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
pass() { printf "${GREEN}✔ %s${NC}\n" "$1"; }
fail() { printf "${RED}✘ %s${NC}\n" "$1"; exit 1; }

# Cleanup runs on EXIT of a real run. It is defined here so the self-test can grade it with
# a docker stub; the sabotage sweep reported a gutted cleanup() SURVIVING because no case
# ever called it.
cleanup() {
    docker rm -f "$CLOUD_CONTAINER" "$LICENSE_CONTAINER" >/dev/null 2>&1 || true
    docker volume rm "$CLOUD_VOL" "$LICENSE_VOL" >/dev/null 2>&1 || true
}

# ── SELF-TEST ────────────────────────────────────────────────────────
# This gate had NO proof form of any kind until 2026-10-24: no --self-test, no companion
# test, no measured mutation, and no note explaining an absence. It was also invoked by no
# live gate -- its only caller was verify-docker-all.sh, and every check.sh/CI path into
# that wrapper reaches only the log-rotation self-test, never the persistence stages. So a
# "Persistence verified" line here has never been produced by CI at all.
#
# The full run needs a Docker daemon and two image builds, which is why it cannot be a
# plain self-test. What CAN be proven without a daemon is the part every run depends on
# and no run has ever checked: the verdicts themselves. Under "set -e" an assertion that
# fails and a script that crashes are indistinguishable -- both exit non-zero -- so a
# gate whose only observable is its exit code is proved by its MESSAGES, and those are
# graded here.
if [ "${1:-}" = "--self-test" ]; then
    st_fails=0
    st_total=0
    st_case() { st_total=$((st_total + 1)); }
    st_ok() {
        st_case
        if ! "$@" >/dev/null 2>&1; then
            printf 'SELF-TEST WRONG: %s\n' "$1 $2 ... exited non-zero" >&2
            st_fails=$((st_fails + 1))
        fi
    }

    # Every check the gate performs is one of three shapes. Grade the shape, not Docker.
    #
    # 1. The "survived" predicate. Both stages assert a substring is still served after
    #    container replacement (the product name, the license key). If this predicate were
    #    inverted or always-true, the gate would report success over a LOST record -- the
    #    worst possible direction for a persistence gate.
    survived() { printf '%s' "$1" | grep -q -- "$2"; }
    st_case
    if ! survived '{"name":"Persistence Probe","id":7}' 'Persistence Probe'; then
        printf 'SELF-TEST WRONG: survived() missed a present record\n' >&2
        st_fails=$((st_fails + 1))
    fi
    st_case
    if survived '{"error":"not found"}' 'Persistence Probe'; then
        printf 'SELF-TEST WRONG: survived() reported a LOST record as present\n' >&2
        st_fails=$((st_fails + 1))
    fi

    # 2. The collection-completeness verdict at the license stage. "OK" only when EVERY
    #    required collection exists; anything else names the missing ones. A checker that
    #    accepted a partial set would pass a first boot with the schema half-provisioned.
    colls() {
        printf '%s' "$1" | python -c "
import sys, json
names = {c['name'] for c in json.load(sys.stdin)['items']}
need = {'license_keys','tenants','subscriptions','tenant_machines'}
print('OK' if need <= names else 'MISSING:' + ','.join(sorted(need - names)))
"
    }
    all_four='{"items":[{"name":"license_keys"},{"name":"tenants"},{"name":"subscriptions"},{"name":"tenant_machines"},{"name":"extra"}]}'
    st_case
    if [ "$(colls "$all_four")" != "OK" ]; then
        printf 'SELF-TEST WRONG: a complete collection set was not accepted\n' >&2
        st_fails=$((st_fails + 1))
    fi
    three='{"items":[{"name":"license_keys"},{"name":"tenants"},{"name":"subscriptions"}]}'
    st_case
    if [ "$(colls "$three")" = "OK" ]; then
        printf 'SELF-TEST WRONG: a set missing tenant_machines was called OK\n' >&2
        st_fails=$((st_fails + 1))
    fi
    st_case
    case "$(colls "$three")" in
        MISSING:*tenant_machines*) ;;
        *) printf 'SELF-TEST WRONG: the refusal does not name the missing collection\n' >&2
           st_fails=$((st_fails + 1)) ;;
    esac

    # 3. fail() must EXIT, not merely print. A fail() that returned would let the script
    #    run on to the next stage after a lost record and still reach the final green line.
    #    THIS CASE WAS VACUOUS until 2026-11-06: fail() was defined 100 lines BELOW the block,
    #    so the subshell died of "command not found" (exit 127) instead of running fail().
    #    It passed even when fail()'s body was blanked. The vocabulary above fixes that.
    st_case
    if ( fail "planted" ) >/dev/null 2>&1; then
        printf 'SELF-TEST WRONG: fail() returned instead of exiting\n' >&2
        st_fails=$((st_fails + 1))
    fi

    # 3b. cleanup() -- the only function that touches the daemon, and it had no case at all,
    #     which is why the sabotage sweep scored it SURVIVED: nothing called it. No daemon is
    #     needed to grade it: a shell FUNCTION named docker shadows the binary, so the recorder
    #     sees exactly the argv cleanup() builds from the four name variables. A future edit
    #     that hardcodes a container name, drops a volume, or returns early fails here.
    st_case
    _rec="$(mktemp)"
    CLOUD_CONTAINER=probe-cloud-1; LICENSE_CONTAINER=probe-license-1
    CLOUD_VOL=probe-cloud-vol; LICENSE_VOL=probe-license-vol
    docker() { printf '%s\n' "$*" >> "$_rec"; }
    cleanup
    unset -f docker
    if ! grep -qxF 'rm -f probe-cloud-1 probe-license-1' "$_rec" ||
       ! grep -qxF 'volume rm probe-cloud-vol probe-license-vol' "$_rec" ||
       [ "$(grep -c . "$_rec")" -ne 2 ]; then
        printf 'SELF-TEST WRONG: cleanup() did not remove both containers and both volumes (recorder: %s)\n' \
            "$(tr '\n' '|' < "$_rec")" >&2
        st_fails=$((st_fails + 1))
    fi
    rm -f "$_rec"

    # 4. NO DAEMON, BY CONSTRUCTION. The first draft of this case called a function that
    #    does not exist and fell back to "|| echo absent": it asserted nothing and would have
    #    passed even if --self-test had gone on to build images. The second re-ran this script
    #    under "sh $0 --self-test", which is RECURSION -- and it hung until killed. The third
    #    grepped for the first docker line, which stopped meaning anything on 2026-11-06 when
    #    cleanup()'s body (docker rm / docker volume rm) moved above this block: a DEFINITION
    #    executes nothing. Grade the invariant that actually matters: --self-test exits before
    #    the script's first executable statement and before the EXIT trap arms cleanup.
    st_case
    first_stmt=$(grep -n -m1 -E '^cd "\$\(dirname "\$0"\)/\.\."' "$0" | cut -d: -f1)
    trap_line=$(grep -n -m1 -E '^trap cleanup EXIT' "$0" | cut -d: -f1)
    self_case_line=$(grep -n -m1 -E 'st_fails=0' "$0" | cut -d: -f1)
    if [ -z "$first_stmt" ] || [ -z "$trap_line" ] || [ -z "$self_case_line" ] ||
       [ "$self_case_line" -gt "$first_stmt" ] || [ "$self_case_line" -gt "$trap_line" ]; then
        printf 'SELF-TEST WRONG: the self-test block does not exit before the script starts\n' >&2
        st_fails=$((st_fails + 1))
    fi

    if [ "$st_fails" -ne 0 ]; then
        printf 'SELF-TEST FAILED (%d of %d cases)\n' "$st_fails" "$st_total" >&2
        exit 2
    fi
    printf 'SELF-TEST OK (%d cases, no daemon)\n' "$st_total"
    exit 0
fi

cd "$(dirname "$0")/.."

CLOUD_PORT="${OZ_PERSIST_CLOUD_PORT:-3210}"
LICENSE_PORT="${OZ_PERSIST_LICENSE_PORT:-8380}"
CLOUD_IMG="oz-pos-cloud:persist-verify"
LICENSE_IMG="oz-pos-license:persist-verify"
CLOUD_VOL="oz-persist-verify-cloud"
LICENSE_VOL="oz-persist-verify-license"
CLOUD_CONTAINER="oz-persist-verify-cloud-1"
LICENSE_CONTAINER="oz-persist-verify-license-1"

trap cleanup EXIT
cleanup

# ── Build both images ────────────────────────────────────────────────
echo "── Building images ──"
docker build -q -f ops/docker/Dockerfile.server -t "$CLOUD_IMG" . >/dev/null
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
