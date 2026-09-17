//! Sale inspection commands.
//!
//! `run_sale` dispatches the clap sale actions (list / get / update
//! status) onto the `Store` facade. Money is formatted through
//! `format_minor` — i64 minor units, never floats.

use anyhow::{Context, Result};
use rusqlite::Connection;

use oz_core::db::Store;
use oz_core::{CoreError, SaleStatus, format_minor};

use crate::cli::{SaleAction, SaleArgs};

/// Dispatch a sale subcommand.
pub(crate) fn run_sale(conn: &Connection, args: SaleArgs) -> Result<()> {
    let store = Store::new(conn);

    match args.action {
        SaleAction::List => run_sale_list(&store),
        SaleAction::Get { id, format } => run_sale_get(&store, &id, &format),
        SaleAction::UpdateStatus { id, status } => run_sale_update_status(&store, &id, &status),
    }
}

/// List sales.
pub(crate) fn run_sale_list(store: &Store<'_>) -> Result<()> {
    let sales = store.list_sales().context("listing sales")?;

    if sales.is_empty() {
        println!("No sales found.");
        return Ok(());
    }

    println!(
        "{:<40} {:>10} {:>6}  {:>10}  Date",
        "ID", "Total", "Items", "Status"
    );
    println!(
        "{:-<40} {:->10} {:->6}  {:->10}  {:-<4}",
        "", "", "", "", ""
    );

    for s in &sales {
        let total_str = format_minor(s.total.minor_units, s.total.currency);
        let status_str = match s.status {
            SaleStatus::Pending => "pending",
            SaleStatus::Active => "active",
            SaleStatus::Completed => "done",
            SaleStatus::Voided => "voided",
        };
        let date_str = s.created_at.as_str();
        let date_str = if date_str.len() > 10 {
            &date_str[..10]
        } else {
            date_str
        };
        println!(
            "{:<40} {:>10} {:>6}  {:>10}  {}",
            s.id, total_str, s.line_count, status_str, date_str
        );
    }

    Ok(())
}

/// Print one sale (text or JSON).
pub(crate) fn run_sale_get(store: &Store<'_>, id: &str, format: &str) -> Result<()> {
    match store.get_sale(id).context("looking up sale")? {
        Some(sale) => {
            if format == "json" {
                let json =
                    serde_json::to_string_pretty(&sale).context("serializing sale to JSON")?;
                println!("{json}");
            } else {
                let total_str = format!(
                    "{} {}",
                    format_minor(sale.total.minor_units, sale.currency),
                    std::str::from_utf8(&sale.currency.0).unwrap_or("???"),
                );
                println!("ID:           {}", sale.id);
                println!("Status:       {:?}", sale.status);
                println!("Total:        {}", total_str);
                println!("Line count:   {}", sale.line_count);
                println!(
                    "Currency:     {}",
                    std::str::from_utf8(&sale.currency.0).unwrap_or("???")
                );
                println!("Created:      {}", sale.created_at);
                println!("Updated:      {}", sale.updated_at);

                if !sale.lines.is_empty() {
                    println!();
                    println!("{:<4} {:<24} {:>6} {:>10}", "#", "SKU", "Qty", "Unit");
                    println!("{:-<4} {:-<24} {:->6} {:->10}", "", "", "", "");
                    for line in &sale.lines {
                        let unit_str = format_minor(line.unit_price.minor_units, sale.currency);
                        println!(
                            "{:<4} {:<24} {:>6} {:>10}",
                            line.line_position, line.sku, line.qty, unit_str
                        );
                    }
                }
            }
        }
        None => {
            if format == "json" {
                println!("null");
            } else {
                println!("Sale not found: {id}");
            }
        }
    }

    Ok(())
}

/// Update a sale's status.
pub(crate) fn run_sale_update_status(store: &Store<'_>, id: &str, status_str: &str) -> Result<()> {
    let to = SaleStatus::from_stored_str(status_str).ok_or_else(|| {
        anyhow::anyhow!(
            "invalid status '{status_str}'; expected one of: pending, active, completed, voided"
        )
    })?;

    let sale = store.update_sale_status(id, to).map_err(|e| match &e {
        CoreError::NotFound { .. } => anyhow::anyhow!("Sale not found: {id}"),
        CoreError::Validation { message, .. } => anyhow::anyhow!("Validation error: {message}"),
        _ => anyhow::anyhow!("Error: {e}"),
    })?;

    println!("Sale {id} status updated to {:?}", sale.status);
    Ok(())
}
