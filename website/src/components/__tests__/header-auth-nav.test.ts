// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { updateAuthNav, initHeaderNav } from '../../lib/header-nav';

/**
 * Header auth-nav: swaps login buttons between "Sign in" → /login and
 * "Account" → /account.
 *
 * The logic lives in src/lib/header-nav.ts and resolves signed-in state
 * cookie-first through src/lib/session.ts (`hasSession`). Reading
 * sessionStorage directly broke for a cookie-only session in a new tab, so
 * these tests pin the shared-helper wiring and the cookie-only case.
 *
 * `initHeaderNav` is the wiring Header.astro loads; `updateAuthNav` is the DOM
 * swap these behavior tests drive directly.
 */

const COMPONENTS_DIR = join(import.meta.dirname, '..');
const HEADER_SRC = readFileSync(join(COMPONENTS_DIR, 'Header.astro'), 'utf-8');
const NAV_SRC = readFileSync(join(COMPONENTS_DIR, '..', 'lib', 'header-nav.ts'), 'utf-8');

/** Let the async hasSession()/updateAuthNav() microtasks settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function buildHeaderDOM(): HTMLElement {
  const header = document.createElement('header');

  const desktopLink = document.createElement('a');
  desktopLink.setAttribute('data-auth-nav', '');
  desktopLink.setAttribute('data-locale', 'en');
  desktopLink.setAttribute('data-login-text', 'Sign in');
  desktopLink.setAttribute('data-account-text', 'Account');
  desktopLink.href = '/en/login';
  desktopLink.textContent = 'Sign in';
  header.appendChild(desktopLink);

  const mobileLink = document.createElement('a');
  mobileLink.setAttribute('data-auth-nav', '');
  mobileLink.setAttribute('data-locale', 'id');
  mobileLink.setAttribute('data-login-text', 'Masuk');
  mobileLink.setAttribute('data-account-text', 'Akun');
  mobileLink.href = '/id/login';
  mobileLink.textContent = 'Masuk';
  header.appendChild(mobileLink);

  return header;
}

// ─── Source structure tests ──────────────────────────────────────────

describe('Header source structure', () => {
  it('delegates to the shared header-nav module instead of inlining the logic', () => {
    expect(HEADER_SRC).toContain("from '../lib/header-nav'");
    expect(HEADER_SRC).toContain('initHeaderNav');
  });

  it('no longer reads sessionStorage directly (single session owner)', () => {
    expect(HEADER_SRC).not.toContain("sessionStorage.getItem('oz_session')");
    expect(NAV_SRC).not.toContain("sessionStorage.getItem('oz_session')");
  });

  it('queries data-auth-nav elements', () => {
    expect(NAV_SRC).toContain('[data-auth-nav]');
  });

  it('sets href to /account when authenticated', () => {
    expect(NAV_SRC).toContain('/account');
  });

  it('sets href to /login when unauthenticated', () => {
    expect(NAV_SRC).toContain('/login');
  });

  it('uses data-account-text / data-login-text / data-locale attributes', () => {
    expect(NAV_SRC).toContain('data-account-text');
    expect(NAV_SRC).toContain('data-login-text');
    expect(NAV_SRC).toContain('data-locale');
  });

  it('registers astro:page-load, astro:after-swap and storage listeners', () => {
    expect(NAV_SRC).toContain('astro:page-load');
    expect(NAV_SRC).toContain('astro:after-swap');
    expect(NAV_SRC).toContain("window.addEventListener('storage'");
  });

  it('resolves session state through the shared cookie-first helper', () => {
    expect(NAV_SRC).toContain("from './session'");
    expect(NAV_SRC).toContain('hasSession');
  });

  it('has mobile menu close-on-click handler', () => {
    expect(NAV_SRC).toContain('details.removeAttribute');
  });
});

// ─── Auth nav behavior tests ─────────────────────────────────────────

describe('Header auth nav behavior', () => {
  let header: HTMLElement;
  let desktopLink: HTMLAnchorElement;
  let mobileLink: HTMLAnchorElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
    // Default no-Worker state: the relative /__oz/session fetch rejects, so
    // hasSession falls back to sessionStorage. Cookie-only tests override.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no worker')));
    header = buildHeaderDOM();
    document.body.appendChild(header);
    desktopLink = header.querySelectorAll('[data-auth-nav]')[0] as HTMLAnchorElement;
    mobileLink = header.querySelectorAll('[data-auth-nav]')[1] as HTMLAnchorElement;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    document.body.innerHTML = '';
  });

  it('shows "Sign in" when no session exists', async () => {
    await updateAuthNav();
    expect(desktopLink.textContent).toBe('Sign in');
  });

  it('points to /login when no session exists', async () => {
    await updateAuthNav();
    expect(desktopLink.getAttribute('href')).toBe('/en/login');
  });

  it('shows localized login text for Indonesian locale', async () => {
    await updateAuthNav();
    expect(mobileLink.textContent).toBe('Masuk');
    expect(mobileLink.getAttribute('href')).toBe('/id/login');
  });

  it('shows "Account" when a sessionStorage session exists', async () => {
    sessionStorage.setItem('oz_session', 'some-session-id');
    await updateAuthNav();
    expect(desktopLink.textContent).toBe('Account');
    expect(desktopLink.getAttribute('href')).toBe('/en/account');
  });

  it('shows "Account" for a cookie-only session with empty sessionStorage', async () => {
    // The regression: a user signed in via the httpOnly cookie opening the
    // site in a new tab has an empty per-tab sessionStorage but a valid
    // cookie. The header must read the cookie-first helper, not storage.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: 'cookie.token' }),
    }));
    expect(sessionStorage.getItem('oz_session')).toBeNull();
    await updateAuthNav();
    expect(desktopLink.textContent).toBe('Account');
    expect(desktopLink.getAttribute('href')).toBe('/en/account');
    expect(mobileLink.textContent).toBe('Akun');
    expect(mobileLink.getAttribute('href')).toBe('/id/account');
  });

  it('switches from account to login when the session is cleared', async () => {
    sessionStorage.setItem('oz_session', 'existing-session');
    await updateAuthNav();
    expect(desktopLink.textContent).toBe('Account');

    sessionStorage.removeItem('oz_session');
    await updateAuthNav();
    expect(desktopLink.textContent).toBe('Sign in');
    expect(desktopLink.getAttribute('href')).toBe('/en/login');
  });

  it('treats an empty session string as unauthenticated', async () => {
    sessionStorage.setItem('oz_session', '');
    await updateAuthNav();
    expect(desktopLink.textContent).toBe('Sign in');
  });

  it('falls back to "Account" when data-account-text is missing', async () => {
    desktopLink.removeAttribute('data-account-text');
    sessionStorage.setItem('oz_session', 'session');
    await updateAuthNav();
    expect(desktopLink.textContent).toBe('Account');
  });

  it('falls back to "Sign in" when data-login-text is missing', async () => {
    desktopLink.removeAttribute('data-login-text');
    await updateAuthNav();
    expect(desktopLink.textContent).toBe('Sign in');
  });

  it('falls back to "en" locale when data-locale is missing', async () => {
    desktopLink.removeAttribute('data-locale');
    sessionStorage.setItem('oz_session', 'session');
    await updateAuthNav();
    expect(desktopLink.getAttribute('href')).toBe('/en/account');
  });

  it('updates all auth-nav links at once', async () => {
    sessionStorage.setItem('oz_session', 'session');
    await updateAuthNav();
    expect(desktopLink.textContent).toBe('Account');
    expect(mobileLink.textContent).toBe('Akun');
  });

  it('initHeaderNav resolves the nav on load', async () => {
    sessionStorage.setItem('oz_session', 'session');
    initHeaderNav();
    await flush();
    expect(desktopLink.textContent).toBe('Account');
  });

  it('closes mobile menu when a link inside details.group is clicked', () => {
    const details = document.createElement('details');
    details.className = 'group';
    details.setAttribute('open', '');
    const link = document.createElement('a');
    link.href = '/en/features';
    link.textContent = 'Features';
    details.appendChild(link);
    header.appendChild(details);

    initHeaderNav();
    link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(details.hasAttribute('open')).toBe(false);
  });

  it('does not close details when clicking outside details.group', () => {
    const details = document.createElement('details');
    details.className = 'other';
    details.setAttribute('open', '');
    const link = document.createElement('a');
    link.href = '/en/features';
    details.appendChild(link);
    header.appendChild(details);

    initHeaderNav();
    link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(details.hasAttribute('open')).toBe(true);
  });
});

// ─── i18n key tests ──────────────────────────────────────────────────

describe('Header i18n keys', () => {
  const enJson = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', '..', 'i18n', 'en.json'), 'utf-8'),
  );
  const idJson = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', '..', 'i18n', 'id.json'), 'utf-8'),
  );

  it('en has nav.login', () => {
    expect(enJson.nav?.login).toBeTruthy();
  });

  it('en has nav.account', () => {
    expect(enJson.nav?.account).toBeTruthy();
  });

  it('id has nav.login', () => {
    expect(idJson.nav?.login).toBeTruthy();
  });

  it('id has nav.account', () => {
    expect(idJson.nav?.account).toBeTruthy();
  });

  it('en and id login texts differ (translated)', () => {
    expect(enJson.nav.login).not.toBe(idJson.nav.login);
  });

  it('en and id account texts differ (translated)', () => {
    expect(enJson.nav.account).not.toBe(idJson.nav.account);
  });

  it('en has nav.home', () => {
    expect(enJson.nav?.home).toBeTruthy();
  });

  it('en has nav.features', () => {
    expect(enJson.nav?.features).toBeTruthy();
  });

  it('en has nav.pricing', () => {
    expect(enJson.nav?.pricing).toBeTruthy();
  });

  it('en has nav.download', () => {
    expect(enJson.nav?.download).toBeTruthy();
  });

  it('en has nav.support', () => {
    expect(enJson.nav?.support).toBeTruthy();
  });

  it('en has nav.docs', () => {
    expect(enJson.nav?.docs).toBeTruthy();
  });
});
