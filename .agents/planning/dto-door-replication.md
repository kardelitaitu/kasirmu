# Which settings names are supposed to cross the wire — the door-by-door census

**Provenance: the WORKING TREE, read off disk, 13-09-26 ~06:00.** Not HEAD. At the time of the
last two checks `git status` and `git show HEAD:path` were failing on this checkout
(`fatal: bad object HEAD`, three commits reported unreachable by the owner), so **every line
number below was re-verified with `sed -n '<line>p' <file>` and plain `grep -n` against the files
as they sit on disk**, and no claim here rests on a git object. Where the working tree differs
from HEAD nobody can currently say; a reader with a readable HEAD should re-run the same
`sed`/grep pairs before quoting any row. Companion to `.agents/egress-surface.md` (which answers
*what a caller can enqueue* — unbounded); this file answers *what each entry point does today, and
whether anyone ever wrote down that it is meant to*.

Method: read-only. No cargo, no git writes, no edits outside `.agents`. Consumer side included
(Table 3).

## Legend for the last column — the whole point of the table

* **deliberate** — a comment, ADR, doc or test in-tree states that this door's writes stay local.
* **documented-elsewhere** — the fact is written down and citable, but not as an intent to
  replicate or not replicate.
* **silent** — nothing anywhere says it. **An absence of a comment is silent, not deliberate.**

## Table 1 — the typed DTO doors (18 handlers)

| # | Entry point (shell) | Handler (working-tree file:line) | Keys written (write site) | Calls the enqueue door? | Intent |
|---|---|---|---|---|---|
| 1 | tablet `set_receipt_settings` | apps/mobile-tauri/src/commands/settings.rs:98 | 11: receipt.show_currency, receipt.decimal_separator, receipt.show_tax, receipt.footer, receipt.paper_width, receipt.show_table_number, receipt.margin_top/bottom/left/right, tax.rounding_mode — :116-126 | NO | **silent** |
| 2 | tablet `set_receipt_settings_scoped` | :678 | same twin | NO | silent |
| 3 | tablet `set_store_settings` | :178 | 6: store.name (:196), store.address (:197), store.tax_id (:198), currency.default (:199), store.branch (:200), store.logo (:201) | NO | silent |
| 4 | tablet `set_store_settings_scoped` | :708 | same twin | NO | silent |
| 5 | tablet `set_credit_settings` | :237 | 3: credit.enabled (:246), credit.reminder_interval (:247), credit.max_limit (:248) | NO | silent |
| 6 | tablet `set_credit_settings_scoped` | :742 | same twin (:755-757) | NO | silent |
| 7 | tablet `set_hardware_settings` | :357 | 5 SETTINGS keys: printer.connection (:366), printer.device_path (:367), printer.paper_size (:368), scanner.device_id (:369), scanner.input_mode (:370) | NO | silent |
| 8 | tablet `set_hardware_settings_scoped` | :841 | the same five (:854-858) | NO | silent |
| 9 | tablet `set_user_preferences` | :398 | caller-supplied pairs — `Vec<UserPrefEntry>` mapped at :404 — written to the per-USER table, not `settings` | NO | silent, and off-lane (Finding C) |
| 10 | tablet `set_user_preferences_scoped` | :437 | same, mapped at :450 | NO | silent, off-lane |
| 11 | desktop `set_receipt_settings_scoped` | apps/desktop-tauri/src/commands/settings.rs:57 → crates/oz-bridge/src/settings.rs:991 `run_set_receipt_settings` | the same 11 (:997-1007) | NO | silent |
| 12 | desktop `set_store_settings_scoped` | :95 → crates/oz-bridge/src/settings.rs:1015 | the same 6 (:1021-1026) | NO | silent |
| 13 | desktop `set_credit_settings_scoped` | :121 → crates/oz-bridge/src/settings.rs:1072 | the same 3 (:1088-1090) | NO | silent |
| 14 | desktop `set_hardware_settings_scoped` | :196 → crates/oz-bridge/src/settings.rs:1128 | **no settings keys at all**: `TerminalProfile` → JSON → `INSERT OR REPLACE INTO hardware_profiles` at :854, in the GLOBAL db — doc at :1125 "The `hardware_profiles` table lives in the global DB (not per-store)" | NO | silent, and structurally off the settings lane (Finding C) |
| 15 | desktop `set_user_preferences_scoped` | :226 → crates/oz-bridge/src/settings.rs:1188 | caller-supplied pairs (:1201) → `UserPreferences::set_batch(&db, &session.user_id, &pairs)` :1202 | NO | silent, off-lane |
| 16 | tablet `complete_setup` | apps/mobile-tauri/src/commands/setup.rs:72 | one composed `feature.*`-style key per feature (:97 `Settings::set(&tx, &key, &value)`), store.preset (:104), store.setup_complete (:107), store.show_setup_wizard (:110) | NO | silent |
| 17 | desktop `complete_setup` | apps/desktop-tauri/src/commands/setup.rs:42 | same shape (bridge/core writers) | NO | silent |
| 18 | cloud-server `set_setting_scoped_pg` | apps/cloud-server/src/email_pg.rs:455 (helper `set_setting_pg` :419) | server-side PG config rows | n/a — the server is the hub, not a peer | documented-elsewhere: the egress policy is scoped to the two shells + the bridge (ADR 51/52 lineage); no peer lane exists here |

