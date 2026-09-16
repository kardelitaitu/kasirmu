/**
 * @file LocalPaymentSettingsCard.test.tsx
 * @description First direct suite for the local-payment-rails card (regional
 * slice 6) on Settings -> Business Defaults. What the card OWNS and nothing
 * else: which of its four branches renders (loading / load-error / no-location
 * / editor), the provenance mapping from a rail's scope to its Fluent key, the
 * add-rail validation and case-insensitive duplicate rule, the QRIS-only static
 * payload round-trip, the save payload SHAPE (four args, no scope), and the
 * saved/failed status pair.
 *
 * No snapshot: none of these decisions is visible in a tree diff, and a
 * snapshot survives every one of them being inverted.
 *
 * Localization: every assertion below is written against the ENGLISH FTL VALUE
 * from settings.ftl, which is mounted as the real bundle - so a hardcoded
 * string that skipped Fluent would fail the same lookup, and a renamed key
 * would render its JSX fallback instead.
 *
 * What is NOT mocked: the static-QR codec (readStaticQrPayload /
 * writeStaticQrPayload) stays the real implementation from @/api/local-payment.
 * The card's decision is that a QR edit must land INSIDE the parameters bag
 * without dropping the other keys, and that is only testable against the real
 * codec. Only the two scoped IPC calls and the locations read are stubbed.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import { LocalPaymentSettingsCard } from '@/features/settings/screens/LocalPaymentSettingsCard';
import settingsFtl from '@/locales/settings.ftl?raw';

const mocks = vi.hoisted(() => ({
  getPrimary: vi.fn(),
  getMethods: vi.fn(),
  setMethods: vi.fn(),
}));

vi.mock('@/api/locations', () => ({
  getPrimaryLocationScoped: (...args: unknown[]) => mocks.getPrimary(...args),
}));
vi.mock('@/api/local-payment', async (importOriginal) => {
  // The codec (read/writeStaticQrPayload) must stay the REAL one — see the
  // file header — so only the two IPC names below are replaced on the module.
  const real = (await importOriginal()) as Record<string, unknown>;
  return {
    ...real,
    getLocalPaymentMethodsScoped: (...args: unknown[]) => mocks.getMethods(...args),
    setLocalPaymentMethodsScoped: (...args: unknown[]) => mocks.setMethods(...args),
  };
});
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok-1' }),
}));

/**
 * Two rails with different provenance. The qris bag carries an EXTRA key, which
 * is what makes the codec round-trip assertion mean something: a card that
 * replaced the bag instead of editing one key would lose merchant.
 */
const QRIS_BAG = JSON.stringify({ static_qr_payload: '00020120440014', merchant: 'KIOSK-A' });
const RAILS = [
  { rail_code: 'qris', label: 'QRIS', is_enabled: true, parameters: QRIS_BAG, scope: 'entity' },
  { rail_code: 'va-bca', label: 'BCA VA', is_enabled: false, parameters: '{}', scope: 'location' },
];

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function renderCard() {
  return renderWithProvidersSync(<LocalPaymentSettingsCard />, settingsFtl);
}

beforeEach(() => {
  mocks.getPrimary.mockReset();
  mocks.getMethods.mockReset();
  mocks.setMethods.mockReset();
  mocks.getPrimary.mockResolvedValue({ id: 'loc-1' });
  mocks.getMethods.mockResolvedValue(RAILS.map((r) => ({ ...r })));
  mocks.setMethods.mockImplementation(async (_t: string, _l: string, payload: unknown[]) =>
    payload.map((r) => ({ ...(r as object), scope: 'location' })));
});

