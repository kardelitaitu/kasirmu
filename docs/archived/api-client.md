# kasir.mu API Client SDK

TypeScript SDK for the kasir.mu cloud server REST API. Provides fully typed
access to all 20+ endpoints with Bearer token authentication.

## Quick Start

```ts
import { OZPosClient } from '@/api/client'; // re-exported via client/index.ts from client/oz-pos-client.ts

// Create a client pointing at your cloud server
const client = new OZPosClient({ baseUrl: 'http://localhost:3099' });

// (Optional) Set a Bearer token for authenticated endpoints
client.setToken('eyJhbGciOi...');

// Public endpoints — no token needed
const health = await client.health.check();
console.log(health.status); // "ok"

// Token management — when the server is configured with an OZ_ADMIN_KEY
// (production), pass it via X-Admin-Key so the server accepts the mint.
const token = await client.auth.createToken({
  label: 'kitchen-display-1',
  expiry_hours: 24,
  tenant_id: 'store-001', // optional — multi-tenant cloud isolation
});

// Products
const allProducts = await client.products.list();
await client.products.create({
  sku: 'COFFEE-001',
  name: 'Espresso',
  price: { minor_units: 250, currency: 'USD' },
  initial_stock: 100,
});
const product = await client.products.get('COFFEE-001');
await client.products.adjustStock('COFFEE-001', { delta: -1 });

// Categories
const categories = await client.categories.list();

// Tax Rates
await client.tax.create({
  name: 'VAT 10%',
  rate_bps: 1000,
  is_default: true,
  is_inclusive: false,
});

// Users
await client.users.create({
  username: 'cashier1',
  pin_hash: 'hashed-pin',
  display_name: 'Cashier 1',
  role_id: 'role-cashier',
});

// Sales
await client.sales.create({
  lines: [{ sku: 'COFFEE-001', qty: 2, unit_price: { minor_units: 250, currency: 'USD' } }],
});
const sale = await client.sales.get('sale-id');
await client.sales.updateStatus('sale-id', { status: 'completed' });

// Sync — on a server with OZ_ENFORCE_PLANS=1, a tenant on the `free` plan
// gets HTTP 403 {"error":"plan_required"}; the SDK throws an ApiError with
// status 403. Queued items stay pending and sync automatically after upgrade.
const syncStatus = await client.sync.status();
await client.sync.push([{ type: 'product', sku: 'COFFEE-001', name: 'Espresso' }]);
const pendingItems = await client.sync.pull({ since: null });

// Webhooks — Stripe: payment events finalize sales; subscription lifecycle
// events (customer.subscription.*, checkout.session.completed, invoice.paid)
// upgrade/downgrade the tenant's sync plan. Square: payment events.
await client.webhooks.stripe({ type: 'payment_intent.succeeded', data: {} });
await client.webhooks.stripe({ type: 'customer.subscription.created', data: {} });
await client.webhooks.square({ type: 'payment.updated', data: {} });
```

## API Reference

### Client Configuration

```ts
interface ClientConfig {
  baseUrl: string;              // Cloud server URL (e.g., http://localhost:3099)
  fetchFn?: typeof fetch;       // Custom fetch implementation (defaults to globalThis.fetch)
}
```

### Health

| Method | Endpoint | Auth | Returns |
|--------|----------|------|---------|
| `client.health.check()` | `GET /health` | No | `HealthResponse` |
| `client.health.checkApi()` | `GET /api/health` | No | `HealthResponse` |
| `client.health.metrics()` | `GET /metrics` | No | `string` (Prometheus text) |

### Auth

| Method | Endpoint | Auth | Returns |
|--------|----------|------|---------|
| `client.auth.createToken(req)` | `POST /api/v1/tokens` | None (dev) / `X-Admin-Key` (when `OZ_ADMIN_KEY` is set) | `TokenResponse` |

### Products

