/*
last audited 31-08-26 by RSA-Agent (user-role campaign, Section G)
crate: oz-cli | status: SAFE | lint: CLEAN
findings: clean local-operator surface — list/get/create only, no delete; CLI-3 PHC envelope validation fails closed before store (a typo'd hash would otherwise yield a 201 + permanently locked-out user); typed CoreError mapping; local trust domain by design (no RBAC gate — the CLI holder already owns the DB file); no quota check consistent with the owner-tool role, unlike the cloud API (see users.rs G-1)
next: none | perf: N/A
*/
//! User commands.
//!
//! `run_user` dispatches the clap user actions onto the `Store` facade.
//! `run_user_create` validates the `--pin-hash` argument as an argon2
//! PHC string before storing (CLI-3), because a typo'd value would
//! otherwise never verify and silently lock the new user out.

use anyhow::{Context, Result};
use rusqlite::Connection;

use oz_core::CoreError;
use oz_core::db::Store;

use crate::cli::{UserAction, UserArgs};

/// Dispatch a user subcommand.
pub(crate) fn run_user(conn: &Connection, args: UserArgs) -> Result<()> {
    let store = Store::new(conn);

    match args.action {
        UserAction::List => run_user_list(&store),
        UserAction::Get { id } => run_user_get(&store, &id),
        UserAction::Create {
            username,
            pin_hash,
            display_name,
            role_id,
        } => run_user_create(&store, &username, &pin_hash, &display_name, &role_id),
    }
}

/// List users.
pub(crate) fn run_user_list(store: &Store<'_>) -> Result<()> {
    let users = store.list_users().context("listing users")?;

    if users.is_empty() {
        println!("No users found.");
        return Ok(());
    }

    println!(
        "{:<40} {:<16} {:<24} {:<12} Active",
        "ID", "Username", "Display Name", "Role"
    );
    println!("{:-<40} {:-<16} {:-<24} {:-<12} {:-}", "", "", "", "", "");

    for u in &users {
        let active = if u.is_active { "yes" } else { "no" };
        println!(
            "{:<40} {:<16} {:<24} {:<12} {}",
            u.id, u.username, u.display_name, u.role_id, active
        );
    }

    Ok(())
}

/// Print one user.
pub(crate) fn run_user_get(store: &Store<'_>, id: &str) -> Result<()> {
    match store.get_user(id).context("looking up user")? {
        Some(u) => {
            println!("ID:       {}", u.id);
            println!("Username: {}", u.username);
            println!("Name:     {}", u.display_name);
            println!("Role:     {}", u.role_id);
            println!("Active:   {}", if u.is_active { "yes" } else { "no" });
            println!("Created:  {}", u.created_at);
            println!("Updated:  {}", u.updated_at);
        }
        None => {
            println!("User not found: {id}");
        }
    }
    Ok(())
}

/// Validate that a `--pin-hash` argument is a well-formed argon2 PHC
/// string (CLI-3 fix).
///
/// A typo'd or non-PHC value would otherwise be stored verbatim and can
/// never verify — `verify_pin` treats unparseable hashes as a clean
/// mismatch — silently locking the new user out. Fail closed at the CLI
/// boundary instead.
pub(crate) fn validate_phc_pin_hash(pin_hash: &str) -> Result<()> {
    use argon2::password_hash::PasswordHash;
    let parsed = PasswordHash::new(pin_hash)
        .map_err(|e| anyhow::anyhow!("--pin-hash is not a valid PHC string: {e}"))?;
    let alg = parsed.algorithm.as_str();
    if !alg.starts_with("argon2") {
        anyhow::bail!("--pin-hash must be an argon2 hash (got algorithm '{alg}')");
    }
    Ok(())
}

/// Create a user.
pub(crate) fn run_user_create(
    store: &Store<'_>,
    username: &str,
    pin_hash: &str,
    display_name: &str,
    role_id: &str,
) -> Result<()> {
    // CLI-3 fix: a typo'd or non-PHC `--pin-hash` value would be stored
    // verbatim and can never verify (verify_pin treats unparseable hashes
    // as a clean mismatch), silently locking the new user out. Validate the
    // argon2 PHC envelope up front with a fail-closed check.
    validate_phc_pin_hash(pin_hash)?;
    let u = store
        .create_user(username, pin_hash, display_name, role_id)
        .map_err(|e| match &e {
            CoreError::Validation { message, .. } => anyhow::anyhow!("Validation error: {message}"),
            CoreError::Conflict { entity, field } => {
                anyhow::anyhow!("Conflict: {entity} already exists ({field})")
            }
            _ => anyhow::anyhow!("Error: {e}"),
        })?;

    println!("Created user: {} ({})", u.display_name, u.username);
    Ok(())
}
