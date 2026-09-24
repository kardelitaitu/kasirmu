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
  expiry_hours?: number;
  tenant_id?: string;
}

export interface TokenResponse {
  token: string;
  expires_at: string;
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
  created_at: string;
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

export type SaleStatus = 'active' | 'completed' | 'voided';

export interface UpdateSaleStatusRequest {
  status: SaleStatus;
}

// ── Sync ──────────────────────────────────────────────────────────

export interface SyncStatusResponse {
  pending_count: number;
  conflict_count: number;
  total_items: number;
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
