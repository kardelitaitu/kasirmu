/**
 * Where keyboard focus goes when the client router swaps the page.
 *
 * `SiteHead.astro` renders Astro's `<ClientRouter />`, so every same-origin
 * link on the site is an in-page swap rather than a document load — and a
 * swap does not touch focus at all. The element the visitor activated is
 * removed by the swap (it belonged to the old page), so focus fell to
 * `<body>`: the next Tab restarted at the top of the document, on the skip
 * link, and the visitor's place was gone. Measured in a browser 2026-09-23 at
 * 390px and 1440px, en and id, on a locale switch, a docs sidebar link and a
 * content link: every one landed on BODY, and the following Tab reached the
 * skip link.
 *
 * The new page's `<h1>` is the target — it names the page the visitor just
 * arrived at, and the ring it paints is one line of text rather than a box
 * around the whole content area. `tabindex="-1"` makes it focusable without
 * adding a tab stop (the heading is already in the document; this only lets it
 * receive focus). Pages without a heading in `<main>` fall back to the `main`
 * landmark, and a page with neither is left alone.
 *
 * Deliberately NOT done on a first load: the swap event does not fire for one,
 * and moving focus on arrival would make a screen reader announce the page
 * twice. `preventScroll` leaves the router's own scroll restoration in charge.
 */

/** Guards against a second listener when the initializer runs twice. */
let routeFocusBound = false;

/** The element a swap should hand focus to: the page heading, else `main`. */
export function routeFocusTarget(doc: Document): HTMLElement | null {
  return (
    doc.querySelector<HTMLElement>('main h1') ??
    doc.querySelector<HTMLElement>('main') ??
    null
  );
}

/** Focus `routeFocusTarget` after every client-router swap. Idempotent. */
export function initRouteFocus(): void {
  if (typeof document === 'undefined' || routeFocusBound) return;
  routeFocusBound = true;
  document.addEventListener('astro:after-swap', () => {
    const target = routeFocusTarget(document);
    if (!target) return;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });
}
