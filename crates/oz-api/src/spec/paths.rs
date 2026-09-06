//! Base path items of the shared OpenAPI document — the
//! `x-oz-scope: "both"` surface served by both the cloud server and
//! the desktop local API. Owned by the `spec` module (see `mod.rs`).

use serde_json::{Value, json};

// ── Base paths (the `x-oz-scope: "both"` surface) ──────────────

pub(super) fn build_base_paths() -> Value {
    json!({
        "/api/v1/health": {
            "get": {
                "tags": ["Health"],
                "summary": "API health check",
                "description": "Lightweight health check returning status and version. Public — no authentication required. Simpler than /health (no DB ping).",
                "operationId": "apiHealthCheck",
                "responses": {
                    "200": { "description": "Server is healthy", "content": { "application/json": { "schema": { "type": "object", "required": ["status", "version"], "properties": { "status": { "type": "string", "example": "ok" },                 "version": { "type": "string", "example": env!("CARGO_PKG_VERSION") } } } } } }
                }
            }
        },

        // ── Auth (Tokens) ───────────────────────────────────────────
        "/api/v1/tokens": {
            "post": {
                "tags": ["Auth"],
                "summary": "Create a new API token",
                "description": "Generates a signed JWT (HS256, default expiry 24 h, no revocation list — keep `expiry_hours` short). Two mint paths: (1) **admin-key path** — requires the `X-Admin-Key` header when the server has an admin key configured (open in dev mode); optionally narrows reads via `read_preset`/`read_permissions`. (2) **terminal client-credentials path** — `client_id` + `client_secret` from a registered terminal (ADR sync-auth-hardening P3); no admin key, tenant taken from the registration, reads bound to the `terminal` preset server-side (spec 0047).",
                "operationId": "createToken",
                "requestBody": {
                    "required": true,
                    "content": { "application/json": { "schema": { "$ref": "#/components/schemas/CreateTokenRequest" }, "example": { "label": "kitchen-display-1", "expiry_hours": 24, "tenant_id": "store-nyc" } } }
                },
                "responses": {
                    "200": { "description": "Token created successfully", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/CreateTokenResponse" }, "example": { "token": { "token": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJraXRjaGVuLWRpc3BsYXktMSIsImV4cCI6MTc1MDAwMDAwMH0.abc123", "expires_at": "2026-08-13T00:00:00Z", "token_id": "550e8400-e29b-41d4-a716-446655440000" } } } } },
                    "400": { "description": "Invalid JSON body", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "401": { "description": "Admin key configured but missing/mismatched (`invalid_admin_key`), or terminal client credentials rejected (`invalid_credentials`)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "415": { "description": "Unsupported content type", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "422": { "description": "Missing required field (label), or unknown `read_preset` (`unknown_preset`) / `read_permissions` key (`unknown_permission`)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "500": { "description": "JWT encoding failed", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },

        // ── Terminals ──────────────────────────────────────────────
        "/api/v1/terminals": {
            "post": {
                "tags": ["Terminals"],
                "summary": "Register a new terminal",
                "description": "Registers a terminal for client-credential token minting (ADR sync-auth-hardening P3). Returns a `device_secret` that must be stored securely — it is shown exactly once (only its SHA-256 hash is persisted). Re-registering an existing `terminal_id` ROTATES the secret (upsert; old credentials stop working immediately — there is no 409). Gated by the server's admin key (X-Admin-Key header); open in dev mode.",
                "operationId": "registerTerminal",
                "requestBody": {
                    "required": true,
                    "content": { "application/json": { "schema": { "$ref": "#/components/schemas/TerminalRegistrationRequest" } } }
                },
                "responses": {
                    "200": { "description": "Terminal registered (or re-registered — secret rotated)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/TerminalRegistrationResponse" } } } },
                    "400": { "description": "Blank terminal_id", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "401": { "description": "Admin key configured but missing/mismatched (`invalid_admin_key`)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "500": { "description": "Registration persistence failed", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },

        // ── Products ────────────────────────────────────────────────
        "/api/v1/products": {
            "get": {
                "tags": ["Products"],
                "summary": "List all products",
                "description": "Returns all products ordered by name, including category name and stock quantity, wrapped in a `ListProductsResponse` envelope (`products` + `missing_hashes`). Requires JWT auth. The pagination query parameters are reserved for a future release and currently ignored.",
                "operationId": "listProducts",
                "security": [{ "bearerAuth": [] }],
                "parameters": [
                    { "$ref": "#/components/parameters/PaginationLimit" },
                    { "$ref": "#/components/parameters/PaginationOffset" },
                    { "$ref": "#/components/parameters/PaginationSort" },
                    { "$ref": "#/components/parameters/PaginationOrder" },
                    { "$ref": "#/components/parameters/PaginationQ" }
                ],
                "responses": {
                    "200": { "description": "Product list envelope (may be empty)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ListProductsResponse" } } } },
                    "401": { "description": "Missing or invalid JWT", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "403": { "description": "Token lacks the `products:read` read-tier permission", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" }, "example": { "error": "insufficient_scope" } } } }
                }
            },
            "post": {
                "tags": ["Products"],
                "summary": "Create a new product",
                "description": "Creates a product with optional category, barcode, and initial stock. SKU must be unique. Tenant ID is stamped from JWT claims. **Operator-tier (D1):** requires the `X-Admin-Key` header when the server has an admin key configured, and rejects terminal-scoped tokens.",
                "operationId": "createProduct",
                "security": [{ "bearerAuth": [] }],
                "requestBody": {
                    "required": true,
                    "content": { "application/json": { "schema": { "$ref": "#/components/schemas/CreateProductRequest" } } }
                },
                "responses": {
                    "201": { "description": "Product created", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ProductDetail" } } } },
                    "400": { "description": "Validation error (empty SKU, empty name, negative price)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "401": { "description": "Missing or invalid JWT, or missing/invalid `X-Admin-Key` when configured", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "403": { "description": "Terminal-scoped token cannot write master data", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" }, "example": { "error": "insufficient_scope" } } } },
                    "409": { "description": "SKU already exists", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "500": { "description": "Internal server error", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },
        "/api/v1/products/{sku}": {
            "get": {
                "tags": ["Products"],
                "summary": "Get product by SKU",
                "description": "Returns full product detail including stock quantity. Returns JSON null when the SKU is not found (status 200).",
                "operationId": "getProduct",
                "security": [{ "bearerAuth": [] }],
                "parameters": [
                    { "name": "sku", "in": "path", "required": true, "schema": { "type": "string" }, "description": "Product SKU to look up" }
                ],
                "responses": {
                    "200": { "description": "Product detail, or null if not found", "content": { "application/json": { "schema": { "oneOf": [{ "$ref": "#/components/schemas/ProductDetail" }, { "type": "null" }] } } } },
                    "401": { "description": "Missing or invalid JWT", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "403": { "description": "Token lacks the `products:read` read-tier permission", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" }, "example": { "error": "insufficient_scope" } } } }
                }
            }
        },
        "/api/v1/products/{sku}/stock": {
            "patch": {
                "tags": ["Products"],
                "summary": "Adjust stock quantity",
                "description": "Positive delta restocks, negative delta sells. The Store enforces non-negative stock with an atomic checked operation. **Operator-tier (D1):** requires the `X-Admin-Key` header when the server has an admin key configured, and rejects terminal-scoped tokens.",
                "operationId": "patchStock",
                "security": [{ "bearerAuth": [] }],
                "parameters": [
                    { "name": "sku", "in": "path", "required": true, "schema": { "type": "string" }, "description": "Product SKU to adjust" }
                ],
                "requestBody": {
                    "required": true,
                    "content": { "application/json": { "schema": { "$ref": "#/components/schemas/PatchStockRequest" } } }
                },
                "responses": {
                    "200": { "description": "Stock adjusted successfully", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/PatchStockResponse" } } } },
                    "401": { "description": "Missing or invalid JWT, or missing/invalid `X-Admin-Key` when configured", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "403": { "description": "Terminal-scoped token cannot write master data", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" }, "example": { "error": "insufficient_scope" } } } },
                    "404": { "description": "Product not found", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "422": { "description": "Adjustment would cause negative stock", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },

        // ── Images (product/menu-item content store — spec 0046b) ──
        "/api/v1/images": {
            "put": {
                "tags": ["Images"],
                "summary": "Upload a single product image",
                "description": "Body is the raw WebP bytes (max 32 KB). The server re-verifies magic bytes + size and recomputes sha-256 before storing atomically on the volume. Returns the 16-hex content hash — the filename, ETag, and cache key in one.",
                "operationId": "putImage",
                "security": [{ "bearerAuth": [] }],
                "parameters": [
                    { "name": "hash", "in": "query", "required": false, "schema": { "type": "string" }, "description": "Optional client-computed hash; if present it must match the server's (409 otherwise)." }
                ],
                "requestBody": {
                    "required": true,
                    "content": { "application/octet-stream": { "schema": { "type": "string", "format": "binary" } } }
                },
                "responses": {
                    "201": { "description": "Image stored (or already present as a content-addressed duplicate)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/PutImageResponse" } } } },
                    "400": { "description": "Not a valid WebP or exceeds 32 KB", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "401": { "description": "Missing or invalid JWT", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "409": { "description": "Client-supplied hash does not match the computed hash", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            },
            "post": {
                "tags": ["Images"],
                "summary": "Upload a batch of product images",
                "description": "Body is length-prefixed binary frames (big-endian u32 length + bytes) for up to 16 images / 512 KB. The server re-verifies each file and answers per-hash `stored|duplicate|rejected` in the same order.",
                "operationId": "putImageBatch",
                "security": [{ "bearerAuth": [] }],
                "requestBody": {
                    "required": true,
                    "content": { "application/octet-stream": { "schema": { "type": "string", "format": "binary" } } }
                },
                "responses": {
                    "201": { "description": "Batch processed (per-hash outcomes)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/BatchPutResponse" } } } },
                    "400": { "description": "Malformed frames or all images rejected", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "401": { "description": "Missing or invalid JWT", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "413": { "description": "Batch exceeds limits (16 images / 512 KB)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },
        "/api/v1/images:pack": {
            "get": {
                "tags": ["Images"],
                "summary": "Cold-start pack of images",
                "description": "Returns up to 64 files / 2 MB as length-prefixed frames for the given comma-separated hashes. Missing or unreferenced hashes are silently skipped. Used by fresh tablet provisioning instead of thousands of per-hash GETs.",
                "operationId": "getImagePack",
                "security": [{ "bearerAuth": [] }],
                "parameters": [
                    { "name": "hashes", "in": "query", "required": true, "schema": { "type": "string" }, "description": "Comma-separated list of content hashes" }
                ],
                "responses": {
                    "200": { "description": "Length-prefixed image frames (may be empty)", "content": { "application/octet-stream": { "schema": { "type": "string", "format": "binary" } } } },
                    "400": { "description": "No valid hashes or more than 64 requested", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "401": { "description": "Missing or invalid JWT", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "403": { "description": "Token lacks the `products:read` read-tier permission", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" }, "example": { "error": "insufficient_scope" } } } }
                }
            }
        },
        "/api/v1/images:missing": {
            "get": {
                "tags": ["Images"],
                "summary": "Server-side missing-hash nudge",
                "description": "Given comma-separated candidate hashes, returns the subset the tenant has no active `image_refs` row for. The desktop push scheduler calls this before a batch upload so it pushes exactly what the cloud lacks first (spec 0046b §3.6).",
                "operationId": "getImageMissing",
                "security": [{ "bearerAuth": [] }],
                "parameters": [
                    { "name": "hashes", "in": "query", "required": true, "schema": { "type": "string" }, "description": "Comma-separated list of candidate content hashes" }
                ],
                "responses": {
                    "200": { "description": "The missing subset", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/MissingHashesResponse" } } } },
                    "400": { "description": "No valid hashes", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "401": { "description": "Missing or invalid JWT", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "403": { "description": "Token lacks the `products:read` read-tier permission", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" }, "example": { "error": "insufficient_scope" } } } }
                }
            }
        },
        "/api/v1/images/{hash16}": {
            "get": {
                "tags": ["Images"],
                "summary": "Fetch an image by content hash",
                "description": "Returns the immutable WebP bytes for a content-addressed hash the tenant references. `Cache-Control: max-age=31536000, immutable` and `ETag: \"<hash>\"` — every cache layer between the tablet and the volume can treat it as a static asset. Unknown or un-hashed files return 404.",
                "operationId": "getImage",
                "security": [{ "bearerAuth": [] }],
                "parameters": [
                    { "name": "hash16", "in": "path", "required": true, "schema": { "type": "string", "minLength": 16, "maxLength": 16 }, "description": "16-hex content hash" }
                ],
                "responses": {
                    "200": { "description": "Immutable WebP bytes", "content": { "image/webp": { "schema": { "type": "string", "format": "binary" } } } },
                    "401": { "description": "Missing or invalid JWT", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "403": { "description": "Token lacks the `products:read` read-tier permission", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" }, "example": { "error": "insufficient_scope" } } } },
                    "404": { "description": "Invalid hash grammar, unknown hash, or tenant has no active reference", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },

        // ── Plans (tenant sync plan — ADR sync-plan-gating) ────────
        "/api/v1/tenants/me/plan": {            "get": {
                "tags": ["Plans"],
                "summary": "Get the caller's sync plan",
                "description": "Returns the tenant's cloud sync plan (free or pro) resolved from the JWT claims — a missing plan row reports free (fail closed). Unlike the sync router this endpoint is not plan-gated, so a free tenant can read its own plan to render the upgrade prompt.",
                "operationId": "getMyPlan",
                "security": [{ "bearerAuth": [] }],
                "responses": {
                    "200": { "description": "Effective plan for the authenticated tenant", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/PlanResponse" } } } },
                    "401": { "description": "Missing or invalid JWT", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "403": { "description": "Token lacks the `plan:read` read-tier permission", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" }, "example": { "error": "insufficient_scope" } } } }
                }
            }
        },
        "/api/v1/tenants/{tenant_id}/plan": {
            "put": {
                "tags": ["Plans"],
                "summary": "Set a tenant's sync plan (admin)",
                "description": "Assigns free or pro to a tenant. Requires the X-Admin-Key header when the server has an admin key configured; open in dev mode.",
                "operationId": "setTenantPlan",
                "parameters": [{ "name": "tenant_id", "in": "path", "required": true, "schema": { "type": "string" } }],
                "requestBody": {
                    "content": { "application/json": { "schema": { "type": "object", "properties": { "plan": { "type": "string", "enum": ["free", "pro"] } }, "required": ["plan"] } } }
                },
                "responses": {
                    "200": { "description": "Plan updated", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/PlanResponse" } } } },
                    "400": { "description": "Unknown plan name", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "401": { "description": "Missing or invalid admin key", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },

        // ── Settings ────────────────────────────────────────────────
        "/api/v1/settings": {
            "get": {
                "tags": ["Settings"],
                "summary": "Read a tenant's effective cloud settings",
                "description": "Returns the tenant's effective settings exactly as the cloud report loop resolves them: scoped key `{base}:{tenant}` first, bare-key fallback. Includes `store_name`, `smtp_config` (password DECRYPTED for lossless admin round-trips — API-2 tradeoff, safe only while the admin-key gate + mandatory production key hold), `report_schedule`, and `last_report_sent_at`. Gated by the server's admin key (X-Admin-Key header); open in dev mode. No JWT.",
                "operationId": "getSettings",
                "parameters": [
                    { "name": "tenant", "in": "query", "required": false, "schema": { "type": "string", "default": "default" }, "description": "Tenant to read; `[a-zA-Z0-9_-]`, max 64 chars" }
                ],
                "responses": {
                    "200": { "description": "Effective settings for the tenant", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/SettingsView" } } } },
                    "400": { "description": "Invalid tenant id charset (`invalid_tenant`)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "401": { "description": "Admin key configured but missing/mismatched (`invalid_admin_key`)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "500": { "description": "Settings read failed (`settings_read_failed`)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            },
            "put": {
                "tags": ["Settings"],
                "summary": "Write a tenant's scoped settings",
                "description": "Field-level upsert of the tenant's scoped keys (`store.name:{tenant}`, `smtp_config:{tenant}`, `report_schedule:{tenant}`). A field that is ABSENT is left untouched; an explicit `null` deletes the scoped override so the bare key applies again. Every provided field is validated and canonicalized BEFORE any write, so a bad request never leaves a half-applied config. SMTP passwords are encrypted at rest on write. Same admin-key gate as GET.",
                "operationId": "putSettings",
                "requestBody": {
                    "required": true,
                    "content": { "application/json": { "schema": { "$ref": "#/components/schemas/PutSettingsRequest" } } }
                },
                "responses": {
                    "200": { "description": "Effective settings after the write", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/SettingsView" } } } },
                    "400": { "description": "Validation failure (`invalid_tenant`, `invalid_store_name`, `invalid_smtp_config`, `invalid_report_schedule`)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "401": { "description": "Admin key configured but missing/mismatched (`invalid_admin_key`)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "500": { "description": "Write or re-read failed (`settings_write_failed` / `settings_read_failed`)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },

        // ── Categories ──────────────────────────────────────────────
        "/api/v1/categories": {
            "get": {
                "tags": ["Categories"],
                "summary": "List all categories",
                "description": "Returns all product categories with ID, name, colour, and timestamps. Requires JWT auth. Returns a flat array today; will adopt `PaginatedResponse` envelope when pagination support lands.",
                "operationId": "listCategories",
                "security": [{ "bearerAuth": [] }],
                "parameters": [
                    { "$ref": "#/components/parameters/PaginationLimit" },
                    { "$ref": "#/components/parameters/PaginationOffset" },
                    { "$ref": "#/components/parameters/PaginationSort" },
                    { "$ref": "#/components/parameters/PaginationOrder" },
                ],
                "responses": {
                    "200": { "description": "List of categories (may be empty)", "content": { "application/json": { "schema": { "type": "array", "items": { "$ref": "#/components/schemas/CategoryDto" } } } } },
                    "401": { "description": "Missing or invalid JWT", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "403": { "description": "Token lacks the `categories:read` read-tier permission", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" }, "example": { "error": "insufficient_scope" } } } }
                }
            }
        },

        // ── Tax Rates ───────────────────────────────────────────────
        "/api/v1/tax-rates": {
            "post": {
                "tags": ["Tax Rates"],
                "summary": "Create a new tax rate",
                "description": "Creates a tax rate with basis-point precision (e.g., 1000 = 10%). Can be set as default and/or tax-inclusive. **Operator-tier (D1):** requires the `X-Admin-Key` header when the server has an admin key configured, and rejects terminal-scoped tokens.",
                "operationId": "createTaxRate",
                "security": [{ "bearerAuth": [] }],
                "requestBody": {
                    "required": true,
                    "content": { "application/json": { "schema": { "$ref": "#/components/schemas/CreateTaxRateRequest" } } }
                },
                "responses": {
                    "201": { "description": "Tax rate created", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/TaxRateResponse" } } } },
                    "401": { "description": "Missing or invalid JWT, or missing/invalid `X-Admin-Key` when configured", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "403": { "description": "Terminal-scoped token cannot write master data", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" }, "example": { "error": "insufficient_scope" } } } }
                }
            }
        },

        // ── Exchange Rates ──────────────────────────────────────────
        "/api/v1/exchange-rates": {
            "get": {
                "tags": ["Exchange Rates"],
                "summary": "List exchange rate history",
                "description": "Full rate history ordered pair-major with newest effective date first within each pair (CUR-04). Rates are global reference data.",
                "operationId": "listExchangeRates",
                "security": [{ "bearerAuth": [] }],
                "responses": {
                    "200": { "description": "Rate history (may be empty)", "content": { "application/json": { "schema": { "type": "array", "items": { "$ref": "#/components/schemas/ExchangeRateResponse" } } } } },
                    "401": { "description": "Missing or invalid JWT", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "403": { "description": "Token lacks the `reference:read` read-tier permission", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" }, "example": { "error": "insufficient_scope" } } } }
                }
            },
            "post": {
                "tags": ["Exchange Rates"],
                "summary": "Create an exchange rate",
                "description": "Creates a rate with 6-decimal fixed-point precision. Rejects non-positive rates, identical pairs, non-ISO codes, and malformed effective dates (CUR-05). Duplicate (pair, date) returns 409. **Operator-tier (D1):** requires the `X-Admin-Key` header when the server has an admin key configured, and rejects terminal-scoped tokens.",
                "operationId": "createExchangeRate",
                "security": [{ "bearerAuth": [] }],
                "requestBody": {
                    "required": true,
                    "content": { "application/json": { "schema": { "$ref": "#/components/schemas/CreateExchangeRateRequest" } } }
                },
                "responses": {
                    "201": { "description": "Rate created", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ExchangeRateResponse" } } } },
                    "400": { "description": "Validation error", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "401": { "description": "Missing or invalid JWT, or missing/invalid `X-Admin-Key` when configured", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "403": { "description": "Terminal-scoped token cannot write master data", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" }, "example": { "error": "insufficient_scope" } } } },
                    "409": { "description": "Rate already exists for this pair and effective date", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },
        "/api/v1/exchange-rates/latest": {
            "get": {
                "tags": ["Exchange Rates"],
                "summary": "List the current rate for every pair",
                "description": "One row per (from_currency, to_currency) pair — the newest effective date (CUR-11 bounded listing).",
                "operationId": "listLatestExchangeRates",
                "security": [{ "bearerAuth": [] }],
                "responses": {
                    "200": { "description": "Current rates (may be empty)", "content": { "application/json": { "schema": { "type": "array", "items": { "$ref": "#/components/schemas/ExchangeRateResponse" } } } } },
                    "401": { "description": "Missing or invalid JWT", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "403": { "description": "Token lacks the `reference:read` read-tier permission", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" }, "example": { "error": "insufficient_scope" } } } }
                }
            }
        },
        "/api/v1/exchange-rates/latest/{from}/{to}": {
            "get": {
                "tags": ["Exchange Rates"],
                "summary": "Get the newest rate for one pair",
                "description": "Path codes are case-insensitive; 404 when the pair has no rates.",
                "operationId": "getLatestExchangeRate",
                "security": [{ "bearerAuth": [] }],
                "parameters": [
                    { "name": "from", "in": "path", "required": true, "schema": { "type": "string" }, "description": "Source currency code" },
                    { "name": "to", "in": "path", "required": true, "schema": { "type": "string" }, "description": "Target currency code" }
                ],
                "responses": {
                    "200": { "description": "Newest rate for the pair", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ExchangeRateResponse" } } } },
                    "400": { "description": "Invalid ISO-4217 code", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "401": { "description": "Missing or invalid JWT", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "403": { "description": "Token lacks the `reference:read` read-tier permission", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" }, "example": { "error": "insufficient_scope" } } } },
                    "404": { "description": "No rate for this pair", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },
        "/api/v1/exchange-rates/{id}": {
            "delete": {
                "tags": ["Exchange Rates"],
                "summary": "Delete an exchange rate",
                "description": "Removes a rate row by id. **Operator-tier (D1):** requires the `X-Admin-Key` header when the server has an admin key configured, and rejects terminal-scoped tokens.",
                "operationId": "deleteExchangeRate",
                "security": [{ "bearerAuth": [] }],
                "parameters": [
                    { "name": "id", "in": "path", "required": true, "schema": { "type": "string" }, "description": "Rate row id" }
                ],
                "responses": {
                    "204": { "description": "Rate deleted" },
                    "401": { "description": "Missing or invalid JWT, or missing/invalid `X-Admin-Key` when configured", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "403": { "description": "Terminal-scoped token cannot write master data", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" }, "example": { "error": "insufficient_scope" } } } },
                    "404": { "description": "Rate not found", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },

        // ── Users ───────────────────────────────────────────────────
        "/api/v1/users": {
            "post": {
                "tags": ["Users"],
                "summary": "Create a new user account",
                "description": "Creates a staff user with a PIN hash and role assignment. Requires seeded roles (role-staff, role-manager, role-owner). Requires an admin-minted token: a token scoped to a registered terminal is rejected with 403, since user management is an admin-tier operation.",
                "operationId": "createUser",
                "security": [{ "bearerAuth": [] }],
                "requestBody": {
                    "required": true,
                    "content": { "application/json": { "schema": { "$ref": "#/components/schemas/CreateUserRequest" } } }
                },
                "responses": {
                    "201": { "description": "User created", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/UserResponse" } } } },
                    "401": { "description": "Missing or invalid JWT", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "403": { "description": "Token is scoped to a registered terminal and may not manage users", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },

        // ── Sales ───────────────────────────────────────────────────
        "/api/v1/sales": {
            "post": {
                "tags": ["Sales"],
                "summary": "Create a new sale",
                "description": "Creates a sale in 'pending' status with the given line items. Each line item specifies SKU, quantity, and unit price. At least one line item is required.",
                "operationId": "createSale",
                "security": [{ "bearerAuth": [] }],
                "requestBody": {
                    "required": true,
                    "content": { "application/json": { "schema": { "$ref": "#/components/schemas/CreateSaleRequest" }, "example": { "lines": [{ "sku": "COFFEE-001", "qty": 2, "unit_price": { "minor_units": 350, "currency": "USD" } }, { "sku": "MUFFIN-001", "qty": 1, "unit_price": { "minor_units": 425, "currency": "USD" } }] } } }
                },
                "responses": {
                    "201": { "description": "Sale created (status: pending)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/SaleDetail" }, "example": { "id": "sale-abc123", "status": "pending", "lines": [{ "sku": "COFFEE-001", "qty": 2, "unit_price": { "minor_units": 350, "currency": "USD" } }], "total": { "minor_units": 1125, "currency": "USD" }, "created_at": "2026-08-12T10:30:00Z" } } } },
                    "401": { "description": "Missing or invalid JWT", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "422": { "description": "Empty lines array", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },
        "/api/v1/sales/{id}": {
            "get": {
                "tags": ["Sales"],
                "summary": "Get sale by ID",
                "description": "Returns full sale detail including line items and computed totals. Returns JSON null when the sale ID is not found (status 200).",
                "operationId": "getSale",
                "security": [{ "bearerAuth": [] }],
                "parameters": [
                    { "name": "id", "in": "path", "required": true, "schema": { "type": "string" }, "description": "Sale ID to retrieve" }
                ],
                "responses": {
                    "200": { "description": "Sale detail, or null if not found", "content": { "application/json": { "schema": { "oneOf": [{ "$ref": "#/components/schemas/SaleDetail" }, { "type": "null" }] } } } },
                    "401": { "description": "Missing or invalid JWT", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "403": { "description": "Token lacks the `sales:view` read-tier permission (PII-flagged route)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" }, "example": { "error": "insufficient_scope" } } } }
                }
            }
        },
        "/api/v1/sales/{id}/status": {
            "patch": {
                "tags": ["Sales"],
                "summary": "Update sale status",
                "description": "Transitions a sale through its lifecycle: pending→active (cart being processed), active→completed (payment received), active→voided (sale cancelled). Invalid transitions (e.g., pending→completed) return 422.",
                "operationId": "updateSaleStatus",
                "security": [{ "bearerAuth": [] }],
                "parameters": [
                    { "name": "id", "in": "path", "required": true, "schema": { "type": "string" }, "description": "Sale ID to update" }
                ],
                "requestBody": {
                    "required": true,
                    "content": { "application/json": { "schema": { "$ref": "#/components/schemas/UpdateSaleStatusRequest" } } }
                },
                "responses": {
                    "200": { "description": "Status updated", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/SaleStatusResponse" } } } },
                    "401": { "description": "Missing or invalid JWT", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "404": { "description": "Sale not found", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "422": { "description": "Invalid status transition", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },

        // ── Memos (cloud-read serving layer, 2026-09-07 ruling) ───
        "/api/v1/memos/sync": {
            "post": {
                "tags": ["Memos"],
                "summary": "Reconcile the tenant's memo state (desktop push)",
                "description": "The desktop pushes its DATABASE's complete non-deleted memo state (memos + memo_locations + memo_recipients) and the server reconciles cloud Postgres with it in one transaction: upsert rows ON CONFLICT (id), replace targeting and recipient rows wholesale, and delete any tenant memo absent from the snapshot (desktop-side retention deletes propagate by omission). Tenant scope rides the JWT claims — never the body; a terminal-scoped token may only sync its own registration's tenant, and an admin-minted token additionally needs the X-Admin-Key header when one is configured. Requires JWT auth.",
                "operationId": "syncMemos",
                "security": [{ "bearerAuth": [] }],
                "requestBody": {
                    "required": true,
                    "content": { "application/json": { "schema": { "$ref": "#/components/schemas/MemoSyncEnvelope" } } }
                },
                "responses": {
                    "200": { "description": "Reconciled", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/MemoSyncResult" } } } },
                    "401": { "description": "Missing/invalid JWT or admin key (`invalid_token` / `invalid_admin_key`)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "403": { "description": "Terminal-scoped token syncing another registration's tenant", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "503": { "description": "No Postgres backend (`pg_unavailable`)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },
        "/api/v1/memos/active": {
            "get": {
                "tags": ["Memos"],
                "summary": "List the memos a terminal should currently display",
                "description": "The terminal's active memos (status 'published', not expired, addressed to the terminal via its recipient rows), Location-stacked above Organization, newest-published first, with the server-issued poll cadence (base interval and the KDS 2× derivative from oz_core::memo — one source of truth). Tenant comes from the JWT claims; when the token is terminal-scoped the query's terminal_id must equal the claim (403 terminal_mismatch otherwise). The wire is snake_case, mirroring the desktop IPC DTO's fields. Requires JWT auth.",
                "operationId": "listActiveMemos",
                "security": [{ "bearerAuth": [] }],
                "parameters": [
                    { "name": "terminal_id", "in": "query", "required": true, "schema": { "type": "string" }, "description": "The asking terminal; must match a terminal-scoped token's claim" }
                ],
                "responses": {
                    "200": { "description": "Active memos + cadence", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/MemoDisplayEnvelope" } } } },
                    "401": { "description": "Missing or invalid JWT", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "403": { "description": "terminal_mismatch — the query names another terminal than the token's claim", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
                    "503": { "description": "No Postgres backend (`pg_unavailable`)", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } }
                }
            }
        },

        // ── Docs ────────────────────────────────────────────────────
        "/api/openapi.json": {
            "get": {
                "tags": ["Docs"],
                "summary": "OpenAPI 3.1 specification",
                "description": "This document. Public — no authentication required.",
                "operationId": "openapiJson",
                "responses": {
                    "200": { "description": "OpenAPI 3.1 document", "content": { "application/json": { "schema": { "type": "object" } } } }
                }
            }
        },
    })
}
