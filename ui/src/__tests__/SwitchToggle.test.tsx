// ── SwitchToggle ─────────────────────────────────────────────
//
// The shared `role=switch` control, extracted after round 179 found the cash-drawer-kick
// switch carrying the native `checked` but no `aria-checked` — one of twelve hand-written
// copies of the same markup. These cases make the drift impossible to reintroduce through
// the shared component.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SwitchToggle } from '@/components/SwitchToggle';

function renderToggle(overrides: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  const props = {
    label: 'Automatic Cash Drawer',
    id: 'kick',
    checked: false,
    onChange,
    ...overrides,
  };
  const view = render(<SwitchToggle {...(props as Parameters<typeof SwitchToggle>[0])} />);
  return { onChange, props, view };
}

describe('SwitchToggle', () => {
  it('publishes its state through aria-checked, not only the native checked', () => {
    // Round 179's defect, pinned: the native `checked` property is NOT published as the
    // accessibility state, so a `role=switch` without `aria-checked` is announced as a
    // switch with no on/off at all. Asserted in both directions.
    const { view } = renderToggle({ checked: false });
    const input = screen.getByRole('switch');
    expect(input).toHaveAttribute('aria-checked', 'false');
    expect(input).not.toBeChecked();

    view.rerender(<SwitchToggle label="x" id="kick" checked onChange={() => {}} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('is reachable and named by role, and its visible control is aria-hidden', () => {
    renderToggle();
    const input = screen.getByRole('switch', { name: /Automatic Cash Drawer/i });
    expect(input).toBeInTheDocument();
    const wrapper = input.closest('label');
    const slider = wrapper?.querySelector('.settings-toggle-slider');
    expect(slider).toHaveAttribute('aria-hidden', 'true');
  });

  it('reports the new value on change', async () => {
    const { onChange } = renderToggle({ checked: false });
    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('honours disabled without dropping the state it announces', () => {
    renderToggle({ checked: true, disabled: true });
    const input = screen.getByRole('switch');
    expect(input).toBeDisabled();
    // A disabled switch must not become an unknown one.
    expect(input).toHaveAttribute('aria-checked', 'true');
  });
});
