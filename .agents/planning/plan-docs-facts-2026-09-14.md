# Plan-docs facts snapshot — 2026-09-14

Authoritative measured facts for the doc-editing workers on the 0.0.37 plan-doc pass.
Every number below was taken against this checkout, with the reproducing command beside it.
**Cite this file; do not re-derive a number, and do not carry forward a figure from a doc.**

| Provenance | value | command |
|---|---|---|
| Repo root | `C:/dev/ozpos` | `git rev-parse --show-toplevel` |
| Branch | `main` | `git rev-parse --abbrev-ref HEAD` |
| HEAD | `ec2edf258918cec837a27b98912313d629c42cdf` — "Merge pull request #97 from kardelitaitu/0.0.37", 2026-09-14 06:49:42 +0700 | `git rev-parse HEAD` · `git log -1 --format='%H %ad %s' --date=iso` |
| Worktrees | one only: `C:/dev/ozpos` → `main` | `git worktree list` |
| Measured with | Git bash + Node v22.23.2 on Windows | — |

---

## 1. Version string

| metric | measured value | command |
|---|---|---|
| `[workspace.package] version` | `0.0.37` (Cargo.toml:37) | `grep -n '^version = ' Cargo.toml` |
| `ui/package.json` | `0.0.37` (line 4; name `oz-pos-ui`) | `grep -n '"version"' ui/package.json` |
| `apps/desktop-client/tauri.conf.json` | `0.0.37` (line 4) | `grep -n '"version"' apps/desktop-client/tauri.conf.json` |
| `apps/tablet-client/tauri.conf.json` | `0.0.37` (line 4) | `grep -n '"version"' apps/tablet-client/tauri.conf.json` |
| `website/package.json` | `0.0.37` (line 3) | `grep -n '"version"' website/package.json` |
| `Cargo.lock` / `oz-core` | `0.0.37` | `grep -A1 '^name = "oz-core"' Cargo.lock` |
| per-crate Cargo.toml | all `version.workspace = true` — no independent crate versions | `grep -n '^version' apps/desktop-client/Cargo.toml crates/oz-core/Cargo.toml` |
| git tags in this clone | **1** tag: `v0.0.5`. There is no `v0.0.37` tag locally. | `git tag --sort=-creatordate \| head -6` · `git tag \| wc -l` |

Version is locked at `0.0.37` (AGENTS.md "Version Lock"). Nothing measured here says a bump is due.
`release.yml` triggers on `v*` tags; with only `v0.0.5` in this clone, the release path cannot be
exercised from here.

---

## 2. Migrations

| metric | measured value | command |
|---|---|---|
| migration `.sql` files | **59** | `ls crates/oz-core/migrations/*.sql \| wc -l` |
| of which generated PG | 1 (`20260813_init.pg.sql`) | `ls crates/oz-core/migrations/*.sql \| grep -c '\.pg\.sql$'` |
| of which SQLite | 58 | `ls crates/oz-core/migrations/*.sql \| grep -v '\.pg\.sql$' \| wc -l` |
| migrations dirs in repo | 1 — only `crates/oz-core/migrations` | `find . -type d -name migrations -not -path './target/*' -not -path '*/node_modules/*'` |
| newest 5 by name | `20261001_sale_idempotency.sql` `20261002_sync_conflicts.sql` `20261003_sync_entity_vectors.sql` `20261004_midtrans_transactions.sql` `20261005_kds_routing_rules.sql` | `ls -1 crates/oz-core/migrations/ \| tail -5` |

The count moves with every migration; re-measure rather than quoting it as a constant. CI
(`dev-ci.yml#static-gates`) runs the checker without `--staged-only`, so it scans all 59 and prints
its own "N migration file(s) scanned".

---

## 3. Registered Tauri IPC commands

Counted from the `tauri::generate_handler![ … ]` block in each client's `lib.rs`, distinct by
`commands::<module>::<fn>` path. **Neither block contains a duplicate entry** (raw token count ==
distinct count in both), so "registered" and "distinct" are the same number per client.

