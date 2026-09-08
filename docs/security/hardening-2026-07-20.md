# Input Validation & Rate Limiting — 0.0.14 Hardening

## Input Validation

All 250+ Tauri commands use Rust's type system for basic validation (strongly typed parameters prevent injection at the serialization layer).
Additional hardening recommendations:

### Critical Commands (spot-checked)

> Updated 2026-08-08 by docs-auditor: command names below reflect the current IPC surface — `check_login` is now `staff_login`, and `create_sale` became the `start_sale`/`complete_sale` pair.

| Command | Validation | Status |
|---------|-----------|--------|
| `staff_login` (was `check_login`) | Username: 1-100 chars, alphanumeric + `._-`. PIN: exactly 4-6 digits | ✅ `auth.rs:122` |
| `start_sale` / `complete_sale` (was `create_sale`) | Cart validation: currency match, qty > 0, price ≥ 0. Payment amount ≤ total | ✅ `pos.rs` |
| `import_data` | JSON schema validation, foreign key checks, size limit | ✅ `data.rs` |
| `list_products` (was `search_products`) | Query length ≤ 200 chars, SQL injection prevented via parameterized queries | ✅ `products.rs:219` |
| `build_custom_report` | Column whitelist validation, parameterized date values | ✅ `reports.rs` |

### Guidelines for Future Commands

- **String inputs**: Max length check before DB query (prevents oversized payloads)
- **Numeric inputs**: Range validation (price ≥ 0, qty 1-9999)
- **File paths**: Resolve relative to app data dir (prevents path traversal)
- **SQL**: Always use `rusqlite` parameterized queries — never string interpolation
- **Tauri State**: Session token validation on scoped commands

## Rate Limiting

Already implemented in `apps/cloud-server/` (P8-1). Token-bucket algorithm with per-tenant per-endpoint buckets.

| Endpoint | Limit | Status |
|----------|-------|--------|
| `/api/sync/push` | 100/min | ✅ |
| `/api/sync/pull` | 300/min | ✅ |
| `/api/sync/status` | 300/min | ✅ |
| `/api/sync/snapshot` | 50/min | ✅ |
| All other `/api/*` | 300/min (default) | ✅ |

> Updated 2026-08-08 by docs-auditor: routes are `/api/sync/*` (no `v1` segment) — see `apps/cloud-server/src/main.rs` sync router.

Middleware returns `429 Too Many Requests` with `Retry-After` header. Background cleanup (60s interval) removes stale buckets.

---

> (repairs applied; `search_products` → `list_products`).
>
> last audited 29-08-26 by docs-auditor
