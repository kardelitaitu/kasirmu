#!/usr/bin/env bash
# scripts/verify-docker-digests.sh — pinned-image digest drift gate.
#
# Re-resolves every `image:tag@sha256:...` reference pinned across the
# kasir.mu Dockerfiles and Compose files (DOCKER-02) and fails when any
# upstream tag now resolves to a DIFFERENT digest than what the repo pins.
#
# The pinning policy (see .trivyignore and Dockerfile comments) is: pin
# immutable multi-arch index digests, refresh deliberately via a
# dependency-update process. This gate automates the "deliberate" part,
# BUT NOTHING RUNS IT — pins DO silently rot and nobody is alerted.
#
#   Measured 2026-09-16: the only reference to this script anywhere is
#   .github/workflows/attic/docker-digest-drift.yml.bak:37, and that file is a
#   RETIRED workflow (its own header still advertises cron "0 5 * * 1",
#   Mondays 05:00, in inert .bak text GitHub never executes). A grep of
#   "verify-docker-digests" across scripts/check.sh, scripts/gates.json,
#   .github/workflows/*.yml and .githooks/ returns ZERO hits: no schedule,
#   no PR gate, no pre-commit step, no pre-push step calls this gate.
#
#   The one other live caller, scripts/verify-docker-all.sh:57, is itself
#   called by nothing in those four places either — so the honest state is
#   "manual script", not "gate". Run it by hand before refreshing a pin.
#
# Usage:
#   bash scripts/verify-docker-digests.sh
#
# Requires a Docker daemon with BuildKit (docker buildx imagetools).
# Exit 0 = all pins current. Exit 1 = drift detected (references listed).

set -euo pipefail
cd "$(dirname "$0")/.."

# Files that carry `image:tag@sha256:...` pins (DOCKER-02).
FILES=(
    "ops/docker/Dockerfile.server"
    "ops/docker/Dockerfile.unified"
    "apps/license-server/Dockerfile"
    "ops/docker/docker-compose.yml"
    "ops/docker/docker-compose.pg.yml"
    "ops/docker/docker-compose.e2e.yml"
)

# The pin pattern, named once so the self-test grades the SAME regex the live scan
# uses instead of a copy of it.
PIN_RE='[A-Za-z0-9._/-]+:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}'

drift=0
pins_seen=0
declare -a drift_lines=()

# ── Self-test ─────────────────────────────────────────────────────────────────
#
# This gate's whole answer is "every pin still resolves to what we pinned". Its
# SILENT failure is the same sentence printed over a scan that read NOTHING: if the
# pin pattern stops matching (a pin format change, a file moved, a grep narrowed),
# the loop below runs zero times, drift stays 0, and the gate reports
# "All pinned image digests are current." -- a clean bill of health on the supply
# chain, which is the worst place to be wrong.
#
# MEASURED 2026-10-23: pointing the pattern at nothing produced exactly that, exit 0.
self_test() {
    local fails=0 total=0

    n_pins() { printf '%s\n' "$1" | grep -oE "$PIN_RE" | wc -l | tr -d ' '; }

    chk() {
        local label="$1" want="$2" got="$3"
        total=$((total + 1))
        if [ "$got" != "$want" ]; then
            printf '  FAIL %s: expected %s, got %s\n' "$label" "$want" "$got" >&2
            fails=$((fails + 1))
        fi
    }

    local d64="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

    chk "a registry-hosted pin is found" 1 "$(n_pins "FROM docker.io/library/node:22@sha256:$d64")"
    chk "a bare pin is found" 1 "$(n_pins "image: nginx:1.27@sha256:$d64")"
    chk "two pins on one line" 2 "$(n_pins "a:1@sha256:$d64 b:2@sha256:$d64")"

    # A TAG WITHOUT A DIGEST is not a pin. Counting it would let an unpinned image
    # read as pinned, which is the opposite of this gate's job.
    chk "a tag without a digest is not a pin" 0 "$(n_pins "image: nginx:latest")"
    # A TRUNCATED digest is not a pin: 64 hex chars are required.
    chk "a truncated digest is not a pin" 0 "$(n_pins "image: nginx:1.27@sha256:0123456789abcdef")"
    # Digest-only (no tag) does not match, and that is stated rather than hidden.
    chk "a digest-only reference is not matched" 0 "$(n_pins "image: nginx@sha256:$d64")"

    chk "identical digests agree" same "$( [ "$d64" = "$d64" ] && echo same || echo diff )"
    local other="ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    chk "different digests are drift" diff "$( [ "$d64" = "$other" ] && echo same || echo diff )"

    if [ "$fails" -gt 0 ]; then
        printf 'SELF-TEST FAILED (%d of %d cases)\n' "$fails" "$total" >&2
        return 2
    fi
    printf 'SELF-TEST OK (%d cases, no daemon)\n' "$total"
    return 0
}

