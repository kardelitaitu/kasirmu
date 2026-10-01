# kasir.mu — new module scaffold generator (PowerShell)
#
# Creates a stub vertical under modules/<id>/ that compiles, registers with
# the kernel, and passes its own tests on first run — then tells you the two
# manual wiring edits that remain.
#
# Usage:
#   pwsh -File scripts/new-module.ps1 -Id purchasing -Name "Purchasing" `
#        -Description "Supplier records and purchase orders." `
#        -Dependencies inventory,sales
#
# The workspace `members` list globs `modules/*`, so the new directory
# becomes a member with no root-manifest edit. What the script does NOT do
# automatically (both are single lines, both are asserted by tests):
#   1. Add `modules-<id> = { path = "modules/<id>" }` to [workspace.dependencies].
#   2. Add `k.register(Box::new(modules_<id>::<Pascal>Module::new()))?;` to
#      platform/startup/src/lib.rs, plus the dep in platform/startup/Cargo.toml.
# Skipping step 2 fails `every_module_manifest_is_registered`, which is the
# point: a module directory that nothing registers is dead code.

[CmdletBinding()]
param(
    # Module id: kebab-case, matches manifest.json `id` and the kernel id.
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z][a-z0-9-]*$')]
    [string]$Id,

    # Human-readable display name, e.g. "Gift Cards".
    [Parameter(Mandatory = $true)]
    [string]$Name,

    # One-sentence description for manifest.json and the crate description.
    [Parameter(Mandatory = $true)]
    [string]$Description,

    # Comma-separated module ids this module depends on (may be empty).
    [string[]]$Dependencies = @(),

    # Print what would be written without touching the filesystem.
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# `pwsh -File script.ps1 -Dependencies inventory,sales` hands the whole
# "inventory,sales" through as ONE argv element (comma-splitting only happens
# for in-process PowerShell calls), so split every element defensively.
$Dependencies = @(
    $Dependencies |
        ForEach-Object { $_ -split ',' } |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ }
)

