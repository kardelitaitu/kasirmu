//! Main kasir.mu API client — typed access to all 20+ cloud server endpoints.
//!
//! ```ts
//! import { KasirMuClient } from '@/api/client';
//!
//! const client = new KasirMuClient({ baseUrl: 'http://localhost:3099' });
//! client.setToken('eyJ...');
//!
//! // Health — no auth needed
//! const h = await client.health.check();
//!
//! // Auth — create tokens
//! const token = await client.auth.createToken({ label: 'my-app' });
//!
//! // Products
//! const products = await client.products.list();
//! const product = await client.products.get('SKU-001');
//! await client.products.create({ sku: 'NEW', name: 'New Item', price: { minor_units: 199, currency: 'USD' } });
//! await client.products.adjustStock('SKU-001', { delta: -10 });
//!
//! // Categories
//! const categories = await client.categories.list();
//!
//! // Tax Rates
//! await client.tax.create({ name: 'VAT 10%', rate_bps: 1000, is_default: true, is_inclusive: false });
//!
//! // Users
//! await client.users.create({ username: 'cashier1', pin_hash: '...', display_name: 'Cashier 1', role_id: 'role-cashier' });
//!
//! // Sales
//! await client.sales.create({ lines: [{ sku: 'SKU-001', qty: 2, unit_price: { minor_units: 199, currency: 'USD' } }] });
//! const sale = await client.sales.get('sale-id');
//! await client.sales.updateStatus('sale-id', { status: 'completed' });
//!
//! // Sync
//! const status = await client.sync.status();
//! await client.sync.push([{ type: 'product', sku: 'SKU-001' }]);
//! const items = await client.sync.pull({ since: null });
//!
//! // Webhooks
//! await client.webhooks.stripe({ type: 'payment_intent.succeeded' });
//! await client.webhooks.square({ type: 'payment.updated' });
//! ```

import { HttpClient, type ClientConfig } from './client';
import { HealthClient } from './health';
import { AuthClient } from './auth';
import { ProductsClient } from './products';
import { CategoriesClient } from './categories';
import { TaxClient } from './tax';
import { UsersClient } from './users';
import { SalesClient } from './sales';
import { SyncClient } from './sync';
import { WebhooksClient } from './webhooks';

export class KasirMuClient {
  private readonly http: HttpClient;

  /** Health endpoints — no auth required. */
  readonly health: HealthClient;
  /** Auth / token endpoints. */
  readonly auth: AuthClient;
  /** Product CRUD + stock management. */
  readonly products: ProductsClient;
  /** Category listing. */
  readonly categories: CategoriesClient;
  /** Tax rate creation. */
  readonly tax: TaxClient;
  /** User account management. */
  readonly users: UsersClient;
  /** Sale creation, retrieval, and status transitions. */
  readonly sales: SalesClient;
  /** Offline queue push/pull sync endpoints. */
  readonly sync: SyncClient;
  /** Payment provider webhook receivers. */
  readonly webhooks: WebhooksClient;

  constructor(config: ClientConfig) {
    this.http = new HttpClient(config);
    this.health = new HealthClient(this.http);
    this.auth = new AuthClient(this.http);
    this.products = new ProductsClient(this.http);
    this.categories = new CategoriesClient(this.http);
    this.tax = new TaxClient(this.http);
    this.users = new UsersClient(this.http);
    this.sales = new SalesClient(this.http);
    this.sync = new SyncClient(this.http);
    this.webhooks = new WebhooksClient(this.http);
  }

  /** Attach a Bearer token for all authenticated requests. */
  setToken(token: string | null): void {
    this.http.setToken(token);
  }

  /** Get the current Bearer token. */
  getToken(): string | null {
    return this.http.getToken();
  }
}
