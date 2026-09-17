#!/usr/bin/env bash
# install/install.sh — kasir.mu bootstrap installer (Linux / macOS)
#
# Thin bootstrap mirroring install/win/install.ps1:
#   1. Detect OS + CPU and resolve the platform manifest key from the
#      release's latest.json (stable) / beta.json (beta) — the SAME signed
#      manifest the in-app updater trusts.
#   2. Download the installer and SHA256SUMS.txt from the SAME release and
#      verify the SHA-256 checksum (fail-closed). When run from disk, the
#      script also verifies its OWN checksum (install.sh is a release asset).
#   3. Delegate to the native installer:
#        Linux  (default, per-user)   AppImage -> ~/.local/bin + .desktop
#        Linux  (--system)            .deb via dpkg (Debian/Ubuntu), else
#                                     AppImage -> /opt with a /usr/local/bin
#                                     symlink (rpm/other distros)
#        macOS  (always)              DMG -> /Applications
#
# Usage:
#   curl -fsSL https://github.com/kardelitaitu/oz-pos/releases/latest/download/install.sh | bash
#   ./install.sh
#   ./install.sh --channel beta
#   ./install.sh --version 0.0.28
#   ./install.sh --system
#   ./install.sh --dry-run
#   ./install.sh --no-launch
#   ./install.sh --repo owner/repo
#
# Security model: the installer binary is verified against SHA256SUMS.txt
# published on the same GitHub Release over HTTPS. When run from disk the
# script also verifies its own checksum; when piped via `curl | bash` the
# script has no file to verify, so that self-check is skipped — HTTPS plus
# the release checksum still cover the installer, and the script is short
# enough to audit. There is no GPG/Authenticode layer on the unix pipeline
# (the Windows installer checks Authenticode when present; unix releases
# carry only the SHA-256 guarantee).
#
# Exit codes: 0 success | 1 usage/generic | 2 unsupported OS/arch |
# 3 checksum mismatch | 4 download failure | 5 installer failure.
set -euo pipefail

CHANNEL="stable"
VERSION=""
SYSTEM=0
DRY_RUN=0
NO_LAUNCH=0
REPO="kardelitaitu/oz-pos"

die() { echo "ERROR: $1" >&2; exit "${2:-1}"; }

usage() {
    cat <<'EOF'
Usage: install.sh [options]

Options:
  -c, --channel stable|beta   Release channel (default: stable)
  -v, --version X.Y.Z         Pin a specific release (default: latest)
  -s, --system                Per-machine install (Linux: .deb or /opt;
                              requires elevation via sudo)
  -d, --dry-run               Download + verify everything, do not install
  -n, --no-launch             Do not launch kasir.mu after install
  -r, --repo owner/repo       Override the GitHub repository (forks)
  -h, --help                  Show this help
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        -c|--channel)
            [ $# -ge 2 ] || die "option $1 requires an argument"
            CHANNEL="$2"; shift 2 ;;
        --channel=*) CHANNEL="${1#*=}"; shift ;;
        -v|--version)
            [ $# -ge 2 ] || die "option $1 requires an argument"
            VERSION="$2"; shift 2 ;;
        --version=*) VERSION="${1#*=}"; shift ;;
        -s|--system) SYSTEM=1; shift ;;
        -d|--dry-run) DRY_RUN=1; shift ;;
        -n|--no-launch) NO_LAUNCH=1; shift ;;
        -r|--repo)
            [ $# -ge 2 ] || die "option $1 requires an argument"
            REPO="$2"; shift 2 ;;
        --repo=*) REPO="${1#*=}"; shift ;;
        -h|--help) usage; exit 0 ;;
        *) die "Unknown option: $1 (see --help)" ;;
    esac
done

case "$CHANNEL" in
    stable|beta) ;;
    *) die "Invalid channel: $CHANNEL (expected stable or beta)" ;;
esac