| metric | measured value | command |
|---|---|---|
| desktop block extent | `apps/desktop-client/src/lib.rs` lines **843–1338** | `grep -n 'invoke_handler(tauri::generate_handler!\[' apps/desktop-client/src/lib.rs` |
| tablet block extent | `apps/tablet-client/src/lib.rs` lines **445–784** | `grep -n 'invoke_handler(tauri::generate_handler!\[' apps/tablet-client/src/lib.rs` |
| desktop registered (distinct) | **453** | `awk '/generate_handler!\[/{f=1} f{print} f&&/\]\)/{exit}' apps/desktop-client/src/lib.rs \| grep -o 'commands::[a-z0-9_]*::[a-z0-9_]*' \| sort -u \| wc -l` |
| tablet registered (distinct) | **322** | `awk '/generate_handler!\[/{f=1} f{print} f&&/\]\)/{exit}' apps/tablet-client/src/lib.rs \| grep -oE '[a-z0-9_]+::[a-z0-9_]+::[a-z0-9_]+' \| sort -u \| wc -l` |
| **both** clients register it | **297** (identical module path, not just identical fn name) | `comm -12 <(desktop_sorted) <(tablet_sorted) \| wc -l` on the two commands above |
| desktop-only | 156 | `comm -23` on the same two sorted lists |
| tablet-only | 25 | `comm -13` on the same two sorted lists |
| union across both clients | **478** | `cat <d1> <d2> \| sort -u \| wc -l` |
| desktop command modules | 46 namespaces: analytics audit auth branding browser bundles categories currencies customers data edc email exchange_rates features fiscal gift_cards hardware health history inventory inventory_counts kds kds_device kds_routing legal_entities license local_api local_payment locations loyalty memo offline payables pos product_variants products products_images promotions purchasing qris_auto receipt_format refunds regional reports scale security settings setup shifts staff stock_transfers subscription sync tables tax terminals topology void workspaces | `sed 's/commands::\([a-z0-9_]*\)::.*/\1/'` over the desktop list, then `sort -u` |
| top desktop families by command count | reports 24 · inventory 24 · settings 19 · sync 17 · license 17 · terminals 16 · pos 16 · workspaces 15 · staff 11 · products 11 · auth 11 | same, then `uniq -c \| sort -rn` |
| top tablet families by command count | settings 28 · reports 24 · pos 19 · sync 11 · staff 11 · products 11 · terminals 10 · stock_transfers 10 | same over the tablet list |
| command source files | desktop 70 · tablet 98 `*.rs` | `ls -1 apps/desktop-client/src/commands/*.rs \| wc -l` · `ls -1 apps/tablet-client/src/commands/*.rs \| wc -l` |

> **`settings` registers more commands on tablet than on desktop** (28 vs 19). A doc that says
> "desktop carries the fuller settings surface" is wrong at this HEAD.

---

## 4. Test surface

| metric | measured value | command |
|---|---|---|
| `*.tsx` under `ui/src/features/` | **277** | `find ui/src/features -name '*.tsx' \| wc -l` |
| — cross-check vs git index | 277 (identical) | `git ls-files 'ui/src/features/**/*.tsx' \| wc -l` |
| all files under `ui/src/features/` | 482 | `find ui/src/features -type f \| wc -l` |
| files under `ui/src/__tests__/` (recursive) | **572** = 303 `.tsx` + 268 `.ts` + 1 `.json` | `find ui/src/__tests__ -type f \| wc -l` · `find ui/src/__tests__ -type f \| sed 's/.*\.//' \| sort \| uniq -c` |
| — cross-check vs git index | 572 (identical) | `git ls-files 'ui/src/__tests__/**' \| wc -l` |
| — top level vs nested | 534 directly in `ui/src/__tests__/` + 38 nested under `a11y/` `hooks/` `test-utils/` `test-utils/mocks/` `utils/` | `find ui/src/__tests__ -maxdepth 1 -type f \| wc -l` · `find ui/src/__tests__ -mindepth 2 -type f \| wc -l` |
| `#[test]` fns in the Rust tree | **8252** | `grep -rn --include='*.rs' -o '#\[test\]' --exclude-dir=target . \| wc -l` |
| — cross-check, git-tracked only | 8252 (identical) | `git grep -o '#\[test\]' -- '*.rs' \| wc -l` |
| — by top-level dir | crates 5659 · platform 877 · apps 753 · modules 511 · foundation 452 · ui/scripts/gateway/plugins/dev/website/docs/packaging/install/fuzz 0 each | `for d in crates modules platform foundation apps; do echo "$d $(grep -rn --include='*.rs' -o '#\[test\]' $d \| wc -l)"; done` |
| tracked `*.rs` files | 1149 | `git ls-files '*.rs' \| wc -l` |

