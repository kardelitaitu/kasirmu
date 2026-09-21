---
num: 59
area: topology
title: "ADR #59: Regional Topology and Modular Delivery — market scope on the Legal Entity, residency on the Organization, and the built-vs-module seam"
status: Proposed (2026-10-04) — nothing implemented
---

# ADR #59: Regional Topology and Modular Delivery

**Status:** Proposed (2026-10-04). Nothing below is implemented. §1 measures what exists, §2 decides,
§3 records consequences, §4 the non-goals, §5 the questions that need a human answer.
**Date:** 2026-10-04
**Recorded against:** branch `0.0.39` @ `2c30e735c`
**Related:** ADR #1 (module system — the kernel this builds on), ADR #41 §2.1 (device lifecycle, the
"Enrolled" state), ADR #55 (one server origin — the single-origin assumption this record qualifies),
ADR #56 (first-run provisioning — where `home_region` must be written),
`docs/security/data-residency-and-retention.md` (the existing residency authority: §1 "Residency"
states the deployment is single-region, that residency is a property of the deployment rather than a
per-tenant choice, and that §K's ruling is "decided, not implemented" — "when that lands, this
section is the contract it must satisfy"; §2.2 below reconciles with it rather than restating it).
**Tags:** topology, multi-region, data-residency, tenancy, modularity, fiscalization, global

> Cite this record by filename, not by number (`docs/decisions/README.md`: numbering has collided
> before — #43 — and filename-plus-number is the only safe citation form).

## 1. Context

### 1.1 The requirement

Going global requires two things that are easy to conflate and must not be:

1. **A user chooses their region**, and the app behaves according to it (currency, tax, timezone,
   receipt format, local payment methods).
2. **A user is served by a specific server**, chosen by that region, so data does not cross a
   border it must not cross.

These are different problems with different failure modes. Getting the first wrong shows the wrong
currency. Getting the second wrong is a **regulatory violation**, and it cannot be corrected by a
config change once data has landed in the wrong jurisdiction.

### 1.2 What already exists: regional configuration is real and well-designed

`crates/kasirmu-core/src/regional.rs` implements a **scope chain** resolved narrowest-first:

```
Location → Legal Entity → Organization → built-in default
(first non-blank wins; "" means "not set at this scope")
```

| Property | Evidence |
|---|---|
| Four-level scope chain, narrowest-first | `regional.rs:16-23` |
| Blank-as-unset, not a NULL sentinel | `regional.rs:18-19` — reuses `legal_entities.legal_name` convention |
| Per-axis provenance, not one scope per config | `regional.rs:25-28` — a location may override currency while inheriting locale |
| Tax regime is **derived**, never stored | `regional.rs:9-12` — composes the market anchor with the landed tax row so they cannot drift |
| `ConfigScope` enum: `Location` / `LegalEntity` / `Organization` / `BuiltIn` | `regional.rs:153-164` |
| `RegionalValue { value, scope }` — value carries who answered | `regional.rs:179-185` |
| Built-in defaults equal the pre-regional column defaults | `regional.rs:20-23` — an unconfigured tenant behaves exactly as today |
| **Four** axes shipped: locale, timezone, currency, **country** (the market anchor) | `regional.rs:6-7` (the doc still says "three") + `regional.rs:111,131` (validated), `:216` (`RegionalLayer.country_code`), `:277,315,319` (`RegionalConfig.country_code` resolved from the legal-entity layer read at `db/regional.rs:87`) |
| The country axis is the **MARKET** anchor, not residency: it is the flag the entity trades under, and `tax_regime` composes it with the winning tax row | `regional.rs:213-215` (only the legal-entity layer populates it today), `:272-277` (optional by design — "there is no defensible built-in market"), `:351-354,386-389` (`tax_regime` carries it — "the market the location trades under") |

The country axis is also writable, not read-only: `SetRegionalConfig.country_code`
(`kasirmu-bridge/src/regional.rs:46-49`) carries the ISO-3166 alpha-2 anchor through the same
`settings:edit` gate as the other three.

**A note on the axis count:** the module doc's "three axes" line (`regional.rs:6-7`) is stale — it
was written before slice 1 added `country_code` to the entity layer
(`20260919_regional_configuration.sql:42-43`), and only the legal entity populates it
(`db/regional.rs:104-115` passes `""` at the location layer). The resolver is the authority here,
not that line: four axes resolve.

The module doc names the next axes explicitly (`regional.rs:7-9`): *"Fiscalization, numbering,
receipt format and local payment settings join the same chain in later slices."* Three of those
four have since landed as **data** rather than as modules (§2.3), which is the fact §3.2 and §2.4
have to reckon with.


**This is the right foundation.** The record does not replace it; it extends it to a dimension the
scope chain does not currently reach.

### 1.3 What already exists: multi-tenant isolation is enforced at the database

Tenant separation is not merely conventional — it is enforced by Postgres row-level security:

- Every sync read is tenant-scoped in SQL (`WHERE tenant_id = ?1`) — the rule the audit stamp at
  `apps/cloud-server/src/sync_store.rs:4` records and the code below is the authority for.
- The RLS policy keys on the `oz.tenant_id` GUC, set **locally** per transaction
  (`set_config('oz.tenant_id', $1, true)` — `sync_store.rs:257`, `:357`).
- Every index on `sync_conflicts` is tenant-scoped, deliberately
  (`20261002_sync_conflicts.sql:24-26`: *"tenant A must never see tenant B's conflicts, so no
  index here is tenant-blind"*).
- `sync_conflicts` joins `RLS_TABLES` in `scripts/generate-pg-migration.py` (`:32-34`).

**Consequence that matters here:** there is already exactly one place where "which tenant is this"
is decided — the authenticated token's claims, stamped into the GUC. A region is the same kind of
fact and belongs in the same place.

### 1.4 What does NOT exist: region as an identity attribute

`tenant_id` is the tenant key everywhere, and it carries no region:

- `tenant_id` defaults to the literal `'default'` across migrations
  (e.g. `20260814_tenant_uniqueness.sql:4-7`), which is how a single-tenant install is modelled today.
- `legal_entities` is scoped by `tenant_id` alone (`20260908_legal_entities.sql:13,22,26`).
- `locations` carries `tenant_id` but no region (added by `20260907_add_location_tenant_id.sql:14`).
- Nothing anywhere expresses **which server a tenant belongs to**.

**The gap:** with one server, `tenant_id` is a globally unique key. With regional servers, a
`tenant_id` is only unique *within its region* — so identity becomes `(home_region, tenant_id)`.
That composition is absent, and it must be decided at provisioning because changing it later means
migrating live customer data across a border.

### 1.5 What already exists: a module kernel — and how far it has been used

`platform/kernel/` is real and built:

| Capability | Evidence |
|---|---|
| `register` / `load_all` / `start_all` / `stop_all` | ADR #1 §"The Kernel struct lives in `platform/kernel/`" |
| Topological sort by declared dependencies | `platform/kernel/src/kernel/dependency.rs` |
| `manifest.json` validated against a schema | `platform/kernel/src/manifest.rs`, `docs/specs/module-manifest.schema.json` |
| Dependencies declared **twice** (manifest + trait) with a test pinning equality | `modules/README.md:29-48` |
| Lifecycle hooks with default no-op impls | ADR #1 §"Default implementations return `Ok(())`" |

**The honest state of the verticals — the opposite of the first draft of this section.** An earlier
revision of this record (and, going by it, ADR #1's reader) claimed `modules/` held *only* a README
and that the verticals were never extracted. That is false, and the correction matters more than
the original claim did: there are **14 module crates** under `modules/` — `inventory, currency,
sales, staff, loyalty, tax, terminal, crm, settings, reporting, purchasing, promotions, giftcards,
kitchen` — each with a `Cargo.toml`, a `manifest.json` and a `src/`.

All fourteen are registered, and the registration is pinned by a test rather than by convention:

- `k.register(...)` appears **fourteen times**, once per module
  (`platform/startup/src/lib.rs:94-115`), with the four stub verticals grouped and labelled as such
  at `:107-115`.
- The parity test `every_module_manifest_is_registered` asserts the registered set equals the
  `modules/*/manifest.json` set (`platform/startup/src/startup_tests.rs`, described at
  `modules/README.md:50-57`), so a crate that stopped being registered fails the build rather than
  silently losing its `on_load`.

**Ten of the fourteen are substantive**, not stubs — the kernel is load-bearing for a real slice of
the domain. **Four are lifecycle-only stubs**: purchasing, promotions, gift cards and kitchen, each
of which owns its manifest, id and dependency edges while its hooks only log
(`platform/startup/src/lib.rs:107-111`, and the audit stamp at `modules/README.md:3` records all
four as *"confirmed lifecycle-only"* — the PROMO-3 engine lives in `kasirmu-core`, not in
`modules/promotions`).

**So the drift is narrow, and it is a stub-thinness problem rather than an extraction problem.**
ADR #1's *"each module owns its entire vertical slice"* is substantially **true** of the ten
substantive modules and **false** of exactly four. That is a materially different — and much
smaller — defect than the one the first draft reported, and §3.4 decides which repair it needs.

### 1.6 The two axes that get conflated

"Modular" and "regional" are orthogonal, and treating a region as a module is the common mistake:

| Axis | Examples | Nature | Needs lifecycle? |
|---|---|---|---|
| **Vertical module** | inventory, sales, staff, loyalty, tax, terminal, crm, settings, reporting, currency — plus the four lifecycle-only stubs (purchasing, promotions, gift cards, kitchen) | *What the business does* | Yes — load/start/stop |
| **Market profile** | ID, SG, EU, US, BR | *Where it **trades**, under what rules* — resolved by modules, held on the Legal Entity | **No — it is data** |
| **Data residency** | "which server holds this tenant's rows" | *Where the data **is*** — an Organization-level deployment fact | **No** — it is a deployment attribute |
| **Fiscalization** | Italy certified signing, India GST, Brazil NF-e, Saudi ZATCA | *Government-mandated **certification and signing*** | **Yes** — distinct code, optional |

A market profile is configuration consumed by modules; making it a module would give it a
lifecycle it has no use for. The same is true of residency, which is why §2.2 keeps them in two
different places rather than one. Fiscalization *certification* is genuinely module-shaped:
distinct code, distinct dependencies, enabled per market.

**The distinction the first draft collapsed:** the market is *how you trade* and lives on the
Legal Entity; residency is *where the bytes are* and is a property of the deployment and the
Organization. `20260919_regional_configuration.sql:13-19` states the rule verbatim —
`legal_entities.country_code` "is the MARKET anchor (ISO-3166 alpha-2) ... It is deliberately NOT
named `region` and it is NOT data residency: residency is where the data is STORED (an
organization-level deployment decision ...), market is how it is TRADED. The two must not collapse
into one column."

## 2. Decision

### 2.1 Home region is tenant identity, resolved at provisioning

**Terminology first, because it is the thing this record got wrong once already.** This section is
about **RESIDENCY** — where a tenant's data is physically stored — and residency is an
**Organization-level deployment decision**, not a market and not a legal-entity attribute.
`docs/security/data-residency-and-retention.md:35-42` (audited VERIFIED-TRUE) is the existing
authority and says so: *"region is a property of the deployment (the Northflank service and its
Postgres addon), not a per-tenant choice"*, and §K's ruling is *"decided, not implemented"* — *"when
that lands, this section is the contract it must satisfy."* This record is that contract's first
customer, and it must not contradict it.

**TO BUILD.** Tenant identity becomes the pair `(home_region, tenant_id)`, where `home_region`
names the **deployment** that holds the tenant's data. Concretely:

- `provisioning.home_region` (ADR #56 §2.1) is written at provisioning from the deployment the
  merchant is placed in. It is **not self-service** thereafter — only an operator changes it, per
  §2.1a. (An earlier revision called it "immutable"; that was too strong and is corrected there.)
  Note the deliberate consequence: because residency is an Organization-level fact, the merchant
  *names a market* at provisioning and the *deployment* is derived from it — a merchant does not
  pick a server, they pick where they trade and we place them.
- The region is part of the credential's claims, exactly as `tenant_id` is today — so the RLS GUC
  and every tenant-scoped query continue to work unchanged, and a token minted in one region
  cannot address another.
- A server in region R rejects a token whose `home_region != R`. This is the enforcement point, and
  it is a **single check** at the same boundary the tenant check already lives on. The check reads
  the token claim and the server's own deployment identity — never the client's local copy (§Q5),
  and never a legal-entity column (§2.2).

**Why provisioning and not later:** §1.4. After data exists, changing `home_region` is a
cross-border migration of live customer records — a legal operation, not an engineering one. The
cheap moment to decide is the moment the merchant tells us where they trade.

**Why this is the smallest correct change:** it reuses the existing tenancy machinery rather than
inventing a parallel one. The `oz.tenant_id` GUC becomes `oz.tenant_id` + `oz.home_region`, set from
the same claims, in the same transaction, by the same code path.

### 2.1a Region is changed by an administrator, never by the tenant

**TO BUILD.** The tenant-facing dashboard does **not** offer a region control. Changing a tenant's
**residency** is an operator action at `admin.kasir.mu`, and the tenant reaches it by asking
support. This is residency being changed, not the market: the market (`country_code`) stays a
legal-entity attribute an authorized tenant user may edit through the settings gate.

| Option | Pros | Cons |
|---|---|---|
| **A. Self-service in the tenant dashboard** | No support load; fixes a wrong choice instantly | The guard is expensive — see below; and a tenant can move itself out of a region that satisfies its own compliance obligation |
| **B. Admin-only** (chosen) | No data-presence detection needed, because a human makes the judgement; consistent with revocation; the tenant cannot break its own residency | Every legitimate correction is a support ticket |
| **C. Immutable, period** | Simplest; nothing can drift | A merchant who chose wrongly has no route at all; "we cannot change it" invites someone to edit the database |

**Decision: B — admin-only**, following the pattern `handleAdminUpdateTenant` already establishes
(`apps/license-server/admin_tenant_lifecycle.go:148`): admin-authenticated, validated, logged, and
returning the updated record. `handleAdminRevokeDevice` (`:229`) is the model for idempotency —
a tenant already in the requested region is a no-op, not an error.

**Why self-service was rejected, having been proposed first:** the only thing that makes
self-service safe is knowing whether the tenant has business data yet, and that check is
expensive and racy — it spans the cloud's rows *and* every local SQLite database that has not
synced. Building it correctly is more work than the feature it guards, and getting it subtly wrong
produces the exact failure §2.1 exists to prevent. **A human is a better guard than a heuristic
here, and a region change should be rare enough that a human is affordable.**

**Consequence accepted:** support load. This is acceptable at the current stage and is also
useful signal — a pattern of region-change requests means the provisioning flow's region choice
is unclear, which is a product defect worth seeing rather than hiding behind a self-service
control.

#### The change is an orchestration, not a field write

The stored value is not the whole change. Moving a tenant between regions requires, **in this
order**:

| Order | Step | Why it cannot be skipped or reordered |
|---|---|---|
| 1 | Migrate the tenant's rows in PG to the target region | The data is physically where the old region is |
| 2 | Update every terminal's `home_region` | Devices address a region-specific endpoint; a stale value means a terminal talks to the wrong server |
| 3 | Re-issue tokens | Region rides the claims (§2.1), so existing tokens address the old region |
| 4 | **Last:** flip `tenants.region` | The pointer must never lead the data — flipping first serves the tenant from a server that does not yet hold it |

**While only one region exists, steps 1–3 are no-ops and this is a single field write.** The
orchestration becomes real when the second region does, which is the argument for building the
field, the audit, and the admin surface now (§ "Sequencing" below).

#### Sequencing for the current stage

1. **Add `region` to the `tenants` collection**, defaulting to `"global"`. The PocketBase schema
   currently has **no region field at all** — verified, zero matches for region/country in
   `apps/license-server/pb_schema.json`.
2. **Add the admin route**, reusing the `handleAdminUpdateTenant` shape.
3. **Audit it**: actor, from-region, to-region, and a reason. `handleAdminUpdateTenant:212` already
   logs its change; a region change additionally needs a durable row, because "why did this
   tenant's data move" is precisely the question an incident review asks.
4. **Do not build the migration orchestration yet.** With one region it would be untestable code.

**Follow-up defect — already corrected in this tree.** `apps/license-server/web_dashboard.go` used
to document `PATCH /api/v1/web/settings — update tenant preferences (region, notifications)`. **That
endpoint does not exist** — the string appears nowhere else in the repository: no handler, no route
registration in `main.go`, and no caller in `website/`. Under this decision it is also no longer
*planned*, so the comment was corrected rather than the endpoint implemented.

**The correction is in the working tree, not pending:** `web_dashboard.go:14-25` now explains that
the line "was never implemented: no handler, no route registration in `main.go`, and no caller in
`website/`. It is removed rather than built, because ADR #59 §2.1a decides that the tenant's region
is an admin-only field". Line 13 is now a bare `//` separator rather than the member comments below
it. This was the same class of documentation drift as ADR #1 (§1.5, §3.4), and it is closed —
unlike that one, which §3.4 still has to resolve.

### 2.2 MARKET scope is the Legal Entity; RESIDENCY is an Organization fact

**The first draft of this section collapsed two facts into one column, and the repository forbids
exactly that.** `20260919_regional_configuration.sql:13-19` states the rule verbatim:

> `legal_entities.country_code` is the MARKET anchor (ISO-3166 alpha-2) ... It is deliberately NOT
> named `region` and it is NOT data residency: residency is where the data is STORED (an
> organization-level deployment decision ...), market is how it is TRADED. The two must not
> collapse into one column.

**Decision: two scopes, two facts.**

| Fact | What it answers | Scope | State |
|---|---|---|---|
| **MARKET** — how the entity trades | which tax regime, fiscal scheme, numbering series, receipt format and local payment rails apply | **Legal Entity** | **BUILT** — `legal_entities.country_code` (`20260919_regional_configuration.sql:42-43`), resolved as a chain axis (`regional.rs:216,277,315`) and composed into `tax_regime` (`regional.rs:386-389`) |
| **RESIDENCY** — where the rows physically sit | which deployment/server holds this tenant's data, and which token may address it | **Organization** (§2.1) | **TO BUILD** — §2.1's `home_region`; the existing contract is `docs/security/data-residency-and-retention.md` §1 |

**Why the market belongs on the Legal Entity** — and this is now a decision the repo has already
made rather than one this record is making: a registered company is registered in one country, and
every market-keyed statutory table is already scoped by `legal_entity_id` —
`fiscal_schemes` and `document_number_sequences` carry `legal_entity_id TEXT NOT NULL REFERENCES
legal_entities(id)` (`20260923_fiscal_numbering.sql:46,60`), and the fiscal slice reads and writes
them by entity (`db/fiscal.rs:38,60,195`). The market anchor is the column those rows key off, so
putting it anywhere else would be the collapse the migration comment forbids.

**Why residency does *not* belong there.** Residency is a property of the deployment, selected at
organization creation and moved only by an explicit support/migration workflow
(`docs/security/data-residency-and-retention.md:35-42`, which records §K's ruling as *decided, not
implemented* and names itself the contract any implementation must satisfy). A legal entity is not
a server. `legal_entities` carrying a `region` column would be the same collapse in the other
direction: it would put a deployment fact on a row a tenant can edit.

| Option for residency | Pros | Cons |
|---|---|---|
| **A. Residency per Legal Entity** (the first draft's choice — rejected) | Reuses the entity row and the existing scope chain | Collapses MARKET and RESIDENCY into one column, which `20260919_regional_configuration.sql:13-19` explicitly forbids; puts a deployment fact behind a tenant-editable settings gate; contradicts `data-residency-and-retention.md:35-42` |
| **B. Residency per Organization** (chosen) | Matches the recording authority and the §K policy ("an organization-level deployment decision"); keeps the market column free to be the market anchor; the token check (§2.1) reads one fact from one place | A tenant is placed by its market rather than by an explicit server choice at provisioning — acceptable, because the operator places the deployment |
| **C. Residency per Location** | Maximum flexibility | A legal entity *and* a tenant would span deployments; multiplies the residency surface for no gain |

**Consequence, stated plainly:** a tenant that trades in two markets trades under two market
anchors — one per legal entity — and that is now a supported, ordinary shape rather than a
residency problem. What is *not* supported is a tenant whose legal entities sit in different
**deployments**: residency is per Organization, so §2.1's `home_region` is singular for a tenant.
A tenant that genuinely needs entities served from different jurisdictions is **two organizations**,
which is a product/billing question (§4), not a column on `legal_entities`.

### 2.3 The market/fiscal **data** layer is BUILT; only market-specific **certification** is a module

**The first draft said fiscalization was "TO BUILD, as a seam rather than code" and belonged in
`modules/fiscal-<market>/`. That is wrong about half of it, and the half it is wrong about is the
larger half.** Fiscal and market data is largely built *inside* `kasirmu-core` as a legal-entity-
scoped slice; what does not exist is certification and signing.

| Layer | Model | Where it lives | State |
|---|---|---|---|
| Market profile — locale, timezone, currency, market anchor | **Data** — the scope chain | `regional.rs` axes | **BUILT** (§1.2, `country_code` included) |
| Statutory numbering + fiscal scheme *configuration* | **Data** — legal-entity-scoped tables | `fiscal_schemes`, `document_number_sequences` (`20260923_fiscal_numbering.sql:43-70`), `db/fiscal.rs` slice 5; wired through `kasirmu-bridge/src/fiscal.rs` and `apps/mobile-tauri/src/commands/fiscal.rs` | **BUILT** |
| Receipt format | **Data** — legal-entity content + terminal layout | `receipt_formats` (`20260925_receipt_formats.sql`, `db/receipt_formats.rs`) | **BUILT** |
| Local payment rails | **Data** — legal-entity → location | `local_payment_methods` (`20260924_local_payment_methods.sql`) | **BUILT** |
| **Market-specific certification and signing** — Italy certified signing, India GST, Brazil NF-e, Saudi ZATCA | **Module** — implements `foundation::contracts::Module` | `modules/fiscal-<market>/` | **TO BUILD** |
| Data residency | **Identity** — §2.1, **Organization** scope | Provisioning + token claims | **TO BUILD** |

**What "BUILT" means here, concretely** (so the claim is falsifiable rather than reassuring):

- `20260923_fiscal_numbering.sql` creates both tables, each with
  `legal_entity_id TEXT NOT NULL REFERENCES legal_entities(id)` (`:46`, `:60`) and a
  `UNIQUE (legal_entity_id, document_kind)` guard on the series (`:69`).
- `db/fiscal.rs` exposes eleven public functions, including
  `upsert_document_number_sequence` (`:193`), `document_number_sequence` (`:238`),
  `list_document_number_sequences` (`:280`), `document_number_sequences_for_entity` (`:308`),
  `list_fiscal_schemes` (`:344`) and `claim_statutory_number_for_sale` (`:399`).
- **The counter cannot race or gap.** `claim_statutory_number_for_sale` advances it in **one**
  `UPDATE document_number_sequences ... RETURNING` statement whose `CASE` reads the row's own
  `period_key` at write time (`db/fiscal.rs:429-446`), and it stamps `sales.statutory_number`
  inside the caller's transaction (`:464-467`), called from checkout (`db/sales_checkout.rs:637`)
  and sale lifecycle (`db/sales_lifecycle.rs:574`). A rolled-back sale consumes no number — the
  property that makes statutory numbering worth having.
- Because the numbering is legal-entity-scoped and its `document_kind` set is **closed** (receipt,
  invoice — `db/fiscal.rs:95-102`, CHECK-constrained by `20260928_document_kind_check.sql`), the
  market anchor has a real consumer today: `RegionalConfig::tax_regime` carries `country_code`
  (`regional.rs:386-389`).

**Why the *remaining* piece is a module and not an axis:** certification satisfies every test a
vertical module does — distinct code per market, its own dependencies (signing keys, government
endpoints, certificate lifecycle), optional enablement per market, and a fail-closed requirement
that must not be linked into builds for markets that do not need it. An axis would force that code
into the core binary for every tenant, including those where it is dead weight and an audit surface.
What the module does **not** own is the numbering or the scheme tables: those are core data, already
landed, and a module that re-implemented them would fork the statutory counter.

**Why market profiles are not modules:** they need no lifecycle. They are values resolved by
`RegionalConfig::resolve` and read by whatever needs them. A module wrapper would add hooks that
do nothing.

### 2.4 The module system is the delivery mechanism — for certification, and its first customer is conditional

**TO BUILD, as a rule, with an honest caveat about who needs it.** A market build selects a set of
modules; it does not select a market as one:

```
build(market = "id") → kernel { core, fiscal-id-certification?, verticals... }
   + provisioning places the Organization in a deployment (home_region)
   + RegionalConfig resolves locale/currency/timezone + the entity's market anchor from the chain
   + fiscal_schemes / document_number_sequences / receipt_formats / local_payment_methods
     already carry the market as DATA (no module required)
```

The market influences three things, and they are separable: **what is compiled** (certification
modules), **where it runs** (the deployment holding the Organization), and **how it behaves** (the
scope chain and the legal-entity market anchor). Keeping them separable is what lets one binary
serve many markets and a market-specific binary exist where mandated.

**The first customer is conditional, and saying so is the point.** After §2.3, a market that needs
only different tax, numbering, receipt shape and payment rails needs **no module at all** — that is
all delivered as data today. The module system acquires a genuine first customer only when a market
requires **certified signing or e-invoicing** the core cannot perform, which is Italy, India, Brazil
and Saudi Arabia rather than Indonesia's current periodic-reporting shape. Two consequences:

- **If Q3's second market is an EU one** (§Q3 / §Q3 EU market), the module system gets its first real
  customer then, and this rule stops being aspirational.
- **If no such market is committed**, then ADR #1's kernel remains exercised by the ten substantive
  verticals (§1.5) and by nothing fiscal, and this record should say that rather than implying a
  customer that does not exist. The rule below is not a licence to build `modules/fiscal-*` against
  an imagined market (§Q3's own warning).

### 2.5 The region is visible, and changing it is deliberate

**TO BUILD.** Because the region is not self-service (§2.1a), two things must hold:

- **The merchant's choice is informed.** The provisioning flow (ADR #56 §2.3) asks for region
  explicitly, stating the consequence. After that the value is displayed in every admin and
  diagnostics surface that already shows tenant identity, so a mistake is noticed early rather
  than at an audit.
- **The operator has a real procedure.** §2.1a's ordering, not a silent database edit. The reason
  this matters is recorded in the rejected option C there: "we cannot change it" invites someone
  to change it in the database, and an unlogged region edit is worse than a supported one.

**Fail-closed direction:** a missing `home_region` on a multi-region deployment must **refuse to
serve the tenant**, not default to the local region. Defaulting would silently place data by
accident, which is the exact failure this record exists to prevent. That mirrors the existing
fail-closed discipline for entitlements (`entitlements.rs:35,86`).

**And the same rule applies to the admin surface:** an admin region change with no recorded actor
or reason must be rejected by the write path, not merely discouraged. Consistent with §2.1a's
requirement that the audit row is part of the operation rather than a side effect of it.

## 3. Consequences

### 3.1 Positive

- **Regional configuration already works** (§1.2) and needs extension, not replacement.
- **Tenant isolation is already database-enforced** (§1.3), so region slots into an existing,
  tested enforcement point rather than a new one.
- **The kernel exists *and is load-bearing*** (§1.5): fourteen registered module crates, ten of
  them substantive, with a test pinning registration, so certification-as-a-module is buildable on
  a real mechanism rather than a README.
- **The fiscal and market data layer is already built** (§2.3), legal-entity-scoped and gap-free by
  construction (`db/fiscal.rs:429-446`), so the remaining work is certification — not a from-scratch
  statutory backlog.
- **Identity is decided once, at the cheapest moment** (§2.1), avoiding a later cross-border data
  migration.
- **The region is correctable without being self-service** (§2.1a), so a wrong choice is
  recoverable while remaining a deliberate, audited operation — and the expensive data-presence
  heuristic that self-service would have required is avoided entirely.
- **The two axes stay separate** (§1.6, §2.3), so "regional" never becomes a synonym for "module" in
  the architecture.

### 3.2 Negative

- **A multi-region tenant has its data in multiple clusters** (§2.2), and cross-region reporting
  does not exist. That is a real product limitation, not a detail.
- **Changing a region is a support ticket** (§2.1a). The merchant cannot correct their own
  mistake, and every legitimate correction consumes operator time. This is the deliberate price of
  not building a self-service guard that the data-presence check cannot support.
- **A region change is an orchestration, not a field write** (§2.1a). While one region exists it is
  trivial; once two exist, the ordering (data → terminals → tokens → pointer) is a procedure that
  must be executed correctly or a tenant is served from a server that does not hold its data.
- **Regional builds multiply the release matrix.** Each fiscalization module is a separate binary
  to build, sign, and certify — and certification is per-market, per-release, and slow.
- **The module system IS load-bearing, but not for fiscalization today** (§1.5, §2.4). Ten
  substantive verticals run through it, so the mechanism is real; the *certification* use of it is
  conditional on committing a market that requires certified signing, and if none is committed this
  rule has no customer.
- **ADR #1 and reality disagree in four places, not everywhere** (§1.5). Ten modules own their slice
  and four (purchasing, promotions, gift cards, kitchen) are lifecycle-only stubs, so ADR #1 is
  substantially accurate and thin exactly where it lists stub verticals as owning behaviour. See
  §3.4.

### 3.3 Residual risk, stated

| Residual | Bound |
|---|---|
| A tenant provisioned with the wrong region | Correctable only by an operator (§2.1a), audited with actor and reason |
| A location in a region its legal entity is not registered in | Prevented by §2.2 at write time; needs a constraint, not just a convention |
| Cross-region data movement through a shared service | Not addressed here (§4) — any shared cache or queue between regions is a residency question this record does not answer |
| Fiscalization module enabled for a market that does not require it | Fails closed (does not sign) but wastes an audit surface; enablement is a build decision |

### 3.4 ADR #1 drift is four stubs wide — decided in §Q1 drift

ADR #1 describes modules as *"a modular architecture where each module owns its entire vertical
slice"*. Fourteen crates are registered and ten of them do own their slice, so the statement is
substantially true; the drift is that four crates (purchasing, promotions, gift cards, kitchen) are
registered and lifecycle-only, owning their manifest, id and dependency edges but no domain logic
(§1.5, `platform/startup/src/lib.rs:107-115`). **§Q1 drift decides the repair** — extract the four,
amend ADR #1 to state the stub reality, or a hybrid — and the constraint that binds it is
fiscalization.

**This record requires only that the chosen repair lands before fiscalization is built**, because
building the first certified module on a system whose own ADR misdescribes four of its crates will
propagate the confusion into the thing that must be certified.

## 4. Non-Goals

- **Not a multi-region deployment design.** This record fixes identity and the module seam; regions,
  clusters, replication topology, and failover are an infrastructure decision it does not make — and
  `docs/security/data-residency-and-retention.md` §1, not this record, is the contract that
  decision must satisfy (§2.2).
- **Not cross-region reporting.** A tenant whose entities trade in two **markets** is ordinary and
  supported — that is one market anchor per legal entity (§2.2). A tenant whose data would need to
  sit in two **deployments** is out of scope; residency is singular per Organization, so that is two
  organizations. Aggregation across them is a future capability with its own residency questions.
- **Not a tax engine, and not a rebuild of the fiscal data layer.** Rate resolution, rounding modes
  and scoping already exist; so do `fiscal_schemes`, `document_number_sequences`,
  `receipt_formats` and `local_payment_methods` with their db modules (§2.3). §2.3 only places the
  *certification and signing* concern in a module.
- **Not a rewrite of `RegionalConfig`.** §1.2 is the foundation and is extended, not replaced.
- **Not a change to the scope chain order.** `Location → Legal Entity → Organization → BuiltIn` is
  correct and stays.
- **Not the cross-region data-migration orchestration.** §2.1a fixes the *ordering* a region change
  must follow. The tooling that migrates a tenant's rows between clusters is a later piece, built
  when the second region exists — see §2.1a's sequencing. With one region it would be untestable.
- **Not a self-service region control.** Decided against in §2.1a. The tenant-facing dashboard does
  not get one, and `PATCH /api/v1/web/settings` is not implemented — the comment that advertised it
  was corrected in this tree (`web_dashboard.go:14-25`).
- **Not a tenant-facing market control *of residency*.** The market anchor (`country_code`) is a
  legal-entity attribute an authorized user edits through the settings gate
  (`kasirmu-bridge/src/regional.rs:46-49`); changing the *deployment* holding a tenant's data is
  the admin-only operation of §2.1a. The two are different controls on purpose.

## 5. Decisions on the Former Open Questions

**Status: DECIDED** (2026-10-04). Each item carries its options, the tradeoff, and a binding
decision with rationale. `[blocking]` meant the answer changes §2.

### Q1 — Does a region boundary require its own deployment, or can it be a schema/tenant partition? `[was blocking]` — DECIDED

| Option | Pros | Cons |
|---|---|---|
| **A. Physical: one deployment per region** (separate DB, separate cluster) | Unambiguous residency; a regulator can be shown where data lives; blast radius is per-region | More infrastructure; every deploy is N deploys; version skew between regions is possible |
| **B. Logical: one cluster, partitioned by region** | One deployment to operate | Residency is a *claim* about row placement, which is weaker evidence; a cluster-level backup crosses regions by definition |

**Decision: A — one deployment per region, with its own database and cluster.**

Data-residency regimes are about where data *physically* is. Option B makes that a claim about row
placement, answerable only by trusting the application — and the things that would break it are
exactly the things nobody thinks of as data movement: a cluster-level backup, a replica, a read
replica used for analytics, an operator running a query. Each would traverse every region's data
while the application-level partition still looked correct.

**The cost is accepted explicitly, because it is large:** every deploy becomes N deploys, each
region can drift in version, and per-region capacity planning is now a real task. §3.2 carries this.

**What this obliges us to build, which the logical option would not:** a region-aware release
process (one build, N promotions, with version reporting per region) and a way to see skew. Absent
that, the first symptom of divergence is a merchant in one region hitting a bug fixed in another.

**Revisit only if** a residency regime we target accepts logical partitioning *with* a contractual
guarantee about backups and replicas. That is a legal question, not an engineering one, and the
answer differs by market.

### Q2 — Are regional profiles versioned data, or build-time constants? `[was deferrable]` — DECIDED

| Option | Pros | Cons |
|---|---|---|
| **A. Data rows** | A new market is a row, not a release; matches the existing settings-table Organization layer (`regional.rs:160`) | A bad profile ships to production without review |
| **B. Build-time constants** | Reviewed, tested, versioned with the binary | Every market addition is a release |

**Decision: B for shipped axes, A for tuning — split by the question "does a wrong value cause a
wrong sale?"**

| Value class | Model | Examples | Why |
|---|---|---|---|
| **Correctness-critical** | **Build-time constants** | currency decimals, timezone set, tax regime, receipt shape, fiscal rules | A wrong value produces a wrong *sale* — reviewed, tested, versioned with the binary |
| **Legitimately variable** | **Data rows** | FX rates, local payment toggles, tenant defaults | Varies by time and tenant; requiring a release would make it stale, which is its own error |

**The dividing line is not "how important is it" but "is there a correct value the binary can
know?"** Currency decimals for IDR are a fact about the market and belong in the build. Today's USD
to IDR rate is a fact about *now* and belongs in data — pinning it to a release would guarantee it
is wrong between releases.

**Consequence:** the Organization settings layer (`regional.rs:160`) stays the home for the
variable class, and the axes that resolve through `RegionalConfig` stay code. A contributor adding
a market adds a build-time profile plus, optionally, data rows — not one or the other.

### Q3 — Which market first, and therefore which fiscalization module exists first? `[was blocking for scheduling]` — DECIDED

This determines the first **certification** module (§2.3's built/unbuilt split), the first certified
build, and — per §2.4 — whether the module system has a fiscal customer at all. It is a commercial
decision, not an architectural one, and since the *data* half of §2.3 is already built it no longer
blocks §1.2's chain; it blocks §2.3's module half, and building that against an imagined market is
the error §Q3 warns about.

**Decision: build the seam against Indonesia; certify a second market — ideally an EU one — before
generalising the interface.**

Indonesia is the market the pricing document already commits to (`subscription-tiers.md` §2: IDR
rates, Midtrans named as the Phase 2 revenue unlock, and the 65M-MSME segment called out as the
addressable market). Building the first fiscalization module there means the seam is shaped by a
real merchant, a real tax authority, and a real certification process.

**The second market is the load-bearing part of this decision, not a follow-up.** One market
produces a `fiscal-id` module with an interface fitted to Indonesian requirements. Two markets —
particularly an EU one, where the obligation is certified signing rather than periodic reporting —
produce an interface that is genuinely abstract. **Generalising from one example is how a
market-specific interface gets mislabelled as a seam**, and the cost of that mistake is paid by
every subsequent market.

**Sequencing implication:** §2.3 should not be implemented until this is answered, because building
the seam against an imagined market is the same error in the other direction. If Indonesia slips,
build the *data* axes (§1.2's existing chain) and defer fiscalization rather than inventing a
fiscal interface without a customer.

### Q4 — Does `home_region` live in provisioning (ADR #56) or on the Legal Entity (§2.2)? `[was blocking]` — DECIDED

§2.1 and §2.2 answer different questions and must not be read as one field in two places:
**residency** is per *Organization* (which deployment holds the data), **market** is per *legal
entity* (which jurisdiction the entity trades under). The first draft of §2.2 answered both with one
legal-entity "region", which `20260919_regional_configuration.sql:13-19` forbids; this decision is
the corrected form.

| Value | Where | Why |
|---|---|---|
| `home_region` — which deployment holds this *organization's* data (**RESIDENCY**) | `provisioning` (ADR #56 §2.1), mirrored by the license server's `tenants.region` (Q5) | It is a property of the deployment, selected at organization creation and moved only by an explicit migration workflow — `docs/security/data-residency-and-retention.md:35-42`, the existing authority |
| `country_code` — which market the entity trades under (**MARKET**) | `legal_entities` — **already exists** (`20260919_regional_configuration.sql:42-43`) | A registered company is registered somewhere; the market drives tax, numbering, receipts and local rails, so it is the column those tables key off |

**Decision: both fields, with the market/residency split enforced as a rule — and no invariant
tying them.**

The first draft decided "a legal entity's region must equal its tenant's `home_region` until
multi-region tenants exist". **That invariant is withdrawn**, because it only existed to hold
together a collapse this repair removes: a legal entity has no region to compare. Replaced by the
positive rule below, which is enforceable from the first migration.

- **The deployment rule (residency):** every legal entity of an Organization resolves to the same
  deployment — the one named by that Organization's `home_region`. A tenant whose entities must be
  served from different jurisdictions is **two organizations**, not one organization with two
  regions. This is the constraint worth enforcing, and with residency per Organization it is a
  property of the model rather than a cross-table CHECK.
- **The market rule:** `country_code` is free per legal entity and may differ between entities of
  one organization — that is the supported multi-market shape (§2.2), not a violation.
- **No constraint ties `country_code` to `home_region`.** They answer different questions, and a
  merchant may legitimately trade in a market whose deployment is elsewhere while the residency
  policy is single-region (`data-residency-and-retention.md` §1). Encoding today's "one deployment"
  fact as a CHECK between the two columns is exactly the collapse the migration comment forbids, and
  it would make the first real region a migration against a wrong constraint.

**Flagged as the question most likely to bite later**, because a reader would plausibly still assume
one `region` field is enough. It is not: there are two facts, and they are now named separately.

### Q5 — Does the region live on `tenants` (license server) or in the tenant's own database? `[was blocking]` — DECIDED

§2.1a's sequencing says "add `region` to the `tenants` collection", and §2.1 says the region rides
the credential's claims. Those are two different copies of one fact, which is the shape that drifts.

| Option | Pros | Cons |
|---|---|---|
| **A. License server only** (`tenants.region`) | One authority; the token is minted there, so the claim is derived from it; nothing to reconcile | A device with no network reads no region; the client needs it for UI |
| **B. Tenant DB only** (provisioning row, ADR #56) | Available offline; it is where `home_region` is written at provisioning | The server cannot answer "which region is this tenant" without asking the device |
| **C. Both, server authoritative** | Offline reads work; the server remains the only writer | Two copies — and this is exactly the drift the repo already fights elsewhere (ADR #56 §1.3's `CompleteSetupArgs`, the duplicated wire types) |

**Decision: C — both, with the license server authoritative and the local copy explicitly a cache.**

The precedent already exists and is the reason this is the low-risk option: the subscription row is
stored locally *and* server-side, and `refresh_subscription_status_from_server`
(`license_verification.rs:682`) writes the server's authoritative value into the local row, which is
never treated as the source of truth. The same discipline applies here with no new pattern invented.

**Two properties the implementation must carry, or C degenerates into the drift it is chosen to
avoid:**

- **The local copy is written only from a server response**, never from user input or a default.
  That is what makes it a cache rather than a second authority.
- **The server refuses a token whose `home_region` differs from its own**, per §2.1. This is the
  enforcement point, and it must not consult the client's local copy.

**Option B is rejected as unviable, not merely inferior.** If the region exists only in the tenant's
own database, the server cannot enforce §2.1's "region R rejects a foreign token" without trusting
the client's own report of its region — and a control that asks the untrusted party to declare the
value it gates is not a control. Option B would leave §2.1's enforcement point unenforceable.

**Option A is rejected as insufficient**, not unsafe: with no local copy, a device with no network
cannot show or reason about its own region, and §2.5 requires the region be visible in diagnostics.

**Implementation note:** the local `provisioning.home_region` column (ADR #56 §2.1) and
`tenants.region` are the two copies. The drift risk is real and is exactly why this record names
the authoritative one rather than leaving it implicit — and why §Q2 vocabulary puts both of them
behind one closed `RegionCode` type rather than two free-form strings.

### Q6 — What are the initial region values? `[was blocking for implementation]` — DECIDED

The decision to ship one region now and split later (§2.1a sequencing) needs those values named
before `tenants.region` can be created.

| Option | Pros | Cons |
|---|---|---|
| **A. `global` only** | Matches the current single deployment; nothing to choose at provisioning | "Global" is not a residency region — see below |
| **B. `global` + `id` from the start** | Indonesia is the committed market; the second region exists before it is needed, so the split path is exercised early | Two deployments to run before revenue justifies it |

**Decision: A — a single region, `global`, to start.**

**The caveat is part of the decision, not a footnote: `global` means "no residency commitment
yet", not a residency region.** A merchant in Germany and one in Brazil would both land in it, and
neither regulator would be satisfied by the name. Note that this is the value of the **residency**
field (`tenants.region` / `provisioning.home_region`); the **market** anchor is a separate column
with its own vocabulary and is *not* seeded from this value (§Q2 vocabulary, below). Two
consequences follow and both must be honoured:

- **No residency promise may be made to any customer while only `global` exists.** Marketing,
  contracts, and sales answers must not imply data stays in a jurisdiction, because it does not.
- **The first split creates the first real region**, and only then does a residency claim become
  true for tenants placed there. Tenants left in `global` still have no such promise.

**Why B is rejected:** a second region is an operational commitment, not a naming one. Per Q1's
physical-deployment decision it means another cluster, another deploy pipeline, and version skew to
watch. That cost should be paid by a market that needs it rather than pre-paid for the possibility
that one will.

**Revisit trigger, stated so this is not revisited by accident:** the second region should be
created when a market requires residency, or when the first EU/regulated market is committed —
whichever comes first. Until then, `global` is honest and sufficient.

**The vocabulary this decision leaves open is deferred to §Q2 vocabulary**, which is where the
canonical region-code set, its type and the build-target selection rule are decided. Q6 decides only
*how many* regions exist at launch and what the single one is called.

---

*The three items below carry the labels they were raised under, so a reader who saw them that way
can find them. They are cited in this record as **"§Q1 drift"**, **"§Q2 vocabulary"** and
**"§Q3 EU market"** — distinct from the Q1–Q6 above. §2.3's BUILT/TO-BUILD split and §2.2's
market/residency ruling are what make them answerable.*

### Q1 drift — Extract the four stub verticals, or amend ADR #1? `[blocking for the fiscalization build]` — DECIDED

Raised by §1.5/§3.4 after the repair: fourteen crates are registered, ten own their slice, and four
(purchasing, promotions, gift cards, kitchen) are lifecycle-only — they own their manifest, id and
dependency edges while their hooks only log (`platform/startup/src/lib.rs:107-115`, audit stamp
`modules/README.md:3`).

| Option | Pros | Cons |
|---|---|---|
| **A. Extract all four** into real vertical slices in `modules/` | Makes ADR #1 literally true; the four would stop being the only crates whose promise outruns their code | The largest of the three, and it is a porting project with no market asking for it: it would move working logic (PROMO-3 already lives in `kasirmu-core`) for a documentation reason, and it puts real behaviour behind the module lifecycle for the first time |
| **B. Amend ADR #1** to state the stub reality: ten modules own their slice, four are lifecycle-only placeholders that pin the dependency graph | Smallest correct change — it makes the ADR match a codebase that is already 10/14 accurate; no code moves, so no behaviour can regress; it is a *repair of the claim*, which is what the defect actually is | Leaves the four stubs in place; a future reader must be told which four, so the amendment must name them rather than gesture |
| **C. Hybrid** — extract the stub(s) that immediately precede the fiscalization work, amend for the rest | Bounded work tied to a real consumer | The extraction would be driven by the certification module rather than by a merchant; but §2.3 shows certification does **not** need those verticals, so this trades a documentation fix for an unmotivated port |

**Decision: B — amend ADR #1 to state the stub reality, and name the four crates in the amendment.**

The defect was never that four crates are stubs; it was that the ADR described them as owning a
vertical slice. Option B repairs exactly that, at the cost of editing a document, and §2.3 removes
the only argument that made extraction urgent: certification is a *new* module with its own code
(signing, government endpoints, certificate lifecycle), so it does not consume purchasing,
promotions, gift cards or kitchen. Spending a porting project to make a sentence true when the
sentence can be made true is option A's cost with none of its benefit.

**The amendment must be specific, or it recreates the defect in a softer voice:** it should list the
ten owning modules, list the four lifecycle-only ones, and state that the kernel's dependency graph
is exercised by all fourteen while domain logic lives in ten of them plus `kasirmu-core`.

**Sequencing, and the blocking edge stated honestly:** the amendment must land before the first
`modules/fiscal-*` crate is built, because that module is the first one whose code will be
certified — building it on an ADR that misdescribes four of fourteen crates propagates the
misdescription into the certified artifact. It does **not** block any part of §2.3's already-built
data layer, and it does not block Q2/Q6.

**Revisit only if** a market actually asks for purchasing, promotions, gift cards or kitchen as a
deliverable; then the corresponding stub is extracted as ordinary product work, with a customer
rather than a documentation motive.

### Q2 vocabulary — What is the canonical region-code vocabulary, what type carries it, and how does a build target select modules? `[deferrable]` — DECIDED

Q6 names one value, `global`, and says nothing about the set it belongs to. Two different facts need
two vocabularies, and this record has been conflating them (§2.2):

| Axis | Candidate vocabulary | Carried by |
|---|---|---|
| **RESIDENCY** (which deployment) | a deployment selector: the literal `global` today, deployment identifiers later — **not** an ISO country code | `tenants.region` (license server) / `provisioning.home_region` (local cache, ADR #56 §2.1) |
| **MARKET** (how the entity trades) | **ISO-3166 alpha-2, already chosen and already enforced** | `legal_entities.country_code` (`20260919_regional_configuration.sql:42-43`), validated at the write boundary by `RegionalConfig`'s `is_valid_iso3166_alpha2` (`regional.rs:89,131`) |

| Option for the residency vocabulary | Pros | Cons |
|---|---|---|
| **A. Free-form string** (the shape the first draft left) | No decision to make now | Two spellings of one region is a routing bug that looks like a data bug; there is no place to put the invariant |
| **B. A closed, code-checked set** — one newtype (e.g. `RegionCode`) whose constructor rejects anything outside a named list, serialized as its lowercase string | The invariant lives in the type, mirroring how `Currency` and `DocumentKind` already work (`DocumentKind::parse`, `db/fiscal.rs:95-107`, is the closest precedent: a closed set that rejects an unvalidated string rather than silently opening a parallel series); one spelling, one meaning | Every new region is a code change plus a release — acceptable, and the same trade Q2's build-time ruling already makes for correctness-critical values |
| **C. ISO-3166 alpha-2 for residency too** | Reuses the market validator | Wrong: `global` is not a country, a residency region is not a jurisdiction, and §Q6 already says `global` means "no residency commitment yet". Reusing the market vocabulary is the collapse §2.2 forbids |

**Decision: B — a closed, case-normalized newtype for the residency vocabulary; ISO-3166 alpha-2
stays the market vocabulary, already enforced.**

**The initial set is exactly `{ global }`** (Q6), so the type costs one constructor and one match
today and is the only place a second region has to be named later. The build side is already
decided by §2.4 and needs no second mechanism: **a build does not select a region — it selects
modules**, and all market variation that is not certification is data resolved from the scope chain
plus the legal entity's market anchor. So the "how does a build target select modules" half of this
question resolves to §2.4's rule rather than to a new field.

**Deferrable because** there is one region and no certification module yet; the type is worth
writing at the same moment `tenants.region` is created (Q5/§2.1a sequencing step 1), which is a
`[blocking]`-shaped item for that build but not for this record.

**One thing this decision deliberately does not fix:** `tenants.region` and
`provisioning.home_region` are two copies of one fact (Q5). The newtype is what keeps both of them
from drifting into two spellings of one region.

### Q3 EU market — Which EU market is the second fiscalization target? `[deferrable]` — DECIDED

**Carried over from Q3 above**, which is decided and is not re-opened: §Q3 commits to certifying
"a second market — ideally an EU one" before generalising the interface. §2.4 makes that commitment
load-bearing — it is the only thing that gives the module system a fiscal customer — and §Q3 does
not name the market. This is that decision's missing value. The **Indonesia-first half is settled
and stays**: it is the market the pricing document already commits to (`subscription-tiers.md` §2,
IDR rates and Midtrans), and the repaired §2.3 changes what is built there rather than whether —
Indonesia needs the *data* layer, already landed (§2.3), and gets a certification module only if its
periodic reporting turns out to require one.

| Option | Pros | Cons |
|---|---|---|
| **A. Name it now** (e.g. Italy, whose certified-signing obligation is the sharpest contrast with Indonesia's periodic reporting) | The interface gets a second real shape to abstract over; §2.4's rule stops being conditional | Picks a market on an architectural argument rather than a commercial one, and the choice is exactly the kind this record already ruled is commercial (§Q3) |
| **B. Defer to the market plan, named as the trigger** (chosen) | Keeps the commercial decision commercial; the architectural consequence — one market gives a market-shaped interface, two give a seam — is already recorded and does not need a name to be true | §2.4's module customer stays conditional until it lands, which is stated plainly there rather than assumed away |
| **C. Drop the second market** | One fewer certification to build | Guarantees the mislabelled-seam failure §Q3 identifies: an interface fitted to a single market, called abstract |

**Decision: B — defer which EU market, and record the trigger rather than the name.**

The interface-generalisation argument in §Q3 needs *a* second certification obligation of a
different shape; it does not need a specific one today, and naming it from the architecture side
would repeat the mistake §Q3 corrects in the other direction. The market plan owns the choice.

**The trigger that makes this blocking:** the first line of `modules/fiscal-*` code beyond
Indonesia's own module. Before that, this is deferrable; at that point it is not, because a seam
generalised from one example is the defect §Q3 exists to prevent.

**The honest consequence if it never lands:** §2.4 says it — data delivers market variation, the ten
substantive verticals keep the kernel honest, and no fiscal module is built for a market that has
not asked for one.