# ── OS / architecture detection ──────────────────────────────────────────
OS="$(uname -s)"
case "$OS" in
    Linux) ;;
    Darwin) ;;
    *) die "Unsupported OS: $OS (kasir.mu ships Linux and macOS builds)." 2 ;;
esac

ARCH="$(uname -m)"
case "$ARCH" in
    x86_64|amd64) ARCH_KEY="x86_64" ;;
    aarch64|arm64) ARCH_KEY="aarch64" ;;
    *) die "Unsupported CPU architecture: $ARCH (kasir.mu ships x86_64 and aarch64 builds)." 2 ;;
esac

if [ "$OS" = "Linux" ]; then
    PLATFORM_KEY="linux-$ARCH_KEY"
    KIND="appimage"
else
    PLATFORM_KEY="darwin-$ARCH_KEY"
    KIND="dmg"
fi
echo "==> Detected $OS $ARCH ($PLATFORM_KEY)"

# ── Resolve the release manifest ─────────────────────────────────────────
MANIFEST_FILE="latest.json"
[ "$CHANNEL" = "beta" ] && MANIFEST_FILE="beta.json"
VERSION="${VERSION#v}"
if [ -n "$VERSION" ]; then
    RELEASE_BASE="https://github.com/$REPO/releases/download/v$VERSION"
else
    RELEASE_BASE="https://github.com/$REPO/releases/latest/download"
fi
MANIFEST_URL="$RELEASE_BASE/$MANIFEST_FILE"
echo "==> Resolving release manifest: $MANIFEST_URL"

fetch() { # <url> <outfile>
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$1" -o "$2"
    elif command -v wget >/dev/null 2>&1; then
        wget -qO "$2" "$1"
    else
        die "Neither curl nor wget is available — cannot download." 4
    fi
}

TMPDIR="$(mktemp -d "${TMPDIR:-/tmp}/kasirmu-install.XXXXXX")"
trap 'rm -rf "$TMPDIR"' EXIT

if ! fetch "$MANIFEST_URL" "$TMPDIR/manifest.json"; then
    die "Could not fetch the release manifest ($MANIFEST_URL)." 4
fi

# The manifest is generated by scripts/generate-latest-json.mjs — parse it
# with awk (no jq dependency). Platform entries are single-line objects:
#   "linux-x86_64": { "signature": "...", "url": "https://..." }
MANIFEST_VERSION="$(awk -F'"' '/"version"/{print $4; exit}' "$TMPDIR/manifest.json")"
ASSET_URL="$(awk -v k="\"$PLATFORM_KEY\"" 'index($0,k){found=1} found && /"url"/{gsub(/.*"url": "/,""); gsub(/".*/,""); print; exit}' "$TMPDIR/manifest.json")"

if [ -z "$ASSET_URL" ]; then
    die "Release $MANIFEST_VERSION has no $PLATFORM_KEY build yet — try the latest release or a newer version." 2
fi
if [ -n "$VERSION" ] && [ "$MANIFEST_VERSION" != "$VERSION" ]; then
    die "Version mismatch: requested $VERSION but $MANIFEST_FILE describes $MANIFEST_VERSION." 1
fi

ASSET_NAME="$(basename "$ASSET_URL")"
echo "    Latest: kasir.mu $MANIFEST_VERSION ($PLATFORM_KEY)"

# ── Checksums (SHA256SUMS.txt covers every release asset) ────────────────
echo "==> Fetching SHA256SUMS.txt"
if ! fetch "$RELEASE_BASE/SHA256SUMS.txt" "$TMPDIR/SHA256SUMS.txt"; then
    die "Could not fetch SHA256SUMS.txt." 4
fi

compute_hash() { # <file>
    local f="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$f" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$f" | awk '{print $1}'
    elif command -v openssl >/dev/null 2>&1; then
        openssl dgst -sha256 "$f" | awk '{print $NF}'
    else
        die "No SHA-256 tool available (sha256sum/shasum/openssl)." 4
    fi
}

