<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · REPAIRED — the class and module names are load-bearing here in a way they are not in an audit snapshot, because this document is a USAGE guide: every code block in it is something a reader copies. `KasirMuClient` does not exist anywhere in the tree; the SDK class is `KasirMuClient`, defined at `ui/src/api/client/kasirmu-client.ts:56` and re-exported from the barrel `ui/src/api/client/index.ts`, whose own header comment shows the identical usage pattern this document teaches (`new KasirMuClient({ baseUrl: ... })`, then `client.health.check()`, `client.products.list()`). The module was renamed alongside it — `oz-pos-client.ts` is now `kasirmu-client.ts` — and the file was renamed too, so "re-exported via client/index.ts from client/kasirmu-client.ts" now resolves to nothing. Every occurrence of both names was repaired. This is the same judgment applied to the modal checklist earlier in this campaign: a stale path in an ARCHIVED audit snapshot is evidence and stays, but a stale identifier in a how-to document breaks the next person who runs it. · EVERYTHING ELSE VERIFIES. `ApiError` is real and in the right place (`ui/src/api/client/client.ts:26`, extended from `Error`, and exercised by `ui/src/__tests__/api-client.test.ts`), so the Error Handling section is correct as written. The sub-client classes the tables document all exist: `AuthClient`, `CategoriesClient`, `HealthClient`, plus `HttpClient` as the transport. The endpoint tables match the server: `/health`, `/api/health`, `/metrics`, `POST /api/v1/tokens`, the product/category/tax/user/sales routes, and `/api/sync/{status,push,pull}` — the sync paths with no `v1` segment, consistent with what the rate-limiting audit found when it corrected the same assumption. · WORTH CREDITING: the document was already currency-aware before this pass. Its Quick Start comments note that a `free`-plan tenant on a server with `OZ_ENFORCE_PLANS=1` gets HTTP 403 `{"error":"plan_required"}` and that queued items stay `pending` and sync after upgrade — which is precisely the plan-gating contract ADR sync-plan-gating defines, including the terminal-error semantics (no retry spin, no quarantine). The Plans section likewise documents `PUT /api/v1/tenants/{tenant_id}/plan` as deliberately UNWRAPPED in the SDK, with a raw `fetch` example and the reason. That is an SDK doc telling the truth about its own gaps, which is rarer than it should be. · The `OZ_ADMIN_KEY` and `OZ_ENFORCE_PLANS` names it uses are the ones the code actually reads — see the AGENTS.md env-var finding recorded elsewhere in this campaign, where the code is right and AGENTS.md is the outlier. · The old `> status: ACCURATE (0 findings) · … all file references valid` footer is replaced, since the class name it implicitly vouched for no longer existed. -->
# kasir.mu API Client SDK

TypeScript SDK for the kasir.mu cloud server REST API. Provides fully typed
access to all 20+ endpoints with Bearer token authentication.

## Quick Start

```ts
import { KasirMuClient } from '@/api/client'; // re-exported via client/index.ts from client/kasirmu-client.ts

// Create a client pointing at your cloud server
const client = new KasirMuClient({ baseUrl: 'http://localhost:3099' });

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
const client = new KasirMuClient({
  baseUrl: 'http://test',
  fetchFn: async (url, init) => new Response(JSON.stringify({ status: 'ok' })),
});

// Option 2: MSW (recommended for integration tests)
import { http, HttpResponse } from 'msw';
// ... configure MSW handlers to intercept requests
```

> last audited 29-09-26 by docs-auditor

