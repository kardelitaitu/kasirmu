import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES, navigateTo } from './helpers';

/**
 * E2E: Segmented Tabs Geometry — the shared control never boxes outside its
 * container.
 *
 * `SegmentedTabs` is an equal-column grid at `width: max-content`: it is as wide
 * as its widest label, and every segment is that width. A locale with long
 * labels therefore decides the strip's width, and the strip cannot shrink or
 * wrap. Measured in the Indonesian locale on 2026-09-21 (the string set is the
 * reason: "Dalam Perjalanan" is the widest of the six status segments):
 *
 *   viewport   available   strip   result
 *     1366        1082       786   fits (296px of slack)
 *     1180         896       786   fits (110px)
 *     1024         740       786   OVERFLOWS 46px
 *      800         736       786   OVERFLOWS 50px
 *      768         704       786   OVERFLOWS 82px
 *
 * English is 527px and fits at every one of those widths, which is why this only
 * broke in the second locale. The overflow was neither scrollable nor wrapped —
 * the strip simply ran past its container's content box, cutting off the last
 * segment.
 *
 * What is asserted, all measured in a real browser at real tablet widths:
 *   1. The control's box never extends past its container's content box.
 *   2. When the segments need more room than that box has, a scrollable viewport
 *      owns the excess rather than it being clipped away.
 *   3. The control still HUGS its segments when the container has room — it must
 *      not be "fixed" by stretching to full width, which would change the look of
 *      every adopter.
 *
 * The measured element is the control's OUTERMOST box, addressed by the adopter's
 * own className hook, because that is what the surrounding layout sees. The
 * widths are set explicitly so the tablet regime (1024) and the narrowest
 * supported one (768) are both exercised, in both Playwright projects.
 */

interface StripMetrics {
  /** Width of the control's outer box. */
  boxWidth: number;
  /** Width the segments actually need (the track is `width: max-content`). */
  segmentsWidth: number;
  containerWidth: number;
  boxRight: number;
  containerRight: number;
  /** True when the box or a parent within two levels scrolls horizontally. */
  hasScroller: boolean;
}

async function measureControl(page: Page, hookClass: string): Promise<StripMetrics> {
  return page.evaluate((selector) => {
    const box = document.querySelector(selector) as HTMLElement | null;
    const container = box?.parentElement as HTMLElement | null;
    if (!box || !container) throw new Error(`missing ${selector} or its container`);

    const track = (box.querySelector('[role="tablist"]') as HTMLElement | null) ?? box;
    const ccs = getComputedStyle(container);
    const containerRect = container.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();

    const candidates = [box, box.parentElement, box.parentElement?.parentElement];
    const hasScroller = candidates.some((el) => {
      if (!el) return false;
      const overflowX = getComputedStyle(el).overflowX;
      return overflowX === 'auto' || overflowX === 'scroll';
    });

    return {
      boxWidth: boxRect.width,
      segmentsWidth: track.getBoundingClientRect().width,
      containerWidth:
        containerRect.width - parseFloat(ccs.paddingLeft) - parseFloat(ccs.paddingRight),
      boxRight: boxRect.right,
      containerRight: containerRect.right - parseFloat(ccs.paddingRight),
      hasScroller,
    };
  }, hookClass);
}

const WIDTHS = [1366, 1024, 800, 768];

