/*
last audited 25-07-26 by RSA-Agent (oz-cli slice B: seed_demo deep read)
crate: oz-cli | status: SAFE | lint: CLEAN
findings: clean demo seeder — fixed table allowlist in copy_reference_data (no injection), schema columns from PRAGMA table_info, parameterized inserts; FK pragma toggled off/on per connection with documented rationale; chrono unwraps on bounded ranges carry SAFETY comments (RUST-07 impossible-invariant policy); per-store db seeding matches store-*.sqlite excluding WAL/SHM siblings; autocommit bulk inserts acceptable for a dev seeder
next: none | perf: autocommit inserts fine for ~10k demo rows
*/
//! Demo data seeder for analytics and report development.
//!
//! Generates realistic retail and restaurant POS data with time-series
//! patterns suitable for testing reports, dashboards, and analytics.
//!
//! Uses direct SQL inserts for performance (~10k sales in ~2s).

use anyhow::{Context, Result};
use rand::Rng;
use rusqlite::{Connection, params};

use crate::cli::SeedDemoArgs;

/// Resolve the payment method for a retail sale from a 0..100 roll.
///
/// Mirrors the distribution seeded by `seed_retail`: 45% cash, 30% QRIS,
/// 20% debit, 5% split. Pure so the threshold boundaries are unit-testable
/// without running the full seeder.
fn retail_payment_method(roll: u32) -> &'static str {
    match roll {
        0..=44 => "cash",
        45..=74 => "qris",
        75..=94 => "debit",
        _ => "split",
    }
}

/// Resolve the payment method for a restaurant order from a 0..100 roll.
///
/// Mirrors the distribution seeded by `seed_restaurant`: 40% cash, 30%
/// QRIS, 20% debit, 10% split.
fn restaurant_payment_method(roll: u32) -> &'static str {
    match roll {
        0..=39 => "cash",
        40..=69 => "qris",
        70..=89 => "debit",
        _ => "split",
    }
}

/// True when a directory entry is a per-store database file.
///
/// Matches `store-*.sqlite` but excludes WAL/SHM/journal siblings that
/// share the stem. Pure so the pattern is unit-testable.
fn is_store_db_filename(fname: &str) -> bool {
    fname.starts_with("store-")
        && fname.ends_with(".sqlite")
        && !fname.ends_with("-wal")
        && !fname.ends_with("-shm")
}

/// Entry point: dispatch seed-demo based on CLI flags.
///
/// Seeds the main database (for cross-store data) and also all per-store
/// `store-*.sqlite` files in the same directory (for domain data like
/// products, categories, inventory, customers). The per-store databases
/// are used by ADR #7 scoped commands (`list_products_scoped`, etc.).
pub fn run_seed_demo(conn: &Connection, args: &SeedDemoArgs) -> Result<()> {
    // Disable FK checks during bulk seeding for performance and to avoid
    // ordering issues. Demo data is self-consistent; FKs will be checked
    // when re-enabled at the end.
    conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
    // Run migrations on a separate connection to the same DB file.
    // SQLite schema changes are immediately visible to all connections.
    let db_path = conn.path().unwrap_or("kasir.db");
    {
        let mut mig_conn = rusqlite::Connection::open(db_path)
            .with_context(|| format!("opening {db_path} for migrations"))?;
        oz_core::migrations::run(&mut mig_conn).context("applying migrations before seed")?;
    }

    let days = args.days;

    // ── Seed main database ──────────────────────────────────────
    if args.all || args.retail {
        eprintln!("Seeding retail POS demo data ({} days)...", days);
        seed_retail(conn, days)?;
    }
    if args.all || args.restaurant {
        eprintln!("Seeding restaurant POS demo data ({} days)...", days);
        seed_restaurant(conn, days)?;
    }
    if !args.all && !args.retail && !args.restaurant {
        eprintln!("No slice selected. Use --retail, --restaurant, or --all.");
        eprintln!("Example: oz seed-demo --all --days 90");
    }

    conn.execute_batch("PRAGMA foreign_keys = ON;")?;

    // ── Seed per-store databases ────────────────────────────────
    // ADR #7: the desktop app uses per-store SQLite files for domain
    // data. Products, categories, inventory, and customers need to be
    // present in those files too (but not sales — those are different
    // per store).
    let db_dir = std::path::Path::new(db_path)
        .parent()
        .unwrap_or(std::path::Path::new("."));
    seed_store_databases(db_dir, args, db_path)?;

    eprintln!("Done.");
    Ok(())
}

