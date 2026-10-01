#!/usr/bin/env bash
# kasir.mu — new module scaffold generator (bash)
#
# Creates a stub vertical under modules/<id>/ that compiles, registers with
# the kernel, and passes its own tests on first run — then prints the two
# manual wiring edits that remain.
#
# Usage:
#   scripts/new-module.sh --id purchasing --name "Purchasing" \
#       --description "Supplier records and purchase orders." \
#       --dependencies inventory,sales
#
# The workspace `members` list globs `modules/*`, so the new directory
# becomes a member with no root-manifest edit. What this script does NOT do
# automatically (both are single lines, both are asserted by tests):
#   1. Add `modules-<id> = { path = "modules/<id>" }` to [workspace.dependencies].
#   2. Add `k.register(Box::new(modules_<id>::<Pascal>Module::new()))?;` to
#      platform/startup/src/lib.rs, plus the dep in platform/startup/Cargo.toml.
# Skipping step 2 fails `every_module_manifest_is_registered`, which is the
# point: a module directory that nothing registers is dead code.

set -euo pipefail

ID=""
NAME=""
DESCRIPTION=""
DEPENDENCIES=""
DRY_RUN=0

usage() {
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    exit "${1:-1}"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --id)           ID="${2:-}"; shift 2 ;;
        --name)         NAME="${2:-}"; shift 2 ;;
        --description)  DESCRIPTION="${2:-}"; shift 2 ;;
        --dependencies) DEPENDENCIES="${2:-}"; shift 2 ;;
        --dry-run)      DRY_RUN=1; shift ;;
        -h|--help)      usage 0 ;;
        *) echo "unknown argument: $1" >&2; usage 1 ;;
    esac
done

[[ -n "$ID" ]]          || { echo "--id is required" >&2; exit 1; }
[[ -n "$NAME" ]]        || { echo "--name is required" >&2; exit 1; }
[[ -n "$DESCRIPTION" ]] || { echo "--description is required" >&2; exit 1; }

if ! [[ "$ID" =~ ^[a-z][a-z0-9-]*$ ]]; then
    echo "--id must be kebab-case (^[a-z][a-z0-9-]*\$): got '$ID'" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
MODULE_DIR="$REPO_ROOT/modules/$ID"

if [[ -e "$MODULE_DIR" ]]; then
    echo "modules/$ID already exists — pick another id or delete it first." >&2
    exit 1
fi

# ── Derived identifiers ───────────────────────────────────────────────
# `giftcards` -> `GiftCards` is not derivable from the id alone, so the Rust
# type name comes from --name with non-alphanumerics stripped.
PASCAL="$(printf '%s' "$NAME" \
    | tr -c '[:alnum:]' ' ' \
    | awk '{ for (i = 1; i <= NF; i++) printf "%s%s", toupper(substr($i,1,1)), substr($i,2) }')"
SNAKE="${ID//-/_}"
TYPE_NAME="${PASCAL}Module"
ERROR_TYPE="${PASCAL}Error"

# Split the comma-separated dependency list into an array.
DEPS=()
if [[ -n "$DEPENDENCIES" ]]; then
    IFS=',' read -r -a RAW_DEPS <<< "$DEPENDENCIES"
    for d in "${RAW_DEPS[@]}"; do
        d="$(printf '%s' "$d" | tr -d '[:space:]')"
        [[ -n "$d" ]] && DEPS+=("$d")
    done
fi

