/*
last audited 25-07-26 by RSA-Agent (oz-plugin slice B: manager deep read)
crate: oz-plugin | status: SAFE | lint: CLEAN
findings: exemplary — PLG-03 capability-gated oz table (ungranted bindings absent, fail fast); PLG-04 per-plugin isolated _ENV with __index chaining and _G repointed at the plugin env (no global leak); duplicate-id rejection; mandatory at-least-one-permission opt-in; deterministic id-sorted ordering; P0-5 discount range 0-100; MONEY-05 documented float hand-off avoiding Lua 5.4 integer wrap; mlua RegistryKey drop-before-VM field ordering documented against use-after-free; poisoned locks degrade benignly (fail-safe for discount queue)
next: none | perf: hooks resolved per event via cloned refs
*/
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex};

use chrono::{Datelike, Timelike};
use mlua::RegistryKey;
use oz_lua::{CartLineData, DiscountResult, LuaError, LuaEventBridge, LuaRuntime, TaxOverride};

use crate::error::PluginError;
use crate::loader::load_plugins;
use crate::manifest::Permission;

/// A discount queued by a plugin script for later application.
#[derive(Debug, Clone)]
pub struct PendingDiscount {
    /// Discount target — `"cart"` or `"line:<SKU>"`.
    pub target: String,
    /// Discount percentage (0–100).
    pub percent: i64,
}

/// A single loaded plugin's isolated environment and granted capabilities.
#[derive(Debug)]
pub struct PluginSandbox {
    /// Plugin id (manifest `plugin.name`, unique — PLG-04).
    pub id: String,
    /// The effective permission set this plugin was granted (PLG-03).
    pub permissions: Vec<Permission>,
    /// Registry key of the plugin's isolated `_ENV` table in the shared VM.
    env_key: RegistryKey,
}

/// A hook registration owned by one plugin (PLG-04).
#[derive(Debug, Clone)]
struct HookRef {
    plugin_id: String,
    func_name: String,
}

/// Runtime manager for Lua plugin scripts.
///
/// Manages the Lua sandbox, plugin lifecycle, hook registration,
/// discount accumulation, and event dispatching. Each plugin is loaded into
/// its own isolated environment with a capability-gated `oz` table (PLG-03,
/// PLG-04): plugins can never see or overwrite one another's globals, and
/// every hook/callback is owned by the plugin that registered it.
pub struct PluginManager {
    /// Loaded plugins in deterministic (id-sorted) order.
    plugins: Vec<PluginSandbox>,
    /// Event → hook references, each tagged with its owning plugin id.
    hook_names: Arc<Mutex<HashMap<String, Vec<HookRef>>>>,
    pending_discounts: Arc<Mutex<Vec<PendingDiscount>>>,
    bridge: Arc<Mutex<LuaEventBridge>>,
    /// Shared Lua VM. Declared LAST so it drops AFTER the per-plugin env
    /// `RegistryKey`s above: mlua 0.9's `RegistryKey::drop` touches the Lua
    /// state, so freeing the VM before the keys would be a use-after-free.
    runtime: LuaRuntime,
}

impl std::fmt::Debug for PluginManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PluginManager").finish_non_exhaustive()
    }
}

