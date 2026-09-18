---
title: Settings & Data
description: Branding, receipts, currencies, and local data.
category: reference
order: 2
updated: "2026-09-19"
---

<!-- Audit stamp: 2026-09-19 · DSH · status: ACCURATE AFTER REPAIR (3 findings) · 2026-09-19 RE-AUDIT: Finding 1's enumeration named Staff and Roles among the screens that "live in the main navigation's Tools and Finance sections". They no longer live anywhere in the main navigation — ui/src/features/staff/register.tsx:20-33 registers both routes with fullscreen: true and carries no registerNavItem, so AppShell renders them without AppLayout and the sidebar lists neither. The sentence now separates them from the genuinely Tools-section screens and points at the workspace picker's Tools grid instead. Verified in the running app: the Tools sidebar section lists Terminals, Features, Data, Audit Log, Security Trail, Offline Queue, Shifts, Memos. · 2026-09-09 · DSH · status: ACCURATE AFTER REPAIR (2 findings) · Finding 1, wrong sidebar enumeration: the page listed 18 "settings sidebar" screens, but Settings surfaces 13 children in three categories — SettingsNavTree.tsx NAV_ITEMS (18-171) and CATEGORIES (186-190): Business (General, Appearance), Operations (Receipt, Cloud Sync, Email Reports, Store POS, Restaurant POS, Inventory), System (About, License, Diagnostics, Topology, Local API). Features and Data register with section: 'tools' (settings/register.tsx:27,37), Shifts (shifts/register.tsx:15), Terminals (terminals/register.tsx:14), Staff and Roles (staff/register.tsx:20,36), Audit Log (audit/register.tsx:15), Offline Queue (offline/register.tsx:14), Locations — the app's nav label, not "Stores" — (locations/register.tsx:15), Tax Rates (tax/register.tsx:15), Exchange Rates (currency/register.tsx:14), Promotions (promotions/register.tsx:14). List rewritten to the real 13 with the app's own labels, plus one sentence pointing the rest at the main navigation's Tools and Finance sections. Finding 2, PIN overclaim: "price overrides, voids, refunds are PIN-verified" — only price overrides are PIN-verified (PriceOverrideModal.tsx:65 four-digit PIN; FastPINOverlay manager override per ADR-19 §17 at PosScreen.tsx:690,2397); voids and refunds are role-permission-gated (SALES_VOID void.rs:49, SALES_REFUND refunds.rs:84, manager-only swipe SalesHistoryScreen.tsx:71,107) — no PIN step found in either path after three differently-worded searches. Reworded. · Verified true, left alone: pin-to-top (SettingsNavTree.tsx:292-313,743-780), five role presets (StaffManagementScreen.tsx:65-72), Audit Log append-only immutable with schema triggers (audit.rs:1,123,144), export wizard types + "no passwords" users row + dry-run import preview (DataManagementScreen.tsx:38-43,63-68,150), encrypted .ozpkg (commands/data.rs:1,10), receipt fields incl. paper width/footer/rounding per workspace (ReceiptSection.tsx:108,124-138; taxRoundingMode WorkspaceStorePosSettings.tsx:62), Appearance theme toggle (settings.ftl:289-290), license tier/expiry/grace/limits (LicenseSettings.tsx:16-23,75), per-device sound volume/dark mode (api/settings.ts:116-118). · id/ counterpart repaired with the same two findings using the app's own id labels. -->

## The settings sidebar

Settings is a sidebar of focused screens grouped into three categories:
**Business** (General, Appearance), **Operations** (Receipt, Cloud Sync,
Email Reports, Store POS, Restaurant POS, Inventory), and **System** (About,
License, Diagnostics, Topology, Local API). Pin the screens you use often so
they stay at the top. Screens with related jobs — Features, Data, Terminals,
Locations, Audit Log, Offline Queue, Shifts, Tax Rates, Exchange Rates, and
Promotions — are not Settings children; they live in the main navigation's
Tools and Finance sections. **Staff** and **Roles** are neither: they are
dedicated full-screen pages you open from the **Staff Management** card in the
workspace picker's Tools grid, and Staff links on to Roles.

## Store settings

Business name, currency, receipt layout, and hardware defaults are configured
here and synced to every register. **Tax Rates** and **Exchange Rates** add
the rates the checkout and reports use. Receipt settings control paper
width, currency and tax display, rounding, the footer, and the printer —
per workspace, so each screen prints its own way.

## Appearance & devices

**Appearance** sets the theme (dark mode) that the device boots into.
Per-device preferences such as sound volume live on the terminal; see
[Terminals](../terminals/) for what follows the device rather than the user.

## Staff & security

Staff sign in with a PIN or password, and each account has a role — one of
five presets (**owner**, **admin**, **manager**, **staff**, or **auditor**)
— that decides what workspaces and actions are allowed. Price overrides are
PIN-verified, voids and refunds require a manager's role permission, and the
**Audit Log** keeps an immutable record of them. See [User Roles](../user-roles/) for the
full matrix, and [Shifts & Reconciliation](../shifts/) for how the same
trail reconciles cash.

## Data management

The **Data** screen exports, imports, and backs up your data. An export is a
wizard: pick the data types (products, categories, sales, customers, users,
settings) and a date range, and the result is written as an encrypted
`.ozpkg` file. Exports never include passwords, and imports are validated
before anything is replaced. Backups of the local database are the
disaster-recovery copy — see [Offline-First Mode](../offline-mode/) for how
data lives on the device.

## Sync, offline & license

**Cloud Sync** and **Offline Queue** show sync status and what is waiting to
reach the cloud — see [Cloud Sync](../cloud-sync/) and
[Offline-First Mode](../offline-mode/). **License** shows your tier, expiry,
grace period, and limits — see [Licensing & Plans](../licensing/).

> last audited 19-09-26 by docs-auditor
