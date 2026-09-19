// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DWELL_MS, initHeroCarousel, pillClass } from '../hero-carousel';

/**
 * Markup skeleton with the same `data-` hooks `HeroCarousel.astro` renders.
 * `src/__tests__/hero-carousel-contract.test.ts` pins those hooks in the Astro
 * file, so the two cannot drift; this file tests only the behaviour.
 */
function skeleton(): string {
  const slides = ['restaurant', 'retail', 'kitchen', 'warehouse', 'topology'];
  return `
    <div data-carousel>
      <div role="group" aria-roledescription="carousel" aria-label="kasir.mu app screenshots">
        <div data-carousel-track style="transform: translateX(-0%); transition: transform 700ms cubic-bezier(0.2, 0, 0, 1);">
          ${slides
            .map(
              (id, i) =>
                `<div data-slide-id="${id}" aria-hidden="${i === 0 ? 'false' : 'true'}"></div>`,
            )
            .join('')}
        </div>
      </div>
      <div data-carousel-pills>
        ${slides
          .map(
            (id, i) =>
              `<button type="button" data-carousel-pill aria-label="${id}"${
                i === 0 ? ' aria-current="true"' : ''
              } class="${pillClass(i === 0)}">${id}</button>`,
          )
          .join('')}
      </div>
    </div>`;
}

function mount() {
  document.body.innerHTML = skeleton();
  const root = document.querySelector<HTMLElement>('[data-carousel]')!;
  const dispose = initHeroCarousel(root);
  if (!dispose) throw new Error('initHeroCarousel returned no disposer');
  return {
    root,
    stage: root.querySelector<HTMLElement>('[role="group"]')!,
    track: root.querySelector<HTMLElement>('[data-carousel-track]')!,
    pillsBar: root.querySelector<HTMLElement>('[data-carousel-pills]')!,
    slides: [...root.querySelectorAll<HTMLElement>('[data-slide-id]')],
    pills: [...root.querySelectorAll<HTMLButtonElement>('[data-carousel-pill]')],
    dispose,
  };
}

describe('hero carousel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('refuses to initialise incomplete markup instead of throwing', () => {
    document.body.innerHTML = '<div data-carousel></div>';
    const root = document.querySelector<HTMLElement>('[data-carousel]')!;
    expect(initHeroCarousel(root)).toBeNull();
  });

  it('starts on the first slide and marks it current', () => {
    const { track, slides, pills, dispose } = mount();
    expect(pills[0].getAttribute('aria-current')).toBe('true');
    expect(pills[1].getAttribute('aria-current')).toBeNull();
    expect(pills[0].className).toBe(pillClass(true));
    expect(pills[1].className).toBe(pillClass(false));
    expect(slides[0].getAttribute('aria-hidden')).toBe('false');
    expect(slides[1].getAttribute('aria-hidden')).toBe('true');
    expect(track.style.transform).toMatch(/translateX\(-?0%\)/);
    expect(track.style.transition).toMatch(/transform 700ms/);
    dispose();
  });

  it('auto-advances every dwell period and wraps from last back to first', () => {
    const { pills, dispose } = mount();

    vi.advanceTimersByTime(DWELL_MS);
    expect(pills[1].getAttribute('aria-current')).toBe('true');

    vi.advanceTimersByTime(3 * DWELL_MS);
    expect(pills[4].getAttribute('aria-current')).toBe('true');

    vi.advanceTimersByTime(DWELL_MS);
    expect(pills[0].getAttribute('aria-current')).toBe('true');
    dispose();
  });

  it('sliding moves the track and swaps aria-hidden and the pill classes', () => {
    const { track, slides, pills, dispose } = mount();

    vi.advanceTimersByTime(DWELL_MS);
    expect(track.style.transform).toBe('translateX(-100%)');
    expect(slides[1].getAttribute('aria-hidden')).toBe('false');
    expect(slides[0].getAttribute('aria-hidden')).toBe('true');
    expect(pills[1].className).toBe(pillClass(true));
    expect(pills[0].className).toBe(pillClass(false));
    expect(pills[0].getAttribute('aria-current')).toBeNull();
    dispose();
  });

  it('clicking a pill jumps straight to that slide and restarts the dwell', () => {
    const { track, pills, dispose } = mount();

    pills[3].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(pills[3].getAttribute('aria-current')).toBe('true');
    expect(track.style.transform).toBe('translateX(-300%)');
    expect(track.style.transition).toMatch(/transform 400ms/);

    // Less than one dwell after the click must not advance again.
    vi.advanceTimersByTime(DWELL_MS - 1);
    expect(pills[3].getAttribute('aria-current')).toBe('true');
    vi.advanceTimersByTime(1);
    expect(pills[4].getAttribute('aria-current')).toBe('true');
    dispose();
  });

  it('clicking the current pill also restarts the dwell', () => {
    const { pills, dispose } = mount();

    vi.advanceTimersByTime(DWELL_MS);
    expect(pills[1].getAttribute('aria-current')).toBe('true');

    pills[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.advanceTimersByTime(DWELL_MS - 1);
    expect(pills[1].getAttribute('aria-current')).toBe('true');
    dispose();
  });

  it('pauses only while the pill bar is hovered, never on the stage', () => {
    const { stage, pillsBar, pills, dispose } = mount();

    // A resting cursor on the mockup must not stall the carousel.
    stage.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    vi.advanceTimersByTime(DWELL_MS);
    expect(pills[1].getAttribute('aria-current')).toBe('true');

    // Hovering the pill bar does pause it.
    pillsBar.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    vi.advanceTimersByTime(3 * DWELL_MS);
    expect(pills[1].getAttribute('aria-current')).toBe('true');

    // Leaving resumes.
    pillsBar.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
    vi.advanceTimersByTime(DWELL_MS);
    expect(pills[2].getAttribute('aria-current')).toBe('true');
    dispose();
  });

  it('stops on dispose and on a duplicate initialisation', () => {
    const { root, pills, dispose } = mount();
    dispose();
    vi.advanceTimersByTime(3 * DWELL_MS);
    expect(pills[0].getAttribute('aria-current')).toBe('true');

    // The second init must not stack a second timer.
    const second = initHeroCarousel(root);
    second?.();
  });
});
