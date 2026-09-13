/**
 * Dev-mock handlers — loyalty domain.
 *
 * Loyalty, gift card, voucher, coupon and promotion command surface. Extracted from `tauri-api.ts` by the agent-4 work order
 * (`todo-refactor-devmock-agents-4.md`, phase 4.1); the code is moved
 * verbatim, comments included — only its location changes.
 *
 * This module is self-contained: it needs no injected dependencies and
 * exports a plain map rather than a factory.
 */

import type { MockHandler } from '../core/mockDispatcher';
export const loyaltyHandlers: Record<string, MockHandler> = {

  // ═══════════════════════════════════════════════════════════════
  // PROMOTIONS
  // ═══════════════════════════════════════════════════════════════

  'get_promotion': () => null,
  'get_promotion_scoped': () => null,
  'create_promotion': () => null,
  'create_promotion_scoped': () => null,
  'update_promotion': () => null,
  'update_promotion_scoped': () => null,
  'delete_promotion': () => null,
  'delete_promotion_scoped': () => null,
  'apply_promotion': () => null,
  'apply_promotion_scoped': () => null,

  // ═══════════════════════════════════════════════════════════════
  // LOYALTY
  // ═══════════════════════════════════════════════════════════════

  'get_loyalty_account_scoped': () => null,
  // One seeded account + tiers so the Loyalty screen's real table renders
  // deterministically (the table only exists when accounts.length > 0;
  // otherwise the empty state shows and the E2E races the loading skeleton).
  'list_loyalty_accounts_scoped': () => [
    {
      account: {
        id: 'loyalty-acc-1', customer_id: 'cust-1', points: 250, lifetime_points: 1200,
        tier_id: 'tier-1', updated_at: new Date().toISOString(), created_at: new Date().toISOString(),
      },
      tier: {
        id: 'tier-1', name: 'Gold', min_points: 100, points_per_unit: 1000,
        earn_multiplier_millionths: 1_500_000, colour: '#f59e0b', sort_order: 1, created_at: new Date().toISOString(),
      },
      recent_transactions: [],
      next_tier: null,
      points_to_next_tier: 0,
    },
  ],
  'earn_loyalty_points_scoped': () => null,
  'redeem_loyalty_points_scoped': () => null,
  'list_loyalty_tiers_scoped': () => [
    {
      id: 'tier-1', name: 'Gold', min_points: 100, points_per_unit: 1000,
      earn_multiplier_millionths: 1_500_000, colour: '#f59e0b', sort_order: 1, created_at: new Date().toISOString(),
    },
    {
      id: 'tier-2', name: 'Platinum', min_points: 500, points_per_unit: 1000,
      earn_multiplier_millionths: 2_000_000, colour: '#8b5cf6', sort_order: 2, created_at: new Date().toISOString(),
    },
  ],
  'update_loyalty_tier_scoped': () => null,
  'get_points_value_scoped': () => 0,
  'get_or_create_loyalty_account_scoped': () => null,

  // ═══════════════════════════════════════════════════════════════
  // GIFT CARDS
  // ═══════════════════════════════════════════════════════════════

  'issue_gift_card': () => null,
  'get_gift_card': () => null,
  'list_gift_cards': () => [],
  'get_gift_card_balance': () => null,
  'redeem_gift_card': () => null,
  'top_up_gift_card': () => null,
  'freeze_gift_card': () => null,
  'unfreeze_gift_card': () => null,
  'issue_gift_card_scoped': () => null,
  'get_gift_card_scoped': () => null,
  'list_gift_cards_scoped': () => [],
  'get_gift_card_balance_scoped': () => null,
  'redeem_gift_card_scoped': () => null,
  'top_up_gift_card_scoped': () => null,
  'freeze_gift_card_scoped': () => null,
  'unfreeze_gift_card_scoped': () => null,
};
