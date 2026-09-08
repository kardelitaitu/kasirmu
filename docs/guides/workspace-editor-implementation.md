# Design: Course/Modifier Data Pipeline — POS → KDS

> TODO 2a assessment: Large effort. This is a cross-cutting change touching
> the POS cart, Sale/SaleLine model, DB schema, KDS data pipeline, and
> front-end ticket card. Estimated 2–4 days of focused work.

---

## 1. Problem Statement

Currently `complete_sale_to_kds` builds a flat `items_summary` string like:

```
"Steak x2, Salad, Fries x3"
```

This loses three critical pieces of information:

1. **Course structure** — Which items are appetizers vs mains vs desserts?
   A real kitchen prints separate chits per course, or displays them with
   visual separators. Receiving all items at once causes the kitchen to
   cook everything simultaneously rather than pacing the meal.

2. **Modifier details** — "Medium rare, no onions" on the steak and
   "extra dressing" on the salad are both flattened into the `notes` field
   (if at all). Modifiers should follow their parent item, not the order.

3. **Per-item identity** — KDS cannot track item-level status (TODO 3e)
   because there is no `kds_line_items` table. The entire order has one
   status even though the steak takes 12 min and the salad takes 2 min.

---

## 2. Proposed Schema

### 2a. Enrich `sale_lines` with course + modifier data

Add two columns to the existing `sale_lines` table:

```sql
ALTER TABLE sale_lines ADD COLUMN course TEXT;      -- NULL | "appetizer" | "main" | "dessert" | "beverage"
ALTER TABLE sale_lines ADD COLUMN modifiers_json TEXT; -- NULL | JSON array of modifier objects
```

The `course` column is set at POS cart-build time per line. The
`modifiers_json` stores a stringified JSON array:

```json
[
  { "name": "Temperature", "choice": "Medium Rare", "price_minor": 0 },
  { "name": "Add-ons", "choice": "Extra Cheese", "price_minor": 200 }
]
```

Both columns are nullable — backwards-compatible with existing sales.

### 2b. New `kds_line_items` table

This is the core change. Replace the single `items_summary: String` on
`KdsOrder` with a structured `kds_line_items` table that preserves:

- Which product (sku, name)
- Quantity
- Course assignment
- Modifiers
- Per-item display order
- Per-item status (for TODO 3e item-level status)

```sql
CREATE TABLE kds_line_items (
    id              TEXT PRIMARY KEY,          -- UUIDv7
    kds_order_id    TEXT NOT NULL REFERENCES kds_orders(id) ON DELETE CASCADE,
    sku             TEXT NOT NULL,
    display_name    TEXT NOT NULL,             -- resolved product name at creation time
    qty             INTEGER NOT NULL CHECK(qty > 0),
    course          TEXT,                      -- NULL | "appetizer" | "main" | "dessert" | "beverage"
    modifiers_json  TEXT,                      -- NULL | JSON array
    line_position   INTEGER NOT NULL DEFAULT 0,
    item_status     TEXT NOT NULL DEFAULT 'pending'
                    CHECK(item_status IN ('pending','preparing','ready','served','cancelled')),
    started_at      TEXT,
    ready_at        TEXT,
    served_at       TEXT,
    created_at      TEXT NOT NULL
);

CREATE INDEX idx_kds_line_items_order ON kds_line_items(kds_order_id, line_position);
CREATE INDEX idx_kds_line_items_status ON kds_line_items(kds_order_id, item_status);
```

This enables:
- `.join(", ")` for the legacy flat summary (derived, not stored)
- Course-grouped display
- Per-item modifier display
- Item-level status tracking (TODO 3e)

### 2c. Keep `items_summary` on `kds_orders` as a denormalized cache

Do **not** remove the `items_summary` column. Keep it as a generated/
derived value so that:
- The `print_kds_chit` command can still format chits without a JOIN
- The queue list endpoint can return summary rows without loading items
- The legacy flat string is available for simple displays

Update it on every `update_kds_order_items` call to stay in sync.

---

## 3. Rust Type Changes

### 3a. New `KdsLineItem` struct

