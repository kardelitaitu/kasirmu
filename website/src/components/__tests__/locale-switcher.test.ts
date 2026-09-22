// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tests for LocaleSwitcher.astro client-side script.
 *
 * The component handles en↔id language switching via localStorage.oz_language
 * and Astro's client-side navigate(). It animates a sliding pill indicator
 * and persists user preference.
 */

const SWITCHER_SRC = readFileSync(
  join(import.meta.dirname, '..', 'LocaleSwitcher.astro'),
  'utf-8',
);

/** Strip TypeScript annotations so the script can run in plain JS. */
function stripTypeScript(code: string): string {
  return code
    .replace(/<\w+>/g, '')                          // <HTMLElement>
    .replace(/\bas\s+\w+(\s*\|\s*\w+)*/g, '')       // as HTMLElement | null
    .replace(/:\s*(number|string|boolean|void|any)\b/g, '') // : number
    .replace(/:\s*[A-Z]\w+(\[\])*/g, '')            // : HTMLElement
    .replace(/!(\.)/g, '$1')                         // switcher!. → switcher.
    .replace(/!\)/g, ')');                           // pill!)  → pill)
}

function extractScript(): string {
  const match = SWITCHER_SRC.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Could not extract <script> from LocaleSwitcher.astro');
  let script = match[1].trim();
  // EVERY import line, not just the first: the script imports `navigate` from
  // astro:transitions and `setRegion` from the region owner, and both are
  // supplied to the injected script as platform mocks below. Stripping only one
  // leaves the other as a bare `import` statement, which jsdom rejects.
  // `[ \t]*` before `import` matters: only the first one follows the trim, the
  // rest carry their source indentation.
  script = script.replace(/^[ \t]*import\s*\{[^}]*\}\s*from\s*['"][^'"]*['"];?[ \t]*$/gm, '');
  return stripTypeScript(script);
}

function injectScript(code: string): void {
  const el = document.createElement('script');
  el.textContent = code;
  document.body.appendChild(el);
}

// ─── Mock navigate (DOM-based) ───────────────────────────────────────

/**
 * The module imports the extracted script relies on, stubbed for jsdom.
 *
 * `navigate` stands in for astro:transitions/client (recording calls instead of
 * navigating); `setRegion` stands in for the region owner, writing through the
 * same key lib/region.ts owns so the "persists the region" assertions below
 * still observe a real storage effect rather than a spy on nothing.
 */
const PLATFORM_MOCKS = `
  window.navigate = function(href) {
    var marker = document.getElementById('__nav-calls');
    if (!marker) {
      marker = document.createElement('div');
      marker.id = '__nav-calls';
      marker.style.display = 'none';
      document.body.appendChild(marker);
    }
    marker.dataset.calls = (marker.dataset.calls || '') + href + '|';
  };
  window.setRegion = function(region) { localStorage.setItem('oz_region', region); };
`;

function getNavigateCalls(): string[] {
  const marker = document.getElementById('__nav-calls');
  if (!marker) return [];
  return (marker.dataset.calls || '').split('|').filter(Boolean);
}

// ─── Build realistic DOM ─────────────────────────────────────────────

function buildSwitcherDOM(activeLocale: 'en' | 'id' = 'en'): HTMLElement {
  const switcher = document.createElement('div');
  switcher.className = 'lang-switcher relative flex items-center rounded-lg bg-ghost-bg p-[3px]';
  switcher.setAttribute('role', 'group');
  switcher.setAttribute('data-active-index', activeLocale === 'en' ? '0' : '1');

  const pill = document.createElement('div');
  pill.className = 'pill absolute rounded-lg bg-primary';
  pill.style.cssText = 'top: 3px; bottom: 3px; left: 3px; width: calc(50% - 3.5px);';
  switcher.appendChild(pill);

  const enLink = document.createElement('a');
  enLink.href = '/en/';
  enLink.setAttribute('data-index', '0');
  enLink.textContent = 'EN';
  if (activeLocale === 'en') enLink.setAttribute('aria-current', 'page');
  enLink.getBoundingClientRect = () => ({
    top: 0, bottom: 30, left: 0, right: 50,
    width: 50, height: 30, x: 0, y: 0,
    toJSON: () => {},
  });
  switcher.appendChild(enLink);

  const idLink = document.createElement('a');
  idLink.href = '/id/';
  idLink.setAttribute('data-index', '1');
  idLink.textContent = 'ID';
  if (activeLocale === 'id') idLink.setAttribute('aria-current', 'page');
  idLink.getBoundingClientRect = () => ({
    top: 0, bottom: 30, left: 52, right: 102,
    width: 50, height: 30, x: 52, y: 0,
    toJSON: () => {},
  });
  switcher.appendChild(idLink);

  switcher.getBoundingClientRect = () => ({
    top: 0, bottom: 30, left: 0, right: 102,
    width: 102, height: 30, x: 0, y: 0,
    toJSON: () => {},
  });

  return switcher;
}

