//! Module dependency declaration helpers.
//!
//! Dependencies are declared on the [`Module`] trait itself via
//! `Module::dependencies()`, which mirrors the `dependencies` array in a
//! module's `manifest.json`. `collect_dependencies` is the kernel-side
//! accessor used by the topological sort in
//! [`Kernel::resolve_dependencies`](crate::Kernel).
//!
//! `collect_dependencies` is named as a code span rather than an intra-doc
//! link because it is a PRIVATE item, and a public doc comment that links to
//! one is `rustdoc::private_intra_doc_links` — a warning that becomes an
//! error under `RUSTDOCFLAGS="-D warnings"`. The link was never navigable for
//! a reader of the public docs anyway.
//!
//! [`HasDependencies`] predates that trait method and is retained as a
//! standalone opt-in for non-`Module` types; new modules should implement
//! `Module::dependencies()` instead.

use foundation::contracts::Module;

/// Trait for types that declare dependencies on other modules.
///
/// # Deprecated in favour of `Module::dependencies()`
///
/// `Module` now carries a `dependencies()` method with a `&[]` default, so
/// a module declares its own edges directly and the kernel reads them
/// without downcasting. This trait remains for non-`Module` types that
/// still want to express a dependency list.
pub trait HasDependencies {
    /// Module IDs that this type depends on.
    fn dependencies(&self) -> Vec<&'static str>;
}

/// Collect the dependency IDs declared by a module.
///
/// Reads `Module::dependencies()`, which defaults to an empty slice, so a
/// module that declares nothing is treated as a graph leaf. The returned
/// order matches the module's own declaration order; the caller
/// (`resolve_dependencies`) validates that every id is registered.
pub(crate) fn collect_dependencies(module: &dyn Module) -> Vec<&'static str> {
    module.dependencies().to_vec()
}

#[cfg(test)]
#[path = "dependency_tests.rs"]
mod tests;
