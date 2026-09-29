/*
last audited 25-07-26 by RSA-Agent (kasirmu-plugin slice B: manager deep read)
crate: kasirmu-plugin | status: SAFE | lint: CLEAN
findings: exemplary — PLG-03 capability-gated oz table (ungranted bindings absent, fail fast); PLG-04 per-plugin isolated _ENV with __index chaining and _G repointed at the plugin env (no global leak); duplicate-id rejection; mandatory at-least-one-permission opt-in; deterministic id-sorted ordering; P0-5 discount range 0-100; MONEY-05 documented float hand-off avoiding Lua 5.4 integer wrap; mlua RegistryKey drop-before-VM field ordering documented against use-after-free; poisoned locks degrade benignly (fail-safe for discount queue)
next: none | perf: hooks resolved per event via cloned refs
*/
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex};

use chrono::{Datelike, Timelike};
use kasirmu_lua::{
    CartLineData, DiscountResult, LuaError, LuaEventBridge, LuaRuntime, TaxOverride,
};
use mlua::RegistryKey;

use crate::error::PluginError;
use crate::loader::{LoadedPlugin, hash_plugin_set, load_plugins};
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

/// Environment variable holding the plugin-signing public key (PEM).
///
/// Read once at [`PluginManager::new`]. Unset means plugin signatures are not
/// verified, which is the documented opt-in default — see `crate::signature`.
/// Named `KASIRMU_`-prefixed to match the house convention for deployment
/// configuration (AGENTS.md §4).
pub const SIGNATURE_PUBLIC_KEY_ENV: &str = "KASIRMU_PLUGIN_PUBLIC_KEY";

