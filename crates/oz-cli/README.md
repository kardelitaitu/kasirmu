# oz-cli

<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings) · fully verified against tree: all 13 subcommands present (migrate, init-db/init_db, product/category/inventory/sale/customer/user CRUD, backup, restore, export, export-ozpkg, import-ozpkg, --version); presets simple-retail/restaurant/full-store/custom present; "39 currencies" seed confirmed; --db global flag (default oz-pos.db) confirmed; i64 minor-units convention noted · RE-AUDITED 2026-08-31 by docs-auditor: 13 subcommands + presets (hyphenated CLI --preset values, distinct from the feature-system's underscored presets) + --version re-confirmed against post-CLI-5 source; FIXED stale claim — import-ozpkg now WRITES the decrypted payload in a single tx (CLI-1 fix via create_sale_in_tx), no longer "dry-run only / write pending" · CORRECTED 2026-09-11 by docs-auditor: that WRITES claim is now half-stale and the Notes bullet above carries the live wording — settings rows are filtered by the SHARED platform-core predicate is_non_exportable_setting_key, withheld on export-ozpkg and skipped on import-ozpkg (count to stderr), so credential and device-bound settings never enter the package or the target DB; ordinary settings still write. Scope is .ozpkg settings only: a .db / .backup.db snapshot is not filtered by anything and remains the plaintext carrier. -->

CLI tool for OZ-POS maintenance — migrations, backup, export, and data CRUD.

## Subcommands

| Command | Description |
|---------|-------------|
| `oz migrate` | Apply pending SQL migrations |
| `oz init-db [--preset <preset>]` | Seed DB with settings, feature presets (simple-retail, restaurant, full-store, custom), 39 currencies, 3 default roles, and an admin user |
| `oz product list\|get\|create\|update\|delete` | Full product CRUD (SKU, name, price in minor units, category, barcode) |
| `oz category list\|get\|create\|delete` | Category CRUD (id, name, hex colour) |
| `oz inventory get\|adjust` | Stock query by SKU; signed-delta adjustment |
| `oz sale list\|get [--format text\|json]\|update-status` | Sale listing, detail view, status transitions (pending, active, completed, voided) |
| `oz customer list\|get\|create` | Customer CRUD (name, email, phone, notes) |
| `oz user list\|get\|create` | User CRUD (username, pin_hash, display_name, role_id) |
| `oz backup --output <path>` | Online SQLite backup to a file |
| `oz restore --input <path>` | Restore DB from a backup file (file copy) |
| `oz export <daily-summary\|sales-by-hour>` | CSV report written to stdout |
| `oz export-ozpkg --output <path> --password <pw>` | Encrypted `.ozpkg` export (Argon2id + AES-256-GCM); `--types` selects data kinds |
| `oz import-ozpkg --input <path> --password <pw>` | Decrypt and inspect a `.ozpkg` file; `--dry-run` reads metadata without writing |
| `oz --version` | Print version |

## Notes

- DB path defaults to `./kasir.db`; use `--db <path>` (global flag) to override.
- Prices and monetary values are `i64` minor units (e.g. `350` for $3.50).
- `oz import-ozpkg` writes the decrypted payload (products, categories, sales, customers, users, settings) inside a single transaction (sale imports go through the tx-aware `Store::create_sale_in_tx`); `--dry-run` prints metadata and writes nothing. **Settings are filtered, not copied**: every settings row is run through the shared platform-core predicate `is_non_exportable_setting_key`, so credential and device-bound keys are withheld by `export-ozpkg` and SKIPPED by `import-ozpkg` (the count of skipped rows goes to stderr) while ordinary settings such as `store.name` and `currency.default` still travel with their values. The predicate lives in platform core, not in the CLI, so the desktop and tablet export lanes apply the same rule. This filters `.ozpkg` settings only — a whole-file `.db` or `.backup.db` snapshot is not filtered and still carries everything.

> last audited 31-08-26 by docs-auditor
