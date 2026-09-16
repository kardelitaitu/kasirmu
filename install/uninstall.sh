#!/usr/bin/env bash
# install/uninstall.sh — kasir.mu uninstaller (Linux / macOS)
#
# Mirrors install/win/uninstall.ps1: removes the footprints the installers
# create, rather than guessing install paths:
#
#   Linux  per-user  ~/.local/bin/oz-pos.AppImage + ~/.local/share/applications/oz-pos.desktop
#   Linux  system    dpkg -r oz-pos (Debian/Ubuntu), else /opt/oz-pos +
#                    /usr/local/bin/oz-pos + /usr/share/applications/oz-pos.desktop
#   macOS            /Applications/OZ-POS.app
#
# Local app data (databases, settings) is preserved unless --purge is given.
#
# Usage:
#   curl -fsSL https://github.com/kardelitaitu/oz-pos/releases/latest/download/uninstall.sh | bash
#   ./uninstall.sh
#   ./uninstall.sh --purge
#
# Exit codes: 0 success | 1 nothing found | 2 uninstall failed.
set -euo pipefail

PURGE=0
case "${1:-}" in
    "" ) ;;
    -p|--purge) PURGE=1 ;;
    -h|--help) echo "Usage: uninstall.sh [--purge]"; exit 0 ;;
    *) echo "ERROR: Unknown option: $1 (see --help)" >&2; exit 1 ;;
esac

OS="$(uname -s)"
case "$OS" in
    Linux) ;;
    Darwin) ;;
    *) echo "ERROR: Unsupported OS: $OS (this script removes kasir.mu on Linux and macOS)." >&2; exit 2 ;;
esac

SUDO=""
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
fi

found=0

if [ "$OS" = "Darwin" ]; then
    APP="/Applications/kasir.mu.app"
    if [ -d "$APP" ]; then
        echo "Removing $APP"
        if ! rm -rf "$APP" 2>/dev/null; then
            $SUDO rm -rf "$APP" || { echo "ERROR: could not remove $APP (is it in use?)." >&2; exit 2; }
        fi
        found=1
    fi
    if [ "$PURGE" = 1 ]; then
        for d in \
            "$HOME/Library/Application Support/com.ozpos.app" \
            "$HOME/Library/Caches/com.ozpos.app"; do
            if [ -d "$d" ]; then rm -rf "$d"; echo "Removing $d"; fi
        done
        rm -f "$HOME/Library/Preferences/com.ozpos.app.plist"
    fi
else
    # Per-user footprint (no elevation).
    for f in "$HOME/.local/bin/oz-pos.AppImage" "$HOME/.local/bin/OZ-POS.AppImage" \
             "$HOME/.local/share/applications/oz-pos.desktop" \
             "$HOME/.local/share/applications/OZ-POS.desktop"; do
        if [ -e "$f" ]; then rm -f "$f"; echo "Removing $f"; found=1; fi
    done

    # System footprint (Debian/Ubuntu .deb install).
    if command -v dpkg >/dev/null 2>&1 && dpkg -s oz-pos >/dev/null 2>&1; then
        echo "Removing oz-pos package"
        if ! $SUDO dpkg -r oz-pos >/dev/null 2>&1; then
            echo "ERROR: dpkg -r oz-pos failed (run it manually)." >&2
            exit 2
        fi
        found=1
    fi
    # System footprint (AppImage -> /opt fallback install).
    if [ -d /opt/oz-pos ]; then
        echo "Removing /opt/oz-pos"
        $SUDO rm -rf /opt/oz-pos || { echo "ERROR: could not remove /opt/oz-pos." >&2; exit 2; }
        found=1
    fi
    # Only invoke sudo when a system-level file actually exists — an
    # unconditional `sudo rm -f` prompts for a password even on purely
    # per-user installs.
    for f in /usr/local/bin/oz-pos /usr/local/bin/OZ-POS \
             /usr/share/applications/oz-pos.desktop /usr/share/applications/OZ-POS.desktop; do
        if [ -e "$f" ]; then
            $SUDO rm -f "$f" 2>/dev/null || true
            found=1
        fi
    done

    if [ "$PURGE" = 1 ]; then
        for d in "$HOME/.local/share/com.ozpos.app" "$HOME/.config/com.ozpos.app"; do
            if [ -d "$d" ]; then rm -rf "$d"; echo "Removing $d"; fi
        done
    fi
fi

if [ "$found" = 0 ]; then
    echo "kasir.mu is not installed (nothing to remove)."
    exit 1
fi

if [ "$PURGE" = 1 ]; then
    echo "Local app data purged."
fi
echo "kasir.mu uninstalled."
exit 0