sum_for() { # <filename> — looks up the checksum line for a release asset
    awk -v f="$1" '$2==f {print $1; exit}' "$TMPDIR/SHA256SUMS.txt"
}

# Self-verify when run from disk: install.sh is itself a release asset and
# appears in SHA256SUMS.txt. Skipped when piped (`curl ... | bash`).
if [ -f "$0" ] && [ "$(basename "$0")" = "install.sh" ]; then
    SELF_NAME="$(basename "$0")"
    SELF_EXPECTED="$(sum_for "$SELF_NAME")"
    if [ -n "$SELF_EXPECTED" ]; then
        SELF_HASH="$(compute_hash "$0")"
        if [ "$SELF_HASH" != "$SELF_EXPECTED" ]; then
            die "This copy of $SELF_NAME does not match the released checksum — refusing to continue. Re-download it from the release." 3
        fi
        echo "    Self checksum verified ($SELF_NAME)"
    else
        echo "    warning: SHA256SUMS.txt has no entry for $SELF_NAME — skipping self-verification."
    fi
else
    echo "    warning: running from a pipe — self-verification skipped. Download the script and run ./install.sh to verify it too."
fi

verify_asset() { # <url> <name> -> prints the verified file path
    local url="$1" name="$2"
    local path="$TMPDIR/$name"
    echo "==> Downloading $name"
    if ! fetch "$url" "$path"; then
        die "Download failed: $url" 4
    fi
    local expected actual
    expected="$(sum_for "$name")"
    actual="$(compute_hash "$path")"
    if [ -z "$expected" ] || [ "$actual" != "$expected" ]; then
        die "Checksum mismatch for $name (expected $expected, got $actual) — aborting. Do not run the installer." 3
    fi
    echo "    Checksum verified: $name"
    echo "$path"
}

