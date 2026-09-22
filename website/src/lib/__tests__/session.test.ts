// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EMAIL_STORAGE_KEY, getSessionToken, hasSession, SESSION_STORAGE_KEY } from '../session';

/**
 * R1 httpOnly-cookie session helper tests: getSessionToken must prefer the
 * Worker's /__oz/session cookie endpoint and fall back to sessionStorage
 * when the endpoint is absent (no-Worker dev) or returns no token.
 */

describe('getSessionToken — R1 httpOnly cookie', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('returns the token from /__oz/session when the cookie exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: 'cookie.token' }),
    }));

    expect(await getSessionToken()).toBe('cookie.token');
    expect(fetch).toHaveBeenCalledWith('/__oz/session');
  });

  it('falls back to sessionStorage when the endpoint returns no token', async () => {
    sessionStorage.setItem('oz_session', 'stored.token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ error: 'no token field' }),
    }));

    expect(await getSessionToken()).toBe('stored.token');
  });

  it('falls back to sessionStorage when the endpoint 401s', async () => {
    sessionStorage.setItem('oz_session', 'stored.token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'not signed in' }),
    }));

    expect(await getSessionToken()).toBe('stored.token');
  });

  it('falls back to sessionStorage when there is no Worker (fetch rejects)', async () => {
    sessionStorage.setItem('oz_session', 'stored.token');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no worker')));

    expect(await getSessionToken()).toBe('stored.token');
  });

  it('returns null when neither the cookie nor sessionStorage has a token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'not signed in' }),
    }));

    expect(await getSessionToken()).toBeNull();
  });

  it('collapses concurrent callers into a single /__oz/session request', async () => {
    // The header resolves the session on load and again on astro:page-load,
    // and the checkout CTA also asks — without dedupe a page fired several
    // identical probes.
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: 'cookie.token' }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const [a, b] = await Promise.all([getSessionToken(), getSessionToken()]);
    expect(a).toBe('cookie.token');
    expect(b).toBe('cookie.token');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('hasSession — cookie-first session gate', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('reports signed in from a cookie-only session with empty sessionStorage', async () => {
    // The regression: a user signed in via the httpOnly cookie, opening the
    // site in a new tab (sessionStorage is per-tab and therefore empty) must
    // still be recognized as signed in.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: 'cookie.token' }),
    }));

    expect(sessionStorage.getItem('oz_session')).toBeNull();
    expect(await hasSession()).toBe(true);
  });

  it('reports signed in from a sessionStorage-only session (no Worker)', async () => {
    sessionStorage.setItem('oz_session', 'stored.token');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no worker')));

    expect(await hasSession()).toBe(true);
  });

  it('reports signed out when neither source has a token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'not signed in' }),
    }));

    expect(await hasSession()).toBe(false);
  });
});

/**
 * The key used to be declared twice — once here, once in paddle.ts — and
 * written as a bare literal at eight call sites across AuthForm, SignupForm and
 * a hook nothing imported. These assertions are the alarm for a second spelling
 * reappearing, which is the failure that lets a writer and a reader disagree
 * about where the token lives.
 */
describe('the session storage key has exactly one owner', () => {
  const SRC = join(import.meta.dirname, '..', '..');
  const OWNER = 'lib/session.ts';

  /** Every production module, i.e. not a test file or a __tests__ directory. */
  const productionFiles = (): string[] => {
    const found: string[] = [];
    const walk = (relative: string): void => {
      for (const entry of readdirSync(join(SRC, relative), { withFileTypes: true })) {
        const path = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
          walk(path);
        } else if (/\.(ts|tsx|astro)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
          found.push(path);
        }
      }
    };
    walk('');
    return found;
  };

  it('keeps the wire format: the value is still oz_session', () => {
    // Not an implementation detail — a token the previous build wrote has to
    // keep being found, and the Worker's cookie exchange keys off the same name.
    expect(SESSION_STORAGE_KEY).toBe('oz_session');
  });

  it('is spelled as a literal in exactly one production file', () => {
    const spellers = productionFiles().filter((file) =>
      /['"]oz_session['"]/.test(readFileSync(join(SRC, file), 'utf-8')),
    );
    expect(spellers).toEqual([OWNER]);
  });

  it('is declared once, and not mirrored as a second constant', () => {
    const declarations = productionFiles().filter((file) =>
      /oz_session['"]\s*;?\s*$|=\s*['"]oz_session['"]/.test(readFileSync(join(SRC, file), 'utf-8')),
    );
    expect(declarations).toEqual([OWNER]);
  });

  it('is what every module that touches the token imports', () => {
    // The read in AuthForm is the documented exemption from cookie-first
    // resolution (it is the token THIS login just minted, not an "is the user
    // signed in?" query) — but even an exempt read must not invent its own
    // spelling of where the token lives.
    for (const file of ['components/AuthForm.tsx', 'components/SignupForm.tsx', 'components/paddle.ts']) {
      const source = readFileSync(join(SRC, file), 'utf-8');
      expect(source, `${file} reads or writes the token`).toMatch(/sessionStorage\.(get|set|remove)Item/);
      expect(source, `${file} must import the key owner`).toContain(
        file === 'components/paddle.ts'
          ? "SESSION_STORAGE_KEY } from '../lib/session'"
          : 'SESSION_STORAGE_KEY',
      );
    }
  });

  it('logout cleanup clears the same key the auth flows write', () => {
    // paddle.clearSession removing a different string than AuthForm writes
    // would leave a signed-in token behind after logout.
    const paddle = readFileSync(join(SRC, 'components/paddle.ts'), 'utf-8');
    expect(paddle).toContain('sessionStorage.removeItem(SESSION_STORAGE_KEY)');
    expect(paddle).not.toMatch(/export const SESSION_KEY/);
  });

  /**
   * The email cache has the same rule for the same reason, and had the same
   * defect: `oz_email` was declared twice (here and as `paddle.EMAIL_KEY`) and
   * written as a literal at four more sites. A reader and a writer disagreeing
   * about the key is how logout leaves the previous user's address behind for
   * checkout prefill — the tenant mix-up clearSession exists to prevent.
   */
  describe('the cached-email storage key has exactly one owner', () => {
    it('keeps the wire format: the value is still oz_email', () => {
      // An email cached by the previous build must keep being found, and
      // paddle's /me cache must write where the auth forms wrote.
      expect(EMAIL_STORAGE_KEY).toBe('oz_email');
    });

    it('is spelled as a literal exactly once in production code', () => {
      // Counting occurrences rather than files: a second constant living inside
      // the owner itself would pass a file-level check, and that is exactly the
      // shape the duplicate took here (an `EMAIL_KEY` beside the real one).
      const spellings = productionFiles().flatMap((file) =>
        Array.from(readFileSync(join(SRC, file), 'utf-8').matchAll(/['"]oz_email['"]/g), () => file),
      );
      expect(spellings).toEqual([OWNER]);
    });

    it('is what every module that touches the cached email imports', () => {
      for (const file of ['components/AuthForm.tsx', 'components/SignupForm.tsx', 'components/paddle.ts']) {
        const source = readFileSync(join(SRC, file), 'utf-8');
        expect(source, `${file} must import the key owner`).toContain('EMAIL_STORAGE_KEY');
        expect(source, `${file} must not spell the key itself`).not.toMatch(/['"]oz_email['"]/);
      }
    });
  });
});
