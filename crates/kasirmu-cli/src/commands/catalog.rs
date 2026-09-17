//! Catalog-adjacent commands — category CRUD and stock inspection.
//!
//! `run_category`/`run_inventory` are thin clap-action dispatchers over
//! the `Store` facade; adjustments keep the deprecation allow because
//! the CLI intentionally exposes the legacy adjust door.

use anyhow::{Context, Result};
use rusqlite::Connection;

use oz_core::CoreError;
use oz_core::db::Store;

use crate::cli::{CategoryAction, CategoryArgs, InventoryAction, InventoryArgs};

/// Dispatch a category subcommand.
pub(crate) fn run_category(conn: &Connection, args: CategoryArgs) -> Result<()> {
    let store = Store::new(conn);

    match args.action {
        CategoryAction::List => run_category_list(&store),
        CategoryAction::Get { id } => run_category_get(&store, &id),
        CategoryAction::Create { id, name, colour } => {
            run_category_create(&store, &id, &name, &colour)
        }
        CategoryAction::Delete { id } => run_category_delete(&store, &id),
    }
}

/// List all categories.
pub(crate) fn run_category_list(store: &Store<'_>) -> Result<()> {
    let categories = store.list_categories().context("listing categories")?;

    if categories.is_empty() {
        println!("No categories found.");
        return Ok(());
    }

    println!("{:<24} {:<24}  Colour", "ID", "Name");
    println!("{:-<24} {:-<24}  {:-}", "", "", "");

    for c in &categories {
        println!("{:<24} {:<24}  {}", c.id, c.name, c.colour);
    }

    Ok(())
}

/// Print one category.
pub(crate) fn run_category_get(store: &Store<'_>, id: &str) -> Result<()> {
    match store.get_category(id).context("looking up category")? {
        Some(c) => {
            println!("ID:     {}", c.id);
            println!("Name:   {}", c.name);
            println!("Colour: {}", c.colour);
        }
        None => {
            println!("Category not found: {id}");
        }
    }
    Ok(())
}

/// Create a category.
pub(crate) fn run_category_create(
    store: &Store<'_>,
    id: &str,
    name: &str,
    colour: &str,
) -> Result<()> {
    let cat = store
        .create_category(id, name, colour, "")
        .map_err(|e| match &e {
            CoreError::Validation { message, .. } => anyhow::anyhow!("Validation error: {message}"),
            CoreError::Conflict { entity, field } => {
                anyhow::anyhow!("Conflict: {entity} already exists ({field})")
            }
            _ => anyhow::anyhow!("Error: {e}"),
        })?;

    println!("Created category: {} ({})", cat.name, cat.id);
    Ok(())
}

/// Delete a category.
pub(crate) fn run_category_delete(store: &Store<'_>, id: &str) -> Result<()> {
    store.delete_category(id).map_err(|e| match &e {
        CoreError::NotFound { .. } => anyhow::anyhow!("Category not found: {id}"),
        _ => anyhow::anyhow!("Error: {e}"),
    })?;

    println!("Deleted category: {id}");
    Ok(())
}

/// Dispatch an inventory subcommand.
pub(crate) fn run_inventory(conn: &Connection, args: InventoryArgs) -> Result<()> {
    let store = Store::new(conn);

    match args.action {
        InventoryAction::Get { sku } => run_inventory_get(&store, &sku),
        InventoryAction::Adjust { sku, delta } => run_inventory_adjust(&store, &sku, delta),
    }
}

/// Print current stock for one SKU.
pub(crate) fn run_inventory_get(store: &Store<'_>, sku: &str) -> Result<()> {
    let product = store.get_product(sku).context("looking up product")?;

    match product {
        Some(p) => {
            let qty = p.stock_qty.unwrap_or(0);
            println!("SKU:    {}", p.product.sku.as_str());
            println!("Name:   {}", p.product.name);
            println!("Stock:  {qty}");
        }
        None => {
            println!("Product not found: {sku}");
        }
    }

    Ok(())
}

/// Adjust stock by `delta`.
#[allow(deprecated)]
pub(crate) fn run_inventory_adjust(store: &Store<'_>, sku: &str, delta: i64) -> Result<()> {
    let new_qty = store.adjust_stock(sku, delta).map_err(|e| match &e {
        CoreError::NotFound { .. } => anyhow::anyhow!("Product not found: {sku}"),
        CoreError::Validation { message, .. } => anyhow::anyhow!("Validation error: {message}"),
        _ => anyhow::anyhow!("Error: {e}"),
    })?;

    let verb = if delta >= 0 { "restocked" } else { "sold" };
    println!("Stock {verb} for {sku} (delta: {delta:+}) — new qty: {new_qty}");
    Ok(())
}
