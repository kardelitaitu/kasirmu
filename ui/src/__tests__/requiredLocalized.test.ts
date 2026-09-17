import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { requiredLocalized, type RequiredLocalizedL10n } from '@/components';

function makeL10n(
  getString: (id: string, args?: Record<string, string | number>) => string | null | undefined,
): RequiredLocalizedL10n {
  return { getString };
}

describe('requiredLocalized', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the localized string when present', () => {
    const l10n = makeL10n((id) => (id === 'tax-config-save-error' ? 'Failed to save' : null));
    expect(requiredLocalized(l10n, 'tax-config-save-error')).toBe('Failed to save');
  });

  it('returns the message id when getString returns undefined (no English fallback)', () => {
    const l10n = makeL10n(() => undefined);
    expect(requiredLocalized(l10n, 'missing-key')).toBe('missing-key');
  });

  it('returns the message id when getString returns null', () => {
    const l10n = makeL10n(() => null);
    expect(requiredLocalized(l10n, 'missing-key')).toBe('missing-key');
  });

  it('passes interpolation args through to getString', () => {
    const getString = vi.fn((id: string, _args?: Record<string, string | number>) => {
      return id === 'greeting' ? 'Hello' : null;
    });
    const result = requiredLocalized(makeL10n(getString), 'greeting', { name: 'Ada' });
    expect(result).toBe('Hello');
    expect(getString).toHaveBeenCalledWith('greeting', { name: 'Ada' });
  });

  it('never returns a hardcoded English string for a missing key', () => {
    const l10n = makeL10n(() => undefined);
    const result = requiredLocalized(l10n, 'tax-config-delete-error');
    expect(result).not.toMatch(/^Failed to /);
    expect(result).toBe('tax-config-delete-error');
  });
});
