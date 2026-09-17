<!-- TODO: update badge URLs after repo rename -->
![GitHub code size in bytes](https://img.shields.io/github/languages/code-size/kardelitaitu/oz-pos?style=flat-square) ![GitHub repo size](https://img.shields.io/github/repo-size/kardelitaitu/oz-pos?style=flat-square) [![Dev CI](https://github.com/kardelitaitu/oz-pos/actions/workflows/dev-ci.yml/badge.svg)](https://github.com/kardelitaitu/oz-pos/actions/workflows/dev-ci.yml)


<!-- Audit stamp: 2026-09-08 · DSH · status: ACCURATE after repair (7 counts corrected, all measured not estimated) · every stale figure was replaced with a measurement taken against HEAD and the command to reproduce it is named in the line · migrations 19 -> 44 (the column-type checker prints "44 files scanned"; AGENTS.md said 28 and docs/guides/ARCHITECTURE.md said 19 for the same fact — three docs, three numbers, none current) · IPC 505 -> 450 distinct registered (425 desktop / 297 tablet / 272 both; see docs/guides/api-reference.md for the full reconciliation) · Rust tests 5,800+ -> 8,709 #[test] fns · frontend tests ~6,700 -> 8,056 cases in 516 files · Fluent 5,700+ IDs across 50 files -> 9,146 across 52 · "55+ audited screen components" -> 183 feature .tsx files, because the audit's unit is surfaces and key sites, not screens · structural claims verified accurate: all 13 crates, all 10 npm scripts, all 3 scripts/*, the 5 payment drivers, ui/e2e/README.md, the ui/README.md anchor, and every path in both architecture diagrams · SUPERSEDES the 2026-08-31 stamp, whose repairs are kept here: repointed 3 broken links docs/archived/{QUICKSTART,ROADMAP,MODULAR_APP_PLAN}.md -> docs/guides/, crate inventory 11 -> 13 (oz-crypto, oz-media), "future CRM module" -> CRM ships, diagram "Restaurant" -> "Promotions", HAL lists gained EDC terminals + weight scales (traits/edc.rs, drivers/scale.rs), oz-payment drivers gained Paddle, footer version 0.0.25 -> 0.0.33 · WHY IT IS REPLACED RATHER THAN KEPT BELOW: that audit recorded "migrations 19 re-confirmed" when the tree already held 23, and "IPC 505 unique (matches api-reference.md)" — the 505 was the count of entries on a page that itself was wrong, and matching a wrong number to a wrong number was treated as confirmation. Two of its structural claims were also still true, which is the point: only the counts rotted. · NOTE test-file and ID counts stay volatile (parallel sessions add tests continuously) -->

<!-- Migration count note: 2026-09-13 · DSH · the 09-08 stamp above records migrations 19 -> 44 and is left exactly as it was written; the measured count today is 59 (`ls crates/oz-core/migrations/*.sql | wc -l`), and the two live claims in this file (Technology Stack, Status) now carry that number. -->

<!-- Audit stamp: 2026-09-14 · DSH · status: ACCURATE AFTER REPAIR (8 live claims re-measured; the 09-08 stamp and the 09-13 note above are left exactly as written, per this file's own convention) · every number below is a measurement against `C:/dev/ozpos` at HEAD `ec2edf258`, with its reproducing command inline in the line it fixes · Rust tests 8,709 -> **8,252** `#[test]` (`grep -rno --include=*.rs '#\[test\]' . | wc -l`; two of the 8,252 are prose mentions inside `//!` comments — `crates/oz-bridge/src/currency_tests.rs:12`, `crates/oz-core/src/features.rs:5` — so a strict-attribute count reads 8,250, and async tests using `#[tokio::test]` (1,397 by the same method) are NOT included in either figure) · front-end tests: **572 files** under `ui/src/__tests__` (303 .tsx + 268 .ts + 1 .json), and the **case total was deleted, not updated** — 8,056 was a runtime property of one Vitest run and nothing in the repo re-derives it, so it is removed from every live line (Core Principles, Repository Structure, the `npm run test` row, Status) · feature `.tsx` 183 -> **277** (`find ui/src/features -name '*.tsx' | wc -l`) · Fluent 9,146 IDs across 52 files -> **54 `.ftl` files (27 en + 27 id), 9,825 message definitions (4,875 en + 4,950 id), 4,950 distinct IDs, and 75 of those IDs have NO English definition** — every en ID has an id counterpart, the gap runs one way (the per-file counts are exact and agree with the language split: 4,875 en + 4,950 id = 9,825, 4,950 distinct IDs, 75 without an English definition — `ls ui/src/locales/*.ftl | xargs grep -hcE '^[A-Za-z][A-Za-z0-9_-]*[[:space:]]*=' | awk '{s+=$1} END {print s}'` = 9,825. Any `cat ui/src/locales/*.ftl | grep -c` pipeline under-reads by exactly 1 (9,824 definitions / 4,949 distinct) because `sales.ftl` is the only one of the 54 files with NO final newline (last byte `}`), so `cat` welds its last definition onto the next file's first line — an artifact of concatenation, not a second method. There are no dotted `key.attr =` definitions anywhere in the tree: `cat ui/src/locales/*.ftl | grep -cE '^[a-zA-Z][a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]+[[:space:]]*='` = 0.) · IPC 450 (425/297/272) -> **453 desktop / 322 tablet / 297 both / 478 distinct** (entries inside each shell's `tauri::generate_handler!` in `apps/desktop-client/src/lib.rs` and `apps/tablet-client/src/lib.rs`, deduped by qualified path; re-check `python scripts/verify-ipc-parity.py`) · Repository Structure listed **13 crates and the tree holds 16** (`ls -d crates/*/ | wc -l`): added `oz-bridge` (tauri-free command bodies behind both shells' IPC shims — `BridgeCtx`, `BridgeError`), `oz-lan` (TCP accept loop, per-peer offline buffers, PSK + Noise transports, KDS discovery and multi-terminal sync), `oz-local-api` (loopback REST on the shared `oz-api` router, settings-gated, default-off, token-minted); all three described from their own `src/lib.rs` module docs, and both now-stale structural claims in the 09-08 stamp — "all 13 crates" and "the 5 payment drivers" — are left untouched there and corrected only here: `crates/oz-payment/src/drivers/` holds 5 drivers but **Paddle is a `#[cfg(feature = "paddle")]` stub self-labelled "PLANNED — not yet implemented"** (`paddle.rs:7,13`; the feature is in `default`, so it compiles but returns `Unsupported` on every op), i.e. 4 real drivers + 1 mock + 1 stub, which is also what `crates/oz-payment/README.md` still states as fact · PR-gate sentence rewritten to separate policy from enforcement, because Clippy is in **zero** live workflows (see Testing Strategy) · diagram: added a fourth Infrastructure row for the three new crates; **the Applications box still reads "Future" and was NOT redrawn** — `apps/` does contain `cloud-server` and `license-server` today, but they are axum/Go services, not clients of the Tauri v2 Shell the box feeds, so naming them there would draw a false arrow rather than a false label; `license-server` has no Cargo.toml at all (Go, `go.mod`) · left unverified: the Vitest case total (needs a run), the `npm run test` execution time, and whether the 09-08 "all 10 npm scripts" claim still holds — `ui/package.json` defines 21 scripts today, only 10 of which this page names. -->

<!-- Audit stamp: 2026-09-16 · DSH · status: ACCURATE AFTER REPAIR (SIX live counts re-measured against this checkout; the 09-08 stamp, the 09-13 note and the 09-14 stamp above are left exactly as written, per this file's own convention, and each replaced figure is kept below as the dated predecessor it now is) · every figure carries the command that re-derives it, in the line it fixes · crates 16 -> **17** (`ls -d crates/*/ | wc -l`) and Repository Structure gained the crate it had never listed: **`crates/qris-core/`** — tracked (`git ls-files crates/qris-core | wc -l` = 18 files, all of them), a workspace member via `members = ["crates/*"]` and a `[workspace.dependencies]` entry at `Cargo.toml:65`, landed at `c7009520d` (2026-09-15, "feat(qris): implement dynamic QRIS generation…"), described from its own `src/lib.rs` module doc (parse / build / decode / render QRIS = Indonesia's national QR standard on the EMVCo Merchant-Presented Mode TLV spec; `decode` and `render` are feature-gated) · `#[test]` 8,280 -> **8,354** (`grep -rn --include='*.rs' -o '#\[test\]' . | wc -l`; the older `-rno` spelling returns the same 8,354 — the two forms differ in flag order only) · `ui/src/__tests__` 589 -> **592** files = **319 .tsx + 272 .ts + 1 .json** (was 589 = 317/271/1; the split still sums to the total) · feature `.tsx` 299 -> **301** (`find ui/src/features -name '*.tsx' | wc -l`) · Fluent 9,809 / 4,942 -> **9,841 definitions (4,883 en + 4,958 id) across 54 files (27 en + 27 id), 4,958 distinct IDs, 75 IDs with no English definition** — counted PER FILE as the 09-14 stamp prescribes; the `cat *.ftl | grep -c` trap still under-reads by exactly 1 (9,840 / 4,957 measured this pass) because `sales.ftl` is still the only one of the 54 whose last byte is not a newline (`for f in ui/src/locales/*.ftl; do tail -c1 "$f" | od -An -c; done`), and NO part of the +32 delta is attributed to dotted `key.attr =` lines: that pattern matches **0** definitions tree-wide · IPC **453/322 -> 455 desktop / 321 tablet registered -> 455 desktop / 320 tablet registered**, because that is what `python scripts/verify-ipc-parity.py` prints on this tree (it also prints 448 UI command strings per shell and exits 0); the 297 both / 478 distinct pair was NOT printed by the tool and is re-derived here as **301 in both / 475 distinct** by intersecting and unioning the two `generate_handler![…]` lists through that script's own `extract_handlers()` + `ENTRY_RE` (`scripts/verify-ipc-parity.py:109`), which reproduces the tool's printed 455 and 321 exactly — a naive comma split over the same blocks reads 461/321/298/484 and must not be used · SAME-DAY SECOND PASS on this census (2026-09-16, HEAD `f8c11fc5c`): the tool now prints **455 registered desktop / 320 registered tablet** and exits 0 — 444 UI command strings per shell, a print of a moving tree and not a discrepancy with the 448 above — and the pair it does not print re-derives, through the method this stamp itself prescribes, to **301 in both / 474 distinct**: `python -c "import importlib.util as u,pathlib; s=u.spec_from_file_location('v','scripts/verify-ipc-parity.py'); m=u.module_from_spec(s); s.loader.exec_module(m); D=set(m.extract_handlers(pathlib.Path('apps/desktop-client/src/lib.rs'))); T=set(m.extract_handlers(pathlib.Path('apps/tablet-client/src/lib.rs'))); print(len(D),len(T),len(D&T),len(D|T))"` → `455 320 301 474`, which closes on the identity 455 + 320 − 301 = 474 · WHY 321 BECAME 320 AND 475 BECAME 474, named so the older figure is not read as sloppiness: it was correct against the tree it measured, and `d29a7c0f4 refactor(tablet): retire the registered set_hardware_settings door` then deleted exactly one entry from the tablet's `generate_handler!` (`git show --stat d29a7c0f4 -- apps/tablet-client/src/lib.rs` → 1 file, 1 deletion), leaving `set_hardware_settings_scoped` as the only registered form of that command in either shell — so the tablet total and the union each lost one name while desktop held at 455 and the intersection held at 301, and `git log d29a7c0f4..HEAD -- apps/desktop-client/src/lib.rs apps/tablet-client/src/lib.rs` prints nothing, so no other change is absorbed into that delta · THE DISAGREEMENT THIS STAMP LEFT OPEN IS CLOSED, ON THE TOOL'S SIDE: the drift the clause below records as KNOWN and OPEN between this page's 455/321/301/475 and the two AGENTS.md mirrors was taken up by `7bb8ab0ba` at 455/320/301/474, and this pass reached the same four numbers by re-measuring rather than by copying either page, which is why this stamp and the Status section below now read alike · NOT touched: the version string (locked 0.0.39), the Architecture diagram (giving `qris-core` its own Infrastructure label is a drawing decision, not a count — that box lists nine labels and never claimed to enumerate the crates), and the two AGENTS.md mirrors, which carry the same six stale figures and are held dirty by other lanes — the drift is therefore KNOWN and OPEN in those files, not fixed · 59 migration files re-confirmed unchanged by `ls crates/oz-core/migrations/*.sql | wc -l`. -->

<!-- dead-ref-prefix-ok: docs/guides/API.md · scoped to that one filename: the Repository Structure block below cites it in order to say it does NOT exist ("the name `API` this line carried until 2026-09-16 matched no file — `ls docs/guides/API.md` fails, the page is `api-reference.md`"), which is a correct sentence the checker cannot tell from a stale link. Declared at the page head, where `check-dead-refs.py` reads this opt-out (first 40 lines), by the 2026-09-16 census pass so `python .agents/skills/docs-auditor/scripts/check-dead-refs.py README.md` exits 0; every other path reference on this page is still checked · -->

# kasir.mu

> **A modular, offline-first Point-of-Sale platform built with Rust and Tauri v2.**

kasir.mu is a Point-of-Sale platform designed for **retail, restaurants, cafés, and specialty businesses** that require reliability, performance, and long-term maintainability.

Unlike traditional monolithic POS applications, kasir.mu is built around a modular architecture where business capabilities are implemented as independent modules. Organizations can deploy only the features they need while developers can extend the platform without modifying the core.

---

## Why kasir.mu?

Modern POS systems often suffer from vendor lock-in, expensive subscriptions, cloud dependency, limited customization, and difficult maintenance. kasir.mu addresses these challenges through a modern software architecture.

| Traditional POS | kasir.mu |
|---|---|
| Monolithic | Modular architecture |
| Cloud required | Offline-first |
| Proprietary integrations | Hardware abstraction layer |
| Difficult customization | Plug-in modules |
| Large desktop footprint | Lightweight Tauri application |
| Vendor lock-in | Open ecosystem |

### Core Principles

- **Offline-first** — Operates without internet connectivity; sync when available
- **Modular by design** — Independent modules for inventory, CRM, reporting, etc.
- **Secure by default** — Encrypted `.ozpkg` snapshots (whole-file `.db` backups are unencrypted), PAN masking, platform keychains
- **Hardware abstraction** — Vendor-independent drivers for printers, scanners, displays, payment terminals, scales
- **Enterprise-grade code quality** — 8,354 Rust `#[test]` functions and 593 front-end test files (measured 2026-09-16: `grep -rn --include='*.rs' -o '#\[test\]' . | wc -l` → 8,354; `find ui/src/__tests__ -type f | wc -l` → 593, split 320 `.tsx` + 272 `.ts` + 1 `.json` summing to the total; the 2026-09-15 pass read 8,280 and 589 through these same two commands, and both figures move with every test that lands — the +1 over the 592 read earlier on 2026-09-16 is `b61aedee0` adding `ui/src/__tests__/appShellBootDevRead.test.tsx`, named because that commit is the only cause this line claims), strict Clippy (a project standard that developers and `scripts/check.sh` enforce, not CI), typed Money, transactional DB. The Vitest **case** total is not measured — it exists only in a test run, and no command here re-derives it.

---

## Key Features

| Area | Capabilities |
|------|-------------|
| **Sales** | Fast checkout, barcode scanning, receipt printing, multiple payments, refunds, discounts |
| **Inventory** | Product management, categories, stock adjustments, purchase tracking, movement history |
| **Customer Management** | Profiles, purchase history, loyalty support, CRM (dedicated module) |
| **Reporting** | Daily sales, product performance, cash reconciliation, inventory reports, export |
| **Security** | Encrypted `.ozpkg` snapshots (Argon2id + AES-256-GCM; whole-file `.db`/`.backup.db` backups are unencrypted), PAN masking, TLS, platform keychain, audit logging |
| **Hardware** | Receipt printers, barcode scanners, cash drawers, customer displays, EDC payment terminals, weight scales — USB, Bluetooth, TCP, serial, plus mock drivers for testing |

---

## Architecture

```
                         Applications
      ┌─────────────────────────────────────────────┐
      │  Desktop Client  │  Tablet Client  │ Future │
      └─────────────────────────────────────────────┘
                        │
                        ▼
                   Tauri v2 Shell
                        │
                        ▼
                   Platform Kernel
      ┌────────────────────────────────────────┐
      │ Event Bus │ Sync Engine │ Lifecycle    │
      │ Auth      │ Startup                    │
      └────────────────────────────────────────┘
             │                    │
      ┌──────┴────────────────────┴──────────────┐
      ▼                                         ▼
 Foundation                              Domain Modules
 ┌──────────────┐                    ┌─────────────────┐
 │ Money  SKU   │                    │ Inventory       │
 │ Cart         │                    │ Reporting       │
 │ Contracts    │                    │ CRM             │
 └──────────────┘                    │ Tax / Discounts │
                                     │ Promotions      │
      │                              │ Loyalty         │
      ▼                              └─────────────────┘
 Infrastructure
 ┌──────────────────────────────────────────────┐
 │ SQLite   │  HAL  │  Security  │  Logging     │
 │ Export   │  Lua Runtime                      │
 │ Bridge   │  LAN     │  Local API             │
 └──────────────────────────────────────────────┘
```

Business logic, UI, hardware drivers, and platform services are isolated — new modules and applications can be added without changing the kernel.

---

## Repository Structure

```
kasir.mu/
├── apps/
│   ├── desktop-client/     # Tauri v2 shell: IPC commands, app state, plugins
│   ├── tablet-client/      # Tablet-optimised Tauri shell
│   ├── cloud-server/       # Cloud HTTP API (axum, hosted tenants)
│   ├── license-server/     # License activation & validation (Go: go.mod, no Cargo.toml)
│   └── unified/            # container glue only: Caddyfile, supervisord.conf, docker-entrypoint.sh, healthcheck.sh + test-healthcheck.sh — a packaging dir, not a Cargo workspace member (this listing named four of the five apps/ dirs until 2026-09-16)
├── crates/                 # 17 libraries (`ls -d crates/*/ | wc -l` = 17, 2026-09-16; = 16 when this line was last measured on 2026-09-14 — the crate that moved it, `qris-core`, landed at `c7009520d` and had never been listed here)
│   ├── oz-api/             # HTTP API server (axum)
│   ├── oz-bridge/          # Command bodies behind the desktop/tablet IPC shims — tauri-free (BridgeCtx, BridgeError)
│   ├── oz-cli/             # CLI tool (backup, export/import .kasirpkg, migrations)
│   ├── oz-core/            # Domain models, SQLite Store, migrations, settings
│   ├── oz-crypto/          # Cryptographic primitives (secret encryption at rest)
│   ├── oz-hal/             # Hardware Abstraction Layer (printer, scanner, drawer, display, scale, EDC terminal)
│   ├── oz-lan/             # LAN event transport: TCP accept loop, per-peer offline buffers, PSK + Noise, KDS discovery & sync
│   ├── oz-local-api/       # Loopback REST server on the shared oz-api router — settings-gated, default-off, token-minted
│   ├── oz-logging/         # Structured logging (console, file, syslog, eventlog)
│   ├── oz-lua/             # Lua scripting engine (mlua — discount, tax, validation)
│   ├── oz-media/           # Media pipeline (compress, crop, thumbnail)
│   ├── oz-notification/    # Email & push notification dispatching
│   ├── oz-payment/         # Payment gateway integrations (Stripe, Square, QRIS, Paddle, mock)
│   ├── oz-plugin/          # Plugin sandbox & lifecycle (Lua scripting bridge)
│   ├── oz-reporting/       # Report generation (EOD, sales summaries)
│   ├── oz-security/        # TLS config, PAN masking, platform keychains
│   └── qris-core/          # QRIS (EMVCo Merchant-Presented Mode TLV) payloads — parse, build, decode, render; NMID + CRC, static → dynamic QR
├── foundation/             # Shared primitives: Money, SKU, Cart, contracts
├── modules/                # Pluggable domain modules (CRM, inventory, tax, etc.)
├── platform/               # Kernel, event bus, sync engine, startup
├── ui/                     # React 18 + TypeScript + Vite
│   └── src/
│       ├── api/            # Per-domain invoke() wrappers — no invoke() in components
│       ├── frontend/       # Shared components, shell layout, design tokens
│       ├── features/       # 301 .tsx files across the domain feature dirs (`find ui/src/features -name '*.tsx' | wc -l` = 301, 2026-09-16; 299 on 2026-09-15)
│       ├── locales/        # Fluent (.ftl) — 54 files (27 en + 27 id), 9,841 message definitions (4,883 en + 4,958 id), 4,958 distinct IDs; 75 of them have NO English definition (2026-09-16, counted PER FILE by `ls ui/src/locales/*.ftl | xargs grep -hcE '^[A-Za-z][A-Za-z0-9_.-]*[[:space:]]*=' | awk '{s+=$1} END {print s}'` and `grep -hoE '^[A-Za-z][A-Za-z0-9_.-]*[[:space:]]*=' ui/src/locales/*.ftl | sed -E 's/[[:space:]]*=$//' | sort -u | wc -l`; the 2026-09-15 pass read 9,809 = 4,867 + 4,942 with 4,942 distinct. A `cat ui/src/locales/*.ftl | grep -c` pipeline under-reads by exactly 1 — 9,840 / 4,957 here — because `sales.ftl` has no final newline (last byte `}`, the only such file of the 54) and `cat` welds its last definition onto the next file's first line; nothing is attributed to dotted `key.attr =` lines, which number 0 tree-wide)
│       └── __tests__/      # Vitest + testing-library (593 files: 320 .tsx, 272 .ts, 1 .json — `find ui/src/__tests__ -type f | wc -l` and the same find per extension, 2026-09-16, the split summing to the total; an earlier pass on 2026-09-16 read 592 = 319 .tsx + 272 .ts + 1 .json and the one-file delta is `b61aedee0`, which added `appShellBootDevRead.test.tsx`; was 589 = 317 .tsx + 271 .ts + 1 .json on 2026-09-15; case total not measured)
├── docs/                   # guides/ (QUICKSTART, ROADMAP, ARCHITECTURE, api-reference, WHITEPAPER — five names sampled out of 24 .md files, `ls -1 docs/guides/*.md | wc -l`; the name `API` this line carried until 2026-09-16 matched no file — `ls docs/guides/API.md` fails, the page is `api-reference.md`), decisions/ (ADRs), specs/, plans/, records/, operations/
├── scripts/                # Example Lua business rule scripts, coverage scripts
└── packaging/              # Linux .deb maintainer scripts + .desktop entry, mobile build guide (MSI/AppImage/DMG come from the Tauri bundler, not this dir)
```

---

## Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Backend | Rust | Domain logic, DB access, hardware control |
| Desktop Shell | Tauri v2 | Native window, IPC bridge, updater |
| Frontend | React 18 + TypeScript + Vite 6 | POS UI |
| Database | SQLite (rusqlite) | On-device persistence, 59 migration files (2026-09-13: `ls crates/oz-core/migrations/*.sql \| wc -l` = 59, of which 58 are SQLite and one is the generated `20260813_init.pg.sql`; the 131 pre-Aug-2026 ones squashed into `20260813_init.sql`) |
| Localization | @fluent/react | All UI strings in `.ftl` files |
| Hardware | oz-hal traits | USB/TCP/BT/serial/mock drivers |
| Money | `i64` minor units | Never `f32`/`f64` — `Currency`, `Money` structs |
| Security | Argon2id + AES-256-GCM + zstd | Encrypted `.ozpkg` snapshots |
| Automation | Lua (mlua) | Discount, tax, validation rules |

---

## Quick Start

```bash
# TODO: update URLs after repo rename
git clone https://github.com/kardelitaitu/oz-pos.git
cd oz-pos  # TODO: will be "kasir.mu" after repo rename
cargo build --workspace
cd ui && npm ci --no-audit --no-fund && cd ..  # see ui/README.md#install-script-approvals
cd apps/desktop-client && cargo tauri dev
```

See [docs/guides/QUICKSTART.md](./docs/guides/QUICKSTART.md) for detailed setup instructions.

---

## Development Commands

### Frontend (ui/)

| Command | Action |
|---|---|
| `npm run dev` | Development server |
| `npm run check:all` | One command — `node ../scripts/check-ui.mjs` (`ui/package.json:11`; no npm-level chaining) — chaining **nine** legs: ESLint → TypeScript → Unit tests → i18n lint → FTL dedupe → Bundle budget → Bundle budget (tablet) → E2E* → Perf smoke, then a `scripts/gates.json` self-audit* (the reading before `b89747b28` said **eight**; that commit added the tablet budget leg between the desktop one and E2E) |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript validation |
| `npm run lint` | ESLint + jsx-a11y |
| `npm run test` | Vitest — 593 files under `ui/src/__tests__` (`find ui/src/__tests__ -type f \| wc -l`; 592 read earlier on 2026-09-16, before `b61aedee0` landed one more test file). No case total: that number exists only in a run, and none is recorded here. |
| `npm run e2e` | Full E2E suite: Docker → Vite → Playwright → cleanup |
| `npm run e2e:headed` | E2E with browser visible |
| `npm run e2e:api` | API integration tests only |
| `npm run e2e:ui` | All UI E2E tests (excl. API) |

> * Structure, named rather than located — `scripts/check-ui.mjs` is being edited concurrently, so its line numbers go stale faster than this row can be read: `grep -n "gate('" scripts/check-ui.mjs` prints the nine legs in run order (ESLint, TypeScript type check, Unit tests (vitest), i18n lint, FTL dedupe, Bundle budget, Bundle budget (tablet), E2E tests (Playwright, provisioned), Perf smoke (Playwright)) — nine call sites, and the seventh of them is the leg `b89747b28` landed on 2026-09-16, which is why this sentence read "eight" until this pass. Only the last two are conditional: `dockerAvailable()` — a `docker info` probe on a 10 s timeout — gates the E2E leg, which is recorded as a skip rather than a failure when Docker is absent, while `playwrightAvailable()` gates the Docker-free perf leg (`npm run test:e2e:perf`). The `gates.json` self-audit is not a UI check either: it compares every manifest `check:all` needle against the gate labels this runner declared and fails closed on drift, so `check:all` can be refused by the manifest itself rather than by any of the nine. See [`ui/README.md`](./ui/README.md) and [`ui/e2e/README.md`](./ui/e2e/README.md) for details.

### Backend (root)

| Command | Action |
|---|---|
| `cargo fmt --all` | Format Rust code (CI checks it: `dev-ci.yml:195` runs `cargo fmt --all -- --check`) |
| `cargo clippy --all-targets -- -D warnings` | Lint — **local only**: `grep -c clippy` over the two live workflows (`dev-ci.yml`, `release.yml`) returns 0, so this gate is run by `scripts/release.sh` and by the step NAMED `clippy workspace` inside `scripts/check.sh` — re-find it by that name with `grep -n 'clippy workspace' scripts/check.sh`, because the `:44` this row carried predates `ee5aacd46`, which moved the step, and a pointer verified today is false the next time anyone inserts a leg above it — never by CI |
| `cargo test --workspace` | Run tests (8,354 `#[test]` fns — `grep -rn --include='*.rs' -o '#\[test\]' . \| wc -l`, 2026-09-16; 8,280 on 2026-09-15) |
| `bash scripts/check.sh` | The FULL local matrix (Rust + UI + migrations), run by hand — **not** what `git push` runs. `.githooks/pre-push` invokes `scripts/run-pre-push.py` and nothing else (one call site, re-find it with `grep -n 'run-pre-push.py \$FLAGS' .githooks/pre-push`; the `:83-84` this row carried moved to a lower line inside the hour when `f5ec19201` widened the hook, which is the reason it is cited by pattern and not by number), and that script never calls `check.sh` (`grep -n check.sh .githooks/pre-push scripts/run-pre-push.py` exits 1, on the working copy and on the `HEAD` blob). What a push does run is a SUBSET of this matrix: the always-on static gates, then path-routed `cargo check --workspace`, `cargo fmt --check`, `ui typecheck`, `ui vitest`, analytics timezone invariance, the website checks and `scripts/lint-i18n.sh`. It runs no Clippy and no Rust test — `grep -n clippy scripts/run-pre-push.py`, `grep -n nextest scripts/run-pre-push.py` and `grep -n 'cargo test' scripts/run-pre-push.py` each exit 1, on the working copy and on `HEAD`. No tally of those tasks is quoted here on purpose: `scripts/run-pre-push.py` was being edited by another lane while this row was written, so a count read off it would measure an in-flight buffer rather than a revision — name the tasks, then re-run the commands. A red pre-push is therefore not a failure of this matrix and a green push is not proof these steps ran (`ee5aacd46` fixed the header comment of `scripts/check.sh`, which carried the same false phrase this cell carries; cited by where it sits, not by line, for the reason just given) |
| `bash scripts/coverage.sh` | Rust + UI coverage reports |
| `bash scripts/reset-dev-pg.sh` | Reset the dev PostgreSQL container to the committed PG_INIT schema (`.ps1` twin on Windows) |

---

## Testing Strategy

| Layer | Approach |
|---|---|
| **Rust** | Unit tests, integration tests, DB migration tests, HAL mock tests |
| **Frontend** | Component tests, feature tests, localization validation, accessibility checks |
| **Coverage** | LLVM source-based (Rust) + v8 (UI) — HTML + JSON in `coverage/` |

Every PR must pass `cargo fmt`, Clippy, `tsc --noEmit`, and all tests before merge — as policy. As enforcement only three of the four fail a build: `cargo fmt --all -- --check` is CI (`dev-ci.yml:195`), typecheck and Vitest are CI (`dev-ci.yml#ui-test`), and **Clippy runs in no live workflow** — `grep -c clippy .github/workflows/dev-ci.yml .github/workflows/release.yml` prints `:0` for both files and exits 1 (2026-09-14); the only clippy left anywhere under `.github/workflows/` is inside the inert `ci.yml.bak`, which `grep -rln clippy .github/workflows/` names alone (lines 5, 230, 251) — so it is local policy: it runs in `scripts/release.sh` and in the step NAMED `clippy workspace` inside `scripts/check.sh` (`grep -n 'clippy workspace' scripts/check.sh` — cited by name, not by line, exactly as the Backend table now does, because line numbers in that script move whenever a leg is inserted above them). A green PR is not proof Clippy passed.

---

## Status

**Phase 4 (CRM, Restaurant, Accounting) in progress.** Measured 2026-09-16 against this checkout: 59 migration files (`ls crates/oz-core/migrations/*.sql | wc -l`), 455 desktop / 320 tablet IPC commands registered — 301 in both, 474 distinct (re-measured 2026-09-16 at HEAD `f8c11fc5c`: the registered pair is what `python scripts/verify-ipc-parity.py` prints and it exits 0 — 444 UI command strings per shell on that same run — while both/distinct are the intersection and union of the two `tauri::generate_handler![…]` lists, which that tool does not print, so re-derive them through its own `extract_handlers()` over `apps/desktop-client/src/lib.rs` and `apps/tablet-client/src/lib.rs` and never by a comma split; the identity 455 + 320 − 301 = 474 closes. The one-name drop from the 455 desktop / 321 tablet with 301 both / 475 distinct that this paragraph and the 2026-09-16 stamp above both carried has a name and is not a correction of a bad count: `d29a7c0f4` retired the tablet's registered `set_hardware_settings` door, and that earlier pair was correct against the tree it measured — it stands above as the dated record it is, and the mirrors took this same side at `7bb8ab0ba`), 301 feature `.tsx` files (`find ui/src/features -name '*.tsx' | wc -l`), 593 files under `ui/src/__tests__` (`find ui/src/__tests__ -type f | wc -l`; the 592 read earlier on 2026-09-16 moved by one file, `appShellBootDevRead.test.tsx` from `b61aedee0`), 8,354 Rust `#[test]` functions (`grep -rn --include='*.rs' -o '#\[test\]' . | wc -l`), and 17 crates (`ls -d crates/*/ | wc -l`). Earlier readings of these same facts are dated history, not current: the 08-09-26 stamp above records 450 distinct IPC (425 / 297 / 272), 183 feature `.tsx`, 8,709 tests and 13 crates; the 2026-09-15 pass in this same paragraph read 453 desktop / 322 tablet (297 both, 478 distinct), 299 feature `.tsx`, 589 test files, 8,280 `#[test]` and 16 crates — that last delta is one crate, `qris-core`, which the structure map had never listed. Every figure here has moved since it was first written.

| Phase | Status | Focus |
|---|---|---|
| 1 | Complete | Platform foundation |
| 2 | Complete | Inventory & Products |
| 3 | Complete | Transactions & Staff |
| 4 | In Progress | CRM, Restaurant, Accounting |
| 5 | In Progress | Multi-store topology, Cloud Sync, Plugin system |

Latest release: **v0.0.39** (on branch `0.0.39`).

See [ROADMAP.md](./docs/guides/ROADMAP.md) for the full phased delivery plan, and [MODULAR_APP_PLAN.md](./docs/guides/MODULAR_APP_PLAN.md) for detailed granular checklists covering feature presets, restaurant workflows, LAN KDS discovery, and Docker cloud server containerization (`apps/cloud-server`).

---

## Contributing

Contributions of all sizes are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for:

- Branch naming and commit conventions
- PR checklist and review guidelines
- Coding standards (Money, DB, errors, etc.)
- Adding new skills and modules
- Security issue reporting

New contributors are encouraged to start with documentation improvements, UI polish, accessibility enhancements, additional tests, or bug fixes labelled **Good First Issue**.

---

## License & Commercial Use

**Proprietary and Confidential — Copyright (c) 2024-2026 kasir.mu Contributors / All Rights Reserved.**

This software (`kasir.mu`) is **NOT open source**. No part of this codebase, associated binaries, or documentation may be copied, modified, distributed, sublicensed, hosted, or deployed in any commercial, non-commercial, or production setting without explicit written permission and a valid executed Commercial License Agreement.

See [LICENSE](./LICENSE) for terms and restrictions. For commercial licensing and pricing inquiries, contact: **adikaradwiatmaja@gmail.com**.

> last audited 08-09-26 by docs-auditor

