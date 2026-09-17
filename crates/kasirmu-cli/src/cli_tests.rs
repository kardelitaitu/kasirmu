use super::*;
use clap::Parser;

#[test]
fn cli_parse_migrate() {
    let cli = Cli::try_parse_from(["oz", "migrate"]).unwrap();
    assert!(matches!(cli.command, Some(Command::Migrate)));
}

#[test]
fn cli_parse_product_list() {
    let cli = Cli::try_parse_from(["oz", "product", "list"]).unwrap();
    assert!(matches!(
        cli.command,
        Some(Command::Product(ProductArgs {
            action: ProductAction::List,
            ..
        }))
    ));
}

#[test]
fn cli_parse_product_create() {
    let cli = Cli::try_parse_from(["oz", "product", "create", "SKU-1", "Widget", "999"]).unwrap();
    match cli.command {
        Some(Command::Product(ProductArgs {
            action: ProductAction::Create {
                sku, name, price, ..
            },
        })) => {
            assert_eq!(sku, "SKU-1");
            assert_eq!(name, "Widget");
            assert_eq!(price, 999);
        }
        _ => panic!("expected Product::Create"),
    }
}

#[test]
fn cli_parse_product_get() {
    let cli = Cli::try_parse_from(["oz", "product", "get", "ABC"]).unwrap();
    assert!(matches!(
        cli.command,
        Some(Command::Product(ProductArgs {
            action: ProductAction::Get { .. },
            ..
        }))
    ));
}

#[test]
fn cli_parse_category_list() {
    let cli = Cli::try_parse_from(["oz", "category", "list"]).unwrap();
    assert!(matches!(
        cli.command,
        Some(Command::Category(CategoryArgs {
            action: CategoryAction::List,
            ..
        }))
    ));
}

#[test]
fn cli_parse_inventory_get() {
    let cli = Cli::try_parse_from(["oz", "inventory", "get", "SKU-001"]).unwrap();
    assert!(matches!(
        cli.command,
        Some(Command::Inventory(InventoryArgs {
            action: InventoryAction::Get { .. },
            ..
        }))
    ));
}

#[test]
fn cli_parse_sale_list() {
    let cli = Cli::try_parse_from(["oz", "sale", "list"]).unwrap();
    assert!(matches!(
        cli.command,
        Some(Command::Sale(SaleArgs {
            action: SaleAction::List,
            ..
        }))
    ));
}

#[test]
fn cli_parse_customer_list() {
    let cli = Cli::try_parse_from(["oz", "customer", "list"]).unwrap();
    assert!(matches!(
        cli.command,
        Some(Command::Customer(CustomerArgs {
            action: CustomerAction::List,
            ..
        }))
    ));
}

#[test]
fn cli_parse_user_list() {
    let cli = Cli::try_parse_from(["oz", "user", "list"]).unwrap();
    assert!(matches!(
        cli.command,
        Some(Command::User(UserArgs {
            action: UserAction::List,
            ..
        }))
    ));
}

#[test]
fn cli_parse_backup() {
    let cli = Cli::try_parse_from(["oz", "backup", "-o", "backup.db"]).unwrap();
    match cli.command {
        Some(Command::Backup { output }) => assert_eq!(output, "backup.db"),
        _ => panic!("expected Backup"),
    }
}

#[test]
fn cli_parse_restore() {
    let cli = Cli::try_parse_from(["oz", "restore", "-i", "backup.db"]).unwrap();
    match cli.command {
        Some(Command::Restore { input }) => assert_eq!(input, "backup.db"),
        _ => panic!("expected Restore"),
    }
}

#[test]
fn cli_parse_default_db() {
    let cli = Cli::try_parse_from(["oz", "migrate"]).unwrap();
    assert_eq!(cli.db, "kasir.db");
}

#[test]
fn cli_parse_custom_db() {
    let cli = Cli::try_parse_from(["oz", "--db", "custom.db", "migrate"]).unwrap();
    assert_eq!(cli.db, "custom.db");
}

