//! Barrel export for the kasir.mu API client SDK.
//!
//! ```ts
//! import { KasirMuClient } from '@/api/client';
//!
//! const client = new KasirMuClient({ baseUrl: 'http://localhost:3099' });
//! client.setToken('eyJ...');
//! const health = await client.health.check();
//! const products = await client.products.list();
//! ```

export { KasirMuClient } from './kasirmu-client';
export { ApiError, HttpClient, type ClientConfig, type HttpMethod } from './client';
export type * from './types';
export type { TaxRate } from './tax';
export type { User } from './users';
export type { SaleRecord } from './sales';
