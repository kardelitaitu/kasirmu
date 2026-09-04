// ── Retail shortcut parity + conflict tests (KEY-09) ───────────────
//
// Closes the KEY-09 coverage gaps identified in the audit:
//   1. Every shortcut displayed in the help overlay + function bar must be
//      present in the typed manifest (one source of truth, KEY-02).
//   2. No key may have multiple owners in the same scope — the F11 conflict
//      (KEY-01) is pinned: the retail manifest owns F11 = Quick Return.
//   3. Every manifest label id must exist in both FTL bundles (KEY-10).
//   4. Editable-target suppression works from a textarea (KEY-03).

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import salesFtl from '@/locales/sales.ftl?raw';
import productsFtl from '@/locales/products.ftl?raw';
import tablesFtl from '@/locales/tables.ftl?raw';
import salesIdFtl from '@/locales/sales.id.ftl?raw';
import kdsFtl from '@/locales/kds.ftl?raw';
import kdsIdFtl from '@/locales/kds.id.ftl?raw';
import RetailPosScreen from '@/features/retail/RetailPosScreen';
import { RETAIL_SHORTCUTS, RETAIL_HELP_SHORTCUTS, getRetailShortcut } from '@/features/retail/retailShortcuts';

// ── Mock modules (mirrors RetailPosScreen.test.tsx harness) ────────

vi.mock('@/features/sales/usePosState', async () => {
  const { createUsePosStateMock } = await import('@/__tests__/test-utils/mocks/usePosState');
  return { usePosState: vi.fn(() => createUsePosStateMock()) };
});

vi.mock('@/features/sales/useBarcodeScanner', async () => {
  const { createBarcodeScannerModuleMock } = await import('@/__tests__/test-utils/mocks/barcodeScanner');
  return createBarcodeScannerModuleMock();
});

vi.mock('@/api/products', async () => {
  const { createRetailProductsApiMock } = await import('@/__tests__/test-utils/mocks/retailPos');
  return createRetailProductsApiMock();
});

vi.mock('@/api/shifts', async () => {
  const { createShiftsApiMock } = await import('@/__tests__/test-utils/mocks/api');
  return createShiftsApiMock({
    getActiveShiftScoped: vi.fn(() => Promise.reject(new Error('no shift'))),
  });
});

vi.mock('@/api/settings', async () => {
  const { createSettingsApiMock } = await import('@/__tests__/test-utils/mocks/api');
  return createSettingsApiMock({
    getStoreSettingsScoped: vi.fn(() =>
      Promise.resolve({ name: 'TOKO TEST', address: 'Jl. Contoh No. 123', taxId: '', currency: 'IDR', branch: 'Cabang A', logo: '' }),
    ),
  });
});

vi.mock('@/api/hardware', async () => {
  const { createHardwareApiMock } = await import('@/__tests__/test-utils/mocks/api');
  return createHardwareApiMock();
});

vi.mock('@/api/sales', async () => {
  const { createSalesApiMock } = await import('@/__tests__/test-utils/mocks/api');
  return createSalesApiMock();
});

vi.mock('@/api/kds', async (importOriginal) => {
  const { createRetailKdsApiMock } = await import('@/__tests__/test-utils/mocks/retailPos');
  // Spread the real module so a future @/api/kds export cannot be missing here.
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  return createRetailKdsApiMock(await importOriginal<typeof import('@/api/kds')>());
});

vi.mock('@/features/tables/TableManagementScreen', async () => {
  const { createTableManagementScreenStub } = await import('@/__tests__/test-utils/mocks/retailPos');
  return createTableManagementScreenStub();
});

vi.mock('@/features/sales/SalesHistoryScreen', async () => {
  const { createSalesHistoryScreenStub } = await import('@/__tests__/test-utils/mocks/retailPos');
  return createSalesHistoryScreenStub();
});

vi.mock('@/features/products/ProductLookupScreen', async () => {
  const { createProductLookupScreenStub } = await import('@/__tests__/test-utils/mocks/retailPos');
  return createProductLookupScreenStub();
});

vi.mock('@/api/currency', async () => {
  const { createRetailCurrencyApiMock } = await import('@/__tests__/test-utils/mocks/retailPos');
  return createRetailCurrencyApiMock();
});

