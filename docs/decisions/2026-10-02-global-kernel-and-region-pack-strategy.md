# Global Kernel and Region Packs — strategy note

**Status:** strategy note. **It decides nothing.** Every architectural question below was already
decided by a numbered ADR; where this note disagrees with one, the ADR wins.
**Date:** 2026-10-02
**Origin:** the 990-line draft `2026-10-02-adr64-global-kernel-and-region-pack.md`, now split —
its payment content became
[ADR-64](./2026-10-02-adr64-tender-vocabulary-and-offline-tender-state.md), and the rest is this
note.
**Tags:** strategy, regions, residency, rollout

## Why this split happened

The draft carried four genres in one file: architectural decisions, commercial estimates, a
rollout plan, and process advice. Together they made the decisions unfindable and made the
estimates read as commitments. The decisions then turned out to be **already decided elsewhere** —
which is the fact this note exists to record once, so the next reader does not rediscover it by
re-reading a 990-line draft.

## 1. Already decided — do not re-decide

| Question | Decided by | The answer, in one line |
|---|---|---|
| Is a country a plugin, or a data row? | ADR-59 §1.6, §2.3 | **Data.** A market profile is resolved by the scope chain and has no lifecycle; only *certification / signing* is module-shaped |
| Where does "market" live vs "residency"? | ADR-59 §1.6, Q4 | Two fields. `legal_entities.country_code` = how it trades; `provisioning.home_region` = where the bytes are. **Never collapse them** |
| One deployment per region, or partitioned? | ADR-59 Q1 | **DECIDED — one deployment per region**, own database and cluster, with the cost accepted (N deploys per release, per-region version skew) |
| Market profiles: constants or rows? | ADR-59 Q2 | Split by *"does a wrong value cause a wrong sale?"* — correctness-critical is build-time, variable is data |
| Which market first? | ADR-59 Q3 | Indonesia for the seam, then **a second, ideally EU, market** before the interface is generalised |
| Fiscal numbering, receipt formats, local rails | ADR-59 §2.3 | **Already built** as data (`fiscal_schemes`, `document_number_sequences`, `receipt_formats`, `local_payment_methods`) |
| Money representation | ADR-30 | `Money`, `i64` minor units. Never float |
| Time representation | ADR-48 | IANA zone, merchant local, UTC |
| Is a tax engine in scope? | ADR-59 §4 | **Explicit non-goal.** Rate resolution and rounding already exist |
| Localisation format | `AGENTS.md` §6.3 | **@fluent/react**, `shared-ui/locales/*.ftl`. Not ICU MessageFormat |

The draft's `plugins/regions/<cc>/` proposal is therefore declined on the record: it makes market
profiles modules, which ADR-59 §1.6 names as *the common mistake*. It also proposed
`manifest.toml` per region, while the kernel validates `manifest.json` against
`docs/specs/module-manifest.schema.json`.

## 2. Still open — nobody has decided these

Questions, not answers. Deciding any of them needs a market commitment this repository has not
made, and building against an imagined market is the error ADR-59 §Q3 warns about.

- **Certification modules.** Which markets need certified signing or e-invoicing (Italy, India,
  Brazil, Saudi ZATCA) rather than periodic reporting, and therefore become the first
  `modules/fiscal-*`? ADR-59 §2.4 is explicit that building this against an imagined market is the
  error to avoid, and that if no such market is committed the kernel's fiscal use has no customer.
- **The fiscal hash chain.** `fiscal_hash` + `previous_receipt_hash` per receipt. Structurally
  easy and legally load-bearing; **nobody has asked whether a target market requires it.** Do not
  build it on the strength of this note.
- **Region-aware sync metadata.** The draft's §13 packet shape (`region`,
  `region_pack_version`, `previous_hash`, `fiscal_signature`). Sync is owned by ADR-21 and ADR-43;
  whether any of those fields are needed is unasked.
- **Per-country feature flags.** The tree has a **tier** matrix (`Feature::` in `kasirmu-core`,
  `supports_qris` as an entitlement) and a **market** axis (`local_payment_methods`). A third axis
  keyed on country is neither; nobody has said whether it is needed or how it would compose with
  the other two.
- **Configurable onboarding forms.** Per-market KYC field sets.
  `20260924_local_payment_methods.sql:17-28` sets the precedent — market surface, not entitlement,
  not credentials — and the same shape would apply to onboarding. Unbuilt.
- **Data-residency topology.** ADR-59 Q1 decided the *policy*; the actual regional deployments,
  replication and failover are deferred, and `docs/security/data-residency-and-retention.md`
  remains the contract they must satisfy.

## 3. The payment part moved to ADR-64

Two of the draft's arguments were genuinely new, and are now decided against the tree: the tender
vocabulary (four disagreeing declarations, an unconstrained column, a decided-but-unbuilt method
list) and the offline tender state (a boolean where a state machine is needed, plus a "settled
immediately" rule no electronic tender should inherit). See
[ADR-64](./2026-10-02-adr64-tender-vocabulary-and-offline-tender-state.md).

## 4. Commercial material — deliberately not an ADR

ADR-59 §Q3 states the principle: *"Which market first … is a commercial decision, not an
architectural one."* The draft's rollout phases and cost table are **estimates with no basis
recorded anywhere in this repository**. They are reproduced here only so the trail is not lost:

| Expansion level | Draft's estimate | Draft's timeline |
|---|---:|---:|
| Indonesia hardening | 250k – 750k USD | 2–4 months |
| Southeast Asia pack | 1M – 3M USD | 6–12 months |
| Brazil or India entry | 1M – 4M USD per country | 9–18 months |
| US/EU compliance-ready | 3M – 10M+ USD | 12–24 months |
| Full global platform | 8M – 20M USD | 24–36 months |

**Treat none of these as a commitment.** For any of them to become one they need a finance owner,
a bottom-up build plan against the module seams ADR-59 describes, and a written assumption set —
none of which exists today.

The draft's operational point survives and is worth keeping: **kasir.mu stays software-only and
does not hold merchant funds**, later sharing payment revenue through a PayFac partner rather than
becoming licensed itself. That is now ADR-64 §2 D6, with a stated consequence — no
`payment_gateways` row is required for cash, static QR, open bill, customer tab or pay-later, so an
unsynced terminal still sells.

## 5. The "AI swarm" section

The draft's §17 — what agents may and may not do — is process guidance, not an architecture
decision. Its content is sound and is **already covered by `AGENTS.md` and the skills catalogue**.
It is not duplicated here: a second copy of a rule is a second place for it to drift.

## References

- [ADR-59](./2026-09-21-adr59-regional-topology-and-modular-delivery.md) — the record this note
  mostly defers to
- [ADR-64](./2026-10-02-adr64-tender-vocabulary-and-offline-tender-state.md) — the payment half
- [ADR-30](./2026-07-24-domain-module-extraction.md),
  [ADR-48](./2026-09-09-adr48-timezone-representation.md)
- `docs/security/data-residency-and-retention.md` — the residency contract ADR-59 defers to

> last audited 02-10-26 by DSH
