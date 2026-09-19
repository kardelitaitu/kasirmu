// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { labelMap } from '../../i18n';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

async function renderField(props: {
  locale?: string;
  value?: string;
  showConfirm?: boolean;
  confirmValue?: string;
  onChange?: (v: string) => void;
  onConfirmChange?: (v: string) => void;
} = {}) {
  const onChange = props.onChange ?? vi.fn();
  const onConfirmChange = props.onConfirmChange ?? vi.fn();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  const { default: PasswordField, PASSWORD_FIELD_LABELS } = await import('../PasswordField');
  await act(async () => {
    root.render(
      <PasswordField
        labels={labelMap(props.locale ?? 'en', PASSWORD_FIELD_LABELS)}
        id="pw"
        label="Password"
        value={props.value ?? ''}
        onChange={onChange}
        autoComplete="current-password"
        showConfirm={props.showConfirm}
        confirmValue={props.confirmValue ?? ''}
        onConfirmChange={onConfirmChange}
      />,
    );
    await new Promise((r) => setTimeout(r, 10));
  });
  return { container, root, onChange, onConfirmChange };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('PasswordField', () => {
  it('renders a password input with hidden text by default', async () => {
    const h = await renderField({ value: 'secret' });
    try {
      const input = h.container.querySelector('input') as HTMLInputElement;
      expect(input).not.toBeNull();
      expect(input.type).toBe('password');
    } finally {
      act(() => h.root.unmount());
      h.container.remove();
    }
  });

  it('toggles to text when eye button is clicked', async () => {
    const h = await renderField({ value: 'secret' });
    try {
      const toggle = h.container.querySelector('button[aria-label]') as HTMLButtonElement;
      expect(toggle).not.toBeNull();
      expect(toggle.getAttribute('aria-label')).toBe('Show password');

      await act(async () => {
        toggle.click();
      });

      const input = h.container.querySelector('input') as HTMLInputElement;
      expect(input.type).toBe('text');
      expect(toggle.getAttribute('aria-label')).toBe('Hide password');

      // Click again to hide.
      await act(async () => {
        toggle.click();
      });
      expect(input.type).toBe('password');
    } finally {
      act(() => h.root.unmount());
      h.container.remove();
    }
  });

  it('does not show confirm field when showConfirm is false', async () => {
    const h = await renderField({ showConfirm: false });
    try {
      const inputs = h.container.querySelectorAll('input');
      expect(inputs.length).toBe(1);
    } finally {
      act(() => h.root.unmount());
      h.container.remove();
    }
  });

  it('shows confirm field when showConfirm is true', async () => {
    const h = await renderField({ showConfirm: true });
    try {
      const inputs = h.container.querySelectorAll('input');
      expect(inputs.length).toBe(2);
    } finally {
      act(() => h.root.unmount());
      h.container.remove();
    }
  });

  it('shows "Passwords don\'t match" when confirm differs', async () => {
    const h = await renderField({ showConfirm: true, value: 'abc12345', confirmValue: 'xyz99999' });
    try {
      expect(h.container.textContent).toContain("Passwords don't match");
    } finally {
      act(() => h.root.unmount());
      h.container.remove();
    }
  });

  it('hides mismatch hint when confirm matches and is long enough', async () => {
    const h = await renderField({ showConfirm: true, value: 'Abcdef1!', confirmValue: 'Abcdef1!' });
    try {
      expect(h.container.textContent).not.toContain("Passwords don't match");
      const check = h.container.querySelector('[aria-label="Passwords match"]');
      expect(check).not.toBeNull();
    } finally {
      act(() => h.root.unmount());
      h.container.remove();
    }
  });

  it('does not show mismatch hint when confirm is empty', async () => {
    const h = await renderField({ showConfirm: true, value: 'Abcdef1!', confirmValue: '' });
    try {
      expect(h.container.textContent).not.toContain("Passwords don't match");
    } finally {
      act(() => h.root.unmount());
      h.container.remove();
    }
  });

  it('renders default confirm label from i18n', async () => {
    const h = await renderField({ showConfirm: true, confirmValue: 'test' });
    try {
      expect(h.container.textContent).toContain('Confirm password');
    } finally {
      act(() => h.root.unmount());
      h.container.remove();
    }
  });

  it('uses Indonesian i18n for show/hide labels', async () => {
    const h = await renderField({ locale: 'id' });
    try {
      const toggle = h.container.querySelector('button[aria-label]') as HTMLButtonElement;
      expect(toggle.getAttribute('aria-label')).toBe('Tampilkan kata sandi');
    } finally {
      act(() => h.root.unmount());
      h.container.remove();
    }
  });

  it('shows the input with the provided value', async () => {
    const h = await renderField({ value: 'test123' });
    try {
      const input = h.container.querySelector('input') as HTMLInputElement;
      expect(input.value).toBe('test123');
    } finally {
      act(() => h.root.unmount());
      h.container.remove();
    }
  });

  it('shows confirm input with the provided confirmValue', async () => {
    const h = await renderField({ showConfirm: true, confirmValue: 'confirm999' });
    try {
      const inputs = h.container.querySelectorAll('input');
      const confirmInput = inputs[1] as HTMLInputElement;
      expect(confirmInput.value).toBe('confirm999');
    } finally {
      act(() => h.root.unmount());
      h.container.remove();
    }
  });

  it('applies minLength=8 and maxLength=72 on inputs', async () => {
    const h = await renderField({ showConfirm: true });
    try {
      const inputs = h.container.querySelectorAll('input');
      for (const input of inputs) {
        expect(input.minLength).toBe(8);
        expect(input.maxLength).toBe(72);
      }
    } finally {
      act(() => h.root.unmount());
      h.container.remove();
    }
  });
});
