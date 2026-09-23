# Owner Decisions - D1 to D8

Companion to manager-codebase-review.md and manager-codebase-review-checklist.md. Each decision was analysed by a worker that traced the code before forming a view; every option below is priced against facts cited as file:line, and the recommendation is the manager's, not the analyst's. Three of these analyses **changed the review's own advice**, and those corrections are recorded at the end.

**How to use this with the checklist.** A decision here unblocks a checklist item; the checklist tells you when it is done. D1 and D2 gate C1 and C7. D3 gates C26. D4 gates C9. D5 gates C8 (and decides whether C8 is a feature or a runbook). D6 gates C29. D7 gates C2. D8 gates C27.

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

## Corrections to the review that these analyses forced

1. **P0-7 (at-rest key) offered an option that would cause data loss.** The review suggested requiring OZ_MASTER_KEY at boot as an alternative. D1 shows that would brick five credential families and both PII columns with no migration, and that two of the five cannot be re-entered through the product. The review now leads with the precondition - a branch-tolerant reader - and recommends the per-install keychain key.
2. **P0-6 (tenant isolation) understated the blocker.** The review's sequence was right but incomplete: it did not say that the shipped PostgreSQL profile connects as a **superuser**, where FORCE is a no-op, nor that the operator must also disable schema re-application when switching roles. It also described the cutover as covering 19 tables; it covers 30 and creates two BYPASSRLS roles.
3. **Section 12.1 said nothing compares the route table to the proxy.** Something does now - a required checker - and it is failing on the current tree, which is a stronger and more actionable fact than the absence of a check. The checker's blind spot (it cannot see path constants) is the new finding.

Everything above was established read-only: no build, no test execution, no deploy, and no code change. Counts cited here are file and grep readings, not executed-case totals.
