//! Integration tests for the kasir.mu API client SDK.
//!
//! Uses MSW (Mock Service Worker) to intercept HTTP requests and
//! verify typed request/response contracts for all 20+ endpoints.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { KasirMuClient, ApiError } from '@/api/client';

const BASE_URL = 'http://test-server';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function createClient(): KasirMuClient {
  return new KasirMuClient({ baseUrl: BASE_URL });
}

// ── Health ─────────────────────────────────────────────────────────

describe('HealthClient', () => {
  it('check() returns health response', async () => {
    server.use(
      http.get(`${BASE_URL}/health`, () =>
        HttpResponse.json({
          status: 'ok',
          version: '0.0.19',
          db: 'sqlite',
          uptime_seconds: 3600,
          db_connected: true,
          db_latency_us: 150,
          sync_queue_depth: 12,
          last_sync_at: '2026-07-22T10:00:00Z',
        }),
      ),
    );

    const client = createClient();
    const result = await client.health.check();

    expect(result.status).toBe('ok');
    expect(result.version).toBe('0.0.19');
    expect(result.db_connected).toBe(true);
    expect(result.sync_queue_depth).toBe(12);
  });

  it('metrics() returns raw text', async () => {
    server.use(
      http.get(`${BASE_URL}/metrics`, () =>
        HttpResponse.text('# HELP sync_count Total syncs\nsync_count 42\n'),
      ),
    );

    const client = createClient();
    const result = await client.health.metrics();

    // Should be raw text, not JSON-parsed
    expect(result).toContain('sync_count');
    expect(result).toContain('# HELP');
  });
});

// ── Auth ──────────────────────────────────────────────────────────

