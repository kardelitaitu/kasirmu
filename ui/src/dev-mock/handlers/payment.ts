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

// Seed the market default with the two rails checkout now reads
// (agents-5): `qris` carrying a demo merchant static-QR payload so the
// manual dialog renders a real EMVCo QR instead of the retired fake
// grid, and `edc` to keep the card-terminal button visible in dev. A
// demo EMVCo string only — it scans to nothing real, exactly like the
// grid it replaced, but it exercises the render path honestly. The
// settings card starts from this and its writes override at the
// location scope.
mockLocalPaymentRails.set(
  mockRailScopeKey('legal_entity', 'default:default-legal-entity'),
  [
    {
      rail_code: 'qris',
      label: 'QRIS',
      is_enabled: true,
      parameters: JSON.stringify({
        static_qr_payload:
          '00020101021226690012ID.CO.QRIS.WWW0215ID20230123456780303UME52045812530336054051000000000000000000000000000000005802ID5912KASIRMU DEMO6007JAKARTA6304ABCD',
      }),
    },
    { rail_code: 'edc', label: 'EDC (card)', is_enabled: true, parameters: '{}' },
  ],
);

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

// ── QRIS Auto (cloud dynamic charge mock) ───────────────────────────
// Scripted so the browser build can walk the WHOLE checkout story: the
// charge issues a fake payload, and the order flips to `settlement` on the
// THIRD status poll — mirroring the real race where the settlement webhook
// lands while the UI is still polling. A never-polled order simply stays
// unsettled, like a real abandoned QR.
let mockQrisSeq = 0;
/** orderId → remaining polls before it settles. */
const mockQrisPollsLeft = new Map<string, number>();

interface MockEdcTerminalRow {
  id: string;
  name: string;
  connectionType: 'wired' | 'wireless';
  transport: 'serial' | 'usb' | 'bluetooth' | 'tcp';
  address: string;
  vendor?: string | null;
  model?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

let mockEdcTerminals: MockEdcTerminalRow[] = [
  {
    id: 'edc-term-1',
    name: 'Counter 1 - BCA EDC',
    connectionType: 'wired',
    transport: 'serial',
    address: 'COM3',
    vendor: 'ingenico',
    model: 'iPP320',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'edc-term-2',
    name: 'Mobile Mandiri PAX',
    connectionType: 'wireless',
    transport: 'tcp',
    address: '192.168.1.188:9000',
    vendor: 'pax',
    model: 'A920',
    isActive: true,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
];

export function createPaymentHandlers(deps: PaymentDeps): Record<string, MockHandler> {
  const { unwrapArgs } = deps;
  return {

  // ── EDC card-present terminal ──────────────────────────────────────
  'edc_terminal_status': (args) => {
    const a = unwrapArgs<{ terminalId?: string }>(args);
    if (a.terminalId && !mockEdcTerminals.some((t) => t.id === a.terminalId)) {
      throw new Error(`EDC card terminal '${a.terminalId}' not found`);
    }
    return { status: 'ready' };
  },
  'edc_terminal_status_scoped': (args) => {
    const a = unwrapArgs<{ terminalId?: string }>(args);
    if (a.terminalId && !mockEdcTerminals.some((t) => t.id === a.terminalId)) {
      throw new Error(`EDC card terminal '${a.terminalId}' not found`);
    }
    return { status: 'ready' };
  },
  'list_edc_terminals_scoped': () => [...mockEdcTerminals],
  'create_edc_terminal_scoped': (args) => {
    const { args: input } = unwrapArgs<{
      args: {
        name: string;
        connectionType: 'wired' | 'wireless';
        transport: 'serial' | 'usb' | 'bluetooth' | 'tcp';
        address: string;
        vendor?: string | null;
        model?: string | null;
        isActive?: boolean;
      };
    }>(args);
    const now = new Date().toISOString();
    const created: MockEdcTerminalRow = {
      id: `edc-term-${Date.now()}`,
      name: input.name,
      connectionType: input.connectionType,
      transport: input.transport,
      address: input.address,
      vendor: input.vendor ?? null,
      model: input.model ?? null,
      isActive: input.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
    mockEdcTerminals.push(created);
    return created;
  },
  'update_edc_terminal_scoped': (args) => {
    const { args: input } = unwrapArgs<{
      args: {
        id: string;
        name: string;
        connectionType: 'wired' | 'wireless';
        transport: 'serial' | 'usb' | 'bluetooth' | 'tcp';
        address: string;
        vendor?: string | null;
        model?: string | null;
        isActive: boolean;
      };
    }>(args);
    const idx = mockEdcTerminals.findIndex((t) => t.id === input.id);
    const existing = mockEdcTerminals[idx];
    if (!existing) throw new Error(`edc_terminal not found: ${input.id}`);
    const updated: MockEdcTerminalRow = {
      id: existing.id,
      createdAt: existing.createdAt,
      name: input.name,
      connectionType: input.connectionType,
      transport: input.transport,
      address: input.address,
      vendor: input.vendor ?? null,
      model: input.model ?? null,
      isActive: input.isActive,
      updatedAt: new Date().toISOString(),
    };
    mockEdcTerminals[idx] = updated;
    return updated;
  },
  'delete_edc_terminal_scoped': (args) => {
    const { id } = unwrapArgs<{ id: string }>(args);
    mockEdcTerminals = mockEdcTerminals.filter((t) => t.id !== id);
    return null;
  },
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

  // ── QRIS Auto dynamic charge + status poll ─────────────────────────
  'qris_auto_charge_scoped': (args) => {
    const a = unwrapArgs<{ saleId?: string; amountMinor?: number }>(args);
    mockQrisSeq += 1;
    const orderId = `QRIS-DEV-${mockQrisSeq}`;
    mockQrisPollsLeft.set(orderId, 2);
    return {
      orderId,
      // Real payloads are EMVCo TLV strings; a marker string renders fine
      // through the QR component and is unmistakable in screenshots.
      qrString: `DEVQRIS|${orderId}`,
      status: 'qr_issued',
      amountMinor: a.amountMinor ?? 0,
      currency: 'IDR',
      saleId: a.saleId ?? 'sale-dev',
      expiresInSecs: 300,
    };
  },
  'qris_auto_status_scoped': (args) => {
    const { orderId } = unwrapArgs<{ orderId?: string }>(args);
    const id = orderId ?? '';
    const left = mockQrisPollsLeft.get(id);
    if (left === undefined) return { orderId: id, status: 'issued', settled: false };
    if (left <= 1) {
      mockQrisPollsLeft.delete(id);
      return { orderId: id, status: 'settlement', settled: true };
    }
    mockQrisPollsLeft.set(id, left - 1);
    return { orderId: id, status: 'issued', settled: false };
  },

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