`#[test]` occurrences only — `#[tokio::test]` and `#[test_case]`-style macros are **not** in that
number. Say "`#[test]` functions" if you restate it. Vitest *case* counts are not measurable by
grep and are deliberately absent from this file.

---

## 5. Localization (Fluent)

| metric | measured value | command |
|---|---|---|
| `.ftl` files under `ui/src/locales/` | **54** = 27 en + 27 `*.id.ftl` | `find ui/src/locales -name '*.ftl' \| wc -l` · `ls ui/src/locales/*.id.ftl \| wc -l` |
| `.ftl` files repo-wide | 54 — `ui/src/locales/` is the only bundle dir | `find . -name '*.ftl' -not -path './target/*' -not -path '*/node_modules/*' \| wc -l` |
| message definitions (all bundles, total) | **9824** | `cat ui/src/locales/*.ftl \| grep -cE '^[A-Za-z][A-Za-z0-9_.-]*[[:space:]]*='` |
| distinct IDs across all bundles | **4950** | `grep -hoE '^[A-Za-z][A-Za-z0-9_.-]*[[:space:]]*=' ui/src/locales/*.ftl \| sed 's/[[:space:]]*=$//' \| sort -u \| wc -l` |
| distinct IDs, `.id.ftl` only | 4950 | same restricted to `ui/src/locales/*.id.ftl` |
| distinct IDs, en only | 4875 | same restricted to `$(ls ui/src/locales/*.ftl \| grep -v '\.id\.ftl$')` |
| **IDs in `.id.ftl` with no English definition** | **75** (e.g. `customers-add` `customers-email` `customers-name` `customers-no-customers` `customers-title` `done`) | `comm -13 <(en_sorted_ids) <(id_sorted_ids) \| wc -l` |
| IDs in en with no `.id.ftl` counterpart | **0** | `comm -23 <(en_sorted_ids) <(id_sorted_ids) \| wc -l` |
| Fluent attribute lines (`.label = …`) | 388 | `grep -hcE '^[[:space:]]+\.[A-Za-z][A-Za-z0-9_-]*[[:space:]]*=' ui/src/locales/*.ftl \| awk '{s+=$1} END {print s}'` |
| total lines across `.ftl` | 11965 | `wc -l ui/src/locales/*.ftl \| tail -1` |
| largest bundles (by ID count) | settings.id 924 · settings 920 · sales.id 852 · sales 833 · shared.id 579 · shared 571 · multi-location 406 + 406 · kds 292 + 292 | `for f in ui/src/locales/*.ftl; do echo "$(grep -cE '^[A-Za-z][A-Za-z0-9_.-]*[[:space:]]*=' $f) $f"; done \| sort -rn` |
| non-bundle files in the locales dir | `index.ts`, `test-utils.tsx` | `ls -1 ui/src/locales \| grep -v '\.ftl$'` |

**Quote two numbers, not one.** "9,824 message definitions across 54 files" and "4,950 distinct IDs"
are different metrics; a doc line reading "N IDs across M files" with no command gets read as one and
printed as the other. The en/id asymmetry (75 Indonesian-only IDs) is a real gap, not a parse artifact.

---

## 6. CI

