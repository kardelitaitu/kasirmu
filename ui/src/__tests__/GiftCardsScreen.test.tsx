import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import { ToastProvider } from '@/components/Toast';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import giftCardsFtl from '@/locales/gift-cards.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

vi.mock('@/api/giftCards', () => ({
  listGiftCards: vi.fn(),
  freezeGiftCard: vi.fn(),
  unfreezeGiftCard: vi.fn(),
  topUpGiftCard: vi.fn(),
}));

// The CurrencyProvider resolves through \`invoke('get_default_currency')\`; the ambient
// tauri mock answers IDR. Pinning the command is how the repo's other currency tests
// set it (PaymentModalEdgeCases.test.tsx) — \`fallback\` alone is NOT enough, because it
// is only used while loading or on failure and the ambient call succeeds.
const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

function mockDefaultCurrency(code: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invokeMock.mockImplementation((cmd: string): any => {
    if (cmd === 'get_default_currency' || cmd === 'get_default_currency_scoped') {
      return Promise.resolve(code);
    }
    return Promise.resolve({});
  });
}

// Mock WorkspaceContext so GiftCardsScreen can use useWorkspace.
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok-test', activeWorkspace: null, logout: vi.fn() }),
  WorkspaceProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Mock the IssueGiftCardModal child component.
vi.mock('@/features/gift-cards/IssueGiftCardModal', () => ({
  default: ({ onClose, onIssued }: { onClose: () => void; onIssued: () => void }) => (
    <div role="dialog" aria-label="issue-modal">
      <button type="button" onClick={onClose}>Close Issue</button>
      <button type="button" onClick={onIssued}>Card Issued</button>
    </div>
  ),
}));

import GiftCardsScreen from '@/features/gift-cards/GiftCardsScreen';
import { listGiftCards, freezeGiftCard, unfreezeGiftCard, topUpGiftCard } from '@/api/giftCards';

const mockListGiftCards = listGiftCards as ReturnType<typeof vi.fn>;
const mockFreezeGiftCard = freezeGiftCard as ReturnType<typeof vi.fn>;
const mockUnfreezeGiftCard = unfreezeGiftCard as ReturnType<typeof vi.fn>;
const mockTopUpGiftCard = topUpGiftCard as ReturnType<typeof vi.fn>;

// ── FAST_WAIT: 5ms polling for async assertions ────────────────────────
// Reduces waitFor overhead from 50ms (default) to 5ms per poll cycle.
const FAST_WAIT = { interval: 5, timeout: 500 } as const;

const sampleCards = [
  {
    card: {
      id: 'gc-1', card_number: 'GC-001', pin: '1234',
      initial_balance_minor: 100000, current_balance_minor: 75000,
      currency: 'IDR', status: 'active', issued_to: 'Alice',
      issue_date: '2026-06-01', expiry_date: '2027-06-01',
      created_by: 'user-1', updated_at: '2026-06-01',
    },
    transactions: [
      { id: 'tx1', gift_card_id: 'gc-1', sale_id: 'sale-1', txn_type: 'redeem',
        amount_minor: -25000, balance_after_minor: 75000, notes: 'POS sale', created_at: '2026-06-15' },
    ],
  },
  {
    card: {
      id: 'gc-2', card_number: 'GC-002', pin: '5678',
      initial_balance_minor: 50000, current_balance_minor: 0,
      currency: 'IDR', status: 'redeemed', issued_to: null,
      issue_date: '2026-05-01', expiry_date: null,
      created_by: 'user-1', updated_at: '2026-05-20',
    },
    transactions: [
      { id: 'tx2', gift_card_id: 'gc-2', sale_id: 'sale-2', txn_type: 'redeem',
        amount_minor: -50000, balance_after_minor: 0, notes: '', created_at: '2026-05-15' },
    ],
  },
  {
    card: {
      id: 'gc-3', card_number: 'GC-003', pin: '9012',
      initial_balance_minor: 200000, current_balance_minor: 200000,
      currency: 'IDR', status: 'frozen', issued_to: 'Bob',
      issue_date: '2026-04-01', expiry_date: '2027-04-01',
      created_by: 'user-1', updated_at: '2026-06-10',
    },
    transactions: [],
  },
];

