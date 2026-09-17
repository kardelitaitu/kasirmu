//! Product CRUD commands.
//!
//! `run_product` dispatches the clap product actions onto the `Store`
//! facade; create/update parse the currency code and build `Money`
//! values (i64 minor units) before writing.

use std::str::FromStr;

use anyhow::{Context, Result};
use rusqlite::Connection;

use oz_core::db::Store;
use oz_core::{CoreError, Currency, Money, format_minor};

use crate::cli::{ProductAction, ProductArgs};

/// Dispatch a product subcommand.
pub(crate) fn run_product(conn: &Connection, args: ProductArgs) -> Result<()> {
    let store = Store::new(conn);

    match args.action {
        ProductAction::List => run_product_list(&store),
        ProductAction::Get { sku } => run_product_get(&store, &sku),
        ProductAction::Create {
            sku,
            name,
            price,
            currency,
        } => run_product_create(&store, &sku, &name, price, &currency),
        ProductAction::Update {
            sku,
            name,
            price,
            currency,
            category_id,
            barcode,
        } => run_product_update(
            &store,
            &sku,
            &name,
            price,
            &currency,
            category_id.as_deref(),
            barcode.as_deref(),
        ),
        ProductAction::Delete { sku } => run_product_delete(&store, &sku),
    }
}

/// List all products.
pub(crate) fn run_product_list(store: &Store<'_>) -> Result<()> {
    let products = store.list_products().context("listing products")?;

    if products.is_empty() {
        println!("No products found.");
        return Ok(());
    }

    println!("{:<12} {:<24} {:>10}  Stock", "SKU", "Name", "Price");
    println!("{:-<12} {:-<24} {:->10}  {:-}", "", "", "", "");

    for p in &products {
        let price_str = format_minor(p.product.price.minor_units, p.product.price.currency);
        let stock_str = match p.stock_qty {
            Some(q) => q.to_string(),
            None => "-".into(),
        };
        println!(
            "{:<12} {:<24} {:>10}  {}",
            p.product.sku.as_str(),
            p.product.name,
            price_str,
            stock_str,
        );
    }

    Ok(())
}

/// Print one product.
pub(crate) fn run_product_get(store: &Store<'_>, sku: &str) -> Result<()> {
    match store.get_product(sku).context("looking up product")? {
        Some(p) => {
            let price_str = format!(
                "{} {}",
                format_minor(p.product.price.minor_units, p.product.price.currency),
                std::str::from_utf8(&p.product.price.currency.0).unwrap_or("???"),
            );
            println!("SKU:          {}", p.product.sku.as_str());
            println!("Name:         {}", p.product.name);
            println!("Price:        {}", price_str);
            println!(
                "Category:     {}",
                p.category_name.as_deref().unwrap_or("(none)")
            );
            println!(
                "Barcode:      {}",
                p.product
                    .barcode
                    .as_ref()
                    .map(|b| b.as_str())
                    .unwrap_or("(none)")
            );
            match p.stock_qty {
                Some(q) => println!("Stock:        {q}"),
                None => println!("Stock:        (no inventory)"),
            }
            println!("ID:           {}", p.product.id);
            println!("Created:      {}", p.product.created_at);
            println!("Updated:      {}", p.product.updated_at);
        }
        None => {
            println!("Product not found: {sku}");
        }
    }
    Ok(())
}

/// Create a product.
pub(crate) fn run_product_create(
    store: &Store<'_>,
    sku: &str,
    name: &str,
    price_minor: i64,
    currency_code: &str,
) -> Result<()> {
    let currency = Currency::from_str(currency_code)
        .with_context(|| format!("invalid currency code: {currency_code}"))?;
    let money = Money {
        minor_units: price_minor,
        currency,
    };

    let product = store
        .create_product(sku, name, money, None, None, 0, None)
        .map_err(|e| match &e {
            CoreError::Validation { message, .. } => anyhow::anyhow!("Validation error: {message}"),
            CoreError::Conflict { entity, field } => {
                anyhow::anyhow!("Conflict: {entity} already exists ({field})")
            }
            _ => anyhow::anyhow!("Error: {e}"),
        })?;

    println!(
        "Created product: {} ({})",
        product.name,
        product.sku.as_str()
    );
    Ok(())
}

/// Update a product.
pub(crate) fn run_product_update(
    store: &Store<'_>,
    sku: &str,
    name: &str,
    price_minor: i64,
    currency_code: &str,
    category_id: Option<&str>,
    barcode: Option<&str>,
) -> Result<()> {
    let currency = Currency::from_str(currency_code)
        .with_context(|| format!("invalid currency code: {currency_code}"))?;
    let money = Money {
        minor_units: price_minor,
        currency,
    };

    // Treat empty strings passed via --category-id or --barcode as None
    // so the caller can clear a previously-set value.
    let cat = category_id.filter(|s| !s.is_empty());
    let bar = barcode.filter(|s| !s.is_empty());

    let product = store
        .update_product(sku, name, money, cat, bar, None, None)
        .map_err(|e| match &e {
            CoreError::NotFound { .. } => anyhow::anyhow!("Product not found: {sku}"),
            CoreError::Validation { message, .. } => anyhow::anyhow!("Validation error: {message}"),
            _ => anyhow::anyhow!("Error: {e}"),
        })?;

    println!(
        "Updated product: {} ({})",
        product.name,
        product.sku.as_str()
    );
    Ok(())
}

/// Delete a product.
pub(crate) fn run_product_delete(store: &Store<'_>, sku: &str) -> Result<()> {
    store.delete_product(sku).map_err(|e| match &e {
        CoreError::NotFound { .. } => anyhow::anyhow!("Product not found: {sku}"),
        _ => anyhow::anyhow!("Error: {e}"),
    })?;

    println!("Deleted product: {sku}");
    Ok(())
}
