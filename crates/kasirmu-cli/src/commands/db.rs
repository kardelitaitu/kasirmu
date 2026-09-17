//! Database lifecycle commands — open, migrate, and first-run seeding.
//!
//! `run_migrate` applies pending `oz_core` migrations; `run_init_db`
//! seeds default settings, a feature preset, ISO-4217 currencies,
//! default roles, and the admin user (with a real argon2 hash of the
//! documented default PIN — CLI-2).

use anyhow::{Context, Result};
use rusqlite::Connection;

use oz_core::db::Store;
use oz_core::{FeatureRegistry, Settings};

use crate::cli::InitDbArgs;

/// Apply pending database migrations.
pub(crate) fn run_migrate(mut conn: Connection) -> Result<()> {
    eprintln!("applying migrations...");
    oz_core::migrations::run(&mut conn).context("applying migrations")?;
    eprintln!("migrations up to date");
    Ok(())
}

/// Seed the database with default settings and a feature preset.
pub(crate) fn run_init_db(conn: &Connection, args: &InitDbArgs) -> Result<()> {
    eprintln!("seeding database with preset: {}", args.preset);

    let store = Store::new(conn);

    // --- Default settings ---
    Settings::set_store_name(conn, "My Store").context("setting store name")?;
    Settings::set_default_currency(conn, "USD").context("setting default currency")?;
    Settings::set(conn, oz_core::settings::keys::SETUP_COMPLETE, "true")
        .context("marking setup complete")?;

    // --- Feature preset ---
    let registry = match args.preset.as_str() {
        "simple-retail" => FeatureRegistry::simple_retail(),
        "restaurant" => FeatureRegistry::restaurant(),
        "full-store" => FeatureRegistry::full_store(),
        "custom" => FeatureRegistry::custom(),
        other => {
            eprintln!("unknown preset '{other}'; using custom (no features enabled)");
            FeatureRegistry::custom()
        }
    };

    let feature_count = registry.count();
    store
        .save_features(&registry)
        .context("saving feature flags")?;
    eprintln!("  enabled {feature_count} feature(s)");

    // --- ISO-4217 Currencies ---
    eprintln!("  seeding currencies...");
    conn.execute_batch(
        "INSERT OR IGNORE INTO currencies (code, numeric_code, name, minor_exponent, symbol) VALUES
            ('USD', '840', 'US Dollar',               2, '$'),
            ('EUR', '978', 'Euro',                    2, '\u{20ac}'),
            ('GBP', '826', 'British Pound',           2, '\u{a3}'),
            ('JPY', '392', 'Japanese Yen',            0, '\u{a5}'),
            ('CAD', '124', 'Canadian Dollar',         2, 'CA$'),
            ('AUD', '036', 'Australian Dollar',       2, 'A$'),
            ('CHF', '756', 'Swiss Franc',             2, 'Fr'),
            ('CNY', '156', 'Chinese Yuan',            2, '\u{5143}'),
            ('INR', '356', 'Indian Rupee',            2, '\u{20b9}'),
            ('BRL', '986', 'Brazilian Real',          2, 'R$'),
            ('MXN', '484', 'Mexican Peso',            2, 'Mex$'),
            ('KRW', '410', 'South Korean Won',        0, '\u{20a9}'),
            ('SEK', '752', 'Swedish Krona',           2, 'kr'),
            ('NOK', '578', 'Norwegian Krone',         2, 'kr'),
            ('DKK', '208', 'Danish Krone',            2, 'kr'),
            ('NZD', '554', 'New Zealand Dollar',      2, 'NZ$'),
            ('SGD', '702', 'Singapore Dollar',        2, 'S$'),
            ('HKD', '344', 'Hong Kong Dollar',        2, 'HK$'),
            ('MYR', '458', 'Malaysian Ringgit',       2, 'RM'),
            ('THB', '764', 'Thai Baht',               2, '\u{e3f}'),
            ('PHP', '608', 'Philippine Peso',         2, '\u{20b1}'),
            ('IDR', '360', 'Indonesian Rupiah',       0, 'Rp'),
            ('VND', '704', 'Vietnamese Dong',         0, '\u{20ab}'),
            ('ZAR', '710', 'South African Rand',      2, 'R'),
            ('RUB', '643', 'Russian Ruble',           2, '\u{20bd}'),
            ('TRY', '949', 'Turkish Lira',            2, '\u{20ba}'),
            ('SAR', '682', 'Saudi Riyal',             2, '\u{fdfc}'),
            ('AED', '784', 'UAE Dirham',              2, '\u{62f}.\u{625}'),
            ('ILS', '376', 'Israeli Shekel',          2, '\u{20aa}'),
            ('PLN', '985', 'Polish Zloty',            2, 'z\u{142}'),
            ('CZK', '203', 'Czech Koruna',            2, 'K\u{10d}'),
            ('HUF', '348', 'Hungarian Forint',        0, 'Ft'),
            ('CLP', '152', 'Chilean Peso',            0, 'CLP$'),
            ('COP', '170', 'Colombian Peso',          2, 'COL$'),
            ('PEN', '604', 'Peruvian Sol',            2, 'S/'),
            ('ARS', '032', 'Argentine Peso',          2, 'AR$'),
            ('NGN', '566', 'Nigerian Naira',          2, '\u{20a6}'),
            ('KES', '404', 'Kenyan Shilling',         2, 'KSh'),
            ('EGP', '818', 'Egyptian Pound',          2, '\u{a3}');",
    )
    .context("seeding currencies")?;

    // --- Default Roles ---
    eprintln!("  seeding roles...");
    conn.execute_batch(
        "INSERT OR IGNORE INTO roles (id, name, description, permissions) VALUES
            ('role-owner',   'owner',   'Full access to all features and settings',
             '[\"*\"]'),
            ('role-manager', 'manager', 'Can manage products, categories, and view reports',
             '[\"products:crud\",\"categories:manage\",\"sales:void\",\"reports:view\"]'),
            ('role-staff', 'staff', 'Operational role with Manager-level access minus settings',
             '[\"sales:process\",\"sales:view\",\"customers:view\"]');",
    )
    .context("seeding roles")?;

    // --- Admin User ---
    eprintln!("  seeding admin user...");
    // CLI-2 fix: seed a REAL argon2 hash of a documented default PIN
    // ("1234") instead of the never-verifying "hashed_pin_placeholder"
    // string that locked the first-run admin out of PIN-gated flows. The
    // operator is told to change the PIN immediately (hashing takes ~100ms
    // — acceptable one-time init cost).
    let default_admin_pin = "1234";
    let admin_pin_hash = oz_core::auth::hash_pin(default_admin_pin)
        .map_err(|e| anyhow::anyhow!("hashing default admin PIN: {e}"))?;
    conn.execute(
        "INSERT OR IGNORE INTO users (id, username, pin_hash, display_name, role_id) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params!["user-admin", "admin", admin_pin_hash, "Admin", "role-owner"],
    )
    .context("seeding admin user")?;
    eprintln!("  NOTE: default admin PIN is '1234' — change it immediately after first login.");

    eprintln!("database initialised successfully");
    Ok(())
}
