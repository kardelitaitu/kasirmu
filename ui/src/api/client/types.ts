//! Shared types for the kasir.mu cloud server API client.
//!
//! All types are derived from the OpenAPI 3.1 specification served at
//! `GET /api/openapi.json`. They are hand-maintained here to provide
//! full TypeScript type safety for SDK consumers.

// ── Primitives ────────────────────────────────────────────────────

/** Monetary amount in minor units (e.g., 199 = $1.99). */
export interface Money {
  minor_units: number; // i64
  currency: string; // ISO 4217
}

// ── Error ─────────────────────────────────────────────────────────

export interface ApiErrorResponse {
  error: string;
}

// ── Health ────────────────────────────────────────────────────────

export interface HealthResponse {
  status: string;
  version: string;
  db: string;
  uptime_seconds: number;
  db_connected: boolean;
  db_latency_us: number;
  sync_queue_depth: number;
  last_sync_at: string | null;
}

// ── Auth / Tokens ─────────────────────────────────────────────────

export interface CreateTokenRequest {
  label: string;
  /**
   * Expiry in hours. The server defaults to 24 and CLAMPS to 8760 (365
   * days), so an over-long request is shortened rather than honoured.
   */
  expiry_hours?: number;
  /** Admin-key path only — the client-credentials path takes the tenant from
   * the terminal's registration, never from the body. */
  tenant_id?: string;
  /** Registered terminal ID. Paired with `client_secret`, no admin key needed. */
  client_id?: string;
  /** Device secret, verified against the stored SHA-256 hash. */
  client_secret?: string;
  /** Read-tier preset. Admin-key path only: a terminal binding always gets
   * `terminal` server-side and cannot self-elevate through this field. */
  read_preset?: 'terminal' | 'dashboard' | 'audit';
  /** Explicit permission names. Overrides `read_preset` when both are present. */
  read_permissions?: string[];
}

/** The token details inside the `CreateTokenResponse` envelope. */
export interface TokenResponse {
  token: string;
  expires_at: string;
  /** Token identifier — the same `jti` carried in the claims. */
  token_id: string;
}

/** `POST /api/v1/tokens` response body: the details are NESTED under `token`. */
export interface CreateTokenResponse {
  token: TokenResponse;
}

// ── Products ──────────────────────────────────────────────────────

export interface CreateProductRequest {
  sku: string;
  name: string;
  price: Money;
  category_id?: string;
  barcode?: string;
  initial_stock?: number;
}

export interface ProductDetail {
  id: string;
  sku: string;
  name: string;
  price: Money;
  category_id: string | null;
  category_name: string | null;
  barcode: string | null;
  stock_qty: number | null;
  created_at: string;
  updated_at: string;
  /** Slot-1 primary image content hash, or null when no image is set. */
  image_hash: string | null;
  /** Content-addressed image assignments across slots 1..5. */
  images: ProductImage[];
}

export interface ProductImage {
  /** 1 = primary, 2..5 = alternatives. */
  slot: number;
  /** 16-hex content hash. */
  hash: string;
  /** Display order of alternatives (0-based). */
  position: number;
}

export interface PatchStockRequest {
  /** Positive to restock, negative to sell. */
  delta: number;
}

export interface PatchStockResponse {
  sku: string;
  previous_qty: number;
  new_qty: number;
}

// ── Categories ────────────────────────────────────────────────────

export interface CategoryDto {
  id: string;
  name: string;
  colour: string;
  /** Display icon name. Required — `store.list_categories` selects it. */
  icon: string;
}

// ── Tax Rates ─────────────────────────────────────────────────────

export interface CreateTaxRateRequest {
  name: string;
  /** Rate in basis points (1000 = 10%). */
  rate_bps: number;
  is_default: boolean;
  is_inclusive: boolean;
}

// ── Users ─────────────────────────────────────────────────────────

export interface CreateUserRequest {
  username: string;
  pin_hash: string;
  display_name: string;
  role_id: string;
}

// ── Sales ─────────────────────────────────────────────────────────

export interface SaleLineItem {
  sku: string;
  qty: number;
  unit_price: Money;
}

export interface CreateSaleRequest {
  /** At least one line item required. */
  lines: SaleLineItem[];
}

export type SaleStatus = 'pending' | 'active' | 'completed' | 'voided';

export interface UpdateSaleStatusRequest {
  status: SaleStatus;
}

// ── Sync ──────────────────────────────────────────────────────────

export interface SyncStatusResponse {
  /** Server health, e.g. `"ok"`. */
  status: string;
  /** Server package version. */
  version: string;
  /**
   * Queue items with status `pending` for this tenant, or **-1 when the count
   * could not be read**. Treat -1 as unknown, never as an empty queue: this is
   * the signal a terminal polls to decide whether its backlog is draining, so
   * reading a failure as 0 stops the client retrying while the work is still
   * queued. Same third state as `HealthResponse.sync_queue_depth`.
   */
  pending_count: number;
  /** Recommended client poll interval in seconds (tiered heartbeat). */
  heartbeat_interval_secs: number;
}

export interface SyncPullRequest {
  /** ISO-8601 timestamp to filter items from. null = all items. */
  since: string | null;
}

/** Single offline queue item (the shape is server-validated, not typed). */
export type SyncQueueItem = Record<string, unknown>;

// ── Webhooks ──────────────────────────────────────────────────────

/** Raw Stripe webhook event (server-verified via HMAC-SHA256). */
export type StripeWebhookEvent = Record<string, unknown>;

/** Raw Square webhook event (server-verified via HMAC-SHA256). */
export type SquareWebhookEvent = Record<string, unknown>;