| Method | Endpoint | Auth | Returns |
|--------|----------|------|---------|
| `client.products.list()` | `GET /api/v1/products` | Bearer | `ProductDetail[]` |
| `client.products.create(req)` | `POST /api/v1/products` | Bearer | `ProductDetail` |
| `client.products.get(sku)` | `GET /api/v1/products/{sku}` | Bearer | `ProductDetail \| null` |
| `client.products.adjustStock(sku, req)` | `PATCH /api/v1/products/{sku}/stock` | Bearer | `PatchStockResponse` |

### Categories

| Method | Endpoint | Auth | Returns |
|--------|----------|------|---------|
| `client.categories.list()` | `GET /api/v1/categories` | Bearer | `CategoryDto[]` |

### Tax Rates

| Method | Endpoint | Auth | Returns |
|--------|----------|------|---------|
| `client.tax.create(req)` | `POST /api/v1/tax-rates` | Bearer | `void` |

### Users

| Method | Endpoint | Auth | Returns |
|--------|----------|------|---------|
| `client.users.create(req)` | `POST /api/v1/users` | Bearer | `void` |

### Sales

| Method | Endpoint | Auth | Returns |
|--------|----------|------|---------|
| `client.sales.create(req)` | `POST /api/v1/sales` | Bearer | `void` |
| `client.sales.get(id)` | `GET /api/v1/sales/{id}` | Bearer | `Record \| null` |
| `client.sales.updateStatus(id, req)` | `PATCH /api/v1/sales/{id}` | Bearer | `void` |

### Sync

| Method | Endpoint | Auth | Returns |
|--------|----------|------|---------|
| `client.sync.status()` | `GET /api/sync/status` | Bearer | `SyncStatusResponse` |
| `client.sync.push(items)` | `POST /api/sync/push` | Bearer | `void` (403 `plan_required` on `free` tenant when enforcement is on) |
| `client.sync.pull(req?)` | `POST /api/sync/pull` | Bearer | `SyncQueueItem[]` (403 `plan_required` likewise) |

### Plans (admin — raw HTTP, not yet wrapped in the SDK)

| Method | Endpoint | Auth | Returns |
|--------|----------|------|---------|
| `PUT` | `/api/v1/tenants/{tenant_id}/plan` | `X-Admin-Key` (when `OZ_ADMIN_KEY` is set; open in dev) | `{ tenant_id, plan }` |

Sets the tenant's cloud sync plan (`free` \| `pro`). Used by operators and
billing integrations; a paid subscription also upgrades the plan
automatically via the Stripe webhook. The TS SDK does not wrap this
endpoint yet — call it directly:

```ts
await fetch(`${baseUrl}/api/v1/tenants/store-001/plan`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
  body: JSON.stringify({ plan: 'pro' }),
});
```

### Webhooks

| Method | Endpoint | Auth | Returns |
|--------|----------|------|---------|
| `client.webhooks.stripe(event)` | `POST /api/webhooks/stripe` | No (HMAC-signed) | `void` |
| `client.webhooks.square(event)` | `POST /api/webhooks/square` | No (HMAC-signed) | `void` |

Stripe subscription lifecycle events (`customer.subscription.created` /
`.updated` / `.deleted`, `checkout.session.completed`, `invoice.paid`)
update the tenant's sync plan; payment events queue a `finalize_sale`
action. Unresolvable subscription events are acknowledged with 200
`ignored` so Stripe stops retrying.

## Error Handling

All API errors are thrown as `ApiError` instances:

```ts
import { ApiError } from '@/api/client';

try {
  await client.products.create({ ... });
} catch (err) {
  if (err instanceof ApiError) {
    console.error(`HTTP ${err.status}: ${err.body}`);
  }
}
```

## Testing

The SDK is designed for easy testing via MSW or a custom `fetchFn`:

```ts
// Option 1: Custom fetch function
const client = new OZPosClient({
  baseUrl: 'http://test',
  fetchFn: async (url, init) => new Response(JSON.stringify({ status: 'ok' })),
});

// Option 2: MSW (recommended for integration tests)
import { http, HttpResponse } from 'msw';
// ... configure MSW handlers to intercept requests
```

> last audited 09-08-26 by buffy
> audit: Phase 1 Core Architecture & API Docs Audit

> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers, all file references valid

