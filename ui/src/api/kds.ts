import { loggedInvoke } from '@/utils/logged-invoke';

/** Status of a Kitchen Display System order. */
export type KdsStatus = 'pending' | 'preparing' | 'ready' | 'served' | 'cancelled';

/** A modifier choice attached to a line item. */
export interface KdsModifier {
  name: string;
  choice: string;
  price_minor: number;
}

/** A single line item on a KDS order ticket. */
export interface KdsLineItem {
  id: string;
  kds_order_id: string;
  sku: string;
  display_name: string;
  qty: number;
  /** Course assignment: "appetizer", "main", "dessert", "beverage", or null. */
  course: string | null;
  /** Modifier choices. */
  modifiers: KdsModifier[];
  line_position: number;
  item_status: string;
  started_at: string | null;
  ready_at: string | null;
  served_at: string | null;
  created_at: string;
}

/** A Kitchen Display System order. */
export interface KdsOrder {
  id: string;
  sale_id: string;
  /** The store this order belongs to (ADR #8). Used for defense-in-depth filtering. */
  store_id: string | null;
  /** Topology-selected KDS workspace instance, or null for legacy tickets. */
  target_instance_id?: string | null;
  status: KdsStatus;
  items_summary: string;
  item_count: number;
  display_number: number | null;
  received_at: string;
  started_at: string | null;
  ready_at: string | null;
  served_at: string | null;
  prep_time_seconds: number;
  /** Kitchen zone this order is assigned to (e.g., "front", "back"). */
  kitchen_zone: string | null;
  notes: string;
  /** Table number assigned to this order (e.g., "T5"), or null for takeaway. */
  table_number: string | null;
  /** Priority/rush flag: when true the ticket visually escalates above normal SLA. */
  priority: boolean;
}

/** List KDS orders, optionally filtered by status (session-scoped — ADR #7). */
export const listKdsOrders = (sessionToken: string, status?: KdsStatus): Promise<KdsOrder[]> =>
  loggedInvoke<KdsOrder[]>('list_kds_orders_scoped', { sessionToken, status: status ?? null });

/** List KDS orders (scoped — ADR #7). */
export const listKdsOrdersScoped = (sessionToken: string, status?: KdsStatus): Promise<KdsOrder[]> =>
  loggedInvoke<KdsOrder[]>('list_kds_orders_scoped', { sessionToken, status: status ?? null });

/** Get the KDS queue, optionally filtered by kitchen zone (session-scoped — ADR #7). */
export const getKdsQueue = (sessionToken: string, kdsZone?: string): Promise<KdsOrder[]> =>
  loggedInvoke<KdsOrder[]>('get_kds_queue_scoped', { sessionToken, kdsZone: kdsZone ?? null });

/** Get the KDS queue (scoped — ADR #7), optionally filtered by kitchen zone. */
export const getKdsQueueScoped = (sessionToken: string, kdsZone?: string): Promise<KdsOrder[]> =>
  loggedInvoke<KdsOrder[]>('get_kds_queue_scoped', { sessionToken, kdsZone: kdsZone ?? null });

/** Update a KDS order's status (e.g. preparing, ready, served) (session-scoped — ADR #7). */
export const updateKdsStatus = (sessionToken: string, id: string, status: KdsStatus): Promise<KdsOrder> =>
  loggedInvoke<KdsOrder>('update_kds_status_scoped', { sessionToken, id, status });

/** Update a KDS order's status (scoped — ADR #7). */
export const updateKdsStatusScoped = (sessionToken: string, id: string, status: KdsStatus): Promise<KdsOrder> =>
  loggedInvoke<KdsOrder>('update_kds_status_scoped', { sessionToken, id, status });

/** Create KDS orders from a completed sale (session-scoped — ADR #7). Returns one order per kitchen zone. */
export const createKdsOrderFromSale = (sessionToken: string, saleId: string): Promise<KdsOrder[]> =>
  loggedInvoke<KdsOrder[]>('create_kds_order_from_sale_scoped', { sessionToken, saleId });

/** Create KDS orders from a sale (scoped — ADR #7). */
export const createKdsOrderFromSaleScoped = (sessionToken: string, saleId: string): Promise<KdsOrder[]> =>
  loggedInvoke<KdsOrder[]>('create_kds_order_from_sale_scoped', { sessionToken, saleId });