**Query behind every NO:**
`grep -rn 'enqueue_settings_update' apps crates platform --include=*.rs | grep -v tests` returns
**15 lines** (44 with test files included), and the only *call sites* of a queue door in them are
**five**: crates/oz-bridge/src/settings.rs:1230, :1297, :1368 and
apps/mobile-tauri/src/commands/settings.rs:570, :904 (the rest are the two funnel definitions at
:632 / :640, their doc comments, and `crates/oz-core/src/db/offline.rs:194` where the queue row is
written). **No typed door appears in that set.** Cross-checked per-file:
`grep -n 'enqueue' apps/desktop-tauri/src/commands/setup.rs apps/mobile-tauri/src/commands/setup.rs` → no hits.

## Table 2 — the raw doors (5), for contrast

| # | Door | file:line | Enqueue site | Key parameter | Intent |
|---|---|---|---|---|---|
| R1 | desktop/bridge `set_setting` | crates/oz-bridge/src/settings.rs:1210 | :1230 | `String` (arbitrary) | replicate-by-default is stated |
| R2 | desktop/bridge `set_setting_scoped` | :1258 | :1297 | `String` | stated |
| R3 | desktop/bridge BATCH `set_settings_scoped` | :1326 | :1368 | `HashMap<String,String>` | stated; the funnel is "the single egress funnel for all three settings-write commands in this module" (:652) |
| R4 | tablet `set_setting` | apps/mobile-tauri/src/commands/settings.rs:549 | :570 → helper :640 → :660 | `String` | stated; tenant hard-coded "default" at :660, doc :637 ("global queue (SYNC-10)") |
| R5 | tablet `set_setting_scoped` | :879 | :904 | `String` | stated |