// ── Helpers ────────────────────────────────────────────────────────────
// All helpers use fireEvent for synchronous interaction. Tests that need
// to wait for async state updates (API data, expand/collapse re-render)
// use await waitFor(..., FAST_WAIT) after the fireEvent call.

/** Wait for a card to appear in the list, then click it to expand details. */
async function expandCard(cardNumber: string) {
  await waitFor(() => {
    expect(screen.getByText(cardNumber)).toBeInTheDocument();
  }, FAST_WAIT);
  fireEvent.click(screen.getByText(cardNumber));
}

/** Wait for a button by name to appear, then click it. */
async function waitAndClickButton(name: RegExp) {
  await waitFor(() => {
    expect(screen.getByRole('button', { name })).toBeInTheDocument();
  }, FAST_WAIT);
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('GiftCardsScreen', () => {
  // ── List rendering ───────────────────────────────────────────
  it('renders the title and Issue New Card button', async () => {
    mockListGiftCards.mockResolvedValue([]);
    renderWithFluentSync(<ToastProvider><GiftCardsScreen /></ToastProvider>, giftCardsFtl, sharedFtl);
    expect(screen.getByText('Gift Cards')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /issue new card/i })).toBeInTheDocument();
  });

  it('loads and displays gift cards in the list', async () => {
    mockListGiftCards.mockResolvedValue(sampleCards);
    renderWithFluentSync(<ToastProvider><GiftCardsScreen /></ToastProvider>, giftCardsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('GC-001')).toBeInTheDocument();
    }, FAST_WAIT);
    expect(screen.getByText('GC-002')).toBeInTheDocument();
    expect(screen.getByText('GC-003')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('shows loading skeleton initially', async () => {
    mockListGiftCards.mockReturnValue(new Promise(() => {}));
    const { container } = renderWithFluentSync(<ToastProvider><GiftCardsScreen /></ToastProvider>, giftCardsFtl, sharedFtl);

    const skeleton = container.querySelector('[aria-hidden="true"].gift-cards-loading-skeleton');
    expect(skeleton).toBeInTheDocument();
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  // A rejected listGiftCards used to be reported only by an auto-dismissing
  // toast, so the render fell through to the empty state and claimed there are
  // no gift cards — on the screen that shows the balances the store owes
  // customers, the one place an all-clear is actively dangerous.
  it('reports a failed gift-card read instead of claiming there are none', async () => {
    mockListGiftCards.mockRejectedValue(new Error('Server offline'));
    renderWithFluentSync(<ToastProvider><GiftCardsScreen /></ToastProvider>, giftCardsFtl, sharedFtl);

    await waitFor(() => {
      expect(document.querySelector('.gift-cards-load-error')).toBeTruthy();
    }, FAST_WAIT);
    expect(screen.queryByText(/no gift cards found/i)).toBeNull();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('shows empty state when no cards exist', async () => {
    mockListGiftCards.mockResolvedValue([]);
    renderWithFluentSync(<ToastProvider><GiftCardsScreen /></ToastProvider>, giftCardsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText(/no gift cards found/i)).toBeInTheDocument();
    }, FAST_WAIT);
  });

  it('renders status badges for each card', async () => {
    mockListGiftCards.mockResolvedValue(sampleCards);
    renderWithFluentSync(<ToastProvider><GiftCardsScreen /></ToastProvider>, giftCardsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('active')).toBeInTheDocument();
    }, FAST_WAIT);
    expect(screen.getByText('redeemed')).toBeInTheDocument();
    expect(screen.getByText('frozen')).toBeInTheDocument();
  });

  it('renders the search input and status filter dropdown', async () => {
    mockListGiftCards.mockResolvedValue([]);
    renderWithFluentSync(<ToastProvider><GiftCardsScreen /></ToastProvider>, giftCardsFtl, sharedFtl);

    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    // Status filter options rendered from the <select>.
    expect(screen.getByText('All Statuses')).toBeInTheDocument();
  });

  // ── Expand/collapse ──────────────────────────────────────────
  it('expands card details when summary is clicked', async () => {
    mockListGiftCards.mockResolvedValue(sampleCards);
    renderWithFluentSync(<ToastProvider><GiftCardsScreen /></ToastProvider>, giftCardsFtl, sharedFtl);

    await expandCard('GC-001');

    await waitFor(() => {
      expect(screen.getByText('Initial Balance')).toBeInTheDocument();
    }, FAST_WAIT);
    expect(screen.getByText('Issued')).toBeInTheDocument();
    expect(screen.getByText('Expires')).toBeInTheDocument();
  });

  it('shows transaction table in expanded detail', async () => {
    mockListGiftCards.mockResolvedValue(sampleCards);
    renderWithFluentSync(<ToastProvider><GiftCardsScreen /></ToastProvider>, giftCardsFtl, sharedFtl);

    await expandCard('GC-001');

    await waitFor(() => {
      expect(screen.getByText('Recent Transactions')).toBeInTheDocument();
      // "Redeemed" also appears in the status filter option, so assert it's
      // present at least once (the localized txn type, not the raw backend key).
      expect(screen.getAllByText('Redeemed').length).toBeGreaterThan(0);
    }, FAST_WAIT);
  });

  it('collapses detail when summary is clicked again', async () => {
    mockListGiftCards.mockResolvedValue(sampleCards);
    renderWithFluentSync(<ToastProvider><GiftCardsScreen /></ToastProvider>, giftCardsFtl, sharedFtl);

    await expandCard('GC-001');
    await waitFor(() => {
      expect(screen.getByText('Initial Balance')).toBeInTheDocument();
    }, FAST_WAIT);

    fireEvent.click(screen.getByText('GC-001'));
    await waitFor(() => {
      expect(screen.queryByText('Initial Balance')).not.toBeInTheDocument();
    }, FAST_WAIT);
  });

  it('does not show transaction section for cards with no transactions', async () => {
    mockListGiftCards.mockResolvedValue([sampleCards[2]!]);
    renderWithFluentSync(<ToastProvider><GiftCardsScreen /></ToastProvider>, giftCardsFtl, sharedFtl);

    await expandCard('GC-003');

    await waitFor(() => {
      expect(screen.queryByText('Recent Transactions')).not.toBeInTheDocument();
    }, FAST_WAIT);
  });

  // ── Freeze/Unfreeze ──────────────────────────────────────────
  it('shows Freeze button for active cards in expanded view', async () => {
    mockListGiftCards.mockResolvedValue(sampleCards);
    renderWithFluentSync(<ToastProvider><GiftCardsScreen /></ToastProvider>, giftCardsFtl, sharedFtl);

    await expandCard('GC-001');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /freeze/i })).toBeInTheDocument();
    }, FAST_WAIT);
  });

  it('calls freezeGiftCard when Freeze is clicked', async () => {
    mockListGiftCards.mockResolvedValue(sampleCards);
    mockFreezeGiftCard.mockResolvedValue({});
    renderWithFluentSync(<ToastProvider><GiftCardsScreen /></ToastProvider>, giftCardsFtl, sharedFtl);

    await expandCard('GC-001');
    await waitAndClickButton(/freeze/i);

    await waitFor(() => {
      expect(mockFreezeGiftCard).toHaveBeenCalledWith('tok-test', 'GC-001');
    }, FAST_WAIT);
  });

  it('shows Unfreeze button for frozen cards', async () => {
    mockListGiftCards.mockResolvedValue(sampleCards);
    renderWithFluentSync(<ToastProvider><GiftCardsScreen /></ToastProvider>, giftCardsFtl, sharedFtl);

    await expandCard('GC-003');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /unfreeze/i })).toBeInTheDocument();
    }, FAST_WAIT);
  });

  it('calls unfreezeGiftCard when Unfreeze is clicked', async () => {
    mockListGiftCards.mockResolvedValue(sampleCards);
    mockUnfreezeGiftCard.mockResolvedValue({});
    renderWithFluentSync(<ToastProvider><GiftCardsScreen /></ToastProvider>, giftCardsFtl, sharedFtl);

    await expandCard('GC-003');
    await waitAndClickButton(/unfreeze/i);

    await waitFor(() => {
      expect(mockUnfreezeGiftCard).toHaveBeenCalledWith('tok-test', 'GC-003');
    }, FAST_WAIT);
  });

  it('does not show Freeze/Unfreeze for redeemed cards', async () => {
    mockListGiftCards.mockResolvedValue([sampleCards[1]!]);
    renderWithFluentSync(<ToastProvider><GiftCardsScreen /></ToastProvider>, giftCardsFtl, sharedFtl);

    await expandCard('GC-002');

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /freeze/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /unfreeze/i })).not.toBeInTheDocument();
    }, FAST_WAIT);
  });

  // ── Top-up ───────────────────────────────────────────────────
  it('shows Top Up button for active cards', async () => {
    mockListGiftCards.mockResolvedValue(sampleCards);
    renderWithFluentSync(<ToastProvider><GiftCardsScreen /></ToastProvider>, giftCardsFtl, sharedFtl);

    await expandCard('GC-001');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /top up/i })).toBeInTheDocument();
    }, FAST_WAIT);
  });

  it('opens top-up form when Top Up is clicked', async () => {
    mockListGiftCards.mockResolvedValue(sampleCards);
    renderWithFluentSync(<ToastProvider><GiftCardsScreen /></ToastProvider>, giftCardsFtl, sharedFtl);

    await expandCard('GC-001');
    await waitAndClickButton(/top up/i);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/amount/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /confirm top-up/i })).toBeInTheDocument();
    }, FAST_WAIT);
  });

  it('submits top-up and refreshes the list', async () => {
    mockListGiftCards.mockResolvedValue(sampleCards);
    mockTopUpGiftCard.mockResolvedValue({});
    renderWithFluentSync(<ToastProvider><GiftCardsScreen /></ToastProvider>, giftCardsFtl, sharedFtl);

    await expandCard('GC-001');
    await waitAndClickButton(/top up/i);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/amount/i)).toBeInTheDocument();
    }, FAST_WAIT);

    const amountInput = screen.getByPlaceholderText(/amount/i);
    fireEvent.change(amountInput, { target: { value: '50000' } });

    await waitFor(() => {
      expect(mockListGiftCards).toHaveBeenCalledTimes(1);
    }, FAST_WAIT);

    fireEvent.click(screen.getByRole('button', { name: /confirm top-up/i }));

    await waitFor(() => {
      expect(mockTopUpGiftCard).toHaveBeenCalledWith('tok-test', 'GC-001', 50000);
    }, FAST_WAIT);
  });

  // ── the top-up amount is in the STORE's currency ──────────────────────
  //
  // `handleTopUp` read the typed value as raw minor units (\`Number(raw)\` with an
  // \`isInteger\` guard), so on a 2-exponent currency an operator typing \`50\` meaning
  // $50.00 topped the card up by 50 minor units — $0.50, a 100x under-credit. The
  // case above measures IDR, where the two readings coincide and the bug is invisible.
  it('interprets the top-up amount in the store currency (USD: 50 -> 5000 minor)', async () => {
    mockDefaultCurrency('USD');
    // A USD CARD, not the IDR `sampleCards` fixture. This case exists to prove the EXPONENT
    // (50 -> 5000 minor on a 2-decimal currency), and it used the IDR card only for
    // convenience -- which made it a cross-currency top-up, now refused by the guard added
    // in round 245 (the card's currency must match the till's, or amount_minor means two
    // different things at once). Pinning the card currency keeps the exponent assertion
    // measuring the exponent and nothing else.
    mockListGiftCards.mockResolvedValue([
      {
        card: {
          id: 'gc-usd', card_number: 'GC-001', pin: '1234',
          initial_balance_minor: 100000, current_balance_minor: 75000,
          currency: 'USD', status: 'active', issued_to: 'Alice',
          issue_date: '2026-06-01', expiry_date: '2027-06-01',
          created_by: 'user-1', updated_at: '2026-06-01',
        },
        transactions: [],
      },
    ]);
    mockTopUpGiftCard.mockResolvedValue({});

    renderWithFluentSync(
      <CurrencyProvider>
        <ToastProvider><GiftCardsScreen /></ToastProvider>
      </CurrencyProvider>,
      giftCardsFtl,
      sharedFtl,
    );

    await expandCard('GC-001');
    await waitAndClickButton(/top up/i);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/amount in USD/i)).toBeInTheDocument();
    }, FAST_WAIT);

    fireEvent.change(screen.getByPlaceholderText(/amount in USD/i), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm top-up/i }));

    await waitFor(() => {
      // $50.00 is 5000 minor units, not 50.
      expect(mockTopUpGiftCard).toHaveBeenCalledWith('tok-test', 'GC-001', 5000);
    }, FAST_WAIT);
  });

  it('shows error when top-up amount is invalid', async () => {
    mockListGiftCards.mockResolvedValue(sampleCards);
    renderWithFluentSync(<ToastProvider><GiftCardsScreen /></ToastProvider>, giftCardsFtl, sharedFtl);

    await expandCard('GC-001');
    await waitAndClickButton(/top up/i);

    fireEvent.click(screen.getByRole('button', { name: /confirm top-up/i }));

    await waitFor(() => {
      expect(screen.getByText(/top-up amount must be positive/i)).toBeInTheDocument();
    }, FAST_WAIT);
    expect(mockTopUpGiftCard).not.toHaveBeenCalled();
  });

  it('closes top-up form when Cancel is clicked', async () => {
    mockListGiftCards.mockResolvedValue(sampleCards);
    renderWithFluentSync(<ToastProvider><GiftCardsScreen /></ToastProvider>, giftCardsFtl, sharedFtl);

    await expandCard('GC-001');
    await waitAndClickButton(/top up/i);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/amount/i)).toBeInTheDocument();
    }, FAST_WAIT);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/amount/i)).not.toBeInTheDocument();
    }, FAST_WAIT);
  });

  // ── Issue modal ──────────────────────────────────────────────
  it('opens IssueGiftCardModal when Issue New Card is clicked', async () => {
    mockListGiftCards.mockResolvedValue([]);
    renderWithFluentSync(<ToastProvider><GiftCardsScreen /></ToastProvider>, giftCardsFtl, sharedFtl);

    fireEvent.click(screen.getByRole('button', { name: /issue new card/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /issue-modal/i })).toBeInTheDocument();
    }, FAST_WAIT);
  });

  it('refreshes list when issue modal reports onIssued', async () => {
    mockListGiftCards.mockResolvedValue([]);
    renderWithFluentSync(<ToastProvider><GiftCardsScreen /></ToastProvider>, giftCardsFtl, sharedFtl);

    fireEvent.click(screen.getByRole('button', { name: /issue new card/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /issue-modal/i })).toBeInTheDocument();
    }, FAST_WAIT);

    fireEvent.click(screen.getByRole('button', { name: /card issued/i }));

    await waitFor(() => {
      expect(mockListGiftCards).toHaveBeenCalledTimes(2);
    }, FAST_WAIT);
  });
  it('REFUSES a top-up on a card in another currency than the till', async () => {
    // The operator types in the STORE's currency; top_up_gift_card adds amount_minor to the
    // CARD's balance with no currency check, and only prints the card currency in the ledger
    // note. So 50 typed on an IDR till against a KWD card credits 50 fils (0.050 KWD), not
    // 50 KWD -- a 1000x under-credit written into stored value. Same guard as the tender panel.
    mockListGiftCards.mockResolvedValue([
      {
        card: {
          id: 'gc-kwd', card_number: 'GC-KWD-1', pin: '0000',
          initial_balance_minor: 5000, current_balance_minor: 5000,
          currency: 'KWD', status: 'active', issued_to: 'Bob',
          issue_date: '2026-06-01', expiry_date: null,
          created_by: 'user-1', updated_at: '2026-06-01',
        },
        transactions: [],
      },
    ]);
    mockTopUpGiftCard.mockResolvedValue({});
    mockDefaultCurrency('IDR');
    renderWithFluentSync(<ToastProvider><GiftCardsScreen /></ToastProvider>, giftCardsFtl, sharedFtl);

    await expandCard('GC-KWD-1');
    await waitAndClickButton(/top up/i);
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/amount/i)).toBeInTheDocument();
    }, FAST_WAIT);

    fireEvent.change(screen.getByPlaceholderText(/amount/i), { target: { value: '50' } });
    await waitAndClickButton(/confirm top-up/i);

    // The refusal is stated, and NO top-up was sent -- the ledger is untouched.
    await waitFor(() => {
      expect(screen.getByText(/cannot be applied to a IDR sale/i)).toBeInTheDocument();
    }, FAST_WAIT);
    expect(mockTopUpGiftCard).not.toHaveBeenCalled();
  });
});
