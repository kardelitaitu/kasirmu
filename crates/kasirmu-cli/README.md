# kasirmu-cli

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (2 minor) · Re-audit; the five-part 2026-07-22/08-31/09-11/09-29 accretion below is merged at the bottom as original evidence. VERIFIED BY RE-DERIVING, not by inheriting: the binary is `kasir` (cargo metadata bin name — the crate is `kasirmu-cli`), the global `--db` flag defaults to `var/kasir.db` (cli.rs:32, with the doc comment on :31), and the `Command` enum holds **17** variants (cli.rs:40-109) each of which has a row in the table. `init-db` seeds **39** currencies (the INSERT block holds 39 `('XXX'` rows), three default roles (owner/manager/staff at db.rs:103-111) and an admin user with a real Argon2 hash; the four presets named (simple-retail, restaurant, full-store, custom) match the `--preset` values in db.rs:38-41. `rekey --confirm` really does refuse a non-durable keychain and a `--db` path it would have to create (rekey.rs:129, :539, :590), and `credential-deltas --confirm` deletes LEDGER rows only, never a settings row (credential_deltas.rs:107, :550). MINOR 1, FIXED: the export/import rows omitted that both commands also accept the legacy `.ozpkg` extension, which the CLI's own `--help` documents on cli.rs:74 and :86 — a reader with an old package would not know it still loads. MINOR 2, FIXED: the rows now show `--types` and `--dry-run` as the optional flags they are rather than implying a bare form. LEFT AS WRITTEN: the `.kasirpkg` settings-filter paragraph (its predicate `is_non_exportable_setting_key` lives in platform core, and the claim that a whole-file `.db` snapshot is unfiltered is the point of the paragraph); the `--db` default history note. NOT re-measured: any command against a live database — this environment cannot link the binary (no MSVC libs), so every claim here was verified from source, not by running it. · Superseded stamp bodies follow as plain quoted text:

Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings) · fully verified against tree: all 13 subcommands present (migrate, init-db/init_db, product/category/inventory/sale/customer/user CRUD, backup, restore, export, export, import, --version); presets simple-retail/restaurant/full-store/custom present; "39 currencies" seed confirmed; --db global flag (default kasir.db) confirmed; i64 minor-units convention noted · RE-AUDITED 2026-08-31 by docs-auditor: 13 subcommands + presets (hyphenated CLI --preset values, distinct from the feature-system's underscored presets) + --version re-confirmed against post-CLI-5 source; FIXED stale claim — import now WRITES the decrypted payload in a single tx (CLI-1 fix via create_sale_in_tx), no longer "dry-run only / write pending" · CORRECTED 2026-09-11 by docs-auditor: that WRITES claim is now half-stale and the Notes bullet above carries the live wording — settings rows are filtered by the SHARED platform-core predicate is_non_exportable_setting_key, withheld on export and skipped on import (count to stderr), so credential and device-bound settings never enter the package or the target DB; ordinary settings still write. Scope is .ozpkg settings only: a .db / .backup.db snapshot is not filtered by anything and remains the plaintext carrier. · CORRECTED 2026-09-29: the "all 13 subcommands present" count above was stale by FOUR — `seed-demo`, `credential-deltas`, `stock-variance` and the newly landed `rekey` were all absent from the table. All four are now listed. The count is deliberately NOT restated here, because it is the number that rotted; read the table, which is the thing an operator uses. -->

CLI tool for kasir.mu maintenance — migrations, backup, export, and data CRUD.

## Subcommands

| Command | Description |
|---------|-------------|
| `kasir migrate` | Apply pending SQL migrations |
| `kasir init-db [--preset <preset>]` | Seed DB with settings, feature presets (simple-retail, restaurant, full-store, custom), 39 currencies, 3 default roles, and an admin user |
| `kasir product list\|get\|create\|update\|delete` | Full product CRUD (SKU, name, price in minor units, category, barcode) |
| `kasir category list\|get\|create\|delete` | Category CRUD (id, name, hex colour) |
| `kasir inventory get\|adjust` | Stock query by SKU; signed-delta adjustment |
| `kasir sale list\|get [--format text\|json]\|update-status` | Sale listing, detail view, status transitions (pending, active, completed, voided) |
| `kasir customer list\|get\|create` | Customer CRUD (name, email, phone, notes) |
| `kasir user list\|get\|create` | User CRUD (username, pin_hash, display_name, role_id) |
| `kasir backup --output <path>` | Online SQLite backup to a file |
| `kasir restore --input <path>` | Restore DB from a backup file (file copy) |
| `kasir export-csv <kind>` | CSV report for a time window, written to stdout (scaffold — `kind` e.g. `daily-summary`) |
| `kasir export --output <path> --password <pw> [--types <kinds>]` | Encrypted `.kasirpkg` export (Argon2id + AES-256-GCM); `--types` selects data kinds (default `all`) |
| `kasir import --input <path> --password <pw> [--dry-run]` | Import a `.kasirpkg` file; `--dry-run` reads metadata without writing. Both `export` and `import` also accept the legacy `.ozpkg` extension |
| `kasir seed-demo [--retail\|--restaurant\|--all] [--days <n>]` | Seed demo data for analytics and report development (default 90 days) |
| `kasir credential-deltas [--confirm]` | Report deny-listed credential rows in the `setting_updated` ledger AND in the live `settings` table, form by form; `--confirm` deletes LEDGER rows only and never a settings row |
| `kasir stock-variance [--min-difference <n>] [--limit <n>]` | Report (read-only) where `stock_summary` disagrees with the `stock_movements` ledger |
| `kasir rekey [--confirm]` | Rotate the per-install at-rest key and re-encrypt every row sealed under it. A bare run reports what is in scope; `--confirm` performs the rotation. Refuses a non-durable keychain and a `--db` path it would have to create |
| `kasir --version` | Print version |

## Notes

- DB path defaults to `var/kasir.db`; use `--db <path>` (global flag) to override. It used to
  default to `./kasir.db` — the local SQLite default moved under `var/` on 2026-10-01 (`0aba04b35`),
  and this line was stale until now.
- Prices and monetary values are `i64` minor units (e.g. `350` for $3.50).
- `kasir import` writes the decrypted payload (products, categories, sales, customers, users, settings) inside a single transaction (sale imports go through the tx-aware `Store::create_sale_in_tx`); `--dry-run` prints metadata and writes nothing. **Settings are filtered, not copied**: every settings row is run through the shared platform-core predicate `is_non_exportable_setting_key`, so credential and device-bound keys are withheld by `export` and SKIPPED by `import` (the count of skipped rows goes to stderr) while ordinary settings such as `store.name` and `currency.default` still travel with their values. The predicate lives in platform core, not in the CLI, so the desktop and tablet export lanes apply the same rule. This filters `.kasirpkg` settings only — a whole-file `.db` or `.backup.db` snapshot is not filtered and still carries everything.

> last audited 11-10-26 by docs-auditor
