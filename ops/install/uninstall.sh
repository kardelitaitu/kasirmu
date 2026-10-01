#!/usr/bin/env bash
# ops/install/uninstall.sh — kasir.mu uninstaller (Linux / macOS)
#
# Mirrors ops/install/win/uninstall.ps1: removes the footprints the installers
# create, rather than guessing install paths:
#
#   Linux  per-user  ~/.local/bin/kasir.mu.AppImage + ~/.local/share/applications/kasir.mu.desktop
#   Linux  system    dpkg -r kasir.mu (Debian/Ubuntu), else /opt/kasir.mu +
#                    /usr/local/bin/kasir.mu + /usr/share/applications/kasir.mu.desktop
#   macOS            /Applications/kasir.mu.app
#
# Local app data (databases, settings) is preserved unless --purge is given.
#
# Usage:
#   curl -fsSL https://github.com/kardelitaitu/kasirmu/releases/latest/download/uninstall.sh | bash
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
            "$HOME/Library/Application Support/mu.kasir.app" \
            "$HOME/Library/Caches/mu.kasir.app"; do
            if [ -d "$d" ]; then rm -rf "$d"; echo "Removing $d"; fi
        done
        rm -f "$HOME/Library/Preferences/mu.kasir.app.plist"
    fi
else
    # Per-user footprint (no elevation).
    for f in "$HOME/.local/bin/kasir.mu.AppImage" "$HOME/.local/bin/oz-pos.AppImage" \
             "$HOME/.local/share/applications/kasir.mu.desktop" \
             "$HOME/.local/share/applications/oz-pos.desktop"; do
        if [ -e "$f" ]; then rm -f "$f"; echo "Removing $f"; found=1; fi
    done

    # System footprint (Debian/Ubuntu .deb install).
    if command -v dpkg >/dev/null 2>&1 && dpkg -s kasir.mu >/dev/null 2>&1; then
        echo "Removing kasir.mu package"
        if ! $SUDO dpkg -r kasir.mu >/dev/null 2>&1; then
            echo "ERROR: dpkg -r kasir.mu failed (run it manually)." >&2
            exit 2
        fi
        found=1
    fi
    # System footprint (AppImage -> /opt fallback install).
    if [ -d /opt/kasir.mu ]; then
        echo "Removing /opt/kasir.mu"
        $SUDO rm -rf /opt/kasir.mu || { echo "ERROR: could not remove /opt/kasir.mu." >&2; exit 2; }
        found=1
    fi
    # Only invoke sudo when a system-level file actually exists — an
    # unconditional `sudo rm -f` prompts for a password even on purely
    # per-user installs.
    for f in /usr/local/bin/kasir.mu /usr/local/bin/oz-pos \
             /usr/share/applications/kasir.mu.desktop /usr/share/applications/oz-pos.desktop; do
        if [ -e "$f" ]; then
            $SUDO rm -f "$f" 2>/dev/null || true
            found=1
        fi
    done

    if [ "$PURGE" = 1 ]; then
        for d in "$HOME/.local/share/mu.kasir.app" "$HOME/.config/mu.kasir.app"; do
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
