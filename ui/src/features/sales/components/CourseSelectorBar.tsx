import { Localized } from '@/components/Localized';
import { useLocalization } from '@fluent/react';
import { COURSES, type CartLine, type CourseId } from '@/types/domain';

// ── Course firing bar 

export interface CourseSelectorBarProps {
  lines: CartLine[];
  fireCourse: (courseId: CourseId) => void;
  fireAllCourses: () => void;
  /** The workspace this cart belongs to; the bar exists only on `restaurant-pos`. */
  activeWorkspace?: string | null;
  /** `restaurant.course_firing`; only an explicit `false` hides the bar. */
  courseFiringEnabled?: boolean | null;
  /** Render nothing at all when no line is on hold (the cart panel's choice). */
  hideWhenEmpty?: boolean;
}

export function CourseSelectorBar({
  lines,
  fireCourse,
  fireAllCourses,
  activeWorkspace,
  courseFiringEnabled,
  hideWhenEmpty = false,
}: CourseSelectorBarProps) {
  const { l10n } = useLocalization();
  // ── THE BAR'S THREE GATES, MOVED HERE FROM CartPanel (2026-10-19) ──────────
  //
  // CartPanel used to wrap this component in
  // `lines.length > 0 && activeWorkspace === 'restaurant-pos' && courseFiringEnabled
  // !== false`. Measured in PosScreenCoreFlow's course-firing race case: the panel
  // rendered its order-context and line sections while this one was absent, with
  // all three clauses satisfied — so the gate was not doing what its text says.
  // The conditions are unchanged; only their home is. Placed HERE they are next to
  // the markup they gate and a test can hold one input fixed while varying the rest.
  //
  // Undefined input means "not supplied" and stays permissive for the two callers
  // that render the bar on its own (CourseSelectorBar.test.tsx), so the existing
  // contract there is unchanged. On a real CartPanel both are always passed.
  if (lines.length === 0) return null;
  if (activeWorkspace !== undefined && activeWorkspace !== 'restaurant-pos') return null;
  if (courseFiringEnabled === false) return null;
  // ⚠️ `hideWhenEmpty`, AND IT IS OPT-IN ON PURPOSE. An all-fired cart shows an empty
  // bar today, and CourseSelectorBar.test.tsx pins that deliberately ("an all-fired
  // cart shows an empty bar, which is what this pins"). Changing it for every caller
  // would rewrite that contract to fix a different defect. What a restored draft with
  // no `coursingStatus` needs is a way for the PANEL to say "there is nothing to fire
  // here", so CartPanel passes this and the bare component keeps its old behaviour.
  if (hideWhenEmpty && lines.every((l) => l.coursingStatus !== 'hold')) return null;
  // A FIREABLE line is one on hold that BELONGS TO A COURSE.
  //
  // `fireCourse` needs both (`courseId === courseId && coursingStatus === 'hold'`,
  // in `fireableCount` below), so a hold with no course is not fireable by any per-course
  // button. Fire All used to be gated on `coursingStatus === 'hold'` alone, which
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
