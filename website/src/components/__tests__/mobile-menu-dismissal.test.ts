// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initMobileMenuDismissal } from '../../lib/header-nav';

/**
 * Mobile menu dismissal.
 *
 * The hamburger is a native `<details>` so it opens without JavaScript, but a
 * native disclosure closes only when its own `<summary>` is activated: an open
 * panel used to survive Escape and a press on the page beside it, leaving the
 * menu over the content (measured in a browser at 390px, 2026-09-23). These
 * tests pin the two dismissals and the wiring that binds them once, delegated,
 * so a swapped-in header needs no rebinding.
 *
 * Focus restoration after Escape is not asserted here — jsdom does not treat
 * `<summary>` as focusable; it was measured in the browser instead.
 */

const NAV_SRC = readFileSync(join(import.meta.dirname, '..', '..', 'lib', 'header-nav.ts'), 'utf-8');

interface Harness {
  details: HTMLDetailsElement;
  summary: HTMLElement;
  panel: HTMLElement;
  link: HTMLAnchorElement;
}

function buildHeader(): Harness {
  document.body.innerHTML = '';
  const header = document.createElement('header');
  const details = document.createElement('details');
  details.className = 'group relative md:hidden';
  const summary = document.createElement('summary');
  summary.setAttribute('aria-label', 'Menu');
  const panel = document.createElement('nav');
  const link = document.createElement('a');
  link.href = '/en/pricing';
  link.textContent = 'Pricing';
  const outside = document.createElement('a');
  outside.href = '/en/features';
  outside.id = 'behind-the-panel';
  outside.textContent = 'Features';
  panel.appendChild(link);
  details.append(summary, panel);
  header.appendChild(details);
  document.body.append(header, outside);
  details.setAttribute('open', '');
  return { details, summary, panel, link };
}

const pressEscape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
const pressOn = (el: Element) => el.dispatchEvent(new Event('pointerdown', { bubbles: true }));

describe('mobile menu dismissal', () => {
  let h: Harness;
  beforeEach(() => {
    initMobileMenuDismissal();
    h = buildHeader();
  });

  it('closes an open menu on Escape', () => {
    pressEscape();
    expect(h.details.hasAttribute('open')).toBe(false);
  });

  it('does nothing on other keys', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(h.details.hasAttribute('open')).toBe(true);
  });

  it('closes on a press outside the panel — the press that used to hit the page behind it', () => {
    pressOn(document.getElementById('behind-the-panel')!);
    expect(h.details.hasAttribute('open')).toBe(false);
  });

  it('keeps the menu open when the press is inside it, so following a link still works', () => {
    pressOn(h.link);
    expect(h.details.hasAttribute('open')).toBe(true);
  });

  it('leaves a closed menu alone', () => {
    h.details.removeAttribute('open');
    pressEscape();
    pressOn(document.body);
    expect(h.details.hasAttribute('open')).toBe(false);
  });
});

describe('mobile menu wiring', () => {
  it('binds both dismissals once, delegated, from initHeaderNav', () => {
    expect(NAV_SRC).toContain("document.addEventListener('keydown', onMobileMenuKeydown)");
    expect(NAV_SRC).toContain("document.addEventListener('pointerdown', onMobileMenuPointerDown)");
    expect(NAV_SRC).toMatch(/if \(mobileMenuDismissalBound\) return;/);
    expect(NAV_SRC).toMatch(/export function initHeaderNav\(\): void \{\n {2}void updateAuthNav\(\);\n {2}initSolutionsDisclosure\(\);\n {2}initMobileMenuDismissal\(\);/);
  });

  it('scopes the dismissal to header disclosures, not every details on the page', () => {
    expect(NAV_SRC).toContain("querySelectorAll<HTMLDetailsElement>('header details[open]')");
  });
});
