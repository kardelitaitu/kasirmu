// ui/src/features/kds/kdsRoutingRulesModel.ts
//
// Pure model helpers for the KDS routing-rules editor (todo-kds-agents-1 UI
// follow-up). The backend save IPC is a WHOLE-SET REPLACE with server-assigned
// ids/timestamps (crates/oz-bridge/src/kds_routing.rs), so the editor works on
// draft rows and priority is POSITIONAL: the row list order is the priority
// order, and `toSavePayload` renumbers `priority` 1..n on save. Ranking is
// priority-ascending — lower number = higher rank (see `KdsRoutingRule` in
// crates/oz-core/src/kds.rs).
//
// TAG MATCHER HONESTY: a `tag` rule STORES and round-trips but NEVER MATCHES
// — tags are not modeled in the catalog (`KdsRuleMatcher::Tag => false` in
// the pure engine). The editor still offers the option because a server-side
// tag rule must render without silently losing its value on the next
// whole-set replace; the component shows a "not yet effective" hint on every
// tag row. Keep this file free of UI so the decision is pinned in one place.

import type {
  KdsRoutingRule,
  KdsRoutingRuleInput,
  KdsRuleMatcher,
} from '@/api/kds';

/** One editable draft row of the routing-rules table. */
export interface KdsRuleRow {
  /** Stable React key: the persisted id, or a `draft-<n>` key for unsaved rows. */
  key: string;
  /** What the rule matches a line against. */
  matcher: KdsRuleMatcher;
  /** SKU string or category id (free text; mirrors the column's value). */
  matcher_value: string;
  /** Topology station the matched line routes to. */
  target_station: string;
  /** Whether the rule participates in routing. */
  is_active: boolean;
}

/** Convert the persisted rules returned by get/save into draft rows, in order. */
export function rowsFromPersisted(rules: KdsRoutingRule[]): KdsRuleRow[] {
  return rules.map((r) => ({
    key: r.id,
    matcher: r.matcher,
    matcher_value: r.matcher_value,
    target_station: r.target_station,
    is_active: r.is_active,
  }));
}

/**
 * Swap a row with its neighbour (priority is an integer rank — reorder is a
 * move, never a drag). Returns the same reference when the move is out of
 * bounds so callers can pass edge indexes without pre-checking.
 */
export function moveRow(
  rows: KdsRuleRow[],
  index: number,
  delta: -1 | 1,
): KdsRuleRow[] {
  const target = index + delta;
  if (index < 0 || index >= rows.length) return rows;
  if (target < 0 || target >= rows.length) return rows;
  const next = [...rows];
  const a = next[index] as KdsRuleRow;
  const b = next[target] as KdsRuleRow;
  next[index] = b;
  next[target] = a;
  return next;
}

/**
 * Build the whole-set save payload: one input per row, in list order, with
 * `priority` renumbered to the position (1 = highest rank). Values are
 * trimmed because the store rejects blank matcher values / target stations.
 */
export function toSavePayload(rows: KdsRuleRow[]): KdsRoutingRuleInput[] {
  return rows.map((r, i) => ({
    priority: i + 1,
    matcher: r.matcher,
    matcher_value: r.matcher_value.trim(),
    target_station: r.target_station.trim(),
    is_active: r.is_active,
  }));
}

/** Keys of rows that would be rejected by the store's blank-value validation. */
export function incompleteRowKeys(rows: KdsRuleRow[]): Set<string> {
  const bad = new Set<string>();
  for (const r of rows) {
    if (r.matcher_value.trim() === '' || r.target_station.trim() === '') {
      bad.add(r.key);
    }
  }
  return bad;
}

/** A blank rule appended at the bottom (lowest rank), inactive-free default. */
export function newDraftRow(seq: number): KdsRuleRow {
  return {
    key: `draft-${seq}`,
    matcher: 'sku',
    matcher_value: '',
    target_station: '',
    is_active: true,
  };
}
