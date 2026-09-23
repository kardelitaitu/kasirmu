// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initRouteFocus, routeFocusTarget } from '../route-focus';

/**
 * A client-router swap replaces the page and never touches focus, so the link
 * that was activated goes with the old page and focus falls to <body> —
 * measured in a browser 2026-09-23 at 390px and 1440px, en and id: a locale
 * switch, a docs sidebar link and a content link all landed on BODY, and the
 * next Tab reached the skip link (top of the document).
 */

const SITE_HEAD_SRC = readFileSync(join(import.meta.dirname, '../../components/SiteHead.astro'), 'utf-8');

function page(inner: string): void {
  document.body.innerHTML = `<main id="main">${inner}</main>`;
}

/** Fire the swap the way Astro's ClientRouter does. */
function swap(): void {
  document.dispatchEvent(new Event('astro:after-swap'));
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('route focus after a client-router swap', () => {
  it('focuses the new page heading', () => {
    initRouteFocus();
    page('<h1>Offline mode</h1><p>Content</p>');
    swap();

    const heading = document.querySelector('h1') as HTMLElement;
    expect(document.activeElement).toBe(heading);
  });

  it('makes the heading focusable without adding a tab stop', () => {
    initRouteFocus();
    page('<h1>Offline mode</h1>');
    swap();

    expect(document.querySelector('h1')?.getAttribute('tabindex')).toBe('-1');
  });

  it('falls back to the main landmark when a page has no heading in main', () => {
    initRouteFocus();
    page('<p>Content with no heading</p>');
    swap();

    expect(document.activeElement).toBe(document.querySelector('main'));
  });

  it('leaves a first load alone — the swap event is what triggers it', () => {
    initRouteFocus();
    const previous = document.createElement('button');
    page('<h1>Offline mode</h1>');
    document.body.appendChild(previous);
    previous.focus();
    // No swap: a first load must not move focus, or a screen reader would
    // announce the page twice.
    expect(document.activeElement).toBe(previous);
  });

  it('does nothing on a page with neither a heading nor a main landmark', () => {
    initRouteFocus();
    document.body.innerHTML = '<div>bare</div>';
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.focus();
    swap();

    expect(document.activeElement).toBe(btn);
  });

  it('picks the heading in main, not a heading in the chrome', () => {
    initRouteFocus();
    document.body.innerHTML = '<header><h1>kasir.mu</h1></header><main id="main"><h1>Pricing</h1></main>';
    expect(routeFocusTarget(document)?.textContent).toBe('Pricing');
  });
});

describe('the router’s owner wires the rule', () => {
  // SiteHead.astro is what renders <ClientRouter />, so it is what must run the
  // rule; the layout cannot be rendered by vitest, so this reads the source.
  it('SiteHead imports and calls initRouteFocus', () => {
    expect(SITE_HEAD_SRC).toContain("import { initRouteFocus } from '../lib/route-focus'");
    expect(SITE_HEAD_SRC).toContain('initRouteFocus();');
  });

  it('SiteHead is the component that renders the client router', () => {
    expect(SITE_HEAD_SRC).toContain("from 'astro:transitions'");
    expect(SITE_HEAD_SRC).toContain('<ClientRouter />');
  });
});