| metric | measured value | command |
|---|---|---|
| live workflows (non-`.bak`) | **2** — `dev-ci.yml`, `release.yml` | `ls -1 .github/workflows/*.yml \| wc -l` · `ls -1 .github/workflows` |
| retired `.bak` files | **11** | `ls -1 .github/workflows/*.bak \| wc -l` |
| `.bak` names | `android` `ci` `deploy` `docker-digest-drift` `docker-persistence` `e2e-pr` `ios` `nightly` `release` `security` `website` (all `.yml.bak`) | `ls -1 .github/workflows` |
| `dev-ci.yml` ("Dev CI") triggers | `pull_request: branches [main]` **+ `push: branches [main]`** + `workflow_dispatch` | `sed -n '1,12p' .github/workflows/dev-ci.yml` |
| `dev-ci.yml` jobs (**10**, file order) | `changes` (l.41) `website` (139) `cargo-check` (165) `cargo-nextest` (200) `ui-test` (247) `i18n` (301) `ci-docs-drift` (352) `static-gates` (451) `release-readiness` (628) `northflank-deploy` (654) | `grep -n '^  [a-z][a-z0-9-]*:$' .github/workflows/dev-ci.yml` |
| `release.yml` ("Release") trigger | `push: tags ['v*']` | `sed -n '1,10p' .github/workflows/release.yml` |
| `release.yml` jobs (**3**) | `release-validate` (l.73) `release-build` (93) `release-publish` (304) | `grep -n '^  [a-z][a-z0-9-]*:$' .github/workflows/release.yml` |
| dev-ci `RUSTFLAGS` | `-D warnings` | `grep -n 'RUSTFLAGS' .github/workflows/dev-ci.yml` |
| in-file branch-protection note | `dev-ci.yml` comment ~l.33: "main is currently unprotected" | `sed -n '28,40p' .github/workflows/dev-ci.yml` |


---

## 7. Payment surface

| metric | measured value | exact command |
|---|---|---|
| files under crates/oz-payment/src/ | **23** (12 production .rs + 11 *_tests.rs) | `find crates/oz-payment/src -type f > /tmp/x; wc -l < /tmp/x` |
| total lines | 4504 | `find crates/oz-payment/src -name '*.rs' -exec wc -l {} + ` (last row = total) |
| driver files named | 5: stripe.rs square.rs qris.rs paddle.rs mock.rs (plus mod.rs) | `ls -1 crates/oz-payment/src/drivers/` |
| ALWAYS-COMPILED drivers | 4: mock, qris, square, stripe | `grep -n '^pub mod' crates/oz-payment/src/drivers/mod.rs` |
| paddle status | feature-gated stub - header comment reads "PLANNED - stub" | `grep -n -B2 'pub mod paddle' crates/oz-payment/src/drivers/mod.rs` |
| keyword file-hits inside the crate | stripe 10 - square 7 - qris 9 - paddle 7 - **midtrans 7** - xendit 0 - mock 11 | `for k in stripe square qris paddle midtrans xendit mock; do echo "$k=$(grep -rli $k crates/oz-payment/src --include='*.rs' > /tmp/y; wc -l < /tmp/y)"; done` |
| card-present (EMV/EDC) drivers | NOT in oz-payment - trait lives at crates/oz-hal/src/traits/edc.rs, stated in the drivers/mod.rs header | `sed -n '1,20p' crates/oz-payment/src/drivers/mod.rs` |
| where Midtrans actually lives | apps/cloud-server/src/{midtrans_ledger.rs,payment_api.rs,webhooks.rs,config.rs,main.rs,openapi.rs} - crates/oz-bridge/src/qris_auto*.rs - apps/desktop-client + apps/tablet-client src/commands/{qris_auto.rs,settings.rs} - apps/license-server/midtrans_checkout.go + midtrans_webhook.go - migration 20261004_midtrans_transactions.sql | `grep -rli midtrans --include='*.rs' . > /tmp/z` then drop /target/ lines |
| payment-adjacent desktop IPC modules | edc - local_payment - qris_auto (2 cmds) - gift_cards - payables. **No commands::payment::* exists** | over the desktop command list from section 3, strip to module and grep pay/qris/edc |