impl PluginManager {
    /// Whitelist of all recognised plugin permissions.
    /// Plugins that declare permissions outside this set are rejected at load time.
    const ALLOWED_PERMISSIONS: &'static [Permission] = &[
        Permission::CartRead,
        Permission::CartWrite,
        Permission::TaxRead,
        Permission::InventoryRead,
        Permission::InventoryWrite,
        Permission::ReportingRead,
        Permission::SystemTime,
        Permission::LogWrite,
    ];

    /// Create a new `PluginManager`, loading all plugins from `plugins_dir`.
    pub fn new(plugins_dir: &Path) -> Result<Self, PluginError> {
        let mut registry = load_plugins(plugins_dir)?;

        // ── Deterministic ordering + duplicate-id rejection (PLG-04) ──
        // Plugins load in id-sorted order so hook execution order is
        // reproducible regardless of directory iteration order.
        registry
            .plugins
            .sort_by(|a, b| a.manifest.plugin.name.cmp(&b.manifest.plugin.name));
        let mut seen_ids = HashSet::new();
        for plugin in &registry.plugins {
            if !seen_ids.insert(plugin.manifest.plugin.name.clone()) {
                return Err(PluginError::Manifest(format!(
                    "duplicate plugin id '{}' — plugin ids must be unique",
                    plugin.manifest.plugin.name,
                )));
            }
        }

        // ── Enforce plugin permissions ──────────────────────────────
        for plugin in &registry.plugins {
            // Check that all declared permissions are in the whitelist.
            for perm in &plugin.manifest.permissions.required_permissions {
                if !Self::ALLOWED_PERMISSIONS.contains(perm) {
                    return Err(PluginError::Manifest(format!(
                        "plugin '{}' declares unknown permission '{}' — rejected",
                        plugin.manifest.plugin.name, perm,
                    )));
                }
            }
            // Require at minimum: at least one permission must be declared.
            // Plugins with zero declared permissions are rejected to force
            // explicit opt-in.
            if plugin.manifest.permissions.required_permissions.is_empty() {
                return Err(PluginError::Manifest(format!(
                    "plugin '{}' declares no required_permissions — \
                     at least one permission must be declared (e.g. [\"cart:read\"])",
                    plugin.manifest.plugin.name,
                )));
            }
        }

        let runtime = LuaRuntime::new().map_err(|e| PluginError::Lua(e.to_string()))?;

        let hook_names: Arc<Mutex<HashMap<String, Vec<HookRef>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let pending_discounts: Arc<Mutex<Vec<PendingDiscount>>> = Arc::new(Mutex::new(Vec::new()));
        let bridge: Arc<Mutex<LuaEventBridge>> = Arc::new(Mutex::new(LuaEventBridge::new()));

        let lua = runtime.inner();

        // ── Shared binding implementations (cloned into each gated oz table) ──
        let get_time_fn = lua
            .create_function(|ctx, ()| {
                let now = chrono::Utc::now();
                let tbl = ctx.create_table()?;
                tbl.set(
                    "wday",
                    now.format("%u").to_string().parse::<u32>().unwrap_or(0),
                )?;
                tbl.set("hour", now.hour())?;
                tbl.set("min", now.minute())?;
                tbl.set("sec", now.second())?;
                tbl.set("month", now.month())?;
                tbl.set("day", now.day())?;
                tbl.set("year", now.year())?;
                Ok(tbl)
            })
            .map_err(|e| PluginError::Lua(e.to_string()))?;
        let log_fn = lua
            .create_function(|_, (level, message): (String, String)| {
                match level.as_str() {
                    "error" => tracing::error!(target: "plugin", "{message}"),
                    "warn" => tracing::warn!(target: "plugin", "{message}"),
                    "info" => tracing::info!(target: "plugin", "{message}"),
                    "debug" => tracing::debug!(target: "plugin", "{message}"),
                    _ => tracing::info!(target: "plugin", "[{level}] {message}"),
                }
                Ok(())
            })
            .map_err(|e| PluginError::Lua(e.to_string()))?;
        let pd = pending_discounts.clone();
        let apply_discount_fn = lua
            .create_function(move |_, (target, percent): (String, i64)| {
                // P0 Finding #5: Validate discount percentage is in 0-100 range.
                // A malicious or buggy plugin could otherwise give 1000% discounts
                // or negative prices.
                if !(0..=100).contains(&percent) {
                    return Err(mlua::Error::RuntimeError(format!(
                        "oz.apply_discount: percent must be between 0 and 100, got {percent}"
                    )));
                }
                if let Ok(mut guard) = pd.lock() {
                    guard.push(PendingDiscount { target, percent });
                }
                Ok(())
            })
            .map_err(|e| PluginError::Lua(e.to_string()))?;

        // ── Load every plugin into its own isolated, gated environment ──
        let mut plugins = Vec::with_capacity(registry.plugins.len());

        for plugin in &registry.plugins {
            let plugin_id = plugin.manifest.plugin.name.clone();
            let perms = &plugin.manifest.permissions.required_permissions;

            // Isolated `_ENV` chaining `__index` to the sandboxed globals so
            // standard libraries resolve but plugin globals never leak between
            // plugins (PLG-04).
            let env = lua
                .create_table()
                .map_err(|e| PluginError::Lua(e.to_string()))?;
            let env_mt = lua
                .create_table()
                .map_err(|e| PluginError::Lua(e.to_string()))?;
            env_mt
                .set("__index", lua.globals())
                .map_err(|e| PluginError::Lua(e.to_string()))?;
            // mlua 0.9.9's Table::set_metatable is infallible (returns `()`).
            env.set_metatable(Some(env_mt));
            // Harden the boundary: point `_G` at the plugin's own env so a
            // plugin writing `_G.foo = ...` cannot leak into the shared global
            // table that every other plugin sees through `__index` (PLG-04).
            env.set("_G", env.clone())
                .map_err(|e| PluginError::Lua(e.to_string()))?;

            // Capability-gated `oz` table (PLG-03): only bindings whose
            // permission is granted are exposed. Missing bindings resolve to
            // nil, so an unapproved call fails fast in the sandbox.
            let oz = lua
                .create_table()
                .map_err(|e| PluginError::Lua(e.to_string()))?;

            if perms.contains(&Permission::SystemTime) {
                oz.set("get_time", get_time_fn.clone())
                    .map_err(|e| PluginError::Lua(e.to_string()))?;
            }
            if perms.contains(&Permission::LogWrite) {
                oz.set("log", log_fn.clone())
                    .map_err(|e| PluginError::Lua(e.to_string()))?;
            }
            if perms.contains(&Permission::CartWrite) {
                oz.set("apply_discount", apply_discount_fn.clone())
                    .map_err(|e| PluginError::Lua(e.to_string()))?;
            }
            if perms.contains(&Permission::CartRead) {
                // oz.register_hook — owner-scoped (PLG-04)
                let hn = hook_names.clone();
                let owner = plugin_id.clone();
                let register_hook_fn = lua
                    .create_function(move |_, (event, func_name): (String, String)| {
                        if let Ok(mut guard) = hn.lock() {
                            guard.entry(event).or_default().push(HookRef {
                                plugin_id: owner.clone(),
                                func_name,
                            });
                        }
                        Ok(())
                    })
                    .map_err(|e| PluginError::Lua(e.to_string()))?;
                oz.set("register_hook", register_hook_fn)
                    .map_err(|e| PluginError::Lua(e.to_string()))?;

                // oz.on / oz.off — owner-scoped (PLG-04)
                let br = bridge.clone();
                let owner = plugin_id.clone();
                let on_fn = lua
                    .create_function(move |lua, (event, callback): (String, mlua::Function)| {
                        if let Ok(mut guard) = br.lock() {
                            guard
                                .register_for(owner.clone(), lua, event, callback)
                                .map_err(|e| {
                                    mlua::Error::RuntimeError(format!("oz.on error: {e}"))
                                })?;
                        }
                        Ok(())
                    })
                    .map_err(|e| PluginError::Lua(e.to_string()))?;
                oz.set("on", on_fn)
                    .map_err(|e| PluginError::Lua(e.to_string()))?;

                let br_off = bridge.clone();
                let owner = plugin_id.clone();
                let off_fn = lua
                    .create_function(move |_, event: String| {
                        if let Ok(mut guard) = br_off.lock() {
                            // A plugin can only ever unsubscribe its own callbacks.
                            guard.off_for(&owner, &event);
                        }
                        Ok(())
                    })
                    .map_err(|e| PluginError::Lua(e.to_string()))?;
                oz.set("off", off_fn)
                    .map_err(|e| PluginError::Lua(e.to_string()))?;
            }

            env.set("oz", oz)
                .map_err(|e| PluginError::Lua(e.to_string()))?;

            // Load every declared script into THIS plugin's environment.
            for script in &plugin.scripts {
                runtime
                    .load_file_in_env(script, &env)
                    .map_err(|e| PluginError::Lua(format!("{}: {e}", script.display())))?;
                tracing::info!(
                    plugin = %plugin_id,
                    script = %script.display(),
                    "plugin script loaded"
                );
            }

            let env_key = lua
                .create_registry_value(env)
                .map_err(|e| PluginError::Lua(e.to_string()))?;
            plugins.push(PluginSandbox {
                id: plugin_id,
                permissions: perms.clone(),
                env_key,
            });
        }

        // The shared binding handles borrow the VM (`'lua`); drop them so the
        // borrow ends before `runtime` is moved into `Self`. The underlying
        // functions survive in each plugin's gated `oz` table (via `env_key`).
        drop(get_time_fn);
        drop(log_fn);
        drop(apply_discount_fn);

        Ok(Self {
            plugins,
            hook_names,
            pending_discounts,
            bridge,
            runtime,
        })
    }

    /// Validate the order through every plugin's legacy `validate_order` hook.
    ///
    /// Each plugin's hook is looked up in that plugin's own environment
    /// (PLG-04); errors from every plugin are aggregated in deterministic
    /// (id-sorted) order.
    pub fn validate_order(
        &self,
        lines: &[CartLineData],
        total_minor: i64,
        currency: &str,
    ) -> Result<Vec<String>, LuaError> {
        let lua = self.runtime.inner();
        let mut errors = Vec::new();
        for sandbox in &self.plugins {
            let Ok(env) = lua.registry_value::<mlua::Table>(&sandbox.env_key) else {
                continue;
            };
            errors.extend(self.runtime.validate_order_in_env(
                &env,
                lines,
                total_minor,
                currency,
            )?);
        }
        Ok(errors)
    }

    /// Apply the first plugin's legacy `apply_discount` hook that returns a result.
    ///
    /// Plugins are consulted in deterministic (id-sorted) order, each within
    /// its own environment (PLG-04).
    pub fn apply_discount(
        &self,
        lines: &[CartLineData],
    ) -> Result<Option<DiscountResult>, LuaError> {
        let lua = self.runtime.inner();
        for sandbox in &self.plugins {
            let Ok(env) = lua.registry_value::<mlua::Table>(&sandbox.env_key) else {
                continue;
            };
            if let Some(result) = self.runtime.apply_discount_in_env(&env, lines)? {
                return Ok(Some(result));
            }
        }
        Ok(None)
    }

    /// Apply the first plugin's legacy `calc_line_tax` hook that returns a result.
    ///
    /// Plugins are consulted in deterministic (id-sorted) order, each within
    /// its own environment (PLG-04).
    pub fn calc_line_tax(
        &self,
        sku: &str,
        qty: i64,
        unit_price_minor: i64,
        currency: &str,
    ) -> Result<Option<TaxOverride>, LuaError> {
        let lua = self.runtime.inner();
        for sandbox in &self.plugins {
            let Ok(env) = lua.registry_value::<mlua::Table>(&sandbox.env_key) else {
                continue;
            };
            if let Some(result) =
                self.runtime
                    .calc_line_tax_in_env(&env, sku, qty, unit_price_minor, currency)?
            {
                return Ok(Some(result));
            }
        }
        Ok(None)
    }

    /// Drain all queued discounts, returning them and clearing the queue.
    pub fn drain_pending_discounts(&self) -> Vec<PendingDiscount> {
        self.pending_discounts
            .lock()
            .map(|mut g| std::mem::take(&mut *g))
            .unwrap_or_default()
    }

    /// Build a sale table and fire the `sale.before_complete` event.
    ///
    /// The table passed to Lua hooks contains:
    /// ```lua
    /// { total_minor, currency, user_id, lines = { { sku, qty, unit_price_minor, currency }, ... } }
    /// ```
    pub fn fire_sale_before_complete(
        &self,
        lines: &[CartLineData],
        total_minor: i64,
        currency: &str,
        user_id: &str,
    ) -> Result<(), LuaError> {
        let lua = self.runtime.inner();
        let tbl = lua
            .create_table()
            .map_err(|e| LuaError::Script(e.to_string()))?;
        // MONEY-05: hand money/qty values to the VM as Lua *floats* (see
        // oz-lua build_lines_table). Plugin arithmetic such as
        // `qty * unit_price_minor` otherwise runs as Lua 5.4 integer math,
        // which wraps silently on overflow.
        tbl.set("total_minor", total_minor as f64)
            .map_err(|e| LuaError::Script(e.to_string()))?;
        tbl.set("currency", currency)
            .map_err(|e| LuaError::Script(e.to_string()))?;
        tbl.set("user_id", user_id)
            .map_err(|e| LuaError::Script(e.to_string()))?;

        let lines_tbl = lua
            .create_table()
            .map_err(|e| LuaError::Script(e.to_string()))?;
        for (i, line) in lines.iter().enumerate() {
            let row = lua
                .create_table()
                .map_err(|e| LuaError::Script(e.to_string()))?;
            row.set("sku", line.sku.as_str())
                .map_err(|e| LuaError::Script(e.to_string()))?;
            row.set("qty", line.qty as f64)
                .map_err(|e| LuaError::Script(e.to_string()))?;
            row.set("unit_price_minor", line.unit_price_minor as f64)
                .map_err(|e| LuaError::Script(e.to_string()))?;
            row.set("currency", line.currency.as_str())
                .map_err(|e| LuaError::Script(e.to_string()))?;
            lines_tbl
                .set(i + 1, row)
                .map_err(|e| LuaError::Script(e.to_string()))?;
        }
        tbl.set("lines", lines_tbl)
            .map_err(|e| LuaError::Script(e.to_string()))?;

        self.fire_event("sale.before_complete", mlua::Value::Table(tbl))
    }

    /// Fire an event to all Lua callbacks registered via `oz.on()`.
    ///
    /// This calls the `LuaEventBridge` to dispatch the event to all
    /// registered Lua function callbacks.
    pub fn fire_bridge_event(&self, event: &str, args: mlua::Value) -> Result<(), LuaError> {
        if let Ok(guard) = self.bridge.lock() {
            guard.fire(self.runtime.inner(), event, args)
        } else {
            Err(LuaError::Script("bridge lock poisoned".into()))
        }
    }

    /// Fire an event to all registered hook functions, resolved in the
    /// environment of the plugin that registered them (PLG-04).
    ///
    /// Hook execution order is the registration order, which is deterministic
    /// because plugins load in id-sorted order. A hook whose owning plugin is
    /// no longer loaded, or whose function no longer exists, is skipped with a
    /// warning rather than aborting the event.
    pub fn fire_event(&self, event: &str, args: mlua::Value) -> Result<(), LuaError> {
        let hook_refs = self
            .hook_names
            .lock()
            .map(|g| g.get(event).cloned().unwrap_or_default())
            .unwrap_or_default();

        let lua = self.runtime.inner();
        for hook in &hook_refs {
            let Some(sandbox) = self.plugins.iter().find(|p| p.id == hook.plugin_id) else {
                tracing::warn!(
                    event,
                    plugin = %hook.plugin_id,
                    "hook owner plugin not loaded — skipping"
                );
                continue;
            };
            let Ok(env) = lua.registry_value::<mlua::Table>(&sandbox.env_key) else {
                tracing::warn!(
                    event,
                    plugin = %hook.plugin_id,
                    "hook owner environment missing — skipping"
                );
                continue;
            };
            let func: mlua::Function = match env.get(hook.func_name.as_str()) {
                Ok(f) => f,
                Err(_) => {
                    tracing::warn!(
                        event,
                        func = %hook.func_name,
                        "hook function not found in owner environment"
                    );
                    continue;
                }
            };
            func.call::<_, ()>(args.clone()).map_err(|e| {
                LuaError::Script(format!(
                    "hook {event}/{}/{}: {e}",
                    hook.plugin_id, hook.func_name
                ))
            })?;
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "manager_tests.rs"]
mod tests;
