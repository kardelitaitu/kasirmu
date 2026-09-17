#!/usr/bin/env bash
# generate-license-keys.sh
# ── OZ-POS License Key Generator ────────────────────────────────────
# Generates an RSA-2048 key pair for the license server (ADR #9).
#
# Outputs:
#   crates/kasirmu-core/oz-license.key.pub     ← Public key (embedded in POS binary, committed)
#   crates/kasirmu-core/oz-license-private.pem ← Private key (set as OZ_LICENSE_PRIVATE_KEY env var, git-ignored)
#
# Requirements:
#   - OpenSSL (brew install openssl / apt install openssl)
#
# Usage:
#   bash scripts/generate-license-keys.sh
#   chmod +x scripts/generate-license-keys.sh && ./scripts/generate-license-keys.sh

set -euo pipefail

public_key_path="crates/kasirmu-core/oz-license.key.pub"
private_key_path="crates/kasirmu-core/oz-license-private.pem"

# ── Colors ──────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

echo -e "${CYAN}====================================================${NC}"
echo -e "${CYAN}  OZ-POS License Key Generator (ADR #9)${NC}"
echo -e "${CYAN}====================================================${NC}"
echo ""

# ── Check OpenSSL availability ──────────────────────────────────────
if ! command -v openssl &>/dev/null; then
    echo -e "${RED}ERROR: OpenSSL not found.${NC}"
    echo -e "${YELLOW}Install it via:${NC}"
    echo -e "${YELLOW}  macOS:   brew install openssl${NC}"
    echo -e "${YELLOW}  Ubuntu:  sudo apt install openssl${NC}"
    echo -e "${YELLOW}  Fedora:  sudo dnf install openssl${NC}"
    exit 1
fi
echo -e "${GREEN}[✓] OpenSSL found: $(which openssl)${NC}"

# ── Ensure we're in the project root ─────────────────────────────────
if [ ! -d "crates/kasirmu-core" ]; then
    echo -e "${RED}ERROR: Must be run from the project root (crates/kasirmu-core/ not found).${NC}"
    exit 1
fi

# ── Confirm before overwriting ──────────────────────────────────────
if [ -f "$private_key_path" ]; then
    echo ""
    echo -e "${YELLOW}WARNING: $private_key_path already exists!${NC}"
    echo -e "${YELLOW}Overwriting this key will INVALIDATE all existing subscriptions.${NC}"
    read -rp "Type 'YES' to continue: " confirm
    if [ "$confirm" != "YES" ]; then
        echo -e "${RED}Aborted.${NC}"
        exit 1
    fi
fi

if [ -f "$public_key_path" ]; then
    echo -e "${YELLOW}WARNING: $public_key_path will be overwritten.${NC}"
fi

# ── Ensure the output directory exists ──────────────────────────────
mkdir -p "$(dirname "$private_key_path")"

# ── Generate RSA-2048 private key (PKCS#8 PEM) ──────────────────────
echo ""
echo -e "${CYAN}Generating RSA-2048 key pair...${NC}"

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$private_key_path" 2>/dev/null
echo -e "${GREEN}[✓] Private key created: $private_key_path${NC}"

# Set restrictive permissions (owner read/write only)
chmod 600 "$private_key_path"
echo -e "${GRAY}      Permissions set to 600 (owner read/write only).${NC}"

# ── Extract public key (DER/SPKI format) ────────────────────────────
openssl pkey -in "$private_key_path" -pubout -outform DER -out "$public_key_path" 2>/dev/null
echo -e "${GREEN}[✓] Public key created: $public_key_path${NC}"

# ── Verify the key pair ─────────────────────────────────────────────
private_header=$(head -n1 "$private_key_path")
public_size=$(stat -f%z "$public_key_path" 2>/dev/null || stat -c%s "$public_key_path" 2>/dev/null || echo "0")

if echo "$private_header" | grep -q "BEGIN PRIVATE KEY"; then
    echo -e "${GREEN}[✓] Private key is valid PKCS#8 PEM${NC}"
elif echo "$private_header" | grep -q "BEGIN RSA PRIVATE KEY"; then
    echo -e "${GREEN}[✓] Private key is valid PKCS#1 PEM${NC}"
else
    echo -e "${YELLOW}[!] WARNING: Private key format unexpected${NC}"
fi

if [ "$public_size" -ge 256 ] 2>/dev/null; then
    echo -e "${GREEN}[✓] Public key is valid ($public_size bytes DER)${NC}"
else
    echo -e "${YELLOW}[!] WARNING: Public key size unexpected ($public_size bytes)${NC}"
fi

# ── Final instructions ──────────────────────────────────────────────
echo ""
echo -e "${CYAN}====================================================${NC}"
echo -e "${GREEN}  Key generation complete!${NC}"
echo -e "${CYAN}====================================================${NC}"
echo ""
echo -e "  Public key:  ${NC}$public_key_path   ${GRAY}← committed to git${NC}"
echo -e "  Private key: ${NC}$private_key_path ${GRAY}← NEVER commit this${NC}"
echo ""
echo -e "${CYAN}  To set the private key as an env var for local testing:${NC}"
echo -e "    ${GRAY}export OZ_LICENSE_PRIVATE_KEY=\"\$(cat $private_key_path)\"${NC}"
echo ""
echo -e "${CYAN}  To set on Northflank:${NC}"
echo -e "    ${GRAY}1. Open your project → Secrets → Secret Groups${NC}"
echo -e "    ${GRAY}2. Create a secret named OZ_LICENSE_PRIVATE_KEY${NC}"
echo -e "    ${GRAY}3. Paste the ENTIRE contents of $private_key_path${NC}"
echo ""
echo -e "  ${GRAY}See apps/license-server/DEPLOY.md for the full deployment guide.${NC}"
echo ""