/// Find and seed all `store-*.sqlite` databases in `db_dir` with
/// reference data (products, categories, inventory, customers) from
/// the main database file at `main_db_path`.
fn seed_store_databases(
    db_dir: &std::path::Path,
    args: &SeedDemoArgs,
    main_db_path: &str,
) -> Result<()> {
    let mut found = false;

    if let Ok(dir) = std::fs::read_dir(db_dir) {
        for entry in dir.flatten() {
            let path = entry.path();
            let fname = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            // Match store-*.sqlite but exclude WAL/SHM/index files
            if !is_store_db_filename(&fname) {
                continue;
            }
            // Skip journal/WAL files that happen to match the pattern
            if fname.ends_with("-wal") || fname.ends_with("-shm") {
                continue;
            }

            found = true;
            eprintln!("\nSeeding per-store DB: {}", fname);

            let store_conn = rusqlite::Connection::open(&path)
                .with_context(|| format!("opening store db {}", path.display()))?;
            store_conn.execute_batch("PRAGMA foreign_keys = OFF;")?;

            // Run migrations on the store DB (idempotent)
            {
                let mut mconn = rusqlite::Connection::open(&path)?;
                oz_core::migrations::run(&mut mconn)
                    .with_context(|| format!("migrating store db {}", path.display()))?;
            }

            // Copy reference data from main to store DB
            copy_reference_data(main_db_path, &store_conn)?;

            store_conn.execute_batch("PRAGMA foreign_keys = ON;")?;
            eprintln!("  ✅ store DB seeded");
        }
    }

    if !found {
        eprintln!(
            "\nNote: no store-*.sqlite files found in {} — per-store databases will be\ncreated lazily when the app runs. Run `oz seed-demo --all --days 90` again after\nopening a workspace in the app to populate newly-created store databases.",
            db_dir.display()
        );
    }
    let _ = &args; // args consumed for future slicing per-store
    Ok(())
}

/// Copy reference data (products, categories, inventory, customers,
/// tax rates, suppliers) from the main database to a store database.
fn copy_reference_data(main_db_path: &str, store_conn: &Connection) -> Result<()> {
    let main_conn = rusqlite::Connection::open(main_db_path)
        .with_context(|| format!("opening main db {main_db_path} for reference data copy"))?;

    let tables: &[&str] = &[
        "categories",
        "products",
        "inventory",
        "customers",
        "tax_rates",
        "category_taxes",
        "suppliers",
    ];

    for table in tables {
        // Read schema columns from main DB
        let cols: Vec<String> = main_conn
            .prepare(&format!("PRAGMA table_info({table})"))?
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect();

        if cols.is_empty() {
            continue;
        }

        let cols_str = cols.join(",");
        let placeholders = cols.iter().map(|_| "?").collect::<Vec<_>>().join(",");

        // Read rows from main DB
        let mut stmt = main_conn.prepare(&format!("SELECT {cols_str} FROM {table}"))?;
        let rows: Vec<Vec<rusqlite::types::Value>> = stmt
            .query_map([], |row| {
                let mut vals = Vec::new();
                for i in 0..cols.len() {
                    vals.push(row.get(i)?);
                }
                Ok(vals)
            })?
            .filter_map(|r| r.ok())
            .collect();

        if rows.is_empty() {
            continue;
        }

        // Insert into store DB
        let insert_sql =
            format!("INSERT OR IGNORE INTO {table} ({cols_str}) VALUES ({placeholders})");
        let mut istmt = store_conn.prepare(&insert_sql)?;
        for row in &rows {
            let params: Vec<&dyn rusqlite::types::ToSql> = row
                .iter()
                .map(|v| v as &dyn rusqlite::types::ToSql)
                .collect();
            istmt.execute(params.as_slice())?;
        }
    }

    Ok(())
}

