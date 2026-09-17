//! Customer commands.
//!
//! `run_customer` dispatches the clap customer actions onto the `Store`
//! facade; create validates optional email/phone through the `foundation`
//! value types before writing.

use anyhow::{Context, Result};
use rusqlite::Connection;

use oz_core::CoreError;
use oz_core::db::Store;

use crate::cli::{CustomerAction, CustomerArgs};

/// Dispatch a customer subcommand.
pub(crate) fn run_customer(conn: &Connection, args: CustomerArgs) -> Result<()> {
    let store = Store::new(conn);

    match args.action {
        CustomerAction::List => run_customer_list(&store),
        CustomerAction::Get { id } => run_customer_get(&store, &id),
        CustomerAction::Create {
            name,
            email,
            phone,
            notes,
        } => run_customer_create(
            &store,
            &name,
            email.as_deref(),
            phone.as_deref(),
            notes.as_deref(),
        ),
    }
}

/// List customers.
pub(crate) fn run_customer_list(store: &Store<'_>) -> Result<()> {
    let customers = store.list_customers().context("listing customers")?;

    if customers.is_empty() {
        println!("No customers found.");
        return Ok(());
    }

    println!(
        "{:<40} {:<24} {:<30} {:<16}",
        "ID", "Name", "Email", "Phone"
    );
    println!("{:-<40} {:-<24} {:-<30} {:-<16}", "", "", "", "");

    for c in &customers {
        let email = c.email.as_ref().map(|e| e.as_str()).unwrap_or("-");
        let phone = c.phone.as_ref().map(|p| p.as_str()).unwrap_or("-");
        println!("{:<40} {:<24} {:<30} {:<16}", c.id, c.name, email, phone);
    }

    Ok(())
}

/// Print one customer.
pub(crate) fn run_customer_get(store: &Store<'_>, id: &str) -> Result<()> {
    match store.get_customer(id).context("looking up customer")? {
        Some(c) => {
            println!("ID:      {}", c.id);
            println!("Name:    {}", c.name);
            println!(
                "Email:   {}",
                c.email.as_ref().map(|e| e.as_str()).unwrap_or("(none)")
            );
            println!(
                "Phone:   {}",
                c.phone.as_ref().map(|p| p.as_str()).unwrap_or("(none)")
            );
            println!("Points:  {}", c.loyalty_points);
            println!("Spent:   {} {}", c.total_spent_minor, c.currency);
            println!("Notes:   {}", c.notes);
            println!("Created: {}", c.created_at);
            println!("Updated: {}", c.updated_at);
        }
        None => {
            println!("Customer not found: {id}");
        }
    }
    Ok(())
}

/// Create a customer.
pub(crate) fn run_customer_create(
    store: &Store<'_>,
    name: &str,
    email: Option<&str>,
    phone: Option<&str>,
    notes: Option<&str>,
) -> Result<()> {
    if let Some(e) = email {
        foundation::Email::new(e).map_err(|e| anyhow::anyhow!("{}", e.message))?;
    }
    if let Some(p) = phone {
        foundation::Phone::new(p).map_err(|e| anyhow::anyhow!("{}", e.message))?;
    }

    let c = store
        .create_customer(name, email, phone, notes)
        .map_err(|e| match &e {
            CoreError::Validation { message, .. } => anyhow::anyhow!("Validation error: {message}"),
            _ => anyhow::anyhow!("Error: {e}"),
        })?;

    println!("Created customer: {} ({})", c.name, c.id);
    Ok(())
}
