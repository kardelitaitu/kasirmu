/**
 * Cloudflare Worker for the kasir.mu website — marketing site + dashboard subdomains.
 *
 * Hostname routing:
 *   kasir.mu          → marketing site (static assets, runtime config, contact form)
 *   dashboard.kasir.mu → user dashboard (auth-gated, placeholder for now)
 *   admin.kasir.mu     → admin panel (auth-gated, placeholder for now)
 *
 * Auth gate (ADR #42):
 *   Dashboard subdomains check for an httpOnly `oz_session` cookie. If missing:
 *     1. User is redirected to https://kasir.mu/login?redirect=<original_url>
 *     2. After login, AuthForm.tsx redirects to the dashboard subdomain with
 *        a one-time exchange code (?code=)
 *     3. This worker catches the ?code= param, exchanges it for a session
 *        token at the license server, sets the httpOnly cookie, and redirects
 *        to the clean URL (token never appears in a URL)
 *     4. Subsequent requests carry the cookie
 *
 * The site used to be an assets-only Worker, which forced every backend-URL
 * change to rebuild + redeploy the whole bundle (PUBLIC_LICENSE_API_URL is
 * baked into the JS at build time by Astro). This Worker keeps serving the
 * static assets but also exposes a tiny runtime-config endpoint backed by the
 * `LICENSE_API_URL` `[vars]` binding — changing the backend URL now only
 * requires updating the var (Cloudflare dashboard → Worker → Settings →
 * Variables, or wrangler.toml), not rebuilding the site.
 *
 * The browser loads /__oz/runtime-config.js from the layout head (see
 * Base.astro); website/src/lib/runtime-config.ts reads window.__OZ_CONFIG__
 * and falls back to the build-time PUBLIC_LICENSE_API_URL when the endpoint
 * is absent (local preview, non-Worker hosts, or an unset var).
 */

interface Env {
  /** Static-assets binding (wrangler.toml `assets.binding`). */
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Runtime backend URL — overrides the build-time PUBLIC_LICENSE_API_URL. */
  LICENSE_API_URL?: string;
  /** Discord webhook URL for the support contact form (secret — never exposed to the browser). */
  CONTACT_WEBHOOK_URL?: string;
  /** Northflank read-only API key for the Health-tab log proxy (secret — never exposed to the browser). */
  NF_API_KEY?: string;
  /** Cloudflare API token for the Health-tab deployments proxy (secret — never exposed to the browser). */
  CF_API_KEY?: string;
  /** Cloudflare account ID (non-secret) for the deployments proxy — set in wrangler.toml [vars]. */
  CLOUDFLARE_ACCOUNT_ID?: string;
}

const RUNTIME_CONFIG_PATH = '/__oz/runtime-config.js';
/**
 * The event the config script dispatches once `window.__OZ_CONFIG__` is set.
 *
 * This is the contract that lets an island hear about a URL that arrived AFTER
 * it rendered: the script is deferred, but the island's own module is fetched
 * in parallel and can hydrate first, and a plain read of the global never
 * learns better. Mirrors RUNTIME_CONFIG_EVENT in src/lib/runtime-config.ts —
 * the Worker stays import-free, and worker.test.ts imports the shared constant
 * and fails if these two ever disagree.
 */
const RUNTIME_CONFIG_EVENT = 'oz:runtime-config';
const SESSION_PATH = '/__oz/session';
const LOGOUT_PATH = '/__oz/logout';
/** Health-tab platform logs — proxied to Northflank with the NF_API_KEY secret. */
const NF_LOGS_PATH = '/__oz/nf-logs';
/** The license server's Northflank coordinates (fixed deployment). */
const NF_PROJECT = 'oz-pos';
const NF_SERVICE = 'cloud';
/** Health-tab Cloudflare deployment history — proxied with the CF_API_KEY secret. */
const CF_DEPLOYS_PATH = '/__oz/cf-deploys';
/** This Worker's own script name on Cloudflare. */
const CF_SCRIPT_NAME = 'oz-pos';
/** Health: Northflank service metadata (deployment state, running sha). */
const NF_STATUS_PATH = '/__oz/nf-status';
/** Health: public-surface uptime self-check (probed from the edge). */
const UPTIME_PATH = '/__oz/uptime';
/** Health: this Worker's own runtime logs (Cloudflare observability query). */
const WORKER_LOGS_PATH = '/__oz/worker-logs';
/** Health: request/error counts per minute (Cloudflare GraphQL analytics). */
const TRAFFIC_PATH = '/__oz/traffic';
const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } as const;
const COOKIE_NAME = 'kasirmu_session';
const LEGACY_COOKIE_NAME = 'oz_session';

/** Subdomains that require authentication (admin-only). */
const DASHBOARD_HOSTS = new Set(['admin.kasir.mu']);

/** Customer dashboard subdomain — redirects to the marketing account portal. */
const CUSTOMER_DASHBOARD_HOST = 'dashboard.kasir.mu';

/** Marketing site domain — no auth required. */
const MARKETING_HOST = 'kasir.mu';

/**
 * Every host that is NOT the marketing host. Each needs its own robots.txt:
 * robots.txt is per-authority, so `kasir.mu/robots.txt` governs nothing on
 * admin.kasir.mu or dashboard.kasir.mu. Both subdomains are entirely
 * auth-gated with nothing to index, but the file must be SERVED — a crawler
 * that receives HTML, or a 302 to HTML, concludes there is no robots.txt and
 * treats the whole host as crawlable.
 * See docs/records/seo-robots-llms-review-19-09-26.md §1.3 R3.
 */
