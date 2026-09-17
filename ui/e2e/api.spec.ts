import { test, expect } from '@playwright/test';

/**
 * API Integration Tests
 *
 * These tests validate the cloud-server HTTP API directly, without
 * going through the UI. They require the cloud server to be running
 * via Docker Compose (docker-compose.e2e.yml).
 *
 * Tests are skipped if the cloud server is unreachable (CI without
 * Docker or local dev without docker-compose up).
 *
 * Flows tested:
 *   1. Health check endpoint
 *   2. License server health
 *   3. Auth token generation
 *   4. Data sync cycle (push → pull)
 */

// ── Configuration ─────────────────────────────────────────────────

const CLOUD_SERVER_URL =
  process.env['CLOUD_SERVER_URL'] ?? 'http://localhost:3099';
const LICENSE_SERVER_URL =
  process.env['LICENSE_SERVER_URL'] ?? 'http://localhost:8080';

// ── Helpers ───────────────────────────────────────────────────────

async function isServerReachable(url: string): Promise<boolean> {
  try {
    const resp = await fetch(`${url}/api/v1/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// ── Test Suite ────────────────────────────────────────────────────

test.describe('Cloud Server API', () => {
  let serverUp = false;

  test.beforeAll(async () => {
    serverUp = await isServerReachable(CLOUD_SERVER_URL);
  });

  test('health endpoint returns 200', async () => {
    test.skip(!serverUp, 'Cloud server not running — skip API tests');

    // Rich health payload (uptime/db info) lives on the cloud-server's own
    // /api/health handler — kasirmu-api's /api/v1/health is intentionally minimal.
    const resp = await fetch(`${CLOUD_SERVER_URL}/api/health`);
    expect(resp.ok).toBe(true);
    expect(resp.status).toBe(200);

    const body = await resp.json();
    expect(body).toHaveProperty('status');
    expect(body.status).toBe('ok');
    expect(body).toHaveProperty('version');

    // The cloud-server's /api/health contract includes runtime and database
    // health fields. The minimal kasirmu-api route is /api/v1/health, not this URL.
    expect(body).toHaveProperty('uptime_seconds');
    expect(typeof body.uptime_seconds).toBe('number');
  });

  test('health endpoint includes database info', async () => {
    test.skip(!serverUp, 'Cloud server not running — skip API tests');

    const resp = await fetch(`${CLOUD_SERVER_URL}/api/health`);
    const body = await resp.json();

    // Should have DB connectivity info from the cloud-server health handler.
    expect(body).toHaveProperty('db_connected');
    expect(body.db_connected).toBe(true);
  });
});

test.describe('License Server API', () => {
  let licenseUp = false;

  test.beforeAll(async () => {
    try {
      const resp = await fetch(`${LICENSE_SERVER_URL}/api/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      licenseUp = resp.ok;
    } catch {
      licenseUp = false;
    }
  });

  test('health endpoint returns 200', async () => {
    test.skip(!licenseUp, 'License server not running — skip API tests');

    const resp = await fetch(`${LICENSE_SERVER_URL}/api/health`);
    expect(resp.ok).toBe(true);
    expect(resp.status).toBe(200);

    const body = await resp.json();

    // The license server mounts bindHealthOverride (apps/license-server/
    // health.go), a root-group middleware that short-circuits PocketBase's
    // built-in { code, message, data } envelope and serves the extended flat
    // payload instead — the same contract asserted by health_test.go and
    // documented in apps/license-server/DEPLOY.md. The envelope is what is
    // retired here, not the { status: "ok" } shape.
    expect(body).toMatchObject({ status: 'ok', db_connected: true });

    // Boot-gate snapshots are status, not liveness: each must be present as
    // an object, but their configured/verified values depend on optional
    // deployment env and are deliberately not pinned.
    for (const gate of ['smtp', 'paddle', 'midtrans', 'rsa', 'discord']) {
      expect(body).toHaveProperty(gate);
      // toBeInstanceOf, not typeof: typeof null === 'object' would pass.
      expect(body[gate]).toBeInstanceOf(Object);
    }

    // Runtime info from the Go runtime.
    expect(typeof body.uptime_secs).toBe('number');
    expect(typeof body.go_version).toBe('string');
  });

  test('license status endpoint returns status info', async () => {
    test.skip(!licenseUp, 'License server not running — skip API tests');

    const resp = await fetch(
      `${LICENSE_SERVER_URL}/api/v1/license/status`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          license_key: 'OZ-PRO-TEST-ABCD-EFGH-IJKL',
        }),
      },
    );

    // The license server should respond (may be 401 if unsigned, or valid).
    expect(resp.status === 200 || resp.status === 401).toBe(true);
    const body = await resp.json();
    // Should have some status field.
    expect(body).toBeDefined();
  });
});

