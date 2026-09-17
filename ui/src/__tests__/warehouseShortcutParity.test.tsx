// ── ui/src/__tests__/warehouseShortcutParity.test.tsx ─────────────────
// KEY-02 parity test: warehouse shortcut manifest ⇄ FnBar ⇄ keydown handler
// must agree. Copied from retailShortcutParity.test.tsx — self-contained.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import WarehouseFnBar from '@/features/warehouse/WarehouseFnBar';
import {
  WAREHOUSE_SHORTCUTS,
  ACTIVE_SHORTCUT_ACTIONS,
  getWarehouseShortcut,
} from '@/features/warehouse/warehouseShortcuts';

// Mock Fluent
vi.mock('@fluent/react', () => ({
  useLocalization: () => ({
    l10n: { getString: (id: string) => id },
  }),
}));

// Mock requiredLocalized
vi.mock('@/components', () => ({
  requiredLocalized: (_l10n: unknown, id: string) => id,
}));

describe('warehouse shortcut parity', () => {
  // 1. Manifest integrity ──────────────────────────────────────

  it('exports every shortcut with a key, action, labelId, and scope', () => {
    for (const s of WAREHOUSE_SHORTCUTS) {
      expect(s.key).toBeTruthy();
      expect(s.action).toBeTruthy();
      expect(s.labelId).toBeTruthy();
      expect(s.scope).toMatch(/^warehouse|global$/);
    }
  });

  it('has no duplicate keys in the warehouse scope', () => {
    const keys = WAREHOUSE_SHORTCUTS.filter((s) => s.scope === 'warehouse').map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has no duplicate actions', () => {
    const actions = WAREHOUSE_SHORTCUTS.map((s) => s.action);
    expect(new Set(actions).size).toBe(actions.length);
  });

  // 2. FnBar renders every manifest key ────────────────────────

  it('renders every F-key manifest entry as a button', () => {
    render(
      <WarehouseFnBar
        onReceive={vi.fn()}
        onSend={vi.fn()}
        onCount={vi.fn()}
        onStock={vi.fn()}
        onPrint={vi.fn()}
        onToggleFullscreen={vi.fn()}
        onShowHelp={vi.fn()}
      />,
    );
    // Every F1–F12 entry in the manifest must appear in the FnBar
    const fkeys = WAREHOUSE_SHORTCUTS.filter((s) => /^F\d+$/.test(s.key));
    expect(fkeys.length).toBeGreaterThan(0);
    for (const s of fkeys) {
      const label = screen.getAllByText(s.key);
      expect(label.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('placeholder keys are disabled (no handler)', () => {
    render(
      <WarehouseFnBar
        onReceive={vi.fn()}
        onSend={vi.fn()}
        onCount={vi.fn()}
        onStock={vi.fn()}
        onPrint={vi.fn()}
        onToggleFullscreen={vi.fn()}
        onShowHelp={vi.fn()}
      />,
    );
    const placeholders = WAREHOUSE_SHORTCUTS.filter((s) => s.placeholder);
    for (const s of placeholders) {
      if (s.action === 'fullscreen') {
        // F11 is a live button (calls toggleFullscreen), not disabled
        const btn = screen.getByText(s.key).closest('button');
        expect(btn).not.toBeDisabled();
      } else {
        const els = screen.getAllByText(s.key);
        const disabled = els.some((el) => (el.closest('button') as HTMLButtonElement)?.disabled);
        expect(disabled).toBe(true);
      }
    }
  });

  // 3. Keydown parity — active keys have handlers, placeholders do not ──

  it('every active shortcut must have a keydown handler (listed in ACTIVE_SHORTCUT_ACTIONS)', () => {
    // The keydown handler in WarehouseConsole should dispatch on these actions.
    // If a non-placeholder action is missing from the handler, the parity test
    // catches it. This test asserts the manifest side is correct.
    for (const s of WAREHOUSE_SHORTCUTS) {
      if (s.placeholder) {
        expect(ACTIVE_SHORTCUT_ACTIONS.has(s.action)).toBe(false);
      } else {
        expect(ACTIVE_SHORTCUT_ACTIONS.has(s.action)).toBe(true);
      }
    }
  });

  // 4. F11 is shell-owned, not re-bound ─────────────────────────

  it('F11 fullscreen is listed in the manifest but is a placeholder (shell-owned, KEY-01)', () => {
    const f11 = getWarehouseShortcut('fullscreen');
    expect(f11).toBeDefined();
    expect(f11!.key).toBe('F11');
    expect(f11!.placeholder).toBe(true);
    expect(f11!.scope).toBe('global');
    // The warehouse keydown handler must NOT bind F11 — that's asserted
    // by the handler's own test (placeholder + scope=global).
  });

  // 5. getWarehouseShortcut lookup works ───────────────────────

  it('getWarehouseShortcut resolves each action', () => {
    for (const s of WAREHOUSE_SHORTCUTS) {
      expect(getWarehouseShortcut(s.action)?.key).toBe(s.key);
    }
  });

  it('getWarehouseShortcut returns undefined for unknown actions', () => {
    expect(getWarehouseShortcut('no-such-action')).toBeUndefined();
  });
});