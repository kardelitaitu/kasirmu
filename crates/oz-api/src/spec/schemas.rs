//! Base schema components of the shared OpenAPI document.
//!
//! Owned by the `spec` module — `mod.rs` assembles them into
//! `base_spec()` and owns the scope semantics. Pure builders:
//! no state, no IO.

use serde_json::{Value, json};

// ── Base schemas (shared surface) ────────────────────────────────────

pub(super) fn build_base_schemas() -> Value {
    json!({
        "ErrorResponse": {
            "type": "object",
            "required": ["error"],
            "properties": {
                "error": { "type": "string", "description": "Human-readable error description" }
            },
            "deprecated": true,
            "description": "Legacy flat error format. New code should use `ErrorEnvelope`."
        },
        "ErrorEnvelope": {
            "type": "object",
            "required": ["error"],
            "properties": {
                "error": {
                    "type": "object",
                    "required": ["code", "message"],
                    "properties": {
                        "code": { "type": "string", "description": "Machine-readable error code (stable across versions)", "example": "invalid_status_transition" },
                        "message": { "type": "string", "description": "Human-readable description", "example": "Cannot transition from pending to completed" },
                        "details": { "type": "array", "items": { "type": "object" }, "description": "Optional per-field validation details" }
                    }
                }
            },
            "description": "Standard error envelope for all 4xx/5xx responses. The `code` field is the stable contract — use it for programmatic handling."
        },
        "PaginatedResponse": {
            "type": "object",
            "required": ["data", "total", "limit", "offset"],
            "properties": {
                "data": { "type": "array", "items": {}, "description": "Page of results (item schema varies by endpoint)" },
                "total": { "type": "integer", "format": "int64", "description": "Total number of items matching the query (across all pages)" },
                "limit": { "type": "integer", "format": "int64", "description": "Requested page size (max 200)" },
                "offset": { "type": "integer", "format": "int64", "description": "Zero-based offset of the current page" }
            },
            "description": "Standard pagination envelope. All list endpoints will adopt this when pagination support lands."
        },
        "Money": {
            "type": "object",
            "required": ["minor_units", "currency"],
            "properties": {
                "minor_units": { "type": "integer", "format": "int64", "description": "Amount in minor units (e.g., 199 = $1.99)", "example": 199 },
                "currency": { "type": "string", "description": "ISO 4217 currency code", "example": "USD" }
            }
        },
        "MemoSyncEnvelope": {
            "type": "object",
            "required": ["memos"],
            "properties": {
                "memos": { "type": "array", "items": { "$ref": "#/components/schemas/MemoSyncRow" }, "description": "The pushing database's complete non-deleted memo state; absence from the array deletes the memo" }
            }
        },
        "MemoSyncRow": {
            "type": "object",
            "required": ["id", "author_user_id", "author_role", "title", "body", "status", "duration", "revision", "created_at", "updated_at"],
            "properties": {
                "id": { "type": "string", "description": "Memo id (UUID v7, desktop-minted) — the cloud's primary key" },
                "author_user_id": { "type": "string" },
                "author_role": { "type": "string", "description": "Author's role snapshot at publish time" },
                "title": { "type": "string" },
                "body": { "type": "string" },
                "status": { "type": "string", "enum": ["draft", "published", "expired", "stopped", "archived"] },
                "duration": { "type": "string", "enum": ["12h", "24h", "3d", "7d", "30d"] },
                "revision": { "type": "integer", "format": "int64" },
                "published_at": { "type": ["string", "null"], "format": "date-time" },
                "expires_at": { "type": ["string", "null"], "format": "date-time" },
                "stopped_at": { "type": ["string", "null"], "format": "date-time" },
                "stopped_by": { "type": ["string", "null"] },
                "archived_at": { "type": ["string", "null"], "format": "date-time", "description": "The retention-deletion clock" },
                "created_at": { "type": "string", "format": "date-time" },
                "updated_at": { "type": "string", "format": "date-time" },
                "location_ids": { "type": "array", "items": { "type": "string" }, "description": "Targeted locations; empty = Organization Memo" },
                "recipients": { "type": "array", "items": { "$ref": "#/components/schemas/MemoRecipientSyncRow" } }
            }
        },
        "MemoRecipientSyncRow": {
            "type": "object",
            "required": ["id", "terminal_id", "delivery_status"],
            "properties": {
                "id": { "type": "string", "description": "Recipient row id (desktop-minted)" },
                "terminal_id": { "type": "string", "description": "The addressed terminal" },
                "delivery_status": { "type": "string", "enum": ["pending", "delivered", "acknowledged"] },
                "delivered_at": { "type": ["string", "null"], "format": "date-time" },
                "acknowledged_at": { "type": ["string", "null"], "format": "date-time" },
                "acknowledged_by": { "type": ["string", "null"] }
            }
        },
        "MemoSyncResult": {
            "type": "object",
            "required": ["upserted", "deleted"],
            "properties": {
                "upserted": { "type": "integer", "format": "int64", "description": "Memos upserted (the snapshot size)" },
                "deleted": { "type": "integer", "format": "int64", "description": "Memos deleted because the desktop no longer has them" }
            }
        },
        "MemoDisplayEnvelope": {
            "type": "object",
            "required": ["memos", "cadence"],
            "properties": {
                "memos": { "type": "array", "items": { "$ref": "#/components/schemas/MemoActive" }, "description": "Location memos stacked above Organization memos, newest-published first" },
                "cadence": { "$ref": "#/components/schemas/MemoCadence" }
            }
        },
        "MemoActive": {
            "type": "object",
            "required": ["id", "location_ids", "author_user_id", "author_role", "title", "body", "duration", "revision", "created_at", "delivery_status"],
            "properties": {
                "id": { "type": "string" },
                "location_ids": { "type": "array", "items": { "type": "string" }, "description": "Targeted locations; empty = Organization Memo" },
                "author_user_id": { "type": "string" },
                "author_role": { "type": "string" },
                "title": { "type": "string" },
                "body": { "type": "string" },
                "duration": { "type": "string", "enum": ["12h", "24h", "3d", "7d", "30d"] },
                "revision": { "type": "integer", "format": "int64" },
                "published_at": { "type": ["string", "null"], "format": "date-time" },
                "expires_at": { "type": ["string", "null"], "format": "date-time" },
                "created_at": { "type": "string", "format": "date-time" },
                "delivery_status": { "type": "string", "enum": ["pending", "delivered", "acknowledged"], "description": "The asking terminal's delivery state for this memo" }
            }
        },
        "MemoCadence": {
            "type": "object",
            "required": ["base_interval_secs", "kds_interval_secs"],
            "properties": {
                "base_interval_secs": { "type": "integer", "format": "int64", "description": "Base notification interval in seconds" },
                "kds_interval_secs": { "type": "integer", "format": "int64", "description": "KDS interval — derived as 2 × base" }
            }
        },
        "MemoAckRequest": {
            "type": "object",
            "properties": {
                "acknowledged_by": { "type": ["string", "null"], "description": "The staff user at the terminal who acknowledged — informational only (terminal tokens carry no user identity)" }
            }
        },
        "MemoAckResult": {
            "type": "object",
            "required": ["memo_id", "terminal_id", "delivery_status", "acknowledged_at", "changed"],
            "properties": {
                "memo_id": { "type": "string" },
                "terminal_id": { "type": "string", "description": "The terminal whose recipient row moved (from the token claim)" },
                "delivery_status": { "type": "string", "enum": ["acknowledged"] },
                "acknowledged_at": { "type": "string", "format": "date-time" },
                "changed": { "type": "boolean", "description": "True when THIS call moved the row; false on an idempotent re-ack" }
            }
        },
        "CreateTokenRequest": {
            "type": "object",
            "required": ["label"],
            "properties": {
                "label": { "type": "string", "description": "Human-readable label for the token", "example": "kitchen-display-1" },
                "expiry_hours": { "type": "integer", "format": "int64", "description": "Expiry in hours (default: 24)", "example": 24 },
                "tenant_id": { "type": "string", "description": "Optional tenant/store ID for multi-tenant isolation (admin-key path only — the client-credentials path takes the tenant from the terminal's registration, never the body)" },
                "client_id": { "type": "string", "description": "Registered terminal ID — client-credentials mint path (ADR sync-auth-hardening P3); paired with client_secret, no admin key needed" },
                "client_secret": { "type": "string", "description": "Device secret from terminal registration (verified against the stored SHA-256 hash)" },
                "read_preset": { "type": "string", "enum": ["terminal", "dashboard", "audit"], "description": "Read-tier preset (spec 0047) — admin-key mint path only; terminal client-credentials always bind `terminal` server-side" },
                "read_permissions": { "type": "array", "items": { "type": "string" }, "description": "Explicit permission-registry keys for the token's read tier — admin-key path only; overrides read_preset when both are present" }
            }
        },
        "CreateProductRequest": {
            "type": "object",
            "required": ["sku", "name", "price"],
            "properties": {
                "sku": { "type": "string", "description": "Unique product SKU", "example": "COFFEE-001" },
                "name": { "type": "string", "description": "Display name", "example": "Espresso" },
                "price": { "$ref": "#/components/schemas/Money" },
                "category_id": { "type": "string", "description": "Optional category ID" },
                "barcode": { "type": "string", "description": "Optional barcode (EAN-13, UPC-A, etc.)" },
                "initial_stock": { "type": "integer", "format": "int64", "description": "Initial stock quantity (0 or omitted = no inventory row)", "default": 0 }
            }
        },
        "ProductDetail": {
            "type": "object",
            "properties": {
                "id": { "type": "string", "description": "Internal product ID" },
                "sku": { "type": "string" },
                "name": { "type": "string" },
                "price": { "$ref": "#/components/schemas/Money" },
                "category_id": { "type": ["string", "null"] },
                "category_name": { "type": ["string", "null"] },
                "barcode": { "type": ["string", "null"] },
                "stock_qty": { "type": ["integer", "null"], "format": "int64" },
                "created_at": { "type": "string", "format": "date-time" },
                "updated_at": { "type": "string", "format": "date-time" },
                "image_hash": { "type": ["string", "null"], "description": "Slot-1 primary image content hash (spec 0046b)" },
                "images": { "type": "array", "items": { "$ref": "#/components/schemas/ProductImage" }, "description": "Content-addressed image assignments (slots 1..5)" }
            }
        },
        "ProductImage": {
            "type": "object",
            "properties": {
                "slot": { "type": "integer", "description": "1 = primary, 2..5 = alternatives" },
                "hash": { "type": "string", "description": "16-hex content hash" },
                "position": { "type": "integer", "description": "Display order of alternatives (0-based)" }
            }
        },
        "PutImageResponse": {
            "type": "object",
            "required": ["hash16"],
            "properties": {
                "hash16": { "type": "string", "description": "16-hex content hash of the stored image" }
            }
        },
        "BatchImageResult": {
            "type": "object",
            "properties": {
                "hash": { "type": ["string", "null"], "description": "Content hash when accepted; null when rejected" },
                "status": { "type": "string", "enum": ["stored", "duplicate", "rejected"], "description": "Per-hash outcome" }
            }
        },
        "BatchPutResponse": {
            "type": "object",
            "properties": {
                "results": { "type": "array", "items": { "$ref": "#/components/schemas/BatchImageResult" }, "description": "Per-hash outcomes, in the same order as the request frames" }
            }
        },
        "MissingHashesResponse": {
            "type": "object",
            "properties": {
                "missing_hashes": { "type": "array", "items": { "type": "string" }, "description": "Candidate hashes the tenant has no active image_refs row for" }
            }
        },
        "PatchStockRequest": {
            "type": "object",
            "required": ["delta"],
            "properties": {
                "delta": { "type": "integer", "format": "int64", "description": "Positive to restock, negative to sell", "example": -10 }
            }
        },
        "PatchStockResponse": {
            "type": "object",
            "properties": {
                "sku": { "type": "string" },
                "previous_qty": { "type": "integer", "format": "int64" },
                "new_qty": { "type": "integer", "format": "int64" }
            }
        },
        "ListProductsResponse": {
            "type": "object",
            "description": "Envelope for the product list. `missing_hashes` lists content hashes referenced by product image assignments whose files are not present in the server's image store — clients can fetch them via the image endpoints (spec 0046b).",
            "properties": {
                "products": { "type": "array", "items": { "$ref": "#/components/schemas/ProductDetail" } },
                "missing_hashes": { "type": "array", "items": { "type": "string" }, "description": "Content hashes referenced by products but absent from the image store" }
            }
        },
        "CategoryDto": {
            "type": "object",
            "properties": {
                "id": { "type": "string" },
                "name": { "type": "string", "example": "Drinks" },
                "colour": { "type": "string", "description": "Hex colour code", "example": "#06b6d4" },
                "created_at": { "type": "string", "format": "date-time" }
            }
        },
        "CreateTaxRateRequest": {
            "type": "object",
            "required": ["name", "rate_bps", "is_default", "is_inclusive"],
            "properties": {
                "name": { "type": "string", "description": "Display name", "example": "VAT 10%" },
                "rate_bps": { "type": "integer", "format": "int64", "description": "Rate in basis points (1000 = 10%)", "example": 1000 },
                "is_default": { "type": "boolean", "description": "Whether this is the default rate" },
                "is_inclusive": { "type": "boolean", "description": "Whether the rate is tax-inclusive" }
            }
        },
        "CreateExchangeRateRequest": {
            "type": "object",
            "required": ["from_currency", "to_currency", "rate_millionths"],
            "properties": {
                "from_currency": { "type": "string", "description": "ISO-4217 alpha-3 source currency code", "example": "USD" },
                "to_currency": { "type": "string", "description": "ISO-4217 alpha-3 target currency code", "example": "IDR" },
                "rate_millionths": { "type": "integer", "format": "int64", "description": "Fixed-point rate at 6-decimal scale (16000000 = 16.0), strictly positive", "example": 16000000 },
                "source": { "type": "string", "description": "Provenance label; defaults to 'manual'", "example": "manual" },
                "effective_date": { "type": "string", "description": "YYYY-MM-DD; defaults to today (UTC)", "example": "2026-08-31" }
            }
        },
        "ExchangeRateResponse": {
            "type": "object",
            "required": ["id", "from_currency", "to_currency", "rate_millionths", "source", "effective_date", "created_at"],
            "properties": {
                "id": { "type": "string", "description": "Row id (UUID v7)" },
                "from_currency": { "type": "string", "example": "USD" },
                "to_currency": { "type": "string", "example": "IDR" },
                "rate_millionths": { "type": "integer", "format": "int64", "example": 16000000 },
                "source": { "type": "string", "example": "manual" },
                "effective_date": { "type": "string", "example": "2026-08-31" },
                "created_at": { "type": "string", "description": "RFC-3339 creation timestamp" }
            }
        },
        "CreateUserRequest": {
            "type": "object",
            "required": ["username", "pin_hash", "display_name", "role_id"],
            "properties": {
                "username": { "type": "string", "description": "Unique username for login" },
                "pin_hash": { "type": "string", "description": "PIN hash for authentication" },
                "display_name": { "type": "string", "description": "Display name shown in the UI" },
                "role_id": { "type": "string", "description": "Role ID (must reference an existing role)", "example": "role-staff" }
            }
        },
        "SaleLineItem": {
            "type": "object",
            "required": ["sku", "qty", "unit_price"],
            "properties": {
                "sku": { "type": "string" },
                "qty": { "type": "integer", "format": "int64" },
                "unit_price": { "$ref": "#/components/schemas/Money" }
            }
        },
        "CreateSaleRequest": {
            "type": "object",
            "required": ["lines"],
            "properties": {
                "lines": {
                    "type": "array",
                    "items": { "$ref": "#/components/schemas/SaleLineItem" },
                    "minItems": 1,
                    "description": "Line items (at least one required)"
                }
            }
        },
        "UpdateSaleStatusRequest": {
            "type": "object",
            "required": ["status"],
            "properties": {
                "status": { "type": "string", "description": "New status: 'pending', 'active', 'completed', or 'voided'", "enum": ["pending", "active", "completed", "voided"] }
            }
        },
        "TokenResponse": {
            "type": "object",
            "required": ["token", "expires_at", "token_id"],
            "properties": {
                "token": { "type": "string", "description": "Signed JWT string", "example": "eyJhbGciOiJIUzI1NiJ9.eyJ..." },
                "expires_at": { "type": "string", "format": "date-time", "description": "ISO-8601 expiry timestamp" },
                "token_id": { "type": "string", "format": "uuid", "description": "Unique token identifier" }
            }
        },
        "CreateTokenResponse": {
            "type": "object",
            "required": ["token"],
            "properties": {
                "token": { "$ref": "#/components/schemas/TokenResponse" }
            }
        },
        "TaxRateResponse": {
            "type": "object",
            "required": ["id", "name", "rate_bps", "is_default", "is_inclusive"],
            "properties": {
                "id": { "type": "string", "description": "Unique tax rate ID" },
                "name": { "type": "string", "description": "Display name", "example": "VAT 10%" },
                "rate_bps": { "type": "integer", "format": "int64", "description": "Rate in basis points", "example": 1000 },
                "is_default": { "type": "boolean", "description": "Whether this is the default rate" },
                "is_inclusive": { "type": "boolean", "description": "Whether tax is inclusive of price" },
                "tenant_id": { "type": "string", "description": "Owning tenant (from JWT)" },
                "created_at": { "type": "string", "format": "date-time" }
            }
        },
        "UserResponse": {
            "type": "object",
            "required": ["id", "username", "display_name", "role_id"],
            "properties": {
                "id": { "type": "string", "description": "Unique user ID" },
                "username": { "type": "string", "description": "Login username" },
                "display_name": { "type": "string", "description": "Display name in UI" },
                "role_id": { "type": "string", "description": "Assigned role ID", "example": "role-staff" },
                "tenant_id": { "type": "string", "description": "Owning tenant (from JWT)" },
                "created_at": { "type": "string", "format": "date-time" }
            }
        },
        "SaleDetail": {
            "type": "object",
            "required": ["id", "status", "lines", "total", "created_at"],
            "properties": {
                "id": { "type": "string", "description": "Unique sale ID" },
                "status": { "type": "string", "enum": ["pending", "active", "completed", "voided"], "description": "Current sale status" },
                "lines": { "type": "array", "items": { "$ref": "#/components/schemas/SaleLineItem" }, "description": "Line items with computed line_total" },
                "total": { "$ref": "#/components/schemas/Money" },
                "subtotal": { "$ref": "#/components/schemas/Money" },
                "tax_total": { "$ref": "#/components/schemas/Money" },
                "created_at": { "type": "string", "format": "date-time" },
                "updated_at": { "type": "string", "format": "date-time" }
            }
        },
        "SaleStatusResponse": {
            "type": "object",
            "required": ["id", "status", "updated_at"],
            "properties": {
                "id": { "type": "string", "description": "Sale ID" },
                "status": { "type": "string", "enum": ["pending", "active", "completed", "voided"], "description": "Updated sale status" },
                "updated_at": { "type": "string", "format": "date-time", "description": "ISO-8601 timestamp of the update" }
            }
        },
        "PlanResponse": {
            "type": "object",
            "required": ["tenant_id", "plan"],
            "properties": {
                "tenant_id": { "type": "string", "description": "Tenant/store identifier" },
                "plan": { "type": "string", "enum": ["free", "pro"], "description": "Current sync plan" }
            }
        },
        "TerminalRegistrationRequest": {
            "type": "object",
            "required": ["terminal_id"],
            "properties": {
                "terminal_id": { "type": "string", "description": "Unique terminal identifier", "example": "pos-terminal-1" },
                "label": { "type": "string", "description": "Human-readable label (optional; stored as empty string when omitted)", "example": "Front Counter" },
                "tenant_id": { "type": "string", "description": "Optional tenant/store ID" }
            }
        },
        "TerminalRegistrationResponse": {
            "type": "object",
            "required": ["terminal_id", "device_secret"],
            "properties": {
                "terminal_id": { "type": "string", "description": "Registered terminal ID (also the `client_id` for token minting)" },
                "device_secret": { "type": "string", "description": "Device secret — store securely; shown exactly once, never retrievable. Only its SHA-256 hash is persisted. Re-registering the same terminal_id ROTATES this secret (old credentials stop working immediately)." }
            }
        },
        "SmtpConfig": {
            "type": "object",
            "required": ["host", "port", "from", "use_tls"],
            "properties": {
                "host": { "type": "string", "description": "SMTP server hostname" },
                "port": { "type": "integer", "description": "SMTP port (25, 465, 587, …)", "example": 587 },
                "username": { "type": ["string", "null"], "description": "Optional authenticated-relay username" },
                "password": { "type": ["string", "null"], "description": "Relay password — encrypted at rest server-side; returned DECRYPTED by GET (admin round-trip, API-2 tradeoff)" },
                "from": { "type": "string", "description": "From-address for outgoing emails" },
                "use_tls": { "type": "boolean", "description": "STARTTLS (true) or plaintext (false); port 465 uses implicit TLS" }
            }
        },
        "ReportScheduleConfig": {
            "type": "object",
            "required": ["enabled", "cadence", "report_types", "recipients", "send_at_time", "timezone", "lookback_days"],
            "properties": {
                "enabled": { "type": "boolean", "description": "Whether scheduled delivery is on" },
                "cadence": { "type": "string", "description": "\"daily\", \"weekly\", \"monthly\", or a cron expression", "example": "daily" },
                "report_types": { "type": "array", "items": { "type": "string" }, "description": "Report types to include", "example": ["daily_revenue", "top_products"] },
                "recipients": { "type": "array", "items": { "type": "string" }, "description": "Recipient email addresses" },
                "send_at_time": { "type": "string", "description": "Time of day to send", "example": "08:00" },
                "timezone": { "type": "string", "description": "IANA timezone for scheduling", "example": "Asia/Jakarta" },
                "lookback_days": { "type": "integer", "description": "Date-range window in days", "example": 7 }
            }
        },
        "SettingsView": {
            "type": "object",
            "required": ["tenant"],
            "description": "Effective per-tenant settings (scoped key first, bare-key fallback). Returned by GET and after a successful PUT.",
            "properties": {
                "tenant": { "type": "string", "description": "Tenant these settings belong to" },
                "store_name": { "type": ["string", "null"], "description": "Effective store display name" },
                "smtp_config": { "type": ["object", "null"], "description": "Effective SMTP config (password decrypted), or null", "additionalProperties": true },
                "report_schedule": { "type": ["object", "null"], "description": "Effective report schedule, or null", "additionalProperties": true },
                "last_report_sent_at": { "type": ["string", "null"], "description": "Last-sent dedup timestamp, or null" }
            }
        },
        "PutSettingsRequest": {
            "type": "object",
            "description": "Field-level upsert: an ABSENT field is left untouched, an explicit `null` deletes the tenant's scoped override (bare key applies again), a value writes the scoped key.",
            "properties": {
                "tenant": { "type": "string", "default": "default", "description": "Tenant to write; `[a-zA-Z0-9_-]`, max 64 chars" },
                "store_name": { "type": ["string", "null"], "description": "Store display name override (null = delete)" },
                "smtp_config": { "type": ["object", "null"], "description": "SMTP config override validated against SmtpConfig (null = delete); password encrypted at rest on write", "additionalProperties": true },
                "report_schedule": { "type": ["object", "null"], "description": "Report schedule override validated against ReportScheduleConfig (null = delete)", "additionalProperties": true }
            }
        }
    })
}

