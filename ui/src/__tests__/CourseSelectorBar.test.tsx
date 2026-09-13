import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { withFluent, withFluentLocale } from '@/locales/test-utils';
import salesFtl from '@/locales/sales.ftl?raw';
import salesIdFtl from '@/locales/sales.id.ftl?raw';
import { CourseSelectorBar } from '@/features/sales/components/CourseSelectorBar';
import {
  COURSES,
  type CartLine,
  type CourseId,
  type LineId,
  type Sku,
} from '@/types/domain';

// ── CourseSelectorBar behavioural tests ──────────────────────────────
//
// Closes the disclosure gap left by the five "Course firing bar" cases in
// PosScreen.integration.test.tsx (~L1906-1929), which are expect(true) stubs
// whose prose claims component coverage that did not exist anywhere.
//
// Harness mirrors the repo pattern (see RetailFnBar.test.tsx): withFluent /
// withFluentLocale build a real FluentBundle from the production sales.ftl
// bundles; no store mocking — the component is presentational.

let lineSeq = 0;

/** Minimal CartLine fixture; branded ids are fakes cast at the boundary. */
function makeLine(opts: {
  courseId?: CourseId;
  coursingStatus?: CartLine['coursingStatus'];
}): CartLine {
  lineSeq += 1;
  return {
    id: `line-${lineSeq}` as LineId,
    sku: `SKU-${lineSeq}` as Sku,
    qty: 1,
    unit_price: { minor_units: 15000, currency: 'IDR' },
    ...(opts.courseId !== undefined ? { courseId: opts.courseId } : {}),
    ...(opts.coursingStatus !== undefined
      ? { coursingStatus: opts.coursingStatus }
      : {}),
  };
}

const held = (courseId: CourseId) =>
  makeLine({ courseId, coursingStatus: 'hold' });

function renderBar(lines: CartLine[]) {
  const fireCourse = vi.fn();
  const fireAllCourses = vi.fn();
  const result = render(
    withFluent(
      <CourseSelectorBar
        lines={lines}
        fireCourse={fireCourse}
        fireAllCourses={fireAllCourses}
      />,
      salesFtl,
    ),
  );
  return { ...result, fireCourse, fireAllCourses };
}

function renderBarId(lines: CartLine[]) {
  const fireCourse = vi.fn();
  const fireAllCourses = vi.fn();
  const result = render(
    withFluentLocale(
      'id',
      <CourseSelectorBar
        lines={lines}
        fireCourse={fireCourse}
        fireAllCourses={fireAllCourses}
      />,
      salesIdFtl,
    ),
  );
  return { ...result, fireCourse, fireAllCourses };
}

const allHeld = () => COURSES.map((c) => held(c.id));

describe('CourseSelectorBar', () => {
  it('renders no fire controls when no line is on hold', () => {
    const { container } = renderBar([
      makeLine({ courseId: 'main', coursingStatus: 'fired' }),
      makeLine({}),
    ]);

    expect(screen.queryByTestId('fire-all-courses')).toBeNull();
    expect(container.querySelectorAll('.pos-cart-course-btn')).toHaveLength(0);
    // Behaviour note (deviation from the stub prose): the component does NOT
    // return null for the whole bar. CourseSelectorBar.tsx:20 renders
    // div.pos-cart-course-bar unconditionally; the null at :25 is per-course
    // inside the map. The parent gate is PosScreen.tsx:993
    // (lines.length > 0 && workspace), not hold status — so an all-fired cart
    // shows an empty bar, which is what this pins.
    const bar = container.querySelector('.pos-cart-course-bar');
    expect(bar).not.toBeNull();
    expect(bar!.querySelectorAll('button')).toHaveLength(0);
  });

  it('renders exactly one fire-course button per course in COURSES plus Fire-All when every course is on hold', () => {
    const { container } = renderBar(allHeld());

    // One button per course, keyed by the COURSES constant, in COURSES order.
    const courseButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        '[data-testid^="fire-course-"]',
      ),
    );
    expect(courseButtons).toHaveLength(COURSES.length);
    expect(courseButtons.map((b) => b.dataset['testid'])).toEqual(
      COURSES.map((c) => `fire-course-${c.id}`),
    );
    for (const course of COURSES) {
      const btn = screen.getByTestId(`fire-course-${course.id}`);
      expect(btn.className).toContain('pos-cart-course-btn');
      expect(btn.textContent).toContain(course.label);
      // one held line for this course -> count badge shows 1
      expect(btn.textContent).toContain('1');
    }

    // The Fire-All control is present alongside the per-course controls.
    expect(screen.getByTestId('fire-all-courses')).toBeTruthy();
  });

  it('only courses with a hold get a button; fired/unassigned lines are excluded and holds aggregate', () => {
    const { container } = renderBar([
      held('main'),
      held('main'),
      makeLine({ courseId: 'dessert', coursingStatus: 'fired' }),
      makeLine({ courseId: 'drinks' }),
    ]);

    expect(screen.queryByTestId('fire-course-dessert')).toBeNull();
    expect(screen.queryByTestId('fire-course-drinks')).toBeNull();
    expect(
      container.querySelectorAll('[data-testid^="fire-course-"]'),
    ).toHaveLength(1);
    // two held lines for main -> hold count badge shows 2
    expect(screen.getByTestId('fire-course-main').textContent).toContain('2');
    expect(screen.getByTestId('fire-all-courses')).toBeTruthy();
  });

  it('clicking a per-course control fires only that course id', () => {
    const { fireCourse, fireAllCourses } = renderBar(allHeld());

    fireEvent.click(screen.getByTestId('fire-course-dessert'));

    expect(fireCourse).toHaveBeenCalledTimes(1);
    expect(fireCourse).toHaveBeenCalledWith('dessert');
    expect(fireAllCourses).not.toHaveBeenCalled();
  });

  it('clicking Fire-All calls the fire-all callback exactly once and no per-course callback', () => {
    const { fireCourse, fireAllCourses } = renderBar(allHeld());

    fireEvent.click(screen.getByTestId('fire-all-courses'));

    expect(fireAllCourses).toHaveBeenCalledTimes(1);
    expect(fireCourse).not.toHaveBeenCalled();
  });

  it('per-course accessible name comes from the pos-cart-course-fire-aria bundle message and differs per course', () => {
    const { container } = renderBarId(allHeld());

    // The en fallback in the component is `Fire ${label} (${count} items)`;
    // the id bundle message is "Kirim { $label } ({ $count } item)". Matching
    // the id translation proves getString() sourced the name from the l10n
    // key pos-cart-course-fire-aria, not the hardcoded fallback.
    const labels = COURSES.map((course) => {
      const btn = screen.getByTestId(`fire-course-${course.id}`);
      expect(btn.getAttribute('aria-label')).toBe(
        `Kirim ${course.label} (1 item)`,
      );
      return btn.getAttribute('aria-label');
    });
    expect(new Set(labels).size).toBe(COURSES.length);
    expect(container).toBeTruthy();
  });
});
