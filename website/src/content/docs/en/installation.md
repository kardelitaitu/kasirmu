---
title: Installation
description: Install kasir.mu on Windows, macOS, or Linux.
category: gettingStarted
order: 3
updated: "2026-10-01"
---

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE — 0 findings · First audit stamp on this page. THE TABLE, CHECKED AGAINST A CONTRADICTION THAT LOOKS REAL AND IS NOT: `.github/workflows/release.yml` builds AND publishes macOS and Linux installers — the matrix includes desktop-linux (AppImage+deb), desktop-windows (NSIS+MSI) and desktop-macos (dmg) at :108-141, the publish job copies all three into release-assets, and an inventory gate HARD-FAILS if any of `.AppImage`, `.exe`, `.dmg` is absent (`for ext in AppImage exe dmg`). So the "Coming soon" row for macOS and Linux is not a claim that no installer is built, and the page is not wrong: the repo's own product stance is the same one this table states — README.md:329 ("Windows 10/11 ... is the only working production-ready build"; "Linux builds are in active development"), README.md:41 ("Supported platforms: Windows 10/11 (Production-ready); Android tablet APK & Linux (In active development)"), and todo-beta-testing-january-2027.md:17 ("The Windows desktop engine is already production-ready"). Preview installers exist; supported platforms are narrower. Left exactly as written, and this stamp records why, because a future auditor who greps for `.dmg` in the release workflow will otherwise 'fix' a correct table. · VERIFIED: the download route and the GitHub-releases pointer both resolve; the Windows installer name `kasir.mu_<version>_x64-setup.exe` matches the NSIS bundle the workflow produces; "Settings → System Diagnostics → Check for Updates" matches the shipped nav (SettingsNavTree.tsx:195 'System Diagnostics' + AboutSection.tsx:138 'Check for Updates'); the update path is signature-verified (tauri.conf.json updater pubkey non-empty, release.yml verifies every manifest signature); the "no rollback button — reinstall from the releases page" wording matches the shipped single-direction updater; WebView2 and the 4 GB / 1 GB recommendations are consistent. · NOT re-measured: an actual install on Windows/macOS/Linux, and the installer silent-upgrade path. · Footer is an internal marker, stripped from the built site. -->

## System requirements

The same offline-first core runs on every platform:

| Platform                              | Status      |
| ------------------------------------- | ----------- |
| Windows 10 / 11 (64-bit)              | Ready       |
| macOS 12 or newer                     | Coming soon |
| Linux (x86_64, glibc 2.31+ — Ubuntu 20.04 and newer) | Coming soon |
| Android (tablets & phones)            | Coming soon |
| iOS (tablets & phones)                | Coming soon |

4 GB RAM and 1 GB of free disk space are recommended. Windows uses the
WebView2 runtime, which ships with Windows 10 and 11.

> **Note:** Windows is the only platform shipping today. macOS, Linux,
> Android, and iOS are in progress and will appear here when their
> installers start publishing.

## Download and install

Download it from the [download page](../../download/) — no account is required.
The installers themselves are published on
[GitHub Releases](https://github.com/kardelitaitu/kasirmu/releases).

**Windows** — run `kasir.mu_<version>_x64-setup.exe` (or the `.msi`) and follow
the prompts. It installs for your user account and adds a kasir.mu entry to
the Start menu.

## First launch

The setup wizard asks for an account (or offline-only setup), the shop type,
and an owner login — see [Setup Wizard](../setup-wizard/). The free plan
starts on first launch; you can upgrade any time from Settings → License & Subscription.

## Updates

kasir.mu checks for updates on startup, and you can check any time from
Settings → System Diagnostics → Check for Updates. Updates are signature-verified and
installed through the platform installer, so nothing is applied without your
confirmation. There is no rollback button — a previous version can be
reinstalled manually from the releases page.

## Next steps

[Ring up your first sale](../first-sale/), or see [activation](../activation/)
when you're ready to unlock more locations, QRIS payments, and cloud sync.

---

Keep reading · **Previous:** [Quickstart](../quickstart/) · **Next:** [Setup Wizard](../setup-wizard/)

> last audited 11-10-26 by docs-auditor