METHOD: "5 payment drivers" is true of FILES; "4" is true of MODULES COMPILED BY DEFAULT (paddle is a
gated stub). Say which. `grep -rli` counts files, not occurrences, so the keyword row is a surface
measure and not code volume.

---

## 8. KDS surface

The KDS feature lives at ui/src/features/kds/. There is no KDS directory nested under
ui/src/features/restaurant/.

| metric | measured value | exact command |
|---|---|---|
| files under ui/src/features/kds/ | **33** (recursive) | `find ui/src/features/kds -type f > /tmp/x; wc -l < /tmp/x` |
| .tsx files there | 15 | `find ui/src/features/kds -name '*.tsx' > /tmp/x; wc -l < /tmp/x` |
| total lines (recursive) | 10865 | `find ui/src/features/kds -type f -exec wc -l {} + ` (last row = total) |
| contents | ExpoScreen.tsx/.css, KdsCardColorsContext.tsx, KdsCompletedView.tsx/.css, KdsHamburgerPanel.tsx, KdsLayoutMasonry.tsx, KdsScreen.tsx/.css, KdsScreenFooter.tsx, register.tsx, kdsAutoAccept.ts, kdsCardColors.ts, kdsRoutingRulesModel.ts, kdsSettingsModel.ts, kdsStationPrefs.ts, kdsStatus.ts, plus subdirs components/ and hooks/ | `ls -1 ui/src/features/kds` |
| largest KDS files | KdsScreen.css 2443 - **KdsScreen.tsx 1193** - ExpoScreen.tsx 575 - ExpoScreen.css 534 - KdsHamburgerPanel.tsx 528 - KdsCompletedView.tsx 239 - KdsLayoutMasonry.tsx 116 | `wc -l ui/src/features/kds/*` (sort by first column) |
| KDS-named paths repo-wide | 159 (docs, .agents, todo-kds.md, dev/kds-pwa, e2e specs and tests included) | `find . -iname '*kds*' -not -path './target/*' -not -path '*/node_modules/*' > /tmp/x; wc -l < /tmp/x` |
| KDS in the Rust tree | **31 files**: apps/desktop-client/src/commands/{kds.rs,kds_device.rs,kds_routing.rs,kds_lan_live_tests.rs} - apps/tablet-client/src/commands/{kds.rs,kds_tests.rs} - crates/oz-bridge/src/{kds,kds_device,kds_routing,kds_tests,kds_routing_tests}.rs - crates/oz-core/src/kds.rs plus crates/oz-core/src/db/{kds,kds_devices,kds_devices_tests,kds_lines,kds_ops,kds_orders,kds_rules,kds_rules_tests,kds_tests}.rs - crates/oz-hal/src/drivers/kds_chit_tests.rs - crates/oz-lan/src/kds_sync_tests.rs - 5 migrations | `find crates platform modules apps foundation -iname '*kds*' -type f > /tmp/x; wc -l < /tmp/x` |
| registered KDS IPC (desktop) | commands::kds::* = 9, plus separate modules kds_device and kds_routing; tablet registers update_kds_status_scoped | `grep -c -F 'commands::kds::' ` over the section-3 desktop list |
| KDS Fluent bundle | kds.ftl 292 IDs / 387 lines - kds.id.ftl 292 IDs / 365 lines | per-file ID loop in section 5 |
| KDS e2e specs | ui/e2e/kds.spec.ts - ui/e2e/e2e-kds-critical-path.spec.ts - ui/e2e/e2e-pos-to-kds.spec.ts | `find . -iname '*kds*'` then keep the e2e paths |
| KDS design records | docs/specs/_active/kds-redesign-ux.md - ADRs 2026-07-18-kds-multi-layout-system.md and 2026-08-09-topology-phase2/7/8-kds-*.md | `find . -iname '*kds*'` then keep the docs paths |

