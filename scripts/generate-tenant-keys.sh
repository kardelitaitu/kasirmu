#!/bin/bash
# generate-tenant-keys.sh
# ── kasir.mu Tenant Key Generator ─────────────────────────────────────
# Generates a cryptographically secure API key and formatted License Key
# for manually registering a new tenant in PocketBase.
#
# Usage:
#   ./scripts/generate-tenant-keys.sh [tier]
#
# Examples:
#   ./scripts/generate-tenant-keys.sh        (defaults to PRO)
#   ./scripts/generate-tenant-keys.sh FREE

set -euo pipefail

TIER="${1:-PRO}"
# Uppercase the tier
TIER=$(echo "$TIER" | tr '[:lower:]' '[:upper:]')

case "$TIER" in
    FREE|PRO|PREMIUM|ENTERPRISE) ;;
    *)
        echo -e "\033[0;31mERROR: Invalid tier '$TIER'. Must be one of: FREE, PRO, PREMIUM, ENTERPRISE\033[0m"
        exit 1
        ;;
esac

echo -e "\033[0;36m====================================================\033[0m"
echo -e "\033[0;36m  kasir.mu Tenant & License Key Generator\033[0m"
echo -e "\033[0;36m====================================================\033[0m"
echo ""

# Generate a secure 32-byte API Key
if command -v openssl >/dev/null 2>&1; then
    API_HEX=$(openssl rand -hex 32)
    LIC_HEX=$(openssl rand -hex 8 | tr '[:lower:]' '[:upper:]')
else
    # Fallback to /dev/urandom
    API_HEX=$(od -vN 32 -An -tx1 /dev/urandom | tr -d " \n")
    LIC_HEX=$(od -vN 8 -An -tx1 /dev/urandom | tr -d " \n" | tr '[:lower:]' '[:upper:]')
fi

API_KEY="oz_live_$API_HEX"

# Format license key as XXXX-XXXX-XXXX-XXXX
LIC_SEGMENTS="${LIC_HEX:0:4}-${LIC_HEX:4:4}-${LIC_HEX:8:4}-${LIC_HEX:12:4}"
LICENSE_KEY="OZ-$TIER-$LIC_SEGMENTS"

echo -e "\033[1;37mTenant API Key (keep secret!):\033[0m"
echo -e "\033[0;32m$API_KEY\033[0m"
echo ""
echo -e "\033[1;37mPOS License Key ($TIER):\033[0m"
echo -e "\033[0;32m$LICENSE_KEY\033[0m"
echo ""
echo -e "\033[0;90mInstructions:\033[0m"
echo -e "\033[0;90m1. Paste the API Key into the 'tenants' collection.\033[0m"
echo -e "\033[0;90m2. Paste the License Key into the 'license_keys' collection.\033[0m"
echo -e "\033[0;90m3. Set the tier inside the license_keys record to match.\033[0m"
echo ""
