---
num: 51
area: settings
title: ADR #51: Sealed Settings Ingest Policy — One Funnel for Every Untrusted Settings Lane
status: Accepted (2026-09-11)
---

# ADR #51: Sealed Settings Ingest Policy

**Status:** Accepted (2026-09-11) · branch `0.0.37`. Built across `172f7fe3c` (sealed policy +
accessors), `531fd6cd5` (re-export and refusal tests), `3350c6d21` (sync ingest and egress), `a0b8af03d`
(`oz-core` facade delegation), `c92600caf` (tablet egress gate), `5096169a5` (both package lanes).

## Context

Settings rows reach the `settings` table from four lanes: the app itself, the `.ozpkg` package lane (CLI
and desktop bridge), and sync in both directions. Each lane used to decide for itself. The bridge
carried its own copy of a deny list plus a prefix rule; the CLI called the shared predicate only, so
`local_api.enabled` and `lan_server.bind` travelled in its packages while the GUI dropped them
(`platform/core/src/settings/raw.rs:460-475`); and sync ingest applied any key the server sent,
unchecked, until `3350c6d21`.

The threat model, stated because the repo documents none: sync is device to device, nothing in
`transport` or `sync_api` signs or MACs an item, so the sender is not an authority (`raw.rs:389-396`),
and the sync store accepts any action string opaquely. This policy is **not** a defence against an
attacker who can inject; it is a defence against a package or a peer writing a key it has no business
writing — `machine_id`, `sync_terminal_id`, `hardware_fingerprint`
(`platform/core/src/settings/keys.rs:244-255`), device identity and the license server's
one-trial-per-device lock — plus the manager-owned prefixes. Refusing on egress also stops a cleartext
credential from LEAVING the device, the half that matters, since the ingest side already refuses on
arrival.

## Decision

One sealed policy, one funnel, no constructible bypass (`platform/core/src/settings/raw.rs:361-481`).
`enum IngestPolicy { TrustedLocal, PortablePackage, RemoteSync }` is sealed by a module-private
`sealed::Sealed`, so no lane can implement the trait for its own type, and there is deliberately no
`AllowAll` variant: skipping the filter is UNWRITABLE rather than merely unreviewed. `trait
IngestPolicyKind` gives `admits(&self, key: &str) -> bool` and `label(&self) -> &'static str` returning
`trusted_local`, `portable_package` or `remote_sync`; `is_manager_owned_key` is true for keys starting
with `local_api.` or `lan_server.`.

- `Settings::load_exportable` returns only the rows a portable package may carry.
  `Settings::set_with_policy` returns `Ok(bool)` where `false` is a refusal with nothing written and an
  `Err` is a SQL failure — the two are never collapsed. `Settings::set_batch_with_policy` takes a
  `&rusqlite::Transaction`, because a lane already owning one must not nest, and needs the `Copy` bound
  because a loop body consumes a non-`Copy` `impl Trait`.

- Both untrusted lanes admit the negation of `is_non_exportable_setting_key(key) ||
  is_manager_owned_key(key)` — ONE rule, so the lanes cannot drift the way the two hand-copied shell lists
  did. Refusal is a `tracing::warn!` carrying the key and the policy label and NEVER the value, with no
  counter and no abort; the batch continues, on the precedent of the unsupported-action arm in `queue.rs`.

## Invariants — the point of this record

Each was found by a worker refuting a premise, not by the design being obvious. **`load_all` stays
UNFILTERED, on purpose.** It backs `Settings::load_features` and `prune_stale_features`
(`crates/oz-core/src/settings.rs:796`, `:814`), and feature rows are ordinary settings rows, so
filtering it would re-type a general-purpose whole-table read as an egress read and silently break
feature pruning. Portable egress is expressed by `load_exportable` and NEVER by narrowing `load_all`;
the reasoning is in the accessor's own doc comment (`raw.rs:60-66`).

**The facade delegates, so lanes never import `platform_core` directly.**
`crates/oz-core/src/settings.rs` re-exports the policy (`:33`) and delegates all three accessors (`:75`,
`:85`, `:103`). The delegation was MISSING for a whole wave: `172f7fe3c` re-exported the types and told
every lane to go through `oz_core` without delegating the methods, and `platform/sync` has no
`platform-core` edge — which is why two lanes had to gate on `admits()` behind one named boundary
instead (`queue.rs:54`, `crates/oz-cli/src/commands/ozpkg.rs:52`). Landed in `a0b8af03d`.

**There is no read-only accessor, so the read-only question uses the predicate.** `settings_change_of`
(`queue.rs:747-759`) must ask whether a key was applied without writing anything, so it gates on
`admits()` — the SAME predicate the accessor applies, which is why the two cannot disagree. Without it a
refused key would still publish `SettingsUpdated` and tell the UI to refetch a value deliberately not
written.

**The bridge egress gate deliberately does NOT call `set_with_policy`.** That is a write, and the
enqueue path does not write settings — it queues an item for a later push
(`crates/oz-bridge/src/settings.rs:440-468`). Calling the accessor there would persist a value as a side
effect of deciding whether to replicate it, and would move the write from the store database into the
global one.

## Accepted losses

- RemoteSync refusal strands device-to-device replication of `smtp_config`, which today ships a user-typed
  SMTP password as plaintext JSON to every pulling terminal: a second install no longer receives an SMTP
  password it needs. That is the intended outcome.

