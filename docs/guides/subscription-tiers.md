# Subscription Tiers — Final Decisions

<!-- Audit stamp: 2026-09-08 · DSH · status: ACCURATE after repair — this is the first audit this file ever had: it carried no stamp and no footer in 757 lines, while describing itself as the single source of truth for feature gates.

FIXED
- The † footnote denied that product-count and KDS quotas exist. Both are enforced,
  through QuotaDimension plus a per-mutation enforce_*_quota guard. Worse, the test
  file that pins the KDS numbers opens with "KDS screen quota
  (subscription-tiers.md §Numeric Limits)" — the code cites this table while the table
  denies the quota. The * and ** footnotes likewise still read "MUST be enforced before
  launch" for staff users and the sales-history cap; both are enforced (C1.1 and C1.2),
  the history cap behind signature verification.
- Added §3 "Grant precedence". Phase D1 (12443a1e, 1eb5b753, abda8574) let a signed
  payload override any row of the matrix per tenant, in both directions, and the page
  never mentioned it. Recorded honestly as not-yet-authorable: no build site sets the
  block, so the matrix stays the effective truth until D2 — the mechanism exists, the
  lever cannot be pulled yet.

LEFT ALONE
- §5 vertical go-to-market and §7 churn figures are commercial judgement, not code
  claims; auditing them would be an opinion, not a verification.

VERIFIED ACCURATE
- Five-tier lineup; the numeric-limit rows sampled against the
  *_matches_published_contract tests; canonical workspace types (retail-pos, resto-pos,
  kds, warehouse) and the store-pos / restaurant-pos compatibility aliases. -->

> **Status: FINAL** — Approved 2026-08-17. Single source of truth for tier
> pricing, quotas, and feature gates. Supersedes the tier/pricing sections of
> `docs/guides/BUSINESS_PLAN.md` §2, ADR #5, and the older pricing content until
> those are updated to match.
>
> **R36-14 ruling, 2026-09-07 (sole maintainer):** this file is the single
> authority; the duplicate `docs/records/` copy is removed. Entitlements
> ruled on the two disputed rows — full audit logging (`audit:view`):
> **Premium + Enterprise** (consistent with the Phase 2 audit-baseline
> item in `todo-global-saas-2.md`); white-label branding:
> **Enterprise-only** (the only deliberate edit on record, 2026-08-19 —
> rebranding stays the top-tier differentiator).
>
> **Amendment, 2026-09-08 (docs audit):** "single source of truth for …
> feature gates" is still right about *which tier gets what by default*, but
> it is no longer the whole rule. Phase D1 landed a signed-payload override that
> can flip any row per tenant, in both directions. See §3 "Grant precedence".
> The override has no authoring path yet, so nothing emitted today uses it —
> which is why this file remains authoritative in practice and is amended rather
> than demoted.
## 1. Lineup

**Five tiers: Free · Plus · Pro · Premium · Enterprise**

| Tier | Position |
| :--- | :--- |
| **Free** | Free forever — 1 workspace only (1 location, 1 terminal, 1 warehouse workspace, 3-month sales history) |
| **Plus** | Entry paid tier — hero feature: **Daily Sales Dashboard** (Laporan Harian) |
| **Pro** ⭐ **Most Popular** | Mid paid tier — best for growing single-to-multi-location businesses |
| **Premium** | Top paid tier — multi-location chains with loyalty & automation |
| **Enterprise** | Bespoke — no list price, contact sales |

## 2. Pricing

USD and IDR are **independent market prices**: global customers pay the USD
rate; Indonesian customers pay the IDR rate (lower, set for the local
market). See **Payment routing** below for how each is charged.

| Tier | USD/mo | USD/yr (**2 months free**) | IDR/mo | IDR/yr (**2 bulan gratis**) |
| :--- | :---: | :---: | :---: | :---: |
| **Free** | $0 | — | Rp 0 | — |
| **Plus** | $4.99 | $49.99 | Rp 49.000 | Rp 500.000 |
| **Pro** ⭐ | $9.99 | $99.99 | Rp 99.000 | Rp 1.000.000 |
| **Premium** | $39.99 | $399.99 | Rp 399.000 | Rp 3.999.000 |
| **Enterprise** | Bespoke | Bespoke | Kustom | Kustom |

Yearly = **2 months free** (pay 10 months, get 12). Always market as "2 months free" /
"2 bulan gratis" — not as a percentage discount. Annual plan must be the **default
selection** on the pricing page; users actively switch to monthly.
Six Paddle prices total (Plus/Pro/Premium × monthly/yearly).

### Enterprise Pricing Guidance

Enterprise pricing should be defined within these ranges to ensure consistency:
- **Small Enterprise (5-20 locations):** $100-200/mo or Rp 1.000.000-2.000.000/mo
- **Medium Enterprise (21-100 locations):** $200-400/mo or Rp 2.000.000-4.000.000/mo
- **Large Enterprise (100+ locations):** $400+/mo or Rp 4.000.000+/mo

Final pricing determined by: number of locations, terminals, users, support level, and custom integrations required.

### Payment routing

| Market | Provider | Currency | Payment methods |
| :--- | :--- | :--- | :--- |
| **Global** | Paddle (MoR) | USD | cards |
| **Indonesia** | **Midtrans** (Phase 2) | IDR, fixed Rp | QRIS, virtual accounts, e-wallets, cards |

- **Phase 1 (now):** Paddle for everyone. The IDR rates are honored via
  Paddle country price overrides for Indonesia — Paddle geolocates the
  buyer's IP at checkout and applies the override for the country selected.
  IDR isn't a supported currency, so the override is a USD amount ≈ the Rp
  figure (e.g. Premium yearly ≈ $125), which drifts with FX.
- **Phase 2 (next) — CRITICAL revenue unlock:** route Indonesian customers to a
  **Midtrans** checkout — fixed Rp prices and local payment methods (QRIS, virtual
  accounts, e-wallets) that cards alone can't reach; Paddle stays for global.
  Midtrans over Xendit because `oz-payment` already integrates Midtrans QRIS
  for in-store payments. **Without Phase 2, the Indonesian TAM is effectively limited
  to card-holding customers — a fraction of the 65M MSME market. This is not optional
  for Indonesian revenue growth.**
