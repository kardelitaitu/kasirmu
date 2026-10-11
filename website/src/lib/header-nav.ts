/**
 * Header client-side auth nav.
 *
 * Owns the swap between "Sign in" → /login and "Account" → /account for every
 * `[data-auth-nav]` link, plus the dismissal behavior of both header menus:
 * close-on-link-click for the mobile menu, Escape and outside-press for it too,
 * and the Solutions disclosure in `initSolutionsDisclosure`.
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
import { getCachedHasSession, hasSession } from './session';

/**
 * How long a hover-opened Solutions panel stays open after the pointer leaves.
 *
 * The panel sits 8px below its trigger (`top-full mt-2`), so the pointer has to
 * cross a gap that belongs to neither element. The panel's own
 * `transition-all duration-200` already holds `visibility` for the length of
 * the fade, so matching that duration keeps the mouse behaviour unchanged.
 */
export const HOVER_CLOSE_MS = 200;

/**
 * Point every `[data-auth-nav]` link at login or account for its locale.
 *
 * Each attribute is only written when it disagrees with what is already on the
 * element. That keeps this idempotent against a freshly swapped-in header —
 * the router rebuilds the markup every navigation — and makes the async
 * revalidate a no-op when the answer has not changed, so the label is never
 * rewritten (and never re-laid-out) without cause.
 */
function applyAuthNav(isAuth: boolean): void {
  const loginLinks = document.querySelectorAll<HTMLAnchorElement>('[data-auth-nav]');
  loginLinks.forEach((link) => {
    const loc = link.getAttribute('data-locale') || 'en';
    const href = isAuth ? `/${loc}/account` : `/${loc}/login`;
    const text = isAuth
      ? link.getAttribute('data-account-text') || 'Account'
      : link.getAttribute('data-login-text') || 'Sign in';
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
    if (link.textContent !== text) link.textContent = text;
  });
}

/** Resolve the session and bring the auth links in line with it. */
export async function updateAuthNav(): Promise<void> {
  applyAuthNav(await hasSession());
}

/**
 * Paint the auth links from the last resolved session state, synchronously.
 *
 * This is the flicker fix. A client-router swap replaces the header with fresh
 * server markup, which always ships the signed-out label; `updateAuthNav()`
 * then waits a full `/__oz/session` round trip before correcting it, and the
 * browser paints the wrong label in between. `astro:after-swap` runs before
 * that paint, so applying the cached answer here puts the correct label on
 * screen in the swap's own frame and the correction never becomes visible.
 *
 * Synchronous and void on purpose — an `await` here would reintroduce the gap.
 * Does nothing until a session has resolved once, which is only the first
 * page view: its label genuinely cannot be known before the round trip.
 */
export function paintCachedAuthNav(): void {
  const cached = getCachedHasSession();
  if (cached === null) return;
  applyAuthNav(cached);
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
 * the state the panel is actually in. Hover still opens it for mouse users,
 * and a click that lands on a hover-opened panel pins it rather than closing
 * it — see the `openedByHover` note in `initSolutionsDisclosure`.
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
    /**
     * The panel is open because the pointer moved onto the trigger, and the
     * click that follows has not happened yet.
     *
     * A mouse click is always preceded by `pointerenter`, so the plain toggle
     * closed the panel the user was reaching for: hover opened it, the click
     * shut it, and `aria-expanded` went back to `false` (measured in a browser
     * 2026-09-23 — hover open, click hidden). The first click after a
     * hover-open now PINS the panel and the click after that closes it, which
     * is what a mouse user expects from a click on the trigger, while touch
     * (no mouse pointerenter) and keyboard (no pointer at all) keep the plain
     * toggle.
     */
    let openedByHover = false;

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
      openedByHover = false;
    };
    const isOpen = (): boolean => trigger.getAttribute('aria-expanded') === 'true';

    trigger.addEventListener('click', () => {
      if (isOpen() && openedByHover) {
        openedByHover = false;
        return;
      }
      if (isOpen()) close();
      else open();
    });

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
      if ((event as PointerEvent).pointerType !== 'mouse') return;
      openedByHover = true;
      open();
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

let mobileMenuDismissalBound = false;

/** Close every open header `<details>`; returns the first one closed, if any. */
function closeOpenHeaderMenus(): HTMLDetailsElement | null {
  const open = Array.from(document.querySelectorAll<HTMLDetailsElement>('header details[open]'));
  open.forEach((details) => details.removeAttribute('open'));
  return open[0] ?? null;
}

/**
 * Escape closes the mobile menu and puts focus back on the summary that opened
 * it, so the keyboard user is not dropped at the top of the document.
 */
export function onMobileMenuKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  const closed = closeOpenHeaderMenus();
  closed?.querySelector<HTMLElement>('summary')?.focus();
}

/**
 * A press outside the panel dismisses it. A press inside it — following a link —
 * does not: the link's own close-on-click handling owns that case.
 */
export function onMobileMenuPointerDown(event: Event): void {
  const open = document.querySelectorAll<HTMLDetailsElement>('header details[open]');
  if (open.length === 0) return;
  const target = event.target as Node | null;
  for (const details of Array.from(open)) {
    if (target && details.contains(target)) return;
  }
  closeOpenHeaderMenus();
}

/**
 * Dismiss the mobile menu on Escape and on a press outside it.
 *
 * The hamburger is a native `<details>`, which is deliberate — it opens with no
 * JavaScript at all — but a native disclosure closes only when its own
 * `<summary>` is activated. Measured in a browser at 390px on 2026-09-23: an
 * open panel survived Escape and a press on the page beside it, so the menu
 * stayed over the content and the press went to whatever sat behind it — the
 * visitor's only way out was to find the summary again. Both dismissals are
 * delegated on `document`, once, because a ClientRouter navigation swaps the
 * header and delegated listeners need no rebinding on the new elements.
 */
export function initMobileMenuDismissal(): void {
  if (mobileMenuDismissalBound) return;
  mobileMenuDismissalBound = true;
  document.addEventListener('keydown', onMobileMenuKeydown);
  document.addEventListener('pointerdown', onMobileMenuPointerDown);
}

/**
 * Wire the header once per page: initial resolve, re-resolve on every SPA swap,
 * cross-tab storage sync, close the mobile menu when a link inside it is
 * clicked, and (re)bind the Solutions disclosure for the swapped-in header.
 *
 * There is deliberately NO `astro:page-load` listener. `initHeaderNav()` itself
 * covers the first page view (the script runs at execution, so an initial-load
 * listener is a second call for the same page), and `astro:after-swap` covers
 * every navigation. Listening to both fired `updateAuthNav()` twice per view:
 * measured 2026-10-12, a fast `/__oz/session` cost 2 probes on first load and
 * 1-or-2 per navigation, because the dedupe in `session.ts` only collapses
 * CONCURRENT probes. Dropping it makes the cost a deterministic 1 without
 * introducing any staleness window, which a short-lived cache would have.
 */
export function initHeaderNav(): void {
  void updateAuthNav();
  initSolutionsDisclosure();
  initMobileMenuDismissal();
  document.addEventListener('astro:after-swap', () => {
    // Order matters and must not change: paint the known answer first, in this
    // handler's own synchronous turn, then revalidate. Awaiting before the
    // paint is exactly what let the signed-out label show for ~160ms.
    paintCachedAuthNav();
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
