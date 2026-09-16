import { describe, expect, it, vi } from 'vitest';
import { renderInAct } from '@/test-utils/renderInAct';
import { act } from 'react';
import { usePosState } from '@/features/sales/usePosState';
import { COURSES, courseLabel, courseEmoji } from '@/types/domain';
import type { CourseId } from '@/types/domain';

// Mock triggerInteraction so jsdom doesn't fail on HTMLMediaElement.play.
vi.mock('@/utils/interaction', () => ({
  triggerInteraction: vi.fn(),
}));

// ── Course domain type tests ──────────────────────────────────────────

describe('Course domain types', () => {
  it('defines all 5 courses with labels and emojis', () => {
    expect(COURSES).toHaveLength(5);
    expect(COURSES.map((c) => c.id)).toEqual(['appetizer', 'main', 'side', 'dessert', 'beverage']);
  });

  it('courseLabel returns the correct display label', () => {
    expect(courseLabel('appetizer')).toBe('Appetizer');
    expect(courseLabel('main')).toBe('Main Course');
    expect(courseLabel('side')).toBe('Side');
    expect(courseLabel('dessert')).toBe('Dessert');
    expect(courseLabel('beverage')).toBe('Beverage');
    // Legacy POS value normalizes to the beverage label.
    expect(courseLabel('drinks')).toBe('Beverage');
  });

  it('courseLabel returns the id itself for unknown courses', () => {
    expect(courseLabel('unknown' as CourseId)).toBe('unknown');
  });

  it('courseEmoji returns a non-empty string for each course', () => {
    for (const course of COURSES) {
      expect(courseEmoji(course.id).length).toBeGreaterThan(0);
    }
  });

  it('courseEmoji returns emoji for each course', () => {
    expect(courseEmoji('appetizer').length).toBeGreaterThan(0);
    expect(courseEmoji('main').length).toBeGreaterThan(0);
    expect(courseEmoji('side').length).toBeGreaterThan(0);
    expect(courseEmoji('dessert').length).toBeGreaterThan(0);
    expect(courseEmoji('beverage').length).toBeGreaterThan(0);
  });
});

// ── usePosState course methods ───────────────────────────────────────

describe('usePosState course methods', () => {
  async function renderHarness() {
    const ref: { current: ReturnType<typeof usePosState> } = { current: null! };
    function Harness() {
      ref.current = usePosState();
      return null;
    }
    await renderInAct(<Harness />);
    return ref;
  }

  it('assignCourse sets courseId and coursingStatus to hold', async () => {
    const ref = await renderHarness();
    act(() => {
      ref.current.addProduct({
        sku: 'STEAK' as never, name: 'Ribeye', category: 'Main',
        price: { minor_units: 150000, currency: 'IDR' },
        barcode: null, inStock: true, stockQty: null, productType: 'restaurant',
      });
    });

    const lineId = ref.current.lines[0]!.id;
    act(() => { ref.current.assignCourse(lineId, 'main'); });
    expect(ref.current.lines[0]!.courseId).toBe('main');
    expect(ref.current.lines[0]!.coursingStatus).toBe('hold');
  });

  it('fireCourse fires only the specified course', async () => {
    const ref = await renderHarness();
    act(() => {
      ref.current.addProduct({ sku: 'STEAK' as never, name: 'Ribeye', category: 'Main', price: { minor_units: 150000, currency: 'IDR' }, barcode: null, inStock: true, stockQty: null, productType: 'restaurant' });
      ref.current.addProduct({ sku: 'COLA' as never, name: 'Cola', category: 'Beverage', price: { minor_units: 15000, currency: 'IDR' }, barcode: null, inStock: true, stockQty: null, productType: 'restaurant' });
    });

    const steakId = ref.current.lines.find((l) => l.sku === 'STEAK')!.id;
    const colaId = ref.current.lines.find((l) => l.sku === 'COLA')!.id;

    act(() => { ref.current.assignCourse(steakId, 'main'); ref.current.assignCourse(colaId, 'beverage'); });
    act(() => { ref.current.fireCourse('main'); });

    expect(ref.current.lines.find((l) => l.sku === 'STEAK')!.coursingStatus).toBe('fired');
    expect(ref.current.lines.find((l) => l.sku === 'COLA')!.coursingStatus).toBe('hold');
  });

  it('fireAllCourses fires all held items', async () => {
    const ref = await renderHarness();
    act(() => {
      ref.current.addProduct({ sku: 'STEAK' as never, name: 'Ribeye', category: 'Main', price: { minor_units: 150000, currency: 'IDR' }, barcode: null, inStock: true, stockQty: null, productType: 'restaurant' });
      ref.current.addProduct({ sku: 'COLA' as never, name: 'Cola', category: 'Beverage', price: { minor_units: 15000, currency: 'IDR' }, barcode: null, inStock: true, stockQty: null, productType: 'restaurant' });
    });

    const steakId = ref.current.lines.find((l) => l.sku === 'STEAK')!.id;
    const colaId = ref.current.lines.find((l) => l.sku === 'COLA')!.id;

    act(() => { ref.current.assignCourse(steakId, 'main'); ref.current.assignCourse(colaId, 'beverage'); });
    act(() => { ref.current.fireAllCourses(); });

    expect(ref.current.lines.every((l) => l.coursingStatus === 'fired')).toBe(true);
  });

  it('assignCourse same course twice is a no-op', async () => {
    const ref = await renderHarness();
    act(() => {
      ref.current.addProduct({ sku: 'STEAK' as never, name: 'Ribeye', category: 'Main', price: { minor_units: 150000, currency: 'IDR' }, barcode: null, inStock: true, stockQty: null, productType: 'restaurant' });
    });

    const lineId = ref.current.lines[0]!.id;
    act(() => { ref.current.assignCourse(lineId, 'main'); ref.current.assignCourse(lineId, 'main'); });
    expect(ref.current.lines[0]!.courseId).toBe('main');
    expect(ref.current.lines[0]!.coursingStatus).toBe('hold');
  });

  it('unassigned items have undefined courseId and coursingStatus', async () => {
    const ref = await renderHarness();
    act(() => {
      ref.current.addProduct({ sku: 'STEAK' as never, name: 'Ribeye', category: 'Main', price: { minor_units: 150000, currency: 'IDR' }, barcode: null, inStock: true, stockQty: null, productType: 'retail' });
    });

    expect(ref.current.lines[0]!.courseId).toBeUndefined();
    expect(ref.current.lines[0]!.coursingStatus).toBeUndefined();
  });

  it('fireCourse on empty course does not crash', async () => {
    const ref = await renderHarness();
    act(() => { ref.current.fireCourse('appetizer'); });
    expect(ref.current.lines.length).toBe(0);
  });
});
