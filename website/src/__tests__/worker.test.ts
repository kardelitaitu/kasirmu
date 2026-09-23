import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../../worker';
import { RUNTIME_CONFIG_EVENT } from '../lib/runtime-config';

describe('Cloudflare Worker — worker.ts', () => {
  const mockEnv = {
    ASSETS: {
      // Takes a Request so `fetch.mock.calls[0][0]` is typed (a zero-arg mock
      // gives `calls` the tuple type `[]`, which has no index 0 — that broke
      // `npm run check` from 4dd0cfe6c). Matches Env['ASSETS'] in worker.ts.
      fetch: vi.fn(async (_req: Request) => new Response('static asset')),
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
    // The dispatch is what lets an island that hydrated first hear about the
    // URL (see onRuntimeConfigArrived in src/lib/runtime-config.ts). Asserted
    // against the shared constant at runtime, so the Worker's own copy of the
    // event name cannot drift away from the client's.
    expect(text).toContain(`window.dispatchEvent(new Event(${JSON.stringify(RUNTIME_CONFIG_EVENT)}))`);
  });

  it('states contactEndpoint as null when CONTACT_WEBHOOK_URL is unset', async () => {
    // The route can only answer 503 without a webhook, so advertising it would
    // send every visitor into a form that cannot send (measured live
    // 2026-09-23: /api/contact returned 503 "Webhook not configured" while the
    // support page still offered the form). The support page reads this to lead
    // with its mailto path instead.
    const req = new Request('https://kasir.mu/__oz/runtime-config.js');
    const res = await worker.fetch(req, { ...mockEnv, CONTACT_WEBHOOK_URL: undefined });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"contactEndpoint":null');
    expect(text).not.toContain('/api/contact');
  });

  it('still advertises the contact route when a webhook is configured', async () => {
    const req = new Request('https://kasir.mu/__oz/runtime-config.js');
    const res = await worker.fetch(req, mockEnv);

    const text = await res.text();
    expect(text).toContain('"contactEndpoint":"/api/contact"');
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
        message: 'Hello kasir.mu team!',
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

  // ── Canonical host: www → apex ──────────────────────────────────

  it('301s www.kasir.mu to the apex, preserving path and query', async () => {
    // Before this, www.kasir.mu was a proxied CNAME with no Worker route, so it
    // fell through to the dummy origin and answered 522 on every path.
    const req = new Request('https://www.kasir.mu/en/docs/offline-mode/?tab=setup');
    // Counted before/after rather than asserted absent: the ASSETS mock is shared
    // across this file, so earlier tests have already called it.
    const assetsCallsBefore = mockEnv.ASSETS.fetch.mock.calls.length;
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://kasir.mu/en/docs/offline-mode/?tab=setup');
    // The redirect is answered by the Worker itself; nothing is served from www.
    expect(mockEnv.ASSETS.fetch.mock.calls.length).toBe(assetsCallsBefore);
  });

  it.each([
    ['/', 'https://kasir.mu/'],
    ['/en/', 'https://kasir.mu/en/'],
    ['/id/pricing/?plan=plus', 'https://kasir.mu/id/pricing/?plan=plus'],
    ['/en/account/', 'https://kasir.mu/en/account/'],
    ['/robots.txt', 'https://kasir.mu/robots.txt'],
    ['/__oz/runtime-config.js', 'https://kasir.mu/__oz/runtime-config.js'],
  ])('canonicalises www path %s', async (path, expected) => {
    const res = await worker.fetch(new Request(`https://www.kasir.mu${path}`), mockEnv);

    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe(expected);
  });

  // ── Canonical scheme: http → https ──────────────────────────────

  it('301s a plain-http request to https on the same path and query', async () => {
    // Measured live 2026-09-23: http://kasir.mu/en/ answered 200 (the zone's
    // always_use_https is off), so the same page existed on both schemes.
    const res = await worker.fetch(new Request('http://kasir.mu/en/docs/offline-mode/?tab=setup'), mockEnv);

    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://kasir.mu/en/docs/offline-mode/?tab=setup');
  });

  it('sends http+www to the apex https in ONE hop', async () => {
    const res = await worker.fetch(new Request('http://www.kasir.mu/en/pricing/?plan=plus'), mockEnv);

    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://kasir.mu/en/pricing/?plan=plus');
  });

  it('keeps the host on an http request to a subdomain', async () => {
    const admin = await worker.fetch(new Request('http://admin.kasir.mu/settings'), mockEnv);
    expect(admin.status).toBe(301);
    expect(admin.headers.get('Location')).toBe('https://admin.kasir.mu/settings');

    const dash = await worker.fetch(new Request('http://dashboard.kasir.mu/'), mockEnv);
    expect(dash.status).toBe(301);
    expect(dash.headers.get('Location')).toBe('https://dashboard.kasir.mu/');
  });

  it('preserves the method on a non-GET redirect (308, not a 301 that becomes GET)', async () => {
    const res = await worker.fetch(
      new Request('http://kasir.mu/api/contact', { method: 'POST', body: '{}' }),
      mockEnv,
    );

    expect(res.status).toBe(308);
    expect(res.headers.get('Location')).toBe('https://kasir.mu/api/contact');
  });

  it('collapses a double-slash www path (B24: no protocol-relative Location)', async () => {
    const res = await worker.fetch(new Request('https://www.kasir.mu//evil.example/x'), mockEnv);

    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://kasir.mu/evil.example/x');
  });

  it('leaves https apex, dashboard and admin alone (no self-redirect)', async () => {
    const apex = await worker.fetch(new Request('https://kasir.mu/en/docs'), mockEnv);
    expect(apex.status).toBe(200);
    expect(apex.headers.get('Location')).toBeNull();

    const dashboard = await worker.fetch(new Request('https://dashboard.kasir.mu/'), mockEnv);
    expect(dashboard.status).toBe(302);
    expect(dashboard.headers.get('Location')).toBe('https://kasir.mu/en/account/');

    const admin = await worker.fetch(new Request('https://admin.kasir.mu/'), mockEnv);
    expect(admin.status).toBe(200);
    expect(admin.headers.get('Location')).toBeNull();
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
    expect(setCookie).toContain('kasirmu_session=;');
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

  it('returns 200 {token:null} from /__oz/session when no cookie (not 401)', async () => {
    // Was 401. This endpoint is a session QUERY the header asks on every page,
    // so a 401 made the browser log a console error for every signed-out
    // visitor. Callers already treat a missing token as signed-out.
    const req = new Request('https://admin.kasir.mu/__oz/session');
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(200);
    const body = await res.json() as { token: string | null };
    expect(body.token).toBeNull();
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
    expect(setCookie).toContain('kasirmu_session=exchanged.jwt.token');
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

  it('B24c: /admin/* on the marketing host redirects to the host that owns the proxy', async () => {
    // The admin SPA's assets live under /admin/* on the marketing host (the
    // admin gate rewrites admin.kasir.mu → MARKETING_HOST/admin/*), which left
    // https://kasir.mu/admin/login publicly reachable — and dead there: login.js
    // takes the relative branch on any *.kasir.mu host, but the /api/v1/ proxy
    // is gated to DASHBOARD_HOSTS, so every submit 404s. B24 fixed only the
    // redirect; the page itself must go to the host that owns the proxy.
    const req = new Request('https://kasir.mu/admin/login?next=%2Freports');
    mockEnv.ASSETS.fetch.mockClear();
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://admin.kasir.mu/admin/login?next=%2Freports');
    // The leaked page must not be served from the proxy-less host.
    expect(mockEnv.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it('B24c: the admin host still serves /admin/login locally (proxy intact)', async () => {
    mockEnv.ASSETS.fetch.mockImplementation(async () => new Response('static asset'));
    mockEnv.ASSETS.fetch.mockClear();
    const req = new Request('https://admin.kasir.mu/admin/login');
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(200);
    const rewritten = mockEnv.ASSETS.fetch.mock.calls[0][0] as Request;
    // Assets are read from the marketing host's bundle — a binding call, so
    // the public /admin/* redirect above does not interfere with it.
    expect(new URL(rewritten.url).hostname).toBe('kasir.mu');
    expect(new URL(rewritten.url).pathname).toBe('/admin/login');
  });

  // ── R3: subdomain robots.txt — each host must serve its own ─────────

  it('R3: admin.kasir.mu serves its own robots.txt, not the login page', async () => {
    // Measured before the fix: 200 text/html, the login page — which a
    // crawler reads as "no robots.txt", i.e. the host is fully crawlable.
    mockEnv.ASSETS.fetch.mockClear();
    const res = await worker.fetch(new Request('https://admin.kasir.mu/robots.txt'), mockEnv);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    expect(await res.text()).toBe('User-agent: *\nDisallow: /\n');
    // Neither the login rewrite nor an asset may satisfy this path.
    expect(mockEnv.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it('R3: dashboard.kasir.mu serves its own robots.txt instead of redirecting it', async () => {
    // Measured before the fix: 302 → an HTML page, same conclusion.
    const res = await worker.fetch(new Request('https://dashboard.kasir.mu/robots.txt'), mockEnv);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    expect(await res.text()).toContain('Disallow: /');
    expect(res.headers.get('Location')).toBeNull();
  });

  it('R3: the marketing host still serves its static robots.txt', async () => {
    // The interception is scoped to the auth subdomains; kasir.mu/robots.txt
    // is a real file in public/ and must keep coming from the asset layer.
    mockEnv.ASSETS.fetch.mockClear();
    const req = new Request('https://kasir.mu/robots.txt');
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('static asset');
    expect(mockEnv.ASSETS.fetch).toHaveBeenCalledWith(req);
  });

  // ── R4: the admin host is no longer a soft-404 ─────────────────────

  it('R4: an unauthenticated non-login path redirects instead of returning 200', async () => {
    mockEnv.ASSETS.fetch.mockClear();
    const res = await worker.fetch(
      new Request('https://admin.kasir.mu/definitely-not-a-real-page-xyz'),
      mockEnv,
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/admin/login');
    // Nothing is rendered, so there is no unbounded 200 URL space.
    expect(mockEnv.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it('R4: every unauthenticated admin path outside the login entries redirects', async () => {
    for (const path of ['/settings', '/reports', '/admin/reports', '/admin/index.html', '/nope']) {
      const res = await worker.fetch(new Request(`https://admin.kasir.mu${path}`), mockEnv);
      expect(res.status, path).toBe(302);
      expect(res.headers.get('Location'), path).toBe('/admin/login');
    }
  });

  it('R4: the login entry points still serve the login page with a 200', async () => {
    for (const path of ['/', '/admin', '/admin/', '/admin/login', '/admin/login.html']) {
      mockEnv.ASSETS.fetch.mockClear();
      const res = await worker.fetch(new Request(`https://admin.kasir.mu${path}`), mockEnv);

      expect(res.status, path).toBe(200);
      const rewritten = mockEnv.ASSETS.fetch.mock.calls[0][0] as Request;
      // Served from the marketing host's bundle, so the /api/v1/ proxy
      // (gated to DASHBOARD_HOSTS) stays on the host the browser is on.
      expect(new URL(rewritten.url).hostname, path).toBe('kasir.mu');
      expect(new URL(rewritten.url).pathname, path).toBe('/admin/login');
    }
  });

  it('R4: the gate response carries noindex', async () => {
    const res = await worker.fetch(new Request('https://admin.kasir.mu/'), mockEnv);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
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

  it('R1: returns 200 {token:null} from /__oz/session on the marketing host without a cookie', async () => {
    const req = new Request('https://kasir.mu/__oz/session');
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(200);
    const body = await res.json() as { token: string | null };
    expect(body.token).toBeNull();
  });

  it('R1: /__oz/logout clears the cookie and redirects to marketing login', async () => {
    const req = new Request('https://kasir.mu/__oz/logout', {
      headers: { Cookie: 'oz_session=stale.jwt.token' },
    });
    const res = await worker.fetch(req, mockEnv);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://kasir.mu/en/login');
    const setCookie = res.headers.get('Set-Cookie');
    expect(setCookie).toContain('kasirmu_session=;');
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
    expect(setCookie).toContain('kasirmu_session=exchanged.cookie.token');
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