- **Costs of Phase 2:** OZ-POS becomes merchant of record for ID payments
  (Indonesian PPN, refunds, disputes); a second webhook + provisioning path
  in the license server; local-method subscriptions are less mature than
  card auto-renew.

## 3. Quota & feature matrix

> **This matrix is the default answer, not the final one.** A signed license payload
> can override any row of it per tenant. Read the precedence note below before treating
> a cell as a guarantee.

### Grant precedence (Phase D1, landed 08-09-26)

The signed payload may carry a `features` block — an explicit per-feature instruction
keyed by the client's canonical feature key:

```json
{ "plan": "plus", "features": { "supports_analytics": true, "warehouses": false } }
```

Semantics, in the order the code applies them:

| Payload says | Effect |
|---|---|
| key **absent** | the tier's own answer from the matrix above stands, untouched |
| `false` | withholds **even where the tier would allow** |
| `true` | grants **beyond tier** |

An explicit instruction about *this feature* outranks a statement about a workspace type
that merely implies something about it, so the check runs **before** the inferred
`allows_workspace_type` path. Both directions are pinned by tests in both clients
(`80a2168c`).

**Three ways to get this wrong, all silent:**

1. **Wrong key name.** Keys are `AvailabilityFeature::as_str()` — `supports_analytics`,
   `supports_qris`, `supports_loyalty`, `supports_daily_dashboard`, `supports_cloud_sync`,
   `sales_history_days`, `locations`, `staff_users`, `pos_instances`, `warehouses`.
   A shortened `analytics` is a lookup **miss**, not an error: the tier answer stands and
   nothing reports the typo.
2. **Malformed block.** If `features` is not an object of booleans (a string, say), every
   entry is dropped rather than partially trusting the block. Again silent.
3. **Assuming it is wired up end to end.** It is not. `1eb5b753` added the Go wire field
   and `abda8574` the Rust parse, and both clients honour the value — but **no build site
   sets it**: `license_keys` and `subscriptions` have no column to flow it from, so no
   payload the license server emits today carries the block (verified: zero `Features:`
   assignments in `apps/license-server`). It is `omitempty`, so a payload with no grants
   marshals byte-identically to a pre-Phase-D one. Authoring is explicitly owed to D2.
   **Until then the matrix above is the effective truth**, and this section describes the
   mechanism, not a lever you can pull today.

Code of record: `payload_feature_grant` in `crates/oz-core/src/subscription.rs`,
`server_grant_for` in each client's `src/commands/subscription.rs`, and the `Features`
field in `apps/license-server/main.go`.

### Quick Reference: Best For

> **Positioning statement:** OZ-POS is the QRIS-native POS with offline-first reliability,
> priced for the Indonesian market. Lead every ad, landing page, and sales conversation
> with this — not tier names.

| Tier | Best For | Hero Feature |
| :--- | :--- | :--- |
| **Free** | Warung / kios trying OZ-POS — limited to 3 months of sales history | Cash POS + receipt printing |
| **Plus** | Single-location shops ready to grow from manual to smart | **Daily Sales Dashboard** (Laporan Harian) + QRIS |
| **Pro** ⭐ | Cafes, toko, growing businesses ready for full analytics & KDS | Analytics + KDS + multi-terminal |
| **Premium** | Multi-location chains needing loyalty & automation | Loyalty program + 5 locations + 1h support |
| **Enterprise** | Large organizations needing white-label, custom hardware & dedicated support | Account manager + custom HAL drivers |

### Numeric Limits

| Feature | Free | Plus | Pro | Premium | Enterprise |
| :--- | :---: | :---: | :---: | :---: | :---: |
| Max locations | 1 | 1 | 2 | 5 | Unlimited |
| Max terminals (registers) / location | 1 | 2 | 5 | Unlimited | Unlimited |
| Max warehouse workspaces | 1 | 2 | 3 | Unlimited | Unlimited |
| Max KDS screens † | 0 | 0 | 2 | Unlimited | Unlimited |
| Max products/menu † | 200 | 500 | 1,000 | 10,000 | Unlimited |
| Max staff users * | 1 | 5 | 20 | 50 | Unlimited |
| Sales history (view & export) ** | 3 months | 1 year | 5 years | Unlimited | Unlimited |
| Audit log retention *** | — | 90 days | 180 days | 1 year | 3 years |

† **Enforced.** This footnote said the opposite until 08-09-26: it claimed the KDS
count was only a dashboard-side derivation `maxKDSForTier()` and that "no product-count
quota ships at all". Both were stale by a full phase. Phase 1 "Centralize quota
enforcement" landed, and the code that landed **cites this table** — the header comment
of `crates/oz-core/src/db/workspaces_tests.rs` reads "KDS screen quota
(subscription-tiers.md §Numeric Limits)" — while this page still denied the quota
existed. What is enforced now, all through `QuotaDimension`
(`crates/oz-core/src/downgrade.rs`) plus an `enforce_*_quota` guard on the mutation:

| Dimension | Cap fn | Enforced at |
|---|---|---|
| Locations | `max_locations()` | `enforce_location_quota` / `enforce_store_quota` (`db/locations.rs`) |
| POS registers | `max_pos_instances()` | `enforce_terminal_quota` (`db/terminals.rs`) |
| Warehouses | `max_warehouses()` | `enforce_warehouse_quota` (`db/inventory.rs`) |
| Staff | `max_staff_users()` | `enforce_staff_quota` (`db/staff.rs`) |
| Products | `max_products()` | `enforce_product_quota` (`db/products_crud.rs`) |
| KDS screens | `max_kds_screens()` | `enforce_instance_quota` (`db/workspaces_lifecycle.rs`) |

A breach returns `QuotaError::*Limit`, surfaced as `SubscriptionLimitExceeded`, which
the UI maps to an upgrade CTA; unlimited tiers are `None` and pass. Each published number
is pinned by a `*_matches_published_contract` test, so a row above that disagrees with
code fails `cargo test` — that is the mechanism that replaced "the pricing-page invariant
test pins it".

KDS specifically: Free/Plus `Some(0)`, Pro `Some(2)`, Premium/Enterprise `None`, and a
third Pro screen is rejected with its own actionable message rather than the register or
workspace-type one (`enforce_instance_quota_rejects_third_kds_on_pro`).

