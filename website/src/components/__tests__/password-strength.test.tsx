// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { labelMap } from '../../i18n';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

async function renderStrength(locale: string, password: string) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const { default: PasswordStrength, PASSWORD_STRENGTH_LABELS } = await import('../PasswordStrength');
  await act(async () => {
    root.render(<PasswordStrength labels={labelMap(locale, PASSWORD_STRENGTH_LABELS)} password={password} />);
    await new Promise((r) => setTimeout(r, 10));
  });
  return { container, root };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('PasswordStrength meter', () => {
  it('shows "Too short" for an empty password', async () => {
    const { container, root } = await renderStrength('en', '');
    try {
      expect(container.textContent).toContain('Too short');
      const meter = container.querySelector('[role="meter"]');
      expect(meter).not.toBeNull();
      expect(meter?.getAttribute('aria-valuenow')).toBe('0');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows "Too short" for a password under 8 bytes', async () => {
    const { container, root } = await renderStrength('en', 'Ab1!');
    try {
      expect(container.textContent).toContain('Too short');
      expect(container.textContent).toContain('at least 8 characters');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows "Weak" when length is OK but < 3 classes', async () => {
    const { container, root } = await renderStrength('en', 'abcdefgh');
    try {
      expect(container.textContent).toContain('Weak');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows "Good" when exactly 3 classes are satisfied', async () => {
    const { container, root } = await renderStrength('en', 'Abcdefg1');
    try {
      expect(container.textContent).toContain('Good');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows "Strong" when all 4 classes are satisfied', async () => {
    const { container, root } = await renderStrength('en', 'Abcdef1!');
    try {
      expect(container.textContent).toContain('Strong');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('reflects the correct aria-valuenow for the class count', async () => {
    const { container, root } = await renderStrength('en', 'abcdefgh');
    try {
      const meter = container.querySelector('[role="meter"]');
      expect(meter?.getAttribute('aria-valuenow')).toBe('1');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows 4 meter segments', async () => {
    const { container, root } = await renderStrength('en', 'Abcdef1!');
    try {
      const meter = container.querySelector('[role="meter"]');
      const segments = meter?.querySelectorAll('span');
      expect(segments?.length).toBe(4);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('uses Indonesian i18n labels', async () => {
    const { container, root } = await renderStrength('id', 'Abcdef1!');
    try {
      expect(container.textContent).toContain('Kuat');
      const meter = container.querySelector('[role="meter"]');
      expect(meter?.getAttribute('aria-label')).toBe('Kekuatan kata sandi');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('shows the hint text about character classes', async () => {
    const { container, root } = await renderStrength('en', 'abc');
    try {
      expect(container.textContent).toContain('Use at least 3 of');
      expect(container.textContent).toContain('lowercase');
      expect(container.textContent).toContain('uppercase');
      expect(container.textContent).toContain('number');
      expect(container.textContent).toContain('symbol');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('handles multi-byte characters (emoji in password)', async () => {
    const { container, root } = await renderStrength('en', 'A😀😀😀😀😀😀😀😀😀😀');
    try {
      expect(container.textContent).toContain('Weak');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
