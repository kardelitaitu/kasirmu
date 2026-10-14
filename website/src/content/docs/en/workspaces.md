---
title: Workspaces
description: Choose what each screen does — retail checkout, restaurant service, kitchen, or back office.
category: gettingStarted
order: 7
updated: "2026-10-01"
---

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major, 2 minor) · Re-audit of the Workspaces guide. MAJOR: the workspace table was wrong in two ways at once. It named the retail workspace "Retail POS", but the seeded key `store-pos` is labelled **"Store POS"** (20260813_init.sql:1465-1471; DEFAULT_WORKSPACE_TYPES in ui/src/api/workspaces.ts:228-265) — while a SIXTH seeded type, `retail-pos`, is the one actually named "Retail POS". The table now lists all six seeded types with their real names. MINOR 1: the table presented Admin as an ordinary pickable card; the picker FILTERS IT OUT — "The admin workspace is not shown on the home screen — its features (settings, analytics, reports) are accessible via the Tools section below" (WorkspaceHome.tsx:377-379). Added as a callout and marked in the table, because a reader looking for an Admin card on the grid will not find one. MINOR 2: §Planned workspaces claimed the picker "shows placeholder cards" for Loyalty / Marketing / Online Orders "marked Coming soon". No such card exists: the seed holds exactly six types, the string "Coming soon" appears nowhere in ui/src outside three test files, and loyalty/marketing/online-orders are not workspace types. Rewritten to say they are roadmap items, not rendered placeholders. · VERIFIED AND LEFT ALONE: the five named workspace labels and descriptions; per-workspace settings cards (WorkspaceStorePosSettings = receipt layout/paper/currency/tax/barcode-scanner; WorkspaceRestaurantPosSettings = table management + course firing + kitchen printer; WorkspaceKdsSettings = SLA thresholds + order sound); the Tools-grid pointer for Staff; the assignment model and the pin/1–9 quick-launch behaviour. · NOT re-measured: a live picker render, pin persistence across sessions, and the 1–9 launch on a real keyboa

STAMP MERGED INTO THIS ONE — superseded stamp(s) kept verbatim as plain text (delimiters stripped so they cannot nest):

Audit stamp: 2026-09-19 · DSH · status: ACCURATE AFTER REPAIR (2 findings) · 2026-09-19 RE-AUDIT: the Staff pointer went stale again for a different reason than the 2026-09-08 finding. Staff management is now a dedicated fullscreen page — ui/src/features/staff/register.tsx:20-33 registers route staff with fullscreen: true and no registerNavItem — so AppShell renders it without AppLayout and it holds no sidebar entry. "Under Tools in the sidebar" is therefore no longer reachable; the sentence now points at the Staff Management card in the workspace picker's Tools grid. Verified in the running app: the Tools sidebar section lists Terminals, Features, Data, Audit Log, Security Trail, Offline Queue, Shifts, Memos — neither Staff nor Roles. · 2026-09-08 · DSH · status: ACCURATE AFTER REPAIR (1 finding) · Customer-facing page, first audit evidence. One navigation pointer corrected: Assignments are set in Settings -> Staff. Staff is registered in ui/src/features/staff/register.tsx with section: 'tools' (nav-section-tools = 'Tools') and ui/src/features/settings/ holds no reference to the staff route; same defect as user-roles.md, found by sweeping every bolded X -> Y path in the English customer docs against the nav registry (41 items, 10 sections). That sweep flagged exactly one other page, licensing.md's Settings -> License, and it is a FALSE POSITIVE: License is a real node at SettingsNavTree.tsx:92, so the pointer is correct and the sweep's model was incomplete. Reporting the false positive rather than acting on it - a checker that misfires on every Settings-child path teaches people to ignore it. -->

## The workspace picker

After signing in, staff land on a grid of workspace cards. Each workspace is
a role for the screen in front of you — what you can do, not where you are:

| Workspace       | What it is                                                                     | Shown as a card |
| --------------- | ------------------------------------------------------------------------------ | --------------- |
| Store POS       | Retail checkout — product lookup, customers, and loyalty                       | Ready           |
| Retail POS      | Retail checkout (the second seeded retail type)                                 | Ready           |
| Restaurant POS  | Table-service checkout — menu categories and table management                   | Ready           |
| Kitchen Display | Order queue for the kitchen — tap tickets to advance their status               | Ready           |
| Warehouse       | Products, stock levels, bundles, categories, and inventory reports              | Ready           |
| Admin           | Settings, staff, reports, audit log, and configuration                          | **Not on the home grid** — see below |

> **Admin is not one of the home-screen cards.** The picker filters it out
> deliberately: its features (settings, analytics, reports) are reached from
> the **Tools** section on the same screen instead, so it is a workspace you
> enter but not one you pick from the grid. (`WorkspaceHome.tsx:377-379`.)

## Access by assignment

Each staff member can only open the workspaces assigned to them — checkout
staff are typically assigned the POS workspaces, kitchen staff the Kitchen
Display. Cards you cannot open are shown disabled, and managers and above
are not assignment-gated. Assignments are set on the **Staff** screen — open it
from the **Staff Management** card in the workspace picker's Tools grid; it is a
dedicated full-screen page, not a sidebar entry. See
[User Roles](../user-roles/).

## Pinning and quick launch

Star a workspace to pin it to the front of the grid, and the most recently
used workspace surfaces next. Number keys 1–9 launch a workspace directly.

## Workspace settings

Each workspace has its own settings, so a screen behaves differently
depending on its role. Retail POS controls the receipt layout, paper width,
currency and tax display, and the barcode scanner. Restaurant POS controls
the table layout, course firing, and the kitchen printer. Kitchen Display
controls SLA escalation and the new-order sound. See
[Settings](../settings/) for the full list.

## Workspaces belong to a location

Every workspace instance is scoped to a location. On startup the device
resolves its location — from a terminal binding when one is set, otherwise the
primary location — and shows that location's workspaces. See
[Locations & Topology](../location/) and [Terminals](../terminals/).

## Planned workspaces

There is currently **no "coming soon" placeholder card in the picker**: the
seeded workspace types are exactly the six in the table above, and nothing in
the home screen renders a roadmap card. **Loyalty**, **Marketing**, and
**Online Orders** are roadmap items, not shipped or placeholder workspaces —
if you see a card for one, it came from your store's own workspace types, not
from the app.

**Kiosk** is not a workspace — it is a locked-down, self-service checkout
mode for an unattended screen. **Reports** are not a workspace either: sales
and analytics dashboards live inside the Admin workspace, under the **Reports**
screen.

Keep reading · **Previous:** [Your First Sale](../first-sale/) · **Next:** [First Day Live](../first-day/)

> last audited 11-10-26 by docs-auditor
