/*
last audited 25-07-26 by RSA-Agent (oz-cli slice A: commands deep read; CLI-1 + CLI-2 + CLI-3 + CLI-4 FIXED, CLI-5 FIXED 25-07-26 via this split)
crate: oz-cli | status: SAFE | lint: CLEAN
findings: CLI-1 FIXED — run_import_ozpkg sale imports now use the new tx-aware Store::create_sale_in_tx (the previous store.create_sale opened a nested transaction inside the import transaction and failed with cannot-start-a-transaction-within-a-transaction, rolling back sale imports). CLI-2 FIXED — init-db seeds the admin user with a real argon2 hash of the documented default PIN 1234 (never-verifying hashed_pin_placeholder locked the first-run admin out) and prints a change-it-now warning. CLI-3 FIXED — run_user_create validates the --pin-hash argument as an argon2 PHC string (argon2 PHC parse + algorithm check, new argon2 workspace dep; placeholder/garbage/foreign-algorithm values are rejected up front). CLI-4 FIXED — run_restore checkpoints the WAL (TRUNCATE) then deletes stale -wal/-shm sidecars before the backup copy (simulated-crash test; hot sidecars would otherwise win the next open and resurrect pre-restore data). CLI-5 FIXED — the 1,290-line commands.rs is split into per-command-family modules under commands/ (db, backup, catalog, product, sale, customer, user, ozpkg), each well under the 600-line guideline; behavior is unchanged and commands_tests.rs keeps exercising every family through the mod.rs re-exports. Otherwise clean: parameterized SQL, single-tx import for other types, recoverable currency UTF-8 handling per RUST-07, Argon2id + AES-256-GCM export path, dry-run support
next: none | perf: N/A
*/
//! Command implementations for the `oz` CLI.
//!
//! Subcommand handlers live in per-family modules (`db`, `backup`,
//! `catalog`, `product`, `sale`, `customer`, `user`, `ozpkg`); this
//! module owns database opening, the clap dispatch entry point, and the
//! re-exports that keep the sibling `commands_tests.rs` family-wide.

#![allow(clippy::items_after_test_module)]

use anyhow::{Context, Result};
use clap::{CommandFactory, Parser};

use crate::cli::*;
use crate::seed_demo::run_seed_demo;

pub(crate) mod backup;
pub(crate) mod catalog;
pub(crate) mod credential_deltas;
pub(crate) mod customer;
pub(crate) mod db;
pub(crate) mod ozpkg;
pub(crate) mod product;
pub(crate) mod sale;
pub(crate) mod user;

// Family re-exports: the dispatch below and `commands_tests.rs` (which
// uses `use super::*`) address handlers through this module. Globs keep
// every family handler visible without enumerating them here.
pub(crate) use backup::*;
pub(crate) use catalog::*;
pub(crate) use credential_deltas::*;
pub(crate) use customer::*;
pub(crate) use db::*;
pub(crate) use ozpkg::*;
pub(crate) use product::*;
pub(crate) use sale::*;
pub(crate) use user::*;

// Re-exported in turn by the `use super::*` in `commands_tests.rs`.
#[cfg(test)]
use oz_core::db::Store;
#[cfg(test)]
use oz_core::{CoreError, Currency, Money, SaleStatus};
use rusqlite::Connection;
#[cfg(test)]
use std::str::FromStr;

/// Open the store database with the CLI's standard pragmas.
pub(crate) fn open_db(path: &str) -> Result<Connection> {
    let conn = Connection::open(path).with_context(|| format!("opening database at {path}"))?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .context("enabling foreign_keys")?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .context("enabling WAL")?;
    Ok(conn)
}

/// Open the store for `credential-deltas` ONLY, refusing a `--db` path that this
/// command would have to CREATE before `open_db` gets the chance to do it.
///
/// The footgun, measured rather than assumed: `--db` defaults to ./kasir.db in
/// the CURRENT directory and `Connection::open` CREATES a missing path, so a
/// mistyped database opened an empty file, every count came back zero, and the
/// command reported nothing-to-delete about a file it had just made — and left
/// the ghost and its sidecars behind even though it deleted nothing.
///
/// Scoped to this one subcommand on purpose. `migrate`, `init-db` and `restore`
/// legitimately PROVISION a database on first run, so pushing this check into the
/// shared `open_db` would convert a one-command footgun into a first-run outage
/// for the rest of the tool, which is a worse bug than the one being fixed.
///
/// This is the FIRST line of defence and it is about the PATH.
/// `credential_deltas::require_store_database` stays the SECOND and is about the
/// CONTENTS: a file that exists but holds no settings table is a distinct failure
/// from a file that does not exist, and the two messages say which of the two they
/// are.
pub(crate) fn open_store_for_credential_deltas(path: &str) -> Result<Connection> {
    if !std::path::Path::new(path).is_file() {
        anyhow::bail!(
            "oz credential-deltas never opens a store it would have to create: no database exists at {path}. --db defaults to ./kasir.db in the CURRENT directory, so a mistyped or relative path lands here as a file that is not there, and this command inspects an existing store rather than provisioning one (unlike migrate / init-db / restore, which do create). If you meant to inspect a live store, take a copy first and run against the copy: oz backup --output <copy.db>, then oz credential-deltas --db <copy.db>. Nothing was created, read, or deleted."
        );
    }
    open_db(path)
}
/// Parse CLI arguments and dispatch to the matching subcommand.
pub fn run() -> Result<()> {
    let cli = Cli::parse();

    // Every lane but one opens through the shared helper, WAL pragma and all.
    // credential-deltas is refused a path it would have to create BEFORE the
    // open: a report computed against a freshly created empty file is not a clean
    // database, it is a lie about one. See open_store_for_credential_deltas.
    let conn = if matches!(cli.command, Some(Command::CredentialDeltas(_))) {
        open_store_for_credential_deltas(&cli.db)?
    } else {
        open_db(&cli.db)?
    };

    match cli.command {
        Some(Command::Migrate) => run_migrate(conn),
        Some(Command::InitDb(args)) => run_init_db(&conn, &args),
        Some(Command::Product(args)) => run_product(&conn, args),
        Some(Command::Backup { output }) => run_backup(&conn, &output),
        Some(Command::Export { kind }) => run_export(&conn, &kind),
        Some(Command::Category(args)) => run_category(&conn, args),
        Some(Command::Inventory(args)) => run_inventory(&conn, args),
        Some(Command::Sale(args)) => run_sale(&conn, args),
        Some(Command::Customer(args)) => run_customer(&conn, args),
        Some(Command::User(args)) => run_user(&conn, args),
        Some(Command::Restore { input }) => run_restore(conn, &input),
        Some(Command::ExportOzpkg {
            output,
            types,
            password,
        }) => run_export_ozpkg(&conn, &output, &types, &password),
        Some(Command::ImportOzpkg {
            input,
            password,
            dry_run,
        }) => run_import_ozpkg(&conn, &input, &password, dry_run),
        Some(Command::SeedDemo(args)) => run_seed_demo(&conn, &args),
        Some(Command::CredentialDeltas(args)) => run_credential_deltas(&conn, &args),
        None => {
            let mut cmd = Cli::command();
            cmd.print_help()?;
            println!();
            Ok(())
        }
    }
}

#[cfg(test)]
#[path = "../commands_tests.rs"]
mod tests;
