/*
last audited 25-07-26 by RSA-Agent (kasirmu-cli slice B: verified)
crate: kasirmu-cli | status: SAFE | lint: CLEAN
findings: clean — clap definitions / error taxonomy / deny(unsafe_code) crate root
next: none | perf: N/A
*/
#![allow(missing_docs)]
//! `oz` — OZ-POS command-line tool.
//!
//! Subcommands:
//! - `oz migrate` — apply pending SQL migrations
//! - `oz init-db` — seed the database with default settings + feature preset
//! - `oz product list` — list all products
//! - `oz product get <sku>` — show a product by SKU
//! - `oz product create <sku> <name> <price>` — create a new product
//! - `oz product update <sku> <name> <price>` — update an existing product
//! - `oz product delete <sku>` — delete a product
//! - `oz backup` — snapshot the local SQLite store (scaffold)
//! - `oz export` — write a CSV report (scaffold)

use clap::{Args, Parser, Subcommand};

/// OZ-POS command-line tool.
#[derive(Debug, Parser)]
#[command(name = "kasir", version, about = "kasir.mu maintenance and migration CLI")]
pub struct Cli {
    /// Path to the SQLite database (default: ./kasir.db).
    #[arg(short, long, global = true, default_value = "kasir.db")]
    pub db: String,

    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Apply pending SQL migrations to the database.
    Migrate,
    /// Seed the database with default settings and feature flags.
    InitDb(InitDbArgs),
    /// Manage products (list, get, create, update, delete).
    Product(ProductArgs),
    /// Snapshot the local SQLite store to a backup file.
    Backup {
        /// Destination path for the backup file.
        #[arg(short, long)]
        output: String,
    },
    /// Write a CSV report for the given time window (scaffold).
    Export {
        /// Report kind (e.g. `daily-summary`, `sales-by-hour`).
        kind: String,
    },
    /// Manage categories (list, get, create, delete).
    Category(CategoryArgs),
    /// Manage inventory (get, adjust).
    Inventory(InventoryArgs),
    /// Manage sales (list, get, update-status).
    Sale(SaleArgs),
    /// Manage customers (list, get, create).
    Customer(CustomerArgs),
    /// Manage users (list, get, create).
    User(UserArgs),
    /// Restore the database from a backup file.
    Restore {
        /// Path to the backup file.
        #[arg(short, long)]
        input: String,
    },
    /// Export data to an encrypted .kasirpkg file (also accepts legacy .ozpkg files).
    ExportKasirpkg {
        /// Output file path.
        #[arg(short, long)]
        output: String,
        /// Data types to include (comma-separated: products,categories,sales,customers,users,settings).
        #[arg(short, long, default_value = "all")]
        types: String,
        /// Encryption password.
        #[arg(short, long)]
        password: String,
    },
    /// Import data from an encrypted .kasirpkg file (also accepts legacy .ozpkg files).
    ImportKasirpkg {
        /// Input .kasirpkg file path.
        #[arg(short, long)]
        input: String,
        /// Decryption password.
        #[arg(short, long)]
        password: String,
        /// Dry-run mode: show what would be imported without writing.
        #[arg(long)]
        dry_run: bool,
    },
    /// Seed demo data for analytics and report development.
    SeedDemo(SeedDemoArgs),
    /// Report (default) or delete (--confirm) credential-key rows in the settings delta ledger.
    #[command(long_about = crate::commands::credential_deltas::LONG_HELP.as_str())]
    CredentialDeltas(CredentialDeltasArgs),
}

#[derive(Debug, Args)]
pub struct SeedDemoArgs {
    /// Seed retail POS data (store-pos).
    #[arg(long)]
    pub retail: bool,
    /// Seed restaurant POS data (restaurant-pos).
    #[arg(long)]
    pub restaurant: bool,
    /// Seed both retail and restaurant data.
    #[arg(long)]
    pub all: bool,
    /// Number of days of history to generate (default: 90).
    #[arg(long, default_value = "90")]
    pub days: u32,
}

#[derive(Debug, Args)]
pub struct CredentialDeltasArgs {
    /// Delete the matched ledger rows. Without this flag the command only reports.
    #[arg(long)]
    pub confirm: bool,
}

#[derive(Debug, Args)]
pub struct InitDbArgs {
    /// Feature preset to apply (simple-retail, restaurant, full-store, custom).
    #[arg(long, default_value = "simple-retail")]
    pub preset: String,
}

