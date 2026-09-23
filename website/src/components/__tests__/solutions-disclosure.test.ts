// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initHeaderNav, initSolutionsDisclosure, HOVER_CLOSE_MS } from '../../lib/header-nav';

/**
 * The desktop "Solutions" disclosure.
 *
 * It used to open on CSS `:hover` alone. A keyboard pass measured the
 * consequences on the built site: the panel was `visibility: hidden`, so its
 * eight links were not focusable (a forced `.focus()` on `/en/docs/inventory/`
 * stayed on the trigger), Tab from the trigger went straight on to Pricing, and
 * `aria-expanded` stayed `"false"` while hover held the panel open — assistive
 * tech was told the opposite of what was on screen.
 *
 * The behaviour lives in src/lib/header-nav.ts so it can be driven with real
 * events here. What these tests CANNOT show is jsdom's focusability: `visibility`
 * is not implemented, so "the links are reachable" is only meaningful in a real
 * browser, where it was verified with genuine Tab presses.
 */

const COMPONENTS_DIR = join(import.meta.dirname, '..');
const HEADER_SRC = readFileSync(join(COMPONENTS_DIR, 'Header.astro'), 'utf-8');
const NAV_SRC = readFileSync(join(COMPONENTS_DIR, '..', 'lib', 'header-nav.ts'), 'utf-8');

/** The eight destinations the panel carries in production. */
const LINKS = [
  '/en/restaurant/',
  '/en/cafe/',
  '/en/minimarket/',
  '/en/warung/',
  '/en/warehouse/',
  '/en/docs/inventory/',
  '/en/docs/shifts/',
  '/en/docs/cloud-sync/',
];

/**
 * jsdom has no PointerEvent, so build a MouseEvent and give it a `pointerType`.
 * `pointerenter`/`pointerleave` do not bubble in the DOM, so they are
 * dispatched straight at the group.
 */
