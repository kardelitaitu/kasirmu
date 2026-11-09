import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import giftCardsFtl from '@/locales/gift-cards.ftl?raw';


// Mock the API module before importing the component.
vi.mock('@/api/giftCards', () => ({
  issueGiftCard: vi.fn(),
}));

// Mock the barcode generator for deterministic card numbers.
vi.mock('@/utils/giftCardBarcode', () => ({
  generateGiftCardNumber: vi.fn(() => 'GC-TEST12345678'),
  isGiftCardBarcode: vi.fn(() => true),
}));

import IssueGiftCardModal from '@/features/gift-cards/IssueGiftCardModal';
import { issueGiftCard } from '@/api/giftCards';

// The CurrencyProvider reads its value through \`invoke('get_default_currency')\`, and the
// ambient tauri mock answers IDR. \`fallback\` on the provider is NOT enough to pick a
// currency: it is only used while loading or on failure, and the ambient call SUCCEEDS,
// so its IDR wins and a \`fallback="USD"\` test silently measures IDR. Mocking the command
// is how the repo's other currency tests pin it (PaymentModalEdgeCases.test.tsx).
const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

/** Answer \`get_default_currency*\` with \`code\`, other commands with an empty object. */
function mockDefaultCurrency(code: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invokeMock.mockImplementation((cmd: string): any => {
    if (cmd === 'get_default_currency' || cmd === 'get_default_currency_scoped') {
      return Promise.resolve(code);
    }
    return Promise.resolve({});
  });
}



