---
title: User Roles
description: Five permission presets decide what each staff account can do and see.
category: guides
order: 6
updated: "2026-10-01"
---

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (0 major, 2 minor) · Re-audit of the User Roles guide. MINOR 1 (a shipped surface omitted): the page said role authoring is "a separate screen" reached by a Roles button. It is a TAB on the Staff page — staff/register.tsx registers ONE lazy component at THREE routes (`staff`, `roles`, `trash`, all fullscreen: true, all screenGroup: 'staff-management'), and StaffManagementScreen derives its active tab from the route. Reworded to the tab model with the three route names. MINOR 2 (a third tab the page never mentioned): **Trash** lists deleted identities and is gated on `staff:delete`, which only the Owner preset holds (register.tsx's own comment: "the gate is staff:delete (owner-only by preset) rather than staff:read"). Added, because a reader told there are two tabs will not find the third. · VERIFIED AND LEFT ALONE: ROLE_PRESETS holds SIX entries — Owner, Manager, Staff, Admin, Auditor, Custom (rbac_presets.rs, six `RolePreset {}` literals) — so the page's "five presets, sixth described below" framing is right; all 13 cited permission keys exist in platform/core/src/rbac.rs (93 keys); the Roles route really is gated requiredRole 'manager' AND requiredPermission 'staff:manage_roles' (register.tsx); the Staff route carries 'staff:read' and the Trash route 'staff:delete'; the Staff Management card is in the workspace picker's Tools grid (ui/src/features/workspaces/tools.tsx id 'staff', minimumRole 'manager'). · NOT re-measured: the live 5-row permission matrix behaviour (it needs a running app and a real session per role); left as the page's own reproduced tab

STAMP MERGED INTO THIS ONE — superseded stamp(s) kept verbatim as plain text (delimiters stripped so they cannot nest):

Audit stamp: 2026-09-19 · DSH · status: ACCURATE AFTER REPAIR (3 findings) · 2026-09-19 RE-AUDIT: Staff management and role authoring became dedicated fullscreen pages — ui/src/features/staff/register.tsx:20-33 registers both routes with fullscreen: true and no longer carries a registerNavItem, so AppShell renders them without AppLayout and the sidebar holds neither. This page's two "under Tools in the sidebar" pointers were therefore wrong and are re-pointed at the workspace picker's Tools grid (Staff Management card) and at the Staff page's Roles button. Verified against the running app: the Tools sidebar section lists Terminals, Features, Data, Audit Log, Security Trail, Offline Queue, Shifts, Memos and neither Staff nor Roles. · 2026-09-08 · DSH · status: ACCURATE AFTER REPAIR (2 findings) · Customer-facing page, first audit evidence it ever carried. · Verified and correct: all 13 permission keys this page cites exist as declared consts in platform/core/src/rbac.rs (93 such keys; sales:void at :356, sales:refund at :358). The Staff-preset description matches the code grant-for-grant: rbac_presets.rs gives it exactly 22 keys, all checkout-side (sales_process, payments_*, discounts_apply, customers_create+view, loyalty_*, shifts_open+close, tables_*, kds_*, workspaces_switch) and none of the management keys the page says were stripped. platform/core/src/rbac.rs exists as cited. · FINDING 1, wrong guidance: the page told customers to find this in Settings -> Staff. Settings surfaces Staff nowhere - no route reference exists anywhere in ui/src/features/settings/ - while staff/register.tsx registers both screens with section: tools, whose label is nav-section-tools = “Tools”. Fixed to Tools -> Staff. · FINDING 2, a shipped feature omitted, same class as the deploy-history gap on stores.md: “Custom is a sixth preset … not shown in the standard staff dropdown yet” is literally true (StaffManagementScreen states it presents exactly the five preset roles) yet it reads as though custom roles are unavailable. They are shipped: a routed screen (route roles, label Roles, gated manager AND staff:manage_roles) backed by create/update/delete_role_scoped, list_permission_keys_scoped and list_role_holders_scoped, all registered and all actually called by that screen. New “Authoring custom roles” section, including both delete guards - preset ids refuse, and a role still referenced refuses, per delete_role_scoped’s own ///. · ROLE_PRESETS holds SIX entries, not five: my first scan said four because I sliced a fixed 6000 chars out of a 10259-char array and believed the result. A truncated read reported a wrong count in the direction that would have made me accuse an accurate page. -->

## What a role is

Every staff account has a role — a permission preset that decides what the
account can do and see. Roles come from a fixed taxonomy of five presets,
shown when you edit an account on the **Staff** screen — a dedicated
full-screen page you open from the **Staff Management** card in the workspace
picker's Tools grid, not a sidebar entry. The bundled table actually holds six presets;
the staff picker offers five of them, and the sixth is described below. The page itself is
a full-screen view with three tabs — **Staff**, **Roles**, and **Trash** — registered at
`#/staff`, `#/roles` and `#/trash`.

## The five roles

| Access area                       | Staff | Manager | Auditor | Admin | Owner |
| --------------------------------- | ----- | ------- | ------- | ----- | ----- |
| Sales & checkout                  | ✓     | ✓       | —       | ✓     | ✓     |
| Voids & refunds                   | —     | ✓       | —       | ✓     | ✓     |
| Payments (cash, card, settle)     | ✓     | ✓       | —       | ✓     | ✓     |
| Discounts (apply)                 | ✓     | ✓       | —       | ✓     | ✓     |
| Attach customer & loyalty at checkout | ✓ | ✓       | —       | ✓     | ✓     |
| Shifts (open, close)              | ✓     | ✓       | view    | ✓     | ✓     |
| Products & catalog                | —     | ✓       | read    | ✓     | ✓     |
| Edit product cost                 | —     | ✓       | —       | ✓     | ✓     |
| Inventory (adjust, transfer, count) | —   | ✓       | read    | ✓     | ✓     |
| Customers & loyalty (manage)      | —     | ✓       | read    | ✓     | ✓     |
| Promotions (manage)               | —     | ✓       | —       | ✓     | ✓     |
| Staff accounts (create, update)   | —     | ✓       | read    | ✓     | ✓     |
| Manage roles                      | —     | —       | —       | ✓     | ✓     |
| Delete staff                      | —     | —       | —       | —     | ✓     |
| Settings                          | —     | ✓       | read    | ✓     | ✓     |
| Reports & analytics               | —     | ✓       | view    | ✓     | ✓     |
| Audit log                         | —     | ✓       | view    | ✓     | ✓     |
| Kitchen Display (view, update)    | ✓     | ✓       | view    | ✓     | ✓     |
| Terminals (register, edit, delete) | —    | ✓       | —       | ✓     | ✓     |
| Workspace access                  | assigned | ✓     | ✓       | ✓     | ✓     |

Legend: **✓** full access · **read** view only · **assigned** only the
workspaces assigned to the account · **—** no access.

## The model in force

This matrix is the **shipped** model, not a target — the four gaps that once stood between
the plan and the code were closed (see [Implementation status](#implementation-status)).
It is reproduced from `platform/core/src/rbac_presets.rs`, where `ROLE_PRESETS` is the
authoritative list:

- **Staff is a checkout-operations role.** It keeps the actions performed at
  the register — processing sales, payments, in-cart discounts, attaching
  customers and loyalty, opening and closing shifts — plus the workspaces
  assigned to it. Every management surface (products, inventory, customers,
  promotions, staff, settings, reports, audit, terminals) requires **manager
  or above**, and voids, refunds, and price-sensitive actions are manager+
  as well.
- **Owner** is seeded with a global wildcard. **Admin** is global except
  ownership transfer, billing, and irreversible actions such as staff
  deletion. **Auditor** is global and read-only: it views operational data
  and the audit log but never manages, never exports, and never sees
  sensitive profile fields.
- **Custom** is the sixth preset — no permissions of its own, so an admin picks every
  permission manually. It is deliberately *not* offered in the role dropdown on the staff
  screen. It does not need to be: custom roles are built and managed on their own screen,
  see [Authoring custom roles](#authoring-custom-roles) below.

## Authoring custom roles

The **Roles** view is a **tab on the Staff page** — open the Staff page and switch to
**Roles** (both `#/staff` and `#/roles` land on the same full-screen page, differing only
in which tab opens first). It is gated more tightly than the staff list: **manager or owner**
*and* the `staff:manage_roles` permission. Read-only staff cannot reach it even if they can
view the staff list, because a role defines the grants every other check resolves through.

A third tab, **Trash**, lists deleted identities so they stay readable after deletion. It is
gated on `staff:delete`, which the **Owner** preset holds and no other preset does — so a
manager who cannot delete anyone does not see who was deleted.

An authored role is a named set of permission keys chosen from the same registry the
five presets are built from — nothing can be granted there that the backend does not
enforce, and the picker lists only real keys. Roles can be renamed, re-granted, and
deleted, with two guards: the five presets cannot be edited or deleted through this
screen (they are re-synced from the built-in table on every reseed, so a hand-edit there
would be destroyed), and a role still held by any account cannot be deleted.

Because assignments are what the app checks, this screen also shows which accounts hold
a role.

## Implementation status

The four gaps in the plan have been closed:

- **The `Staff` preset is now checkout-only** (`platform/core/src/rbac.rs`):
  it keeps sales processing, payments, in-cart discounts, customer and
  loyalty attach, shift open/close, table-service operations, KDS, and
  workspace switching — and nothing else. `sales:void`, `sales:refund`,
  `payments:refund`, `products:*`, `staff:*`, `reports:*`, `audit:*`,
  `terminals:*`, `inventory:*`, and `promotions:*` were removed, with pinned
  tests updated to the new model.
- **All management screens are explicitly gated.** Customers, Sales History,
  and both Dashboard screens now declare `requiredRole: 'manager'`, and the
  `'manager'` gate no longer admits Staff anywhere.
- **Auditor reaches its read-only screens.** Routing honors
  `requiredPermission` (mirroring backend `has_permission`): `audit:view` on
  the audit log, `reports:view` / `inventory:view` on the report screens,
  `products:read`, `customers:view`, `staff:read`, `settings:read`,
  `shifts:view_any`, and `loyalty:view` on the matching management screens.
- **Analytics is aligned.** The Analytics screen now declares
  `requiredRole: 'manager'` with `analytics:view` as the authoritative
  permission key.
- **In-page action buttons are permission-aware.** The management-level
  gate (`isManager`) no longer admits Staff, so the Void, Refund, price
  override, audit mark-reviewed/export, and full settings-card buttons are
  hidden for Staff instead of rendering a backend denial. The dev-mock
  (`ui/src/dev-mock/tauri-api.ts`) exercises the real five-role model —
  retired Cashier/Kitchen are gone everywhere, including the role badges,
  icons, and workspace picker.

> 2026-10-01 freshness re-audit (docs session): no drift. ROLE_PRESETS holds
> six; both staff routes still fullscreen (staff/register.tsx); every gate
> this page names verified: customers/sales-history/dashboard requiredRole
> manager, analytics requiredRole manager + analytics:view, Roles screen
> requiredPermission staff:manage_roles (rbac.rs:440).
> last audited 11-10-26 by docs-auditor
