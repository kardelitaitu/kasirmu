/**
 * Header client-side auth nav.
 *
 * Owns the swap between "Sign in" → /login and "Account" → /account for every
 * `[data-auth-nav]` link, plus the mobile-menu close-on-link-click behavior.
 *
 * The signed-in check goes through `hasSession()` (session.ts), NOT a direct
 * sessionStorage read. sessionStorage is per-tab, so a user signed in via the
 * httpOnly cookie but opening the site in a new tab has an empty store — a
 * direct read showed them "Sign in" while they were in fact logged in. Routing
 * through the shared, cookie-first owner keeps the header in sync with the
 * checkout gate and the account portal.
 *
 * Extracted from Header.astro so it is unit-testable without executing the
 * Astro-bundled `<script>` block.
 */
import { hasSession } from './session';

/** Point every `[data-auth-nav]` link at login or account for its locale. */
export async function updateAuthNav(): Promise<void> {
  const isAuth = await hasSession();
  const loginLinks = document.querySelectorAll<HTMLAnchorElement>('[data-auth-nav]');
  loginLinks.forEach((link) => {
    const loc = link.getAttribute('data-locale') || 'en';
    if (isAuth) {
      link.href = `/${loc}/account`;
      link.textContent = link.getAttribute('data-account-text') || 'Account';
    } else {
      link.href = `/${loc}/login`;
      link.textContent = link.getAttribute('data-login-text') || 'Sign in';
    }
  });
}

/**
 * Wire the header once per page: initial resolve, SPA swap/page-load re-resolve,
 * cross-tab storage sync, and close the mobile menu when a link inside it is
 * clicked.
 */
export function initHeaderNav(): void {
  void updateAuthNav();
  document.addEventListener('astro:page-load', () => void updateAuthNav());
  document.addEventListener('astro:after-swap', () => void updateAuthNav());
  window.addEventListener('storage', () => void updateAuthNav());

  document.addEventListener('click', (e) => {
    const link = (e.target as HTMLElement | null)?.closest('details.group a');
    if (link) {
      const details = link.closest('details');
      if (details) details.removeAttribute('open');
    }
  });
}