function pointerEvent(type: string, pointerType: string): Event {
  const bubbles = type !== 'pointerenter' && type !== 'pointerleave';
  const event = new MouseEvent(type, { bubbles, cancelable: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  return event;
}

/** `click` is what a browser delivers for Enter/Space on a <button>. */
const activate = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

/**
 * Activate an <a> without letting jsdom try to navigate (it logs a
 * "Not implemented: navigation" error for any unprevented link click). The
 * disclosure's own handler runs either way.
 */
const activateLink = (el: Element) => {
  el.addEventListener('click', (event) => event.preventDefault(), { capture: true });
  activate(el);
};

function buildDisclosure() {
  const group = document.createElement('div');
  group.setAttribute('data-solutions', '');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.setAttribute('data-solutions-trigger', '');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'solutions-panel');
  trigger.textContent = 'Solutions';
  group.appendChild(trigger);

  const panel = document.createElement('div');
  panel.id = 'solutions-panel';
  panel.setAttribute('data-solutions-panel', '');
  panel.className = 'invisible opacity-0 transition-all duration-200';
  for (const href of LINKS) {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = href;
    panel.appendChild(link);
  }
  group.appendChild(panel);

  const outside = document.createElement('a');
  outside.href = '/en/pricing/';
  outside.textContent = 'Pricing';

  document.body.append(group, outside);
  return { group, trigger, panel, outside, links: [...panel.querySelectorAll('a')] };
}

const isExpanded = (trigger: HTMLElement) => trigger.getAttribute('aria-expanded') === 'true';
const looksOpen = (panel: HTMLElement) => panel.classList.contains('visible');

let ctx: ReturnType<typeof buildDisclosure>;

beforeEach(() => {
  document.body.innerHTML = '';
  sessionStorage.clear();
  // `initHeaderNav` also resolves the auth nav, which probes the Worker; with
  // no Worker the probe rejects and the nav falls back to sessionStorage.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no worker')));
  ctx = buildDisclosure();
  initSolutionsDisclosure();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  document.body.innerHTML = '';
});

describe('Solutions disclosure — state and the trigger', () => {
  it('starts closed', () => {
    expect(isExpanded(ctx.trigger)).toBe(false);
    expect(looksOpen(ctx.panel)).toBe(false);
  });

  it('opens when the trigger is activated', () => {
    activate(ctx.trigger);
    expect(isExpanded(ctx.trigger)).toBe(true);
    expect(looksOpen(ctx.panel)).toBe(true);
    expect(ctx.panel.classList.contains('invisible')).toBe(false);
  });

  it('keeps a hover-opened panel open when the user then clicks the trigger', () => {
    // Every mouse click is preceded by pointerenter, so the plain toggle closed
    // the panel the user was reaching for — measured in a browser 2026-09-23:
    // hover opened it, the click hid it, and aria-expanded went back to false.
    ctx.group.dispatchEvent(pointerEvent('pointerenter', 'mouse'));
    expect(isExpanded(ctx.trigger)).toBe(true);

    activate(ctx.trigger);

    expect(isExpanded(ctx.trigger)).toBe(true);
    expect(looksOpen(ctx.panel)).toBe(true);
  });

  it('closes on the click after the pinning click', () => {
    ctx.group.dispatchEvent(pointerEvent('pointerenter', 'mouse'));
    activate(ctx.trigger); // pins what hover opened
    activate(ctx.trigger); // and this one closes it

    expect(isExpanded(ctx.trigger)).toBe(false);
    expect(looksOpen(ctx.panel)).toBe(false);
  });

  it('closes again on a second activation', () => {
    activate(ctx.trigger);
    activate(ctx.trigger);
    expect(isExpanded(ctx.trigger)).toBe(false);
    expect(looksOpen(ctx.panel)).toBe(false);
  });

  it('keeps aria-expanded and the panel in step through every toggle', () => {
    for (const expected of [true, false, true]) {
      activate(ctx.trigger);
      expect(isExpanded(ctx.trigger)).toBe(expected);
      expect(looksOpen(ctx.panel)).toBe(expected);
    }
  });
});

describe('Solutions disclosure — Escape', () => {
  it('closes the panel and returns focus to the trigger', () => {
    activate(ctx.trigger);
    ctx.links[0].focus();
    expect(document.activeElement).toBe(ctx.links[0]);

    ctx.links[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(isExpanded(ctx.trigger)).toBe(false);
    expect(document.activeElement).toBe(ctx.trigger);
  });

  it('ignores Escape while already closed', () => {
    ctx.trigger.focus();
    ctx.group.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(ctx.trigger);
    expect(isExpanded(ctx.trigger)).toBe(false);
  });

  it('ignores other keys', () => {
    activate(ctx.trigger);
    ctx.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(isExpanded(ctx.trigger)).toBe(true);
  });
});

describe('Solutions disclosure — focus leaving the group', () => {
  it('closes when focus moves to a control outside the group', () => {
    activate(ctx.trigger);
    ctx.group.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: ctx.outside }));
    expect(isExpanded(ctx.trigger)).toBe(false);
    expect(looksOpen(ctx.panel)).toBe(false);
  });

  it('closes when focus is lost to nothing (relatedTarget null)', () => {
    activate(ctx.trigger);
    ctx.group.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    expect(isExpanded(ctx.trigger)).toBe(false);
  });

  it('stays open while focus moves from the trigger into the panel', () => {
    activate(ctx.trigger);
    ctx.group.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: ctx.links[3] }));
    expect(isExpanded(ctx.trigger)).toBe(true);
    expect(looksOpen(ctx.panel)).toBe(true);
  });
});

describe('Solutions disclosure — pointer outside / inside', () => {
  it('closes on a press outside the group', () => {
    activate(ctx.trigger);
    ctx.outside.dispatchEvent(pointerEvent('pointerdown', 'mouse'));
    expect(isExpanded(ctx.trigger)).toBe(false);
  });

  it('stays open on a press inside the group', () => {
    activate(ctx.trigger);
    ctx.links[1].dispatchEvent(pointerEvent('pointerdown', 'mouse'));
    expect(isExpanded(ctx.trigger)).toBe(true);
  });

  it('does not react to an outside press while closed', () => {
    ctx.outside.dispatchEvent(pointerEvent('pointerdown', 'mouse'));
    expect(isExpanded(ctx.trigger)).toBe(false);
  });
});