# ── Delegate to the native installer ─────────────────────────────────────
if [ "$OS" = "Darwin" ]; then
    DMG="$(verify_asset "$ASSET_URL" "$ASSET_NAME")"
    if [ "$DRY_RUN" = 1 ]; then
        echo "    Dry run: would mount $ASSET_NAME and copy kasir.mu.app to /Applications."
        exit 0
    fi
    echo "==> Installing kasir.mu $MANIFEST_VERSION (DMG -> /Applications)"
    MOUNT="$TMPDIR/mnt"
    mkdir -p "$MOUNT"
    if ! hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT" "$DMG" >/dev/null; then
        die "Failed to mount the DMG." 5
    fi
    APP="$(ls -d "$MOUNT"/*.app 2>/dev/null | head -1 || true)"
    if [ -z "$APP" ]; then
        hdiutil detach "$MOUNT" >/dev/null 2>&1 || true
        die "No .app bundle found inside the DMG." 5
    fi
    # curl downloads carry no quarantine attribute, so no Gatekeeper prompt.
    if ! ditto "$APP" "/Applications/$(basename "$APP")" 2>/dev/null; then
        SUDO=""
        [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1 && SUDO="sudo"
        $SUDO ditto "$APP" "/Applications/$(basename "$APP")" || { hdiutil detach "$MOUNT" >/dev/null 2>&1 || true; die "Failed to copy the app to /Applications." 5; }
    fi
    hdiutil detach "$MOUNT" >/dev/null 2>&1 || true
    echo "    Installed to /Applications/$(basename "$APP")"
    if [ "$NO_LAUNCH" != 1 ]; then
        open "/Applications/$(basename "$APP")" || true
        echo "    Launching kasir.mu."
    fi
else
    if [ "$SYSTEM" = 1 ]; then
        # Per-machine: prefer the .deb (Debian/Ubuntu), else AppImage -> /opt.
        DEB_ARCH="amd64"
        [ "$ARCH_KEY" = "aarch64" ] && DEB_ARCH="arm64"
        DEB_NAME="$(awk -v a="_${DEB_ARCH}.deb" 'index($2, a) > 0 && $2 ~ /\.deb$/ {print $2; exit}' "$TMPDIR/SHA256SUMS.txt")"
        SUDO=""
        [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1 && SUDO="sudo"
        if [ -n "$DEB_NAME" ] && command -v dpkg >/dev/null 2>&1; then
            DEB="$(verify_asset "$RELEASE_BASE/$DEB_NAME" "$DEB_NAME")"
            if [ "$DRY_RUN" = 1 ]; then
                echo "    Dry run: would run '$SUDO dpkg -i $DEB_NAME' (per-machine, /opt via the .deb)."
                exit 0
            fi
            echo "==> Installing kasir.mu $MANIFEST_VERSION (.deb, per-machine)"
            if ! $SUDO dpkg -i "$DEB"; then
                $SUDO apt-get install -f -y >/dev/null 2>&1 || true
            fi
            if ! dpkg -s kasir.mu >/dev/null 2>&1; then
                die "dpkg did not register the kasir.mu package — install failed." 5
            fi
            echo "    Installed via dpkg (kasir.mu)."
        else
            APPIMAGE="$(verify_asset "$ASSET_URL" "$ASSET_NAME")"
            if [ "$DRY_RUN" = 1 ]; then
                echo "    Dry run: would install $ASSET_NAME to /opt/kasir.mu and symlink /usr/local/bin/kasir.mu."
                exit 0
            fi
            echo "==> Installing kasir.mu $MANIFEST_VERSION (AppImage -> /opt)"
            $SUDO mkdir -p /opt/kasir.mu
            $SUDO install -m755 "$APPIMAGE" /opt/kasir.mu/kasir.mu.AppImage
            $SUDO ln -sf /opt/kasir.mu/kasir.mu.AppImage /usr/local/bin/kasir.mu
            $SUDO sh -c 'cat > /usr/share/applications/kasir.mu.desktop' <<EOF
[Desktop Entry]
Type=Application
Name=kasir.mu
Comment=kasir.mu point-of-sale
Exec=/opt/kasir.mu/kasir.mu.AppImage
Terminal=false
Categories=Office;Finance;
EOF
            echo "    Installed to /opt/kasir.mu (launcher: kasir.mu)."
        fi
    else
        # Per-user AppImage -> ~/.local/bin + .desktop entry, no elevation.
        APPIMAGE="$(verify_asset "$ASSET_URL" "$ASSET_NAME")"
        if [ "$DRY_RUN" = 1 ]; then
            echo "    Dry run: would install $ASSET_NAME to $HOME/.local/bin/kasir.mu.AppImage + .desktop entry."
            exit 0
        fi
        echo "==> Installing kasir.mu $MANIFEST_VERSION (AppImage, per-user)"
        mkdir -p "$HOME/.local/bin"
        install -m755 "$APPIMAGE" "$HOME/.local/bin/kasir.mu.AppImage"
        mkdir -p "$HOME/.local/share/applications"
        cat > "$HOME/.local/share/applications/kasir.mu.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=kasir.mu
Comment=kasir.mu point-of-sale
Exec=$HOME/.local/bin/kasir.mu.AppImage
Terminal=false
Categories=Office;Finance;
StartupWMClass=kasir.mu
EOF
        chmod +x "$HOME/.local/share/applications/kasir.mu.desktop"
        echo "    Installed to $HOME/.local/bin/kasir.mu.AppImage (launcher menu: kasir.mu)."
        if [ "$NO_LAUNCH" != 1 ]; then
            nohup "$HOME/.local/bin/kasir.mu.AppImage" >/dev/null 2>&1 &
            echo "    Launching kasir.mu."
        fi
    fi
fi

echo "    Done. kasir.mu $MANIFEST_VERSION installed."
exit 0