if [ "${1:-}" = "--self-test" ]; then
    self_test
    exit $?
fi

self_test || { echo "DETECTOR WENT DEAF: not trusting the digest scan below." >&2; exit 2; }

echo "── Resolving pinned image digests ──"
for f in "${FILES[@]}"; do
    [ -f "$f" ] || continue
    # Match `repo:tag@sha256:hex` (also handles registry-hosted repos).
    while IFS= read -r ref; do
        [ -n "$ref" ] || continue
        pins_seen=$((pins_seen + 1))
        tag="${ref%@*}"
        pinned="${ref#*@sha256:}"
        # Resolve the CURRENT multi-arch index digest for the mutable tag.
        # Retry up to 5x with growing backoff — the weekly job runs against
        # a cold registry connection and registries (esp. public ECR) can
        # 429-rate-limit bursts for 30-60s; transient errors must not
        # false-alarm. The error is echoed on the last attempt for clarity.
        current=""
        for attempt in 1 2 3 4 5; do
            err=$(docker buildx imagetools inspect --format '{{.Manifest.Digest}}' "$tag" 2>&1 || true)
            current=$(echo "$err" | sed 's/^sha256://' | grep -E '^[0-9a-f]{64}$' || true)
            [ -n "$current" ] && break
            [ "$attempt" -eq 5 ] && echo "  (last attempt: $(echo "$err" | tail -1 | head -c 120))"
            sleep $((attempt * 3))
        done
        if [ -z "$current" ]; then
            # Fail CLOSED: an unpinnable pin is a supply-chain concern.
            echo "  ✘ $ref — could not resolve after 5 attempts (is the registry reachable?)"
            drift=1
            drift_lines+=("$f: $tag  UNRESOLVABLE (network/registry error)")
            continue
        fi
        if [ "$current" = "$pinned" ]; then
            echo "  ✔ $tag → $pinned"
        else
            echo "  ✘ $tag DRIFT: pinned $pinned, now $current"
            drift=1
            drift_lines+=("$f: $tag  pinned=$pinned  current=$current")
        fi
    done < <(grep -oE "$PIN_RE" "$f")
done

echo

# THE FLOOR. "no drift" and "no pins" both print a clean line and exit 0. Measured
# 2026-10-23: killing the pin pattern left this gate reporting "All pinned image
# digests are current." over zero pins. A supply-chain gate must never do that.
if [ "$pins_seen" -eq 0 ]; then
    echo "✘ NO pinned image reference was found in any listed file."
    echo "  The pin pattern is broken, or the files moved -- not that every pin is current."
    echo "  Refusing to report a clean supply chain over an empty scan."
    exit 2
fi

if [ "$drift" -ne 0 ]; then
    echo "✘ DIGEST DRIFT DETECTED — refresh the pins deliberately (DOCKER-02 policy):"
    printf '   %s\n' "${drift_lines[@]}"
    exit 1
fi
echo "✔ All pinned image digests are current."