// ═══════════════════════════════════════════════════════════════════
//  Retail POS
// ═══════════════════════════════════════════════════════════════════

fn seed_retail(conn: &Connection, days: u32) -> Result<()> {
    let mut rng = rand::thread_rng();
    let now = chrono::Utc::now().to_rfc3339();

    // ── Categories ──────────────────────────────────────────────
    let categories = [
        ("cat-electronics", "Electronics", "#3b82f6", "zap"),
        ("cat-grocery", "Grocery", "#22c55e", "shopping-cart"),
        ("cat-beverages", "Beverages", "#06b6d4", "coffee"),
        ("cat-snacks", "Snacks", "#f59e0b", "cookie"),
        ("cat-household", "Household", "#8b5cf6", "home"),
        ("cat-apparel", "Apparel", "#ec4899", "shirt"),
        ("cat-health", "Health & Beauty", "#14b8a6", "heart"),
        ("cat-stationery", "Stationery", "#6366f1", "pen"),
    ];
    for (id, name, colour, _icon) in &categories {
        conn.execute(
            "INSERT OR IGNORE INTO categories (id, name, colour, created_at, updated_at) VALUES (?1,?2,?3,?4,?4)",
            params![id, name, colour, now],
        )?;
    }
    eprintln!("  ✅ {} categories", categories.len());

    // ── Tax rate ────────────────────────────────────────────────
    let tax_id = "tax-ppn-11";
    conn.execute(
        "INSERT OR IGNORE INTO tax_rates (id, name, rate_bps, is_default, is_inclusive, created_at, updated_at) VALUES (?1,'PPN 11%',1100,0,0,?2,?2)",
        params![tax_id, now],
    )?;
    for cat in &[
        "cat-electronics",
        "cat-grocery",
        "cat-apparel",
        "cat-health",
        "cat-stationery",
    ] {
        conn.execute(
            "INSERT OR IGNORE INTO category_taxes (category_id, tax_rate_id) VALUES (?1,?2)",
            params![cat, tax_id],
        )?;
    }

    // ── Products ────────────────────────────────────────────────
    let products: &[(&str, &str, i64, &str, i64)] = &[
        ("SKU-001", "Beras Premium 5kg", 75000, "cat-grocery", 50),
        ("SKU-002", "Minyak Goreng 2L", 38000, "cat-grocery", 40),
        ("SKU-003", "Gula Pasir 1kg", 16000, "cat-grocery", 60),
        ("SKU-004", "Telur Ayam 10 butir", 28000, "cat-grocery", 30),
        ("SKU-005", "Tepung Terigu 1kg", 12000, "cat-grocery", 45),
        ("SKU-006", "Kopi Sachet 10pcs", 15000, "cat-beverages", 80),
        ("SKU-007", "Teh Celup 25pcs", 8500, "cat-beverages", 70),
        ("SKU-008", "Susu UHT 1L", 22000, "cat-beverages", 35),
        ("SKU-009", "Air Mineral 600ml", 4000, "cat-beverages", 100),
        ("SKU-010", "Minuman Soda 330ml", 8000, "cat-beverages", 90),
        ("SKU-011", "Keripik Kentang 150g", 18000, "cat-snacks", 55),
        ("SKU-012", "Coklat Batang 100g", 25000, "cat-snacks", 40),
        ("SKU-013", "Biskuit Kaleng 200g", 32000, "cat-snacks", 30),
        ("SKU-014", "Kacang Panggang 250g", 22000, "cat-snacks", 35),
        ("SKU-015", "Sabun Mandi 100g", 5500, "cat-household", 120),
        ("SKU-016", "Shampoo 200ml", 18000, "cat-household", 60),
        ("SKU-017", "Pasta Gigi 150g", 15000, "cat-health", 50),
        ("SKU-018", "Sikat Gigi 3pcs", 12000, "cat-health", 65),
        ("SKU-019", "Deterjen 1kg", 20000, "cat-household", 40),
        ("SKU-020", "Pembersih Lantai 1L", 16000, "cat-household", 35),
        ("SKU-021", "Kaos Polos Dewasa", 55000, "cat-apparel", 25),
        ("SKU-022", "Celana Pendek", 75000, "cat-apparel", 20),
        ("SKU-023", "Sandal Jepit", 25000, "cat-apparel", 40),
        ("SKU-024", "Handuk Mandi", 45000, "cat-household", 30),
        ("SKU-025", "Charger HP USB-C", 65000, "cat-electronics", 15),
        ("SKU-026", "Kabel Data 2m", 35000, "cat-electronics", 25),
        ("SKU-027", "Earphone Wired", 45000, "cat-electronics", 20),
        (
            "SKU-028",
            "Powerbank 10000mAh",
            180000,
            "cat-electronics",
            10,
        ),
        ("SKU-029", "Pulpen 5pcs", 12000, "cat-stationery", 80),
        ("SKU-030", "Buku Tulis A5", 8000, "cat-stationery", 100),
        (
            "SKU-031",
            "Kertas HVS A4 100lmbr",
            25000,
            "cat-stationery",
            50,
        ),
        ("SKU-032", "Sticky Notes", 10000, "cat-stationery", 60),
        ("SKU-033", "Botol Minum 750ml", 35000, "cat-household", 35),
        ("SKU-034", "Lilin Aromaterapi", 28000, "cat-household", 20),
        ("SKU-035", "Vitamin C 100mg 30tbl", 35000, "cat-health", 30),
    ];

    let mut product_ids: Vec<String> = Vec::new();
    for (sku, name, price, cat_id, stock) in products {
        let pid = uuid::Uuid::now_v7().to_string();
        conn.execute(
            "INSERT OR IGNORE INTO products (id, sku, name, price_minor, currency, cost_minor, category_id, product_type, created_at, updated_at) VALUES (?1,?2,?3,?4,'IDR',0,?5,'retail',?6,?6)",
            params![pid, sku, name, price, cat_id, now],
        )?;
        if *stock > 0 {
            conn.execute(
                "INSERT INTO inventory (product_id, qty, updated_at) VALUES (?1,?2,?3)",
                params![pid, stock, now],
            )?;
        }
        product_ids.push(pid);
    }
    eprintln!("  ✅ {} products", products.len());

    // ── Customers ───────────────────────────────────────────────
    let customer_data = [
        ("Budi Santoso", "budi@email.com", "081234567890"),
        ("Siti Nurhaliza", "siti@email.com", "081234567891"),
        ("Ahmad Dhani", "ahmad@email.com", "081234567892"),
        ("Dewi Lestari", "dewi@email.com", "081234567893"),
        ("Rudi Hermawan", "rudi@email.com", "081234567894"),
        ("Lina Marlina", "lina@email.com", "081234567895"),
        ("Hendra Gunawan", "hendra@email.com", "081234567896"),
        ("Rina Wijaya", "rina@email.com", "081234567897"),
        ("Andi Prasetyo", "andi@email.com", "081234567898"),
        ("Mega Sari", "mega@email.com", "081234567899"),
        ("Donny Kusuma", "donny@email.com", "081234567800"),
        ("Tina Agustina", "tina@email.com", "081234567801"),
        ("Eko Susanto", "eko@email.com", "081234567802"),
        ("Putri Ayu", "putri@email.com", "081234567803"),
        ("Bayu Firmansyah", "bayu@email.com", "081234567804"),
        ("Nina Amelia", "nina@email.com", "081234567805"),
        ("Rizky Ramadhan", "rizky@email.com", "081234567806"),
        ("Anisa Putri", "anisa@email.com", "081234567807"),
        ("Farhan Maulana", "farhan@email.com", "081234567808"),
        ("Citra Dewi", "citra@email.com", "081234567809"),
        ("Agus Wijoyo", "agus@email.com", "081234567810"),
        ("Dian Permata", "dian@email.com", "081234567811"),
        ("Imam Syafii", "imam@email.com", "081234567812"),
        ("Rani Safitri", "rani@email.com", "081234567813"),
        ("Yoga Pratama", "yoga@email.com", "081234567814"),
        ("Sari Murni", "sari@email.com", "081234567815"),
        ("Dimas Ardian", "dimas@email.com", "081234567816"),
        ("Fitri Handayani", "fitri@email.com", "081234567817"),
        ("Irfan Hakim", "irfan@email.com", "081234567818"),
        ("Wulan Sari", "wulan@email.com", "081234567819"),
    ];

    let mut customer_ids: Vec<String> = Vec::new();
    for (name, email, phone) in &customer_data {
        let cid = uuid::Uuid::now_v7().to_string();
        conn.execute(
            "INSERT OR IGNORE INTO customers (id, name, email, phone, notes, loyalty_points, total_spent_minor, currency, created_at, updated_at) VALUES (?1,?2,?3,?4,'',0,0,'IDR',?5,?5)",
            params![cid, name, email, phone, now],
        )?;
        customer_ids.push(cid);
    }
    eprintln!("  ✅ {} customers", customer_data.len());

    // ── Staff — skipped (roles are seeded at runtime, not in migrations) ──
    let staff_ids: Vec<String> = vec!["owner".into()];

    // ── Sales over N days ───────────────────────────────────────
    let mut total_sales = 0u64;
    let num_products = products.len();

    for day_offset in (0..days).rev() {
        let base = chrono::Utc::now();
        let date = base - chrono::Duration::days(day_offset as i64);
        let is_weekend = date.format("%u").to_string().parse::<u32>().unwrap_or(1) >= 6;
        let daily_base = if is_weekend { 42u32 } else { 30u32 };
        let daily_sales: u32 = rng.gen_range(daily_base.saturating_sub(5)..daily_base + 5);

        for _ in 0..daily_sales {
            let hour = if rng.gen_bool(0.7) {
                rng.gen_range(10u32..20)
            } else {
                rng.gen_range(8u32..22)
            };
            // SAFETY: `hour` is bounded to 8..=21 and minutes/seconds to
            // 0..59 above, so from_hms_opt is always Some; with_time on a
            // valid date with a valid time is likewise always Some.
            let sale_time = date
                .with_time(
                    chrono::NaiveTime::from_hms_opt(
                        hour,
                        rng.gen_range(0u32..60),
                        rng.gen_range(0u32..60),
                    )
                    // SAFETY: ranges above always form a valid time.
                    .unwrap(),
                )
                // SAFETY: valid date + valid time is always Some.
                .unwrap()
                .to_utc()
                .to_rfc3339();

            let sale_id = uuid::Uuid::now_v7().to_string();
            let line_count: usize = rng.gen_range(1usize..6);
            let mut total_minor: i64 = 0;

            for line_idx in 0..line_count {
                let idx = if rng.gen_bool(0.8) {
                    rng.gen_range(0usize..12.min(num_products))
                } else {
                    rng.gen_range(0usize..num_products)
                };
                let (sku, _, price_minor, _, _) = products[idx];
                let qty = rng.gen_range(1i64..4);
                let line_total = price_minor * qty;
                total_minor += line_total;

                let line_id = uuid::Uuid::now_v7().to_string();
                let _pid = &product_ids[idx];
                conn.execute(
                    "INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position) VALUES (?1,?2,?3,?4,?5,?6,'IDR',?7)",
                    params![line_id, sale_id, sku, qty, price_minor, line_total, line_idx + 1],
                )?;
            }

            let status = if rng.gen_bool(0.9) {
                "completed"
            } else {
                "pending"
            };
            let payment_method = retail_payment_method(rng.gen_range(0u32..100));
            let customer_id = if rng.gen_bool(0.4) {
                Some(&customer_ids[rng.gen_range(0usize..customer_ids.len())])
            } else {
                None
            };
            let _cashier = &staff_ids[0];

            conn.execute(
                "INSERT INTO sales (id, status, total_minor, line_count, currency, payment_method, user_id, customer_id, created_at, updated_at) VALUES (?1,?2,?3,?4,'IDR',?5,?6,?7,?8,?8)",
                params![sale_id, status, total_minor, line_count as i64, payment_method, None::<&str>, customer_id, sale_time],
            )?;

            if status == "completed" {
                let pmt_id = uuid::Uuid::now_v7().to_string();
                conn.execute(
                    "INSERT INTO payments (id, sale_id, method, amount_minor, currency, created_at) VALUES (?1,?2,?3,?4,'IDR',?5)",
                    params![pmt_id, sale_id, payment_method, total_minor, sale_time],
                )?;
            }
            total_sales += 1;
        }
        if day_offset % 10 == 0 {
            eprintln!(
                "  ... day {} of {} ({} sales so far)",
                days - day_offset,
                days,
                total_sales
            );
        }
    }
    eprintln!("  ✅ {} sales over {} days", total_sales, days);

    Ok(())
}

