//! Customer domain type — re-exported from `foundation`.
//!
//! It moved down from `modules-crm` (ADR-61 / C26, 2026-09-28) so this crate can expose the
//! type without depending on a business module; the path consumers use is unchanged.

pub use foundation::customer::Customer;
