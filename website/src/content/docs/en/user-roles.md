---
title: User Roles
description: Five permission presets decide what each staff account can do and see.
category: gettingStarted
order: 5
updated: "2026-09-19"
---

<!-- Audit stamp: 2026-09-19 · DSH · status: ACCURATE AFTER REPAIR (3 findings) · 2026-09-19 RE-AUDIT: Staff management and role authoring became dedicated fullscreen pages — ui/src/features/staff/register.tsx:20-33 registers both routes with fullscreen: true and no longer carries a registerNavItem, so AppShell renders them without AppLayout and the sidebar holds neither. This page's two "under Tools in the sidebar" pointers were therefore wrong and are re-pointed at the workspace picker's Tools grid (Staff Management card) and at the Staff page's Roles button. Verified against the running app: the Tools sidebar section lists Terminals, Features, Data, Audit Log, Security Trail, Offline Queue, Shifts, Memos and neither Staff nor Roles. · 2026-09-08 · DSH · status: ACCURATE AFTER REPAIR (2 findings) · Customer-facing page, first audit evidence it ever carried. · Verified and correct: all 13 permission keys this page cites exist as declared consts in platform/core/src/rbac.rs (93 such keys; sales:void at :356, sales:refund at :358). The Staff-preset description matches the code grant-for-grant: rbac_presets.rs gives it exactly 22 keys, all checkout-side (sales_process, payments_*, discounts_apply, customers_create+view, loyalty_*, shifts_open+close, tables_*, kds_*, workspaces_switch) and none of the management keys the page says were stripped. platform/core/src/rbac.rs exists as cited. · FINDING 1, wrong guidance: the page told customers to find this in Settings -> Staff. Settings surfaces Staff nowhere - no route reference exists anywhere in ui/src/features/settings/ - while staff/register.tsx registers both screens with section: tools, whose label is nav-section-tools = “Tools”. Fixed to Tools -> Staff. · FINDING 2, a shipped feature omitted, same class as the deploy-history gap on stores.md: “Custom is a sixth preset … not shown in the standard staff dropdown yet” is literally true (StaffManagementScreen states it presents exactly the five preset roles) yet it reads as though custom roles are unavailable. They are shipped: a routed screen (route roles, label Roles, gated manager AND staff:manage_roles) backed by create/update/delete_role_scoped, list_permission_keys_scoped and list_role_holders_scoped, all registered and all actually called by that screen. New “Authoring custom roles” section, including both delete guards - preset ids refuse, and a role still referenced refuses, per delete_role_scoped’s own ///. · ROLE_PRESETS holds SIX entries, not five: my first scan said four because I sliced a fixed 6000 chars out of a 10259-char array and believed the result. A truncated read reported a wrong count in the direction that would have made me accuse an accurate page. -->

## What a role is

Every staff account has a role — a permission preset that decides what the
account can do and see. Roles come from a fixed taxonomy of five presets,
shown when you edit an account on the **Staff** screen — a dedicated
full-screen page you open from the **Staff Management** card in the workspace
picker's Tools grid, not a sidebar entry. The bundled table actually holds six presets;
the staff picker offers five of them, and the sixth is described below.

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

## The planned model

This matrix is the target for the codebase:

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

The **Roles** screen — open it with the **Roles** button on the Staff page — is where
custom roles are built. It is a separate screen from the staff
list, and it is gated more tightly: **manager or owner** *and* the
`staff:manage_roles` permission. Read-only staff cannot reach it even if they can view
the staff list, because a role defines the grants every other check resolves through.

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

> last audited 19-09-26 by docs-auditor