/** A single item within a fired course (mirrors Rust CourseItem). */
export interface FiredCourseItem {
  sku: string;
  qty: number;
  name: string;
}

/** Arguments for publishing a fired course (mirrors Rust FireCourseForSaleArgs). */
export interface FireCourseForSaleArgs {
  saleId: string;
  courseId: string;
  displayNumber?: number | null;
  items: FiredCourseItem[];
}

/**
 * Publish one fired course for a completed sale (scoped — ADR #7).
 *
 * Called at checkout after the KDS fan-out, once per course whose lines the
 * waiter fired (`coursingStatus === 'fired'`). Carries the REAL sale id and
 * the ticket display number — firing happens at checkout, not on the
 * pre-sale cart, so no cart-id correlation is needed. Best-effort like the
 * KDS ticket call: the sale is already committed; a publish failure must
 * surface as a warning, never as a failed checkout.
 */
export const publishCourseFiredScoped = (sessionToken: string, args: FireCourseForSaleArgs): Promise<void> =>
  loggedInvoke<void>('publish_course_fired_scoped', { sessionToken, args });

/** Get a single KDS order by its identifier (session-scoped — ADR #7). */
export const getKdsOrder = (sessionToken: string, id: string): Promise<KdsOrder | null> =>
  loggedInvoke<KdsOrder | null>('get_kds_order_scoped', { sessionToken, id });

/** Get a KDS order by id (scoped — ADR #7). */
export const getKdsOrderScoped = (sessionToken: string, id: string): Promise<KdsOrder | null> =>
  loggedInvoke<KdsOrder | null>('get_kds_order_scoped', { sessionToken, id });

/** Input for creating a KDS line item (mirrors Rust CreateKdsLineItemInput). */
export interface CreateKdsLineItemInput {
  sku: string;
  display_name: string;
  qty: number;
  course: string | null;
  modifiers: KdsModifier[];
}

/** Input for updating items on an existing KDS order. */
export interface UpdateKdsOrderItemsInput {
  id: string;
  items_summary: string;
  item_count: number;
  /** Structured line items to replace kds_line_items. When provided, summary/count are re-derived. */
  line_items?: CreateKdsLineItemInput[] | null;
}

/** Update KDS order items (scoped — ADR #7). */
export const updateKdsOrderItemsScoped = (sessionToken: string, args: UpdateKdsOrderItemsInput): Promise<KdsOrder> =>
  loggedInvoke<KdsOrder>('update_kds_order_items_scoped', { sessionToken, args });

/** Print a kitchen chit for a KDS order (scoped — ADR #7). */
export const printKdsChitScoped = (sessionToken: string, orderId: string): Promise<boolean> =>
  loggedInvoke<boolean>('print_kds_chit_scoped', { sessionToken, orderId });

/** Get all line items for a KDS order (scoped — ADR #7). */
export const getKdsOrderLinesScoped = (sessionToken: string, orderId: string): Promise<KdsLineItem[]> =>
  loggedInvoke<KdsLineItem[]>('get_kds_order_lines_scoped', { sessionToken, orderId });

/** Update the status of a single KDS line item (scoped — ADR #7). */
export const updateKdsLineItemStatusScoped = (
  sessionToken: string,
  itemId: string,
  status: KdsStatus,
): Promise<KdsLineItem> =>
  loggedInvoke<KdsLineItem>('update_kds_line_item_status_scoped', { sessionToken, itemId, status });

// ── KDS Device Management ──────────────────────────────────────

/** Connection status of a KDS device. */
export type KdsConnectionStatus = 'connected' | 'disconnected' | 'stale';

/** A registered KDS display device bound to one Restaurant POS. */
export interface KdsDevice {
  id: string;
  name: string;
  restaurant_pos_id: string;
  /** Topology station IDs this device is responsible for. Empty = broadcast. */
  station_ids: string[];
  is_active: boolean;
  last_seen_at: string | null;
  connection_status: KdsConnectionStatus;
  created_at: string;
  updated_at: string;
}

/** Input for registering a new KDS device. */
export interface RegisterKdsDeviceInput {
  name: string;
  restaurant_pos_id: string;
  station_ids: string[];
  pairing_token_hash: string;
  pairing_expires_at: string;
}