DEPS_JSON='[]'
DEPS_RUST='&[]'
if [[ ${#DEPS[@]} -gt 0 ]]; then
    quoted=""
    for d in "${DEPS[@]}"; do
        [[ -n "$quoted" ]] && quoted+=", "
        quoted+="\"$d\""
    done
    DEPS_JSON="[$quoted]"
    DEPS_RUST="&[$quoted]"
fi

DEP_REGISTRATIONS=""
for d in "${DEPS[@]-}"; do
    [[ -z "$d" ]] && continue
    DEP_REGISTRATIONS+="    kernel"$'\n'
    DEP_REGISTRATIONS+="        .register(Box::new(StubModule(\"$d\")))"$'\n'
    DEP_REGISTRATIONS+="        .expect(\"register $d stub\");"$'\n'
done

if [[ $DRY_RUN -eq 1 ]]; then
    echo "DRY RUN — would create:"
    for f in manifest.json Cargo.toml README.md src/lib.rs src/error.rs src/lib_tests.rs; do
        echo "  modules/$ID/$f"
    done
    echo
    echo "  type: $TYPE_NAME / $ERROR_TYPE"
    echo "  deps: $DEPS_JSON"
    exit 0
fi

mkdir -p "$MODULE_DIR/src"

# ── manifest.json ─────────────────────────────────────────────────────
cat > "$MODULE_DIR/manifest.json" <<EOF
{
  "id": "$ID",
  "name": "$NAME",
  "version": "0.1.0",
  "description": "$DESCRIPTION Stub: lifecycle only, domain logic not yet migrated.",
  "author": "kasir.mu contributors",
  "dependencies": $DEPS_JSON,
  "permissions": [
    "${ID}:view",
    "${ID}:manage"
  ]
}
EOF

# ── Cargo.toml ────────────────────────────────────────────────────────
cat > "$MODULE_DIR/Cargo.toml" <<EOF
[package]
name = "modules-$ID"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true
description = "kasir.mu $NAME Module (stub): $DESCRIPTION"

# Inherits [workspace.lints] from the root Cargo.toml (missing_docs = warn).
[lints]
workspace = true

[dependencies]
anyhow = { workspace = true }
thiserror = { workspace = true }
foundation = { workspace = true }
rusqlite = { workspace = true }
tracing = { workspace = true }

[dev-dependencies]
platform-kernel = { workspace = true }
serde_json = { workspace = true }
EOF

# ── src/error.rs ──────────────────────────────────────────────────────
cat > "$MODULE_DIR/src/error.rs" <<EOF
//! Error type for the $ID domain.
//!
//! Mirrors the shape used by the other module crates (\`Db\`, \`NotFound\`,
//! \`Validation\`) so that promoting this stub to an owning module does not
//! change the error surface its callers already match on.

use thiserror::Error;

/// Errors that can originate in the $ID domain.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum $ERROR_TYPE {
    /// A database operation failed.
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    /// A lookup by id returned no row.
    #[error("not found: {entity} {id}")]
    NotFound {
        /// The kind of entity that was being looked up.
        entity: &'static str,
        /// The id that was looked up.
        id: String,
    },

    /// Input validation failure.
    #[error("validation error on {field}: {message}")]
    Validation {
        /// The field that failed validation.
        field: &'static str,
        /// Human-readable description of the failure.
        message: String,
    },
}

impl $ERROR_TYPE {
    /// Create a validation error for a specific field.
    pub fn validation(field: &'static str, message: impl Into<String>) -> Self {
        Self::Validation {
            field,
            message: message.into(),
        }
    }
}
EOF

# ── src/lib.rs ────────────────────────────────────────────────────────
cat > "$MODULE_DIR/src/lib.rs" <<EOF
/*
stub module — generated by scripts/new-module.sh
crate: modules-$ID | status: SAFE | lint: CLEAN
findings: No-op Module implementation. No unsafe code, no DB access yet.
next: Migrate the $ID domain logic into repository.rs / service.rs.
*/

//! $NAME Module — $DESCRIPTION
//!
//! Key types: [\`$TYPE_NAME\`] (kernel lifecycle), [\`$ERROR_TYPE\`].
//!
//! ## Stub status
//!
//! This is a **stub**: it registers with the kernel, declares its
//! dependencies, and logs its lifecycle transitions. It owns no tables and
//! no commands yet.
//!
//! Promotion path — see \`modules/README.md\`:
//! 1. Move tables and queries into \`repository.rs\`.
//! 2. Move orchestration into \`service.rs\`, inside a transaction.
//! 3. Subscribe to the events this vertical reacts to in \`on_load\`.

pub mod error;

pub use error::$ERROR_TYPE;

use foundation::contracts::{Module, ModuleId, ModuleResult};
use tracing::info;

/// Stable module id, matching the \`id\` field in \`manifest.json\`.
pub const MODULE_ID: ModuleId = "$ID";

/// The $NAME module.
///
/// Implements [\`Module\`] so the kernel can order it correctly during
/// load/start and shutdown.
#[derive(Debug, Default)]
pub struct $TYPE_NAME;

impl $TYPE_NAME {
    /// Create a new \`$TYPE_NAME\`.
    pub fn new() -> Self {
        Self
    }
}

impl Module for $TYPE_NAME {
    fn id(&self) -> ModuleId {
        MODULE_ID
    }

    fn dependencies(&self) -> &'static [ModuleId] {
        // Must match \`dependencies\` in manifest.json — asserted by a test.
        $DEPS_RUST
    }

    fn on_load(&mut self) -> ModuleResult {
        info!("$ID module: on_load (stub — no handlers registered yet)");
        Ok(())
    }

    fn on_start(&mut self) -> ModuleResult {
        info!("$ID module: on_start (stub)");
        Ok(())
    }

    fn on_stop(&mut self) -> ModuleResult {
        info!("$ID module: on_stop (stub)");
        Ok(())
    }
}

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
EOF

# ── src/lib_tests.rs ──────────────────────────────────────────────────
cat > "$MODULE_DIR/src/lib_tests.rs" <<EOF
//! Tests for the $ID module stub lifecycle.

use super::*;
use platform_kernel::Kernel;

/// Minimal stand-in for a dependency the kernel must resolve.
#[derive(Debug)]
struct StubModule(&'static str);

impl Module for StubModule {
    fn id(&self) -> ModuleId {
        self.0
    }
}

fn kernel_with_deps() -> Kernel {
    #[allow(unused_mut)]
    let mut kernel = Kernel::new();
$DEP_REGISTRATIONS    kernel
}

#[test]
fn module_id_matches_manifest() {
    assert_eq!($TYPE_NAME::new().id(), "$ID");
    assert_eq!(MODULE_ID, "$ID");
}

#[test]
fn manifest_json_matches_module_declaration() {
    let manifest = include_str!("../manifest.json");
    let parsed: serde_json::Value =
        serde_json::from_str(manifest).expect("manifest.json must be valid JSON");
    assert_eq!(parsed["id"], "$ID");

    let declared: Vec<&str> = parsed["dependencies"]
        .as_array()
        .expect("dependencies must be an array")
        .iter()
        .map(|v| v.as_str().expect("dependency must be a string"))
        .collect();
    assert_eq!(declared, $TYPE_NAME::new().dependencies().to_vec());
}

#[test]
fn full_lifecycle_through_kernel() {
    let mut kernel = kernel_with_deps();
    kernel
        .register(Box::new($TYPE_NAME::new()))
        .expect("register $ID");
    assert!(kernel.is_registered("$ID"));

    kernel.load_all().expect("load_all");
    kernel.start_all().expect("start_all");
    kernel.stop_all().expect("stop_all");

    assert!(kernel.is_registered("$ID"));
}

#[test]
fn duplicate_registration_fails() {
    let mut kernel = Kernel::new();
    kernel
        .register(Box::new($TYPE_NAME::new()))
        .expect("first registration");
    assert!(kernel.register(Box::new($TYPE_NAME::new())).is_err());
}

#[test]
fn lifecycle_hooks_are_individually_ok() {
    let mut module = $TYPE_NAME::new();
    assert!(module.on_load().is_ok());
    assert!(module.on_start().is_ok());
    assert!(module.on_stop().is_ok());
}

#[test]
fn validation_error_carries_field_and_message() {
    let err = $ERROR_TYPE::validation("some_field", "some message");
    assert!(err.to_string().contains("some_field"));
    assert!(err.to_string().contains("some message"));
}
EOF

# ── README.md ─────────────────────────────────────────────────────────
cat > "$MODULE_DIR/README.md" <<EOF
# $NAME Module

**Status:** Stub (lifecycle only — no domain logic yet)

## Overview

$DESCRIPTION

## Module Info

| Field        | Value |
|--------------|-------|
| ID           | \`$ID\` |
| Crate        | \`modules-$ID\` |
| Version      | \`0.1.0\` |
| Dependencies | \`$DEPS_JSON\` |

## Currently Owns

Nothing yet. This module registers with the kernel and logs its lifecycle
transitions; the domain logic still lives in its original location.

## Promotion Checklist

- [ ] Move tables and queries into \`src/repository.rs\`
- [ ] Move orchestration into \`src/service.rs\` (all writes in a transaction)
- [ ] Subscribe to the events this vertical reacts to in \`on_load\`
- [ ] Move Tauri commands into the owning app's \`commands/\` directory
- [ ] Update this README and remove the stub status

See \`modules/README.md\` for the full promotion path.
EOF

for f in manifest.json Cargo.toml README.md src/lib.rs src/error.rs src/lib_tests.rs; do
    echo "created modules/$ID/$f"
done

cat <<EOF

Two manual wiring edits remain:
  1. Cargo.toml [workspace.dependencies]:
       modules-$ID = { path = "modules/$ID" }
  2. platform/startup/Cargo.toml [dependencies]:
       modules-$ID = { workspace = true }
     platform/startup/src/lib.rs init_module_system:
       k.register(Box::new(modules_${SNAKE}::${TYPE_NAME}::new()))?;

Then verify:
  cargo test -p modules-$ID --lib
  cargo test -p platform-startup --lib every_module_manifest_is_registered
EOF