/// Reusable query parameters for the forward-declared pagination/search
/// surface (`limit`/`offset`/`sort`/`order`/`q`), referenced from list
/// operations as `#/components/parameters/Pagination*`.
///
/// These live under `components/parameters` because each entry is a
/// Parameter Object, not a Schema Object — the previous nesting under
/// `schemas` (moved verbatim from the cloud builder) was not
/// OpenAPI-conformant even though JSON-Pointer `$ref`s still resolve.
pub(super) fn build_base_parameters() -> Value {
    json!({
        "PaginationLimit": {
            "name": "limit",
            "in": "query",
            "required": false,
            "schema": { "type": "integer", "format": "int64", "default": 50, "maximum": 200 },
            "description": "Maximum items per page (default 50, max 200)"
        },
        "PaginationOffset": {
            "name": "offset",
            "in": "query",
            "required": false,
            "schema": { "type": "integer", "format": "int64", "default": 0 },
            "description": "Zero-based page offset"
        },
        "PaginationSort": {
            "name": "sort",
            "in": "query",
            "required": false,
            "schema": { "type": "string" },
            "description": "Field to sort by (endpoint-specific)"
        },
        "PaginationOrder": {
            "name": "order",
            "in": "query",
            "required": false,
            "schema": { "type": "string", "enum": ["asc", "desc"], "default": "asc" },
            "description": "Sort order"
        },
        "PaginationQ": {
            "name": "q",
            "in": "query",
            "required": false,
            "schema": { "type": "string" },
            "description": "Free-text search across name/SKU/barcode fields"
        }
    })
}