describe('Solutions disclosure — hover stays a mouse affordance', () => {
  it('opens for a mouse entering the group', () => {
    ctx.group.dispatchEvent(pointerEvent('pointerenter', 'mouse'));
    expect(isExpanded(ctx.trigger)).toBe(true);
    expect(looksOpen(ctx.panel)).toBe(true);
  });

  it('holds the panel through the trigger-to-panel gap, then closes it', () => {
    vi.useFakeTimers();
    ctx.group.dispatchEvent(pointerEvent('pointerenter', 'mouse'));
    ctx.group.dispatchEvent(pointerEvent('pointerleave', 'mouse'));

    vi.advanceTimersByTime(HOVER_CLOSE_MS - 1);
    expect(isExpanded(ctx.trigger)).toBe(true); // the pointer is still crossing

    vi.advanceTimersByTime(1);
    expect(isExpanded(ctx.trigger)).toBe(false);
  });

  it('cancels the pending close when the pointer comes back', () => {
    vi.useFakeTimers();
    ctx.group.dispatchEvent(pointerEvent('pointerenter', 'mouse'));
    ctx.group.dispatchEvent(pointerEvent('pointerleave', 'mouse'));
    ctx.group.dispatchEvent(pointerEvent('pointerenter', 'mouse'));

    vi.advanceTimersByTime(HOVER_CLOSE_MS * 5);
    expect(isExpanded(ctx.trigger)).toBe(true);
  });

  it('does not hover-open for touch, so a tap toggles once instead of twice', () => {
    ctx.group.dispatchEvent(pointerEvent('pointerenter', 'touch'));
    expect(isExpanded(ctx.trigger)).toBe(false);

    activate(ctx.trigger);
    expect(isExpanded(ctx.trigger)).toBe(true);
  });

  it('does not hover-close for touch', () => {
    vi.useFakeTimers();
    activate(ctx.trigger);
    ctx.group.dispatchEvent(pointerEvent('pointerleave', 'touch'));
    vi.advanceTimersByTime(HOVER_CLOSE_MS * 5);
    expect(isExpanded(ctx.trigger)).toBe(true);
  });
});

describe('Solutions disclosure — dismissing by following a link', () => {
  it('closes when a destination inside the panel is clicked', () => {
    activate(ctx.trigger);
    activateLink(ctx.links[0]);
    expect(isExpanded(ctx.trigger)).toBe(false);
  });

  it('does not close on a click that is not on a link', () => {
    activate(ctx.trigger);
    ctx.panel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(isExpanded(ctx.trigger)).toBe(true);
  });
});

describe('Solutions disclosure — wiring', () => {
  it('is bound by initHeaderNav, the entry point Header.astro loads', () => {
    document.body.innerHTML = '';
    const fresh = buildDisclosure();
    expect(isExpanded(fresh.trigger)).toBe(false);

    initHeaderNav();
    activate(fresh.trigger);
    expect(isExpanded(fresh.trigger)).toBe(true);
  });

  it('rebinds after a ClientRouter swap without double-binding the old header', () => {
    document.body.innerHTML = '';
    const swapped = buildDisclosure();
    initSolutionsDisclosure();
    initSolutionsDisclosure(); // idempotent: the guard stops a second binding

    activate(swapped.trigger);
    expect(isExpanded(swapped.trigger)).toBe(true); // one toggle, not open-then-closed
  });

  it('re-inits on astro:page-load and astro:after-swap, which Header.astro relies on', () => {
    expect(NAV_SRC).toContain("addEventListener('astro:page-load'");
    expect(NAV_SRC).toContain("addEventListener('astro:after-swap'");
    expect(NAV_SRC).toMatch(/astro:(page-load|after-swap)'[\s\S]{0,120}initSolutionsDisclosure\(\)/);
  });

  it('leaves the mobile menu alone', () => {
    const details = document.createElement('details');
    details.className = 'group';
    details.setAttribute('open', '');
    const link = document.createElement('a');
    link.href = '/en/features';
    details.appendChild(link);
    document.body.appendChild(details);

    initHeaderNav();
    activateLink(link);
    expect(details.hasAttribute('open')).toBe(false);
  });
});

describe('Header.astro wires the disclosure to the real markup', () => {
  it('gives the trigger the state attributes the script drives', () => {
    expect(HEADER_SRC).toContain('data-solutions-trigger');
    expect(HEADER_SRC).toContain('aria-expanded="false"');
    expect(HEADER_SRC).toContain('aria-controls="solutions-panel"');
  });

  it('points aria-controls at the panel it actually renders', () => {
    expect(HEADER_SRC).toContain('id="solutions-panel"');
    expect(HEADER_SRC).toContain('data-solutions-panel');
  });

  it('no longer opens the panel from CSS hover alone', () => {
    // The regression: `group-hover:visible` kept the panel open while
    // aria-expanded said closed, and hid the links from the tab order.
    expect(HEADER_SRC).not.toMatch(/group-hover:(visible|opacity-100)/);
  });

  it('still carries all eight destinations, locale-relative', () => {
    // The fix must not shrink the panel: these are the eight the audit found
    // unreachable, and both locales get them via getRelativeLocaleUrl.
    for (const slug of [
      'restaurant',
      'cafe',
      'minimarket',
      'warung',
      'warehouse',
      'docs/inventory',
      'docs/shifts',
      'docs/cloud-sync',
    ]) {
      expect(HEADER_SRC).toContain(`getRelativeLocaleUrl(locale, '${slug}')`);
    }
  });

  it('has dropped the dead nav array astro check flagged as unused', () => {
    expect(HEADER_SRC).not.toContain('const nav = [');
  });
});