const SUBDOMAIN_HOSTS = new Set([...DASHBOARD_HOSTS, CUSTOMER_DASHBOARD_HOST]);

/** Body served for /robots.txt on the auth subdomains (see SUBDOMAIN_HOSTS). */
const SUBDOMAIN_ROBOTS = 'User-agent: *\nDisallow: /\n';

/**
 * Paths on admin.kasir.mu that serve the login page directly. `/` is the
 * logout destination and the natural entry; `/admin` and `/admin/login` are
 * the form used by the marketing-host redirect and by the login page's own
 * asset paths. Any OTHER unauthenticated path redirects to the login page
 * rather than being answered with a 200, so the host stops exposing an
 * unbounded URL space of byte-identical HTML (a soft-404). It redirects
 * rather than 404s because the one-time-code exchange (Step 1) sends a failed
 * login back to a clean path like /settings, and a user with a stale bookmark
 * should land on the login form, not a 404.
 * See docs/records/seo-robots-llms-review-19-09-26.md §1.3 R4.
 */
const ADMIN_LOGIN_ENTRY_PATHS = new Set([
  '/',
  '/admin',
  '/admin/',
  '/admin/login',
  '/admin/login/',
  '/admin/login.html',
]);

/** Where an unauthenticated admin path is sent (see ADMIN_LOGIN_ENTRY_PATHS). */
const ADMIN_LOGIN_PATH = '/admin/login';

/** Origins the /api/v1/ proxy will echo as Access-Control-Allow-Origin
 * (WEB-2): the marketing host and the two auth-gated subdomains. Any
 * other Origin falls back to the marketing host. */
const ALLOWED_CORS_ORIGINS = new Set([
  'https://kasir.mu',
  'https://dashboard.kasir.mu',
  'https://admin.kasir.mu',
]);

/** URL the customer dashboard subdomain redirects to for account management. */
const CUSTOMER_ACCOUNT_URL = 'https://kasir.mu/en/account/';
/** URL the customer dashboard subdomain redirects to for login. */
const CUSTOMER_LOGIN_URL = 'https://kasir.mu/en/login';