/// Read a loaded plugin's scripts as (relative path, bytes) pairs for signing.
///
/// Relative to the plugin directory, never absolute: an absolute path embeds the
/// install location, so a plugin signed on one machine would fail to verify on
/// another. An unreadable script yields its path with empty bytes rather than
/// being skipped, so a script that disappears after being resolved cannot
/// silently drop out of the digest and leave a signature that still matches.
///
/// # Why both sides are canonicalised before the strip
///
/// `LoadedPlugin.scripts` holds **canonicalised** paths (see
/// `resolve_plugin_scripts`), while `LoadedPlugin.directory` holds the path as
/// the directory walk produced it. On Windows `canonicalize` returns a `\\?\`
/// verbatim-prefixed path, so stripping the raw directory off a canonical script
/// path **fails**, and the old `unwrap_or(path)` fallback silently emitted an
/// absolute path instead. The effect was Windows-only and invisible to the unit
/// tests — which build their own relative names — but it made every signature
/// machine-specific, so a plugin signed on one install could never verify on
/// another. Canonicalising both sides makes the strip succeed and the name
/// relative on every platform. Caught by `tests/signature_roundtrip.rs`.
fn read_plugin_scripts(plugin: &LoadedPlugin) -> Vec<(String, Vec<u8>)> {
    let canonical_dir = std::fs::canonicalize(&plugin.directory).ok();
    plugin
        .scripts
        .iter()
        .map(|path| {
            let relative = canonical_dir
                .as_deref()
                .and_then(|dir| path.strip_prefix(dir).ok())
                // Fall back to the raw directory, then to the file name alone.
                // The file name is still relative and still identifies the file
                // within a plugin, which beats an absolute path that would make
                // the signature machine-specific.
                .or_else(|| path.strip_prefix(&plugin.directory).ok())
                .map(|p| p.to_path_buf())
                .or_else(|| path.file_name().map(std::path::PathBuf::from))
                .unwrap_or_else(|| path.clone());
            let relative = relative.to_string_lossy().replace('\\', "/");
            let bytes = std::fs::read(path).unwrap_or_default();
            (relative, bytes)
        })
        .collect()
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
    /// Content hash of the plugin set this runtime was built from (C2).
    /// Recorded at load time; see [`Self::content_hash`].
    content_hash: u64,
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

        // ── Record the content hash of this set (C2) ────────────────
        // Taken here, after the id-sort above, so the value is stable across
        // directory-iteration order. It identifies the exact bytes loaded;
        // nothing in this crate verifies them (no signature step yet), so a
        // changed on-disk set is detected, never authenticated.
        let content_hash = hash_plugin_set(&registry);

        // Surface the fingerprint. This is the only production consumer of the
        // value, and it is what makes the record-only fingerprint observable:
        // the shell never swaps the live set, so without this line a changed
        // plugin set is indistinguishable in the log from an unchanged one.
        // An operator comparing the fingerprint across restarts can see that
        // the set moved — the detection half of C2, with no trust model chosen.
        tracing::info!(
            fingerprint = format!("{content_hash:016x}"),
            plugins = registry.plugins.len(),
            ids = ?registry
                .plugins
                .iter()
                .map(|p| p.manifest.plugin.name.as_str())
                .collect::<Vec<_>>(),
            "plugin set fingerprint recorded — a changed set is refused until restart"
        );

        // ── Verify plugin signatures (C2 / D7) ──────────────────────
        // The grant gate below answers "did the operator approve this plugin's
        // permissions?"; it cannot answer "is this the plugin they approved?",
        // because `plugin-grants.json` sits in the same directory an attacker
        // who can add a plugin can write to. This is the authenticity half.
        //
        // Env-configured rather than a parameter: `PluginManager::new` is called
        // from both shells and from tests, and threading a key through every
        // caller would be a larger change than the gate itself. An unset key
        // means unsigned plugins load exactly as before -- see the module docs
        // on `crate::signature` for why verification is opt-in per install.
        let signing_key = std::env::var(SIGNATURE_PUBLIC_KEY_ENV).ok();
        if signing_key.is_none() {
            tracing::debug!(
                "no {SIGNATURE_PUBLIC_KEY_ENV} configured — plugin signatures are not verified"
            );
        }
        let mut unverified: Vec<(String, String)> = Vec::new();
        for plugin in &registry.plugins {
            let id = &plugin.manifest.plugin.name;
            let declared: Vec<String> = plugin
                .manifest
                .permissions
                .required_permissions
                .iter()
                .map(ToString::to_string)
                .collect();
            let scripts = read_plugin_scripts(plugin);
            match crate::signature::verify_plugin(
                &plugin.directory,
                id,
                &plugin.manifest.plugin.version,
                &declared,
                &scripts,
                signing_key.as_deref(),
            ) {
                Ok(true) => {
                    tracing::info!(plugin = %id, "plugin signature verified");
                }
                Ok(false) => {}
                Err(e) => unverified.push((id.clone(), e.to_string())),
            }
        }
        if !unverified.is_empty() {
            let detail = unverified
                .iter()
                .map(|(id, why)| format!("'{id}': {why}"))
                .collect::<Vec<_>>()
                .join("; ");
            return Err(PluginError::Signature(format!(
                "plugin signature verification failed — refused. {detail}"
            )));
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

        // ── Operator grant gate (C2 / D7) ───────────────────────────
        // The whitelist above answers "is this a real permission?"; it cannot
        // answer "did the operator approve it for THIS plugin?", because the
        // list is written by the plugin author. Without the gate below a
        // plugin shipping `required_permissions = ["cart:write"]` receives the
        // discount bindings with no human in the loop — the self-declaration
        // D7 rules must become an operator grant.
        //
        // Loaded AFTER the whitelist so a malformed grants file cannot mask an
        // invalid manifest: the more specific diagnosis wins.
        let grants = crate::grants::load(plugins_dir)?;
        let grants_path = crate::grants::PluginGrants::path_in(plugins_dir);
        let mut ungranted_any: Vec<(String, Vec<String>)> = Vec::new();
        for plugin in &registry.plugins {
            let id = &plugin.manifest.plugin.name;
            let missing = crate::grants::ungranted(
                &plugin.manifest.permissions.required_permissions,
                grants.granted_for(id),
            );
            if !missing.is_empty() {
                ungranted_any.push((
                    id.clone(),
                    missing.iter().map(ToString::to_string).collect(),
                ));
            }
        }
        if !ungranted_any.is_empty() {
            // Fail closed, and name the remedy concretely: the operator has to
            // be able to paste the fix, not go hunting for the file's shape.
            let detail = ungranted_any
                .iter()
                .map(|(id, perms)| {
                    format!(
                        "'{id}' needs [{}]",
                        perms
                            .iter()
                            .map(|p| format!("\"{p}\""))
                            .collect::<Vec<_>>()
                            .join(", ")
                    )
                })
                .collect::<Vec<_>>()
                .join("; ");
            return Err(PluginError::Manifest(format!(
                "plugin permissions were not granted by the operator — refused. {detail}. \
                 Record the approval in {} as: \
                 {{ \"schema_version\": {}, \"grants\": {{ \"<plugin-id>\": [\"<permission>\"] }} }}",
                grants_path.display(),
                crate::grants::SUPPORTED_SCHEMA_VERSION_PUBLIC,
            )));
        }
        // Every plugin that reached here has granted == declared, so the
        // capability-gated `oz` table built below from `required_permissions`
        // IS the granted set. The gate is deliberately single-source: adding a
        // second filter over that table would let the two disagree, and the
        // rejection above is the only place the decision is made.
        tracing::debug!(
            plugins = registry.plugins.len(),
            grants_file = %grants_path.display(),
            "plugin permission grants verified"
        );

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
            content_hash,
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

    /// Content hash of the plugin set this runtime was built from (C2).
    ///
    /// Stable for the lifetime of the runtime: changing it requires loading a
    /// new set, which is an explicit operator action — the desktop shell no
    /// longer swaps the live manager automatically.
    pub fn content_hash(&self) -> u64 {
        self.content_hash
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
        // kasirmu-lua build_lines_table). Plugin arithmetic such as
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
