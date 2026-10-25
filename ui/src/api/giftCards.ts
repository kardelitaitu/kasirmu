import { loggedInvoke } from '@/utils/logged-invoke';

/** A gift card record with balance and status. */
export interface GiftCard {
  id: string;
  card_number: string;
  pin: string;
  initial_balance_minor: number;
  current_balance_minor: number;
  currency: string;
  status: string;
  issued_to: string;
  issue_date: string;
  expiry_date: string | null;
  created_by: string | null;
  updated_at: string;
}

/** A transaction against a gift card (issue, redeem, top-up, freeze). */
export interface GiftCardTransaction {
  id: string;
  gift_card_id: string;
  sale_id: string | null;
  txn_type: string;
  amount_minor: number;
  balance_after_minor: number;
  notes: string;
  created_at: string;
}

/** A gift card with its full transaction history. */
export interface GiftCardWithTransactions {
  card: GiftCard;
  transactions: GiftCardTransaction[];
}

/** Filter parameters for listing gift cards. */
export interface GiftCardFilter {
  search?: string | null;
  status?: string | null;
  issued_to?: string | null;
  min_balance?: number | null;
}

/** Input for issuing a new gift card. */
export interface IssueGiftCardInput {
  card_number: string;
  pin?: string | null;
  initial_amount_minor: number;
  currency: string;
  issued_to?: string | null;
  created_by: string;
  expiry_date?: string | null;
}

/** Gift card balance check result. */
export interface BalanceResult {
  balance_minor: number;
  currency: string;
  status: string;
}

/** Result of redeeming a gift card against a sale. */
export interface RedeemGiftCardResult {
  card: GiftCard;
  transaction: GiftCardTransaction;
}

/** Issue a new gift card with an initial balance (session-scoped). */
export const issueGiftCard = (sessionToken: string, input: IssueGiftCardInput): Promise<GiftCardWithTransactions> =>
  loggedInvoke<GiftCardWithTransactions>('issue_gift_card_scoped', { sessionToken, input });

/** Get a gift card by card number or ID, including transactions (session-scoped). */
export const getGiftCard = (sessionToken: string, cardNumberOrId: string): Promise<GiftCardWithTransactions | null> =>
  loggedInvoke<GiftCardWithTransactions | null>('get_gift_card_scoped', { sessionToken, cardNumberOrId });

/** List gift cards with optional filtering (session-scoped). */
export const listGiftCards = (sessionToken: string, filter: GiftCardFilter): Promise<GiftCardWithTransactions[]> =>
  loggedInvoke<GiftCardWithTransactions[]>('list_gift_cards_scoped', { sessionToken, filter });

/** Check a gift card's current balance and status (session-scoped). */
export const getGiftCardBalance = (sessionToken: string, cardNumberOrId: string): Promise<BalanceResult | null> =>
  loggedInvoke<BalanceResult | null>('get_gift_card_balance_scoped', { sessionToken, cardNumberOrId });

/** Redeem a gift card for a given amount against a sale (session-scoped). */
export const redeemGiftCard = (sessionToken: string, cardNumberOrId: string, amountMinor: number, currency: string, saleId: string): Promise<RedeemGiftCardResult> =>
  loggedInvoke<RedeemGiftCardResult>('redeem_gift_card_scoped', { sessionToken, cardNumberOrId, amountMinor, currency, saleId });

/** Add funds to an existing gift card (session-scoped). */
export const topUpGiftCard = (sessionToken: string, cardNumberOrId: string, amountMinor: number, currency: string): Promise<GiftCardWithTransactions> =>
  loggedInvoke<GiftCardWithTransactions>('top_up_gift_card_scoped', { sessionToken, cardNumberOrId, amountMinor, currency });

/** Freeze a gift card to prevent further use (session-scoped). */
export const freezeGiftCard = (sessionToken: string, cardNumberOrId: string): Promise<GiftCard> =>
  loggedInvoke<GiftCard>('freeze_gift_card_scoped', { sessionToken, cardNumberOrId });

/** Unfreeze a previously frozen gift card (session-scoped). */
export const unfreezeGiftCard = (sessionToken: string, cardNumberOrId: string): Promise<GiftCard> =>
  loggedInvoke<GiftCard>('unfreeze_gift_card_scoped', { sessionToken, cardNumberOrId });
