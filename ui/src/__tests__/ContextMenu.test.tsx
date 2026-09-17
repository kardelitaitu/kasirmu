import { describe, expect, it, vi } from 'vitest';
import { screen, render as rtlRender } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContextMenu } from '@/components/ContextMenu';
import { withFluent } from '@/i18n/test-utils';
import { createRef } from 'react';
import type { ReactElement } from 'react';

// ContextMenu resolves its labels and its aria-label through Fluent, so
// every mount needs a LocalizationProvider. `withFluent` auto-loads
// shared.ftl, where the ctx-menu-* keys live.
function render(ui: ReactElement) {
  return rtlRender(withFluent(ui));
}

function createMenu(overrides: Partial<{ x: number; y: number; target: HTMLInputElement | HTMLTextAreaElement }> = {}) {
  return {
    x: 100,
    y: 200,
    target: document.createElement('input'),
    ...overrides,
  };
}

describe('ContextMenu', () => {
  it('renders Copy and Paste buttons', () => {
    const menuRef = createRef<HTMLDivElement>();
    render(<ContextMenu menu={createMenu()} menuRef={menuRef} onCopy={vi.fn()} onPaste={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText('Copy')).toBeTruthy();
    expect(screen.getByText('Paste')).toBeTruthy();
  });

  it('has role="menu"', () => {
    const menuRef = createRef<HTMLDivElement>();
    const { container } = render(<ContextMenu menu={createMenu()} menuRef={menuRef} onCopy={vi.fn()} onPaste={vi.fn()} onClose={vi.fn()} />);

    expect(container.querySelector('[role="menu"]')).toBeTruthy();
  });

  it('applies position from menu props', () => {
    const menuRef = createRef<HTMLDivElement>();
    const { container } = render(<ContextMenu menu={createMenu({ x: 50, y: 75 })} menuRef={menuRef} onCopy={vi.fn()} onPaste={vi.fn()} onClose={vi.fn()} />);

    const el = container.querySelector('.ctx-menu') as HTMLElement;
    expect(el.style.left).toBe('50px');
    expect(el.style.top).toBe('75px');
  });

  it('calls onCopy when Copy is clicked', async () => {
    const onCopy = vi.fn();
    const menuRef = createRef<HTMLDivElement>();
    const user = userEvent.setup();

    render(<ContextMenu menu={createMenu()} menuRef={menuRef} onCopy={onCopy} onPaste={vi.fn()} onClose={vi.fn()} />);

    await user.click(screen.getByText('Copy'));
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it('calls onPaste when Paste is clicked', async () => {
    const onPaste = vi.fn();
    const menuRef = createRef<HTMLDivElement>();
    const user = userEvent.setup();

    render(<ContextMenu menu={createMenu()} menuRef={menuRef} onCopy={vi.fn()} onPaste={onPaste} onClose={vi.fn()} />);

    await user.click(screen.getByText('Paste'));
    expect(onPaste).toHaveBeenCalledTimes(1);
  });

  it('has aria-label on menu', () => {
    const menuRef = createRef<HTMLDivElement>();
    render(<ContextMenu menu={createMenu()} menuRef={menuRef} onCopy={vi.fn()} onPaste={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole('menu').getAttribute('aria-label')).toBe('Context menu');
  });

  it('positions each button as menuitem', () => {
    const menuRef = createRef<HTMLDivElement>();
    render(<ContextMenu menu={createMenu()} menuRef={menuRef} onCopy={vi.fn()} onPaste={vi.fn()} onClose={vi.fn()} />);

    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(2);
  });
});
