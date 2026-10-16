import { Localized } from '@/components/Localized';
import { useLocalization } from '@fluent/react';
import { COURSES, type CartLine, type CourseId } from '@/types/domain';

// ── Course firing bar 

export interface CourseSelectorBarProps {
  lines: CartLine[];
  fireCourse: (courseId: CourseId) => void;
  fireAllCourses: () => void;
}

export function CourseSelectorBar({
  lines,
  fireCourse,
  fireAllCourses,
}: CourseSelectorBarProps) {
  const { l10n } = useLocalization();
  // A FIREABLE line is one on hold that BELONGS TO A COURSE.
  //
  // `fireCourse` needs both (`courseId === courseId && coursingStatus === 'hold'`,
  // :24-26), so a hold with no course is not fireable by any per-course button.
  // Fire All used to be gated on `coursingStatus === 'hold'` alone (:40-41), which
  // made it strictly BROADER: a course-less hold would raise a "Fire All" control
  // that no per-course button could match, and that would fire a line the operator
  // was never shown.
  //
  // That state is unreachable through the UI today — `assignCourse` is the only
  // writer of 'hold' and its own doc says clearing a course drops `coursingStatus`
  // too (usePosState.ts:224-227) — but the two gates disagreeing is the latent
  // half of the shape the team already paid for once. Sharing ONE definition makes
  // them agree by construction rather than by coincidence.
  const fireableCount = (courseId: CourseId | undefined) =>
    lines.filter((l) => l.courseId === courseId && l.coursingStatus === 'hold').length;

  return (
      <div className="pos-cart-course-bar">
        {COURSES.map((course) => {
          const holdCount = fireableCount(course.id);
          if (holdCount === 0) return null;
          return (
            <button
              key={course.id}
              type="button"
              className="pos-cart-course-btn"
              onClick={() => fireCourse(course.id)}
              data-testid={`fire-course-${course.id}`}
              aria-label={l10n.getString('pos-cart-course-fire-aria', { label: course.label, count: String(holdCount) }, `Fire ${course.label} (${holdCount} items)`)}
            >
              <span className="pos-cart-course-emoji" aria-hidden="true">{course.emoji}</span>
              <span className="pos-cart-course-label">{course.label}</span>
              <span className="pos-cart-course-count">{holdCount}</span>
            </button>
          );
        })}
        {COURSES.some((c) => fireableCount(c.id) > 0) && (
          <button
            type="button"
            className="pos-cart-course-btn pos-cart-course-btn--all"
            onClick={fireAllCourses}
            data-testid="fire-all-courses"
          >
            <Localized id="pos-cart-course-btn--all"><span className="pos-cart-course-label">Fire All</span></Localized>
          </button>
        )}
      </div>
  );
}
