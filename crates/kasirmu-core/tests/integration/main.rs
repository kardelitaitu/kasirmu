//! Consolidated integration test suite for `kasirmu-core`.
//!
//! Replaces 24 standalone test binaries with a single test binary,
//! reducing linker invocations from 24 to 1 while preserving complete test coverage.

mod audit;
mod backup_restore;
mod corruption_recovery;
mod credential_storage_form;
mod currency;
mod customer;
mod feature_matrix;
mod gift_card;
mod inventory;
mod loyalty;
mod manifest_schema;
mod offline;
mod payment_failure;
mod purchase_order;
mod refund_tax;
mod settings;
mod shift;
mod staff;
mod stock_count;
mod stock_transfer;
mod store_scoping;
mod store_scoping_concurrency;
mod supplier;
mod terminal;