```rust
/// A single line item on a KDS order ticket.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KdsLineItem {
    pub id: String,
    pub kds_order_id: String,
    pub sku: String,
    pub display_name: String,
    pub qty: i64,
    pub course: Option<String>,
    pub modifiers: Vec<KdsModifier>,
    pub line_position: i64,
    pub item_status: String,
    pub started_at: Option<String>,
    pub ready_at: Option<String>,
    pub served_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KdsModifier {
    pub name: String,
    pub choice: String,
    pub price_minor: i64,
}
```

### 3b. Enriched `SaleLine`

Add `course` and `modifiers` fields (matching the new DB columns):

```rust
pub struct SaleLine {
    // ... existing fields ...
    pub course: Option<String>,
    pub modifiers: Vec<KdsModifier>,  // empty vec when no modifiers
}
```

### 3c. Updated `CreateKdsOrderInput`

Replace `items_summary: String` + `item_count: i64` with structured data,
while keeping the summary as a derived convenience:

```rust
pub struct CreateKdsOrderInput {
    pub sale_id: String,
    pub store_id: Option<String>,
    pub kitchen_zone: Option<String>,
    pub notes: String,
    pub table_number: Option<String>,
    pub priority: bool,
    pub items: Vec<CreateKdsLineItemInput>,
}

pub struct CreateKdsLineItemInput {
    pub sku: String,
    pub display_name: String,
    pub qty: i64,
    pub course: Option<String>,
    pub modifiers: Vec<KdsModifier>,
}
```

### 3d. Course ordering constants

```rust
/// Priority ordering for courses on the KDS display.
/// Lower number = displayed first.
pub const COURSE_ORDER: &[(&str, i64)] = &[
    ("appetizer", 0),
    ("main",      1),
    ("side",      2),
    ("dessert",   3),
    ("beverage",  4),
];

pub fn course_sort_key(course: Option<&str>) -> i64 {
    match course {
        Some(c) => COURSE_ORDER.iter()
            .find(|(name, _)| *name == c)
            .map(|(_, order)| *order)
            .unwrap_or(99),
        None => 99,
    }
}
```

---

## 4. Implementation Plan

### Phase 1 — Schema + Backend (Day 1)

| Step | Files | Changes |
|------|-------|---------|
| 1. Migration 105 | squashed into `crates/oz-core/migrations/20260813_init.sql` | New `kds_line_items` table |
| 2. Migration 106 | squashed into the same `20260813_init.sql` | ALTER TABLE for `course` + `modifiers_json` on `sale_lines` |

The 131 pre-Aug-2026 migrations were squashed into `20260813_init.sql`, so numbered files 105 and 106 no longer exist as files. The schema they created does — `kds_line_items` and `modifiers_json` are both in the init baseline. Registry order in `crates/oz-core/src/migrations.rs` is canonical, not filename order.
| 3. Rust types | `crates/oz-core/src/kds.rs` | Add `KdsLineItem`, `KdsModifier`, `CreateKdsLineItemInput` structs |
| 4. Enrich SaleLine | `modules/sales/src/models.rs` (not `models/sale.rs`) | Add `course: Option<String>` and `modifiers_json: Option<String>` to `SaleLine` — both present, at lines 65 and 71 |
| 5. Update `CreateKdsOrderInput` | `crates/oz-core/src/kds.rs` | Replace `items_summary`/`item_count` with `items: Vec<CreateKdsLineItemInput>` |
| 6. DB: insert line items | `crates/oz-core/src/db/kds.rs` | New `create_kds_line_items` method + update `create_kds_order` to call it |

### Phase 2 — KDS Pipeline (Day 2)

| Step | Files | Changes |
|------|-------|---------|
| 7. Rewrite `complete_sale_to_kds` | `crates/oz-core/src/db/kds.rs` | Build structured `CreateKdsLineItemInput` per line with course + modifiers from sale lines; still group by zone |
| 8. Derive `items_summary` | `crates/oz-core/src/db/kds.rs` | After inserting line items, derive the flat summary by joining display names |
| 9. Update `row_to_kds_order` | `crates/oz-core/src/db/kds.rs` | Remove items_summary derivation; keep legacy field but set from derived |
| 10. Update `get_kds_order` | `crates/oz-core/src/db/kds.rs` | Load line items alongside the order (or lazy via `with_lines()`) |
| 11. New API: `get_kds_order_lines` | `crates/oz-core/src/db/kds.rs` | Query kds_line_items by kds_order_id, ordered by course_sort_key + line_position |
| 12. New Tauri command | `apps/desktop-client/src/commands/kds.rs` | `get_kds_order_lines_scoped` returning `Vec<KdsLineItem>` |