/** Register a new KDS device (scoped — ADR #7). */
export const registerKdsDeviceScoped = (
  sessionToken: string,
  input: RegisterKdsDeviceInput,
): Promise<KdsDevice> =>
  loggedInvoke<KdsDevice>('register_kds_device_scoped', { sessionToken, input });

/** List all KDS devices for the Restaurant POS (scoped — ADR #7). */
export const listKdsDevicesScoped = (
  sessionToken: string,
): Promise<KdsDevice[]> =>
  loggedInvoke<KdsDevice[]>('list_kds_devices_scoped', { sessionToken });

/** Get a single KDS device by ID (scoped — ADR #7). */
export const getKdsDeviceScoped = (
  sessionToken: string,
  deviceId: string,
): Promise<KdsDevice | null> =>
  loggedInvoke<KdsDevice | null>('get_kds_device_scoped', { sessionToken, deviceId });

/** Update a KDS device's connection status (scoped — ADR #7). */
export const updateKdsDeviceStatusScoped = (
  sessionToken: string,
  deviceId: string,
  status: KdsConnectionStatus,
): Promise<void> =>
  loggedInvoke<void>('update_kds_device_status_scoped', { sessionToken, deviceId, status });

/** Deactivate a KDS device (soft-delete) (scoped — ADR #7). */
export const deactivateKdsDeviceScoped = (
  sessionToken: string,
  deviceId: string,
): Promise<void> =>
  loggedInvoke<void>('deactivate_kds_device_scoped', { sessionToken, deviceId });

/** Acknowledge a KDS order (scoped — ADR #7). Returns true if ack succeeded. */
export const ackKdsOrderScoped = (
  sessionToken: string,
  orderId: string,
  deviceId: string,
): Promise<boolean> =>
  loggedInvoke<boolean>('ack_kds_order_scoped', { sessionToken, orderId, deviceId });

/** Resolve which KDS device IDs should receive an order (scoped — ADR #7). */
export const resolveKdsTargetsScoped = (
  sessionToken: string,
  orderId: string,
): Promise<string[]> =>
  loggedInvoke<string[]>('resolve_kds_targets_scoped', { sessionToken, orderId });

// ── KDS Routing Rules ──────────────────────────────────────────

/** What a routing rule matches a line item against (mirrors Rust `KdsRuleMatcher`). */
export type KdsRuleMatcher = 'sku' | 'category' | 'tag';

/** One row of `kds_routing_rules` (mirrors Rust `KdsRoutingRule`). */
export interface KdsRoutingRule {
  /** Server-assigned UUID v7. */
  id: string;
  /** FK to the owning Restaurant POS terminal — the rule scope. */
  restaurant_pos_id: string;
  /** Lower number = higher priority (1 outranks 10). */
  priority: number;
  matcher: KdsRuleMatcher;
  /** SKU string or category id, depending on `matcher`. */
  matcher_value: string;
  /** Topology station the matched line routes to. */
  target_station: string;
  /** Whether the rule participates in routing. */
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Client-supplied rule for the save IPC (mirrors Rust `KdsRoutingRuleInput`). */
export interface KdsRoutingRuleInput {
  /** Lower number = higher priority (1 outranks 10). */
  priority: number;
  matcher: KdsRuleMatcher;
  /** SKU string or category id, depending on `matcher`. */
  matcher_value: string;
  /** Topology station the matched line routes to. */
  target_station: string;
  /** Omitted means active — the server applies the column default. */
  is_active?: boolean;
}

/** List the session restaurant's routing rules, highest priority first (scoped — ADR #7). */
export const getKdsRoutingRulesScoped = (
  sessionToken: string,
): Promise<KdsRoutingRule[]> =>
  loggedInvoke<KdsRoutingRule[]>('get_kds_routing_rules_scoped', { sessionToken });

/** Replace the session restaurant's whole routing-rule set (scoped — ADR #7). */
export const saveKdsRoutingRulesScoped = (
  sessionToken: string,
  rules: KdsRoutingRuleInput[],
): Promise<KdsRoutingRule[]> =>
  loggedInvoke<KdsRoutingRule[]>('save_kds_routing_rules_scoped', { sessionToken, rules });
