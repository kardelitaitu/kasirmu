import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../../worker';

describe('Cloudflare Worker — worker.ts', () => {
  const mockEnv = {
    ASSETS: {
      fetch: vi.fn(async () => new Response('static asset')),
    },
    LICENSE_API_URL: 'https://license.test.kasir.mu',
    CONTACT_WEBHOOK_URL: 'https://discord.com/api/webhooks/mock',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('serves runtime-config.js with no-store headers', async () => {
    const req = new Request('https://kasir.mu/__oz/runtime-config.js');
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/javascript');
    expect(res.headers.get('Cache-Control')).toBe('no-store');

    const text = await res.text();
    expect(text).toContain('https://license.test.kasir.mu');
    expect(text).toContain('/api/contact');
  });

  it('handles CORS OPTIONS preflight for /api/contact', async () => {
    const req = new Request('https://kasir.mu/api/contact', { method: 'OPTIONS' });
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST, OPTIONS');
  });

  it('returns 405 Method Not Allowed for GET /api/contact', async () => {
    const req = new Request('https://kasir.mu/api/contact', { method: 'GET' });
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(405);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Method Not Allowed');
  });

  it('returns 400 when required contact fields are missing', async () => {
    const req = new Request('https://kasir.mu/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice' }),
    });
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Missing fields');
  });

  it('forwards valid contact message to Discord webhook', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    const req = new Request('https://kasir.mu/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bob',
        email: 'bob@example.com',
        message: 'Hello OZ-POS team!',
      }),
    });

    const res = await worker.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/mock',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('delegates unmatched paths to static ASSETS', async () => {
    const req = new Request('https://kasir.mu/en/docs');
    const res = await worker.fetch(req, mockEnv);

    expect(mockEnv.ASSETS.fetch).toHaveBeenCalledWith(req);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('static asset');
  });

  // ── Auth gate (ADR #42) ─────────────────────────────────────────

  it('redirects dashboard.kasir.mu / to kasir.mu/en/account/', async () => {
    const req = new Request('https://dashboard.kasir.mu/');
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://kasir.mu/en/account/');
  });

  it('redirects dashboard.kasir.mu/login to kasir.mu/en/login', async () => {
    const req = new Request('https://dashboard.kasir.mu/login');
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://kasir.mu/en/login');
  });

  it('redirects dashboard.kasir.mu/account to kasir.mu/en/account/', async () => {
    const req = new Request('https://dashboard.kasir.mu/account');
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://kasir.mu/en/account/');
  });

  it('redirects dashboard.kasir.mu even with a valid cookie', async () => {
    const req = new Request('https://dashboard.kasir.mu/', {
      headers: { Cookie: 'oz_session=valid.jwt.token' },
    });
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://kasir.mu/en/account/');
  });

  it('serves dedicated admin login page when no cookie', async () => {
    const req = new Request('https://admin.kasir.mu/');
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(200);
    expect(mockEnv.ASSETS.fetch).toHaveBeenCalled();
  });

  it('clears the httpOnly cookie on /__oz/logout and redirects to login', async () => {
    const req = new Request('https://admin.kasir.mu/__oz/logout', {
      headers: { Cookie: 'oz_session=stale.jwt.token' },
    });
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(302);
    // Logout redirects to the admin subdomain itself (login page served via
    // the Worker proxy), not the marketing host.
    expect(res.headers.get('Location')).toBe('https://admin.kasir.mu/');
    const setCookie = res.headers.get('Set-Cookie');
    expect(setCookie).toContain('oz_session=;');
    expect(setCookie).toContain('Max-Age=0');
    expect(setCookie).toContain('HttpOnly');
  });

  it('serves placeholder admin page when cookie is present', async () => {
    const req = new Request('https://admin.kasir.mu/', {
      headers: { Cookie: 'oz_session=valid.jwt.token' },
    });
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(200);
    expect(mockEnv.ASSETS.fetch).toHaveBeenCalled();
  });

  it('returns 401 from /__oz/session when no cookie', async () => {
    const req = new Request('https://admin.kasir.mu/__oz/session');
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('not signed in');
  });

  it('returns token from /__oz/session when cookie present', async () => {
    const req = new Request('https://admin.kasir.mu/__oz/session', {
      headers: { Cookie: 'oz_session=my.jwt.token' },
    });
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(200);
    const body = await res.json() as { token: string };
    expect(body.token).toBe('my.jwt.token');
  });

  it('exchanges a one-time code for a session cookie and strips the code param', async () => {
    // Hardening F1: the login page redirects here with ?code=<code>. The
    // Worker POSTs the code to /exchange-consume, sets the httpOnly cookie,
    // and redirects to a clean URL (the real token never appears in a URL).
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ token: 'exchanged.jwt.token' }),
    });

    const req = new Request('https://admin.kasir.mu/settings?code=shortlived&theme=dark');
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(302);
    // The code param must be stripped from the final URL; other params kept.
    expect(res.headers.get('Location')).toBe('/settings?theme=dark');
    // The httpOnly cookie carries the exchanged token.
    const setCookie = res.headers.get('Set-Cookie');
    expect(setCookie).toContain('oz_session=exchanged.jwt.token');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
  });

  it('redirects to the marketing login when the one-time code is invalid', async () => {
    // The exchange fails (invalid/expired code) → redirect to login so the
    // user re-authenticates — never left on a broken state.
    global.fetch = vi.fn().mockResolvedValue({
      status: 401,
      ok: false,
      json: async () => ({ error: 'invalid code' }),
    });

    const req = new Request('https://admin.kasir.mu/settings?code=stale');
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(302);
    const location = res.headers.get('Location') ?? '';
    // B24 correction: the old assertion pinned the redirect to the
    // MARKETING host — but its login form is broken there (see next test).
    // The failure must stay on the admin host: the no-session gate serves
    // the login page on admin.kasir.mu where the /api/v1/ proxy lives.
    expect(location).not.toContain('https://kasir.mu');
    expect(location).toBe('/settings');
  });

  it('B24: exchange failure must not bounce to the proxy-less marketing host', async () => {
    // https://kasir.mu/admin/login loads, but login.js computes
    // API='' for any *.kasir.mu host and POSTs relative /api/v1/... —
    // the proxy is gated to DASHBOARD_HOSTS, so on the marketing host
    // those calls 404 and the form cannot submit. A user whose code
    // expired was stranded on a dead login page.
    global.fetch = vi.fn().mockResolvedValue({
      status: 401,
      ok: false,
      json: async () => ({ error: 'invalid code' }),
    });

    const req = new Request('https://admin.kasir.mu/reports?code=expired');
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(302);
    const location = res.headers.get('Location') ?? '';
    // Relative → same admin host; the gate then serves login locally.
    expect(location.startsWith('/')).toBe(true);
    expect(location).toBe('/reports');
    // And after re-login the destination is reachable: the clean URL is
    // what the gate's login flow will return to.
  });

  it('B24b: protocol-relative exchange paths are pinned to the admin host', async () => {
    // The success 302 used url.pathname raw: /?code=x at '//evil.com'
    // made Location '//evil.com/' — a protocol-relative OPEN REDIRECT on
    // the admin host (and the failure path inherited it). The path is
    // now forced single-slash.
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ token: 't.jwt' }),
    });

    const req = new Request('https://admin.kasir.mu//evil.com/?code=valid');
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/evil.com/'); // same-origin
  });

  // ── R1: account-portal httpOnly cookie on the marketing host ────────

  it('R1: serves /__oz/session on the marketing host from the cookie', async () => {
    const req = new Request('https://kasir.mu/__oz/session', {
      headers: { Cookie: 'oz_session=cookie.jwt.token' },
    });
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(200);
    const body = await res.json() as { token: string };
    expect(body.token).toBe('cookie.jwt.token');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('R1: returns 401 from /__oz/session on the marketing host without a cookie', async () => {
    const req = new Request('https://kasir.mu/__oz/session');
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('not signed in');
  });

  it('R1: /__oz/logout clears the cookie and redirects to marketing login', async () => {
    const req = new Request('https://kasir.mu/__oz/logout', {
      headers: { Cookie: 'oz_session=stale.jwt.token' },
    });
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://kasir.mu/en/login');
    const setCookie = res.headers.get('Set-Cookie');
    expect(setCookie).toContain('oz_session=;');
    expect(setCookie).toContain('Max-Age=0');
    expect(setCookie).toContain('HttpOnly');
  });

  it('R1: exchanges a 48-hex code for a cookie on the marketing host', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ token: 'exchanged.cookie.token' }),
    });

    // A 48-hex one-time code (exchange codes are 48 hex chars).
    const code = 'a'.repeat(48);
    const req = new Request(`https://kasir.mu/en/account?code=${code}&theme=dark`);
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(302);
    // Code stripped, other params kept, same-origin account path.
    expect(res.headers.get('Location')).toBe('/en/account?theme=dark');
    const setCookie = res.headers.get('Set-Cookie');
    expect(setCookie).toContain('oz_session=exchanged.cookie.token');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    // The exchange must hit the license server, not the static assets.
    expect(global.fetch).toHaveBeenCalledWith(
      'https://license.test.kasir.mu/api/v1/web/exchange-consume',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('R1: ignores a short non-exchange code param on the marketing host', async () => {
    // A coincidental `code` query param (e.g. campaign tracking) must not
    // be treated as an exchange code — the page loads normally.
    global.fetch = vi.fn();

    const req = new Request('https://kasir.mu/en/support?code=abc123');
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(200);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockEnv.ASSETS.fetch).toHaveBeenCalled();
  });

  it('R1: redirects to marketing login when the exchange code is invalid', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 401,
      ok: false,
      json: async () => ({ error: 'invalid code' }),
    });

    const code = 'b'.repeat(48);
    const req = new Request(`https://kasir.mu/en/account?code=${code}`);
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://kasir.mu/en/login');
  });

  // ── R3: strict CSP without script-src 'unsafe-inline' ───────────────

  it('R3: auth-gated admin pages carry a strict CSP with no inline scripts', async () => {
    // The admin SPA loads every script from an external file, so the CSP
    // must block inline script injection (no 'unsafe-inline' in script-src).
    const req = new Request('https://admin.kasir.mu/', {
      headers: { Cookie: 'oz_session=valid.jwt.token' },
    });
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(200);
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    // script-src must NOT permit inline script injection.
    const scriptDirective = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
    expect(scriptDirective).not.toContain('unsafe-inline');
    expect(scriptDirective).toContain("'self'");
    // style-src keeps 'unsafe-inline' (admin pages style attributes).
    const styleDirective = csp.split(';').find((d) => d.trim().startsWith('style-src')) ?? '';
    expect(styleDirective).toContain("'unsafe-inline'");
    // The rest of the hardening headers stay in place.
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