The deliberateness that exists in-tree is all about **which keys are refused**, never about which
doors are allowed: the egress gate mirrors the ingest gate on purpose
[Fact: crates/oz-bridge/src/settings.rs:655 "Symmetric with the ingest gate in
`platform_sync::queue`"] and the tablet comment names its own coverage as
"Both tablet call sites (global and scoped set_setting) funnel through THIS function"
(:646-648) — **two** call sites, while the ten tablet typed doors sit outside it. That reads as an
unexamined frame, not a policy; there is no row in Table 1 whose value is **deliberate**.

## Table 3 — the consumer side (why "never enqueued" ≠ "enqueued but dropped")

| Surface | file:line | What it does |
|---|---|---|
| Apply entry | platform/sync/src/queue.rs:383 `apply_remote_atomic_full` | the atomic far-end writer |
| Settings arm | :524 `"settings.update" | "settings.change" =>` | deserialises `SettingsUpdatePayload` (struct :176) |
| Far-end gate | :531 `Settings::set_with_policy(tx, &payload.key, &payload.value, IngestPolicy::RemoteSync)` | asks the **same** predicate the egress side asks; refusal skips row + delta and continues |
| Delta + UI signal | :537 `Settings::write_delta`, `settings_change` on the outcome (:203) | non-fatal; the change is still reported |
| Daemon wiring | platform/sync/src/daemon_tick.rs:156 `settings_sink`, :159/:282 `db_clone` | the handle the apply runs on |

**So: no key is enqueued today and refused at the far end by policy drift** — the two halves agree
by construction. The one admitted/refused disagreement in-tree is the suffix-blind credential match
(`smtp_config:tenant-a` admitted both ways, bare `smtp_config` refused)
[Fact: platform/core/src/settings/keys.rs:433-441 — "As of this commit the resolution is
deliberately SUFFIX-BLIND", pinned by
`decision_pin_credential_base_is_suffix_blind`; the three RemoteSync refusal lists beside it are
`SECRET_KEY_DENY_LIST` :265, `NON_EXPORTABLE_DEVICE_KEYS` :295, `PEER_NAMED_HAZARD_KEYS` :353],
already named in the sibling file; it is a naming bug, not a door bug, and it is **not** folded
into Table 1.

## Summary counts

* Named keys writable through a typed door that does **not** replicate: **25**
  (11 receipt + 6 store + 3 credit + 5 printer/scanner), **plus** `store.preset`,
  `store.setup_complete`, `store.show_setup_wizard` and one composed feature key per enabled
  feature from `complete_setup` → **28 named minimum, unbounded above** (setup.rs:97 composes).
* Named keys that replicate today: **no finite number is honest**, because
  `IngestPolicy::RemoteSync` decides by EXCLUSION over an OPEN namespace
  [Fact: platform/core/src/settings/raw.rs:693-697 — one `admits` arm, three clauses] and all five
  raw doors take an arbitrary string. The measurable statement: **14** names the renderer writes
  through them today (12 admitted, 2 refused at the door) [Fact: .agents/egress-surface.md, hand
  enumeration], against **77** `pub const` key declarations
  [`grep -c '^pub const' platform/core/src/settings/keys.rs` → 77; the sibling file said 76, the
  tree moved under it].
* Overlap by **traffic** today: **zero** of the 25 typed keys is also written through a raw door by
  any screen. Overlap by **capability**: **all 25**, and the working tree's own tests demonstrate
  the two most merchant-critical ones: `store.name` and `receipt.footer` are written via the raw
  batch door and asserted **queued** at crates/oz-bridge/src/settings_tests.rs:1141-1142 → :1173,
  :1177; `store.name` + `currency.default` are reused as admitted fixtures at :1204; a single-key
  raw write of `store.name` at :438.

## The names a merchant would call replication a requirement

| Name | Written by a typed door (no replication) | Replicates if written through a raw door |
|---|---|---|
| `store.name` | tablet :196 / bridge :1021 | **yes — test-proven**, settings_tests.rs:1141, :1173 |
| `currency.default` | tablet :199 / bridge :1024 | **yes — admitted fixture**, :1204 |
| `store.tax_id` | tablet :198 / bridge :1023 | capability yes, traffic no |
| `receipt.footer` | tablet :119 / bridge :1000 | **yes — test-proven**, :1142, :1177 |
| `store.address` / `store.branch` / `receipt.paper_width` | tablet :197, :200 / :120 | capability yes |

A tenant that renames its store, or changes currency, on the Settings page and then syncs gets a
peer still showing the old value. The same value saved through `set_setting` — including by a
renderer bug or a future bulk save — does reach the peer. Both halves are reachable today, and the
inconsistency is not hypothetical: it is encoded in the test suite cited above.

## Four findings, kept separate because they are not the same bug

**A — never enqueued.** 18 typed handlers, ≥25 named keys, zero queue calls. Cause: no call site.
Fix lives in the doors.

**B — enqueued but never applied.** **None found**, and the reason is structural: the apply arm
asks the same sealed predicate as the egress gate (Table 3). This is its own heading rather than a
Table-1 row precisely so nobody reads "not in the table" as "not a problem".

**C — different storage lane, so a `settings.*` allow-list cannot see it at all.** Three doors do
not write the `settings` table: `set_user_preferences*` writes per-user rows
(bridge :1202; tablet :404/:450), and the desktop/bridge `set_hardware_settings_scoped` upserts
the global `hardware_profiles` table (:854, doc :1125). **The tablet twin of that same DTO writes
five ordinary `printer.*`/`scanner.*` settings keys instead (:366-370) — one DTO, two
incompatible homes in two shells**, and only the tablet form is even expressible as a
`settings.update` item. "Should hardware settings replicate" cannot be answered per-key until
that is resolved.

**D — the global/store DB seam [Inference, unresolved].** The tablet raw door enqueues onto the
GLOBAL queue with tenant hard-coded "default" (:660), and platform-core's own doc describes the
far-end write as "a bare INSERT into the GLOBAL identity database (queue.rs:395 ->
daemon_tick.rs:292)" [Fact: platform/core/src/settings/keys.rs:306]. If that is right, even the raw
path lands `store.name` in the peer's GLOBAL db while every typed store door writes it into the
per-STORE db (`open_store(&session.store_id)`). **[Inference: I did not confirm which handle
`db_clone` carries at daemon_tick.rs:282-296, and I stopped rather than guess — it changes Finding
A's severity by a lot: if the seam is real, arming the typed doors would move store-scoped values
into a global table on the far end.]** Measure it before arming anything.

