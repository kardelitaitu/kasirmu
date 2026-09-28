//! User and Role domain types — re-exported from `platform_core`.
//!
//! They moved down from `modules-staff` (ADR-61 / C26, 2026-09-28) so this crate can expose them
//! without depending on a business module. `platform-core` rather than `foundation` is forced, not
//! preferred: `Role`'s policy methods call `platform_core::rbac`, and moving them into `foundation`
//! would make it depend on a crate that depends on it. The role-id taxonomy now has ONE home,
//! `platform_core::rbac::builtin_roles`; the four-constant subset that used to sit in the module was
//! deleted rather than copied, and the `kasirmu_core::builtin_roles` path below is preserved.
//!
//! `seed_users` stays re-exported for the same reason: a path that existed before this move keeps
//! working after it.

pub use platform_core::rbac::builtin_roles;
pub use platform_core::staff::{Role, User, UserId, seed_users};
