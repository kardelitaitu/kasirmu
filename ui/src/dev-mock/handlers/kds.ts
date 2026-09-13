/**
 * Dev-mock handlers — KDS domain.
 *
 * Kitchen display system: orders, line items, statuses, auto-generation
 * and auto-progress. Extracted from  by the agent-4 work order
 * (, phase 4.1); the code is moved
 * verbatim, comments included — only its location changes.
 *
 * This module is self-contained: it needs no injected dependencies and
 * exports a plain map rather than a factory.  and
 *  stay in the router (they are shared with sales).
 */

import type { MockHandler } from '../core/mockDispatcher';
import { emit } from '../tauri-event';
import { MOCK_KDS_KEY, readSlice, writeSlice } from '../core/mockDatabase';

/** List the active memos served by the dev mock (Location stacked above
 *  Organization, matching the real read path's ordering) plus the display
 *  cadence, matching the real command's `MemoDisplayDto` envelope. Only
 *  published memos reach terminals — drafts stay on the authoring side. */

const _initialKdsOrders = [
  {
    id: 'kds-order-1',
    display_number: 101,
    status: 'pending',
    received_at: new Date(Date.now() - 30000).toISOString(),
    items_summary: '2x Nasi Goreng Spesial, 1x Es Teh Manis',
    item_count: 3,
    order_type: 'dine_in',
    table_number: 'T3',
    notes: 'Pedas level 2',
    priority: false,
    store_id: 'store-1',
  },
  {
    id: 'kds-order-2',
    display_number: 102,
    status: 'pending',
    received_at: new Date(Date.now() - 90000).toISOString(),
    items_summary: '1x Ayam Bakar Madu, 1x Soto Ayam',
    item_count: 2,
    order_type: 'dine_in',
    table_number: 'T5',
    notes: null,
    priority: false,
    store_id: 'store-1',
  },
  {
    id: 'kds-order-3',
    display_number: 103,
    status: 'preparing',
    received_at: new Date(Date.now() - 240000).toISOString(),
    items_summary: '1x Sate Ayam 10 Tusuk, 2x Es Teh Manis',
    item_count: 3,
    order_type: 'dine_in',
    table_number: 'T7',
    notes: 'Sate tanpa kacang',
    priority: false,
    store_id: 'store-1',
  },
  {
    id: 'kds-order-4',
    display_number: 104,
    status: 'preparing',
    received_at: new Date(Date.now() - 360000).toISOString(),
    items_summary: '1x Rawon Daging, 1x Gado-Gado',
    item_count: 2,
    order_type: 'dine_in',
    table_number: 'T2',
    notes: null,
    priority: false,
    store_id: 'store-1',
  },
  {
    id: 'kds-order-5',
    display_number: 105,
    status: 'preparing',
    received_at: new Date(Date.now() - 480000).toISOString(),
    items_summary: '3x Mie Goreng Jawa, 2x Kopi Tubruk',
    item_count: 5,
    order_type: 'dine_in',
    table_number: 'T10',
    notes: 'Mie goreng setengah matang',
    priority: true,
    store_id: 'store-1',
  },
  {
    id: 'kds-order-6',
    display_number: 106,
    status: 'ready',
    received_at: new Date(Date.now() - 600000).toISOString(),
    items_summary: '2x Caffè Latte, 1x Cappuccino',
    item_count: 3,
    order_type: 'dine_in',
    table_number: 'T1',
    notes: null,
    priority: true,
    store_id: 'store-1',
  },
  {
    id: 'kds-order-7',
    display_number: 107,
    status: 'ready',
    received_at: new Date(Date.now() - 720000).toISOString(),
    items_summary: '1x Nasi Goreng Spesial, 1x Es Jeruk Peras',
    item_count: 2,
    order_type: 'takeaway',
    table_number: null,
    notes: 'Extra sambal',
    priority: true,
    store_id: 'store-1',
  },
  {
    id: 'kds-order-8',
    display_number: 108,
    status: 'pending',
    received_at: new Date(Date.now() - 15000).toISOString(),
    items_summary: '1x Pisang Goreng, 2x Teh Tarik',
    item_count: 3,
    order_type: 'dine_in',
    table_number: 'T4',
    notes: null,
    priority: false,
    store_id: 'store-1',
  },
  {
    id: 'kds-order-9',
    display_number: 109,
    status: 'pending',
    received_at: new Date(Date.now() - 120000).toISOString(),
    items_summary: '1x Ayam Bakar Madu, 1x Tahu Goreng, 1x Tempe Goreng',
    item_count: 3,
    order_type: 'dine_in',
    table_number: 'T8',
    notes: 'Ayam bakar tanpa kulit',
    priority: false,
    store_id: 'store-1',
  },
  {
    id: 'kds-order-10',
    display_number: 110,
    status: 'ready',
    received_at: new Date(Date.now() - 840000).toISOString(),
    items_summary: '1x Es Campur, 1x Klepon',
    item_count: 2,
    order_type: 'dine_in',
    table_number: 'T6',
    notes: null,
    priority: true,
    store_id: 'store-1',
  },
];
// ── Mock KDS line items (course-grouped for per-item advance) ──
const _initialKdsLineItems: Record<string, Array<Record<string, unknown>>> = {
  'kds-order-1': [
    { id: 'kds-line-1-1', kds_order_id: 'kds-order-1', sku: 'NASI-GORENG', display_name: 'Nasi Goreng Spesial', qty: 2, course: 'main', modifiers: [{ name: 'Level', choice: 'Pedas 2', price_minor: 0 }], line_position: 1, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
    { id: 'kds-line-1-2', kds_order_id: 'kds-order-1', sku: 'ES-TEH', display_name: 'Es Teh Manis', qty: 1, course: 'beverage', modifiers: [], line_position: 2, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
  ],
  'kds-order-2': [
    { id: 'kds-line-2-1', kds_order_id: 'kds-order-2', sku: 'AYAM-BAKAR', display_name: 'Ayam Bakar Madu', qty: 1, course: 'main', modifiers: [], line_position: 1, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
    { id: 'kds-line-2-2', kds_order_id: 'kds-order-2', sku: 'SOTO-AYAM', display_name: 'Soto Ayam', qty: 1, course: 'main', modifiers: [], line_position: 2, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
  ],
  'kds-order-3': [
    { id: 'kds-line-3-1', kds_order_id: 'kds-order-3', sku: 'SATE-AYAM', display_name: 'Sate Ayam 10 Tusuk', qty: 1, course: 'main', modifiers: [{ name: 'Sambal', choice: 'Tanpa Kacang', price_minor: 0 }], line_position: 1, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
    { id: 'kds-line-3-2', kds_order_id: 'kds-order-3', sku: 'ES-TEH', display_name: 'Es Teh Manis', qty: 2, course: 'beverage', modifiers: [], line_position: 2, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
  ],
  'kds-order-4': [
    { id: 'kds-line-4-1', kds_order_id: 'kds-order-4', sku: 'RAWON', display_name: 'Rawon Daging', qty: 1, course: 'main', modifiers: [], line_position: 1, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
    { id: 'kds-line-4-2', kds_order_id: 'kds-order-4', sku: 'GADO-GADO', display_name: 'Gado-Gado', qty: 1, course: 'main', modifiers: [], line_position: 2, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
  ],
  'kds-order-5': [
    { id: 'kds-line-5-1', kds_order_id: 'kds-order-5', sku: 'MIE-GORENG', display_name: 'Mie Goreng Jawa', qty: 3, course: 'main', modifiers: [{ name: 'Matang', choice: 'Setengah Matang', price_minor: 0 }], line_position: 1, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
    { id: 'kds-line-5-2', kds_order_id: 'kds-order-5', sku: 'KOPI-T', display_name: 'Kopi Tubruk', qty: 2, course: 'beverage', modifiers: [], line_position: 2, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
  ],
  'kds-order-6': [
    { id: 'kds-line-6-1', kds_order_id: 'kds-order-6', sku: 'LATTE', display_name: 'Caffè Latte', qty: 2, course: 'beverage', modifiers: [], line_position: 1, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
    { id: 'kds-line-6-2', kds_order_id: 'kds-order-6', sku: 'CAPPU', display_name: 'Cappuccino', qty: 1, course: 'beverage', modifiers: [], line_position: 2, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
  ],
  'kds-order-7': [
    { id: 'kds-line-7-1', kds_order_id: 'kds-order-7', sku: 'NASI-GORENG', display_name: 'Nasi Goreng Spesial', qty: 1, course: 'main', modifiers: [{ name: 'Sambal', choice: 'Extra Sambal', price_minor: 0 }], line_position: 1, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
    { id: 'kds-line-7-2', kds_order_id: 'kds-order-7', sku: 'ES-JERUK', display_name: 'Es Jeruk Peras', qty: 1, course: 'beverage', modifiers: [], line_position: 2, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
  ],
  'kds-order-8': [
    { id: 'kds-line-8-1', kds_order_id: 'kds-order-8', sku: 'PISANG-GORENG', display_name: 'Pisang Goreng', qty: 1, course: 'dessert', modifiers: [], line_position: 1, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
    { id: 'kds-line-8-2', kds_order_id: 'kds-order-8', sku: 'TEH-T', display_name: 'Teh Tarik', qty: 2, course: 'beverage', modifiers: [], line_position: 2, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
  ],
  'kds-order-9': [
    { id: 'kds-line-9-1', kds_order_id: 'kds-order-9', sku: 'AYAM-BAKAR', display_name: 'Ayam Bakar Madu', qty: 1, course: 'main', modifiers: [{ name: 'Kulit', choice: 'Tanpa Kulit', price_minor: 0 }], line_position: 1, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
    { id: 'kds-line-9-2', kds_order_id: 'kds-order-9', sku: 'TAHU-GORENG', display_name: 'Tahu Goreng', qty: 1, course: 'side', modifiers: [], line_position: 2, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
    { id: 'kds-line-9-3', kds_order_id: 'kds-order-9', sku: 'TEMPE-GORENG', display_name: 'Tempe Goreng', qty: 1, course: 'side', modifiers: [], line_position: 3, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
  ],
  'kds-order-10': [
    { id: 'kds-line-10-1', kds_order_id: 'kds-order-10', sku: 'ES-CAMPUR', display_name: 'Es Campur', qty: 1, course: 'dessert', modifiers: [], line_position: 1, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
    { id: 'kds-line-10-2', kds_order_id: 'kds-order-10', sku: 'KLEPON', display_name: 'Klepon', qty: 1, course: 'dessert', modifiers: [], line_position: 2, item_status: 'pending', started_at: null, ready_at: null, served_at: null, created_at: new Date().toISOString() },
  ],
};

// The real backend persists the kitchen queue (kds_orders 032), per-item
// line statuses (kds_line_items 105), and a daily display counter
// (kds_daily_counters 032), so a restart resumes exactly where the kitchen
// left off. Persist the whole KDS state under one key (same stateful pattern
// as the cart / sales / active-shift mocks above) so previews mirror the DB
// across reloads — previously a reload wiped the queue, reverted every
// status, and restarted ticket numbering at 104.
type MockKdsState = {
  orders: Record<string, unknown>[];
  lineItems: Record<string, Array<Record<string, unknown>>>;
};

/** Accept a persisted KDS queue only when both halves are present and shaped
 *  right. A half-written payload must fall back to the seed rather than reach
 *  a `.map` over undefined further down. */
function asMockKdsState(value: unknown): MockKdsState | null {
  if (!value || typeof value !== 'object') return null;
  const parsed = value as MockKdsState;
  if (!Array.isArray(parsed.orders)) return null;
  if (!parsed.lineItems || typeof parsed.lineItems !== 'object') return null;
  return parsed;
}

function loadMockKdsState(): MockKdsState {
  // First load: seed the queue (and its line items) so the KDS preview
  // renders without a completed sale. Shallow-clone each line so mutations
  // never bleed into the seed literal.
  return readSlice(
    MOCK_KDS_KEY,
    () => ({
      orders: [..._initialKdsOrders],
      lineItems: Object.fromEntries(
        Object.entries(_initialKdsLineItems).map(([orderId, lines]) => [
          orderId,
          lines.map((l) => ({ ...l })),
        ]),
      ),
    }),
    asMockKdsState,
  );
}
function saveMockKdsState(): void {
  writeSlice(MOCK_KDS_KEY, { orders: mockKdsOrders, lineItems: mockKdsLineItems });
}
const mockKdsState = loadMockKdsState();
const mockKdsOrders: Record<string, unknown>[] = mockKdsState.orders;
const mockKdsLineItems: Record<string, Array<Record<string, unknown>>> = mockKdsState.lineItems;
// Next ticket number = one past the highest persisted display_number (the
// backend's per-day counter), never below the seed baseline of 110.

const KDS_MAX_ACTIVE_ORDERS = 20;
const KDS_ORDER_INTERVAL_MS = 60_000; // 1 minute

/** Indonesian restaurant menu items for auto-generated orders. */
const KDS_MOCK_MENU: Array<{ sku: string; name: string; course: string; price: number }> = [
  // Hot Drinks
  { sku: 'LATTE', name: 'Caffè Latte', course: 'beverage', price: 45000 },
  { sku: 'CAPPU', name: 'Cappuccino', course: 'beverage', price: 42000 },
  { sku: 'ESPR', name: 'Espresso Shot', course: 'beverage', price: 28000 },
  { sku: 'KOPI-T', name: 'Kopi Tubruk', course: 'beverage', price: 15000 },
  { sku: 'TEH-T', name: 'Teh Tarik', course: 'beverage', price: 18000 },
  // Cold Drinks
  { sku: 'ICED', name: 'Iced Coffee', course: 'beverage', price: 32000 },
  { sku: 'MATCHA', name: 'Matcha Latte', course: 'beverage', price: 38000 },
  { sku: 'ES-TEH', name: 'Es Teh Manis', course: 'beverage', price: 8000 },
  { sku: 'ES-JERUK', name: 'Es Jeruk Peras', course: 'beverage', price: 12000 },
  { sku: 'JUS-ALPUKAT', name: 'Jus Alpukat', course: 'beverage', price: 20000 },
  { sku: 'SODA-GEMBIRA', name: 'Soda Gembira', course: 'beverage', price: 20000 },
  { sku: 'AIR-MINERAL', name: 'Air Mineral', course: 'beverage', price: 5000 },
  // Main Food
  { sku: 'NASI-GORENG', name: 'Nasi Goreng Spesial', course: 'main', price: 35000 },
  { sku: 'MIE-GORENG', name: 'Mie Goreng Jawa', course: 'main', price: 28000 },
  { sku: 'AYAM-BAKAR', name: 'Ayam Bakar Madu', course: 'main', price: 38000 },
  { sku: 'SATE-AYAM', name: 'Sate Ayam 10 Tusuk', course: 'main', price: 32000 },
  { sku: 'SOTO-AYAM', name: 'Soto Ayam', course: 'main', price: 25000 },
  { sku: 'RAWON', name: 'Rawon Daging', course: 'main', price: 35000 },
  { sku: 'GADO-GADO', name: 'Gado-Gado', course: 'main', price: 22000 },
  // Appetizers & Sides
  { sku: 'CROISS', name: 'Butter Croissant', course: 'main', price: 35000 },
  { sku: 'BAKWAN', name: 'Bakwan Sayur', course: 'side', price: 10000 },
  { sku: 'TAHU-GORENG', name: 'Tahu Goreng', course: 'side', price: 12000 },
  { sku: 'TEMPE-GORENG', name: 'Tempe Goreng', course: 'side', price: 10000 },
  // Desserts
  { sku: 'PISANG-GORENG', name: 'Pisang Goreng', course: 'dessert', price: 15000 },
  { sku: 'ES-KRIM', name: 'Es Krim Coklat', course: 'dessert', price: 18000 },
  { sku: 'KLEPON', name: 'Klepon', course: 'dessert', price: 12000 },
  { sku: 'ES-CAMPUR', name: 'Es Campur', course: 'dessert', price: 18000 },
];

const KDS_NOTES = [
  null, null, null, null, null, // 60% chance of no notes
  'Pedas level 2',
  'Extra sambal',
  'Tanpa es',
  'Setengah matang',
  'Kurang garam',
  'Tambah kecap',
  'Tanpa bawang',
  'Porsi besar',
  'Lekas!',
];

const KDS_TABLES = ['T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12'];
// Next ticket number = one past the highest persisted display_number (the
// backend's per-day counter), never below the seed baseline of 110.
const maxDisplay = mockKdsOrders.reduce((max, o) => {
  const n = Number(o['display_number']);
  return Number.isFinite(n) ? Math.max(max, n) : max;
}, 110);
export const kdsDisplayCounter = { value: maxDisplay + 1 };

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

function evictCompletedOrders(): void {
  while (mockKdsOrders.length > KDS_MAX_ACTIVE_ORDERS) {
    const idx = mockKdsOrders.findIndex(o => o['status'] === 'served' || o['status'] === 'cancelled');
    if (idx === -1) break;
    const removed = mockKdsOrders.splice(idx, 1)[0];
    if (removed) delete mockKdsLineItems[removed['id'] as string];
  }
}


/** Pick a random element from an array. */

function generateRandomKdsOrder(): { order: Record<string, unknown>; lines: Array<Record<string, unknown>> } {
  const displayNumber = kdsDisplayCounter.value++;
  const now = new Date().toISOString();
  const orderId = `kds-order-auto-${Date.now()}-${displayNumber}`;
  const numItems = Math.floor(Math.random() * 4) + 1; // 1-4 items
  const picked: Array<typeof KDS_MOCK_MENU[0]> = [];
  while (picked.length < numItems) {
    const item = pickRandom(KDS_MOCK_MENU);
    if (!picked.some(p => p.sku === item.sku)) picked.push(item);
  }
  // Generate realistic quantities — beverages/sides often ordered in multiples
  const lines: Array<Record<string, unknown>> = picked.map((item, i) => {
    let qty = 1;
    if (item.course === 'beverage') {
      // Drinks: 55% ×1, 25% ×2, 15% ×3, 5% ×4
      const r = Math.random();
      if (r > 0.95) qty = 4;
      else if (r > 0.80) qty = 3;
      else if (r > 0.55) qty = 2;
    } else if (item.course === 'side') {
      // Sides: 55% ×1, 30% ×2, 15% ×3
      const r = Math.random();
      if (r > 0.85) qty = 3;
      else if (r > 0.55) qty = 2;
    } else {
      // Mains/desserts: mostly ×1, rarely ×2
      if (Math.random() > 0.85) qty = 2;
    }
    return {
      id: `kds-line-auto-${orderId}-${i}`,
      kds_order_id: orderId,
      sku: item.sku,
      display_name: item.name,
      qty,
      course: item.course,
      modifiers: [],
      line_position: i + 1,
      item_status: 'pending',
      started_at: null,
      ready_at: null,
      served_at: null,
      created_at: now,
    };
  });

  const itemCount = lines.reduce((sum, l) => sum + (l['qty'] as number), 0);
  const itemsSummary = lines.map(l => `${l['qty']}x ${l['display_name']}`).join(', ');
  const kdsTablesWithNull: (string | null)[] = [...KDS_TABLES, null];
  const tableNumber = pickRandom(kdsTablesWithNull);
  const orderType = tableNumber ? 'dine_in' : 'takeaway';

  const order: Record<string, unknown> = {
    id: orderId,
    display_number: displayNumber,
    status: 'pending',
    received_at: now,
    items_summary: itemsSummary,
    item_count: itemCount,
    order_type: orderType,
    table_number: tableNumber,
    notes: pickRandom(KDS_NOTES),
    store_id: 'store-1',
  };

  return { order, lines };
}

/** Evict served/cancelled orders when queue exceeds max. */

function startKdsAutoGeneration(): void {
  // Skip if already running or if we have too many orders on first load.
  if (mockKdsOrders.length > KDS_MAX_ACTIVE_ORDERS) {
    mockKdsOrders.length = KDS_MAX_ACTIVE_ORDERS;
  }

  setInterval(() => {
    const { order, lines } = generateRandomKdsOrder();
    mockKdsOrders.push(order);
    mockKdsLineItems[order['id'] as string] = lines;
    evictCompletedOrders();
    saveMockKdsState();
    // Notify KDS screens of new order.
    void emit('kds:orders-changed', null);
  }, KDS_ORDER_INTERVAL_MS);
}

// Start auto-generation on load.
startKdsAutoGeneration();

// ── Auto-progress: advance orders through stages ──
// pending → preparing (2-5 min), preparing → ready (3-8 min).
// Keeps the KDS screen alive by moving orders through the kitchen.
const KDS_PROGRESS_INTERVAL_MS = 10_000; // check every 10s
const KDS_PENDING_TO_PREPARING_MIN_MS = 120_000; // 2 min minimum before prep
const KDS_PENDING_TO_PREPARING_MAX_MS = 300_000; // 5 min
const KDS_PREPARING_TO_READY_MIN_MS = 180_000; // 3 min minimum before ready
const KDS_PREPARING_TO_READY_MAX_MS = 480_000; // 8 min

function startKdsAutoProgress(): void {
  setInterval(() => {
    let changed = false;
    const now = Date.now();
    for (const order of mockKdsOrders) {
      const status = order['status'] as string;
      const receivedAt = new Date(order['received_at'] as string).getTime();
      const elapsed = now - receivedAt;

      if (status === 'pending') {
        const threshold = KDS_PENDING_TO_PREPARING_MIN_MS +
          Math.random() * (KDS_PENDING_TO_PREPARING_MAX_MS - KDS_PENDING_TO_PREPARING_MIN_MS);
        if (elapsed >= threshold) {
          order['status'] = 'preparing';
          order['started_at'] = new Date().toISOString();
          // Progress some line items to 'cooking'
          const lines = mockKdsLineItems[order['id'] as string];
          if (lines) {
            for (const line of lines) {
              if (line['item_status'] === 'pending') {
                line['item_status'] = 'cooking';
                line['started_at'] = new Date().toISOString();
                break; // only start one item at a time
              }
            }
          }
          changed = true;
        }
      } else if (status === 'preparing') {
        const threshold = KDS_PREPARING_TO_READY_MIN_MS +
          Math.random() * (KDS_PREPARING_TO_READY_MAX_MS - KDS_PREPARING_TO_READY_MIN_MS);
        if (elapsed >= threshold) {
          order['status'] = 'ready';
          order['ready_at'] = new Date().toISOString();
          // Mark all line items as ready
          const lines = mockKdsLineItems[order['id'] as string];
          if (lines) {
            for (const line of lines) {
              if (line['item_status'] !== 'ready') {
                line['item_status'] = 'ready';
                line['ready_at'] = new Date().toISOString();
              }
            }
          }
          changed = true;
        }
      } else if (status === 'ready') {
        // Auto-serve after 5-10 minutes of being ready
        const readyAt = order['ready_at'] ? new Date(order['ready_at'] as string).getTime() : receivedAt;
        const readyElapsed = now - readyAt;
        if (readyElapsed >= 300_000 + Math.random() * 300_000) {
          order['status'] = 'served';
          order['served_at'] = new Date().toISOString();
          const lines = mockKdsLineItems[order['id'] as string];
          if (lines) {
            for (const line of lines) {
              line['item_status'] = 'served';
              line['served_at'] = new Date().toISOString();
            }
          }
          changed = true;
        }
      }

      // Escalate priority after 10 minutes total
      if (elapsed >= 600_000 && !order['priority']) {
        order['priority'] = true;
        changed = true;
      }
    }
    if (changed) {
      evictCompletedOrders();
      saveMockKdsState();
      void emit('kds:orders-changed', null);
    }
  }, KDS_PROGRESS_INTERVAL_MS);
}

startKdsAutoProgress();

/** Push a new KDS order derived from cart lines into the mock queue. */

export const kdsHandlers: Record<string, MockHandler> = {


  // ═══════════════════════════════════════════════════════════════
  // KDS
  // ═══════════════════════════════════════════════════════════════

  'list_kds_orders': () => mockKdsOrders,
  'list_kds_orders_scoped': (args: unknown) => {
    let status: string | undefined;
    if (Array.isArray(args)) {
      [, status] = args as [string, string | undefined];
    } else {
      const obj = (args ?? {}) as Record<string, unknown>;
      status = obj['status'] as string | undefined;
    }
    return mockKdsOrders.filter(order => !status || order['status'] === status);
  },
  'get_kds_queue': (args: unknown) => {
    let kdsZone: string | undefined;
    if (Array.isArray(args)) {
      [, kdsZone] = args as [string, string | undefined];
    } else {
      const obj = (args ?? {}) as Record<string, unknown>;
      kdsZone = obj['kdsZone'] as string | undefined;
    }
    return mockKdsOrders.filter(order => !kdsZone || order['kitchen_zone'] === kdsZone);
  },
  'get_kds_queue_scoped': (args: unknown) => {
    let kdsZone: string | undefined;
    if (Array.isArray(args)) {
      [, kdsZone] = args as [string, string | undefined];
    } else {
      const obj = (args ?? {}) as Record<string, unknown>;
      kdsZone = obj['kdsZone'] as string | undefined;
    }
    return mockKdsOrders.filter(order => !kdsZone || order['kitchen_zone'] === kdsZone);
  },
  'update_kds_status': (args) => {
    const { id, status } = (args as { id?: string; status?: string }) ?? {};
    const order = mockKdsOrders.find((o) => o['id'] === id);
    if (order && status) {
      order['status'] = status;
      saveMockKdsState();
      void emit('kds:orders-changed', null);
    }
    return order ?? null;
  },
  'update_kds_status_scoped': (args) => {
    const { id, status } = (args as { id?: string; status?: string }) ?? {};
    const order = mockKdsOrders.find((o) => o['id'] === id);
    if (order && status) {
      order['status'] = status;
      saveMockKdsState();
      void emit('kds:orders-changed', null);
    }
    return order ?? null;
  },
  'create_kds_order_from_sale': () => [],
  'create_kds_order_from_sale_scoped': () => [],
  'get_kds_order': () => null,
  'get_kds_order_scoped': () => null,
  'get_kds_order_lines': (args) => {
    const { id } = (args as { id?: string }) ?? {};
    return (id ? mockKdsLineItems[id] : undefined) ?? [];
  },
  'get_kds_order_lines_scoped': (args) => {
    const { orderId } = (args as { orderId?: string }) ?? {};
    return (orderId ? mockKdsLineItems[orderId] : undefined) ?? [];
  },
  'update_kds_line_item_status': (args) => {
    const { itemId, status } = (args as { itemId?: string; status?: string }) ?? {};
    const item = Object.values(mockKdsLineItems).flat().find((i) => i['id'] === itemId);
    if (item && status) {
      item['item_status'] = status;
      saveMockKdsState();
      void emit('kds:orders-changed', null);
    }
    return item ?? null;
  },
  'update_kds_line_item_status_scoped': (args) => {
    const { itemId, status } = (args as { itemId?: string; status?: string }) ?? {};
    const item = Object.values(mockKdsLineItems).flat().find((i) => i['id'] === itemId);
    if (item && status) {
      item['item_status'] = status;
      saveMockKdsState();
      void emit('kds:orders-changed', null);
    }
    return item ?? null;
  },
  'ack_kds_order_scoped': () => true,
  'resolve_kds_targets_scoped': () => [] as string[],
  'print_kds_chit_scoped': () => true,
  'update_kds_order_items_scoped': (args) => {
    const raw = (args ?? {}) as { id?: string; args?: { id?: string } };
    const id = raw.id ?? raw.args?.id ?? '';
    return mockKdsOrders.find((o) => o['id'] === id) ?? null;
  },
  'update_kds_order_items': (args) => {
    const raw = (args ?? {}) as { id?: string; args?: { id?: string } };
    const id = raw.id ?? raw.args?.id ?? '';
    return mockKdsOrders.find((o) => o['id'] === id) ?? null;
  },
};
export type { MockKdsState };
export { KDS_MAX_ACTIVE_ORDERS, KDS_MOCK_MENU, KDS_NOTES, KDS_ORDER_INTERVAL_MS, KDS_PENDING_TO_PREPARING_MAX_MS, KDS_PENDING_TO_PREPARING_MIN_MS, KDS_PREPARING_TO_READY_MAX_MS, KDS_PREPARING_TO_READY_MIN_MS, KDS_PROGRESS_INTERVAL_MS, KDS_TABLES, _initialKdsLineItems, _initialKdsOrders, asMockKdsState, generateRandomKdsOrder, loadMockKdsState, mockKdsLineItems, mockKdsOrders, mockKdsState, saveMockKdsState, startKdsAutoGeneration, startKdsAutoProgress };
