---
title: API Read Tiers
description: Control GET access through scoped JWT permissions — mint, preset, call.
category: reference
order: 8
updated: "2026-09-01"
---

## Overview

Every JWT can optionally carry a `permissions` claim — a list of
[permission-registry](/en/docs/user-roles/) keys that gate GET requests.
A token without the claim keeps **full read** access (backward
compatible — existing integrations work untouched).

The read gate runs on the cloud server's REST API (spec 0047). All
protected GET routes (products, categories, exchange rates, plan,
sales, images) return `403 insufficient_scope` when the token's
permissions list lacks the required key.

## Presets

Presets are named key lists you can specify at mint time instead of
enumerating individual keys.

| Preset | Permissions | Intended for |
|---|---|---|
| `terminal` *(auto-bound)* | `products:read`, `categories:read`, `reference:read`, `plan:read` | POS terminals via client credentials |
| `dashboard` | `products:read`, `reports:view`, `analytics:view` | Third-party dashboards (PII-free by construction) |
| `audit` | `audit:view`, `reports:view` | Accountants and auditors |

> **PII protection (decision 3):** routes marked `pii: true` (currently
> only `GET /api/v1/sales/{id}`) are excluded from the `dashboard`
> preset. Adding a new PII-bearing route requires flipping its `pii`
> flag in `READ_KEY_MAP` — the PII-invariant test (`dashboard ∩ pii-routes
> = ∅`) will fail until the dashboard preset is updated.

## Minting a scoped token

### Terminal client credentials (auto-bound)

POS terminals authenticate with `client_id` + `client_secret` (registered
via the Terminals page). The server automatically binds the `terminal`
preset — you don't need to pass any tier parameters:

```bash
curl -X POST https://your-server/api/v1/tokens \
  -H "Content-Type: application/json" \
  -d '{"label":"front-register","client_id":"term-1","client_secret":"s3cret"}'
```

**Escape hatch:** `OZ_TERMINAL_READ_TIER=full` on the server restores
legacy full-read for terminal tokens. This is **deprecated** and will
be removed after one release cycle — use it only to ease migration.

### Admin key (preset-based)

```bash
curl -X POST https://your-server/api/v1/tokens \
  -H "X-Admin-Key: your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"label":"third-party-dash","read_preset":"dashboard"}'
```

### Admin key (custom permission list)

```bash
curl -X POST https://your-server/api/v1/tokens \
  -H "X-Admin-Key: your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"label":"limited-view","read_permissions":["products:read","sales:view"]}'
```

Unknown preset names or unregistered permission keys return
`422 UNPROCESSABLE_ENTITY` with one of:
- `"error": "unknown_preset"`
- `"error": "unknown_permission"`

## Calling with a scoped token

Include the JWT in the standard `Authorization` header:

```bash
curl https://your-server/api/v1/products \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

When the token lacks the required permission for the route the server
returns `403 Forbidden` with:

```json
{"error": "insufficient_scope"}
```

Legacy tokens (no `permissions` claim) pass through every route as before.

## Read-key map

Every protected GET route is mapped to a registry key:

| Route | Key | PII |
|---|---|---|
| GET /api/v1/products | `products:read` | no |
| GET /api/v1/products/{sku} | `products:read` | no |
| GET /api/v1/categories | `categories:read` | no |
| GET /api/v1/exchange-rates | `reference:read` | no |
| GET /api/v1/exchange-rates/latest | `reference:read` | no |
| GET /api/v1/exchange-rates/latest/{from}/{to} | `reference:read` | no |
| GET /api/v1/tenants/me/plan | `plan:read` | no |
| GET /api/v1/sales/{id} | `sales:view` | **yes** |
| GET /api/v1/images:pack | `products:read` | no |
| GET /api/v1/images:missing | `products:read` | no |
| GET /api/v1/images/{hash16} | `products:read` | no |

The drift guard (`every_spec_get_operation_has_read_key_entry` in
`openapi_tests.rs`) ensures this map stays in sync with the OpenAPI
spec. Any GET route described in the spec with `bearerAuth` must have
a matching entry here, or the test fails red.

## Permission registry

The full set of permission keys is defined in
`platform/core/src/permission_registry.rs`. Keys are organised by
family (`products`, `sales`, `staff`, etc.) and each carries a
classification (sensitive / non-sensitive). Read-only keys used by
the tiers:

- `products:read`
- `categories:read`
- `reference:read`
- `plan:read`
- `sales:view`
- `reports:view`
- `analytics:view`
- `audit:view`

Grow the system by adding keys here — never by inventing a parallel
taxonomy. See the [user roles guide](/en/docs/user-roles/) for the
full registry.

## Questions?

Open an issue tagged `auth-read-tiers` or ask in the dev Slack
`#api` channel.