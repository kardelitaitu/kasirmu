/*
last audited 25-07-26 by RSA-Agent (oz-hal slice A: verified)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: clean
next: none | perf: N/A
*/
//! HAL traits. One file per device category, re-exported here.

pub mod barcode;
pub mod cash_drawer;
pub mod customer_display;
pub mod edc;
pub mod printer;
pub mod weight_scale;