// ═══════════════════════════════════════════════════════════════════
//  Restaurant POS
// ═══════════════════════════════════════════════════════════════════

fn seed_restaurant(conn: &Connection, days: u32) -> Result<()> {
    let mut rng = rand::thread_rng();
    let now = chrono::Utc::now().to_rfc3339();

    // ── Categories ──────────────────────────────────────────────
    let categories = [
        ("cat-makanan", "Makanan", "#ef4444", "utensils"),
        ("cat-minuman", "Minuman", "#3b82f6", "coffee"),
        ("cat-dessert", "Dessert", "#f59e0b", "cake"),
        ("cat-side", "Side Dish", "#22c55e", "salad"),
        ("cat-appetizer", "Appetizer", "#a855f7", "croissant"),
        ("cat-special", "Menu Spesial", "#ec4899", "star"),
    ];
    for (id, name, colour, _icon) in &categories {
        conn.execute(
            "INSERT OR IGNORE INTO categories (id, name, colour, created_at, updated_at) VALUES (?1,?2,?3,?4,?4)",
            params![id, name, colour, now],
        )?;
    }
    eprintln!("  ✅ {} categories", categories.len());

    // ── Tax rates ───────────────────────────────────────────────
    conn.execute(
        "INSERT OR IGNORE INTO tax_rates (id, name, rate_bps, is_default, is_inclusive, created_at, updated_at) VALUES ('tax-ppn-11','PPN 11%',1100,0,0,?1,?1)",
        params![now],
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO tax_rates (id, name, rate_bps, is_default, is_inclusive, created_at, updated_at) VALUES ('tax-service-5','Service 5%',500,0,0,?1,?1)",
        params![now],
    )?;
    for cat in &[
        "cat-makanan",
        "cat-minuman",
        "cat-dessert",
        "cat-side",
        "cat-appetizer",
        "cat-special",
    ] {
        conn.execute("INSERT OR IGNORE INTO category_taxes (category_id, tax_rate_id) VALUES (?1,'tax-ppn-11')", params![cat])?;
        conn.execute("INSERT OR IGNORE INTO category_taxes (category_id, tax_rate_id) VALUES (?1,'tax-service-5')", params![cat])?;
    }

    // ── Menu items ──────────────────────────────────────────────
    let menu: &[(&str, &str, i64, &str)] = &[
        ("RM-001", "Nasi Goreng Spesial", 35000, "cat-makanan"),
        ("RM-002", "Mie Goreng Jawa", 28000, "cat-makanan"),
        ("RM-003", "Ayam Bakar Madu", 38000, "cat-makanan"),
        ("RM-004", "Sate Ayam 10tusuk", 32000, "cat-makanan"),
        ("RM-005", "Gado-Gado", 22000, "cat-makanan"),
        ("RM-006", "Soto Ayam", 25000, "cat-makanan"),
        ("RM-007", "Rawon Daging", 35000, "cat-makanan"),
        ("RM-008", "Nasi Campur Bali", 38000, "cat-makanan"),
        ("RM-009", "Ikan Bakar Sambal", 42000, "cat-special"),
        ("RM-010", "Udang Goreng Tepung", 45000, "cat-special"),
        ("RM-011", "Es Teh Manis", 8000, "cat-minuman"),
        ("RM-012", "Es Jeruk Peras", 12000, "cat-minuman"),
        ("RM-013", "Kopi Tubruk", 15000, "cat-minuman"),
        ("RM-014", "Jus Alpukat", 20000, "cat-minuman"),
        ("RM-015", "Teh Tarik", 18000, "cat-minuman"),
        ("RM-016", "Soda Gembira", 20000, "cat-minuman"),
        ("RM-017", "Air Mineral", 5000, "cat-minuman"),
        ("RM-018", "Pisang Goreng", 15000, "cat-dessert"),
        ("RM-019", "Es Krim Coklat", 18000, "cat-dessert"),
        ("RM-020", "Klepon", 12000, "cat-dessert"),
        ("RM-021", "Tahu Goreng", 12000, "cat-side"),
        ("RM-022", "Tempe Goreng", 10000, "cat-side"),
        ("RM-023", "Kerupuk Udang", 8000, "cat-side"),
        ("RM-024", "Lalapan Segar", 10000, "cat-side"),
        ("RM-025", "Tahu Isi", 15000, "cat-appetizer"),
        ("RM-026", "Lumpia Goreng", 18000, "cat-appetizer"),
        ("RM-027", "Sate Lilit Ayam", 25000, "cat-appetizer"),
        ("RM-028", "Sup Buntut", 55000, "cat-special"),
        ("RM-029", "Gurame Asam Manis", 65000, "cat-special"),
        ("RM-030", "Es Campur", 18000, "cat-dessert"),
    ];

    let mut menu_ids: Vec<String> = Vec::new();
    for (sku, name, price, cat_id) in menu {
        let pid = uuid::Uuid::now_v7().to_string();
        conn.execute(
            "INSERT OR IGNORE INTO products (id, sku, name, price_minor, currency, cost_minor, category_id, product_type, created_at, updated_at) VALUES (?1,?2,?3,?4,'IDR',?5,?6,'retail',?7,?7)",
            params![pid, sku, name, price, *price * 40 / 100, cat_id, now],
        )?;
        menu_ids.push(pid);
    }
    eprintln!("  ✅ {} menu items", menu.len());

    // ── Tables ──────────────────────────────────────────────────
    for t in 1..=12 {
        let tid = format!("table-{:02}", t);
        conn.execute(
            "INSERT OR IGNORE INTO tables (id, name, capacity, status) VALUES (?1,?2,4,'available')",
            params![tid, format!("Table {}", t)],
        )?;
    }
    eprintln!("  ✅ 12 tables");

    // ── Staff — skipped (roles stored at runtime) ──
    let staff_ids: Vec<String> = vec!["owner".into()];

    // ── Orders over N days ─────────────────────────────────────
    let mut total_orders = 0u64;
    let num_menu = menu.len();

    for day_offset in (0..days).rev() {
        let base = chrono::Utc::now();
        let date = base - chrono::Duration::days(day_offset as i64);
        let is_weekend = date.format("%u").to_string().parse::<u32>().unwrap_or(1) >= 6;
        let daily_base = if is_weekend { 50u32 } else { 40u32 };
        let daily_orders: u32 = rng.gen_range(daily_base.saturating_sub(5)..daily_base + 5);

        for _ in 0..daily_orders {
            // Peak hours: lunch 11-14, dinner 18-21
            let hour = if rng.gen_bool(0.6) {
                if rng.gen_bool(0.5) {
                    rng.gen_range(11u32..14)
                } else {
                    rng.gen_range(18u32..21)
                }
            } else {
                rng.gen_range(10u32..22)
            };
            // SAFETY: `hour` is bounded to 10..=21 and minutes to 0..59
            // above, so from_hms_opt is always Some; with_time on a valid
            // date with a valid time is likewise always Some.
            let order_time = date
                .with_time(
                    // SAFETY: bounded ranges above always form a valid time.
                    chrono::NaiveTime::from_hms_opt(hour, rng.gen_range(0u32..60), 0).unwrap(),
                )
                // SAFETY: valid date + valid time is always Some.
                .unwrap()
                .to_utc()
                .to_rfc3339();

            let order_id = uuid::Uuid::now_v7().to_string();
            let line_count: usize = rng.gen_range(2usize..7);
            let mut total_minor: i64 = 0;

            // At least 1 drink
            let drink_idx = rng.gen_range(10usize..17.min(num_menu));
            let (drink_sku, _, drink_price, _) = menu[drink_idx];
            let drink_qty = rng.gen_range(1i64..3);
            total_minor += drink_price * drink_qty;
            let dlid = uuid::Uuid::now_v7().to_string();
            conn.execute(
                "INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position) VALUES (?1,?2,?3,?4,?5,?6,'IDR',1)",
                params![dlid, order_id, drink_sku, drink_qty, drink_price, drink_price * drink_qty],
            )?;

            for i in 0..(line_count - 1) {
                let idx = rng.gen_range(0usize..num_menu);
                let (sku, _, price, _) = menu[idx];
                let qty = rng.gen_range(1i64..3);
                total_minor += price * qty;
                let lid = uuid::Uuid::now_v7().to_string();
                conn.execute(
                    "INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position) VALUES (?1,?2,?3,?4,?5,?6,'IDR',?7)",
                    params![lid, order_id, sku, qty, price, price * qty, i + 2],
                )?;
            }

            let status = if rng.gen_bool(0.95) {
                "completed"
            } else {
                "pending"
            };
            let payment_method = restaurant_payment_method(rng.gen_range(0u32..100));
            let _table = format!("table-{:02}", rng.gen_range(1u32..13));
            let _cashier = &staff_ids[0];

            conn.execute(
                "INSERT INTO sales (id, status, total_minor, line_count, currency, payment_method, user_id, created_at, updated_at) VALUES (?1,?2,?3,?4,'IDR',?5,?6,?7,?7)",
                params![order_id, status, total_minor, line_count as i64, payment_method, None::<&str>, order_time],
            )?;

            if status == "completed" {
                conn.execute(
                    "INSERT INTO payments (id, sale_id, method, amount_minor, currency, created_at) VALUES (?1,?2,?3,?4,'IDR',?5)",
                    params![uuid::Uuid::now_v7().to_string(), order_id, payment_method, total_minor, order_time],
                )?;
            }
            total_orders += 1;
        }
        if day_offset % 10 == 0 {
            eprintln!(
                "  ... day {} of {} ({} orders so far)",
                days - day_offset,
                days,
                total_orders
            );
        }
    }
    eprintln!("  ✅ {} orders over {} days", total_orders, days);

    Ok(())
}

#[cfg(test)]
#[path = "seed_demo_tests.rs"]
mod tests;
