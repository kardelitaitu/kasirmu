/* Diagnostic probe — not committed. Samples computed transforms of the
   hero-carousel slides on the live site during an auto-advance and a
   manual pill click, to verify whether CSS transitions interpolate. */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  await page.goto('https://kasir.mu/en/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => ({
    reduceMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    slideCount: document.querySelectorAll('[data-slide-id]').length,
    hidden: document.hidden,
  }));
  console.log('INFO', JSON.stringify(info));

  // Watch computed transforms every 80ms for 6.8s (auto-advance fires at ~5s).
  const changes = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const t0 = Date.now();
        let prev = '';
        const out = [];
        const iv = setInterval(() => {
          const els = [...document.querySelectorAll('[data-slide-id]')].map((el) => {
            const cs = getComputedStyle(el);
            // Compress matrix to its tx component for readability.
            const m = new DOMMatrixReadOnly(cs.transform === 'none' ? undefined : cs.transform);
            return `${el.dataset.slideId}:tx=${Math.round(m.m41)}:dur=${cs.transitionDuration}`;
          });
          const key = els.join(' | ');
          if (key !== prev) {
            out.push(`t=${Date.now() - t0}ms  ${key}`);
            prev = key;
          }
          if (Date.now() - t0 > 6800) {
            clearInterval(iv);
            resolve(out);
          }
        }, 80);
      }),
  );
  console.log('--- transform changes during auto-advance window ---');
  changes.forEach((l) => console.log(l));

  // Manual click: jump to Kitchen (index 2), sample for 600ms.
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('[role="group"] ~ div button, button[aria-label]')];
    const kitchen = btns.find((b) => b.getAttribute('aria-label') === 'Kitchen');
    if (kitchen) kitchen.click();
  });
  const clickChanges = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const t0 = Date.now();
        let prev = '';
        const out = [];
        const iv = setInterval(() => {
          const els = [...document.querySelectorAll('[data-slide-id]')].map((el) => {
            const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
            return `${el.dataset.slideId}:tx=${Math.round(m.m41)}`;
          });
          const key = els.join(' | ');
          if (key !== prev) {
            out.push(`t=${Date.now() - t0}ms  ${key}`);
            prev = key;
          }
          if (Date.now() - t0 > 700) {
            clearInterval(iv);
            resolve(out);
          }
        }, 60);
      }),
  );
  console.log('--- transform changes after clicking Kitchen pill ---');
  clickChanges.forEach((l) => console.log(l));

  console.log('CONSOLE ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
