/**
 * Hero carousel behaviour — the homepage's five-slide mockup carousel.
 *
 * `HeroCarousel.astro` renders the whole carousel as static markup (all five
 * slides and the pill bar), so it is complete and legible without JavaScript;
 * this module only *moves* it. Keeping the behaviour here instead of inside a
 * React island is what let the homepage drop the framework renderer — measured
 * 55 KB gzip of React to animate one CSS transform — while staying unit-testable.
 *
 * Behaviour, unchanged from the React island it replaced:
 * - advances every `DWELL_MS`, wrapping from the last slide back to the first;
 * - a pill click jumps straight to that slide with a `MANUAL_MS` transform;
 * - any pill click (including on the current pill) restarts the dwell countdown;
 * - the pill bar pauses on hover (WCAG 2.2.2) while the stage deliberately does
 *   not, so a resting cursor on the mockup never stalls the carousel.
 *
 * Markup contract, fulfilled by `HeroCarousel.astro`: a `[data-carousel]` root
 * containing the `[data-carousel-track]` sliding track, one `[data-slide-id]`
 * element per slide, the `[data-carousel-pills]` bar and one
 * `[data-carousel-pill]` per slide in the same order.
 */

/** Slide ids, and the order the track renders them in. */
export const SLIDE_IDS = ['restaurant', 'retail', 'kitchen', 'warehouse', 'topology'] as const;
export type SlideId = (typeof SLIDE_IDS)[number];

/** How long a slide stays put before the carousel advances. */
export const DWELL_MS = 10000;
/** Transform duration for an automatic advance, and for a manual jump. */
export const AUTO_MS = 700;
export const MANUAL_MS = 400;

/** Pill classes live here so the rendered markup and the script cannot disagree. */
const PILL_BASE = 'rounded-full px-4 py-2 text-sm font-medium transition duration-200 border';
const PILL_CURRENT = 'border-primary bg-primary text-on-primary shadow-sm';
const PILL_IDLE =
  'border-ink/10 bg-surface/60 text-muted hover:border-primary/40 hover:text-ink hover:bg-surface';

/** Class list for a pill, by whether it is the current slide. */
export function pillClass(current: boolean): string {
  return `${PILL_BASE} ${current ? PILL_CURRENT : PILL_IDLE}`;
}

/**
 * Wire one carousel. Returns a disposer that stops its timer, or `null` when the
 * markup is incomplete (in which case the static first slide simply stays put).
 */
export function initHeroCarousel(root: HTMLElement): (() => void) | null {
  const track = root.querySelector<HTMLElement>('[data-carousel-track]');
  const pillBar = root.querySelector<HTMLElement>('[data-carousel-pills]');
  const slides = [...root.querySelectorAll<HTMLElement>('[data-slide-id]')];
  const pills = [...root.querySelectorAll<HTMLButtonElement>('[data-carousel-pill]')];
  if (!track || !pillBar || slides.length === 0 || pills.length !== slides.length) return null;

  let index = 0;
  let paused = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const draw = (next: number, durationMs: number): void => {
    index = next;
    track.style.transition = `transform ${durationMs}ms cubic-bezier(0.2, 0, 0, 1)`;
    track.style.transform = `translateX(-${index * 100}%)`;
    slides.forEach((slide, i) => slide.setAttribute('aria-hidden', String(i !== index)));
    pills.forEach((pill, i) => {
      const current = i === index;
      if (current) pill.setAttribute('aria-current', 'true');
      else pill.removeAttribute('aria-current');
      pill.className = pillClass(current);
    });
  };

  const schedule = (): void => {
    clearTimeout(timer);
    if (paused) return;
    timer = setTimeout(() => {
      draw((index + 1) % slides.length, AUTO_MS);
      schedule();
    }, DWELL_MS);
  };

  pills.forEach((pill, i) => {
    pill.addEventListener('click', () => {
      if (i !== index) draw(i, MANUAL_MS);
      schedule(); // a click on any pill — current or not — restarts the dwell
    });
  });

  pillBar.addEventListener('mouseenter', () => {
    paused = true;
    clearTimeout(timer);
  });
  pillBar.addEventListener('mouseleave', () => {
    if (!paused) return; // pointer events on an unpaused bar must not reset the dwell
    paused = false;
    schedule();
  });

  schedule();

  return () => {
    paused = true;
    clearTimeout(timer);
  };
}

/**
 * Initialise every carousel in the document, and stop them before the router
 * swaps the page. Astro's ClientRouter replaces the body without unloading the
 * document, so without the disposers each visit would leave a timer firing at a
 * detached node (the React island got this for free from unmount).
 */
export function initHeroCarousels(): void {
  const disposers: Array<() => void> = [];
  for (const root of document.querySelectorAll<HTMLElement>('[data-carousel]')) {
    if (root.dataset.carouselReady === 'true') continue; // a page swap re-ran this module
    root.dataset.carouselReady = 'true';
    const dispose = initHeroCarousel(root);
    if (dispose) disposers.push(dispose);
  }
  document.addEventListener(
    'astro:before-swap',
    () => {
      for (const dispose of disposers) dispose();
    },
    { once: true },
  );
}
