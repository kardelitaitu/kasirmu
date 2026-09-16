---
title: Installation
description: Install OZ-POS on Windows, macOS, or Linux.
category: gettingStarted
order: 2
updated: "2026-08-17"
---

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

Download the installer from the
[releases page](https://github.com/kardelitaitu/oz-pos/releases). No account
is required.

**Windows** — run `OZ-POS_<version>_x64-setup.exe` (or the `.msi`) and follow
the prompts. It installs for your user account and adds a kasir.mu entry to
the Start menu.

## First launch

The setup wizard asks for your business name and default currency — both can
be changed later in settings. The free plan starts on first launch; you can
upgrade any time from Settings → License.

## Updates

kasir.mu checks for updates on startup, and you can check any time from
Settings → About → Check for Updates. Updates are signature-verified and
installed through the platform installer, so nothing is applied without your
confirmation. There is no rollback button — a previous version can be
reinstalled manually from the releases page.

## Next steps

[Ring up your first sale](../first-sale/), or see [activation](../activation/)
when you're ready to unlock more stores, QRIS payments, and cloud sync.
