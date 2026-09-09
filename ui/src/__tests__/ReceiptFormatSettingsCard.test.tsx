/**
 * @file ReceiptFormatSettingsCard.test.tsx
 * @description The statutory-content editor (W2-C): the card must submit the
 * whole ReceiptContentArgs record through set_receipt_content_scoped, seeded
 * from the effective read and updated by the picker/footer/decimal controls.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import { ReceiptFormatSettingsCard } from '@/features/settings/screens/ReceiptFormatSettingsCard';
import settingsFtl from '@/locales/settings.ftl?raw';

const mocks = vi.hoisted(() => ({
  getFormat: vi.fn(),
  setContent: vi.fn(),
  setLayout: vi.fn(),
}));

vi.mock('@/api/receipt-format', () => ({
  getReceiptFormatScoped: (...args: unknown[]) => mocks.getFormat(...args),
  setReceiptContentScoped: (...args: unknown[]) => mocks.setContent(...args),
  setReceiptLayoutScoped: (...args: unknown[]) => mocks.setLayout(...args),
}));
vi.mock('@/api/locations', () => ({
  getPrimaryLocationScoped: vi.fn(() => Promise.resolve({ id: 'loc-1' })),
}));
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok-1' }),
}));

/** A full effective-format read; the real wire mirrors the core serde. */
const EFFECTIVE = {
  content: {
    requiredFields: ['store_name', 'tax_id'],
    footerText: 'thank you',
    showTax: true,
    showCurrency: false,
    decimalSeparator: 'dot',
  },
  contentSource: 'entity',
  layout: {
    paperWidthMm: 58,
    marginTopMm: 2,
    marginBottomMm: 1,
    marginLeftMm: 0,
    marginRightMm: 0,
    showLogo: true,
    printCopies: 1,
    showTableNumber: false,
    footerNote: null,
  },
  layoutSource: 'workspace',
};

function renderCard() {
  return renderWithProvidersSync(<ReceiptFormatSettingsCard />, settingsFtl);
}

beforeEach(() => {
  mocks.getFormat.mockReset();
  mocks.setContent.mockReset();
  mocks.setLayout.mockReset();
  mocks.getFormat.mockResolvedValue(EFFECTIVE);
  mocks.setContent.mockResolvedValue(EFFECTIVE);
  mocks.setLayout.mockResolvedValue(EFFECTIVE);
});

describe('ReceiptFormatSettingsCard statutory-content editor', () => {
  it('seeds the editor from the effective content read', async () => {
    renderCard();
    await waitFor(() => {
      expect(screen.getByLabelText('Footer text')).toHaveValue('thank you');
    });
    expect(screen.getByLabelText('Tax registration')).toBeChecked();
    expect(screen.getByLabelText('Tax')).not.toBeChecked();
    expect(screen.getByLabelText('Items')).not.toBeChecked();
  });

  it('submits the whole content record on save', async () => {
    renderCard();
    const footer = await screen.findByLabelText('Footer text');
    fireEvent.change(footer, { target: { value: 'statutory footer' } });
    fireEvent.click(screen.getByLabelText('Items'));
    fireEvent.click(screen.getByRole('button', { name: 'Save statutory content' }));
    await waitFor(() => {
      expect(mocks.setContent).toHaveBeenCalledTimes(1);
    });
    expect(mocks.setContent).toHaveBeenCalledWith(
      'tok-1',
      expect.objectContaining({
        footerText: 'statutory footer',
        showTax: true,
        showCurrency: false,
        decimalSeparator: 'dot',
      }),
    );
    const args = mocks.setContent.mock.calls[0]?.[1] as { requiredFields: string[] };
    expect(args.requiredFields).toContain('items');
    expect(args.requiredFields).toContain('store_name');
    expect(args.requiredFields).toContain('tax_id');
  });

  it('renders both save actions distinctly', async () => {
    renderCard();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save statutory content' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Save receipt format' })).toBeInTheDocument();
  });
});