describe('AuthClient', () => {
  it('createToken() returns token', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v1/tokens`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body['label']).toBe('test-token');

        return HttpResponse.json({
          token: 'eyJhbGciOi...',
          expires_at: '2026-07-23T10:00:00Z',
        });
      }),
    );

    const client = createClient();
    const result = await client.auth.createToken({
      label: 'test-token',
      expiry_hours: 24,
    });

    expect(result.token).toBeTruthy();
    expect(result.expires_at).toBeTruthy();
  });
});

// ── Products ──────────────────────────────────────────────────────

describe('ProductsClient', () => {
  it('list() returns products array', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/products`, () =>
        HttpResponse.json([
          {
            id: 'p1',
            sku: 'SKU-001',
            name: 'Espresso',
            price: { minor_units: 250, currency: 'USD' },
            category_id: null,
            category_name: null,
            barcode: null,
            stock_qty: 100,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-07-22T00:00:00Z',
          },
        ]),
      ),
    );

    const client = createClient();
    const products = await client.products.list();

    expect(products).toHaveLength(1);
    expect(products[0]!.sku).toBe('SKU-001');
    expect(products[0]!.name).toBe('Espresso');
  });

  it('get() returns product by SKU', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/products/SKU-001`, () =>
        HttpResponse.json({
          id: 'p1',
          sku: 'SKU-001',
          name: 'Espresso',
          price: { minor_units: 250, currency: 'USD' },
          category_id: null,
          category_name: null,
          barcode: null,
          stock_qty: 100,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-07-22T00:00:00Z',
        }),
      ),
    );

    const client = createClient();
    const product = await client.products.get('SKU-001');

    expect(product).not.toBeNull();
    expect(product!.sku).toBe('SKU-001');
  });

  it('get() returns null for unknown SKU', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/products/UNKNOWN`, () =>
        HttpResponse.json(null),
      ),
    );

    const client = createClient();
    const product = await client.products.get('UNKNOWN');

    expect(product).toBeNull();
  });

  it('create() sends correct body and returns product', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v1/products`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body['sku']).toBe('NEW-001');
        expect(body['name']).toBe('New Item');
        const price = body['price'] as Record<string, unknown>;
        expect(price['minor_units']).toBe(199);

        return HttpResponse.json(
          {
            id: 'p-new',
            sku: 'NEW-001',
            name: 'New Item',
            price: { minor_units: 199, currency: 'USD' },
            category_id: null,
            category_name: null,
            barcode: null,
            stock_qty: 100,
            created_at: '2026-07-22T00:00:00Z',
            updated_at: '2026-07-22T00:00:00Z',
          },
          { status: 201 },
        );
      }),
    );

    const client = createClient();
    const product = await client.products.create({
      sku: 'NEW-001',
      name: 'New Item',
      price: { minor_units: 199, currency: 'USD' },
      initial_stock: 100,
    });

    expect(product.sku).toBe('NEW-001');
    expect(product.stock_qty).toBe(100);
  });

  it('adjustStock() returns previous and new qty', async () => {
    server.use(
      http.patch(`${BASE_URL}/api/v1/products/SKU-001/stock`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body['delta']).toBe(-10);

        return HttpResponse.json({
          sku: 'SKU-001',
          previous_qty: 100,
          new_qty: 90,
        });
      }),
    );

    const client = createClient();
    const result = await client.products.adjustStock('SKU-001', {
      delta: -10,
    });

    expect(result.previous_qty).toBe(100);
    expect(result.new_qty).toBe(90);
  });

  it('update() sends PUT and returns updated product', async () => {
    server.use(
      http.put(`${BASE_URL}/api/v1/products/SKU-001`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body['name']).toBe('Updated Espresso');
        return HttpResponse.json({
          id: 'p1', sku: 'SKU-001', name: 'Updated Espresso',
          price: { minor_units: 300, currency: 'USD' },
          category_id: null, category_name: null, barcode: null,
          stock_qty: 100, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-07-22T00:00:00Z',
        });
      }),
    );

    const client = createClient();
    const product = await client.products.update('SKU-001', { name: 'Updated Espresso' });
    expect(product.sku).toBe('SKU-001');
    expect(product.name).toBe('Updated Espresso');
  });

  it('delete() sends DELETE and returns void on 204', async () => {
    server.use(
      http.delete(`${BASE_URL}/api/v1/products/SKU-001`, () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );

    const client = createClient();
    await expect(client.products.delete('SKU-001')).resolves.toBeUndefined();
  });

  it('delete() throws ApiError on 404', async () => {
    server.use(
      http.delete(`${BASE_URL}/api/v1/products/MISSING`, () =>
        HttpResponse.json({ error: 'Product not found' }, { status: 404 }),
      ),
    );

    const client = createClient();
    await expect(client.products.delete('MISSING')).rejects.toMatchObject({ status: 404 });
  });
});

// ── Categories ────────────────────────────────────────────────────

describe('CategoriesClient', () => {
  it('list() returns categories', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/categories`, () =>
        HttpResponse.json([
          { id: 'c1', name: 'Drinks', colour: '#06b6d4', created_at: '2026-01-01T00:00:00Z' },
        ]),
      ),
    );

    const client = createClient();
    const categories = await client.categories.list();

    expect(categories).toHaveLength(1);
    expect(categories[0]!.name).toBe('Drinks');
  });

  it('get() returns category by ID', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/categories/c1`, () =>
        HttpResponse.json({ id: 'c1', name: 'Drinks', colour: '#06b6d4', created_at: '2026-01-01T00:00:00Z' }),
      ),
    );

    const client = createClient();
    const cat = await client.categories.get('c1');
    expect(cat).not.toBeNull();
    expect(cat!.name).toBe('Drinks');
  });

  it('create() sends body and returns category', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v1/categories`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body['name']).toBe('New');
        return HttpResponse.json({ id: 'c-new', name: 'New', colour: '#f97316', created_at: '2026-07-22T00:00:00Z' }, { status: 201 });
      }),
    );

    const client = createClient();
    const cat = await client.categories.create({ name: 'New', colour: '#f97316', created_at: '2026-07-22T00:00:00Z' });
    expect(cat.id).toBe('c-new');
  });

  it('delete() returns void on 204', async () => {
    server.use(
      http.delete(`${BASE_URL}/api/v1/categories/c1`, () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );

    const client = createClient();
    await expect(client.categories.delete('c1')).resolves.toBeUndefined();
  });
});

// ── Sales ─────────────────────────────────────────────────────────

