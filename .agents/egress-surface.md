# The true settings EGRESS surface, measured 13-09-26 at HEAD e3e5fcf54

Read-only enumeration: git grep over HEAD plus the five command signatures. No
cargo. No writes outside this file and platform/sync/src/queue_tests.rs.

## Headline

The traced twelve is A CENSUS OF WHAT SOMEONE THOUGHT TO TRACE. It is nearly right
for one narrow question - which names the UI enqueues today - and it is the wrong
number for the question an allow-list has to answer, which is what a CALLER can
enqueue. Those are different numbers:

| Question | Size |
|---|---|
| Names a UI screen enqueues today, and that survive the gate | 12 (exactly the traced set) |
| Names the UI tries to enqueue today | 14 = 12 + smtp_config + sync.auth_token |
| Names a caller can enqueue through the five doors | UNBOUNDED - any string |
| Practical ceiling if you enumerate instead of trace | ~60-100 band, so forty, not four hundred |

The two names the twelve is missing are missing BECAUSE THEY ARE ALREADY REFUSED,
both on keys::SECRET_KEY_DENY_LIST, so the egress gate drops them before the queue.
The method was sound; the frame was the bug. A trace of the admitted set, at chosen
call sites, read back as a census of the reachable set.

## The doors (five, and only five)

Every settings.update item on the wire comes from
Store::enqueue_settings_update_superseding (crates/oz-core/src/db/offline.rs:194),
which has exactly five callers:

| # | Door | Enqueue site | Key parameter type |
|---|---|---|---|
| 1 | desktop set_setting | crates/oz-bridge/src/settings.rs:1230 | String |
| 2 | desktop set_setting_scoped | crates/oz-bridge/src/settings.rs:1297 | String |
| 3 | desktop BATCH set_settings_scoped | crates/oz-bridge/src/settings.rs:1368 | HashMap<String, String> |
| 4 | tablet set_setting | apps/tablet-client/src/commands/settings.rs:570 | String |
| 5 | tablet set_setting_scoped | apps/tablet-client/src/commands/settings.rs:904 | String |

None of the five enumerates, validates or restricts a key. THE ONLY BOUND ON WHAT
CAN BE QUEUED IS THE PREDICATE IngestPolicy::RemoteSync.admits - today: the
credential deny list, the device-identity list and the local_api.* / lan_server.*
prefixes. So the answer to the question asked is YES: those are the only bound, and
because they bound by exclusion, everything not thought of is admitted.

ui/src/api/settings.ts hands all three forms to the renderer (setSetting:229,
setSettingScoped:239, setSettingsScoped:275), so any buggy or compromised renderer
is one call away from any string it can type.

## Today's UI literals, enumerated by hand and not by regex

git grep -n for setSetting / setSettingScoped / setSettingsScoped in ui/src, tests
excluded, returns 8 call sites. They expand to 14 distinct names:

| Name | Site | Replicates today |
|---|---|---|
| ui.locale | ui/src/features/settings/sections/GeneralSection.tsx:50 | yes (traced) |
| exit_survey.last_response | ui/src/components/ExitSurveyModal.tsx:52-54 | yes (traced) |
| updater.previous_version | ui/src/frontend/shell/UpdateBanner.tsx:13, written at :188 | yes (traced) |
| updater.last_backup_path | ui/src/frontend/shell/UpdateBanner.tsx:16, written at :189 | yes (traced) |
| inventory.low_stock_threshold | workspace-cards/WorkspaceInventorySettings.tsx:98 | yes (traced) |
| inventory.deduction_prefer_warehouse | workspace-cards/WorkspaceInventorySettings.tsx:99 | yes (traced) |
| kds.sound_enabled | workspace-cards/WorkspaceKdsSettings.tsx:137 | yes (traced) |
| kds.yellow_threshold_min | workspace-cards/WorkspaceKdsSettings.tsx:138 | yes (traced) |
| kds.red_threshold_min | workspace-cards/WorkspaceKdsSettings.tsx:139 | yes (traced) |
| kds.auto_acknowledge | workspace-cards/WorkspaceKdsSettings.tsx:140 | yes (traced) |
| kds.density | workspace-cards/WorkspaceKdsSettings.tsx:141 | yes (traced) |
| restaurant.course_firing | workspace-cards/WorkspaceRestaurantPosSettings.tsx:114 | yes (traced) |
| smtp_config | ui/src/features/settings/EmailReportSettings.tsx:163 | NO - denied at the door |
| sync.auth_token | ui/src/features/settings/SettingsPage.tsx:479 | NO - denied at the door |

Note UpdateBanner:211: it calls setSetting(key, value, system_updater) where key is
A PARAMETER, not a literal. The two updater names happen to be the only arguments
any current caller passes it, which is precisely how a traced set and a reachable
set come apart.

## Two findings bigger than the twelve