### Phase 3 — Frontend Display (Day 3)

| Step | Files | Changes |
|------|-------|---------|
| 13. KDS types | `ui/src/api/kds.ts` | Add `KdsLineItem`, `KdsModifier` interfaces |
| 14. API wrapper | `ui/src/api/kds.ts` | Add `getKdsOrderLinesScoped()` |
| 15. Course-grouped display | `ui/src/features/kds/components/KdsTicketCard.tsx` | Replace flat `<span>{order.items_summary}</span>` with course-grouped item list. Each course gets a header badge ("APPETIZER", "MAIN"). Modifiers shown as indented sub-lines below each item. |
| 16. CSS for course groups | `ui/src/features/kds/KdsScreen.css` | New `kds-course-header`, `kds-item-modifier` classes |
| 17. FTL keys | `ui/src/locales/kds.ftl` + `kds.id.ftl` | Course header labels, modifier prefix text |
| 18. Per-item status display | `ui/src/features/kds/components/KdsTicketCard.tsx` | Show per-item status badge when available (future: TODO 3e) |

### Phase 4 — POS Integration (Day 4)

| Step | Files | Changes |
|------|-------|---------|
| 19. Cart: course assignment | `ui/src/features/retail/RetailCartPanel.tsx` + `ui/src/features/sales/PosScreen.tsx` | UI to assign course per line item in restaurant mode. **There is no `ui/src/features/pos/` directory and no `PosCartPanel.tsx` anywhere in the tree** — the course bar is `pos-cart-course-bar`, rendered from `COURSES` inside `PosScreen.tsx` (around line 1542) and styled by `ui/src/features/sales/CartPanelCourseBar.css` |
| 20. Cart: modifiers | `ui/src/features/retail/RetailCartPanel.tsx` | "Add modifier" button per line → modal with modifier groups from product |
| 21. Cart → SaleLine | `crates/oz-core/src/cart.rs` | Carry `course` and `modifiers` through CartLine → SaleLine |
| 22. Sale completion | `crates/oz-core/src/db/sales.rs` | Write `course` + `modifiers_json` on `sale_lines` INSERT |

---

## 5. Display Mockup (KDS Ticket Card)

```
┌──────────────────────────────────┐
│  #42      T5           ⏱ 08:12  │
│ ── APPETIZER ─────────────────── │
│  • Caesar Salad x1              │
│       dressing: Ranch (+$0.50)  │
│ ── MAIN ─────────────────────── │
│  • Ribeye Steak x2              │
│       temp: Medium Rare         │
│       add: Mushrooms (+$2.00)   │
│  • Fries x3                     │
│ ── DESSERT ──────────────────── │
│  • Cheesecake x1                │
│       special: No berries        │
│ ── NOTES ─────────────────────── │
│  Birthday celebration            │
│  3 items          [Edit Items]   │
└──────────────────────────────────┘
```

---

## 6. Backward Compatibility

| Concern | Mitigation |
|---------|------------|
| Existing `kds_orders` have no line items | `get_kds_order_lines` returns empty vec; `items_summary` column is preserved and populated |
| Existing `sale_lines` have NULL `course` | Displayed as "OTHER" course group (sorted last) |
| Existing `sale_lines` have NULL `modifiers_json` | Treated as empty vec; no modifiers displayed |
| Old `items_summary` still works for chit printing | `complete_sale_to_kds` derives `items_summary` from the structured data after insertion |
| `update_kds_order_items` still works | Updates both the `kds_line_items` rows AND regenerates the flat summary |

---

## 7. Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| **Schema migration conflicts** on existing deployments with pending migrations | Low | Number migrations 105+106 as the next available; no reordering of existing |
| **POS cart changes are complex** (course UI, modifier selection UX) | Medium | Can ship Phase 1–3 (KDS display only) first. Phase 4 (POS input) is additive and optional. Pre-existing sales without course data display gracefully. |
| **Performance**: loading line items for every queue ticket | Low | KDS queue typically has <50 active tickets. Single JOIN per ticket is negligible. Could add eager loading in a single query if needed. |

> last audited 08-09-26 by buffy
> audit: Phase 1 Core Architecture & API Docs Audit

> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers, all file references valid