- A package exported by an OLDER build may legitimately contain a key the new import refuses, so restoring
  an old file now skips those rows with a warning: `local_api.enabled`, `local_api.port`,
  `local_api.store_id`, `lan_server.bind` (`crates/oz-cli/src/commands/ozpkg_tests.rs:46-51`).

- No ordinary setting is caught: `store.name`, `currency.default`, `receipt.footer`,
  `brand.primary_colour`, `ui.locale` and `tax.rounding_mode` are asserted to still travel and still
  restore (`ozpkg_tests.rs:335-345`, `:365-376`; `crates/oz-bridge/src/settings_tests.rs:873-889`).

- The CLI starts refusing four keys its own older packages carried — a behaviour change in a tool, not
  only a library.

## What this does not do

- **It does not make a backup safe.** `oz backup` / `oz restore` (`crates/oz-cli/src/commands/backup.rs`)
  and the bridge `create_backup` (`crates/oz-bridge/src/data.rs:302`) copy the WHOLE SQLite file with no
  policy at all, so a `.db` still carries `machine_id` and every credential — by design, documented in
  `crates/oz-cli/README.md`. Filtering the package lane does not narrow that door.

- **It does not fix confidentiality of anything at rest.** Encryption binds to the typed setter
  (`platform/core/src/settings/typed.rs:339`), never to list membership. **It does not authenticate a
  peer** — see Context.

- **One SMTP exposure survives it.** The settings card writes through the generic setter
  (`ui/src/features/settings/EmailReportSettings.tsx:163` → `crates/oz-bridge/src/settings.rs:407` →
  `Settings::set_tracked`), not the typed one, so its password is stored in plaintext, and the
  keep-on-blank merge that landed in `07eb48347` (`crates/oz-core/src/export/email_report.rs:183-200`) is
  not yet on the destructive path. OPEN ITEM, being fixed separately — recorded, not implied closed.

- **It is not an authority model, and it is nowhere near exhaustive.** `RemoteSync` refuses **21** of the
  **75** declared keys, so **54 stay admissible** from a channel that authenticates nobody (Context). An
  exclusion list can only refuse what its author thought to name; that is the shape of the rule, not a
  gap in this list. The per-name breakdown, the query that re-derives it and the self-test floor live in
  [`docs/records/snapshots/2026-09-12-sync-settings-ingest-and-redirect-census.md`](../records/snapshots/2026-09-12-sync-settings-ingest-and-redirect-census.md).
  `sync_server_url` is on the admitted side, and it is the one admitted name whose reader carries a bearer
  secret, so the 54 are not equally boring.

- **Membership is a whole-name fold, so the scoped spellings the hosted API writes are admitted.
  `normalised_candidate` (`keys.rs:404`) trims and lowercases the ENTIRE name, and `credential_base`
  (`keys.rs:439`) and `is_secret_setting_key` (`keys.rs:508`) compare that fold by equality against the
  list — so `smtp_config:tenant-a`, the `{base}:{tenant}` form `crates/oz-api/src/pg.rs` writes through
  `scoped_setting_key`, resolves to `None` while bare `smtp_config` resolves to a refusal. Both functions
  are deliberately SUFFIX-BLIND and say so at `keys.rs:424-436`; the choice is pinned by
  `decision_pin_credential_base_is_suffix_blind` (`keys_tests.rs:316`) and the file's shape is policed by
  `decision_pin_membership_tests_live_only_in_the_identity_functions` (`keys_tests.rs:451`). This ADR
  admits a value it would refuse unscoped; the blind spot has a recorded owner, the credential-suffix
  wave, and is not closed here.

- **The same key has a second writer that this policy does not govern.** ADR #11's migration redirect
  persists `sync_server_url` via `persist_migration_url` (`platform/sync/src/daemon_tick.rs:77-87`) →
  `Settings::set_sync_server_url` (`typed.rs:327`) → the **bare** `Self::set` (`raw.rs:37`), never
  `set_with_policy` (`raw.rs:98`). That write is untracked — no delta row, no audit row, nothing for
  `admits()` to have decided. So on this one key there are two independent ways of not checking: an
  exclusion list that omits the name, and a write path that never consults the list. Pinned by
  `8d9253c7e`.

- **The prefix half of the rule lives in `raw.rs`, where the `keys.rs` ratchet cannot see it.**
  `is_manager_owned_key` is defined at `raw.rs:781`, outside the identity functions, while the
  membership-shape test named above only polices `keys.rs`. A future allow-list that grows a prefix
  therefore shrinks the admitted set with every `keys.rs` pin still green — the drift direction nothing
  currently catches, and the reason `is_non_exportable_setting_key(key) || is_manager_owned_key(key)`
  reads as two predicates from two files rather than one rule.

**Pinned state, so this section reads as open work and not as a decision already implemented:** three
redirect hazard pins at `8d9253c7e` (`platform/sync/src/daemon_tests.rs` — status-blindness, no TLS floor,
no shape check) and one ingest hazard pin at `29f8f2634` (`platform/sync/src/queue_tests.rs` — the open
namespace). **All four are to be INVERTED, not deleted, when a guard lands.** An ADR that only describes
the guard is how next month reads this as done.

Nothing above is verified end to end; every claim traces to a named file or one of the six commits.
