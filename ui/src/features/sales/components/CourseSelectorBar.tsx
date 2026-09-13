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
  return (
      <div className="pos-cart-course-bar">
        {COURSES.map((course) => {
          const holdCount = lines.filter(
            (l) => l.courseId === course.id && l.coursingStatus === 'hold',
          ).length;
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
        {lines.some((l) => l.coursingStatus === 'hold') && (
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
