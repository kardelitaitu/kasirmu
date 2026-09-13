/**
 * Dev-mock handlers — payment domain.
 *
 * EDC terminal, local payment rails, credit sales and settlement.
 * Extracted from `tauri-api.ts` by the agent-4 work order
 * (`todo-refactor-devmock-agents-4.md`, phase 4.1); the code is moved
 * verbatim, comments included — only its location changes.
 *
 * This module is a factory because `getMockLocalPaymentMethods` and
 * `setMockLocalPaymentMethods` need `unwrapArgs`, which lives in the router.
 * Importing it back would close a cycle.
 */

import type { MockHandler } from '../core/mockDispatcher';
import type { UnwrapArgs } from './catalog';
import { MOCK_STORE, MOCK_TERMINAL } from '../core/mockSeedData';

export interface PaymentDeps {
  unwrapArgs: UnwrapArgs;
}

// ── Local payment methods (regional slice 6) ────────────────────────
// The market rail surface: which rails exist, what they are called,
// whether the site offers them. Session-local maps — the mock has no
// multi-row table, so the rails live in a Map keyed by scope.
/** Per-scope rail rows: `${scope_type}:${scope_id}` → rails. */
const mockLocalPaymentRails = new Map<
  string,
  Array<{ rail_code: string; label: string; is_enabled: boolean; parameters: string }>
>();

/** Resolve the scope key for the mock rail map. */
function mockRailScopeKey(scopeType: string, scopeId: string): string {
  return `${scopeType}:${scopeId}`;
}

/** The effective rail read: entity rows as market defaults, location rows
 *  overriding per rail — including an explicit disable ("not offered at
 *  this site" is a fact). Mirrors the core
 *  `Store::local_payment_methods_for_location`. */
function getMockLocalPaymentMethods(_unwrapArgs: UnwrapArgs, _args: unknown): Array<{
  rail_code: string;
  label: string;
  is_enabled: boolean;
  scope: 'location' | 'legal_entity';
  parameters: string;
}> {
  const location = MOCK_STORE;
  const entityRows =
    mockLocalPaymentRails.get(mockRailScopeKey('legal_entity', 'default:default-legal-entity')) ?? [];
  const locationRows =
    mockLocalPaymentRails.get(mockRailScopeKey('location', location.id)) ?? [];
  const byRail = new Map<string, { rail_code: string; label: string; is_enabled: boolean; scope: 'location' | 'legal_entity'; parameters: string }>();
  for (const row of entityRows) {
    byRail.set(row.rail_code, { ...row, scope: 'legal_entity' });
  }
  for (const row of locationRows) {
    byRail.set(row.rail_code, { ...row, scope: 'location' });
  }
  return [...byRail.values()].sort(
    (a, b) => a.label.localeCompare(b.label) || a.rail_code.localeCompare(b.rail_code),
  );
}

/** The slice-6 write: replace the location's rail list (the card edits the
 *  whole list; omitted rails are removed) and return the fresh effective
 *  read. Mirrors the core `replace_local_payment_methods` + read-back. */
function setMockLocalPaymentMethods(unwrapArgs: UnwrapArgs, args: unknown): Array<{
  rail_code: string;
  label: string;
  is_enabled: boolean;
  scope: 'location' | 'legal_entity';
  parameters: string;
}> {
  const { rails } = unwrapArgs<{
    locationId?: string;
    rails?: Array<{ rail_code: string; label: string; is_enabled: boolean; parameters?: string }>;
  }>(args);
  const location = MOCK_STORE;
  const key = mockRailScopeKey('location', location.id);
  if (rails && rails.length > 0) {
    mockLocalPaymentRails.set(
      key,
      rails.map((rail) => ({
        rail_code: rail.rail_code,
        label: rail.label,
        is_enabled: rail.is_enabled,
        parameters: rail.parameters ?? '{}',
      })),
    );
  } else {
    mockLocalPaymentRails.delete(key);
  }
  return getMockLocalPaymentMethods(unwrapArgs, args);
}

export function createPaymentHandlers(deps: PaymentDeps): Record<string, MockHandler> {
  const { unwrapArgs } = deps;
  return {

  // ── EDC card-present terminal ──────────────────────────────────────
  'edc_terminal_status': () => ({ status: 'ready' }),
  'edc_sale': (args) => {
    const a = args as { args: { amountMinor: number; currency: string } };
    const { amountMinor, currency } = a.args ?? a;
    return {
      success: true,
      transactionId: `mock-edc-${Date.now()}`,
      authCode: 'MOCKAUTH',
      cardScheme: 'Visa',
      cardLast4: '1111',
      message: `approved ${amountMinor} ${currency}`,
    };
  },
  'edc_refund': (args) => {
    const a = args as { args: { transactionId: string; amountMinor: number; currency: string } };
    const { transactionId, amountMinor, currency } = a.args ?? a;
    return {
      success: true,
      transactionId,
      authCode: 'MOCKREF',
      cardScheme: null,
      cardLast4: null,
      message: `refund approved ${amountMinor} ${currency}`,
    };
  },
  'edc_void': (args) => {
    const a = args as { args: { transactionId: string } };
    const { transactionId } = a.args ?? a;
    return { success: true, transactionId, authCode: null, cardScheme: null, cardLast4: null, message: 'void approved' };
  },

  // Local payment methods (regional slice 6) — same parity rule.
  'get_local_payment_methods_scoped': (args) => getMockLocalPaymentMethods(unwrapArgs, args),
  'set_local_payment_methods_scoped': (args) => setMockLocalPaymentMethods(unwrapArgs, args),

  // ═══════════════════════════════════════════════════════════════
  // TERMINALS
  // ═══════════════════════════════════════════════════════════════

  'list_terminals': () => [MOCK_TERMINAL],
  'list_terminals_scoped': () => [MOCK_TERMINAL],
  'get_terminal': () => MOCK_TERMINAL,
  'get_terminal_scoped': () => MOCK_TERMINAL,
  'register_terminal': () => ({ id: 'term-new' }),
  'register_terminal_scoped': () => ({ id: 'term-new' }),
  'update_terminal': () => ({ id: 'term-1' }),
  'update_terminal_scoped': () => ({ id: 'term-1' }),
  'delete_terminal': () => null,
  'delete_terminal_scoped': () => null,
  'get_terminal_profile': () => ({ terminalId: 'term-1', profileType: 'desktop', lockedScreen: null, updatedAt: new Date().toISOString() }),
  'get_terminal_profile_scoped': () => ({ terminalId: 'term-1', profileType: 'desktop', lockedScreen: null, updatedAt: new Date().toISOString() }),
  'set_terminal_profile': () => null,
  'set_terminal_profile_scoped': () => null,
  'list_terminal_profiles': () => [],
  'list_terminal_profiles_scoped': () => [],
  'delete_terminal_profile': () => null,
  'delete_terminal_profile_scoped': () => null,
  'list_terminal_overrides': () => [],
  'list_terminal_overrides_scoped': () => [],
  'set_terminal_override': () => null,
  'set_terminal_override_scoped': () => null,
  'delete_terminal_override': () => null,
  'delete_terminal_override_scoped': () => null,
  'list_credit_sales': () => [],
  'list_credit_sales_scoped': () => [],
  'settle_credit': () => null,
  'settle_credit_scoped': () => null,
  };
}
