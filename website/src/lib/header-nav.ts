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

/**
 * How long a hover-opened Solutions panel stays open after the pointer leaves.
 *
 * The panel sits 8px below its trigger (`top-full mt-2`), so the pointer has to
 * cross a gap that belongs to neither element. The panel's own
 * `transition-all duration-200` already holds `visibility` for the length of
 * the fade, so matching that duration keeps the mouse behaviour unchanged.
 */
export const HOVER_CLOSE_MS = 200;

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
 * Make the desktop "Solutions" panel a real disclosure.
 *
 * It used to open on CSS `:hover` alone: the trigger did nothing when clicked,
 * the panel was `visibility: hidden` so its eight links were NOT focusable, and
 * `aria-expanded` stayed `false` even while hover held the panel open. A
 * keyboard user therefore could not reach any of those destinations from the
 * nav — `/restaurant`, `/cafe`, `/minimarket`, `/warung`, `/warehouse`,
 * `/docs/inventory`, `/docs/shifts`, `/docs/cloud-sync` — and assistive tech
 * was told the panel was closed while it was on screen.
 *
 * Now: the trigger opens and closes it (Enter/Space are a native button click),
 * Escape closes it and returns focus to the trigger, focus leaving the group
 * closes it, an outside pointer press closes it, and `aria-expanded` reflects
 * the state the panel is actually in. Hover still opens it for mouse users.
 *
 * Bound per element with a guard rather than delegated, because ClientRouter
 * swaps the header on every client-side navigation and the new elements need
 * their own listeners. `initHeaderNav` re-runs this after a swap.
 */
export function initSolutionsDisclosure(): void {
  const groups = document.querySelectorAll<HTMLElement>('[data-solutions]');
  groups.forEach((group) => {
    if (group.dataset.solutionsBound === 'true') return;
    const trigger = group.querySelector<HTMLButtonElement>('[data-solutions-trigger]');
    const panel = group.querySelector<HTMLElement>('[data-solutions-panel]');
    if (!trigger || !panel) return;
    group.dataset.solutionsBound = 'true';

    let hoverTimer: ReturnType<typeof setTimeout> | undefined;

    const open = (): void => {
      clearTimeout(hoverTimer);
      panel.classList.remove('invisible', 'opacity-0');
      panel.classList.add('visible', 'opacity-100');
      trigger.setAttribute('aria-expanded', 'true');
    };
    const close = (): void => {
      clearTimeout(hoverTimer);
      panel.classList.remove('visible', 'opacity-100');
      panel.classList.add('invisible', 'opacity-0');
      trigger.setAttribute('aria-expanded', 'false');
    };
    const isOpen = (): boolean => trigger.getAttribute('aria-expanded') === 'true';

    trigger.addEventListener('click', () => (isOpen() ? close() : open()));

    group.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !isOpen()) return;
      close();
      // Escape must not strand focus: the user is back where they started.
      trigger.focus();
    });

    group.addEventListener('focusout', (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      // `null` means focus went to nothing (body, or another tab): still leaving.
      if (!next || !group.contains(next)) close();
    });

    // Outside press closes before the click resolves, so the click is not
    // swallowed by a panel that is already disappearing. A detached group (the
    // pre-swap header) is inert and skips out.
    document.addEventListener('pointerdown', (event: Event) => {
      if (!group.isConnected || !isOpen()) return;
      if (!group.contains(event.target as Node)) close();
    });

    // Hover remains a mouse affordance. Touch is excluded deliberately: a tap
    // fires pointerenter before its click, which would open and then instantly
    // toggle the panel closed again.
    group.addEventListener('pointerenter', (event: Event) => {
      if ((event as PointerEvent).pointerType === 'mouse') open();
    });
    group.addEventListener('pointerleave', (event: Event) => {
      if ((event as PointerEvent).pointerType !== 'mouse' || !isOpen()) return;
      hoverTimer = setTimeout(close, HOVER_CLOSE_MS);
    });

    // Following a destination dismisses the disclosure, like the mobile menu.
    panel.addEventListener('click', (event: Event) => {
      if ((event.target as HTMLElement | null)?.closest('a')) close();
    });
  });
}

/**
 * Wire the header once per page: initial resolve, SPA swap/page-load re-resolve,
 * cross-tab storage sync, close the mobile menu when a link inside it is
 * clicked, and (re)bind the Solutions disclosure for the swapped-in header.
 */
export function initHeaderNav(): void {
  void updateAuthNav();
  initSolutionsDisclosure();
  document.addEventListener('astro:page-load', () => {
    void updateAuthNav();
    initSolutionsDisclosure();
  });
  document.addEventListener('astro:after-swap', () => {
    void updateAuthNav();
    initSolutionsDisclosure();
  });
  window.addEventListener('storage', () => void updateAuthNav());

  document.addEventListener('click', (e) => {
    const link = (e.target as HTMLElement | null)?.closest('details.group a');
    if (link) {
      const details = link.closest('details');
      if (details) details.removeAttribute('open');
    }
  });
}
