/**
 * @vitest-environment node
 *
 * This file's entire import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
// ── nestedModalDepth tests ─────────────────────────────────────────
//
// Pure logic module used by WorkspaceSettingsModal for nested
// SettingsPopup focus trap management. ADR #22 Phase 4.
//
// ADR #22 §9 testing gate: nested modal focus trap collision.

import { describe, expect, it, beforeEach } from 'vitest';
import {
  enterNestedModal,
  exitNestedModal,
  getNestedDepth,
  onNestedDepthChange,
} from '@/features/settings/nestedModalDepth';

// Each test starts with depth=0
beforeEach(() => {
  while (getNestedDepth() > 0) exitNestedModal();
});

describe('nestedModalDepth', () => {
  it('starts at depth 0', () => {
    expect(getNestedDepth()).toBe(0);
  });

  it('increments to 1 after entering one modal', () => {
    enterNestedModal();
    expect(getNestedDepth()).toBe(1);
  });

  it('decrements back to 0 after exit', () => {
    enterNestedModal();
    exitNestedModal();
    expect(getNestedDepth()).toBe(0);
  });

  it('tracks nested depth of 3', () => {
    enterNestedModal();
    enterNestedModal();
    enterNestedModal();
    expect(getNestedDepth()).toBe(3);
    exitNestedModal();
    expect(getNestedDepth()).toBe(2);
    exitNestedModal();
    expect(getNestedDepth()).toBe(1);
    exitNestedModal();
    expect(getNestedDepth()).toBe(0);
  });

  it('never goes below 0', () => {
    exitNestedModal(); // no enters first
    expect(getNestedDepth()).toBe(0);
    exitNestedModal();
    expect(getNestedDepth()).toBe(0);
  });

  it('notifies listeners on depth change', () => {
    const depths: number[] = [];
    const unsub = onNestedDepthChange((d) => depths.push(d));

    enterNestedModal();
    expect(depths).toEqual([1]);

    enterNestedModal();
    expect(depths).toEqual([1, 2]);

    exitNestedModal();
    expect(depths).toEqual([1, 2, 1]);

    unsub();
  });

  it('unsubscribe stops notifications', () => {
    const depths: number[] = [];
    const unsub = onNestedDepthChange((d) => depths.push(d));

    enterNestedModal();
    expect(depths).toEqual([1]);

    unsub();
    enterNestedModal();
    expect(depths).toEqual([1]); // no new notification
  });
});