describe('SalesClient', () => {
  it('list() returns sales array', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/sales`, () =>
        HttpResponse.json([
          { id: 's1', status: 'completed', total_minor: 500, currency: 'USD', customer_id: null, created_at: '2026-07-22T00:00:00Z', updated_at: '2026-07-22T00:00:00Z' },
        ]),
      ),
    );

    const client = createClient();
    const sales = await client.sales.list();
    expect(sales).toHaveLength(1);
    expect(sales[0]!.status).toBe('completed');
  });

  it('create() sends line items', async () => {
    let receivedBody: unknown;

    server.use(
      http.post(`${BASE_URL}/api/v1/sales`, async ({ request }) => {
        receivedBody = await request.json();
        return new HttpResponse(null, { status: 201 });
      }),
    );

    const client = createClient();
    await client.sales.create({
      lines: [
        { sku: 'SKU-001', qty: 2, unit_price: { minor_units: 250, currency: 'USD' } },
      ],
    });

    const body = receivedBody as Record<string, unknown>;
    const lines = body['lines'] as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(1);
    expect(lines[0]!['sku']).toBe('SKU-001');
  });

  it('updateStatus() sends status', async () => {
    let receivedBody: unknown;

    server.use(
      http.patch(`${BASE_URL}/api/v1/sales/sale-1`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({});
      }),
    );

    const client = createClient();
    await client.sales.updateStatus('sale-1', { status: 'completed' });

    const body = receivedBody as Record<string, unknown>;
    expect(body['status']).toBe('completed');
  });
});

// ── Sync ──────────────────────────────────────────────────────────

describe('SyncClient', () => {
  it('status() returns queue state', async () => {
    server.use(
      http.get(`${BASE_URL}/api/sync/status`, () =>
        HttpResponse.json({
          pending_count: 5,
          conflict_count: 1,
          total_items: 42,
        }),
      ),
    );

    const client = createClient();
    const status = await client.sync.status();

    expect(status.pending_count).toBe(5);
    expect(status.conflict_count).toBe(1);
  });

  it('push() sends items array', async () => {
    let receivedBody: unknown;

    server.use(
      http.post(`${BASE_URL}/api/sync/push`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({});
      }),
    );

    const client = createClient();
    await client.sync.push([
      { type: 'product', sku: 'SKU-001', name: 'Espresso' },
    ]);

    const items = receivedBody as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]!['sku']).toBe('SKU-001');
  });

  it('pull() returns pending items', async () => {
    server.use(
      http.post(`${BASE_URL}/api/sync/pull`, () =>
        HttpResponse.json([
          { type: 'product', sku: 'SKU-002', name: 'Latte' },
        ]),
      ),
    );

    const client = createClient();
    const items = await client.sync.pull();

    expect(items).toHaveLength(1);
    expect(items[0]!['sku']).toBe('SKU-002');
  });
});

// ── Tax + Users ───────────────────────────────────────────────────

describe('TaxClient', () => {
  it('list() returns tax rates', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/tax-rates`, () =>
        HttpResponse.json([
          { id: 't1', name: 'VAT 10%', rate: 10.0, category_id: null, product_id: null, active: true },
        ]),
      ),
    );

    const client = createClient();
    const rates = await client.tax.list();
    expect(rates).toHaveLength(1);
    expect(rates[0]!.name).toBe('VAT 10%');
  });

  it('get() returns tax rate by ID', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/tax-rates/t1`, () =>
        HttpResponse.json({ id: 't1', name: 'VAT', rate: 10.0, category_id: null, product_id: null, active: true }),
      ),
    );

    const client = createClient();
    const rate = await client.tax.get('t1');
    expect(rate).not.toBeNull();
    expect(rate!.name).toBe('VAT');
  });

  it('create() sends tax rate', async () => {
    let receivedBody: unknown;

    server.use(
      http.post(`${BASE_URL}/api/v1/tax-rates`, async ({ request }) => {
        receivedBody = await request.json();
        return new HttpResponse(null, { status: 201 });
      }),
    );

    const client = createClient();
    await client.tax.create({
      name: 'VAT 10%',
      rate_bps: 1000,
      is_default: true,
      is_inclusive: false,
    });

    const body = receivedBody as Record<string, unknown>;
    expect(body['name']).toBe('VAT 10%');
    expect(body['rate_bps']).toBe(1000);
  });

  it('update() sends PUT with partial fields', async () => {
    server.use(
      http.put(`${BASE_URL}/api/v1/tax-rates/t1`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body['rate_bps']).toBe(1100);
        return new HttpResponse(null, { status: 200 });
      }),
    );

    const client = createClient();
    await expect(client.tax.update('t1', { rate_bps: 1100 })).resolves.toBeUndefined();
  });

  it('delete() returns void on 204', async () => {
    server.use(
      http.delete(`${BASE_URL}/api/v1/tax-rates/t1`, () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );

    const client = createClient();
    await expect(client.tax.delete('t1')).resolves.toBeUndefined();
  });
});

describe('UsersClient', () => {
  it('list() returns users', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/users`, () =>
        HttpResponse.json([
          { id: 'u1', username: 'cashier1', role: 'cashier', active: true, created_at: '2026-07-22T00:00:00Z' },
        ]),
      ),
    );

    const client = createClient();
    const users = await client.users.list();
    expect(users).toHaveLength(1);
    expect(users[0]!.username).toBe('cashier1');
  });

  it('create() sends user data', async () => {
    let receivedBody: unknown;

    server.use(
      http.post(`${BASE_URL}/api/v1/users`, async ({ request }) => {
        receivedBody = await request.json();
        return new HttpResponse(null, { status: 201 });
      }),
    );

    const client = createClient();
    await client.users.create({
      username: 'cashier1',
      pin_hash: 'sha256:abc123',
      display_name: 'Cashier One',
      role_id: 'role-cashier',
    });

    const body = receivedBody as Record<string, unknown>;
    expect(body['username']).toBe('cashier1');
    expect(body['role_id']).toBe('role-cashier');
  });

  it('update() sends PUT with partial fields', async () => {
    server.use(
      http.put(`${BASE_URL}/api/v1/users/u1`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body['display_name']).toBe('Updated Name');
        return new HttpResponse(null, { status: 200 });
      }),
    );

    const client = createClient();
    await expect(client.users.update('u1', { display_name: 'Updated Name' })).resolves.toBeUndefined();
  });

  it('delete() throws ApiError on 404', async () => {
    server.use(
      http.delete(`${BASE_URL}/api/v1/users/ghost`, () =>
        HttpResponse.json({ error: 'User not found' }, { status: 404 }),
      ),
    );

    const client = createClient();
    await expect(client.users.delete('ghost')).rejects.toMatchObject({ status: 404 });
  });
});

