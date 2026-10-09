import { describe, it, expect } from 'vitest';
import {
  clampCartWidth,
  lineThumbnail,
  elapsedHoursMinutes,
  CART_WIDTH_MIN,
  CART_WIDTH_DEFAULT,
  CART_WIDTH_MAX_CAP,
} from '@/features/sales/posScreenUtils';

describe('posScreenUtils', () => {
  describe('clampCartWidth', () => {
    it('returns default when viewport is narrow', () => {
      // 320 * 2 = 640, half is 320, max is 320
      expect(clampCartWidth(CART_WIDTH_DEFAULT, 640)).toBe(CART_WIDTH_MIN);
    });

    it('clamps to minimum when input is below floor', () => {
      expect(clampCartWidth(100, 1920)).toBe(CART_WIDTH_MIN);
      expect(clampCartWidth(0, 1920)).toBe(CART_WIDTH_MIN);
      expect(clampCartWidth(-50, 1920)).toBe(CART_WIDTH_MIN);
    });

    it('clamps to maximum when input exceeds cap', () => {
      // viewport 3000 -> half is 1500, capped at 1200
      expect(clampCartWidth(2000, 3000)).toBe(CART_WIDTH_MAX_CAP);
      expect(clampCartWidth(1500, 3000)).toBe(CART_WIDTH_MAX_CAP);
    });

    it('clamps to viewport half when that is the limiting factor', () => {
      // viewport 1000 -> half is 500, within [320, 1200]
      expect(clampCartWidth(500, 1000)).toBe(500);
      // viewport 800 -> half is 400, within [320, 1200]
      expect(clampCartWidth(400, 800)).toBe(400);
    });

    it('rounds input to nearest integer', () => {
      expect(clampCartWidth(440.3, 1920)).toBe(440);
      expect(clampCartWidth(440.7, 1920)).toBe(441);
    });

    it('uses default when viewportWidth is 0', () => {
      // max = max(320, min(0, 1200)) = 320
      expect(clampCartWidth(100, 0)).toBe(CART_WIDTH_MIN);
    });

    it('handles very small viewport', () => {
      // viewport 400 -> half is 200, max is 320
      expect(clampCartWidth(500, 400)).toBe(CART_WIDTH_MIN);
    });

    it('handles viewport exactly at boundaries', () => {
      // viewport 640 -> half is 320 -> max is 320
      expect(clampCartWidth(400, 640)).toBe(CART_WIDTH_MIN);
      // viewport 2400 -> half is 1200 -> max is 1200
      expect(clampCartWidth(1500, 2400)).toBe(CART_WIDTH_MAX_CAP);
    });
  });

  describe('lineThumbnail', () => {
    it('returns consistent initial and hue for same SKU', () => {
      const result1 = lineThumbnail('COFFEE');
      const result2 = lineThumbnail('COFFEE');
      expect(result1).toEqual(result2);
    });

    it('uses first alphanumeric character as initial', () => {
      expect(lineThumbnail('COFFEE').initial).toBe('C');
      expect(lineThumbnail('123ABC').initial).toBe('1');
      expect(lineThumbnail('-_-TEST').initial).toBe('T');
    });

    it('falls back to first char when no alphanumeric', () => {
      expect(lineThumbnail('---').initial).toBe('-');
      // Empty string has no first char, charAt(0) returns ''
      expect(lineThumbnail('').initial).toBe('');
    });

    it('produces hue in valid range 0-359', () => {
      for (const sku of ['A', 'COFFEE', 'LONG_SKU_NAME_123', '测试', '🍕']) {
        const { hue } = lineThumbnail(sku);
        expect(hue).toBeGreaterThanOrEqual(0);
        expect(hue).toBeLessThan(360);
      }
    });

    it('different SKUs generally produce different hues', () => {
      const hues = new Set<string>();
      for (let i = 0; i < 100; i++) {
        hues.add(lineThumbnail(`SKU-${i}`).hue.toString());
      }
      // With 360 possible hues and 100 SKUs, we expect some collisions
      // but not all the same
      expect(hues.size).toBeGreaterThan(1);
    });

    it('handles unicode SKUs', () => {
      const result = lineThumbnail('咖啡');
      expect(result.initial).toBe('咖');
      expect(result.hue).toBeGreaterThanOrEqual(0);
      expect(result.hue).toBeLessThan(360);
    });

    it('handles emoji SKUs (surrogate pairs produce first surrogate)', () => {
      // Emojis are surrogate pairs - charAt(0) gives the high surrogate
      const result = lineThumbnail('🍕');
      // High surrogate for 🍕 is U+D83C (55356)
      expect(result.initial).toBe('\uD83C');
      expect(result.hue).toBeGreaterThanOrEqual(0);
      expect(result.hue).toBeLessThan(360);
    });
  });

  describe('elapsedHoursMinutes', () => {
    it('returns zero for future or equal timestamps', () => {
      const now = Date.now();
      expect(elapsedHoursMinutes(now, now)).toEqual({ h: 0, m: 0 });
      expect(elapsedHoursMinutes(now + 1000, now)).toEqual({ h: 0, m: 0 });
    });

    it('computes minutes correctly', () => {
      const now = Date.now();
      const oneMinuteAgo = now - 60_000;
      expect(elapsedHoursMinutes(oneMinuteAgo, now)).toEqual({ h: 0, m: 1 });

      const fiveMinutesAgo = now - 5 * 60_000;
      expect(elapsedHoursMinutes(fiveMinutesAgo, now)).toEqual({ h: 0, m: 5 });
    });

    it('computes hours and minutes correctly', () => {
      const now = Date.now();
      const oneHourAgo = now - 60 * 60_000;
      expect(elapsedHoursMinutes(oneHourAgo, now)).toEqual({ h: 1, m: 0 });

      const oneHourFiveMinutesAgo = now - 65 * 60_000;
      expect(elapsedHoursMinutes(oneHourFiveMinutesAgo, now)).toEqual({ h: 1, m: 5 });
    });

    it('floors to whole minutes', () => {
      const now = Date.now();
      const thirtySecondsAgo = now - 30_000;
      // Should floor to 0 minutes
      expect(elapsedHoursMinutes(thirtySecondsAgo, now)).toEqual({ h: 0, m: 0 });

      const oneMinuteThirtyAgo = now - 90_000;
      // Should floor to 1 minute
      expect(elapsedHoursMinutes(oneMinuteThirtyAgo, now)).toEqual({ h: 0, m: 1 });
    });

    it('handles large elapsed times', () => {
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60_000;
      expect(elapsedHoursMinutes(oneDayAgo, now)).toEqual({ h: 24, m: 0 });

      const oneWeekAgo = now - 7 * 24 * 60 * 60_000;
      expect(elapsedHoursMinutes(oneWeekAgo, now)).toEqual({ h: 168, m: 0 });
    });
  });

  describe('constants', () => {
    it('exports expected constant values', () => {
      // 320 -> 400 on a MEASUREMENT, not a preference: at 320 the fixed parts
      // of a line (thumb + qty pill + remove + gaps) left the name column 52 px,
      // and "Ice Lemon Tea" needed 120 px. 400 is the smallest panel at which it
      // fits. See the sweep recorded in cartCalculations.ts above the constant.
      expect(CART_WIDTH_MIN).toBe(400);
      expect(CART_WIDTH_DEFAULT).toBe(440);
      expect(CART_WIDTH_MAX_CAP).toBe(1200);
    });

    it('the floor never exceeds the default, and the cap never sits below either', () => {
      // The floor rising is only safe while it stays under the default a fresh
      // install uses: a floor ABOVE the default would make CART_WIDTH_DEFAULT
      // unreachable and clamp every new terminal up to the floor instead.
      expect(CART_WIDTH_MIN).toBeLessThanOrEqual(CART_WIDTH_DEFAULT);
      expect(CART_WIDTH_MAX_CAP).toBeGreaterThan(CART_WIDTH_DEFAULT);
    });
  });
});