/** Parse a named cookie value from the Cookie header. */
function getCookie(headers: Headers, name: string): string | null {
  const raw = headers.get('Cookie');
  if (!raw) return null;
  for (const pair of raw.split(';')) {
    const [k, ...v] = pair.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/**
 * Parse a named cookie value from the Cookie header, falling back to the
 * legacy cookie name during the brand migration. Returns the new cookie
 * value if present, otherwise the legacy value, or null if neither exists.
 */
function getCookieWithLegacy(headers: Headers, name: string, legacyName: string): string | null {
  return getCookie(headers, name) ?? getCookie(headers, legacyName);
}

/** Build a Set-Cookie header string for the kasirmu_session token.
 *
 * H4 (hardening): the cookie is scoped to the specific dashboard subdomain
 * (admin.kasir.mu or dashboard.kasir.mu) instead of the parent
 * `.kasir.mu`, so it is never sent to the marketing site or other
 * subdomains — no cross-subdomain session exposure. */
function setCookieHeader(token: string, maxAge: number, domain: string): string {
  return `${COOKIE_NAME}=${token}; Domain=${domain}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

/**
 * Wrap a response with the strict CSP for admin/dashboard subdomains
 * (hardening F2): no framing, no referrer leak. Applied to the SPA pages
 * and the admin login page — never the marketing site (which needs
 * 'unsafe-inline' for its Astro inline scripts).
 *
 * R3: `script-src` no longer carries 'unsafe-inline'. The retired
 * dashboard SPA bootstrapped through inline islands, but the remaining
 * auth-gated pages (website/public/admin/*) load every script from an
 * external file (theme.js, admin-utils.js, admin.js, login.js), so inline
 * script injection is blocked outright.
 */
function withStrictCSP(resp: Response): Response {
  const strictCSP = [
    "default-src 'none'",
    "script-src 'self' https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://kasir.mu https://*.code.run https://*.kasir.mu https://license.ozpos.my.id https://open.er-api.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  // Copy the asset response headers into a fresh Headers object and use
  // .set() so the strict CSP REPLACES the marketing one instead of being
  // appended as a second header (two CSPs would be enforced as an
  // intersection, breaking connect-src for the FX rate API).
  const headers = new Headers(resp.headers);
  headers.set('Content-Security-Policy', strictCSP);
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  // SEO: every response on this path is an auth-gated surface. Without this,
  // admin.kasir.mu is a soft-404 — the gate below rewrites ANY unauthenticated
  // path to /admin/login with a 200, so an unbounded URL space serves
  // byte-identical HTML (no `robots` meta, no canonical). noindex is the
  // correct tool; a robots.txt Disallow would hide the tag instead of acting
  // on it. See docs/records/seo-robots-llms-review-19-09-26.md §1.3 R4.
  headers.set('X-Robots-Tag', 'noindex');
  // SPA HTML is auth-gated — never cache it at the edge so a deploy (or a
  // session state change) is reflected immediately (M6).
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  return new Response(resp.body, { status: resp.status, headers });
}

/**
 * Serve static assets from the ASSETS binding with optimized caching.
 *
 * Cache strategy (Lighthouse "use efficient cache lifetimes"):
 *   - /_astro/*: content-hashed filenames → immutable, 1-year cache.
 *     Without this, the Worker's default (no header) lets Cloudflare
 *     apply its own ~4h TTL, triggering a Lighthouse warning.
 *   - Everything else: must-revalidate (default) — HTML pages and
 *     unfingerprinted assets must reflect deploys immediately.
 *
 * HTML is passed through untouched: stylesheets are inlined at build
 * time (astro.config.mjs `inlineStylesheets: 'always'`), so there is
 * no render-blocking external CSS and no need for the media="print"
 * deferral hack — which caused a flash of unstyled content on mobile
 * reloads and was removed (see git history, 3b505842).
 */
async function serveStatic(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const resp = await env.ASSETS.fetch(request);

  // Copy original headers into a plain object we can pass to the Response
  // constructor. Using resp.headers directly sometimes fails in Workers
  // because the Headers object is tied to the original body stream.
  const headers: Record<string, string> = {};
  resp.headers.forEach((v, k) => { headers[k] = v; });

  if (url.pathname.startsWith('/_astro/')) {
    headers['cache-control'] = 'public, max-age=31536000, immutable';
  }

  return new Response(resp.body, { status: resp.status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const hostname = url.hostname;

    // ── Crawler policy on the auth subdomains (R3) ────────────────────
    // robots.txt is per-authority: kasir.mu/robots.txt governs nothing on
    // admin.kasir.mu or dashboard.kasir.mu, and neither can inherit it.
    // Measured before this: admin.kasir.mu/robots.txt returned 200 text/html
    // (the login page) and dashboard.kasir.mu/robots.txt 302'd to an HTML
    // page — in both cases a crawler sees "no robots.txt" and treats the host
    // as fully crawlable. This must come BEFORE the dashboard redirect and
    // the admin gate below, both of which would otherwise swallow the path.
    // The marketing host's own robots.txt is a static file in public/ and is
    // deliberately left to the asset layer.
    if (url.pathname === '/robots.txt' && SUBDOMAIN_HOSTS.has(hostname)) {
      return new Response(SUBDOMAIN_ROBOTS, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    // ── Customer dashboard subdomain redirect ─────────────────────────
    // dashboard.kasir.mu is no longer a separate SPA; it redirects
    // transparently to the fully-featured account portal on the marketing
    // host (kasir.mu/en/account/). This eliminates the cookie isolation
    // problem (separate Domain=dashboard.kasir.mu) and removes the
    // fragile vanilla-JS duplicate of AccountView.tsx.
    if (hostname === CUSTOMER_DASHBOARD_HOST) {
      const isLoginPath = url.pathname.includes('login');
      const target = isLoginPath ? CUSTOMER_LOGIN_URL : CUSTOMER_ACCOUNT_URL;
      return new Response(null, {
        status: 302,
        headers: {
          Location: target,
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        },
      });
    }

    // ── Hostname-based auth gate ──────────────────────────────────
    if (DASHBOARD_HOSTS.has(hostname)) {
      // ── API Proxy to license server (resolves CORS and in-handler Origin checks) ──
      if (url.pathname.startsWith('/api/v1/')) {
        const targetUrl = (env.LICENSE_API_URL ?? 'https://license.kasir.mu') + url.pathname + url.search;
        const reqHeaders = new Headers(request.headers);
        reqHeaders.set('Origin', 'https://kasir.mu');
        // WEB-2: never forward the dashboard host's Cookie header to the
        // backend — the SPA authenticates with a Bearer token obtained
        // same-origin from /__oz/session, so Cookie here is pure
        // cross-service leakage.
        reqHeaders.delete('Cookie');
        const res = await fetch(targetUrl, {
          method: request.method,
          headers: reqHeaders,
          body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
          redirect: 'follow',
        });
        const respHeaders = new Headers(res.headers);
        // WEB-2: echo a fixed allow-list origin instead of `*`. The
        // subdomain login pages call the API same-origin (relative URL),
        // so the echo must match the requesting host — a plain wildcard
        // would still work for non-credentialed fetches but makes every
        // token-bearing response readable from any origin that obtains a
        // token, which buys nothing and widens the surface.
        const requestOrigin = request.headers.get('Origin') ?? '';
        const corsOrigin = ALLOWED_CORS_ORIGINS.has(requestOrigin)
          ? requestOrigin
          : 'https://kasir.mu';
        respHeaders.set('Access-Control-Allow-Origin', corsOrigin);
        respHeaders.set('Vary', 'Origin');
        return new Response(res.body, { status: res.status, headers: respHeaders });
      }

      // ── Redirect marketing auth pages to the marketing host (fixes 404s) ──
      if (url.pathname.startsWith('/en/login') || url.pathname.startsWith('/id/login')) {
        const target = `https://${MARKETING_HOST}${url.pathname}${url.search}`;
        return new Response(null, { status: 302, headers: { Location: target } });
      }


      const sessionCookie = getCookieWithLegacy(request.headers, COOKIE_NAME, LEGACY_COOKIE_NAME);

      // Step 1: One-time exchange code (hardening F1). The login page
      // authenticates at the license server, gets a short-lived single-use
      // code via /exchange-issue, and redirects here with ?code=<code>.
      // The Worker POSTs the code to /exchange-consume to receive the real
      // session token, sets the httpOnly cookie, and redirects to clean URL.
      // The real session token never appears in a URL.
      const codeParam = url.searchParams.get('code');
      if (codeParam) {
        url.searchParams.delete('code');
        // B24: the redirect path is forced single-slash — '//evil.com' or
        // '/\evil.com' would otherwise resolve as a protocol-relative
        // OPEN REDIRECT (both 302s below use this URL raw).
        const safePath = '/' + url.pathname.replace(/^[/\\]+/, '');
        const cleanUrl = safePath + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '');
        const apiUrl = (env.LICENSE_API_URL ?? 'https://license.kasir.mu') + '/api/v1/web/exchange-consume';
        try {
          const res = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: codeParam }),
          });
          if (res.status === 200) {
            const body = await res.json() as { token?: string };
            if (body.token) {
              return new Response(null, {
                status: 302,
                headers: {
                  Location: cleanUrl,
                  'Set-Cookie': setCookieHeader(body.token, 30 * 24 * 3600, hostname),
                  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
                  'Referrer-Policy': 'no-referrer',
                  'Pragma': 'no-cache',
                },
              });
            }
          }
        } catch {
          // Exchange failed — fall through to redirect to login below.
        }
        // Code invalid or exchange failed — send the browser back through
        // the login flow. B24 fix: the old code 302'd to the MARKETING
        // host's /admin/login — but login.js computes API='' for any
        // *.kasir.mu host and POSTs relative /api/v1/... calls, and
        // the proxy is gated to DASHBOARD_HOSTS. On the marketing host
        // those calls 404: the user was stranded on a dead login form.
        // Redirect to the clean URL on THIS host instead — the no-session
        // gate below serves the login page locally (with the proxy), and
        // the original destination survives the re-login round-trip.
        return new Response(null, { status: 302, headers: { Location: cleanUrl } });
      }

      // Step 1b: The dashboard SPA calls /__oz/session to obtain the JWT
      // from the httpOnly cookie (so it can authenticate to the license API
      // with a Bearer header). Same-origin, so the token never leaks to
      // third-party JS. A missing cookie returns 200 {token:null} rather
      // than 401: this endpoint is a session QUERY (the header asks it on
      // every page), and a 401 here is logged by the browser as a console
      // error for every signed-out visitor. Callers already treat a missing
      // `token` as signed-out.
      if (url.pathname === SESSION_PATH) {
        return new Response(JSON.stringify({ token: sessionCookie ?? null }), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      }

      // Step 1b-2: NF_LOGS_PATH — platform logs for the Health tab. The
      // Northflank key lives in a Worker secret (NF_API_KEY); the browser
      // only ever talks to this same-origin endpoint, which requires the
      // admin session cookie like every other /__oz route on this host.
      // queryType=range + direction=backward + lineLimit returns the most
      // recent lines from the running pod(s); the worker sorts ascending
      // so the panel reads chronologically (oldest at top).
      if (url.pathname === NF_LOGS_PATH) {
        if (!sessionCookie) {
          return new Response(JSON.stringify({ error: 'not signed in' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          });
        }
        if (!env.NF_API_KEY) {
          return new Response(JSON.stringify({ error: 'log proxy not configured (missing NF_API_KEY)' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          });
        }
        const requested = parseInt(url.searchParams.get('lines') ?? '100', 10);
        const lineLimit = Math.min(Math.max(Number.isFinite(requested) ? requested : 100, 1), 500);
        const target = `https://api.northflank.com/v1/projects/${NF_PROJECT}/services/${NF_SERVICE}/logs` +
          `?queryType=range&duration=86400&lineLimit=${lineLimit}&direction=backward`;
        try {
          const nfRes = await fetch(target, {
            headers: { Authorization: `Bearer ${env.NF_API_KEY}` },
            signal: AbortSignal.timeout(8000),
          });
          if (!nfRes.ok) {
            const detail = nfRes.status === 401
              ? 'Northflank denied the log read — the logging API role needs Project > Services > Deployment > View Observability'
              : `Northflank responded ${nfRes.status}`;
            return new Response(JSON.stringify({ ok: false, error: detail }), {
              status: 502,
              headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
            });
          }
          const nfBody = await nfRes.json() as { data?: Array<{ ts?: string; log?: string; containerId?: string }> };
          const raw = Array.isArray(nfBody.data) ? nfBody.data : [];
          const out = raw
            .map(l => ({ ts: String(l.ts ?? ''), log: String(l.log ?? ''), containerId: String(l.containerId ?? '') }))
            .sort((a, b) => a.ts.localeCompare(b.ts))
            .slice(-lineLimit);
          return new Response(JSON.stringify({ ok: true, lines: out }), {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          });
        } catch {
          return new Response(JSON.stringify({ ok: false, error: 'could not reach Northflank' }), {
            status: 502,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          });
        }
      }

      // Step 1b-3: CF_DEPLOYS_PATH — Cloudflare deployment history for the
      // Health tab (same trust shape as NF_LOGS_PATH: the API token is a
      // Worker secret, the browser only talks to this session-gated route).
      // Returns the latest deployments (message, author, trigger, version)
      // newest-first; capped at 10 entries.
      if (url.pathname === CF_DEPLOYS_PATH) {
        if (!sessionCookie) {
          return new Response(JSON.stringify({ error: 'not signed in' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          });
        }
        if (!env.CF_API_KEY) {
          return new Response(JSON.stringify({ error: 'deployments proxy not configured (missing CF_API_KEY)' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          });
        }
        const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${CF_SCRIPT_NAME}/deployments`;
        try {
          const cfRes = await fetch(cfUrl, {
            headers: { Authorization: `Bearer ${env.CF_API_KEY}` },
            signal: AbortSignal.timeout(8000),
          });
          if (!cfRes.ok) {
            return new Response(JSON.stringify({ ok: false, error: `Cloudflare responded ${cfRes.status}` }), {
              status: 502,
              headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
            });
          }
          const cfBody = await cfRes.json() as {
            success?: boolean;
            errors?: Array<{ message?: string }>;
            result?: { deployments?: Array<{
              id?: string; created_on?: string; author_email?: string; source?: string;
              annotations?: Record<string, string>;
              versions?: Array<{ version_id?: string; percentage?: number }>;
            }> };
          };
          if (!cfBody.success) {
            const msg = cfBody.errors && cfBody.errors[0] && cfBody.errors[0].message ? `: ${cfBody.errors[0].message}` : '';
            return new Response(JSON.stringify({ ok: false, error: `Cloudflare API error${msg}` }), {
              status: 502,
              headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
            });
          }
          const deploys = (cfBody.result?.deployments ?? []).slice(0, 10).map(d => ({
            id: String(d.id ?? ''),
            time: String(d.created_on ?? ''),
            author: String(d.author_email ?? ''),
            trigger: String(d.annotations?.['workers/triggered_by'] ?? 'deployment'),
            message: String(d.annotations?.['workers/message'] ?? ''),
            versionId: String(d.versions?.[0]?.version_id ?? ''),
          }));
          return new Response(JSON.stringify({ ok: true, deploys }), {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          });
        } catch {
          return new Response(JSON.stringify({ ok: false, error: 'could not reach Cloudflare' }), {
            status: 502,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          });
        }
      }

      // Step 1b-4: NF_STATUS_PATH — service metadata for the Health tab.
      // Returns only status fields the panel needs (deployment state,
      // running git sha, branch, region, instances) — the full service
      // payload is deliberately NOT relayed.
      if (url.pathname === NF_STATUS_PATH) {
        if (!sessionCookie) return new Response(JSON.stringify({ error: 'not signed in' }), { status: 401, headers: JSON_HEADERS });
        if (!env.NF_API_KEY) return new Response(JSON.stringify({ error: 'status proxy not configured (missing NF_API_KEY)' }), { status: 503, headers: JSON_HEADERS });
        try {
          const res = await fetch(`https://api.northflank.com/v1/projects/${NF_PROJECT}/services/${NF_SERVICE}`, {
            headers: { Authorization: `Bearer ${env.NF_API_KEY}` },
            signal: AbortSignal.timeout(8000),
          });
          if (!res.ok) {
            return new Response(JSON.stringify({ ok: false, error: `Northflank responded ${res.status}` }), { status: 502, headers: JSON_HEADERS });
          }
          const b = await res.json() as {
            data?: {
              serviceType?: string;
              deployment?: { instances?: number; internal?: { deployedSHA?: string; branch?: string; updatedAt?: string }; lastTransitionTime?: string };
              status?: { build?: { status?: string; lastTransitionTime?: string }; deployment?: { status?: string; reason?: string; lastTransitionTime?: string } };
              cluster?: { id?: string };
            };
          };
          const s = b.data ?? {};
          return new Response(JSON.stringify({
            ok: true,
            status: {
              serviceType: String(s.serviceType ?? ''),
              deploymentStatus: String(s.status?.deployment?.status ?? ''),
              deploymentReason: String(s.status?.deployment?.reason ?? ''),
              deploymentAt: String(s.status?.deployment?.lastTransitionTime ?? ''),
              buildStatus: String(s.status?.build?.status ?? ''),
              buildAt: String(s.status?.build?.lastTransitionTime ?? ''),
              deployedSha: String(s.deployment?.internal?.deployedSHA ?? ''),
              branch: String(s.deployment?.internal?.branch ?? ''),
              updatedAt: String(s.deployment?.internal?.updatedAt ?? ''),
              region: String(s.cluster?.id ?? ''),
              instances: Number(s.deployment?.instances ?? 0),
            },
          }), { headers: JSON_HEADERS });
        } catch {
          return new Response(JSON.stringify({ ok: false, error: 'could not reach Northflank' }), { status: 502, headers: JSON_HEADERS });
        }
      }

      // Step 1b-5: UPTIME_PATH — the ONLY surface probeable from inside
      // the Worker (edge vantage): the Northflank license API, which lives
      // on a different zone. Everything on the kasir.mu zone is
      // unprobeable from here: same-zone subrequests bypass Workers
      // routes and fall through to a nonexistent origin (dashboard/admin
      // are Worker routes) or an orange-to-orange apex — both bogus 522s
      // (a workers.dev self-fetch loops the same way). Those three are
      // probed from the BROWSER instead (admin.js no-cors fetch, allowed
      // by the CSP's first-party connect-src entries).
      if (url.pathname === UPTIME_PATH) {
        if (!sessionCookie) return new Response(JSON.stringify({ error: 'not signed in' }), { status: 401, headers: JSON_HEADERS });
        const checks = await Promise.all([['license api', 'https://license.kasir.mu/api/health']].map(async ([name, target]) => {
          const t0 = Date.now();
          try {
            const res = await fetch(target, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(6000) });
            const ms = Date.now() - t0;
            return { name, up: res.status < 500, ms, status: res.status, error: res.status >= 500 ? `HTTP ${res.status}` : '', vantage: 'edge' };
          } catch (e) {
            return { name, up: false, ms: Date.now() - t0, status: 0, error: e instanceof Error ? e.message : 'network error', vantage: 'edge' as const };
          }
        }));
        return new Response(JSON.stringify({ ok: true, checks }), { headers: JSON_HEADERS });
      }

      // Step 1b-6: WORKER_LOGS_PATH — this Worker's own runtime logs via
      // the Cloudflare observability query API (wrangler.toml has
      // [observability.logs] enabled). Returns the last hour of events,
      // newest first, trimmed to the fields the panel renders.
      if (url.pathname === WORKER_LOGS_PATH) {
        if (!sessionCookie) return new Response(JSON.stringify({ error: 'not signed in' }), { status: 401, headers: JSON_HEADERS });
        if (!env.CF_API_KEY) return new Response(JSON.stringify({ error: 'worker logs proxy not configured (missing CF_API_KEY)' }), { status: 503, headers: JSON_HEADERS });
        try {
          const to = Date.now();
          const from = to - 3600000;
          const qBody = JSON.stringify({
            queryId: 'oz-admin-health-' + to,
            view: 'events',
            limit: 100,
            timeframe: { from, to },
            parameters: { datasets: ['cloudflare-workers'], limit: 100 },
          });
          const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/observability/telemetry/query`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${env.CF_API_KEY}`, 'Content-Type': 'application/json' },
            body: qBody,
            signal: AbortSignal.timeout(10000),
          });
          if (!res.ok) {
            return new Response(JSON.stringify({ ok: false, error: `Cloudflare responded ${res.status}` }), { status: 502, headers: JSON_HEADERS });
          }
          const b = await res.json() as {
            success?: boolean;
            result?: { events?: { events?: Array<{
              timestamp?: number;
              source?: { level?: string; message?: string };
              $workers?: { event?: { outcome?: string; request?: { url?: string; method?: string }; response?: { status?: number } } };
            }> } };
          };
          if (!b.success) {
            return new Response(JSON.stringify({ ok: false, error: 'Cloudflare telemetry query failed' }), { status: 502, headers: JSON_HEADERS });
          }
          const evs = b.result?.events?.events ?? [];
          const events = evs
            .map(e => ({
              ts: new Date(Number(e.timestamp) || 0).toISOString(),
              level: String(e.source?.level ?? 'info'),
              message: String(e.source?.message ?? ''),
              outcome: String(e.$workers?.event?.outcome ?? ''),
              status: Number(e.$workers?.event?.response?.status ?? 0) || 0,
            }))
            .filter(e => e.ts !== '1970-01-01T00:00:00.000Z')
            .sort((a, c) => c.ts.localeCompare(a.ts))
            .slice(0, 100);
          return new Response(JSON.stringify({ ok: true, events }), { headers: JSON_HEADERS });
        } catch {
          return new Response(JSON.stringify({ ok: false, error: 'could not reach Cloudflare' }), { status: 502, headers: JSON_HEADERS });
        }
      }

      // Step 1b-7: TRAFFIC_PATH — requests + errors per minute for the
      // last 24h from the Workers GraphQL analytics dataset. The worker
      // aggregates into the buckets the sparkline needs.
      if (url.pathname === TRAFFIC_PATH) {
        if (!sessionCookie) return new Response(JSON.stringify({ error: 'not signed in' }), { status: 401, headers: JSON_HEADERS });
        if (!env.CF_API_KEY) return new Response(JSON.stringify({ error: 'traffic proxy not configured (missing CF_API_KEY)' }), { status: 503, headers: JSON_HEADERS });
        try {
          const nowIso = new Date().toISOString().slice(0, 19) + 'Z';
          const fromIso = new Date(Date.now() - 86400000).toISOString().slice(0, 19) + 'Z';
          const gql = {
            query: 'query($acct:String!,$script:String!,$from:Time!,$to:Time!){viewer{accounts(filter:{accountTag:$acct}){workersInvocationsAdaptive(limit:10000,filter:{scriptName:$script,datetime_geq:$from,datetime_leq:$to},orderBy:[datetimeMinute_ASC]){sum{requests errors}dimensions{datetimeMinute}}}}}',
            variables: { acct: env.CLOUDFLARE_ACCOUNT_ID ?? '', script: CF_SCRIPT_NAME, from: fromIso, to: nowIso },
          };
          const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
            method: 'POST',
            headers: { Authorization: `Bearer ${env.CF_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(gql),
            signal: AbortSignal.timeout(10000),
          });
          if (!res.ok) {
            return new Response(JSON.stringify({ ok: false, error: `Cloudflare responded ${res.status}` }), { status: 502, headers: JSON_HEADERS });
          }
          const g = await res.json() as {
            errors?: Array<{ message?: string }>;
            data?: { viewer?: { accounts?: Array<{ workersInvocationsAdaptive?: Array<{ sum?: { requests?: number; errors?: number }; dimensions?: { datetimeMinute?: string } }> }> } };
          };
          if (g.errors && g.errors.length > 0) {
            const msg = g.errors[0].message ? `: ${g.errors[0].message}` : '';
            return new Response(JSON.stringify({ ok: false, error: `Cloudflare analytics error${msg}` }), { status: 502, headers: JSON_HEADERS });
          }
          const rows = g.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];
          const buckets = rows.map(r => ({
            t: String(r.dimensions?.datetimeMinute ?? ''),
            req: Number(r.sum?.requests ?? 0),
            err: Number(r.sum?.errors ?? 0),
          })).filter(b => b.t);
          return new Response(JSON.stringify({ ok: true, buckets }), { headers: JSON_HEADERS });
        } catch {
          return new Response(JSON.stringify({ ok: false, error: 'could not reach Cloudflare' }), { status: 502, headers: JSON_HEADERS });
        }
      }

      // Step 1c: Logout — clear the httpOnly cookie and redirect to the
      // login page. The cookie is HttpOnly so page JS cannot delete it;
      // the Worker must expire it here (Max-Age=0). The SPA's Log out
      // button navigates to this endpoint.
      if (url.pathname === LOGOUT_PATH) {
        // Redirect to the same subdomain (admin/dashboard), so the login
        // page is served through the Worker with the /api/v1/ proxy — the
        // login.js uses relative API (API='') which requires the proxy on
        // the same host. The marketing host (kasir.mu) does NOT have it.
        const loginUrl = hostname === 'admin.kasir.mu'
          ? 'https://admin.kasir.mu/'
          : `https://${MARKETING_HOST}/en/login`;
        return new Response(null, {
          status: 302,
          headers: {
            Location: loginUrl,
            'Set-Cookie': `${COOKIE_NAME}=; Domain=${hostname}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            'Referrer-Policy': 'no-referrer',
            'Pragma': 'no-cache',
          },
        });
      }

      // Step 2: No session cookie — serve dedicated login page on the same
      // subdomain (admin.kasir.mu → /admin/login, dashboard.kasir.mu
      // → /dashboard/login), so the login.js relative API calls go through
      // the Worker's /api/v1/ proxy. The marketing host has no proxy.
      if (!sessionCookie) {
        if (hostname === 'admin.kasir.mu') {
          const isStatic = /\.(css|js|svg|png|jpg|jpeg|webp|gif|ico|woff2?|ttf|map)$/i.test(url.pathname);
          if (isStatic) {
            const asset = new URL(request.url);
            asset.hostname = MARKETING_HOST;
            return env.ASSETS.fetch(new Request(asset.toString(), request));
          }
          // R4: the login page is served only for the login entry points.
          // Anything else used to be answered with the login page at a 200,
          // which made admin.kasir.mu a soft-404 — an unbounded URL space of
          // byte-identical HTML. Redirect to the login URL instead, so the
          // host has exactly one 200 URL. See ADMIN_LOGIN_ENTRY_PATHS.
          if (!ADMIN_LOGIN_ENTRY_PATHS.has(url.pathname)) {
            return new Response(null, {
              status: 302,
              headers: {
                Location: ADMIN_LOGIN_PATH,
                'Cache-Control': 'no-store',
                'Referrer-Policy': 'no-referrer',
              },
            });
          }
          const rewritten = new URL(request.url);
          rewritten.hostname = MARKETING_HOST;
          rewritten.pathname = ADMIN_LOGIN_PATH;
          rewritten.search = '';
          return withStrictCSP(await env.ASSETS.fetch(new Request(rewritten.toString(), request)));
        }
        const redirectTo = `${url.pathname}${url.search}`;
        const loginUrl = `https://${MARKETING_HOST}/en/login?redirect=${encodeURIComponent(redirectTo)}`;
        return new Response(null, {
          status: 302,
          headers: { Location: loginUrl },
        });
      }

      // Step 3: Cookie present — only admin.kasir.mu reaches here now.
      // Rewrite the request path to /admin/* so ASSETS returns the admin SPA.
      const rewritten = new URL(request.url);
      rewritten.hostname = MARKETING_HOST;
      const p = url.pathname;
      const isAsset = /\.(css|js|svg|png|jpg|jpeg|webp|gif|ico|woff2?|ttf|map)$/i.test(p);
      // Static assets carry their correct /admin/* path already. Only prepend /admin for HTML paths.
      rewritten.pathname = isAsset ? p : (p === '/' || !p.startsWith('/admin') ? '/admin' + p : p);
      rewritten.search = isAsset ? url.search : '';
      const spaResp = await env.ASSETS.fetch(new Request(rewritten.toString(), request));
      return withStrictCSP(spaResp);
    }

    // ── Marketing site (kasir.mu) — no auth required ───────────
    // Serve the runtime config, contact form API, static assets, plus the
    // account-portal session endpoints (R1): the account dashboard reads
    // its session from the httpOnly cookie instead of XSS-readable
    // sessionStorage, so the Worker must expose /__oz/session and
    // /__oz/logout on the marketing host too (the account portal lives at
    // kasir.mu/en/account).

    // The admin SPA's assets live under /admin/* ON THE MARKETING HOST (the
    // admin gate rewrites admin.kasir.mu → MARKETING_HOST/admin/*), which
    // leaves https://kasir.mu/admin/login publicly reachable — and it is a
    // dead form there. login.js sees a *.kasir.mu host, sets API='' and POSTs
    // relative /api/v1/..., but the /api/v1/ proxy is gated to DASHBOARD_HOSTS,
    // so every submit 404s. B24 fixed only the *redirect* onto this host; this
    // closes the remaining hole by sending the page itself to the host that
    // owns the proxy. The admin host's own asset loads call env.ASSETS.fetch
    // directly (a binding call, not this handler), so they are unaffected.
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: `https://admin.kasir.mu${url.pathname}${url.search}`,
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        },
      });
    }

    // One-time exchange code (hardening F1, R1): the login page
    // authenticates, gets a short-lived single-use code via
    // /exchange-issue, and redirects to the account portal with ?code=<code>.
    // The Worker POSTs the code to /exchange-consume to receive the real
    // session token, sets the httpOnly cookie on the marketing host, and
    // redirects to a clean URL. The real session token never appears in a
    // URL. Guarded to 48-hex exchange codes so a coincidental `code` query
    // param on other marketing pages (search, docs) is never misread.
    const codeParam = url.searchParams.get('code');
    if (codeParam && /^[0-9a-f]{48}$/.test(codeParam)) {
      url.searchParams.delete('code');
      const cleanUrl = url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '');
      const apiUrl = (env.LICENSE_API_URL ?? 'https://license.kasir.mu') + '/api/v1/web/exchange-consume';
      try {
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: codeParam }),
        });
        if (res.status === 200) {
          const body = await res.json() as { token?: string };
          if (body.token) {
            return new Response(null, {
              status: 302,
              headers: {
                Location: cleanUrl,
                'Set-Cookie': setCookieHeader(body.token, 30 * 24 * 3600, hostname),
                'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
                'Referrer-Policy': 'no-referrer',
                'Pragma': 'no-cache',
              },
            });
          }
        }
      } catch {
        // Exchange failed — fall through to the login redirect below.
      }
      // Code invalid or exchange failed — redirect to login so the user
      // re-authenticates (never left on a broken state).
      return new Response(null, {
        status: 302,
        headers: { Location: `https://${MARKETING_HOST}/en/login`, 'Cache-Control': 'no-store' },
      });
    }

    // /__oz/session — expose the httpOnly cookie token same-origin so the
    // account dashboard can authenticate to the license API with a Bearer
    // header without ever holding the token in JS-readable storage.
    if (url.pathname === SESSION_PATH) {
      const sessionCookie = getCookieWithLegacy(request.headers, COOKIE_NAME, LEGACY_COOKIE_NAME);
      // 200 {token:null} when signed out — see the dashboard-host note above:
      // a 401 here would be a console error on every page of the site.
      return new Response(JSON.stringify({ token: sessionCookie ?? null }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    // /__oz/logout — clear the httpOnly cookie and redirect to login. The
    // cookie is HttpOnly so page JS cannot delete it; the Worker must
    // expire it here (Max-Age=0).
    if (url.pathname === LOGOUT_PATH) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: `https://${MARKETING_HOST}/en/login`,
          'Set-Cookie': `${COOKIE_NAME}=; Domain=${hostname}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Referrer-Policy': 'no-referrer',
          'Pragma': 'no-cache',
        },
      });
    }

    // Serve the runtime config. no-store: the value can change (a var edit)
    // without a new bundle, so a cached stale config would defeat the point.
    if (url.pathname === RUNTIME_CONFIG_PATH) {
      const body = `window.__OZ_CONFIG__=${JSON.stringify({
        licenseApiUrl: env.LICENSE_API_URL ?? null,
        contactEndpoint: '/api/contact',
      })};window.dispatchEvent(new Event(${JSON.stringify(RUNTIME_CONFIG_EVENT)}));`;
      return new Response(body, {
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    // Contact form → Discord webhook. The webhook URL is a Worker secret
    // so it never reaches the browser. The form sends { name, email, message }.
    if (url.pathname === '/api/contact') {
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };
      // Handle preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
      }
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      try {
        const body = await request.json() as { name?: string; email?: string; message?: string };
        const { name, email, message } = body;
        if (!name || !email || !message) {
          return new Response(JSON.stringify({ error: 'Missing fields' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        if (!env.CONTACT_WEBHOOK_URL) {
          return new Response(JSON.stringify({ error: 'Webhook not configured' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        // Format Discord embed. WEB-4: every embed field is capped —
        // Discord rejects embeds whose field values exceed 1024 chars,
        // so unbounded name/email input would turn a valid support
        // message into a 502. (Abuse/rate-limiting for this endpoint is
        // handled at the edge: a Cloudflare WAF rate-limit rule on
        // /api/contact — see the runbook; the Worker itself stays
        // stateless.)
        const embed = {
          title: '📩 New Support Message',
          fields: [
            { name: 'Name', value: name.slice(0, 100), inline: true },
            { name: 'Email', value: email.slice(0, 200), inline: true },
            { name: 'Message', value: message.slice(0, 1024) },
          ],
          color: 0x147efb, // kasir.mu blue
          timestamp: new Date().toISOString(),
        };
        const discordRes = await fetch(env.CONTACT_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ embeds: [embed] }),
        });
        if (!discordRes.ok) {
          return new Response(JSON.stringify({ error: 'Discord send failed' }), {
            status: 502,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid request' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // Everything else: serve the static site (the assets binding honors
    // public/_headers and public/_redirects).
    return serveStatic(request, env);
  },
};