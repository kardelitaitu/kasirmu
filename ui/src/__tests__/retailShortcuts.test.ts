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
/**
 * Tests for `retailShortcuts.ts` — the single source of truth for retail
 * POS keyboard shortcuts (KEY-02).
 *
 * The manifest is the contract that the function bar, help overlay, and
 * keydown handler all read from. The invariant: every shortcut listed has
 * exactly one owner per scope — no key may have multiple owners, and the
 * lookup helper must find each declared action. (The parity test
 * `retailShortcutParity.test.tsx` asserts display-vs-implementation; these
 * tests pin the manifest's data integrity.)
 */

import { describe, expect, it } from 'vitest';
import {
  RETAIL_SHORTCUTS,
  RETAIL_HELP_SHORTCUTS,
  getRetailShortcut,
  type RetailShortcut,
} from '@/features/retail/retailShortcuts';

describe('RETAIL_SHORTCUTS manifest (KEY-02)', () => {
  it('defines at least the core shortcuts', () => {
    expect(RETAIL_SHORTCUTS.length).toBeGreaterThanOrEqual(10);
  });

  it('has unique key+scope pairs (one owner per key per scope)', () => {
    const seen = new Set<string>();
    for (const s of RETAIL_SHORTCUTS) {
      const pair = `${s.scope}:${s.key}`;
      expect(seen.has(pair), `duplicate owner for ${pair}`).toBe(false);
      seen.add(pair);
    }
  });

  it('has unique action identifiers (one implementation per action)', () => {
    const actions = new Set<string>();
    for (const s of RETAIL_SHORTCUTS) {
      expect(actions.has(s.action), `duplicate action ${s.action}`).toBe(false);
      actions.add(s.action);
    }
  });

  it('every entry has a key, action, labelId, and scope', () => {
    for (const s of RETAIL_SHORTCUTS) {
      expect(s.key.length).toBeGreaterThan(0);
      expect(s.action.length).toBeGreaterThan(0);
      expect(s.labelId.length).toBeGreaterThan(0);
      expect(['retail', 'global']).toContain(s.scope);
      expect(typeof s.editableGuard).toBe('boolean');
    }
  });

  it('keeps retail-scoped keys out of the global scope', () => {
    const retailKeys = RETAIL_SHORTCUTS.filter((s) => s.scope === 'retail').map((s) => s.key);
    const globalKeys = RETAIL_SHORTCUTS.filter((s) => s.scope === 'global').map((s) => s.key);
    for (const k of retailKeys) {
      expect(globalKeys, `retail key ${k} must not be bound globally`).not.toContain(k);
    }
  });

  it('F11 (quick-return) has a single owner in the retail scope', () => {
    const f11 = RETAIL_SHORTCUTS.filter((s) => s.key === 'F11');
    expect(f11).toHaveLength(1);
    expect(f11[0]!.action).toBe('quick-return');
  });

  it('lists every core action in the manifest', () => {
    const actions = RETAIL_SHORTCUTS.map((s) => s.action);
    for (const action of ['pay', 'void', 'discount', 'hold-resume', 'focus-sku', 'quick-return']) {
      expect(actions, `missing action ${action}`).toContain(action);
    }
  });
});

describe('RETAIL_HELP_SHORTCUTS', () => {
  it('is the same manifest the help overlay displays', () => {
    expect(RETAIL_HELP_SHORTCUTS).toBe(RETAIL_SHORTCUTS);
  });
});

describe('getRetailShortcut', () => {
  it('finds a shortcut by action', () => {
    expect(getRetailShortcut('pay')).toMatchObject({
      key: 'F1',
      action: 'pay',
      scope: 'retail',
    });
  });

  it('finds every declared action', () => {
    for (const s of RETAIL_SHORTCUTS) {
      const found = getRetailShortcut(s.action);
      expect(found, `missing lookup for ${s.action}`).toBeDefined();
      expect(found!.action).toBe(s.action);
    }
  });

  it('returns undefined for an unknown action', () => {
    expect(getRetailShortcut('no-such-action')).toBeUndefined();
  });

  it('is case-sensitive', () => {
    expect(getRetailShortcut('PAY')).toBeUndefined();
  });
});

/** Type-level guard: the manifest is a well-formed array of RetailShortcut. */
const _manifestCheck: RetailShortcut[] = RETAIL_SHORTCUTS;
void _manifestCheck;