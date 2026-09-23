# Sync settings ingest admits and the redirect that carries them

Date: 2026-09-12 · Type: census / audit · Behaviour changed: **none**

Reproducible with `python scripts/census-sync-ingest-admits.py` (read-only; exits
non-zero if any self-test fails). The policy contract it measures against is
`edaaf7f9c`: `platform/core/src/settings/keys.rs` answers identity in exactly two
functions, `credential_base` and `device_base`, and a ratchet test
(`decision_pin_membership_tests_live_only_in_the_identity_functions`) forbids
naming either list anywhere else in that file.

## 1. What the ingest lane admits

`IngestPolicy::PortablePackage` and `IngestPolicy::RemoteSync` share one rule
(`platform/core/src/settings/raw.rs:660`-`:670`): refuse if
`is_non_exportable_setting_key` or `is_manager_owned_key`. `TrustedLocal` admits
everything, which is correct for the lane that owns the database.

```
TOTALS  declared=75  admitted=54  refused=21
        refused: credential list   17
        refused: device list        3
        refused: manager prefix     1
        SECRET_KEY_DENY_LIST=17 resolved  NON_EXPORTABLE_DEVICE_KEYS=3 resolved
SELF-TEST ok  floor(70)=75  deny-list(10)=17  device-list=3  known-verdicts=6/6
```

Admitted, by family: receipt 10, store 9, pg_sync 6, currency 5, media 4, brand 3,
credit 3, printer 3, rate_sync 3, scanner 2, edc 1, redis 1, tax 1, ui 1, and
sync_server_url 1 / sync_enabled 1 as their own one-member families.

The four that make this urgent, each admitted while its sibling in the same
family is refused:

```
sync_server_url  admitted      sync_enabled  admitted
pg_sync.host     admitted      redis.cache_ttl  admitted
family pg_sync   refused: pg_sync.password   admitted: dbname, enabled, host, port, require_tls, user
family redis     refused: redis.url          admitted: cache_ttl
```

`sync_server_url` is the whole point: the lane that refuses a password will
accept the address the password is sent to.

Two counts in the briefing were wrong, and are corrected here rather than
repeated: the deny list has **17** entries, not 18, and the admitted figure is
**54**, not 55 - the 55 came from `local_api.secret`, which is on the credential
list, so the prefix rule refuses only `lan_server.bind` (1, not 3). The sync
names are also **flat** (`sync_server_url`, `sync_enabled`, `sync_api_key`), not
`sync.server_url`; a dotted probe would pass vacuously, which is why the
self-test uses declared spellings only.

## 2. What the redirect lane does with the same value

An accepted `sync_server_url` is not merely stored; the daemon follows it:

- Obeyed on **any non-2xx** response: `platform/sync/src/transport.rs:355` opens
  `if !resp.status().is_success()` and at `:374`-`:376` any body that parses via
  `parse_server_migrated` becomes `SyncError::ServerMigrated { new_url }`.
- **No 421 check.** The named query for that zero is
  `git grep -n "421" -- platform/sync crates/oz-core/src`; every hit is an
  ISO-4217 currency comment.
- **`new_url` is never validated** - no scheme allow-list, no host comparison,
  no localhost check.
- Persisted through the **bare** setter: `persist_migration_url`
  (`platform/sync/src/daemon_tick.rs:77`-`:86`) calls
  `Settings::set_sync_server_url(store.conn(), &url)` directly, with `let _ =` on
  the join, so the write is **untracked**: no sync delta, no audit row, and a
  failure is invisible.
- The **next tick** ships the bearer key and the whole pending offline batch to
  that host, and the escalation at `platform/sync/src/daemon.rs:131`
  (`refresh_persisted_api_key`) POSTs `terminal_id` and `terminal_secret` to it -
  values the ingest lane cannot even *name*, because `sync_terminal_secret` is on
  the credential list and `sync_terminal_id` is on the device list.

## 3. The blind spot, which is a decision and not an oversight

Identity returns the **base alone**, so resolution is suffix-blind by
construction (`edaaf7f9c`). A scoped credential spelling therefore sails through
the lane:

```
smtp_config:tenant-a   admitted   is_secret_setting_key=False
sync_api_key:tenant-a  admitted   is_secret_setting_key=False
stripe.api_key:0       admitted   is_secret_setting_key=False
```

`scoped_setting_key` (`crates/oz-api/src/pg.rs:163`) emits `{base}:{tenant}`, so
a real install can hold a credential row the equality does not recognise.
Pinned as `decision_pin_credential_base_is_suffix_blind`, to be **inverted, not
deleted**, when the suffix arm lands.

## 4. Closing options

1. **Authored exact-name allow-list** - the honest shape: the ~30 names that may
   arrive over sync, each with an owner. Not written tonight.
2. **Prefix list** - rejected. A store prefix (`sync_`, `pg_sync.`) re-opens an
   open sub-namespace by exactly the argument that makes today's list
   suffix-blind: prefix-matching over names that can be extended is the same
   class of hole, in the permissive direction.
3. **Per-item provenance** - rejected *for tonight*, not on the merits of the
   idea: a tag inside an unsigned payload is attacker-settable, so it is
   security-empty, and a MAC under `sync_terminal_secret` authenticates the
   tenant, not the sender, so closing a peer needs per-device keypairs that do
   not exist yet.

## 5. Decisions needing an owner in the morning

- Is `sync_server_url` meant to be sync-replicated at all? If yes, the redirect
  needs validating and the write needs to go through the tracked funnel.
- Who authors the allow-list, and against which of the three lanes?
- Does the suffix arm land, and if so is `is_secret_setting_key` the only caller
  allowed to change verdict as a result?
- `platform/sync` has redirect pins landing right now (separate session); this
  record deliberately changed nothing there.

This is **not** a half-finished plan that disclaims itself: ADR #51 already
states that this ingest policy is not a defence against an attacker who can
inject into the sync stream - it is a guard against accident and drift, which is
why option 1 is authored names rather than another deny-list heuristic.

Housekeeping note, because nothing enforces it: **`docs/records/README.md` is
generated and nothing regenerates it on a schedule.** This record is invisible to
the index unless `node scripts/generate-records-index.mjs` is run after the file
is added; `e3e5fcf54` made the index scan `docs/records`, and the last record was
missed for exactly this reason. Committed here as a second commit.
