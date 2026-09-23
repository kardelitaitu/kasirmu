# Owner Decisions - D1 to D11

Companion to manager-codebase-review.md and manager-codebase-review-checklist.md. Each decision was analysed by a worker that traced the code before forming a view; every option below is priced against facts cited as file:line, and the recommendation is the manager's, not the analyst's. Three of these analyses **changed the review's own advice**, and those corrections are recorded at the end.

**How to use this with the checklist.** A decision here unblocks a checklist item; the checklist tells you when it is done. D1 and D2 gate C1 and C7. D3 gates C26. D4 gates C9. D5 gates C8 (and decides whether C8 is a feature or a runbook). D6 gates C29. D7 gates C2. D8 gates C27. **D9 gates the rest of C32** - added during implementation, after three workers refused to stamp a tenant that does not exist on the desktop path. **D10 gates C36** - the locations quota axis (and the tier limit it publishes) is provably unenforceable. **D11 re-scopes C10b** - the briefed `CHECK (qty >= 0)` contradicts a shipped feature, so the item is now the CONDITIONAL guard plus the two dead comments, and the unconditional constraint is the artifact for the other branch.

| # | Decision | Recommendation | Effort | Urgency |
|---|---|---|---|---|
| D1 | At-rest key scheme | Per-install keychain key **with re-encrypt on write**, preconditioned on a branch-tolerant reader | M (blocked on the reader) | High - exposure is live wherever the key is unset, which is everywhere |
| D2 | Tenant isolation | Ship the cutover **and** the oz_app role switch together; FORCE as the documented follow-up; add a boot assertion | S-M, ops change | High - a shipped profile connects as superuser |
| D3 | Architecture rule vs tier order | Close the currency edge + a named rule for the 7 type shims now; move the types into foundation later | S now, L later | Deadline: **2026-11-07** |
| D4 | qris-core licence | Make it **proprietary** (publish = false, clarify entry, fix README) | XS | Medium - irreversible the moment anyone publishes |
| D5 | In-app restore | **Safe-mode restore on boot**, gated and integrity-checked; keep the CLI; do not auto-restore | M | High - the tablet operator has no shell at all |
| D6 | LAN KDS | **Retire kasirmu-lan** from the shipped path; keep the in-app KDS board | S (workspace exclude) | Medium |
| D7 | Plugin trust | **Signed/checksummed manifest + operator grant + gated hot-reload**, and delete the dead capability flags | M | High - the plug-in load path is unverified today |
| D8 | Deployment shape | **Fix the unified routing** and widen the drift checker; unified is what production runs | S | High - a required gate is red on main right now |
| D11 | `allow_negative_stock` vs the missing CHECK | **Keep the feature and enforce conditionally (A)** - an unconditional `qty >= 0` silently re-enables the guard the flag exists to opt out of, and ADR #17 plus the UI depend on it | M (migration + a `TRIGGER_MAP` PG port) | High - the briefed fix would have broken a shipped, documented, cashier-facing feature |
| D10 | The locations quota axis | **Pin it now (C), make it real (A) when the sync vocabulary is next touched** - the tier limit is currently unenforceable by construction; choose A or B on whether `max_locations` is a sold term or an aspiration | XS for the pin, M for A | High - a published tier limit whose enforcement number is a constant zero |
| D9 | Desktop tenancy | **The desktop store DB is single-tenant by construction; the cloud applies the tenant at ingest** - do not thread a tenant into the terminal writers | S-M at the ingest boundary | High - the cloud quota detector scores a paying tenant 0 locations and the popularity roll-up reads nothing, both silently |

---

## D1 - Should the at-rest key scheme change, and is OZ_MASTER_KEY set anywhere?

**Deciding facts.** Nothing in the repository sets or documents OZ_MASTER_KEY: a tree-wide search finds 27 mentions and **zero** in ops/, scripts/, .github/, any compose or Dockerfile, or .env.example - the only prose is a changelog line and a runbook passage written in the hypothetical. Detection exists only on the cloud server, which warns at boot and publishes portable_derivation_uses_master_key on /health; **neither Tauri shell can report its own state**, because master_key_derivation_active() has no callers outside the server.

There is **no re-encryption path and no rotation mechanism**, and the read path is branch-intolerant by pinned design: a row written under the static derivation is refused by the master branch and vice versa, and the two are indistinguishable objects - same length, same alphabet, no header (crates/kasirmu-core/tests/credential_storage_form.rs:1042-1103). The legacy parameter is not a decrypt fallback; it selects the other KDF at call time. Only the two SMTP decryptors have a fallback, and it is a shape-gated **plaintext passthrough**, not a second key. key_rotation_status reports an age and derives no ciphertext.

**The consequence is the whole decision:** setting the key on a live install silently bricks five credential families and both PII columns, with recovery only by re-entering each credential - and two of the five have no production setter at all (set_rate_sync_api_key, set_lan_server_psk), so they cannot be re-entered through the product.

Blast radius: 7 write sites across 6 storage locations - settings.sync_api_key, sync_terminal_secret, pg_sync.password, rate_sync.api_key, lan_server.psk, the SMTP password inside the smtp_config JSON, and users.national_id plus monthly_take_home_minor - plus copies in the setting_updated delta ledger and in every .db and .backup.db snapshot.

