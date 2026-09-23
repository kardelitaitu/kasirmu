# ADR #51 From the Other Side — the Admitted Set and the Redirect's Second Writer

<!-- 2026-09-13 · DSH · short record · companion to docs/decisions/2026-09-11-adr51-sealed-settings-ingest-policy.md,
     which states the policy; this page states what the policy leaves open, because an ADR written in the
     voice of its own decision is the wrong place to keep a count of what it does not cover. -->

> ### PIN OF A KNOWN HAZARD, NOT AN ENDORSEMENT
> Four tests named below are GREEN at this HEAD and their greenness is the finding. Each is to be
> INVERTED, not deleted, when its guard lands.

## The number that has to travel with the policy

`IngestPolicy::RemoteSync` is an exclusion list over an open namespace. Measured, breakdown and query in
[`2026-09-12-sync-settings-ingest-and-redirect-census.md`](./2026-09-12-sync-settings-ingest-and-redirect-census.md):
**75 declared keys, 21 refused, 54 admitted** — from a channel that authenticates nobody. A paragraph that
says "sync ingest is now policy-gated" without that ratio describes a control that refuses 28% of the
namespace it governs.

## Three blind sides, each with the query that shows it

1. **Whole-name fold, so scoped spellings pass.** `normalised_candidate` (`platform/core/src/settings/keys.rs:404`)
   folds the entire name; `credential_base` (`:439`) and `is_secret_setting_key` (`:508`) compare by
   equality. `smtp_config:tenant-a` — what `crates/oz-api/src/pg.rs` writes via `scoped_setting_key` —
   resolves to `None` while `smtp_config` resolves to a refusal. Both suffix-blindness and file shape are
   pinned: `decision_pin_credential_base_is_suffix_blind`, `keys_tests.rs:316`; and
   `decision_pin_membership_tests_live_only_in_the_identity_functions`, `keys_tests.rs:451`.
2. **A second writer for the same key.** ADR #11's redirect persists `sync_server_url` through
   `persist_migration_url` (`platform/sync/src/daemon_tick.rs:77-87`) → `Settings::set_sync_server_url`
   (`platform/core/src/settings/typed.rs:327`) → the bare `Self::set`
   (`platform/core/src/settings/raw.rs:37`), not `set_with_policy` (`raw.rs:98`). Untracked: no delta row,
   no audit row. Pinned three ways at `8d9253c7e` — obeyed on a 500 (status-blindness), obeyed for an
   `http://` host (no TLS floor), and obeyed for `/not-a-server` (no shape check).
3. **The ratchet has a prefix-shaped blind side.** `is_manager_owned_key` is defined in
   `raw.rs:781`, outside the identity files the `keys.rs` shape test polices, so a future list that grows a
   prefix shrinks the admitted set while every `keys.rs` pin stays green.

## What a reader must not conclude

These are not four bugs to fix in order. (1) and (3) are decisions with recorded owners — the
credential-suffix wave and the split between identity functions and the prefix rule. (2) is the one with no
owner yet: a red test set exists for it, and `421` appears nowhere in
`platform/sync/src/transport.rs` (the one match is the `ISO-4217` comment at `:86`), while the only
emitter, `apps/cloud-server/src/redirect.rs`, sends 421 and nothing else — so a client-side gate is free
of collateral damage and still has not been chosen.

## Method note, because one report of mine got this wrong

The status of the ingest pin was first reported as "since inverted by another session". That was inference
where a query was available and it was false: `git log -- platform/sync/src/queue_tests.rs` puts the last
commit at `29f8f2634`, and `git show HEAD:platform/sync/src/queue_tests.rs | grep -c 'RED UNTIL THE HAZARD
SET LANDS'` → **0** while the same grep on the WORKING TREE → **5**. The inversion is another session's
uncommitted edit. Reading a dirty file and attributing its content to history produces a confident, wrong,
load-bearing sentence; if a claim is about what the repo decided, query HEAD, not the checkout.