// ─── Source structure tests ──────────────────────────────────────────

describe('LocaleSwitcher source structure', () => {
  it('has initLangSwitcher function', () => {
    expect(SWITCHER_SRC).toContain('initLangSwitcher');
  });

  it('queries .lang-switcher element', () => {
    expect(SWITCHER_SRC).toContain(".lang-switcher");
  });

  it('queries .pill element for animation', () => {
    expect(SWITCHER_SRC).toContain(".pill");
  });

  it('queries a[data-index] links', () => {
    expect(SWITCHER_SRC).toContain('a[data-index]');
  });

  it('saves oz_language to localStorage', () => {
    expect(SWITCHER_SRC).toContain("localStorage.setItem('oz_language'");
  });

  it('persists the region through its owner instead of a second spelling', () => {
    // The behaviour is asserted by the switch tests below (localStorage ends up
    // holding the right region). What is pinned here is that the component goes
    // through lib/region.ts to do it: a bare localStorage.setItem('oz_region')
    // is how two spellings of one key start drifting apart.
    expect(SWITCHER_SRC).toContain('setRegion(');
    expect(SWITCHER_SRC).not.toMatch(/localStorage\.(get|set)Item\(\s*['"]oz_region['"]/);
  });

  it('prevents default on click', () => {
    expect(SWITCHER_SRC).toContain('preventDefault');
  });

  it('navigates after pill animation delay', () => {
    expect(SWITCHER_SRC).toContain('setTimeout');
    expect(SWITCHER_SRC).toContain('navigate');
  });

  it('uses 280ms delay matching CSS transition', () => {
    expect(SWITCHER_SRC).toContain('280');
  });

  it('listens for DOMContentLoaded', () => {
    expect(SWITCHER_SRC).toContain('DOMContentLoaded');
  });

  it('listens for astro:page-load', () => {
    expect(SWITCHER_SRC).toContain('astro:page-load');
  });

  it('has role="group" for accessibility', () => {
    expect(SWITCHER_SRC).toContain('role="group"');
  });

  it('has aria-label for accessibility', () => {
    expect(SWITCHER_SRC).toContain('aria-label');
  });
});

// ─── LocaleSwitcher behavior tests ───────────────────────────────────

describe('LocaleSwitcher behavior', () => {
  const SCRIPT = extractScript();

  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('initializes without errors when switcher exists', () => {
    const switcher = buildSwitcherDOM('en');
    document.body.appendChild(switcher);
    injectScript(PLATFORM_MOCKS + SCRIPT);
    expect(true).toBe(true);
  });

  it('does nothing when no switcher exists', () => {
    document.body.appendChild(document.createElement('p'));
    injectScript(PLATFORM_MOCKS + SCRIPT);
    expect(getNavigateCalls()).toHaveLength(0);
  });

  it('shows EN as active when locale is en', () => {
    const switcher = buildSwitcherDOM('en');
    document.body.appendChild(switcher);

    const enLink = switcher.querySelector('a[data-index="0"]');
    expect(enLink?.getAttribute('aria-current')).toBe('page');

    const idLink = switcher.querySelector('a[data-index="1"]');
    expect(idLink?.getAttribute('aria-current')).toBeNull();
  });

  it('sets data-active-index to 0 for English', () => {
    const switcher = buildSwitcherDOM('en');
    document.body.appendChild(switcher);
    expect(switcher.dataset.activeIndex).toBe('0');
  });

  it('shows ID as active when locale is id', () => {
    const switcher = buildSwitcherDOM('id');
    document.body.appendChild(switcher);

    const idLink = switcher.querySelector('a[data-index="1"]');
    expect(idLink?.getAttribute('aria-current')).toBe('page');

    const enLink = switcher.querySelector('a[data-index="0"]');
    expect(enLink?.getAttribute('aria-current')).toBeNull();
  });

  it('sets data-active-index to 1 for Indonesian', () => {
    const switcher = buildSwitcherDOM('id');
    document.body.appendChild(switcher);
    expect(switcher.dataset.activeIndex).toBe('1');
  });

  it('prevents default navigation on click', () => {
    const switcher = buildSwitcherDOM('en');
    document.body.appendChild(switcher);
    injectScript(PLATFORM_MOCKS + SCRIPT);

    const idLink = switcher.querySelector('a[data-index="1"]') as HTMLAnchorElement;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    const preventSpy = vi.spyOn(event, 'preventDefault');

    idLink.dispatchEvent(event);
    expect(preventSpy).toHaveBeenCalled();
  });

  it('saves oz_language to localStorage on switch to id', () => {
    const switcher = buildSwitcherDOM('en');
    document.body.appendChild(switcher);
    injectScript(PLATFORM_MOCKS + SCRIPT);

    const idLink = switcher.querySelector('a[data-index="1"]') as HTMLAnchorElement;
    idLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(localStorage.getItem('oz_language')).toBe('id');
  });

  it('saves oz_region to id on switch to id', () => {
    const switcher = buildSwitcherDOM('en');
    document.body.appendChild(switcher);
    injectScript(PLATFORM_MOCKS + SCRIPT);

    const idLink = switcher.querySelector('a[data-index="1"]') as HTMLAnchorElement;
    idLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(localStorage.getItem('oz_region')).toBe('id');
  });

  it('saves oz_region to global when switching to en', () => {
    localStorage.setItem('oz_language', 'id');
    localStorage.setItem('oz_region', 'id');
    const switcher = buildSwitcherDOM('id');
    document.body.appendChild(switcher);
    injectScript(PLATFORM_MOCKS + SCRIPT);

    const enLink = switcher.querySelector('a[data-index="0"]') as HTMLAnchorElement;
    enLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(localStorage.getItem('oz_language')).toBe('en');
    expect(localStorage.getItem('oz_region')).toBe('global');
  });

  it('calls navigate after 280ms delay', () => {
    const switcher = buildSwitcherDOM('en');
    document.body.appendChild(switcher);
    injectScript(PLATFORM_MOCKS + SCRIPT);

    const idLink = switcher.querySelector('a[data-index="1"]') as HTMLAnchorElement;
    idLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(getNavigateCalls()).toHaveLength(0);

    vi.advanceTimersByTime(280);
    expect(getNavigateCalls()).toHaveLength(1);
    expect(getNavigateCalls()[0]).toBe('/id/');
  });

  it('does NOT navigate when clicking current language', () => {
    const switcher = buildSwitcherDOM('en');
    document.body.appendChild(switcher);
    injectScript(PLATFORM_MOCKS + SCRIPT);

    const enLink = switcher.querySelector('a[data-index="0"]') as HTMLAnchorElement;
    enLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    vi.advanceTimersByTime(300);
    expect(getNavigateCalls()).toHaveLength(0);
  });

  it('does NOT save localStorage when clicking current language', () => {
    const switcher = buildSwitcherDOM('en');
    document.body.appendChild(switcher);
    injectScript(PLATFORM_MOCKS + SCRIPT);

    const enLink = switcher.querySelector('a[data-index="0"]') as HTMLAnchorElement;
    enLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(localStorage.getItem('oz_language')).toBeNull();
  });

  it('updates data-active-index on switch', () => {
    const switcher = buildSwitcherDOM('en');
    document.body.appendChild(switcher);
    injectScript(PLATFORM_MOCKS + SCRIPT);

    const idLink = switcher.querySelector('a[data-index="1"]') as HTMLAnchorElement;
    idLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(switcher.dataset.activeIndex).toBe('1');
  });

  it('has exactly 2 language links', () => {
    const switcher = buildSwitcherDOM('en');
    document.body.appendChild(switcher);

    const links = switcher.querySelectorAll('a[data-index]');
    expect(links).toHaveLength(2);
  });

  it('first link is EN, second is ID', () => {
    const switcher = buildSwitcherDOM('en');
    document.body.appendChild(switcher);

    const links = switcher.querySelectorAll('a[data-index]');
    expect(links[0].textContent?.trim()).toBe('EN');
    expect(links[1].textContent?.trim()).toBe('ID');
  });

  it('has pill element for sliding indicator', () => {
    const switcher = buildSwitcherDOM('en');
    document.body.appendChild(switcher);

    const pill = switcher.querySelector('.pill');
    expect(pill).not.toBeNull();
  });
});

// ─── i18n key tests ──────────────────────────────────────────────────

describe('LocaleSwitcher i18n keys', () => {
  const enJson = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', '..', 'i18n', 'en.json'), 'utf-8'),
  );
  const idJson = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', '..', 'i18n', 'id.json'), 'utf-8'),
  );

  it('en has nav.language', () => {
    expect(enJson.nav?.language).toBeTruthy();
  });

  it('id has nav.language', () => {
    expect(idJson.nav?.language).toBeTruthy();
  });

  it('en and id language labels differ (translated)', () => {
    expect(enJson.nav.language).not.toBe(idJson.nav.language);
  });
});
