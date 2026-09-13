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
};
export { MOCK_CUSTOMERS };