#[derive(Debug, Args)]
pub struct ProductArgs {
    #[command(subcommand)]
    pub action: ProductAction,
}

#[derive(Debug, Subcommand)]
pub enum ProductAction {
    /// List all products.
    List,
    /// Show a product by SKU.
    Get {
        /// Product SKU.
        sku: String,
    },
    /// Create a new product.
    Create {
        /// Unique product SKU.
        sku: String,
        /// Display name.
        name: String,
        /// Price in minor units (e.g. 350 for $3.50).
        price: i64,
        /// ISO-4217 currency code (default: USD).
        #[arg(long, default_value = "USD")]
        currency: String,
    },
    /// Update an existing product by SKU.
    Update {
        /// Product SKU to update.
        sku: String,
        /// New display name.
        name: String,
        /// New price in minor units.
        price: i64,
        /// ISO-4217 currency code (default: USD).
        #[arg(long, default_value = "USD")]
        currency: String,
        /// New category id (or empty to clear).
        #[arg(long)]
        category_id: Option<String>,
        /// New barcode (or empty to clear).
        #[arg(long)]
        barcode: Option<String>,
    },
    /// Delete a product by SKU.
    Delete {
        /// Product SKU to delete.
        sku: String,
    },
}

#[derive(Debug, Args)]
pub struct CategoryArgs {
    #[command(subcommand)]
    pub action: CategoryAction,
}

#[derive(Debug, Subcommand)]
pub enum CategoryAction {
    /// List all categories.
    List,
    /// Show a category by id.
    Get {
        /// Category id.
        id: String,
    },
    /// Create a new category.
    Create {
        /// Unique category id (e.g. "cat-drinks").
        id: String,
        /// Display name.
        name: String,
        /// Hex colour (e.g. "#06b6d4").
        colour: String,
    },
    /// Delete a category by id.
    Delete {
        /// Category id.
        id: String,
    },
}

#[derive(Debug, Args)]
pub struct InventoryArgs {
    #[command(subcommand)]
    pub action: InventoryAction,
}

#[derive(Debug, Subcommand)]
pub enum InventoryAction {
    /// Show current stock for a product by SKU.
    Get {
        /// Product SKU.
        sku: String,
    },
    /// Adjust stock for a product by SKU (e.g. +10 to restock, -3 to sell).
    Adjust {
        /// Product SKU.
        sku: String,
        /// Signed delta (e.g. +10 or -3).
        delta: i64,
    },
}

#[derive(Debug, Args)]
pub struct SaleArgs {
    #[command(subcommand)]
    pub action: SaleAction,
}

#[derive(Debug, Subcommand)]
pub enum SaleAction {
    /// List all sales (most recent first).
    List,
    /// Show a sale by id.
    Get {
        /// Sale UUID.
        id: String,
        /// Output format (default: text, or "json").
        #[arg(long, default_value = "text")]
        format: String,
    },
    /// Transition a sale to a new status.
    UpdateStatus {
        /// Sale UUID.
        id: String,
        /// New status (pending, active, completed, voided).
        status: String,
    },
}

#[derive(Debug, Args)]
pub struct CustomerArgs {
    #[command(subcommand)]
    pub action: CustomerAction,
}

#[derive(Debug, Subcommand)]
pub enum CustomerAction {
    /// List all customers.
    List,
    /// Show a customer by id.
    Get {
        /// Customer id.
        id: String,
    },
    /// Create a new customer.
    Create {
        /// Display name.
        name: String,
        /// Email address.
        #[arg(long)]
        email: Option<String>,
        /// Phone number.
        #[arg(long)]
        phone: Option<String>,
        /// Free-form notes.
        #[arg(long)]
        notes: Option<String>,
    },
}

#[derive(Debug, Args)]
pub struct UserArgs {
    #[command(subcommand)]
    pub action: UserAction,
}

#[derive(Debug, Subcommand)]
pub enum UserAction {
    /// List all users.
    List,
    /// Show a user by id.
    Get {
        /// User id.
        id: String,
    },
    /// Create a new user.
    Create {
        /// Login username.
        username: String,
        /// Hashed PIN/password.
        pin_hash: String,
        /// Display name shown on the POS UI.
        display_name: String,
        /// Role id (e.g. "role-owner", "role-staff").
        role_id: String,
    },
}

#[cfg(test)]
#[path = "cli_tests.rs"]
mod tests;