describe('IssueGiftCardModal', () => {
  // Reset between tests. The suite queues `mockResolvedValueOnce`/`mockRejectedValueOnce`
  // and had no reset, so it depended on every queued value being CONSUMED — a test that
  // failed before reaching its submit left the queue primed and the NEXT test's
  // `mockRejectedValueOnce` then sat behind a stale resolved value. That is how a
  // failure-path test turned green-by-luck here (verified: it passed in isolation and
  // failed in the full run). `mockReset` makes each case independent of its neighbours.
  beforeEach(() => {
    vi.mocked(issueGiftCard).mockReset();
  });

  it('renders the form with default generated card number', () => {
    renderWithFluentSync(<IssueGiftCardModal sessionToken="tok-1" onClose={vi.fn()} onIssued={vi.fn()} />, giftCardsFtl);
    expect(screen.getByText('Issue Gift Card')).toBeInTheDocument();
    expect(screen.getByLabelText('Card number')).toHaveValue('GC-TEST12345678');
    expect(screen.getByLabelText('Initial amount')).toBeInTheDocument();
    expect(screen.getByLabelText('Issued to')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /issue card/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('shows validation error when amount is empty', async () => {
    renderWithFluentSync(<IssueGiftCardModal sessionToken="tok-1" onClose={vi.fn()} onIssued={vi.fn()} />, giftCardsFtl);
    await userEvent.click(screen.getByRole('button', { name: /issue card/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('Amount must be positive');
  });

  it('shows validation error when amount is zero or negative', async () => {
    renderWithFluentSync(<IssueGiftCardModal sessionToken="tok-1" onClose={vi.fn()} onIssued={vi.fn()} />, giftCardsFtl);
    const amountInput = screen.getByLabelText('Initial amount');
    await userEvent.type(amountInput, '0');
    await userEvent.click(screen.getByRole('button', { name: /issue card/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('Amount must be positive');
  });

  it('shows validation error when card number is empty', async () => {
    renderWithFluentSync(<IssueGiftCardModal sessionToken="tok-1" onClose={vi.fn()} onIssued={vi.fn()} />, giftCardsFtl);
    const cardInput = screen.getByLabelText('Card number');
    await userEvent.clear(cardInput);
    const amountInput = screen.getByLabelText('Initial amount');
    await userEvent.type(amountInput, '50000');
    await userEvent.click(screen.getByRole('button', { name: /issue card/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid card number format');
  });

  it('calls onClose when cancel is clicked', async () => {
    const onClose = vi.fn();
    renderWithFluentSync(<IssueGiftCardModal sessionToken="tok-1" onClose={onClose} onIssued={vi.fn()} />, giftCardsFtl);
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('calls issueGiftCard and onIssued on successful submit', async () => {
    const mockIssue = issueGiftCard as ReturnType<typeof vi.fn>;
    mockIssue.mockResolvedValueOnce(undefined);
    const onIssued = vi.fn();

    renderWithFluentSync(<IssueGiftCardModal sessionToken="tok-1" onClose={vi.fn()} onIssued={onIssued} />, giftCardsFtl);
    const amountInput = screen.getByLabelText('Initial amount');
    await userEvent.type(amountInput, '50000');
    await userEvent.click(screen.getByRole('button', { name: /issue card/i }));

    expect(mockIssue).toHaveBeenCalledTimes(1);
    expect(mockIssue).toHaveBeenCalledWith(
      'tok-1',
      expect.objectContaining({
        card_number: 'GC-TEST12345678',
        initial_amount_minor: 50000,
        currency: 'IDR',
      }),
    );

    // Wait for the async handler to resolve.
    await vi.waitFor(() => {
      expect(onIssued).toHaveBeenCalledTimes(1);
    });
  });

  it('issues a card once for a double click while the first is in flight', async () => {
    // Card numbers are UNIQUE, so the replay is refused -- and the refusal is reported as
    // `gift-cards-error-issue`. On a money-minting call that reads as "the card was not
    // issued" while the first tap already created it.
    const mockIssue = issueGiftCard as ReturnType<typeof vi.fn>;
    let releaseIssue: ((v: unknown) => void) | undefined;
    mockIssue.mockImplementation(
      () => new Promise((resolve) => { releaseIssue = resolve; }),
    );
    const onIssued = vi.fn();

    renderWithFluentSync(<IssueGiftCardModal sessionToken="tok-1" onClose={vi.fn()} onIssued={onIssued} />, giftCardsFtl);
    await userEvent.type(screen.getByLabelText('Initial amount'), '50000');

    const issueBtn = screen.getByRole('button', { name: /issue card/i });
    // fireEvent, not userEvent.click: userEvent awaits its own act(), which flushes the
    // pending chain so the first issue would have settled and the clicks would never
    // overlap. The disabled flag React set is dropped for the second click so the atomic
    // guard is what is measured, not the DOM.
    await act(async () => {
      fireEvent.click(issueBtn);
      issueBtn.removeAttribute('disabled');
      fireEvent.click(issueBtn);
    });

    expect(
      mockIssue.mock.calls.length,
      'a double click on Issue Card called issueGiftCard twice; card_number is UNIQUE so ' +
        'the second is refused and reported as an issue failure',
    ).toBe(1);

    releaseIssue?.(undefined);
    await vi.waitFor(() => expect(onIssued).toHaveBeenCalledTimes(1));
  });

  it('does not strand the re-entry guard when validation refuses the submit', async () => {
    // The guard is taken AFTER validation, so a rejected attempt must leave it clear.
    // If the ordering is ever flipped, the first invalid submit would set the flag with no
    // `finally` to clear it and the form could never be saved again.
    const mockIssue = issueGiftCard as ReturnType<typeof vi.fn>;
    mockIssue.mockResolvedValue(undefined);

    renderWithFluentSync(<IssueGiftCardModal sessionToken="tok-1" onClose={vi.fn()} onIssued={vi.fn()} />, giftCardsFtl);

    // Submit with no amount: refused before the guard, so nothing is sent.
    await userEvent.click(screen.getByRole('button', { name: /issue card/i }));
    expect(mockIssue).not.toHaveBeenCalled();

    // Now a valid amount must still be able to issue.
    await userEvent.type(screen.getByLabelText('Initial amount'), '50000');
    await userEvent.click(screen.getByRole('button', { name: /issue card/i }));

    await vi.waitFor(() => expect(mockIssue).toHaveBeenCalledTimes(1));
  });

  // ── the amount is in the STORE's currency ─────────────────────────────
  //
  // This form hardcoded BOTH halves of the money contract to IDR: it sent
  // \`currency: 'IDR'\` whatever the store billed in, and it read the typed amount as
  // raw minor units (\`parseInt\`). On an IDR till the two errors cancel, which is why
  // nothing caught them; on a USD till they compound. Minor units are
  // exponent-relative (IDR 0, USD 2), so an operator who types \`50\` meaning $50.00
  // was recording 50 minor units — $0.50, a 100x under-issue, on a card that can be
  // redeemed. The rest of this feature is currency-aware (every balance is rendered
  // with \`gc.card.currency\`); this modal was the exception.
  describe('currency awareness', () => {
    /** Render inside a provider pinned to \`code\`, and wait for it to settle. */
    async function renderWithCurrency(code: string) {
      mockDefaultCurrency(code);
      renderWithFluentSync(
        <CurrencyProvider fallback={code}>
          <IssueGiftCardModal sessionToken="tok-1" onClose={vi.fn()} onIssued={vi.fn()} />
        </CurrencyProvider>,
        giftCardsFtl,
      );
      // The provider resolves asynchronously; the placeholder carries the currency,
      // so waiting on it proves the value reached the component before we type.
      await waitFor(() => {
        expect(screen.getByLabelText('Initial amount')).toHaveAttribute(
          'placeholder',
          `Amount in ${code}`,
        );
      });
    }

    it('interprets the typed amount in the store currency (USD: 50 -> $50.00)', async () => {
      const mockIssue = issueGiftCard as ReturnType<typeof vi.fn>;
      mockIssue.mockResolvedValueOnce(undefined);
      await renderWithCurrency('USD');

      await userEvent.type(screen.getByLabelText('Initial amount'), '50');
      await userEvent.click(screen.getByRole('button', { name: /issue card/i }));

      expect(mockIssue).toHaveBeenCalledWith(
        'tok-1',
        expect.objectContaining({
          // $50.00, not 50 minor units ($0.50).
          initial_amount_minor: 5000,
          currency: 'USD',
        }),
      );
    });

    it('interprets IDR at exponent 0 (50000 -> Rp 50.000)', async () => {
      const mockIssue = issueGiftCard as ReturnType<typeof vi.fn>;
      mockIssue.mockResolvedValueOnce(undefined);
      await renderWithCurrency('IDR');

      await userEvent.type(screen.getByLabelText('Initial amount'), '50000');
      await userEvent.click(screen.getByRole('button', { name: /issue card/i }));

      expect(mockIssue).toHaveBeenCalledWith(
        'tok-1',
        expect.objectContaining({ initial_amount_minor: 50000, currency: 'IDR' }),
      );
    });

    it('accepts a decimal amount on a 2-exponent currency', async () => {
      // \`50.75\` is a valid USD amount; the old IDR-only \`/^\\d+$/\` regex
      // rejected it outright.
      const mockIssue = issueGiftCard as ReturnType<typeof vi.fn>;
      mockIssue.mockResolvedValueOnce(undefined);
      await renderWithCurrency('USD');

      await userEvent.type(screen.getByLabelText('Initial amount'), '50.75');
      await userEvent.click(screen.getByRole('button', { name: /issue card/i }));

      expect(mockIssue).toHaveBeenCalledWith(
        'tok-1',
        expect.objectContaining({ initial_amount_minor: 5075, currency: 'USD' }),
      );
    });
  });

  it('shows error when issueGiftCard fails', async () => {
    const mockIssue = issueGiftCard as ReturnType<typeof vi.fn>;
    mockIssue.mockRejectedValueOnce(new Error('Network error'));

    renderWithFluentSync(<IssueGiftCardModal sessionToken="tok-1" onClose={vi.fn()} onIssued={vi.fn()} />, giftCardsFtl);
    const amountInput = screen.getByLabelText('Initial amount');
    await userEvent.type(amountInput, '50000');
    await userEvent.click(screen.getByRole('button', { name: /issue card/i }));

    await vi.waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to issue gift card');
    });
  });

  it('allows entering an optional customer name', async () => {
    renderWithFluentSync(<IssueGiftCardModal sessionToken="tok-1" onClose={vi.fn()} onIssued={vi.fn()} />, giftCardsFtl);
    const nameInput = screen.getByLabelText('Issued to');
    await userEvent.type(nameInput, 'Alice');
    expect(nameInput).toHaveValue('Alice');
  });

  it('allows editing the card number manually', async () => {
    renderWithFluentSync(<IssueGiftCardModal sessionToken="tok-1" onClose={vi.fn()} onIssued={vi.fn()} />, giftCardsFtl);
    const cardInput = screen.getByLabelText('Card number');
    await userEvent.clear(cardInput);
    await userEvent.type(cardInput, 'GC-MYCARD');
    expect(cardInput).toHaveValue('GC-MYCARD');
  });

  it('has no PIN field (removed 2026-09-29 — nothing ever verified it)', () => {
    renderWithFluentSync(<IssueGiftCardModal sessionToken="tok-1" onClose={vi.fn()} onIssued={vi.fn()} />, giftCardsFtl);
    expect(screen.queryByLabelText('PIN')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('PIN (optional)')).not.toBeInTheDocument();
    // The issuance form carries no password-type input at all.
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it('rejects decimal amounts with validation error', async () => {
    renderWithFluentSync(<IssueGiftCardModal sessionToken="tok-1" onClose={vi.fn()} onIssued={vi.fn()} />, giftCardsFtl);
    const amountInput = screen.getByLabelText('Initial amount');
    await userEvent.clear(amountInput);
    await userEvent.type(amountInput, '50000.75');
    await userEvent.click(screen.getByRole('button', { name: /issue card/i }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('clears error when editing issuedTo after validation failure', async () => {
    renderWithFluentSync(<IssueGiftCardModal sessionToken="tok-1" onClose={vi.fn()} onIssued={vi.fn()} />, giftCardsFtl);
    await userEvent.click(screen.getByRole('button', { name: /issue card/i }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    const nameInput = screen.getByLabelText('Issued to');
    await userEvent.type(nameInput, 'Alice');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears error when editing the card number after validation failure', async () => {
    renderWithFluentSync(<IssueGiftCardModal sessionToken="tok-1" onClose={vi.fn()} onIssued={vi.fn()} />, giftCardsFtl);
    await userEvent.click(screen.getByRole('button', { name: /issue card/i }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    const cardInput = screen.getByLabelText('Card number');
    await userEvent.type(cardInput, 'X');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('closes when backdrop overlay is clicked', async () => {
    const onClose = vi.fn();
    renderWithFluentSync(<IssueGiftCardModal sessionToken="tok-1" onClose={onClose} onIssued={vi.fn()} />, giftCardsFtl);
    const overlay = screen.getByRole('presentation');
    await userEvent.click(overlay);
    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('does not close when modal panel is clicked', async () => {
    const onClose = vi.fn();
    renderWithFluentSync(<IssueGiftCardModal sessionToken="tok-1" onClose={onClose} onIssued={vi.fn()} />, giftCardsFtl);
    const panel = document.querySelector('.gift-cards-modal')!;
    await userEvent.click(panel);
    expect(onClose).not.toHaveBeenCalled();
  });
});
