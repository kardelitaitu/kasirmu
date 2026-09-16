/* Proof probe: cursor parked over the mockup (like a user watching it),
   no clicks. Track which slide is active every 500ms for 12s — the
   carousel must advance at least twice within 10s. */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('https://kasir.mu/en/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Park the mouse dead-center on the mockup for the whole test.
  await page.mouse.move(720, 350);

  const seen = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const t0 = Date.now();
        const events = [];
        let current = null;
        const iv = setInterval(() => {
          const active = [...document.querySelectorAll('[data-slide-id]')].find((el) => {
            const cs = getComputedStyle(el);
            return cs.transform === 'none' || new DOMMatrixReadOnly(cs.transform).m41 === 0;
          });
          const id = active ? active.dataset.slideId : '?';
          if (id !== current) {
            events.push(`t=${Date.now() - t0}ms -> ${id}`);
            current = id;
          }
          if (Date.now() - t0 > 12000) {
            clearInterval(iv);
            resolve(events);
          }
        }, 250);
      }),
  );

  console.log('ACTIVE SLIDE TIMELINE (mouse parked on mockup, no interaction):');
  seen.forEach((e) => console.log('  ' + e));
  const advances = seen.length - 1;
  console.log(`TOTAL: ${advances} slide changes in 12s -> ${advances >= 2 ? 'PASS (moving)' : 'FAIL (stalled)'}`);
  await browser.close();
})();
