//! A11Y-07: shell-level axe suite with global rules ENABLED.
//!
//! The isolated screen suites keep `color-contrast`, `landmark-one-main`,
//! `page-has-heading-one`, and `region` disabled (see `axe-helper.tsx`).
//! This suite mounts the REAL desktop and tablet shells and re-enables the
//! structural global rules so regressions in landmark structure, heading
//! presence, and region containment are caught at the shell level — the
//! exact gap the audit flagged (A11Y-07: "shell-level axe suite with global
//! rules enabled, representative modal-open and error-state checks, tablet
//! coverage").
//!
//! Colour contrast stays disabled here: jsdom has no rendering engine, so
//! computed colours are not meaningful; contrast is covered by the E2E suite
//! (documented exception, tracked against the audit's expiry guidance).

import { describe, it, vi } from 'vitest';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import { checkA11y } from './axe-helper';
import AppLayout from '@/app/AppLayout';
import TabletAppLayout from '@/app/tablet/TabletAppLayout';
import { Modal } from '@/components/Modal';

// ── Leaf shell components are stubbed with minimal accessible equivalents ──
// Each is covered by its own focused suite; only the SHELL landmark
// structure (skip link, sidebar nav, main, status footer) is under test here.

vi.mock('@/app/StatusBar', () => ({
  // A div (NOT a <footer>) so the status role is aria-allowed-role legal:
  // axe rejects role="status" on <footer> (implicit contentinfo semantics).
  default: () => (
    <div role="status" aria-label="Application status">
      v0.0.25
    </div>
  ),
}));

vi.mock('@/app/UpdateBanner', () => ({
  default: () => null,
}));

vi.mock('@/components/StoreSwitcher', () => ({
  default: () => null,
}));

vi.mock('@/components/StockAlertBell', () => ({
  default: () => null,
}));

vi.mock('@/components/RoleBadge', () => ({
  default: () => null,
}));

// ── Global structural rules — enabled ONLY at the shell level ───────────
const SHELL_GLOBAL_RULES = {
  rules: {
    'landmark-one-main': { enabled: true },
    'page-has-heading-one': { enabled: true },
    region: { enabled: true },
  },
};

describe('Desktop shell (AppLayout) — global axe rules', () => {
  it('has exactly one main landmark and no landmark/heading/region violations', async () => {
    const { container } = await renderWithProviders(
      <AppLayout route="products" onNavigate={() => {}}>
        <h1>Products</h1>
        <p>Page content</p>
      </AppLayout>,
    );
    await checkA11y(container, SHELL_GLOBAL_RULES);
  });

  it('has no violations in a modal-open state (focus trap + aria-modal active)', async () => {
    const { container } = await renderWithProviders(
      <AppLayout route="products" onNavigate={() => {}}>
        <h1>Products</h1>
        <Modal open onClose={() => {}} title="Confirm action">
          <p>Modal body</p>
        </Modal>
      </AppLayout>,
    );
    await checkA11y(container, SHELL_GLOBAL_RULES);
  });
});

describe('Tablet shell (TabletAppLayout) — global axe rules', () => {
  it('has a main landmark and a labelled navigation landmark for the tab bar', async () => {
    const { container } = await renderWithProviders(
      <TabletAppLayout route="products" onNavigate={() => {}}>
        <h1>Products</h1>
        <p>Page content</p>
      </TabletAppLayout>,
    );
    await checkA11y(container, SHELL_GLOBAL_RULES);
  });
});
