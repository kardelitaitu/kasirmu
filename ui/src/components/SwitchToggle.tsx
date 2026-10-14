// ── SwitchToggle ───────────────────────────────────────────────
//
// The shared `role=switch` control.
//
// WHY THIS FILE EXISTS
// --------------------
// The markup was written out by hand in TWELVE files, and the copies drift:
//
//   `features/restaurant/PaymentScreen.tsx:1080` — the cash-drawer-kick switch, carried the
//   native `checked` but no `aria-checked`. It was found in round 179 only because a probe
//   read the attribute and got `null` where the sibling rail switches returned `"true"`.
//   A screen reader announcing a switch with no on/off state is the cost of that drift.
//
//   `features/restaurant/RestaurantPaymentsScreen.tsx:197` — the rail switch, DOES set it.
//   `features/restaurant/SettingRow` (:104) — sets it too, and is the only copy behind a
//   component of its own.
//
// Adoption is one line per site, but it is twelve sites across three features — so each
// screen's owner should move its own copy rather than have a sweep touch all twelve at
// once. The tests here are what make that mechanical rather than per-site re-reasoning.

export interface SwitchToggleProps {
  /** Accessible name. Required — a switch with no name is unreadable. */
  label: string;
  /** The `id` the surrounding `<label for>` uses. Must be unique on the page. */
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Test id for the raw input — the visible control is an aria-hidden sibling. */
  testId?: string;
}

/**
 * A `role=switch` checkbox with the state exposed both ways.
 *
 * `aria-checked` is NOT optional. `role=switch` promises it; the native `checked`
 * property is not published as the accessibility state, which is exactly how round 179's
 * defect passed review. Everything here is the shared markup the twelve copies repeat.
 */
export function SwitchToggle({
  label,
  id,
  checked,
  onChange,
  disabled = false,
  testId,
}: SwitchToggleProps) {
  return (
    <span className="settings-toggle">
      <label className="settings-toggle-switch" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          aria-checked={checked}
          role="switch"
          checked={checked}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => onChange(e.target.checked)}
          {...(testId ? { 'data-testid': testId } : {})}
        />
        <span className="settings-toggle-slider" aria-hidden="true" />
      </label>
    </span>
  );
}