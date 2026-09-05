// ── modal-guard tests ────────────────────────────────────────────
//
// Covers isAnyAriaModalOpen (DOM probe for open overlays) and
// consumeShortcut (single-winner event consumption for KEY-05).
//
// Pure DOM behaviour — no mocks required.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { isAnyAriaModalOpen, consumeShortcut } from '@/utils/modal-guard';

afterEach(() => {
  document.body.innerHTML = '';
});

// ── isAnyAriaModalOpen ──────────────────────────────────────────────

describe('isAnyAriaModalOpen', () => {
  it('returns false when no modal exists', () => {
    expect(isAnyAriaModalOpen()).toBe(false);
  });

  it('returns true when an element with aria-modal="true" exists', () => {
    const overlay = document.createElement('div');
    overlay.setAttribute('aria-modal', 'true');
    document.body.append(overlay);

    expect(isAnyAriaModalOpen()).toBe(true);
  });

  it('returns false when aria-modal is "false"', () => {
    const overlay = document.createElement('div');
    overlay.setAttribute('aria-modal', 'false');
    document.body.append(overlay);

    expect(isAnyAriaModalOpen()).toBe(false);
  });

  it('finds a modal nested deep in the tree', () => {
    const deep = document.createElement('div');
    deep.innerHTML = '<section><div aria-modal="true"></div></section>';
    document.body.append(deep);

    expect(isAnyAriaModalOpen()).toBe(true);
  });

  it('returns false again after the modal is removed', () => {
    const overlay = document.createElement('div');
    overlay.setAttribute('aria-modal', 'true');
    document.body.append(overlay);
    expect(isAnyAriaModalOpen()).toBe(true);

    overlay.remove();
    expect(isAnyAriaModalOpen()).toBe(false);
  });
});

// ── consumeShortcut ─────────────────────────────────────────────────

describe('consumeShortcut', () => {
  function makeEvent(cancelable: boolean) {
    const e = new KeyboardEvent('keydown', { key: 'Escape', cancelable });
    vi.spyOn(e, 'preventDefault');
    vi.spyOn(e, 'stopPropagation');
    return e;
  }

  it('prevents default and stops propagation for a cancelable event', () => {
    const e = makeEvent(true);
    consumeShortcut(e);

    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(e.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('stops propagation but skips preventDefault for a non-cancelable event', () => {
    const e = makeEvent(false);
    consumeShortcut(e);

    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalledTimes(1);
  });
});
