//! Tax domain types — re-exported from `foundation`.
//!
//! They moved down from `modules-tax` (ADR-61 / C26, 2026-09-28) so this crate can expose them
//! without depending on a business module; the paths consumers use are unchanged.

pub use foundation::tax::{RoundingMode, TaxRate};