| Option | Pros | Cons |
|---|---|---|
| **A. Leave it unset** | No work; matches every shipped configuration today | Every supposedly encrypted credential and both PII columns stay derivable from the repository. The status quo is the exposure |
| **B. Set it deployment-wide now** | One environment variable; /health proves it took | **Bricks 7 locations**, and two of the five credential families have no product setter to restore them |
| **C. Per-install key + a rewrap migration** | Closes the exposure with no operator action | **Not possible today**: the pinned test proves a rewrap cannot tell which branch wrote a row, so a half-finished rewrap is unrecoverable |
| **D. Per-install generated key in the OS keychain, branch-tolerant reader, re-encrypt on write, key export/import** | Closes the exposure on every install; the five setters already re-encrypt on save; finally makes the keychain entry the key the README claims it is | Breaks whole-file .db credential portability; .ozpkg PII needs an export/import lane or an explicit exclusion |

**What would change the answer:** whether PII must survive a cross-machine .ozpkg import (users is one of the package's table groups); whether whole-file .db credential portability is a requirement or an accident; and what any live cloud instance reports on /health.

**Recommendation: D.** It is the only option that closes the exposure without a credential re-entry campaign. **The precondition is the whole cost:** make the reader branch-tolerant - try the master derivation, then the legacy one - *before* any key is generated, or the first install to receive a key bricks itself exactly as option B does. Per-install keys are safe for the supported sync and export lanes, because all five credential keys sit on SECRET_KEY_DENY_LIST and never cross a machine boundary that way.

---

## D2 - Has any PostgreSQL deployment run the RLS cutover, and what should happen now?

**Deciding facts.** The shipped PostgreSQL profile connects as a **superuser**, which bypasses row-level security even with FORCE enabled - a fact the repository's own test asserts. docker-compose.pg.yml derives DATABASE_URL from the same variable it sets POSTGRES_USER to, and in the official postgres image that user is the superuser and database owner. Northflank's DATABASE_URL is operator-supplied with no default. **So there is no shipped configuration in which running the cutover alone produces enforcement** - against that profile it is theatre.

The script itself is better than the review first described: 206 lines, it creates oz_app, grants on 30 tables (not 19), creates **two** BYPASSRLS roles - one for pre-tenant Stripe/Square webhook resolution, one for the email sender, terminal-credential verification and the hourly prune - forces only the 22-table list, is idempotent, and ships a rollback recipe. Its own comments disagree with each other about the table count (22 in the array, 'all 19 tables', 'expect 21 rows', and 'the 15 tenant tables' in the runbook).

What breaks if FORCE lands while still connecting as owner depends entirely on the role: a **superuser owner** sees nothing change at all; a **non-superuser owner** sees RLS-covered tables return zero rows and reject writes - though settings lookups survive (settings is not in the FORCE list), migrations are DDL and unaffected, the licence server runs its own SQLite, /status reads 0 by design, and the three pre-tenant consumers survive only if the code actually switches role (it does query pg_auth_members for membership, which is consistent with that pattern but is not proof). The operator detail that makes it survivable is documented: point DATABASE_URL at oz_app **and** set OZ_APPLY_SCHEMA=0, or startup re-applies the schema and dies on a permission error.

CI proves the **mechanism** only: a test runs the real script verbatim against a throwaway database and shows FORCE blocking a dedicated non-superuser owner - against roles the test invents, not against any shipped configuration. No test asserts the application role is not the owner at runtime.

| Option | Pros | Cons |
|---|---|---|
| **A. Run the cutover now** | One script; proven by a CI test that runs it verbatim | Does **nothing** if the app is the superuser, which is the compose default. Without the role switch it is theatre |
| **B. Ship cutover + role switch as one release, FORCE as a follow-up** | Matches the runbook's own sequencing; each step verifiable | Two deploys, and the window between them is today's state |
| **C. Leave as-is, compensate with query review** | No deploy risk | 49 tenant tables and 74 desktop / 94 mobile ungated IPC commands - review does not scale to a fail-closed guarantee |
| **D. Add a boot-time assertion** | Cheap; turns silent inertness into a visible fact | Detection only |

**What would change the answer:** the actual live connection role - one query answers it - and whether every pre-tenant path performs its role switch.

**Recommendation: B with D folded in.** Ship the cutover and the oz_app switch together, keep FORCE as the follow-up the runbook already prescribes, and add a boot-time rolsuper / relforcerowsecurity assertion in the same release so the next operator learns the state from the system rather than from a document. Do **not** run A alone.

---

## D3 - Architecture rule versus tier order

**Deciding facts.** The checker's RULES table is a closed dict of six ids with no expiry field, and an unknown rule id is rejected outright - so a new rule is a **code change**, not a data change. Every baseline entry must carry a non-empty expiry; there is no 'permanent' spelling. Cargo-rule findings are **package-granular**, keyed on the manifest path, so the seven type-only pub use shims and the one behavioural edge cannot be separated by a rule - they live in the same Cargo.toml. Expiry is evaluated as today > expiry, so the eight entries fail on **2026-11-07**, and three lanes run the checker: pre-push Tier 0, check.sh, and dev-ci static-gates.

Of the eight grandfathered edges, seven are one-line re-exports and one is real: core's db/settings.rs delegates eleven deprecated methods to the currency module's repository. Production already constructs that repository directly in the bridge, the API and both shells, so the wrappers' live callers are almost entirely one integration test.

| Option | Pros | Cons |
|---|---|---|
| **A. Re-tier: named rule for the 7, dated rule for currency** | Names the pattern honestly; the seven stop pretending to be debt on a deadline | Not data-only (new rule id, a schema change for non-expiring entries), and cannot by itself separate the seven from the currency edge. It also makes the exception permanent, which is what a baseline exists to prevent |
| **B. Move the model types into foundation and delete the shims** | The only option that **removes** the edges, and it is what the rule's own hint prescribes | Workspace-wide compile churn; must not drag behaviour down with the types; hard to reverse |
| **C. Close the currency edge at the call sites** | Cheap, real, and removes the only edge with runtime consequence; production already bypasses the wrappers | Leaves the seven, still expiring |
| **D. Freeze: bump the expiries** | None | Converts a deadline into a ritual, and the incentive is to bump again |

**What would change the answer:** if any of the seven shims carried logic, each would need its own closure; if the checker gained per-file cargo matching, option A would stand alone.

**Recommendation: C plus a named rule for the seven, before 2026-11-07; B after.** Do the cheap real fix now (delete the delegation, repoint the residual callers, drop the dependency line), and add one named non-expiring rule so the remaining edges are an accepted pattern rather than debt that expires again. Then, on your own schedule, move the types into foundation, delete the eleven shims, and delete both the rule and its entries. Do not do D.

---

## D4 - Is qris-core meant to be publishable?

**Deciding facts.** qris-core is a genuine, self-contained EMVCo library - TLV parse and render, CRC-16/CCITT, NMID split, a hundred-plus MCC codes, amount and tip maths, static-to-dynamic conversion, optional decode and render, with its own integration test and example. It is the only workspace member with publish enabled, it declares MIT OR Apache-2.0, its repository URL is a placeholder organisation, and the two licence files its README links **do not exist**. It has **zero dependents**, and it is absent from deny.toml's licence clarifications while MIT and Apache-2.0 are already allowlisted - so the one checker that exists passes.

Nothing duplicates it, and nothing needs it: the live QRIS path is entirely Midtrans-mediated (a REST client POSTs a charge and receives a QR string, which the UI renders), **nothing in the repository generates a QRIS payload locally**, the static-QR rail is a stored string never parsed by Rust, and there is no receipt QR. The only plan that wants it is a research doc proposing a notification listener.

| Option | Pros | Cons |
|---|---|---|
| **A. Make it proprietary** | One line plus a clarify entry; removes an irreversible risk; keeps the code for the planned listener | The MIT metadata and README badges stay lies until also fixed |
| **B. Genuinely open-source it** | It is the only genuinely reusable artefact here, and it is complete | CLA, support and trademark burden on a proprietary product; the root LICENSE forbids distribution; the org is a placeholder; nothing has ever needed it |
| **C. Extract to a separate public repo** | Clean separation | No consumer justifies the CI cost; adds a network dependency to a workspace that has none |
| **D. Delete it** | Removes the hazard and 18 files | Destroys a working implementation the QRIS notification-listener plan explicitly wants |

**Recommendation: A.** Zero consumers and zero offline role today means the permissive metadata can only leak proprietary code, while the code itself is worth keeping for the listener plan. Fix the manifest, add the deny.toml clarification, and correct the README badges and licence lines so the repository stops contradicting itself.

---

## D5 - Is in-app restore a product feature, or an ops procedure?

**Deciding facts.** Restore is fundamentally a process-must-be-down operation. The CLI can do it because it owns the process and takes the connection by value; it checkpoints WAL, deletes the sidecars, then copies over the live file. In the running app the connection is an Arc<Mutex<Connection>> cloned into every daemon, and daemons are **detached** - nothing joins them and there is no handle registry, so nothing can stop them individually. close_store and close_all cannot force a close either. There is **no restart primitive** anywhere in either shell; the only exit is a hard process exit, and the ordered shutdown path runs solely at process death.

Meanwhile the tablet is where the operator is: on Android the default backup lives in app-private storage with no way for a non-technical operator to reach it, and the tablet has no shell. check_integrity exists, is tested, and has **zero production callers**. The single backup slot is deleted before it is copied, so a failed restore has already destroyed the snapshot. And the updater writes last_backup_path without ever reading it.

| Option | Pros | Cons |
|---|---|---|
| **A. Gated in-app restore** | Closes the only real support ticket; the shutdown path already orders things correctly | Needs a restart primitive that does not exist; needs an integrity check or it can brick the install; the delete-then-copy slot is unsafe in-process |
| **B. CLI-only plus a runbook** | Zero code risk, already works | Unreachable for the Android tablet - the one device the operator actually holds |
| **C. Safe-mode restore on boot** | Sidesteps every concurrency problem (no daemons, no WAL contention, no UI state) and reuses the CLI sequence verbatim; matches the fact that restore is pre-boot by nature | A new boot path to test; still needs the integrity check and a slot that survives one failed attempt |
| **D. Automatic restore when an update fails** | None today | The code cannot even find its own backup, and auto-replacing a database converts a recoverable bug into data loss |

**Recommendation: C, with A's gating.** A safe-mode boot flag is the only option that respects the real constraint - a shared connection that twelve daemons hold and cannot be joined - while still giving a tablet operator a path. Gate it on DATA_EXPORT, run check_integrity on the candidate **before** any copy, require typed confirmation, and make the new backup write to a temporary name so a failure cannot destroy the previous one. Keep the CLI as the documented fallback and do not ship D.

---

## D6 - Is LAN KDS a product feature or an experiment?

**Deciding facts.** The in-app KDS board is real and reachable: its routes are registered behind the kitchen-display feature on both shells, and it gets its data over ordinary IPC with an event-driven refresh. But a **separate** KDS device gets nothing: there is no cloud-sync arm for KDS and no local-API route, so LAN is the only designed cross-device path - and the LAN crate is a dependency of the **desktop only**, so the tablet can neither serve nor consume it. LAN KDS has no client in either shipped shell.

Worse, the forwarder starts **unconditionally** at boot on every desktop install, binding loopback by default and refusing 0.0.0.0 without a pre-shared key - but the setting that would set that key has **zero production callers** and no UI writes it, so the PSK is settable only by a direct database write. The responder's static key is derived deterministically from the PSK, so it is one key per store with no per-device keys, and the only deactivation is presence marking rather than key revocation: a lost tablet cannot be cut off apart from rotating the key for everyone. Discovery ships an empty device list, and while the schema already carries pairing token columns, no pairing flow exists.

| Option | Pros | Cons |
|---|---|---|
| **A. Finish it** | The only working cross-device path; transport, discovery and the board already exist | Needs a settings UI, PSK generation and provisioning, per-device keys, a pairing flow, and a tablet client that does not exist - four features, not one |
| **B. Retire it from the shipped path** | No shipped path breaks (no KDS sync arm, no client); the in-app board survives on IPC; removes a default-running, unconfigurable listener with a store-wide derived key | Forecloses the offline kitchen scenario that cloud sync cannot serve |
| **C. Keep it undocumented and self-managed** | None | It already runs by default on every install, so 'self-managed' means an unconfigured listener with no operator control |
| **D. Replace with cloud or local API** | Reuses audited auth | Neither has a KDS route today - this is option A with a different transport plus two new arms |

**What would change the answer:** whether a tablet KDS client is genuinely planned, and whether a real multi-tablet restaurant deployment exists.

**Recommendation: B.** Retire the crate from the shipped path with a one-line workspace exclude so the removal is reversible, keep the in-app KDS board (it works today and is the only KDS that has ever had a client), and record the offline-kitchen scenario as an explicit non-goal rather than an unfinished feature.

---

## D7 - How much plugin trust is acceptable?

**Deciding facts.** Plugins load unsigned and unhashed from a user-writable directory, and a file watcher swaps the live manager on any change with no verification, so any process running as the same user gets in-process execution within about a second. Permissions are self-declared by the plugin with no operator grant step; three capability flags are parsed and never read; the driver capability is inert. The IPC surface for plugins is **empty**, so nothing shipped reaches them - but the one runtime use is real: a discount applied inside checkout, on a path that does **not** require the SALES_DISCOUNT permission the manual path requires, alongside an unbounded tax rate that a rule can use to zero or negate tax.

The Lua sandbox itself holds: no escape was demonstrated, globals are nilled, memory is capped, and the host exposes no filesystem, socket or process primitive. The only extension point anyone needs is a pure cart-to-discount function and a bounded tax rate - neither needs network, filesystem or driver access, which is why three of the capability flags are not merely unimplemented but unnecessary.

Note two corrections to the review's framing: **no ADR states a plugin story** (the plugin system is asserted as delivered in the roadmap and as Stable in the extending guide), and the marketplace feature is **tier add-ons bought through the payment provider, not a third-party plugin channel** - so retiring the plugin host would not foreclose it.

| Option | Pros | Cons |
|---|---|---|
| **A. Remove the host; make Lua rules first-party** | Best security: the unsigned drop-in path ceases to exist | Contradicts the roadmap's delivered claim and the guide's Stable surface |
| **B. Keep in-process with a signed/checksummed manifest, an operator grant, and a gated watcher** | Closes the actual defect (unverified load and silent swap) without re-proving a sandbox that already holds; keeps the extension story alive | Needs a manifest hash, a grant store, watcher refusal, and the dead flags deleted |
| **C. Move plugins out of process** | Strongest containment | Inserts a supervised process and an IPC contract into the **synchronous checkout path**; the benefit is marginal because the Lua VM never touches the store |
| **D. Label developer-only and delete the dead flags** | Removes false comfort at near-zero cost | No security gain on its own |

**Recommendation: B, with D folded in.** The sandbox holds and the only real use is a pure function, so the defect is unverified loading and silent hot-swapping, not in-process execution. **Smallest reversible first step:** checksum the plugin directory at load and refuse the hot-swap when verification fails, keeping the previous set running with a visible error. Land the two live money bugs in the same pass - SALES_DISCOUNT on the plugin discount path, and a bounded tax rate - because they cost less than any trust redesign and are wrong today.

---

## D8 - Which deployment shape ships?

**Deciding facts.** Production is **unified and only unified**: the deploy job posts the commit to Northflank, which builds the unified image running Caddy, the licence server and the cloud server in one container. The release workflow is desktop-only and builds no backend image. The two-service compose is the dev and self-managed path, and its documentation never mentions the unified image. The deploy skill states the shape as settled.

The routing gap is therefore live production breakage, and it is now measurable: a route-drift checker exists, is registered as a **required** gate, and **currently exits 1 on this tree**, reporting that the pairing namespace is not carved out to the licence server and that such a route answers 404 in production while its tests pass. The same checker has a structural blind spot - it derives prefixes from string literals in one Go file, so the Midtrans paths, which live in constants elsewhere, cannot ever be detected by it. The container also has two hand-maintained invariants left: the generic /api default owner, and the single shared data volume.

| Option | Pros | Cons |
|---|---|---|
| **A. Fix the routing and widen the checker** | Small; the required gate already exists and is wired; the pairing and Midtrans flows are dead in the only shipped shape today | The /api default and the shared volume remain hand-maintained |
| **B. Retire unified and ship the two-service compose** | Compose already fails closed on secrets and has a hardening override | Throws away the only CI-built, only-deployed artefact; re-plumbing the deploy is larger than the Caddyfile edit |
| **C. Keep both and document which is supported** | Cheapest | The docs already disagree, and that ambiguity is what produced the outage |
| **D. Unified only; delete the two-service path** | One shape, one truth | Deletes the self-managed path the compose and gateway example exist for |

**Recommendation: A.** Add the two missing carve-outs and make the checker read the Go path constants rather than one file's literals - then the required gate that is red today becomes the thing that keeps this fixed. Decide separately (this is a product question, not a code one) whether the self-managed VPS path stays supported; if it does, the docs must say which shape each path gets.

---

## D9 - Is the desktop store database single-tenant by construction, or should every terminal stamp a real tenant?

**Why this is here.** The tenant-stamping remediation (checklist C32) began as a mechanical item: eight RLS-covered tables never write `tenant_id`, so stamp a tenant at each insert. Three workers independently refused to do it and produced evidence instead, and the evidence says the item's premise is wrong on the desktop path. What looked like eight missing writes is one design claim plus one cloud-side assumption that does not hold.

**Deciding facts.**

1. **The design claim is written in the schema, in its own words.** `crates/kasirmu-core/migrations/20260907_add_location_tenant_id.sql:10-11` states that the default `'default'` *"preserves single-tenant store-DB semantics: a desktop store database is scoped to one tenant by construction."* This is not a comment about one table; it is the migration that added the column saying why the column's default is the honest value.
2. **The code enforces the same claim.** `crates/kasirmu-core/src/db/mod.rs:508-516` documents the desktop store database as single-tenant by construction, and `check_tenant_integrity` refuses to boot the application when a foreign-tenant row is present. A desktop install that stamped a real tenant on some rows and not others would therefore be a boot failure, not a partial improvement.
3. **The only tenant source in the system is a JWT claim, not a stored value.** `crates/kasirmu-api/src/auth.rs:58-70` (`ApiTokenClaims.tenant_id: Option<String>`) -> `crates/kasirmu-api/src/routes/products.rs:248` (`claims.tenant_id.as_deref().unwrap_or("default")`) -> the later `UPDATE products SET tenant_id = ?1` at `:306-309`. It is minted at `routes/tokens.rs:271` (an admin request body) or `:219` (from the registered `sync_terminals` row). Cost: zero queries. The **desktop** application never holds one - `SessionContext` has no `tenant_id` (`crates/kasirmu-core/src/session.rs:44-75`), `Store` has none (`db/mod.rs:204-252`), and `kasirmu-core` cannot depend on `kasirmu-api` to get one.
4. **Where the desktop path does stamp a real tenant, it works.** `crates/kasirmu-core/src/db/provisioning.rs:469` is fixable today because the same function, in the same transaction, already stamps `args.tenant_id` into the peer `provisioning` row at `:492-501` - a caller-supplied value the code already trusts for this fact. So the split is not "tenant stamping is impossible"; it is "tenant stamping is possible exactly where a value is genuinely supplied, and dishonest everywhere else."
5. **And the compensating evidence - a comment that asserts a mechanism which does not exist.** `crates/kasirmu-bridge/src/locations.rs:277` is documented as resolving *"for the session's tenant (ADR #7)"*, while its actual tenant read at `:230` is the literal `"default"`. That is the defect class this whole review is about: code, comment and tests agreeing with each other while all of them describe something the program does not do.
6. **Meanwhile the cloud reads as if per-tenant rows exist.** `apps/cloud-server/src/quota_detector.rs:336` runs `SELECT COUNT(*) FROM locations WHERE tenant_id = $1` to enforce the per-plan location quota, and `apps/cloud-server/src/email_pg/popularity.rs:230-236` builds the popularity roll-up with the same predicate. Against rows that carry `'default'`, the first scores a paying tenant **zero locations** and the second reports **no data** forever. Both are wrong answers to a paying customer, not merely missing rows.

7. **And the cloud is reading a table that never arrives.** `locations`, `edc_terminals`, `product_activity`, `product_variants`, `bundle_items`, `product_taxes` and `product_bundles` appear in **neither** the sync action vocabulary (`platform/sync/src/queue.rs:450-457` - complete_sale, finalize_sale, void_sale, refund_sale, product.created, settings.update, settings.change) **nor** the PostgreSQL copy surface (`apps/cloud-server/src/bin/migrate_sqlite_to_pg/main.rs:72-89`). The detector also enumerates tenants from SQLite only (`apps/cloud-server/src/quota_detector.rs:234-239`, called at `:259`). So the `COUNT(*)` at `:336` is not counting mis-stamped rows - it is very likely counting a table that is empty in the database it reads, which makes the number structurally zero rather than merely wrong.
8. **The pattern for applying a tenant at ingest already exists - for the tables that do sync.** The PG push path stamps the tenant server-side from the authenticated sync request, not from the row: `apps/cloud-server/src/sync_store/pg.rs:39-45` and `:76-87` set the GUC and bind `&tenant_id` into every `offline_queue` row, and that tenant comes from the JWT claim at `apps/cloud-server/src/sync_api.rs:269` (`claims.tenant_id...unwrap_or("default")`). So option A is not a new mechanism; it is the mechanism already in production, applied to seven tables that were never added to it.

**The fork.** Everything above is consistent with two different worlds, and only you can say which one this product intends:

| Option | What it means | Pros | Cons |
|---|---|---|---|
| **A. Desktop is single-tenant by construction; the cloud applies the tenant at ingest** | The terminal keeps writing `'default'`; the row's owning tenant is attached where it is actually known - the sync registration / the server-side ingest - so PG rows are per-tenant even though the terminal DB is not | Matches the documented design and `check_tenant_integrity`; needs no tenant type threaded through `SessionContext`, `Store` or `LocationProfile`; puts the value where the `sync_terminals.tenant_id` already exists; fixes the quota detector and the roll-up at their source | Requires the ingest path to actually apply a tenant - which is unproven today, and is the open question a researcher is answering now (what `offline_queue.tenant_id` in `crates/kasirmu-core/src/db/offline.rs:278/:330` resolves from, and whether that value is a real tenant or another literal). If the outbox carries no real tenant either, this option needs work at the sync boundary, not a one-line change |
| **B. Every terminal stamps the real tenant** | Thread a tenant into `SessionContext` and the writers, and require the desktop install to know its tenant | One consistent rule everywhere; RLS on the terminal DB becomes real rather than nominal | Contradicts facts 1 and 2: it requires the desktop store DB to hold rows of more than one tenant, which `check_tenant_integrity` refuses to boot on. It also requires a tenant type on `LocationProfile`, `NewEdcTerminal` and the bridge callers, and a value that `kasirmu-core` has no way to obtain. Largest blast radius of the three, and it fixes a condition the design says cannot arise |
| **C. Retire the per-tenant reads instead** | Take `locations` (and the four writerless tables) out of `RLS_TABLES` and stop the cloud counting per tenant | Cheapest; honest about the current state | Gives up the isolation the cloud is already built on, and leaves a paying tenant's quota and popularity permanently uncomputable. This treats the symptom - a wrong number - as the defect |

**Recommendation: A, refined - and do not start B.** Facts 7 and 8 sharpen A into something cheaper than it first looked: the ingest pattern already exists in production (`sync_store/pg.rs` stamps `offline_queue` from the request's JWT claim), so A is not new machinery, it is adding seven tables to machinery that already runs. But facts 7 also says something a decision has to face before any code moves: those tables have **no sync action at all**, so the detector's number is very likely zero because the table is empty in the database it reads, not because the rows are mis-stamped. An investigation is running that answers the two versions of that question ((a) is the cloud's SQLite the operator's own store file or a cloud-local copy that never saw customer rows; (b) is the count therefore correct-by-accident on a self-hosted single-tenant cloud, or permanently zero). **The sequence that follows is: answer (a)/(b); if the cloud is genuinely multi-tenant and needs these numbers, add the sync actions and let the existing ingest stamp the tenant; if it is not, stop counting a table the cloud cannot see and say so in the plan's own terms.** What must NOT happen either way is stamping a tenant on the terminal - facts 1, 2, 3 and 6 rule it out, and `check_tenant_integrity` would refuse the next boot. The schema states the intent, the boot check enforces it, and the value genuinely does not exist on the terminal - so B would mean inventing a tenant on the desktop to satisfy a cloud query, which is the failure mode every worker this round refused to commit. A also has the right shape for the evidence: the tenant is already known at the registration boundary (`sync_terminals.tenant_id`), and it is the cloud that needs the number, not the terminal. **Confirm A against the pending researcher finding on the outbox tenant before scoping it** - if the outbox already carries a real tenant, A is a small ingest change; if it carries another literal, A is a small sync-boundary change. Either way A is smaller than B, and unlike B it does not require contradicting a documented invariant.

**What this does NOT decide.** `crates/kasirmu-core/src/db/edc_terminals.rs:193` (`create_edc_terminal`) has **zero production callers** - every reference is a test - so a tenant parameter there would be an unexercised shape, not a fix. Leave it, and decide separately whether a create-EDC command should exist at all. And `apps/desktop-tauri/src/state.rs:410` (`seed_primary_store`) seeds the fixed `id = 'default'` row during startup, before any session, licence read or claim is in scope: under option A that is correct as written and needs no change.

---

## D10 - The locations quota axis can never fire. Make it real, or stop advertising it?

**Why this is here.** C36 was dispatched to ask whether the cloud quota detector was counting rows it could not see. The answer is sharper than the question, and it is a product question wearing engineering clothes.

**Deciding facts.**

1. **The detector counts three axes, not seven.** `apps/cloud-server/src/quota_detector.rs` references only `locations`, `products` and `users` (plus `tenant_plans`/`tenant_subscription` for tier resolution). `edc_terminals`, `product_activity`, `product_variants`, `bundle_items`, `product_taxes` and `product_bundles` appear **zero** times - an earlier scoping note in this workstream named them wrongly, and that correction is recorded in the checklist.
2. **In the cloud deployment the SQLite detector is dead code; the `_pg` loop runs.** `db_path` is ignored whenever `DATABASE_URL` points at PostgreSQL (`apps/cloud-server/src/config.rs:32-34`), and the PG branch (`main.rs:350-406`) connects an in-memory SQLite that its own comment says production data never lands in (`:361-367`) and starts `start_quota_detector_loop_pg` (`:406`). `count_tenant_locations_pg` (`:330-341`) is therefore the live query.
3. **Nothing writes `locations` into PostgreSQL, by any route.** No production INSERT/UPDATE of that table exists anywhere - every literal hit is a test fixture (`quota_detector_tests.rs:36`, `sync_api_tests.rs:280`, `sync_store_tests.rs:161`, `kasirmu-api/src/pg_tests.rs:1685,1709`). The device writers all target SQLite (`kasirmu-core/src/db/locations.rs:178`, reached from `apps/desktop-tauri/src/commands/locations.rs:62`). The sync pipeline cannot carry it: the action vocabulary (`platform/sync/src/queue.rs:449-462`) has no location action, `sync_store/pg.rs` writes exactly one table (`offline_queue`), and `PG_INIT` seeds no locations row.
4. **So the axis is inert, permanently - not merely wrong.** `SELECT COUNT(*) FROM locations WHERE tenant_id = $1` returns **0 for every tenant forever**, and `SubscriptionTier::max_locations()` is `Some(1)` for Free/OneTime/Plus, `Some(2)` for Pro, `Some(5)` for Premium (`subscription.rs:151-157`). `0 >= 1` is false, so `CONDITION_LOCATIONS_OVER_QUOTA` **can never fire** - and it would stay inert even for an operator legitimately running forty stores, because the cloud cannot see them.
5. **The contrast that proves it is a finding and not a footnote.** `products` and `users` DO reach PostgreSQL - via the copier's `DEFAULT_TABLES` (`apps/cloud-server/src/bin/migrate_sqlite_to_pg/main.rs:72-89`) and via `kasirmu-api/src/pg.rs:868,1430`. Those two axes are live and meaningful. `locations` is the only counted axis with **no PG writer and no copy entry**.
6. **A correction to this workstream's own earlier words, for the record.** The checklist and journal said a paying tenant could be *denied* location quota. That was an inference, and it was wrong in the direction that matters: the detector is an **alerting** path (`QuotaDimensionKind::Locations`, `CONDITION_LOCATIONS_OVER_QUOTA`), not a blocking one. The real impact is milder and still real - an operator who exceeds their tier's location limit is never told, and the number the alert would report is structurally zero. The corrected wording is in the checklist.

| Option | What it means | Pros | Cons |
|---|---|---|---|
| **A. Make the axis real** | Give locations a route into PostgreSQL - a sync action for locations (or a location row pushed alongside the existing product/user copy) so the count has something to count | The entitlement the tiers already publish becomes true; the alert can fire; the fix is where the tenant is already known (the authenticated sync request), so no terminal-side tenant invention is needed | It is a **feature**, not a remediation: a new sync payload, a new PG write path, and a decision about whether locations sync continuously or on change. Larger than everything else in this workstream's P0 set |
| **B. Stop advertising it** | Remove `Locations` from `QuotaDimensionKind`, drop `CONDITION_LOCATIONS_OVER_QUOTA`, and remove `max_locations` from the published tier table | Cheapest and honest: the product stops promising something it cannot measure | It silently changes what a paid tier means - `max_locations` is published (`subscription_tests.rs:1006` pins it) and presumably appears in customer-facing tier copy. It also deletes the alert rather than the defect, so if locations ever DO sync, nobody re-adds the guard |
| **C. Leave it and document it** | Keep the query and the entitlement, add a comment and a pinning test recording that the axis is inert | Zero risk; the finding is durable and the next reader is warned | Ships a tier limit that is provably unenforceable, which is the same class of defect as the stale doc comments this review is full of |

**Recommendation: C now, A when the sync vocabulary is next touched, B only if the entitlement is being retired anyway.** The pin (option C) costs one comment and one test and is already dispatched - it is strictly better than the status quo and blocks nothing. The real choice between A and B is commercial, not technical: **if `max_locations` is a sold term, A is owed to the customer; if it is aspirational, B is owed to the truth.** What should not persist either way is a published limit whose enforcement number is a constant zero. I am not guessing this one - it touches pricing copy, which I cannot see from the code.

---

## D11 - Should `allow_negative_stock` survive? The missing CHECK is not the missing backstop.

**Why this is here.** C10b was briefed to add `CHECK (qty >= 0)` to `stock_summary` as the backstop the review said was missing. The worker implemented it EXACTLY as briefed - quarantine, rebuild the table carrying the constraint, recreate the index, register the migration - and two EXISTING, PASSING tests failed:

```
db::products::tests::negative_stock_event_fires_when_allow_negative_enabled (products_tests.rs:2187)
  deduction should succeed with allow_negative_stock=true:
  Err(InsufficientStockAtLocation { sku: "FOOD-001", requested_delta: -15, available_qty: 12 })
db::inventory::tests::deactivate_inventory_location_with_negative_stock_errors (inventory_tests.rs:250)
  SqliteFailure(ConstraintViolation, extended_code: 275, Some("CHECK constraint failed: qty >= 0"))
```

**Deciding facts.** `allow_negative_stock` is a first-class, reachable, documented feature, not dead code:

1. `db/products/adjust.rs:208-225` writes `new_qty` **below zero deliberately** when the binding allows it - the branch exists specifically to store a negative.
2. The CHECK reaches that exact upsert (`adjust.rs:251`), and the surrounding handler (`:258-267`) converts the resulting `ConstraintViolation` into `InsufficientStockAtLocation` - so the constraint **silently re-enables the very guard the flag exists to opt out of**.
3. `db/sales_lifecycle.rs:279-303` and `products_stock_adjust/batch.rs:78-88` both read the same flag to permit the sale.
4. The UI ships it: `LocationPicker.tsx:429` renders a "negative stock allowed" badge, and `StockShortfallDialog.tsx` lets a cashier override per transaction.
5. **ADR #17 specifies it** (`docs/decisions/2026-07-18-multi-location-inventory.md:476-477`): the flag "lets this location go below zero when stock is insufficient... the backend MUST emit a warning event (`stock.negative`). The inventory dashboard MUST show a 'stock below zero' badge... This prevents the flag from silently turning inventory into a suggestion system."

So the review was right about the dead code and **wrong about the fix**. An unconditional `qty >= 0` is not the constraint this codebase was written against. The correct invariant is conditional - *quantity may be negative only for a binding that opted in* - and SQLite cannot express that as a table CHECK, because the flag lives in `workspace_inventory_locations`, a different table keyed by `instance_id` + `location_id`.

**And the backfill half is moot under the stated constraint.** A blanket `qty = 0` would have been wrong anyway (a negative row is often a legitimate oversell, which is the entire point of the flag), and the worker preserved every negative row in a `stock_summary_negative_quarantine` table before zeroing - nothing invented, nothing lost. But quarantining repairs *existing* rows while still refusing all *future* legitimate oversells. The conflict is with the constraint, not with the backfill.

| Option | What it means | Pros | Cons |
|---|---|---|---|
| **A. Keep the feature; enforce conditionally** | A trigger refuses a negative quantity only when the binding has NOT opted in: `WHEN NEW.qty < 0 AND NOT EXISTS (a binding with allow_negative_stock = 1)`. Plus fix the two dead comments at `adjust.rs:31` and `:144` that claim a Layer 2 guard which does not exist | Honours ADR #17 and the shipped UI; puts a real backstop where the review asked for one; makes the schema honest without reversing a product decision; and both directions are testable - the existing two tests must still pass AND a new test must show a non-opted-in binding refused | Needs a `TRIGGER_MAP` entry in `scripts/generate-pg-migration.py` (a hand-written plpgsql port, per its own header at `:28-30` and `:131`), so it is a migration-surface change with a PG twin to maintain; larger than the original C10b |
| **B. Retire the feature** | Then `CHECK (qty >= 0)` is correct as briefed - but retiring means removing `allow_negative_stock` from the UI (badge and override dialog), from the Rust guard, from `sales_lifecycle`, and superseding ADR #17 | The simplest schema, and the strongest invariant: negatives become impossible rather than conditional | It deletes a shipped, documented, cashier-facing capability to satisfy a constraint. **This is a commercial decision, not an engineering one**, and the worker's prepared migration is the right artifact for it if it is ever taken |
| **C. Leave the schema alone and only fix the comments** | Change `adjust.rs:31`/`:144` to stop claiming a Layer 2 that does not exist | Cheapest; removes the actual documentation defect the review found | Ships no backstop at all, so a future writer that bypasses the Rust guard can still write a negative - which is the class of hole this whole workstream has been closing elsewhere |

**Recommendation: A.** The review's finding - dead code claiming a guard exists - is real, but A fixes it without reversing a decision the ADR, the UI and three call sites all depend on. B is a legitimate product answer and I am **not** taking it unilaterally, because deleting a cashier-facing override to satisfy a schema is exactly the kind of call that should be the owner's. C is better than today but weaker than A for no meaningful saving, since A's extra cost is one `TRIGGER_MAP` entry and its PG twin.

**What this does NOT change.** The two failing tests are NOT stale and must not be weakened to make a constraint pass - they are the only tests pinning a shipped feature, and deleting them would have been the 'weaken a test to pass' failure this workstream has otherwise avoided. The C12 variance report (bdaffa47) remains the right way to surface a rollup that disagrees with the ledger; a CHECK on a materialised rollup constrains the rollup, never the ledger.

---

## Corrections to the review that these analyses forced

1. **P0-7 (at-rest key) offered an option that would cause data loss.** The review suggested requiring OZ_MASTER_KEY at boot as an alternative. D1 shows that would brick five credential families and both PII columns with no migration, and that two of the five cannot be re-entered through the product. The review now leads with the precondition - a branch-tolerant reader - and recommends the per-install keychain key.
2. **P0-6 (tenant isolation) understated the blocker.** The review's sequence was right but incomplete: it did not say that the shipped PostgreSQL profile connects as a **superuser**, where FORCE is a no-op, nor that the operator must also disable schema re-application when switching roles. It also described the cutover as covering 19 tables; it covers **29** (34 before the four writerless tables and `user_location_access` were moved to `RLS_EXEMPT` - see C33/C33b) and creates two BYPASSRLS roles.
3. **Section 12.1 said nothing compares the route table to the proxy.** Something does now - a required checker - and it is failing on the current tree, which is a stronger and more actionable fact than the absence of a check. The checker's blind spot (it cannot see path constants) is the new finding.

Everything above was established read-only: no build, no test execution, no deploy, and no code change. Counts cited here are file and grep readings, not executed-case totals.