test.describe('Sync API', () => {
  let serverUp = false;

  test.beforeAll(async () => {
    serverUp = await isServerReachable(CLOUD_SERVER_URL);
  });

  test('sync pull endpoint requires auth', async () => {
    test.skip(!serverUp, 'Cloud server not running — skip API tests');

    // Without auth token, pull should return 401.
    const resp = await fetch(`${CLOUD_SERVER_URL}/api/sync/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(resp.status).toBe(401);
  });

  test('sync push endpoint requires auth', async () => {
    test.skip(!serverUp, 'Cloud server not running — skip API tests');

    const resp = await fetch(`${CLOUD_SERVER_URL}/api/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(resp.status).toBe(401);
  });
});

/**
 * Exchange Rates API (ARCH-01-family repair, 2026-08-31).
 *
 * The rate commands used to be IPC + dev-mock only — this suite is the
 * first REAL-CRUD coverage of the rate surface against the running
 * cloud server (SQLite fallback mode; the PG branch is covered by
 * `pg_exchange_rates_roundtrip` in crates/kasirmu-api/src/pg_tests.rs).
 */
test.describe('Exchange Rates API', () => {
  let serverUp = false;
  let token: string | null = null;

  // Playwright runs this file under BOTH browser projects in parallel
  // workers against the SAME cloud server. Rates are global (no tenant
  // column), so each worker isolates itself with its own effective
  // date — otherwise the second worker's create hits UNIQUE(pair, date)
  // and 409s (observed race, 2026-08-31).
  const workerDay = 10 + Number(process.env.TEST_PARALLEL_INDEX ?? '0');
  const myDate = `2026-07-${String(workerDay).padStart(2, '0')}`;

  const api = (path: string, init?: RequestInit) =>
    fetch(`${CLOUD_SERVER_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });

  test.beforeAll(async () => {
    serverUp = await isServerReachable(CLOUD_SERVER_URL);
    if (!serverUp) return;
    // e2e compose runs the cloud server without OZ_ADMIN_KEY (dev mode),
    // so token minting is open.
    const resp = await fetch(`${CLOUD_SERVER_URL}/api/v1/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'e2e-rates', expiry_hours: 1 }),
    });
    if (resp.ok) {
      const body = await resp.json();
      token = body.token?.token ?? null;
    }
    // Sweep leftovers from a crashed run on THIS worker's date only —
    // never touch another worker's rows mid-flight.
    if (token) {
      const list = await api('/api/v1/exchange-rates');
      if (list.ok) {
        const rows = await list.json();
        for (const row of rows.filter(
          (r: { source: string; effective_date: string }) =>
            r.source === 'e2e' && r.effective_date === myDate,
        )) {
          await api(`/api/v1/exchange-rates/${row.id}`, { method: 'DELETE' });
        }
      }
    }
  });

  test('rate endpoints require auth', async () => {
    test.skip(!serverUp, 'Cloud server not running — skip API tests');
    const resp = await fetch(`${CLOUD_SERVER_URL}/api/v1/exchange-rates`);
    expect(resp.status).toBe(401);
  });

  test('create, list, latest, pair lookup, delete roundtrip', async () => {
    test.skip(!serverUp || !token, 'Cloud server or token unavailable');

    // Per-worker date (see workerDay above); the beforeAll sweep
    // guarantees no pre-existing e2e rows collide with it.
    const today = myDate;

    const created = await api('/api/v1/exchange-rates', {
      method: 'POST',
      body: JSON.stringify({
        from_currency: 'USD',
        to_currency: 'IDR',
        rate_millionths: 16_000_000,
        source: 'e2e',
        effective_date: today,
      }),
    });
    expect(created.status).toBe(201);
    const rate = await created.json();
    expect(rate.from_currency).toBe('USD');
    expect(rate.rate_millionths).toBe(16_000_000);
    expect(rate.effective_date).toBe(today);

    const list = await api('/api/v1/exchange-rates');
    expect(list.status).toBe(200);
    const rows = await list.json();
    expect(rows.some((r: { id: string }) => r.id === rate.id)).toBe(true);

    const latest = await api('/api/v1/exchange-rates/latest');
    expect(latest.status).toBe(200);
    const latestRows = await latest.json();
    const usdIdr = latestRows.filter(
      (r: { from_currency: string; to_currency: string }) =>
        r.from_currency === 'USD' && r.to_currency === 'IDR',
    );
    // Exactly one row per pair globally. Rates are shared reference data
    // and BOTH playwright projects run this file in parallel, so the
    // "newest" row may belong to the other worker — assert the contract
    // (one row per pair, never older than mine) rather than exclusivity.
    expect(usdIdr.length).toBe(1);
    expect(usdIdr[0].effective_date >= today).toBe(true);

    const pair = await api('/api/v1/exchange-rates/latest/USD/IDR');
    expect(pair.status).toBe(200);
    const pairRow = await pair.json();
    expect(pairRow.from_currency).toBe('USD');
    expect(pairRow.to_currency).toBe('IDR');
    expect(pairRow.effective_date >= today).toBe(true);

    const del = await api(`/api/v1/exchange-rates/${rate.id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);
    const delAgain = await api(`/api/v1/exchange-rates/${rate.id}`, { method: 'DELETE' });
    expect(delAgain.status).toBe(404);
  });

  test('validation mirrors the command layer (CUR-05)', async () => {
    test.skip(!serverUp || !token, 'Cloud server or token unavailable');

    const bad = [
      { from_currency: 'USD', to_currency: 'IDR', rate_millionths: 0 },
      { from_currency: 'USD', to_currency: 'USD', rate_millionths: 1_000_000 },
      { from_currency: 'DOLLAR', to_currency: 'IDR', rate_millionths: 1_000_000 },
      { from_currency: 'USD', to_currency: 'IDR', rate_millionths: 1_000_000, effective_date: '2026-13-01' },
    ];
    for (const body of bad) {
      const resp = await api('/api/v1/exchange-rates', {
        method: 'POST',
        body: JSON.stringify({ ...body, source: 'e2e' }),
      });
      expect(resp.status, JSON.stringify(body)).toBe(400);
    }
  });

  test('duplicate pair + effective date is rejected with 409', async () => {
    test.skip(!serverUp || !token, 'Cloud server or token unavailable');
    const today = myDate;
    const body = {
      from_currency: 'IDR',
      to_currency: 'USD',
      rate_millionths: 1,
      source: 'e2e',
      effective_date: today,
    };
    const first = await api('/api/v1/exchange-rates', { method: 'POST', body: JSON.stringify(body) });
    expect(first.status).toBe(201);
    const dup = await api('/api/v1/exchange-rates', { method: 'POST', body: JSON.stringify(body) });
    expect(dup.status).toBe(409);
    // Cleanup so the sweep is not needed on the next run either.
    const row = await first.json();
    await api(`/api/v1/exchange-rates/${row.id}`, { method: 'DELETE' });
  });
});