METHOD: a single-level `wc -l ui/src/features/kds/*` sees only the top level plus one total row; the
33-file and 10865-line figures are the recursive find runs. KdsScreen.tsx at 1193 lines is the largest
KDS logic file and breaches the AGENTS.md "preferably < 600 lines" guidance.

---

## 9. Sync surface

| metric | measured value | exact command |
|---|---|---|
| files under platform/sync/ | **36** (34 under src/, incl. src/crdt/ 10 files; 2 under tests/) | `find platform/sync -type f > /tmp/x; wc -l < /tmp/x` |
| platform/sync/src lines | 15677 | `find platform/sync/src -name '*.rs' -exec wc -l {} + ` (last row = total) |
| src modules | conflict - crdt/{clock_store,delta_mutation,lamport,mod,push_stamp,version_vector} - daemon, daemon_tick - image_push - lib - pg_daemon, pg_transport - queue - replication - transport (plus _tests siblings, test_helpers.rs, sync_client_divergence_tests.rs) | `find platform/sync -type f` |
| platform/sync/tests | integration_test.rs - pg_integration.rs | `find platform/sync/tests -type f` |
| files under apps/cloud-server/src/ | **51** | `find apps/cloud-server/src -type f > /tmp/x; wc -l < /tmp/x` |
| cloud-server lines | 26191 | `find apps/cloud-server/src -name '*.rs' -exec wc -l {} + ` (last row = total) |
| cloud-server sync-specific files | sync_api(+tests), sync_store(+tests), conflict_resolution(+tests), outbox(+tests), outbound_webhooks(+tests), webhooks(+tests), redis_backend(+tests) | `ls -1 apps/cloud-server/src/` then grep -iE sync/conflict/outbox/webhook/redis |
| cloud-server src/bin/ | migrate_sqlite_to_pg/{main,copy,rows,schema}.rs plus tests | `find apps/cloud-server/src/bin -type f` |
| other sync dirs | crates/oz-core/src/sync/ (3 files) - ui/src/features/sync/ - platform/startup/src/rate_sync.rs | `find . -type d -iname '*sync*' -not -path './target/*' -not -path '*/node_modules/*'` |
| active sync specs | docs/specs/_active/0044-critical-delivery-and-sync-replay-safety - 0045-sync-conflict-dead-letter-recovery | same |
| sync IPC commands | desktop commands::sync::* = 17 - tablet = 11 | section 3 family counts |

---

## 10. Settings surface

