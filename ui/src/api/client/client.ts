//! Typed HTTP API client for the kasir.mu cloud server.
//!
//! Usage:
//! ```ts
//! import { KasirMuClient } from '@/api/client';
//!
//! const client = new KasirMuClient({ baseUrl: 'http://localhost:3099' });
//! client.setToken('eyJ...');
//!
//! const products = await client.products.list();
//! const health = await client.health.check();
//! ```
//!
//! The client does not make network requests directly — it delegates to
//! the provided `fetchFn` (defaults to `globalThis.fetch`), making it
//! easy to mock in tests.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ClientConfig {
  baseUrl: string;
  /** Optional fetch implementation (useful for testing / Node.js). */
  fetchFn?: typeof fetch;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Parses a JSON response, throwing ApiError on non-2xx or parse failures. */
async function handleResponse<T>(response: Response): Promise<T> {
  const text = await response.text();

  if (response.ok) {
    // 201 / 204 may have no body
    if (!text) return undefined as unknown as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(
        `Failed to parse JSON response: ${text.slice(0, 200)}`,
        response.status,
        text,
      );
    }
  }

  throw new ApiError(
    `HTTP ${response.status}: ${text || response.statusText}`,
    response.status,
    text,
  );
}

/**
 * Core HTTP client with Bearer token management.
 *
 * Applications should use the domain-specific sub-clients
 * exposed through {@link KasirMuClient} rather than calling
 * `request()` directly.
 */
export class HttpClient {
  private token: string | null = null;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.fetchFn = config.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  /** Attach a Bearer token for authenticated requests. */
  setToken(token: string | null): void {
    this.token = token;
  }

  /** Get the current Bearer token. */
  getToken(): string | null {
    return this.token;
  }

  /** Make a JSON API request with optional JSON body. */
  async request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.fetch(method, path, body);
    return handleResponse<T>(response);
  }

  /**
   * Make a request expecting a raw text/plain response (no JSON parsing).
   * Used for Prometheus /metrics, health text endpoints, etc.
   */
  async requestRaw(
    method: HttpMethod,
    path: string,
    body?: unknown,
  ): Promise<string> {
    const response = await this.fetch(method, path, body);

    if (!response.ok) {
      const text = await response.text();
      throw new ApiError(
        `HTTP ${response.status}: ${text || response.statusText}`,
        response.status,
        text,
      );
    }

    return response.text();
  }

  /** Build headers and execute the fetch call. */
  private async fetch(
    method: HttpMethod,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const headers: Record<string, string> = {};

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    // Only set Content-Type when there's a body
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const url = `${this.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    return this.fetchFn(url, init);
  }
}