\* Max staff users — **enforced** (`enforce_staff_quota`, C1.1: "§9 pre-launch item 1:
prevents revenue leakage from unlimited Free/Plus team accounts"). Counts active staff
users with the owner excluded.

\*\* Sales history cap — **enforced** in both clients' history commands
(`apps/desktop-client/src/commands/history.rs`,
`apps/tablet-client/src/commands/history.rs`, C1.2): the tier window is read from the
tenant subscription **after signature verification** and applied by
`list_sales_with_history_cap(days)`, which returns the rows plus a `capped` flag instead
of erroring — the blurred-preview-with-CTA behaviour this note asked for. Free users see
only the last 3 months; after 3+ months the owner naturally wants to compare months, which
remains the primary Free → Plus trigger.

\*\*\* Audit retention — per the Phase 2 audit baseline
(`todo-global-saas-2.md`): paid tiers retain basic security events (failed
login, role changes, terminal registration, topology Apply, license changes,
destructive actions); Premium+ add full business audit logging, filtering,
export, and compliance views. Retention is measured from the event timestamp;
Enterprise supports a configurable contract override. Free has no
tenant-facing audit logs.

Retention applies to rows that are actually written, and the write path for sale
completion differs by settling door: as of the 2026-09-12 audit fix (`d7bd33ea8`) the
two wired settlement doors write the `sale.completed` row inside the sale transaction,
while the legacy `complete_sale` lane still writes it after the fact via the event
handler — a window in which a crash loses the row — so a sale settled through that lane
may contribute nothing for the retention window to retain (see
`docs/security/PCI-DSS_CHECKLIST.md` §10.2.1).

### Workspace Types

These are terminal workspace contexts, not hierarchy resources. The canonical
runtime types are `retail-pos`, `resto-pos`, `kds`, and `warehouse`; the old
`store-pos` and `restaurant-pos` keys remain compatibility aliases.

| Workspace type | Free | Plus | Pro | Premium | Enterprise |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `retail-pos` (legacy `store-pos`) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `resto-pos` (legacy `restaurant-pos`) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `warehouse` | ✗ | ✓ | ✓ | ✓ | ✓ |
| `kds` | ✗ | ✗ | ✓ | ✓ | ✓ |

### Payments

| Feature | Free | Plus | Pro | Premium | Enterprise |
| :--- | :---: | :---: | :---: | :---: | :---: |
| Cash & manual split | ✓ | ✓ | ✓ | ✓ | ✓ |
| QRIS (Midtrans dynamic) | ✗ | ✓ | ✓ | ✓ | ✓ |
| QRIS (static / at-counter) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Stripe cards | ✗ | ✗ | ✓ | ✓ | ✓ |
| Multi-currency | ✗ | ✗ | ✓ | ✓ | ✓ |

### Sync & Cloud

| Feature | Free | Plus | Pro | Premium | Enterprise |
| :--- | :---: | :---: | :---: | :---: | :---: |
| Offline-first SQLite engine | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cloud sync (PostgreSQL outbox) | ✗ | ✓ | ✓ | ✓ | ✓ |
| Multi-location dashboard | ✗ | ✗ | ✓ | ✓ | ✓ |
| CSV / data export | ✓ | ✓ | ✓ | ✓ | ✓ |

### Business Logic

| Feature | Free | Plus | Pro | Premium | Enterprise |
| :--- | :---: | :---: | :---: | :---: | :---: |
| Custom tax (PPN / PB1 / service) | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Daily Sales Dashboard** (Laporan Harian) — Plus hero; show blurred teaser to Free | ✗ | ✓ | ✓ | ✓ | ✓ |
| Reports & analytics (`analytics:view`) | ✗ | ✗ | ✓ | ✓ | ✓ |
| Memo (staff announcements on login/lock screen + recurring notification, `memo:write`) | ✗ | ✗ | ✓ | ✓ | ✓ |
| Scheduled report emails | ✗ | ✗ | ✗ | ✓ | ✓ |
| Full audit logging & review (`audit:view`) | ✗ | ✗ | ✗ | ✓ | ✓ |
| Product bundles | ✗ | ✓ | ✓ | ✓ | ✓ |
| Lua scripting | ✗ | ✗ | ✗ | ✓ | ✓ |
| **Loyalty tiers & points** — show locked animated teaser to Pro users | ✗ | ✗ | ✗ | ✓ | ✓ |
| Multi-warehouse routing | ✗ | ✗ | ✓ | ✓ | ✓ |
| Live order simulation debugger | ✗ | ✗ | ✓ | ✓ | ✓ |
| AI demand forecasting (roadmap) | ✗ | ✗ | ✗ | ✗ | ✓ |

### Hardware (HAL)

| Feature | Free | Plus | Pro | Premium | Enterprise |
| :--- | :---: | :---: | :---: | :---: | :---: |
| Scanner / printer / cash drawer | ✓ | ✓ | ✓ | ✓ | ✓ |
| Customer display | ✗ | ✗ | ✓ | ✓ | ✓ |
| KDS hardware | ✗ | ✗ | ✓ | ✓ | ✓ |
| Custom HAL drivers | ✗ | ✗ | ✗ | ✗ | ✓ |

### Support & Platform

| Feature | Free | Plus | Pro | Premium | Enterprise |
| :--- | :---: | :---: | :---: | :---: | :---: |
| Community forum | ✓ | ✓ | ✓ | ✓ | ✓ |
| Email / chat support | ✗ | ✓ | ✓ | ✓ | ✓ |
| Priority support | ✗ | ✗ | ✗ | ✓ | ✓ |
| Support response SLA | — | 24h | 8h | 1h (24/7) | account manager |
| Software updates | minor + major | minor + major | minor + major | minor + major | minor + major |
| White-label branding | ✗ | ✗ | ✗ | ✗ | ✓ |
| Offline grace period | 7 days | 14 days | 14 days | 30 days | 60 days (contract overrides available) |
| Enterprise services (dedicated hosting, ERP adaptors, account manager) | ✗ | ✗ | ✗ | ✗ | ✓ |

---

## 4. Trial & Conversion Strategy

### Free Tier Trial Flow
- Free tier provides permanent access to basic features (1 location, 1 terminal, 1 staff, **3-month sales history**)
- Trial offer is **segmented by signup vertical** — do NOT offer Pro trial universally:
  a Pro trial anchors users to features they won't pay for and suppresses Plus conversion.

| Signup segment | Trial offer | Rationale |
| :--- | :---: | :--- |
| General signup (no vertical detected) | **14-day Plus trial** | Exposes QRIS + Daily Sales Dashboard — the two hooks that drive Plus conversion |
| Restaurant / cafe landing page | **14-day Pro trial** | KDS is the key differentiator; Pro is the natural landing tier for this vertical |
| Referred by an Enterprise customer | **30-day Pro trial** | High-intent lead; longer trial cost is justified |

- After trial ends: show a clear downgrade screen listing exactly what the user loses,
  with a one-click upgrade path — not a generic error page.

### Trial-to-Paid Conversion — General / Plus Trial (14-day)
- **Day 3:** In-app highlight of Daily Sales Dashboard — show yesterday's summary prominently
- **Day 7:** Email — *"Here's what your first week looked like"* (personalized sales totals)
- **Day 10:** In-app QRIS stats — how many digital payments were processed during the trial
- **Day 14 (last day):** Final email — 3-month history limit warning + upgrade CTA
- **Day 14 (end of trial):** Downgrade screen with blurred history preview and
  *"Upgrade ke Plus untuk tetap melihat riwayat penjualan Anda"*

### Trial-to-Paid Conversion — Pro Trial / Restaurant & Cafe Vertical (14-day)
- **Day 3:** In-app KDS setup guide + first order simulation
- **Day 7:** Email — *"X orders went through your kitchen display this week"*
- **Day 14:** In-app analytics showing peak hours chart + Pro upgrade CTA
- **Day 14 (end of trial):** Downgrade screen — *"KDS akan dinonaktifkan. Upgrade ke Pro untuk melanjutkan."*

### Upgrade/Downgrade Policy
- **Upgrades:** Effective immediately; prorated billing for remainder of current cycle
- **Downgrades:** Effective at end of current billing cycle; no partial refunds
- **Downgrade grace period:** 14 days to export data before feature restrictions apply

### Trial Anti-Abuse Lock (Implemented)

A **hardware-fingerprint trial lock** prevents trial reset abuse by limiting one trial per physical device:

- **Implementation:** Server-side `trial_registrations` collection keyed by hardware fingerprint; claim endpoint (`POST /api/v1/license/trial`) and activation-time gate (`enforceTrialLock`).
- **Trust boundary:** Only **trial keys** are gated; paid keys are never locked.
- **Client:** `get_hardware_fingerprint()` computes `hw_` + SHA-256 of the same hardware anchor `machine_id` uses (Windows MachineGuid / motherboard UUID / `/etc/machine-id`).
- **Remaining gap:** Devices with no queryable hardware anchor (minimal containers) fall back to a random UUID stable only within a process; claims are permanent by design, so an expired trial never frees the device.

> For the full specification, see `docs/specs/hardware-fingerprint-trial-lock.md`.
> For deviations from the original spec and shipped implementation details, see **ADR #23 Deviation 3** in `docs/decisions/archived/2026-07-20-free-trial-lifecycle-and-license-activation-workflow.md`.

---

## 5. Vertical Go-to-Market Strategy

> Customers do not self-identify as "Pro tier users." They identify as cafe owners,
> minimarket operators, or salon managers. All GTM — landing pages, ads, onboarding
> flows — must lead with vertical language, not tier names.

### Vertical × Tier Map

| Vertical | Entry Hook | Natural Tier | Key Features to Highlight |
| :--- | :--- | :---: | :--- |
| **Warung / Kios** | Free → QRIS + daily summary | Plus | Daily Sales Dashboard, QRIS, cloud backup |
| **Kafe / Coffee shop** | KDS demo | Pro | KDS, analytics, multi-terminal |
| **Toko / Minimarket** | Inventory + multi-terminal | Pro | Multi-terminal, warehouse, stock visibility |
| **Salon / Laundry** | Staff & receipt management | Plus/Pro | Staff management, product bundles |
| **Restoran / Rumah Makan** | KDS + loyalty | Pro → Premium | KDS, loyalty points, scheduled reports |
| **Retail chain** | Multi-location ops | Premium | 5 locations, analytics, priority support |

### Vertical Landing Pages (Month 1-3 priority)
Create dedicated landing pages per vertical — higher-converting than a generic pricing page:
- `/untuk-kafe` — leads with KDS demo video → Pro trial CTA
- `/untuk-minimarket` — leads with inventory + multi-terminal → Pro trial CTA
- `/untuk-warung` — leads with QRIS + daily summary → Plus CTA
- `/untuk-restoran` — leads with loyalty + automation → Premium CTA

### Vertical-Specific Bundles (Month 3-6)
| Bundle | Target | Included Features | Discount |
|--------|--------|-------------------|----------|
| **Restaurant Starter** | Cafes, warung | POS + KDS + basic inventory | 10% off vs à la carte |
| **Retail Pro** | Toko, minimarket | POS + advanced inventory + loyalty | 10% off vs à la carte |
| **Service Business** | Salons, repair shops | POS + staff management + receipts | 10% off vs à la carte |

- Available as add-ons within existing tiers
- Custom bundles for Enterprise customers

---

## 6. In-App Upgrade Triggers

> Upgrade prompts must fire at the moment of felt need — not as generic banners.
> Each trigger has a specific condition and a specific message.

### Free → Plus Triggers
| Condition | Trigger message |
| :--- | :--- |
| User views sales history older than 3 months | Blurred preview: *"Lihat riwayat lebih dari 3 bulan — upgrade ke Plus"* |
| User attempts to set up QRIS | *"Aktifkan QRIS — terima pembayaran digital. Upgrade ke Plus"* |
| Second staff member tries to log in | *"Tambah anggota tim — upgrade ke Plus, hingga 5 staff"* |

### Plus → Pro Triggers
| Condition | Trigger message |
| :--- | :--- |
| User opens analytics/reports tab (locked) | Locked screen with sample chart: *"Lihat laporan lengkap — upgrade ke Pro"* |
| User attempts to add a second location | *"Buka lokasi ke-2 — upgrade ke Pro"* |
| Terminal count reaches 2 (Plus limit) | *"Butuh lebih banyak kasir? Pro mendukung hingga 5 terminal per lokasi"* |

### Pro → Premium Triggers
| Condition | Trigger message |
| :--- | :--- |
| Location count reaches 2 (approaching Pro limit) | *"Buka lokasi ke-3? Upgrade ke Premium — 5 locations"* |
| Staff count reaches 16+ (approaching 20 limit) | *"Tim Anda berkembang! Premium mendukung 50 staff"* |
| User views loyalty module (locked teaser) | Animated loyalty dashboard preview: *"Hadirkan program poin — upgrade ke Premium"* |

---

## 7. Churn Prevention

### Churn Risk by Tier

| Tier | Churn risk | Primary reason | Key intervention |
| :--- | :---: | :--- | :--- |
| **Plus** | 🔴 High | "Doesn't do enough" or post-Pro-trial letdown | Strong Daily Sales Dashboard onboarding, 3-month history trigger |
| **Pro** | 🟡 Medium | Staff/location limit reached without prompt | Proactive usage alerts at 80% of limits |
| **Premium** | 🟢 Low | Occasional downgrade to Pro | Enterprise self-serve pathway |
| **Enterprise** | 🟢 Very Low | Long contracts | Quarterly business reviews |

### Features to Implement
- ✅ **Pause subscription:** Allow 1-3 month pause (retain data, no billing) — C3.3
- ✅ **Win-back campaigns:** Automated emails at 7d + 30d post-expiry with 20%/30% discount offers
- ✅ **Usage monitoring:** Alert at 80% of limits (staff at 16/20, locations at cap, terminals at cap)
- ✅ **Feedback collection:** Exit survey modal with 6 churn-reason options

### Metrics to Track
- Monthly churn rate by tier
- Upgrade/downgrade ratios
- Trial-to-paid conversion rate (target: 25%+)
- Net Promoter Score (NPS) by tier

---

## 8. Where each definition lives (source map)

| File | Role | Tier source |
| :--- | :--- | :--- |
| `docs/guides/BUSINESS_PLAN.md` §2 | Market/pricing plan (IDR, annual) | 1-Time / Standard / Pro / Enterprise — **rewritten 2026-08-26 to the 5-tier lineup** (Free/Plus/Pro/Premium/Enterprise); no longer historical |
| `docs/decisions/archived/2026-07-10-subscription-tier-entitlement.md` (ADR #5) | Design intent | Free / Pro / Premium / Enterprise with numeric quotas — **supersession note added 2026-08-17** (mechanism still valid; quotas from §3) |
| `docs/decisions/archived/2026-07-20-free-trial-lifecycle-and-license-activation-workflow.md` (ADR #23) | Trial lifecycle + custom_data contracts | 90-day trial — **re-scope note + 3 deviation notes** (see cross-ref (see ADR Index)): **Dev 1:** segmented trials implemented 2026-08-18 (`trial_vertical` in `activate.go`, 14-day Plus general / 14-day Pro restaurant-cafe / 30-day Pro enterprise-referral). **Dev 2:** Paddle `custom_data` contract documented — `email` (register-first, webhook upserts tenant) + `bundle` (C3.2, cross-checked against price map) + `phone` (backfilled); signup vertical **not** carried. **Dev 3:** hardware-fingerprint trial lock shipped (`trial_registrations`, `POST /license/trial`, `enforceTrialLock`, client `get_hardware_fingerprint`). |
| `docs/decisions/2026-08-18-adr39-midtrans-subscription-payments.md` (ADR #39) | Midtrans webhook + custom-field contracts | Midtrans checkout routing + 8 deviation notes (see cross-ref (see ADR Index)): SHA-512 not HMAC, `custom_field1`–`custom_field4` contract (tier/email/period/bundle), period cross-check, amount-authoritative tier resolution, grace, dedup, notification fallthrough, key fast-path. |
| `website/src/content/docs/{en,id}/{licensing,welcome,installation,activation}.md` | User-facing docs | 90-day / four-tier copy — **updated to the 5-tier free-forever model 2026-08-17** |
| `crates/oz-core/src/subscription.rs` | Enforcement (client-side quotas) | enum Free/OneTime/Plus/Pro/Premium/Enterprise |
| `apps/license-server/paddle_webhook.go` → `tierQuotas(tier, bundle)` | Enforcement (license mint) | pro/premium/enterprise → 0/0/all types; free → 1/1/3 types; plus → 1/2, kds unlocked by `bundle_id == "restaurant_starter"` (**C3.2, implemented 2026-08-18** — activation honors it for trial keys; both webhooks issue paid bundles from the price map's optional `:bundle_id` segment, cross-checked against the checkout custom field) |
| `website/src/components/paddle.ts` → `openPaddleCheckout()` | Checkout custom_data embedder | Embeds `custom_data.email` (required) + `custom_data.bundle` (optional C3.2) + `custom_data.phone` (may ride along); vertical **not** carried (see ADR #23 Dev 2) |
| `website/src/components/CheckoutButton.tsx` | Pricing-page checkout | Same contract as `paddle.ts`; routes id-locale to Midtrans Snap (`custom_field1`–`custom_field4`) per ADR #39 |
| `website/src/components/AccountView.tsx` | Dashboard subscribe + bundle upgrade | Same contract; bundle upgrade card passes `bundle=restaurant_starter` via `openPaddleCheckout` |
| `apps/license-server/pb_schema.json` | Schema select values | free, plus, pro, premium, enterprise |
| `apps/license-server/renew.go` | Offline renewal expiry | free +100y, plus/pro/premium +1y, enterprise +3y |
| `website/src/content/pricing/{en,id}.ts` | Live pricing pages | **DONE (2026-08-17)** — free/plus/pro/premium/enterprise, new USD & IDR prices, annual default + "2 months free", ⭐ Pro badge, full §3 matrix |
| `apps/license-server` `PADDLE_PRICE_TIERS` (env) | Live billing map | **DONE (2026-08-31)** — all six sandbox prices catalogued (Plus/Pro/Premium × monthly/yearly, see `docs/operations/go-live-checklist.md`); bundle + Pro A/B variant still placeholder |
| `apps/license-server` `MIDTRANS_PRICE_TIERS` (env) | Midtrans billing map | Fixed IDR amounts mapped to tier + period + optional bundle; cross-checked against webhook `gross_amount` and `custom_field1`–`custom_field4` (ADR #39 Dev 2–4) |

---

## 9. Implementation Priorities

### Pre-Launch (Critical — before any paid marketing spend)
1. ✅ **Enforce staff user limits** — `enforce_staff_quota()` in staff.rs, wired in desktop + tablet clients
2. ✅ **Enforce 3-month sales history cap on Free** — `list_sales_with_history_cap()` in `db/sales_crud.rs`
3. ✅ **Set annual plan as default on pricing page** — PricingGrid.tsx defaults to annual
4. ✅ **Add ⭐ Most Popular badge to Pro** on pricing page — `mostPopular` in i18n
5. ✅ **Reframe annual discount as "2 bulan gratis" / "2 months free"** — all docs and pricing pages
6. ✅ **Build Daily Sales Dashboard as the hero feature of Plus** — `DailyTotalWidget.tsx` with Free-tier lock (blurred teaser + upgrade CTA)
7. ✅ **Define Enterprise pricing guidance** — ranges defined in §2
8. ✅ **Enforce location-count quota on creation** — `enforce_location_quota()` blocks Free/Plus at 1, Pro at 2
9. ✅ **Enforce warehouse-count quota on creation** — `enforce_warehouse_quota()` blocks Free at 1, Plus at 2, Pro at 3

### Short-Term (Month 1-3)
10. ✅ **Implement segmented trial strategy** — 14-day Plus trial for general; 14-day Pro for restaurant/cafe; 30-day Pro for enterprise-referral
11. ✅ **Build vertical landing pages** — `/untuk-kafe`, `/untuk-warung`, `/untuk-minimarket`, `/untuk-restoran` — `VerticalLanding.astro` component with i18n, segmented trial CTAs, bundle paths
12. ✅ **Implement in-app upgrade triggers** — All 9 triggers wired: TierLockedFeature (analytics, loyalty, daily dashboard, QRIS), quota error banners (staff, location, terminal), proactive alerts at 80% (staff approaching 16/20, location at 2/2)
13. ✅ **Implement upgrade/downgrade proration** — `paddleUpdate()` in paddle_webhook.go handles tier transitions; Paddle handles proration billing; grace period via `offline_grace_days`

### Medium-Term (Month 3-6)
14. ✅ **Phase 2: Midtrans QRIS subscriptions** — `midtrans_webhook.go` + Snap checkout implemented; ID payment routing with custom fields (ADR #39)
15. ✅ **Build trial-to-paid email flows** — `trial_emails.go` scheduler with Brevo SMTP; day 7 + day 14 milestones for Plus and Pro trials; bilingual EN/ID templates; idempotent via `trial_email_log` collection
16. ✅ **Create vertical-specific bundles** — `restaurant_starter` bundle implemented (C3.2); unlocks KDS workspace type for Plus
17. ✅ **Implement pause subscription feature** — pause/resume endpoints + `paused_at`/`pause_until` fields (C3.3)

### Long-Term (Month 6-12)
18. ✅ **A/B test Pro at $7.99 vs $9.99** — Paddle-native A/B testing via `PADDLE_PRICE_TIERS` config; create two Pro prices and let Paddle split traffic
19. ✅ **Enterprise self-serve trial / Premium store-limit bridge** — `POST /api/v1/license/enterprise-trial` validates approval codes from PocketBase collection, mints 30-day Enterprise trial license key; admin endpoints (`/api/v1/admin/enterprise-codes`) for code generation/listing; `/enterprise-trial` Astro page with EN/ID i18n; `enterprise_self_serve` vertical in `trialSegmentation`
20. ✅ **Launch add-on marketplace** — addon catalog (4 addons: advanced_analytics, priority_support, extra_storage, custom_hal) with Paddle price IDs; `TenantSubscription::addons()` + `has_addon()` in Rust; `AddonsMarketplace` component with card grid; admin API (`/api/v1/admin/license-addons`) for managing addon purchases on license keys; addons field wired through `SubscriptionCapabilitiesDto` to front-end
21. ✅ **Build churn prevention automation** — win-back emails (7d + 30d post-expiry), exit survey modal, usage monitoring alerts at 80% limits

---

## 10. Success Metrics

### Revenue Metrics
- **Monthly Recurring Revenue (MRR)** growth rate
- **Average Revenue Per User (ARPU)** by tier
- **Customer Lifetime Value (LTV)** by tier
- **LTV:CAC ratio** (target: 3:1 or higher)

### Conversion Metrics
- **Free → Plus conversion rate** (target: 15%+)
- **Plus → Pro conversion rate** (target: 10%+)
- **Pro → Premium conversion rate** (target: 5%+)
- **Trial → Paid conversion rate** (target: 25%+)

### Retention Metrics
- **Monthly churn rate** (target: <5% for paid tiers)
- **Net Revenue Retention** (target: >100%)
- **Feature adoption rate** by tier
- **Support ticket volume** by tier

---

## 11. Economics Review & Financial Analysis

### Unit Economics

#### Customer Acquisition Cost (CAC) Targets
| Tier | Target CAC | CAC Payback Period |
| :--- | :---: | :---: |
| Plus | $20-30 | 4-6 months |
| Pro | $40-60 | 4-6 months |
| Premium | $80-120 | 4-6 months |
| Enterprise | $200-500 | 2-4 months |

**CAC:LTV Ratios:**
- Plus: 1:5 (LTV $150+)
- Pro: 1:6 (LTV $300+)
- Premium: 1:7 (LTV $700+)
- Enterprise: 1:10 (LTV $2,000+)

#### Average Revenue Per User (ARPU) Projections
| Tier | Monthly ARPU (USD) | Annual ARPU (USD) |
| :--- | :---: | :---: |
| Plus | $4.50 (90% monthly) | $54.00 |
| Pro | $9.00 (90% monthly) | $108.00 |
| Premium | $36.00 (90% monthly) | $432.00 |
| Enterprise | $250.00 | $3,000.00 |

**Blended ARPU Target:** $12-15/month (across all paid tiers)

#### Customer Lifetime Value (LTV) by Tier
| Tier | Avg. Lifespan | LTV (USD) |
| :--- | :---: | :---: |
| Plus | 12 months | $54 |
| Pro | 18 months | $162 |
| Premium | 24 months | $864 |
| Enterprise | 36 months | $9,000 |

**Assumptions:**
- Monthly churn rates: Plus 8%, Pro 5%, Premium 4%, Enterprise 2.8%
- No price increases assumed
- No expansion revenue (upsells) included

### Revenue Projections (Year 1-3)

#### Scenario: Conservative Growth
| Year | Total Customers | Paid Customers | MRR (USD) | ARR (USD) |
| :--- | :---: | :---: | :---: | :---: |
| Year 1 | 10,000 | 1,500 | $18,000 | $216,000 |
| Year 2 | 25,000 | 4,000 | $48,000 | $576,000 |
| Year 3 | 50,000 | 8,000 | $96,000 | $1,152,000 |

#### Scenario: Moderate Growth
| Year | Total Customers | Paid Customers | MRR (USD) | ARR (USD) |
| :--- | :---: | :---: | :---: | :---: |
| Year 1 | 15,000 | 2,500 | $30,000 | $360,000 |
| Year 2 | 40,000 | 7,000 | $84,000 | $1,008,000 |
| Year 3 | 80,000 | 15,000 | $180,000 | $2,160,000 |

#### Scenario: Aggressive Growth
| Year | Total Customers | Paid Customers | MRR (USD) | ARR (USD) |
| :--- | :---: | :---: | :---: | :---: |
| Year 1 | 20,000 | 4,000 | $48,000 | $576,000 |
| Year 2 | 60,000 | 12,000 | $144,000 | $1,728,000 |
| Year 3 | 120,000 | 25,000 | $300,000 | $3,600,000 |

**Key Assumptions:**
- Free → Paid conversion: 15% (Year 1), 18% (Year 2), 20% (Year 3)
- Monthly churn improves: 8% → 6% → 5% (paid tiers)
- 10% of customers upgrade tiers annually
- Enterprise represents 5% of paid customers but 25% of revenue

### Cost Structure Analysis

#### Fixed Costs (Monthly)
| Category | Cost (USD) | Notes |
| :--- | :---: | :--- |
| Cloud Infrastructure | $2,000-5,000 | Scales with customers |
| Development Team | $15,000-25,000 | 3-5 engineers |
| Support Team | $3,000-6,000 | 1-2 support staff |
| Office/Admin | $1,000-2,000 | Minimal remote setup |
| **Total Fixed** | **$21,000-38,000** | |

#### Variable Costs (Per Customer)
| Category | Cost (USD) | Notes |
| :--- | :---: | :--- |
| Payment Processing | 3-5% of revenue | Paddle/Midtrans fees |
| Cloud Storage | $0.10-0.50/mo | PostgreSQL + backups |
| Support | $0.50-2.00/mo | Email/chat tickets |
| **Total Variable** | **4-8% of revenue** | |

#### Break-Even Analysis
**Fixed Costs:** $30,000/month (midpoint)
**Variable Costs:** 6% of revenue
**Required Revenue:** $31,915/month (to cover fixed + variable)
**Required Paid Customers:** ~2,100 (at $15 ARPU)

**Break-Even Timeline:**
- Conservative: Month 18-24
- Moderate: Month 12-15
- Aggressive: Month 8-10

### Market Sizing (Indonesia)

#### Total Addressable Market (TAM)
- **Indonesian MSMEs:** ~65 million businesses
- **Retail/Hospitality Focus:** ~15 million businesses
- **POS System Adoption:** ~30% (4.5 million businesses)
- **Digital POS Adoption:** ~10% (1.5 million businesses)

#### Serviceable Addressable Market (SAM)
- **Target Segment:** Digital-ready SMEs in urban areas
- **Estimate:** 500,000 - 1,000,000 businesses
- **Annual Spending:** $100-500/year on POS systems

#### Serviceable Obtainable Market (SOM)
- **Year 1 Target:** 0.1-0.3% of SAM
- **Estimate:** 500 - 3,000 paying customers
- **Revenue Potential:** $50,000 - $300,000 ARR

### Financial Risks & Mitigations

#### High-Risk Factors
| Risk | Impact | Probability | Mitigation |
| :--- | :---: | :---: | :--- |
| Low conversion from Free to Paid | High | Medium | Optimize trial flow, add daily sales summary |
| High churn in Plus tier | High | High | Improve onboarding, add value features |
| Enterprise sales cycle too long | Medium | Medium | Create self-serve Enterprise trial |
| Currency fluctuation (IDR/USD) | Medium | High | Quarterly price reviews, hedging |

#### Revenue Leakage Risks
| Risk | Impact | Mitigation |
| :--- | :---: | :--- |
| Staff user limits not enforced | High | Implement before launch (CRITICAL) |
| Offline grace period abuse | Medium | Reduce Free tier to 7 days |
| Downgrade without data export | Medium | 14-day grace period implemented |

### Optimization Opportunities

#### Pricing Optimization
1. **A/B Test Pro Tier:** Test $7.99 vs $9.99 for Pro tier
   - Expected impact: +10-15% Pro adoption
   - Risk: -5-10% revenue per Pro customer

2. **Add Usage-Based Component:** 1% fee on QRIS transactions for Plus/Pro
   - Expected impact: +$2-5 ARPU for active users
   - Risk: Increased complexity, customer resistance

3. **Bundle Discounts:** 10-15% for vertical-specific bundles
   - Expected impact: +20% bundle adoption
   - Risk: Cannibalization of individual tier sales

#### Conversion Optimization
1. **Free Tier Expansion:** Add 2 terminals and 3 staff for 30 days
   - Expected impact: +25% trial activation
   - Risk: Increased support costs

2. **Upgrade Prompts:** In-app prompts at usage milestones
   - Expected impact: +15% upgrade rate
   - Risk: User annoyance if overdone

3. **Success Stories:** Case studies from similar businesses
   - Expected impact: +10% conversion
   - Risk: Content creation cost

#### Retention Optimization
1. **Pause Subscription:** 1-3 month pause option
   - Expected impact: -20% churn
   - Risk: Delayed revenue recognition

2. **Win-Back Campaigns:** Automated emails with offers
   - Expected impact: +5% win-back rate
   - Risk: Discount fatigue

3. **Usage Monitoring:** Alerts before tier limits
   - Expected impact: -15% involuntary churn
   - Risk: Development cost

### Key Financial Metrics to Track

#### Weekly Metrics
- Trial activation rate
- Free → Paid conversion (daily)
- Support ticket volume
- Payment failure rate

#### Monthly Metrics
- MRR growth rate
- ARPU by tier
- Churn rate by tier
- CAC by acquisition channel
- LTV:CAC ratio

#### Quarterly Metrics
- Net Revenue Retention
- Expansion revenue %
- Customer satisfaction (NPS)
- Feature adoption rates

### Financial Milestones

#### Year 1 Targets
- **Q1:** 500 paying customers, $6,000 MRR
- **Q2:** 1,000 paying customers, $12,000 MRR
- **Q3:** 1,500 paying customers, $18,000 MRR
- **Q4:** 2,000 paying customers, $24,000 MRR

#### Year 2 Targets
- **Q1:** 3,000 paying customers, $36,000 MRR
- **Q2:** 4,500 paying customers, $54,000 MRR
- **Q3:** 6,000 paying customers, $72,000 MRR
- **Q4:** 8,000 paying customers, $96,000 MRR

#### Year 3 Targets
- **Q1:** 10,000 paying customers, $120,000 MRR
- **Q2:** 13,000 paying customers, $156,000 MRR
- **Q3:** 16,000 paying customers, $192,000 MRR
- **Q4:** 20,000 paying customers, $240,000 MRR

### Investment Requirements

#### Seed Round (Pre-Launch)
- **Amount:** $100,000 - $200,000
- **Use:** Development completion, initial marketing
- **Timeline:** 6-12 months runway

#### Series A (Year 1-2)
- **Amount:** $500,000 - $1,000,000
- **Use:** Team expansion, market expansion, sales
- **Timeline:** 18-24 months runway

#### Key Metrics for Fundraising
- **MRR Growth:** 15-20% month-over-month
- **CAC Payback:** <6 months
- **LTV:CAC:** >3:1
- **Churn Rate:** <5% monthly (paid tiers)

### Economic Recommendations Summary

#### Immediate Actions (Pre-Launch)
1. **Enforce staff user limits** — prevent revenue leakage
2. **Implement daily sales summary in Plus** — improve conversion
3. **Define Enterprise pricing ranges** — enable sales

#### Short-Term Optimizations (0-3 months)
1. **A/B test Pro tier pricing** — optimize revenue
2. **Launch segmented trial strategy** — 14-day Plus (general), 14-day Pro (restaurant/cafe), 30-day Pro (enterprise-referral) — boost conversion
3. **Implement upgrade prompts** — increase adoption

#### Medium-Term Strategies (3-6 months)
1. **Add usage-based pricing component** — diversify revenue
2. **Create vertical bundles** — expand market
3. **Implement churn prevention features** — improve retention

#### Long-Term Growth (6-12 months)
1. **Launch add-on marketplace** — increase ARPU
2. **Expand to adjacent markets** — geographic growth
3. **Build enterprise self-serve** — reduce sales cycle

---

## Appendix: Financial Formulas

### Unit Economics Calculations

#### Customer Lifetime Value (LTV)
```
LTV = ARPU × (1 / Churn Rate)
Example (Plus): $4.50 × (1 / 0.08) = $56.25
```

#### Customer Acquisition Cost (CAC)
```
CAC = Total Sales & Marketing Spend / New Customers Acquired
Target: LTV / CAC ≥ 3:1
```

#### Payback Period
```
Payback Period = CAC / ARPU
Example (Plus): $25 / $4.50 = 5.6 months
```

#### Break-Even Point
```
Break-Even Customers = Fixed Costs / (ARPU × (1 - Variable Cost %))
Example: $30,000 / ($15 × 0.94) = 2,128 customers
```

#### Monthly Recurring Revenue (MRR)
```
MRR = Σ (Monthly Revenue from All Customers)
ARR = MRR × 12
```

#### Net Revenue Retention (NRR)
```
NRR = (Starting MRR + Expansion - Contraction - Churn) / Starting MRR
Target: >100% (growth from existing customers)
```

### Sensitivity Analysis

#### Impact of Churn Rate Changes on LTV
| Churn Rate | Plus LTV | Pro LTV | Premium LTV |
| :---: | :---: | :---: | :---: |
| 10% | $45 | $90 | $360 |
| 8% | $56 | $112 | $450 |
| 6% | $75 | $150 | $600 |
| 4% | $112 | $225 | $900 |
| 2% | $225 | $450 | $1,800 |

#### Impact of ARPU Changes on Break-Even
| ARPU | Customers Needed | Time to Break-Even |
| :---: | :---: | :---: |
| $10 | 3,192 | 24 months |
| $12 | 2,660 | 20 months |
| $15 | 2,128 | 16 months |
| $18 | 1,773 | 13 months |
| $20 | 1,596 | 12 months |

### Financial Model Assumptions

#### Growth Assumptions
- **Market Growth:** 15-20% annually (Indonesian POS market)
- **Competitive Landscape:** 5-10 major competitors
- **Technology Adoption:** Accelerating post-pandemic
- **Regulatory Environment:** Supportive for digital payments

#### Cost Assumptions
- **Cloud Costs:** Decreasing 10-15% annually
- **Payment Processing:** Stable at 3-5%
- **Labor Costs:** Increasing 5-8% annually
- **Marketing Costs:** Stable as percentage of revenue

#### Revenue Assumptions
- **Pricing Power:** Moderate (price-sensitive market)
- **Expansion Revenue:** 10-15% annually from existing customers
- **Enterprise Mix:** 5% of customers, 25% of revenue
- **Geographic Mix:** 70% Indonesia, 30% global

---

> last audited 08-09-26 by docs-auditor
