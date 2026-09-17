//! Integration tests for oz-cli library exports — compile-time checks that
//! key types, modules, and re-exports resolve without errors.

#[test]
fn test_core_types_accessible() {
    // kasirmu_cli re-exports Cli and CliError at the crate root.
    let _cli: kasirmu_cli::Cli;
    let _err: kasirmu_cli::CliError;
}

#[test]
fn test_modules_compile() {
    // Verify the module tree is reachable.
    let _cli: kasirmu_cli::cli::Cli;
    let _run: fn() -> anyhow::Result<()> = kasirmu_cli::commands::run;
    let _err: kasirmu_cli::error::CliError;
}