// ── Webhooks ──────────────────────────────────────────────────────

describe('WebhooksClient', () => {
  it('stripe() sends event payload', async () => {
    let receivedBody: unknown;

    server.use(
      http.post(`${BASE_URL}/api/webhooks/stripe`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({});
      }),
    );

    const client = createClient();
    await client.webhooks.stripe({ type: 'payment_intent.succeeded', id: 'pi_123' });

    const body = receivedBody as Record<string, unknown>;
    expect(body['type']).toBe('payment_intent.succeeded');
  });
});

// ── Error handling ────────────────────────────────────────────────

describe('Error handling', () => {
  it('throws ApiError on 4xx', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/products`, () =>
        HttpResponse.json({ error: 'Invalid token' }, { status: 401 }),
      ),
    );

    const client = createClient();

    await expect(client.products.list()).rejects.toThrow(ApiError);
    await expect(client.products.list()).rejects.toMatchObject({
      status: 401,
      body: JSON.stringify({ error: 'Invalid token' }),
    });
  });

  it('throws ApiError on 5xx', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/products`, () =>
        HttpResponse.json({ error: 'Internal server error' }, { status: 500 }),
      ),
    );

    const client = createClient();

    await expect(client.products.list()).rejects.toThrow(ApiError);
    await expect(client.products.list()).rejects.toMatchObject({
      status: 500,
    });
  });

  it('throws ApiError on 409 conflict', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v1/products`, () =>
        HttpResponse.json(
          { error: 'SKU SKU-001 already exists' },
          { status: 409 },
        ),
      ),
    );

    const client = createClient();

    await expect(
      client.products.create({
        sku: 'SKU-001',
        name: 'Dup',
        price: { minor_units: 100, currency: 'USD' },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('throws ApiError on invalid JSON in success response', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/products`, () =>
        new HttpResponse('not json!!!', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      ),
    );

    const client = createClient();
    await expect(client.products.list()).rejects.toThrow(ApiError);
  });
});

// ── Bearer token ──────────────────────────────────────────────────

describe('Bearer token', () => {
  it('includes Authorization header when token is set', async () => {
    let receivedAuth: string | null = null;

    server.use(
      http.get(`${BASE_URL}/api/v1/products`, ({ request }) => {
        receivedAuth = request.headers.get('Authorization');
        return HttpResponse.json([]);
      }),
    );

    const client = createClient();
    client.setToken('test-jwt-token');
    await client.products.list();

    expect(receivedAuth).toBe('Bearer test-jwt-token');
  });

  it('does not include Authorization header for unauthenticated client', async () => {
    let receivedAuth: string | null = null;

    server.use(
      http.get(`${BASE_URL}/health`, ({ request }) => {
        receivedAuth = request.headers.get('Authorization');
        return HttpResponse.json({ status: 'ok' });
      }),
    );

    const client = createClient();
    await client.health.check();

    expect(receivedAuth).toBeNull();
  });
});

// ── URL encoding ──────────────────────────────────────────────────

describe('URL encoding', () => {
  it('properly encodes SKUs with special characters', async () => {
    let capturedUrl = '';

    server.use(
      http.get(`${BASE_URL}/api/v1/products/:sku`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(null);
      }),
    );

    const client = createClient();
    await client.products.get('COFFEE ESPRESSO #1');

    // URL should have spaces encoded
    expect(capturedUrl).toContain('COFFEE%20ESPRESSO%20%231');
  });
});