#[test]
fn cli_parse_export_kasirpkg() {
    let cli = Cli::try_parse_from([
        "oz",
        "export-kasirpkg",
        "-o",
        "data.kasirpkg",
        "-p",
        "secret123",
    ])
    .unwrap();
    match cli.command {
        Some(Command::ExportKasirpkg {
            output, password, ..
        }) => {
            assert_eq!(output, "data.kasirpkg");
            assert_eq!(password, "secret123");
        }
        _ => panic!("expected ExportKasirpkg"),
    }
}

#[test]
fn cli_parse_import_kasirpkg() {
    let cli = Cli::try_parse_from([
        "oz",
        "import-kasirpkg",
        "-i",
        "data.kasirpkg",
        "-p",
        "secret123",
        "--dry-run",
    ])
    .unwrap();
    match cli.command {
        Some(Command::ImportKasirpkg {
            input,
            password,
            dry_run,
        }) => {
            assert_eq!(input, "data.kasirpkg");
            assert_eq!(password, "secret123");
            assert!(dry_run);
        }
        _ => panic!("expected ImportKasirpkg"),
    }
}

#[test]
fn cli_parse_sale_get() {
    let cli = Cli::try_parse_from(["oz", "sale", "get", "some-id"]).unwrap();
    assert!(matches!(
        cli.command,
        Some(Command::Sale(SaleArgs {
            action: SaleAction::Get { .. },
            ..
        }))
    ));
}

#[test]
fn cli_parse_sale_update_status() {
    let cli = Cli::try_parse_from(["oz", "sale", "update-status", "some-id", "completed"]).unwrap();
    assert!(matches!(
        cli.command,
        Some(Command::Sale(SaleArgs {
            action: SaleAction::UpdateStatus { .. },
            ..
        }))
    ));
}

#[test]
fn cli_parse_category_create() {
    let cli = Cli::try_parse_from([
        "oz",
        "category",
        "create",
        "cat-drinks",
        "Beverages",
        "#06b6d4",
    ])
    .unwrap();
    assert!(matches!(
        cli.command,
        Some(Command::Category(CategoryArgs {
            action: CategoryAction::Create { .. },
            ..
        }))
    ));
}

#[test]
fn cli_parse_user_create() {
    let cli = Cli::try_parse_from([
        "oz",
        "user",
        "create",
        "jdoe",
        "hash123",
        "John Doe",
        "role-staff",
    ])
    .unwrap();
    assert!(matches!(
        cli.command,
        Some(Command::User(UserArgs {
            action: UserAction::Create { .. },
            ..
        }))
    ));
}

#[test]
fn cli_parse_customer_create() {
    let cli = Cli::try_parse_from([
        "oz",
        "customer",
        "create",
        "Alice",
        "--email",
        "alice@test.com",
    ])
    .unwrap();
    assert!(matches!(
        cli.command,
        Some(Command::Customer(CustomerArgs {
            action: CustomerAction::Create { .. },
            ..
        }))
    ));
}

#[test]
fn cli_parse_inventory_adjust() {
    let cli = Cli::try_parse_from(["oz", "inventory", "adjust", "SKU-001", "+5"]).unwrap();
    assert!(matches!(
        cli.command,
        Some(Command::Inventory(InventoryArgs {
            action: InventoryAction::Adjust { .. },
            ..
        }))
    ));
}

#[test]
fn cli_parse_export_csv() {
    let cli = Cli::try_parse_from(["oz", "export", "daily-summary"]).unwrap();
    match cli.command {
        Some(Command::Export { kind }) => assert_eq!(kind, "daily-summary"),
        _ => panic!("expected Export"),
    }
}

#[test]
fn cli_parse_export_with_types_and_password() {
    let cli = Cli::try_parse_from([
        "oz",
        "export-kasirpkg",
        "-o",
        "backup.kasirpkg",
        "-p",
        "secret",
        "-t",
        "products,customers",
    ])
    .unwrap();
    match cli.command {
        Some(Command::ExportKasirpkg {
            output,
            password,
            types,
            ..
        }) => {
            assert_eq!(output, "backup.kasirpkg");
            assert_eq!(password, "secret");
            assert_eq!(types, "products,customers");
        }
        _ => panic!("expected ExportKasirpkg"),
    }
}
