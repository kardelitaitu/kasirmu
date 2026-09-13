/**
 * @file StatutoryNumberingCard.test.tsx
 * @description The numbering card's contract, in the order it can be got wrong:
 * the form must be SEEDED from the (entity, kind) read (a blank form would
 * overwrite a live series), the read must FOLLOW a pair change (one card shows
 * many series), the save must submit the whole args record and then RE-READ
 * (the write returns nothing, so only the row proves the counter survived), and
 * the counter itself must never be an input — a reconfiguration may not look
 * like it can reset a statutory series.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import { StatutoryNumberingCard } from '@/features/settings/screens/StatutoryNumberingCard';
import settingsFtl from '@/locales/settings.ftl?raw';

const mocks = vi.hoisted(() => ({
  listEntities: vi.fn(),
  getSeq: vi.fn(),
  upsert: vi.fn(),
  listAll: vi.fn(),
}));

vi.mock('@/api/legalEntities', () => ({
  listLegalEntitiesScoped: (...args: unknown[]) => mocks.listEntities(...args),
}));
vi.mock('@/api/fiscal', () => ({
  getDocumentNumberSequenceScoped: (...args: unknown[]) => mocks.getSeq(...args),
  upsertDocumentNumberSequenceScoped: (...args: unknown[]) => mocks.upsert(...args),
  listDocumentNumberSequencesScoped: (...args: unknown[]) => mocks.listAll(...args),
}));
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok-1' }),
}));

/** A configured series, mid-run: 41 numbers already issued. */
const SERIES = {
  id: 'seq-1',
  legalEntityId: 'ent-1',
  documentKind: 'receipt',
  prefix: 'NO.',
  currentValue: 41,
  resetPeriod: 'monthly',
  padding: 5,
  periodKey: '2026-09',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const ENTITIES = [
  {
    id: 'ent-1',
    tenantId: 'default',
    name: 'PT Utama',
    legalName: 'PT Utama',
    registrationNumber: '',
    taxId: '',
    status: 'active' as const,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
];

function renderCard() {
  return renderWithProvidersSync(<StatutoryNumberingCard />, settingsFtl);
}

beforeEach(() => {
  mocks.listEntities.mockReset().mockResolvedValue(ENTITIES);
  mocks.getSeq.mockReset().mockResolvedValue(SERIES);
  mocks.upsert.mockReset().mockResolvedValue(undefined);
  mocks.listAll.mockReset().mockResolvedValue([SERIES]);
});

describe('StatutoryNumberingCard', () => {
  it('seeds every field from the pair read', async () => {
    renderCard();
    await waitFor(() => {
      expect(screen.getByLabelText('Prefix')).toHaveValue('NO.');
    });
    expect(screen.getByLabelText('Zero padding')).toHaveValue(5);
    expect(screen.getByLabelText('Resets')).toHaveValue('monthly');
    expect(screen.getByText(/Last number issued: 41/)).toBeInTheDocument();
    expect(mocks.getSeq).toHaveBeenCalledWith('tok-1', 'ent-1', 'receipt');
  });

  it('shows the counter as context and never as an input', async () => {
    renderCard();
    await waitFor(() => {
      expect(screen.getByText(/Last number issued: 41/)).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/current number|counter|Last number/i)).toBeNull();
    expect(
      screen.getByText('Changing prefix, padding or period never resets this counter.'),
    ).toBeInTheDocument();
  });

  it('offers inert defaults for an unconfigured pair', async () => {
    mocks.getSeq.mockResolvedValue(null);
    renderCard();
    await waitFor(() => {
      expect(screen.getByText('This pair has no series yet — saving creates one from zero.'));
    });
    expect(screen.getByLabelText('Prefix')).toHaveValue('');
    expect(screen.getByLabelText('Zero padding')).toHaveValue(0);
    expect(screen.getByLabelText('Resets')).toHaveValue('never');
  });

  it('reads the pair it was switched to', async () => {
    renderCard();
    await waitFor(() => {
      expect(mocks.getSeq).toHaveBeenCalledWith('tok-1', 'ent-1', 'receipt');
    });
    fireEvent.change(screen.getByLabelText('Document kind'), { target: { value: 'invoice' } });
    await waitFor(() => {
      expect(mocks.getSeq).toHaveBeenCalledWith('tok-1', 'ent-1', 'invoice');
    });
  });

  it('submits the whole args record, then re-reads the row it wrote', async () => {
    renderCard();
    await waitFor(() => {
      expect(screen.getByLabelText('Prefix')).toHaveValue('NO.');
    });
    fireEvent.change(screen.getByLabelText('Prefix'), { target: { value: 'FB' } });
    fireEvent.change(screen.getByLabelText('Zero padding'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save series' }));
    await waitFor(() => {
      expect(mocks.upsert).toHaveBeenCalledWith(
        'tok-1',
        expect.objectContaining({ legalEntityId: 'ent-1', documentKind: 'receipt' }),
      );
    });
    expect(mocks.upsert.mock.calls[0]?.[1]).toEqual({
      legalEntityId: 'ent-1',
      documentKind: 'receipt',
      prefix: 'FB',
      resetPeriod: 'monthly',
      padding: 3,
    });
    // Re-read proves the counter survived the write; the card does not patch
    // its own copy of it.
    await waitFor(() => {
      expect(mocks.getSeq).toHaveBeenLastCalledWith('tok-1', 'ent-1', 'receipt');
    });
    expect(screen.getByText('Series saved')).toBeInTheDocument();
  });

  it('reports a failed save without pretending it worked', async () => {
    mocks.upsert.mockRejectedValue(new Error('nope'));
    renderCard();
    await waitFor(() => {
      expect(screen.getByLabelText('Prefix')).toHaveValue('NO.');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save series' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.queryByText('Series saved')).toBeNull();
  });

  // ── W5-C: the series overview (the card finally SHOWS what exists) ──

  it('lists every configured series with its live counter', async () => {
    const invoice = {
      ...SERIES,
      id: 'seq-2',
      documentKind: 'invoice',
      prefix: 'F/',
      currentValue: 7,
    };
    mocks.listAll.mockResolvedValue([SERIES, invoice]);
    renderCard();
    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument();
    });
    // Entity name resolved from the loaded entity list, not the raw id
    // (at least once per table row; the entity <select> adds one more).
    expect(screen.getAllByText('PT Utama').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('NO.')).toBeInTheDocument();
    expect(screen.getByText('F/')).toBeInTheDocument();
    expect(screen.getAllByText('Invoice').length).toBeGreaterThan(0);
    expect(screen.getByText('7')).toBeInTheDocument();
    // The counter column shows the LIVE value, exactly what the next
    // statutory number continues from.
    expect(screen.getByText('41')).toBeInTheDocument();
  });

  it('shows the overview empty state when no series exists yet', async () => {
    mocks.listAll.mockResolvedValue([]);
    renderCard();
    await waitFor(() => {
      expect(
        screen.getByText('No series configured yet — save one above to see it here.'),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole('table')).toBeNull();
  });
});
