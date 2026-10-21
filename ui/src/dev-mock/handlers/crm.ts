/**
 * Dev-mock handlers — crm domain.
 *
 * Customer, supplier and purchase-order command surface. Extracted from `tauri-api.ts` by the agent-4 work order
 * (`todo-refactor-devmock-agents-4.md`, phase 4.1); the code is moved
 * verbatim, comments included — only its location changes.
 *
 * This module is self-contained: it needs no injected dependencies and
 * exports a plain map rather than a factory.
 */

import type { MockHandler } from '../core/mockDispatcher';

const MOCK_CUSTOMERS = [
  { id: 'cust-1', name: 'John Doe', email: 'john@example.com', phone: '08123456789', notes: 'Regular customer', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'cust-2', name: 'Jane Smith', email: 'jane@example.com', phone: '08987654321', notes: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
];

export const crmHandlers: Record<string, MockHandler> = {

  // Currency + exchange rates → `handlers/catalog.ts` (phase 2.1).

  // ═══════════════════════════════════════════════════════════════
  // CUSTOMERS
  // ═══════════════════════════════════════════════════════════════

  'list_customers': () => MOCK_CUSTOMERS,
  'list_customers_scoped': () => MOCK_CUSTOMERS,
  'get_customer': (args) => {
    const { id } = args as { id: string };
    return MOCK_CUSTOMERS.find(c => c.id === id) ?? null;
  },
  'create_customer': () => ({ id: 'cust-new', name: 'New Customer', email: null, phone: null, notes: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  'update_customer': () => ({ id: 'cust-upd', name: 'Updated', email: null, phone: null, notes: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  'delete_customer': () => null,

  // ═══════════════════════════════════════════════════════════════
  // PURCHASING / SUPPLIERS
  // ═══════════════════════════════════════════════════════════════

  'list_suppliers': () => [
    { id: 'supplier-1', name: 'PT Teknologi Maju', contact_person: 'Budi', phone: '021-1234567', email: 'budi@teknologi.com', address: 'Jl. Merdeka No. 1', is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 'supplier-2', name: 'CV Distribusi Utama', contact_person: 'Siti', phone: '021-7654321', email: 'siti@distribusi.com', address: 'Jl. Sudirman No. 45', is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  ],
  'list_suppliers_scoped': () => [
    { id: 'supplier-1', name: 'PT Teknologi Maju', contact_person: 'Budi', phone: '021-1234567', email: 'budi@teknologi.com', address: 'Jl. Merdeka No. 1', is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 'supplier-2', name: 'CV Distribusi Utama', contact_person: 'Siti', phone: '021-7654321', email: 'siti@distribusi.com', address: 'Jl. Sudirman No. 45', is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  ],
  'get_supplier': () => null,
  'create_supplier': () => null,
  'update_supplier': () => null,
  'get_supplier_scoped': () => null,
  'create_supplier_scoped': () => null,
  'update_supplier_scoped': () => null,
  'list_purchase_orders': () => [
    { id: 'po-1', po_number: 'PO-001', supplier_id: 'supplier-1', supplier_name: 'PT Teknologi Maju', status: 'pending', order_date: new Date().toISOString(), expected_date: new Date(Date.now() + 86400000).toISOString(), received_date: null, subtotal_minor: 5000000, tax_minor: 0, total_minor: 5000000, notes: '', created_by: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), lines: [{ id: 'po-line-1', po_id: 'po-1', sku: 'CPU-R7-7800X3D', product_name: 'AMD Ryzen 7 7800X3D 8-Core', qty: 2, unit_cost_minor: 2500000, line_total_minor: 5000000 }] },
  ],
  'list_purchase_orders_scoped': () => [
    { id: 'po-1', po_number: 'PO-001', supplier_id: 'supplier-1', supplier_name: 'PT Teknologi Maju', status: 'pending', order_date: new Date().toISOString(), expected_date: new Date(Date.now() + 86400000).toISOString(), received_date: null, subtotal_minor: 5000000, tax_minor: 0, total_minor: 5000000, notes: '', created_by: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), lines: [{ id: 'po-line-1', po_id: 'po-1', sku: 'CPU-R7-7800X3D', product_name: 'AMD Ryzen 7 7800X3D 8-Core', qty: 2, unit_cost_minor: 2500000, line_total_minor: 5000000 }] },
  ],
  'get_purchase_order': () => null,
  'create_purchase_order': () => null,
  'update_po_status': () => null,
  'receive_purchase_order': () => null,
  'get_purchase_order_scoped': () => null,
  'create_purchase_order_scoped': () => null,
  'update_po_status_scoped': () => null,
  'receive_purchase_order_scoped': () => null,
  'receive_purchase_order_with_lines_scoped': () => null,

  // ── Customer search / history (scoped-only) ────────────────────────
  // Moved verbatim out of `tauri-api.ts`'s in-place `handlers['x'] = …`
  // patches by todo-refactor-devmock-router-consolidation.md Phase 5.5.
  // `MOCK_CUSTOMERS` is this module's own export (see `:71`), so the bodies are
  // in scope unchanged; both keys were `git grep`-confirmed single-defined
  // (only in the router), so folding them into this map is a pure copy — no
  // override body to flip.
  'search_customers_scoped': (args) => {
    const { query } = (args ?? {}) as { query?: string };
    const q = (query ?? '').toLowerCase();
    const items = MOCK_CUSTOMERS.filter(
      (c) => !q || c.name.toLowerCase().includes(q),
    );
    return { items, total: items.length };
  },
  'get_customer_history_scoped': (args) => {
    const { customerId } = (args ?? {}) as { customerId?: string };
    const customer =
      MOCK_CUSTOMERS.find((c) => c.id === customerId) ?? MOCK_CUSTOMERS[0]!;
    return { customer, loyalty: null, sales: [], sales_total: 0 };
  },

  // ═══════════════════════════════════════════════════════════════
  // RECEIVABLES (Piutang / Kasbon)
  // ═══════════════════════════════════════════════════════════════

  'list_receivables_scoped': () => [],
  'list_customer_receivables_scoped': () => [],
  'get_receivable_scoped': () => null,
  'get_customer_receivables_summary_scoped': (args) => {
    const { customerId } = (args ?? {}) as { customerId?: string };
    return {
      customerId: customerId ?? 'cust-1',
      outstandingTotal: { minor_units: 0, currency: 'IDR' },
      openCount: 0,
      hasOverdue: false,
    };
  },
  'create_receivable_scoped': (args) => {
    const payload = ((args as Record<string, unknown>)?.['args'] ?? args) as Record<string, unknown> | undefined;
    const amount = (payload?.['amount'] as { minor_units: number; currency: string }) ?? { minor_units: 100000, currency: 'IDR' };
    return {
      id: 'rec-mock-1',
      tenantId: 'default',
      customerId: (payload?.['customerId'] as string) ?? 'cust-1',
      saleId: (payload?.['saleId'] as string) ?? null,
      source: (payload?.['source'] as string) ?? 'pos',
      reference: (payload?.['reference'] as string) ?? '',
      amount,
      paid: { minor_units: 0, currency: 'IDR' },
      balance: amount,
      dueDate: (payload?.['dueDate'] as string) ?? null,
      status: 'open',
      isOverdue: false,
      note: (payload?.['note'] as string) ?? '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      settledAt: null,
      writtenOffAt: null,
    };
  },
  'record_receivable_payment_scoped': (args) => {
    const payload = ((args as Record<string, unknown>)?.['args'] ?? args) as Record<string, unknown> | undefined;
    const amount = (payload?.['amount'] as { minor_units: number; currency: string }) ?? { minor_units: 100000, currency: 'IDR' };
    return {
      id: (payload?.['receivableId'] as string) ?? 'rec-mock-1',
      tenantId: 'default',
      customerId: 'cust-1',
      saleId: null,
      source: 'pos',
      reference: '',
      amount,
      paid: amount,
      balance: { minor_units: 0, currency: 'IDR' },
      dueDate: null,
      status: 'paid',
      isOverdue: false,
      note: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      settledAt: new Date().toISOString(),
      writtenOffAt: null,
    };
  },
  'write_off_receivable_scoped': (args) => {
    const { receivableId } = (args ?? {}) as { receivableId?: string };
    return {
      id: receivableId ?? 'rec-mock-1',
      tenantId: 'default',
      customerId: 'cust-1',
      saleId: null,
      source: 'pos',
      reference: '',
      amount: { minor_units: 100000, currency: 'IDR' },
      paid: { minor_units: 0, currency: 'IDR' },
      balance: { minor_units: 100000, currency: 'IDR' },
      dueDate: null,
      status: 'written_off',
      isOverdue: false,
      note: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      settledAt: null,
      writtenOffAt: new Date().toISOString(),
    };
  },
  'get_ar_aging_report_scoped': () => ({
    asOfDate: new Date().toISOString().slice(0, 10),
    currency: 'IDR',
    summary: {
      currentMinor: 0,
      days3160Minor: 0,
      days6190Minor: 0,
      daysOver90Minor: 0,
      totalOutstandingMinor: 0,
    },
    customers: [],
  }),

  // ═══════════════════════════════════════════════════════════════
  // PAYABLES (Hutang / Beli Tempo)
  // ═══════════════════════════════════════════════════════════════

  'list_payables_scoped': () => [],
  'create_payable_scoped': (args) => {
    const payload = ((args as Record<string, unknown>)?.['args'] ?? args) as Record<string, unknown> | undefined;
    const amount = (payload?.['amount'] as { minor_units: number; currency: string }) ?? { minor_units: 5000000, currency: 'IDR' };
    return {
      id: 'pay-mock-1',
      tenant_id: 'default',
      supplier_id: (payload?.['supplierId'] as string) ?? 'supplier-1',
      po_id: (payload?.['poId'] as string) ?? null,
      source: (payload?.['source'] as string) ?? 'manual',
      reference: (payload?.['reference'] as string) ?? 'INV-MOCK-001',
      amount,
      paid: { minor_units: 0, currency: amount.currency },
      balance: amount,
      due_date: (payload?.['dueDate'] as string) ?? null,
      status: 'open',
      is_overdue: false,
      note: (payload?.['note'] as string) ?? '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      settled_at: null,
      written_off_at: null,
    };
  },
  'record_payable_payment_scoped': (args) => {
    const payload = ((args as Record<string, unknown>)?.['args'] ?? args) as Record<string, unknown> | undefined;
    const amount = (payload?.['amount'] as { minor_units: number; currency: string }) ?? { minor_units: 5000000, currency: 'IDR' };
    return {
      id: (payload?.['payableId'] as string) ?? 'pay-mock-1',
      tenant_id: 'default',
      supplier_id: 'supplier-1',
      po_id: null,
      source: 'manual',
      reference: 'INV-MOCK-001',
      amount,
      paid: amount,
      balance: { minor_units: 0, currency: amount.currency },
      due_date: null,
      status: 'paid',
      is_overdue: false,
      note: (payload?.['note'] as string) ?? '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      settled_at: new Date().toISOString(),
      written_off_at: null,
    };
  },
  'write_off_payable_scoped': (args) => {
    const { payableId } = (args ?? {}) as { payableId?: string };
    return {
      id: payableId ?? 'pay-mock-1',
      tenant_id: 'default',
      supplier_id: 'supplier-1',
      po_id: null,
      source: 'manual',
      reference: 'INV-MOCK-001',
      amount: { minor_units: 5000000, currency: 'IDR' },
      paid: { minor_units: 0, currency: 'IDR' },
      balance: { minor_units: 5000000, currency: 'IDR' },
      due_date: null,
      status: 'written_off',
      is_overdue: false,
      note: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      settled_at: null,
      written_off_at: new Date().toISOString(),
    };
  },
  'get_ap_aging_report_scoped': () => ({
    asOfDate: new Date().toISOString().slice(0, 10),
    currency: 'IDR',
    summary: {
      currentMinor: 0,
      days3160Minor: 0,
      days6190Minor: 0,
      daysOver90Minor: 0,
      totalOutstandingMinor: 0,
    },
    vendors: [],
  }),
};
export { MOCK_CUSTOMERS };
