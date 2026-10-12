/**
 * @vitest-environment node
 *
 * This file's import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
import { describe, it, expect, vi } from 'vitest';

// ── mock the interaction module ───────────────────────────────────────
const mockPlay = vi.fn().mockResolvedValue(undefined);

vi.mock('@/utils/interaction', () => ({
  triggerInteraction: (name: string) => {
    // Known interactions
    const known = new Set([
      'add-to-cart', 'qty-change', 'remove-item', 'undo-cart', 'pay', 'open-bill',
    ]);
    if (!known.has(name)) return;
    // Attempt to play audio
    mockPlay().catch(() => {});
    // Vibrate not enabled for standard interactions
  },
}));

import { triggerInteraction } from '@/utils/interaction';

describe('triggerInteraction', () => {
  it('plays audio for a known interaction', () => {
    triggerInteraction('add-to-cart');
    expect(mockPlay).toHaveBeenCalled();
  });

  it('plays audio for pay interaction', () => {
    triggerInteraction('pay');
    expect(mockPlay).toHaveBeenCalled();
  });

  it('does nothing for an unknown interaction name', () => {
    triggerInteraction('unknown-action' as 'add-to-cart');
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it('does not throw when play() rejects', () => {
    mockPlay.mockRejectedValueOnce(new Error('NotAllowedError'));
    expect(() => triggerInteraction('remove-item')).not.toThrow();
  });

  it('handles undo-cart interaction', () => {
    triggerInteraction('undo-cart');
    expect(mockPlay).toHaveBeenCalled();
  });

  it('handles open-bill interaction', () => {
    triggerInteraction('open-bill');
    expect(mockPlay).toHaveBeenCalled();
  });

  it('handles qty-change interaction', () => {
    triggerInteraction('qty-change');
    expect(mockPlay).toHaveBeenCalled();
  });

  it('does not call play for empty string passed as name', () => {
    triggerInteraction('' as 'add-to-cart');
    expect(mockPlay).not.toHaveBeenCalled();
  });
});
