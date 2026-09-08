// ── IPC contract tests for browser.ts ───────────────────────────
//
// Verifies the exported function calls loggedInvoke with the correct
// IPC command name and argument shape, and pins the dev-mock /
// plain-browser fallback contract (ADR #38): true when the backend
// accepted the request, false when the opener is unavailable.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

import { openProductImagesScoped } from '@/api/browser';

describe('browser.ts IPC contract', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockInvoke.mockReset();
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('openProductImagesScoped → open_product_images_scoped with sessionToken + sku', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const result = await openProductImagesScoped('tok_br', 'SKU-001');
    expect(mockInvoke).toHaveBeenCalledWith('open_product_images_scoped', {
      sessionToken: 'tok_br',
      sku: 'SKU-001',
    });
    expect(result).toBe(true);
  });

  it('does not touch window.open when the backend accepted the request', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await openProductImagesScoped('tok_br', 'SKU-001');
    expect(openSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('sends only the sku — the search query is built server-side (ADR #38 D2/D3)', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await openProductImagesScoped('tok_br', 'Arabica 1kg');
    const call = mockInvoke.mock.calls[0];
    expect(call?.[1]).toEqual({ sessionToken: 'tok_br', sku: 'Arabica 1kg' });
  });

  it('falls back to window.open and resolves false when the command is unavailable', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('command open_product_images_scoped not found'));
    const result = await openProductImagesScoped('tok_br', 'SKU-001');
    expect(result).toBe(false);
    expect(openSpy).toHaveBeenCalledWith(
      'https://www.google.com/search?tbm=isch&q=SKU-001',
      '_blank',
      'noopener,noreferrer',
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('URL-encodes the sku in the fallback link', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('unavailable'));
    await openProductImagesScoped('tok_br', 'Coffee Beans & more');
    expect(openSpy).toHaveBeenCalledWith(
      'https://www.google.com/search?tbm=isch&q=Coffee%20Beans%20%26%20more',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('never rejects — a failed IPC is absorbed by the fallback', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('boom'));
    await expect(openProductImagesScoped('tok_br', 'SKU-002')).resolves.toBe(false);
  });
});