## The four rows with the only non-silent intent value

Direct writers of `sync_server_url`, none of which calls a queue door, and the doc that says so
[Fact: platform/core/src/settings/keys.rs:333 "The four writers of `sync_server_url`"]:
crates/oz-bridge/src/sync.rs:71 · apps/mobile-tauri/src/commands/sync.rs:87 ·
apps/desktop-tauri/src/sync_bootstrap.rs:83 · platform/sync/src/daemon_tick.rs:83 — all four
verified on disk as `Settings::set_sync_server_url(...)`. **documented-elsewhere-with-a-cite**:
the note exists to prove refusing that key "drops no working traffic", not to declare the key
non-replicating — which is why its value is not **deliberate**.

## What the owner still has to decide (this file cannot answer it)

1. Are the 25 typed keys tenant-wide facts (then arm the doors, or route those screens through the
   batch door R3) or per-install preferences (then write that down and the column flips from silent
   to deliberate)?
2. Is `feature.*` from `complete_setup` a replication question or a provisioning one?
3. Does the per-user `UserPreferences` lane have its own sync item, or is it permanently local by
   architecture? Not investigated; it is outside the settings lane entirely.
4. Which DB is authoritative on the far end for a store-scoped key (Finding D).

## Coverage edge — what this census did NOT reach

* "Keys it writes" is the key set, not the **conditional** set: what a partially filled DTO writes
  (serde defaults) was not traced per field.
* Only the four `sync_server_url` writers were checked for direct writes outside the settings
  files; a whole-tree census of `Settings::set*` / `set_tracked` / raw `INSERT INTO settings`
  call sites would likely add rows and was not attempted in the time box.
* No UI screen was traced; the 14/12/2 numbers are quoted from `.agents/egress-surface.md`, not
  re-derived (only the 77-const count was re-measured here, and it has already moved by one).
* Finding D is unresolved by design of the time box, flagged as an inference.
* The provenance caveat at the top (working tree, HEAD unreadable) applies to **every** row.

**Row count: 33 data rows — Table 1 = 18, Table 2 = 5, Table 3 = 5 (28 entry-point rows total),
merchant-critical table = 5.** Plus 4 further entry points named inline with cites (the
`sync_server_url` writers). 0 rows left unstarted. Counts re-measured by parsing this file's own
rows, not by hand.