| metric | measured value | exact command |
|---|---|---|
| files under ui/src/features/settings/ | **63** (22 at top level, sections/ 8, screens/ 22, __tests__/ 2, and 11 elsewhere below) | `find ui/src/features/settings -type f > /tmp/x; wc -l < /tmp/x` and `find ui/src/features/settings -maxdepth 1 -type f > /tmp/y; wc -l < /tmp/y` |
| total lines (recursive) | 17141 | `find ui/src/features/settings -type f -exec wc -l {} + ` (last row = total) |
| largest files | **SettingsPage.css 1105** - **DataManagementScreen.tsx 1016** - **SettingsPage.tsx 921** - __tests__/LicenseSettings.test.tsx 868 - SettingsNavTree.tsx 844 - EmailReportSettings.tsx 734 - SettingsNavTree.css 656 - sections/SyncSection.tsx 567 - LicenseSettings.tsx 566 - AppearanceSettings.tsx 526 - DataManagementScreen.css 526 - FeatureToggleScreen.tsx 516 - screens/ReceiptFormatSettingsCard.tsx 488 - sections/LocalApiSection.tsx 429 | `find ui/src/features/settings -type f -exec wc -l {} +` sorted descending by line count, head 16 |
| crates/oz-core/src/settings.rs | **897** lines | `wc -l crates/oz-core/src/settings.rs` |
| crates/oz-core/src/db/settings.rs | 286 lines | `wc -l crates/oz-core/src/db/settings.rs` |
| apps/desktop-client/src/commands/settings.rs | **379** lines | `wc -l apps/desktop-client/src/commands/settings.rs` |
| apps/tablet-client/src/commands/settings.rs | **949** lines (2.5x desktop) | `wc -l apps/tablet-client/src/commands/settings.rs` |
| modules/settings/** | 10 files, **647** lines - lib.rs 202 - repository_tests.rs 149 - repository.rs 97 - error.rs 79 - service.rs 61 - models.rs 31 - service_tests.rs 28 - plus Cargo.toml, README.md, manifest.json | `find modules/settings -type f` and `wc -l modules/settings/src/*.rs` |
| registered settings IPC | desktop 19 - tablet 28 | section 3 family counts |
| settings Fluent bundle | settings.ftl 920 IDs / 1140 lines - settings.id.ftl 924 IDs / 1123 lines | section 5 |

METHOD: the ranking uses the recursive run because a single-level `wc -l` misses sections/ and
screens/. There is NO components/ dir under settings (0 files); shared bits live in ui/src/frontend/.
The two files a "settings is too big" claim should name are DataManagementScreen.tsx (1016) and
SettingsPage.tsx (921). modules/settings/ is NOT the UI - it is the kernel-module stub, 647 lines
across 7 src/*.rs.

---

## 11. Dev-mock surface

| metric | measured value | exact command |
|---|---|---|
| files under ui/src/dev-mock/ | **20**, 6174 lines | `find ui/src/dev-mock -type f > /tmp/x; wc -l < /tmp/x` and `find ui/src/dev-mock -name '*.ts' -exec wc -l {} +` (last row = total) |
| layout | core/{mockDatabase,mockDispatcher,mockSeedData,mockStorageAdapter}.ts - handlers/{analytics,catalog,crm,floorplan,inventory,kds,locations,loyalty,payment,sales,shifts,staff,system,topology-state}.ts (13) - tauri-api.ts - tauri-event.ts | `find ui/src/dev-mock -type f` |
| filenames matching *mock* under ui/ | **15**: the 4 core/mock*.ts plus 11 tests in ui/src/__tests__/: MockFactoriesCompile.test.tsx, NodeTopologyEditorDevMock.test.tsx, dev-mock-audit-shapes.test.ts, dev-mock-auth-contract.test.ts, dev-mock-envelope-shapes.test.ts, dev-mock-legal-entities.test.ts, dev-mock-role-holders.test.ts, dev-mock-scoped-aliases.test.ts, dev-mock-stores.test.ts, mockFactorySurface.test.ts, mockSurfaceStatic.test.ts | `find ui -iname '*mock*' -type f -not -path '*/node_modules/*' > /tmp/x; wc -l < /tmp/x` |
| *mock* under crates/oz-hal/src | **2**: drivers/mock.rs and drivers/mock_tests.rs - one HAL mock module serving every device trait | `find crates/oz-hal/src -iname '*mock*' -type f` |
| *mock* across the Rust workspace | **8**: oz-hal/src/drivers/mock(_tests).rs, oz-hal/tests/mock_integration.rs, oz-notification/src/mock(_tests).rs, oz-payment/src/drivers/mock(_tests).rs, oz-payment/tests/mock_integration.rs | `find crates platform modules apps foundation -iname '*mock*' -type f` |
| paths containing devmock | 6: .agents/devmock-kds-extract.py, .agents/archived/done-todo-refactor-devmock-agents-1/2/4.md, todo-refactor-devmock-agents-3.md (root, live), ui/src/__tests__/NodeTopologyEditorDevMock.test.tsx | `find . -iname '*devmock*' -not -path './target/*' -not -path '*/node_modules/*' -not -path './.git/*'` |

METHOD: there is NO crates/*/devmock module and NO platform/**/devmock. "The devmock module" means
ui/src/dev-mock/ (hyphenated, not CamelCase) plus the HAL/payment/notification mock drivers. 15 (name
match) and 20 (directory contents) answer different questions: 13 of the 20 files - handlers/* and
tauri-*.ts - carry no "mock" substring in the filename. Never quote one for the other.