test.describe('Segmented tabs geometry', () => {
  // The labels that overflow this control are the Indonesian ones — the English
  // strip is more than 200px narrower at every width, so a US-locale run would
  // pass the assertions below without exercising anything.
  test.use({ locale: 'id-ID' });

  test('the stock-transfers strip stays inside its container at tablet widths', async ({ page }) => {
    await loginAs(page, 'owner', '1234');
    await selectWorkspace(page, WORKSPACES.INVENTORY);
    await navigateTo(page, 'stock-transfers');
    await page.waitForSelector('.stock-transfers-filters', { timeout: 15_000 });

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 1366 });
      await page.waitForTimeout(300);
      const m = await measureControl(page, '.stock-transfers-filters');

      expect(m.boxWidth, `strip is wider than its container at ${width}px`).toBeLessThanOrEqual(
        m.containerWidth + 0.5,
      );
      expect(m.boxRight, `strip extends past its container at ${width}px`).toBeLessThanOrEqual(
        m.containerRight + 0.5,
      );
      if (m.segmentsWidth > m.containerWidth) {
        expect(m.hasScroller, `segments do not fit and nothing scrolls at ${width}px`).toBe(true);
      }
    }
  });

  test('the strip hugs its segments when the container has room', async ({ page }) => {
    await loginAs(page, 'owner', '1234');
    await selectWorkspace(page, WORKSPACES.INVENTORY);
    await navigateTo(page, 'stock-transfers');
    await page.waitForSelector('.stock-transfers-filters', { timeout: 15_000 });

    await page.setViewportSize({ width: 1366, height: 1366 });
    await page.waitForTimeout(300);
    const m = await measureControl(page, '.stock-transfers-filters');

    // Six segments at their natural width, not a full-width bar: the control
    // keeps sizing itself to its content wherever there is room for it.
    expect(m.boxWidth).toBeLessThan(m.containerWidth - 100);
  });

  test('the warehouse mode tabs stay inside their container at tablet widths', async ({ page }) => {
    await loginAs(page, 'owner', '1234');
    await selectWorkspace(page, WORKSPACES.INVENTORY);
    await navigateTo(page, 'warehouse');
    await page.waitForSelector('.warehouse-mode-tabs', { timeout: 15_000 });

    for (const width of [1024, 768]) {
      await page.setViewportSize({ width, height: 1366 });
      await page.waitForTimeout(300);
      const m = await measureControl(page, '.warehouse-mode-tabs');

      expect(m.boxWidth, `strip is wider than its container at ${width}px`).toBeLessThanOrEqual(
        m.containerWidth + 0.5,
      );
      expect(m.boxRight, `strip extends past its container at ${width}px`).toBeLessThanOrEqual(
        m.containerRight + 0.5,
      );
    }
  });

  test('arrow keys reach a segment the scroll viewport pushed off-screen', async ({ page }) => {
    await loginAs(page, 'owner', '1234');
    await selectWorkspace(page, WORKSPACES.INVENTORY);
    await navigateTo(page, 'stock-transfers');
    await page.waitForSelector('.stock-transfers-filters', { timeout: 15_000 });

    // 768px: the strip needs 786, the container has 704 — the sixth segment
    // ("Dibatalkan") starts past the box's right edge and is not visible.
    await page.setViewportSize({ width: 768, height: 1366 });
    await page.waitForTimeout(300);

    const offscreen = await page.evaluate(() => {
      const box = document.querySelector('.stock-transfers-filters') as HTMLElement;
      const tabs = Array.from(box.querySelectorAll<HTMLElement>('[role="tab"]'));
      const last = tabs[tabs.length - 1]!;
      const r = last.getBoundingClientRect();
      return {
        lastLabel: (last.textContent ?? '').trim(),
        boxClientRight: box.getBoundingClientRect().left + box.clientWidth,
        lastRight: r.right,
      };
    });
    expect(offscreen.lastLabel).toBe('Dibatalkan');
    expect(offscreen.lastRight).toBeGreaterThan(offscreen.boxClientRight + 1);

    // The strip's only tab stop is the active segment ("Semua"). One Left
    // arrow wraps to the LAST segment — the one off-screen — which must move
    // focus there (scrolling it into view) and select it (sliding the thumb).
    await page.locator('[role="tab"][aria-selected="true"]').focus();
    await page.keyboard.press('ArrowLeft');

    const after = await page.evaluate(() => {
      const box = document.querySelector('.stock-transfers-filters') as HTMLElement;
      const track = box.querySelector('[role="tablist"]') as HTMLElement;
      const thumb = box.querySelector('.segmented-tab-indicator') as HTMLElement;
      const active = box.querySelector('[role="tab"][aria-selected="true"]') as HTMLElement;
      const focused = document.activeElement as HTMLElement;
      const r = active.getBoundingClientRect();
      const trackLeft = track.getBoundingClientRect().left;
      const thumbOffset = thumb.getBoundingClientRect().left - trackLeft;
      const activeOffset = active.getBoundingClientRect().left - trackLeft;
      return {
        selectedLabel: (active.textContent ?? '').trim(),
        focusedIsSelected: focused === active,
        scrollLeft: box.scrollLeft,
        fullyVisible: r.left >= box.getBoundingClientRect().left - 0.5 && r.right <= box.getBoundingClientRect().left + box.clientWidth + 0.5,
        thumbVsActive: Math.round((thumbOffset - activeOffset) * 100) / 100,
      };
    });

    expect(after.selectedLabel).toBe('Dibatalkan');
    expect(after.focusedIsSelected, 'focus did not land on the selected segment').toBe(true);
    expect(after.scrollLeft, 'the viewport did not scroll the segment into view').toBeGreaterThan(0);
    expect(after.fullyVisible, 'the selected segment is still not fully visible').toBe(true);
    expect(after.thumbVsActive, 'the thumb is not on the newly selected segment').toBeLessThanOrEqual(0.5);
  });
});