vi.mock('@/api/customers', async () => {
  const { createRetailCustomersApiMock } = await import('@/__tests__/test-utils/mocks/retailPos');
  return createRetailCustomersApiMock();
});

vi.mock('@/contexts/AuthContext', async () => {
  const { createAuthContextMock } = await import('@/__tests__/test-utils/mocks/contexts');
  return {
    useAuth: createAuthContextMock(),
  };
});

vi.mock('@/contexts/WorkspaceContext', async () => {
  const { createWorkspaceContextMock } = await import('@/__tests__/test-utils/mocks/contexts');
  return createWorkspaceContextMock();
});

const catFtl = `
  category-cat-food = Makanan
  category-cat-drink = Minuman
`;

// ── Manifest integrity ─────────────────────────────────────────────

describe('retail shortcut manifest integrity (KEY-02/09)', () => {
  it('has a unique key per retail-scoped shortcut (no double ownership)', () => {
    const retail = RETAIL_SHORTCUTS.filter((s) => s.scope === 'retail');
    const keys = retail.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has unique action identifiers', () => {
    const actions = RETAIL_SHORTCUTS.map((s) => s.action);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('owns F11 exactly once as Quick Return (KEY-01)', () => {
    const f11 = RETAIL_SHORTCUTS.filter((s) => s.key === 'F11');
    expect(f11).toHaveLength(1);
    expect(f11[0]!.action).toBe('quick-return');
    expect(f11[0]!.labelId).toBe('retail-fn-quick-return');
  });

  it('every manifest label id exists in both the en and id FTL bundles (KEY-10)', () => {
    // Retail shortcut labels live in sales.ftl; kds-title lives in kds.ftl.
    const enBundles = `${salesFtl}\n${kdsFtl}`;
    const idBundles = `${salesIdFtl}\n${kdsIdFtl}`;
    for (const s of RETAIL_SHORTCUTS) {
      expect(enBundles.includes(`${s.labelId} =`), `en bundle missing ${s.labelId}`).toBe(true);
      expect(idBundles.includes(`${s.labelId} =`), `id bundle missing ${s.labelId}`).toBe(true);
    }
  });

  it('help overlay and full manifest share the same entries', () => {
    expect(RETAIL_HELP_SHORTCUTS).toEqual(RETAIL_SHORTCUTS);
  });

  it('lookup by action resolves every entry', () => {
    for (const s of RETAIL_SHORTCUTS) {
      expect(getRetailShortcut(s.action)?.action).toBe(s.action);
    }
  });
});

// ── Rendered parity: help overlay + function bar match the manifest ─

describe('rendered shortcut parity (KEY-09)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('help overlay lists every manifest shortcut key; F11 reads Quick Return', async () => {
    const user = userEvent.setup();
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);

    await user.keyboard('?');
    await waitFor(() => expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument());

    for (const s of RETAIL_HELP_SHORTCUTS) {
      expect(screen.getAllByText(s.key).length).toBeGreaterThanOrEqual(1);
    }
    // F11 overlay entry must read Quick Return, not Toggle Fullscreen (KEY-01).
    expect(screen.queryByText('Toggle Fullscreen')).not.toBeInTheDocument();
  });

  it('function bar derives F-key labels from the manifest (KEY-02)', async () => {
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);

    const fnBar = await screen.findByRole('toolbar');
    expect(fnBar).toBeInTheDocument();
    for (const action of ['pay', 'void', 'discount', 'hold-resume', 'focus-sku', 'sales-history', 'customer-search', 'stock-inquiry', 'shift', 'options']) {
      const entry = getRetailShortcut(action);
      expect(entry, `manifest missing ${action}`).toBeDefined();
      expect(fnBar.textContent).toContain(entry!.key);
    }
  });
});

// ── Editable-target suppression (KEY-03) ───────────────────────────

describe('editable-target suppression (KEY-03)', () => {
  it('pressing F1 from a textarea does not open the payment modal', async () => {
    const user = userEvent.setup();
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    await user.keyboard('{F1}');

    // Pay opens the PaymentModal — assert it did not open.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('pressing F2 from a contenteditable does not trigger void/clear', async () => {
    const user = userEvent.setup();
    await renderWithProviders(<RetailPosScreen />, salesFtl, productsFtl, tablesFtl, catFtl);

    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.appendChild(editable);
    editable.focus();

    await user.keyboard('{F2}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