foreach ($dep in $Dependencies) {
    if ($dep -notmatch '^[a-z][a-z0-9-]*$') {
        throw "dependency '$dep' is not a kebab-case module id"
    }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$moduleDir = Join-Path $repoRoot "modules/$Id"

if (Test-Path $moduleDir) {
    throw "modules/$Id already exists — pick another id or delete it first."
}

# ── Derived identifiers ───────────────────────────────────────────────
# `giftcards` -> `GiftCards` is not derivable from the id alone, so the
# Rust type name comes from -Name with non-alphanumerics stripped.
$pascal = (($Name -split '[^A-Za-z0-9]+') | Where-Object { $_ } | ForEach-Object {
        $_.Substring(0, 1).ToUpper() + $_.Substring(1)
    }) -join ''
$snake = $Id -replace '-', '_'
$typeName = "${pascal}Module"
$errorType = "${pascal}Error"

$depsJson = if ($Dependencies.Count -gt 0) {
    '[' + (($Dependencies | ForEach-Object { "`"$_`"" }) -join ', ') + ']'
} else { '[]' }

$depsRust = if ($Dependencies.Count -gt 0) {
    '&[' + (($Dependencies | ForEach-Object { "`"$_`"" }) -join ', ') + ']'
} else { '&[]' }

$permsJson = @(
    "    `"${Id}:view`"",
    "    `"${Id}:manage`""
) -join ",`n"

# ── manifest.json ─────────────────────────────────────────────────────
$manifest = @"
{
  "id": "$Id",
  "name": "$Name",
  "version": "0.1.0",
  "description": "$Description Stub: lifecycle only, domain logic not yet migrated.",
  "author": "kasir.mu contributors",
  "dependencies": $depsJson,
  "permissions": [
$permsJson
  ]
}
"@

# ── Cargo.toml ────────────────────────────────────────────────────────
$cargo = @"
[package]
name = "modules-$Id"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true
description = "kasir.mu $Name Module (stub): $Description"

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
"@

# ── src/error.rs ──────────────────────────────────────────────────────
$errorRs = @"
//! Error type for the $Id domain.
//!
//! Mirrors the shape used by the other module crates (``Db``, ``NotFound``,
//! ``Validation``) so that promoting this stub to an owning module does not
//! change the error surface its callers already match on.

use thiserror::Error;

/// Errors that can originate in the $Id domain.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum $errorType {
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

impl $errorType {
    /// Create a validation error for a specific field.
    pub fn validation(field: &'static str, message: impl Into<String>) -> Self {
        Self::Validation {
            field,
            message: message.into(),
        }
    }
}
"@

# ── src/lib.rs ────────────────────────────────────────────────────────
$libRs = @"
/*
stub module — generated by scripts/new-module.ps1
crate: modules-$Id | status: SAFE | lint: CLEAN
findings: No-op Module implementation. No unsafe code, no DB access yet.
next: Migrate the $Id domain logic into repository.rs / service.rs.
*/

//! $Name Module — $Description
//!
//! Key types: [``$typeName``] (kernel lifecycle), [``$errorType``].
//!
//! ## Stub status
//!
//! This is a **stub**: it registers with the kernel, declares its
//! dependencies, and logs its lifecycle transitions. It owns no tables and
//! no commands yet.
//!
//! Promotion path — see ``modules/README.md``:
//! 1. Move tables and queries into ``repository.rs``.
//! 2. Move orchestration into ``service.rs``, inside a transaction.
//! 3. Subscribe to the events this vertical reacts to in ``on_load``.

pub mod error;

pub use error::$errorType;

use foundation::contracts::{Module, ModuleId, ModuleResult};
use tracing::info;

/// Stable module id, matching the ``id`` field in ``manifest.json``.
pub const MODULE_ID: ModuleId = "$Id";

/// The $Name module.
///
/// Implements [``Module``] so the kernel can order it correctly during
/// load/start and shutdown.
#[derive(Debug, Default)]
pub struct $typeName;

impl $typeName {
    /// Create a new ``$typeName``.
    pub fn new() -> Self {
        Self
    }
}

impl Module for $typeName {
    fn id(&self) -> ModuleId {
        MODULE_ID
    }

    fn dependencies(&self) -> &'static [ModuleId] {
        // Must match `dependencies` in manifest.json — asserted by a test.
        $depsRust
    }

    fn on_load(&mut self) -> ModuleResult {
        info!("$Id module: on_load (stub — no handlers registered yet)");
        Ok(())
    }

    fn on_start(&mut self) -> ModuleResult {
        info!("$Id module: on_start (stub)");
        Ok(())
    }

    fn on_stop(&mut self) -> ModuleResult {
        info!("$Id module: on_stop (stub)");
        Ok(())
    }
}

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
"@

# ── src/lib_tests.rs ──────────────────────────────────────────────────
$depRegistrations = if ($Dependencies.Count -gt 0) {
    ($Dependencies | ForEach-Object {
        "    kernel`n        .register(Box::new(StubModule(`"$_`")))`n        .expect(`"register $_ stub`");"
    }) -join "`n"
} else { '' }

$testsRs = @"
//! Tests for the $Id module stub lifecycle.

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
$depRegistrations
    kernel
}

#[test]
fn module_id_matches_manifest() {
    assert_eq!($typeName::new().id(), "$Id");
    assert_eq!(MODULE_ID, "$Id");
}

#[test]
fn manifest_json_matches_module_declaration() {
    let manifest = include_str!("../manifest.json");
    let parsed: serde_json::Value =
        serde_json::from_str(manifest).expect("manifest.json must be valid JSON");
    assert_eq!(parsed["id"], "$Id");

    let declared: Vec<&str> = parsed["dependencies"]
        .as_array()
        .expect("dependencies must be an array")
        .iter()
        .map(|v| v.as_str().expect("dependency must be a string"))
        .collect();
    assert_eq!(declared, $typeName::new().dependencies().to_vec());
}

#[test]
fn full_lifecycle_through_kernel() {
    let mut kernel = kernel_with_deps();
    kernel
        .register(Box::new($typeName::new()))
        .expect("register $Id");
    assert!(kernel.is_registered("$Id"));

    kernel.load_all().expect("load_all");
    kernel.start_all().expect("start_all");
    kernel.stop_all().expect("stop_all");

    assert!(kernel.is_registered("$Id"));
}

#[test]
fn duplicate_registration_fails() {
    let mut kernel = Kernel::new();
    kernel
        .register(Box::new($typeName::new()))
        .expect("first registration");
    assert!(kernel.register(Box::new($typeName::new())).is_err());
}

#[test]
fn lifecycle_hooks_are_individually_ok() {
    let mut module = $typeName::new();
    assert!(module.on_load().is_ok());
    assert!(module.on_start().is_ok());
    assert!(module.on_stop().is_ok());
}

#[test]
fn validation_error_carries_field_and_message() {
    let err = $errorType::validation("some_field", "some message");
    assert!(err.to_string().contains("some_field"));
    assert!(err.to_string().contains("some message"));
}
"@

# ── README.md ─────────────────────────────────────────────────────────
$readme = @"
# $Name Module

**Status:** Stub (lifecycle only — no domain logic yet)

## Overview

$Description

## Module Info

| Field        | Value |
|--------------|-------|
| ID           | ``$Id`` |
| Crate        | ``modules-$Id`` |
| Version      | ``0.1.0`` |
| Dependencies | ``$depsJson`` |

## Currently Owns

Nothing yet. This module registers with the kernel and logs its lifecycle
transitions; the domain logic still lives in its original location.

## Promotion Checklist

- [ ] Move tables and queries into ``src/repository.rs``
- [ ] Move orchestration into ``src/service.rs`` (all writes in a transaction)
- [ ] Subscribe to the events this vertical reacts to in ``on_load``
- [ ] Move Tauri commands into the owning app's ``commands/`` directory
- [ ] Update this README and remove the stub status

See ``modules/README.md`` for the full promotion path.
"@

# ── Write ─────────────────────────────────────────────────────────────
$files = [ordered]@{
    "modules/$Id/manifest.json"     = $manifest
    "modules/$Id/Cargo.toml"        = $cargo
    "modules/$Id/README.md"         = $readme
    "modules/$Id/src/lib.rs"        = $libRs
    "modules/$Id/src/error.rs"      = $errorRs
    "modules/$Id/src/lib_tests.rs"  = $testsRs
}

if ($DryRun) {
    Write-Host "DRY RUN — would create:" -ForegroundColor Yellow
    $files.Keys | ForEach-Object { Write-Host "  $_" }
    exit 0
}

New-Item -ItemType Directory -Force -Path (Join-Path $moduleDir 'src') | Out-Null
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
foreach ($rel in $files.Keys) {
    $path = Join-Path $repoRoot $rel
    [System.IO.File]::WriteAllText($path, $files[$rel], $utf8NoBom)
    Write-Host "created $rel" -ForegroundColor Green
}

Write-Host ""
Write-Host "Two manual wiring edits remain:" -ForegroundColor Cyan
Write-Host "  1. Cargo.toml [workspace.dependencies]:"
Write-Host "       modules-$Id = { path = `"modules/$Id`" }"
Write-Host "  2. platform/startup/Cargo.toml [dependencies]:"
Write-Host "       modules-$Id = { workspace = true }"
Write-Host "     platform/startup/src/lib.rs init_module_system:"
Write-Host "       k.register(Box::new(modules_${snake}::${typeName}::new()))?;"
Write-Host ""
Write-Host "Then verify:" -ForegroundColor Cyan
Write-Host "  cargo test -p modules-$Id --lib"
Write-Host "  cargo test -p platform-startup --lib every_module_manifest_is_registered"
