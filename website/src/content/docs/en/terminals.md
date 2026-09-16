---
title: Terminals
description: Register and configure the devices that run kasir.mu.
category: guides
order: 8
updated: "2026-09-09"
---

<!-- Audit stamp: 2026-09-09 · DSH · status: ACCURATE AFTER REPAIR (1 finding) · Finding: "Open the Terminals screen" — Terminals is not a Settings screen; it registers in the main navigation's Tools section (ui/src/features/terminals/register.tsx:8-16, section: 'tools', label nav-terminals = Terminals, i18nKey in shared.ftl:279; section label nav-section-tools = Tools shared.ftl:259). Added "from the main navigation's Tools section". · Verified true, left alone: name + device identifier with hostname-or-MAC placeholder (terminal-device-id-placeholder terminals.ftl:18-19; device_id hostname comment apps/desktop-client/src/commands/terminals.rs:394-395), manager role required (register.tsx:8 requiredRole: 'manager'), optional shared secret for sync auth (terminal-secret-label terminals.ftl:20; TerminalManagementScreen.tsx:678), JSON metadata (form.metadata TerminalManagementScreen.tsx:124,132,230), deactivate via isActive toggle and permanent delete with confirm (isActive TerminalManagementScreen.tsx:133,440; deleteTerminalScoped :9; delete confirmation :178-179), feature-override inheritance with Reset all overrides (handleResetOverrides :403, terminal-reset-overrides :835-837), the five override groups and their members verbatim (FEATURE_GROUPS :38-96: Sales 9 features, Payments cash/card/multi-currency, Inventory & Products 4, Hardware printer/drawer/display/NFC, Staff & Security, System), per-terminal soundVolume/darkMode/scaleAutoZero + scaleZeroOnBoot following the device (api/settings.ts:110,116-118 HardwareSettingsDto), device binding to store + workspace instance with clear-to-picker (setDeviceBinding/getDeviceBinding/clearDeviceBinding api/terminals.ts; bindingStores+bindingInstances TerminalManagementScreen.tsx:192-193), multi-store dashboard Active/Online/Total Terminals stats per store (MultiStoreDashboardScreen.tsx:112-113 activeTerminals/onlineTerminals; multi-store-stat-active/online/total-terminals multi-location.ftl:6-8; 5-minute online threshold :17), terminals appear in the topology editor alongside stores and warehouses (NodeTopologyEditor.tsx), pull-on-reconnect (topology sync topologyBranchSync.ts, applyTopology.ts). · id/ counterpart repaired with the same one finding. -->

## What a terminal is

Terminals — the registers you see in the topology — are the devices that run
kasir.mu: a counter register, a tablet, or a kitchen screen. Each terminal has
a name and a device identifier (hostname or MAC address) that the app reports
automatically. Managing terminals requires the manager role.

## Registering a terminal

Open the Terminals screen from the main navigation's Tools section and
register the device. Give it a readable name
("Front Counter") and the device identifier, and optionally a shared secret
for sync authentication and JSON metadata. Terminals can be deactivated or
deleted later; deleting is permanent.

## Feature overrides

By default a terminal inherits every feature your plan enables. Overrides
force a feature on or off for one device only. Overrides are grouped the way
the app organizes them:

- **Sales** — retail, restaurant, discount and tax engines, promotions,
  product bundles, loyalty, kitchen display, and table management
- **Payments** — cash, card, and multi-currency
- **Inventory & Products** — inventory tracking, product variants,
  categories, and barcode scanning
- **Hardware** — receipt printing, cash drawer, customer display, and NFC
  reader
- **Staff & Security** and **System**

Typical use: disable card payments on a self-service kiosk, or turn the
kitchen display on for a single screen. Reset all overrides to return a
terminal to plan defaults.

## Terminal preferences

Each terminal keeps its own preferences: **sound volume**, **dark mode**, and
**auto-zero the weight scale on boot**. These follow the device, not the
logged-in user, so a counter and a kitchen screen can each behave the way
their spot needs.

## Device binding

Bind a terminal to a store and a workspace instance so the device boots
straight into that screen instead of the picker — a kitchen screen that is
always the Kitchen Display, a counter that is always the Store POS. Clearing
the binding returns the device to the workspace picker.

## Terminal status

The multi-store dashboard tracks **active**, **online**, and **total**
terminals and shows terminal status per store, so you can see at a glance
which devices are up and working. Devices report in when they reconnect, and
a terminal that has been offline shows up here before it causes a surprise
at the counter.

## Terminals in the topology

Terminals appear in the topology editor alongside your stores and
warehouses, and the layout syncs to every device on reconnect. See
[Stores & Topology](../stores/) and [Workspaces](../workspaces/).

> last audited 09-09-26 by docs-auditor