1. THE TYPED DTO DOORS DO NOT REPLICATE AT ALL. set_receipt_settings,
   set_store_settings, set_hardware_settings, set_credit_settings,
   set_user_preferences and complete_setup are none of them among the five enqueue
   callers. The store name, receipt footer, printer and currency a manager edits on
   the Settings page never reach a peer, while a raw set_setting(store.name, ...) -
   reachable from the renderer, and used by crates/oz-bridge/src/settings_tests.rs
   as its fixture for an ordinary key - does. So a name replicates or not according
   to which door its screen happened to use, not according to any declared intent.
   This has a direct bearing on the allow-list: the twelve is small partly because
   most of settings is already off the wire by accident. Fixing the accident moves
   the number, so an allow-list written today against the twelve would be stale the
   day someone makes the DTO doors replicate.
2. THE CREDENTIAL MATCH IS SUFFIX-BLIND, so the admitted set is already larger than
   the literal set. smtp_config:tenant-a - the scoped form crates/oz-api/src/pg.rs
   writes through scoped_setting_key, and a KNOWN BLIND SPOT with a recorded owner,
   documented at platform/core/src/settings/keys.rs:354-363 - resolves to no
   credential, so RemoteSync ADMITS it in both directions while bare smtp_config is
   refused. Same secret, one colon away from the guard. The interim hazard set of
   six does not reach this, and neither would the allow-list: only a suffix-aware
   credential match does.

## Forty or four hundred

Pick a definition, then count once:

| Definition | Count | Command |
|---|---|---|
| Key constants declared in keys.rs | 76 | git grep -c '^pub const' HEAD -- platform/core/src/settings/keys.rs |
| Distinct key literals in Rust settings calls | ~63 | regex over Settings::{set,set_tracked,get,remove} literals in *.rs; approximate, misses composed names |
| Names the renderer writes today | 14 | hand enumeration above |
| Names that MUST replicate | not answerable yet | needs the product decision in finding 1 |

## Two follow-up measurements, taken after the interim fix landed

## CORRECTION, recorded the moment the commit narrowed

Item 1 above says refusing "the six" costs nothing. As committed, the interim
refuses FIVE of them and leaves SYNC_ENABLED open, and the reason is a fence
collision, not a judgement: platform/core/src/settings/raw_tests.rs:734-739 pins
the folded spelling of sync_enabled as an ordinary key that BOTH untrusted lanes
must admit, and that file is outside this change's three-file fence. Refusing it
measured exactly one red (cargo test -p platform-core --lib: 371 passed, 1 failed,
raw_tests.rs:736); dropping it measured 372 passed, 0 failed. So:

| Name | Refused by this commit | Cost of refusing |
|---|---|---|
| sync_server_url | yes | none - never a queue producer, never written by the renderer |
| pg_sync.host / .user / .dbname | yes | none - same |
| redis.cache_ttl | yes | none - same |
| sync_enabled | NO, still open | would need one leg moved in raw_tests.rs |

For the allow-list question this changes nothing: the reachable set is still
unbounded and the ceiling is still ~100 names, not twelve.

1. NOT ONE of the six hazard names appears anywhere under ui/src, tests included
   (git grep -c for sync_enabled, pg_sync.host, pg_sync.user, pg_sync.dbname,
   redis.cache_ttl, sync_server_url -> zero hits each). The renderer never writes
   them, so refusing them costs nothing on either door. That is what makes the
   interim safe even though admits() is shared by ingest and egress: the six names
   are unreachable from the UI on both sides, while the sync target itself is
   written only by the four Rust sites named on the list's doc comment.
2. The UI's dotted-literal vocabulary is bigger than the twelve and bigger than
   what any trace will find. 60 distinct dotted string literals live in ui/src
   outside tests; filtering out the event, permission and module names in that set
   leaves roughly thirty that look like settings keys, including names no screen
   writes through a queue door today (store.name, store.address, store.branch,
   store.currency, currency.default, receipt.footer, brand.*, prefs.cardsize,
   prefs.fontsize, stripe.api_key) and one near-miss double spelling of a hazard
   name, 'sync.enabled' against the stored 'sync_enabled'. Against that, keys.rs
   declares 74 distinct key VALUES and the Rust side uses ~63 literals. Take the
   union as the working ceiling for a real allow-list: closer to a hundred names
   than to twelve, and the twelve is a subset of one screen family.
3. A shape note for whoever picks up the allow-list: apps/tablet-client/src/
   commands/registration_gate_tests.rs::denied_setting_names reads keys.rs AS TEXT
   (include-str style: it opens the file by relative path, finds the two
   declarations by the string "pub const SECRET_KEY_DENY_LIST" /
   "pub const NON_EXPORTABLE_DEVICE_KEYS", cuts at the first "];" and splits on
   commas), and asserts it resolved at least fifteen names. It is therefore
   position-sensitive to anything that moves those two declarations or their
   terminators - a third list declared BETWEEN them, or a reflow that puts the
   device list on one line, changes what that harness counts. Measured after this
   change: cargo test -p kasirmu-tablet registration is green (7 passed), because
   the new list sits BELOW both and touches neither region.

An honest allow-list is therefore in the 60-100 band, built by walking keys.rs and
the batch-door names and deciding family by family - not by tracing call sites.
The twelve is not its raw material: it is what one screen inventory happens to send,
it already missed two names, and both of those were missed for a reason the method
cannot see (they were refused before the trace).