describe('LocalPaymentSettingsCard', () => {
  it('shows the loading branch before the read resolves, then the rails', async () => {
    const gate = deferred<unknown[]>();
    mocks.getPrimary.mockResolvedValue({ id: 'loc-1' });
    mocks.getMethods.mockReturnValue(gate.promise);

    renderCard();

    // The loading branch wins over the editor while the read is in flight.
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('QRIS')).not.toBeInTheDocument();

    gate.resolve(RAILS.map((r) => ({ ...r })));
    await waitFor(() => {
      expect(screen.getByText('QRIS')).toBeInTheDocument();
    });
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('short-circuits to the no-location branch and never asks for rails', async () => {
    mocks.getPrimary.mockResolvedValue(null);

    renderCard();

    await waitFor(() => {
      expect(screen.getByText('No location to configure yet.')).toBeInTheDocument();
    });
    // No editor chrome at all: not just hidden, never mounted.
    expect(screen.queryByText('Add rail')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save payment methods' })).not.toBeInTheDocument();
    expect(mocks.getMethods).not.toHaveBeenCalled();
  });

  it('renders the localised load-error copy, not the raw rejection, and drops the editor', async () => {
    mocks.getMethods.mockRejectedValue(new Error('raw backend text that must not surface'));

    renderCard();

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('Could not load the payment methods.');
    });
    expect(screen.queryByText(/raw backend text/)).not.toBeInTheDocument();
    expect(screen.queryByText('Local payment methods')).not.toBeInTheDocument();
  });

  it('maps each rail scope to its own provenance line', async () => {
    renderCard();

    await waitFor(() => {
      expect(screen.getByText('QRIS')).toBeInTheDocument();
    });
    // entity -> market default, location -> set here. Swapping the two keys in
    // provenanceKey() fails exactly these two lines.
    expect(screen.getByText('Market default (legal entity)')).toBeInTheDocument();
    expect(screen.getByText('Set at this site')).toBeInTheDocument();
  });

  it('offers the static-QR editor only on the qris rail', async () => {
    renderCard();

    const areas = await screen.findAllByLabelText('Static QR payload (EMVCo string)');
    expect(areas).toHaveLength(1);
    expect(areas[0]).toHaveValue('00020120440014');
    // The seeded value came out of the parameters BAG, not from the row itself.
    expect(screen.queryByDisplayValue('BCA VA')).not.toBeInTheDocument();
  });

  it('writes a QR edit back into the bag without dropping the other parameter', async () => {
    renderCard();

    const area = await screen.findByLabelText('Static QR payload (EMVCo string)');
    fireEvent.change(area, { target: { value: 'NEW-PAYLOAD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save payment methods' }));

    await waitFor(() => {
      expect(mocks.setMethods).toHaveBeenCalledTimes(1);
    });
    const payload = mocks.setMethods.mock.calls[0]?.[2] as { parameters: string }[];
    const qris = JSON.parse(payload[0]!.parameters) as Record<string, string>;
    expect(qris['static_qr_payload']).toBe('NEW-PAYLOAD');
    expect(qris['merchant']).toBe('KIOSK-A');
  });

  it('clears the payload key when the field is emptied', async () => {
    renderCard();

    const area = await screen.findByLabelText('Static QR payload (EMVCo string)');
    fireEvent.change(area, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save payment methods' }));

    await waitFor(() => {
      expect(mocks.setMethods).toHaveBeenCalled();
    });
    const payload = mocks.setMethods.mock.calls[0]?.[2] as { parameters: string }[];
    const qris = JSON.parse(payload[0]!.parameters) as Record<string, string>;
    expect(qris['static_qr_payload']).toBeUndefined();
    expect(qris['merchant']).toBe('KIOSK-A');
  });

  it('sends the four-arg rail shape with the toggled state, and no scope', async () => {
    renderCard();
    await screen.findByText('QRIS');

    const qrisToggle = screen.getAllByRole('checkbox')[0]!;
    // First row is qris (seeded enabled); toggle it off.
    fireEvent.click(qrisToggle);
    fireEvent.click(screen.getByRole('button', { name: 'Save payment methods' }));

    await waitFor(() => {
      expect(mocks.setMethods).toHaveBeenCalledWith(
        'tok-1',
        'loc-1',
        [
          { rail_code: 'qris', label: 'QRIS', is_enabled: false, parameters: QRIS_BAG },
          { rail_code: 'va-bca', label: 'BCA VA', is_enabled: false, parameters: '{}' },
        ],
      );
    });
    // scope is provenance-only: echoing it back would let the client assert a
    // tier it does not own, so the payload must not carry it.
    const payload = mocks.setMethods.mock.calls[0]?.[2] as {
      rail_code: string;
      label: string;
      is_enabled: boolean;
      parameters: string;
    }[];
    expect(payload[0]).not.toHaveProperty('scope');
    // The seeded row was DISABLED and must have been sent that way untouched.
    expect(payload[1]!.is_enabled).toBe(false);
  });

  it('keeps Add rail disabled until both fields carry a non-blank value', async () => {
    renderCard();
    await screen.findByText('QRIS');

    const add = screen.getByRole('button', { name: 'Add rail' });
    expect(add).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Rail code'), { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText('Display label'), { target: { value: 'GoPay' } });
    // Whitespace is not a rail code: trim-before-enable, not length-before-enable.
    expect(add).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Rail code'), { target: { value: ' ewallet-ovo ' } });
    expect(add).toBeEnabled();
    fireEvent.click(add);

    // The stored row is trimmed and seeded enabled with an empty bag.
    await waitFor(() => {
      expect(mocks.setMethods).not.toHaveBeenCalled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save payment methods' }));
    await waitFor(() => {
      expect(mocks.setMethods).toHaveBeenCalled();
    });
    const payload = mocks.setMethods.mock.calls[0]?.[2] as { rail_code: string }[];
    expect(payload[2]).toEqual({ rail_code: 'ewallet-ovo', label: 'GoPay', is_enabled: true, parameters: '{}' });
  });

  it('rejects a duplicate rail code case-insensitively instead of adding a second row', async () => {
    renderCard();
    await screen.findByText('QRIS');

    fireEvent.change(screen.getByLabelText('Rail code'), { target: { value: 'QRIS' } });
    fireEvent.change(screen.getByLabelText('Display label'), { target: { value: 'Duplicate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rail' }));

    expect(screen.queryByText('Duplicate')).not.toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    // And the fields stay filled, so the operator sees what was refused.
    expect(screen.getByLabelText('Rail code')).toHaveValue('QRIS');
  });

  it('runs the save status transition: Saving, then Saved, then dirty again on the next edit', async () => {
    const gate = deferred<unknown[]>();
    renderCard();
    await screen.findByText('QRIS');
    mocks.setMethods.mockReturnValue(gate.promise);

    fireEvent.click(screen.getByRole('button', { name: 'Save payment methods' }));
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();

    gate.resolve(RAILS.map((r) => ({ ...r })));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Payment methods saved.');
    });
    // The button is back to its idle label once the write lands.
    expect(screen.getByRole('button', { name: 'Save payment methods' })).toBeEnabled();

    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('reports a failed save on the alert role and never claims success', async () => {
    mocks.setMethods.mockRejectedValue(new Error('FORBIDDEN_PARAMETER'));

    renderCard();
    await screen.findByText('QRIS');
    fireEvent.click(screen.getByRole('button', { name: 'Save payment methods' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not save the payment methods.');
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
