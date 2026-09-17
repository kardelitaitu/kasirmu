/*
last audited 25-07-26 by RSA-Agent (kasirmu-lua slice A: bridge verified)
crate: kasirmu-lua | status: SAFE | lint: CLEAN
findings: clean event bridge — owner-scoped registration and dispatch, no unwrap/panic/unsafe
next: none | perf: N/A
*/
//! Lua event bridge — exposes event subscription callbacks to Lua scripts.
//!
//! Provides the `oz.on()` and `oz.off()` APIs that let Lua plugins subscribe
//! to domain events such as `sale.completed`, `order.fired`, or custom events
//! fired by other plugins or the Rust backend.
//!
//! # Example (Lua)
//!
//! ```lua
//! oz.on("sale.completed", function(event)
//!     oz.log("info", "Sale completed: " .. event.total_minor)
//! end)
//! ```
//!
//! # Example (Rust)
//!
//! ```no_run
//! # use kasirmu_lua::bridge::LuaEventBridge;
//! # use kasirmu_lua::LuaRuntime;
//! # fn example() -> Result<(), Box<dyn std::error::Error>> {
//! let bridge = LuaEventBridge::new();
//! let lua = LuaRuntime::new()?;
//! // Register callbacks from Lua
//! // Fire from Rust
//! bridge.fire(lua.inner(), "sale.completed", mlua::Value::Nil)?;
//! # Ok(())
//! # }
//! ```

use std::collections::HashMap;

use mlua::{Function, Lua, RegistryKey, Value};

/// A single registered callback plus its owning plugin id.
#[derive(Debug)]
struct CallbackEntry {
    /// The plugin id that registered this callback (empty for system callbacks).
    owner: String,
    /// Registry key for the Lua callback function.
    key: RegistryKey,
}

/// Manages Lua event callbacks registered via `oz.on()`.
///
/// Callbacks are stored as `RegistryKey`s in the Lua registry so they
/// survive garbage collection between script loads. The bridge is
/// designed to be shared between the `PluginManager` and the Lua runtime.
#[derive(Debug)]
pub struct LuaEventBridge {
    /// Registry keys for callback functions, indexed by event name.
    callbacks: HashMap<String, Vec<CallbackEntry>>,
}

impl Default for LuaEventBridge {
    fn default() -> Self {
        Self::new()
    }
}

impl LuaEventBridge {
    /// Create a new empty event bridge.
    pub fn new() -> Self {
        Self {
            callbacks: HashMap::new(),
        }
    }

    /// Register a Lua callback for an event (called by `oz.on()`).
    ///
    /// The callback function is stored in the Lua registry so it persists
    /// across script reloads and survives GC. The callback is tagged with an
    /// empty owner (system-level); plugins should use
    /// [`register_for`](LuaEventBridge::register_for) so their callbacks can
    /// be removed when the plugin is disabled or reloaded.
    pub fn register(&mut self, lua: &Lua, event: String, callback: Function) -> mlua::Result<()> {
        self.register_for(String::new(), lua, event, callback)
    }

    /// Register a Lua callback for an event, tagged with the owning plugin id.
    ///
    /// All callbacks registered by one plugin can be removed with a single
    /// [`remove_owner`](LuaEventBridge::remove_owner) call when the plugin is
    /// disabled, reloaded, or fails to load.
    pub fn register_for(
        &mut self,
        owner: String,
        lua: &Lua,
        event: String,
        callback: Function,
    ) -> mlua::Result<()> {
        let key = lua.create_registry_value(callback)?;
        self.callbacks
            .entry(event)
            .or_default()
            .push(CallbackEntry { owner, key });
        Ok(())
    }

    /// Fire an event: call all registered Lua callbacks with the given args.
    ///
    /// Returns `Ok(())` even if individual callbacks error — errors are
    /// collected and returned as a single joined error string only if ALL
    /// callbacks fail. If at least one succeeds, the result is `Ok(())` and
    /// any partial failures are logged as warnings for observability.
    pub fn fire(&self, lua: &Lua, event: &str, args: Value) -> Result<(), crate::LuaError> {
        let Some(entries) = self.callbacks.get(event) else {
            return Ok(());
        };
        if entries.is_empty() {
            return Ok(());
        }

        let mut errors: Vec<String> = Vec::new();
        let mut success_count = 0usize;

        for entry in entries {
            let callback: Function = match lua.registry_value(&entry.key) {
                Ok(f) => f,
                Err(e) => {
                    errors.push(format!("failed to retrieve callback for '{event}': {e}"));
                    continue;
                }
            };

            match callback.call::<_, ()>(args.clone()) {
                Ok(()) => success_count += 1,
                Err(e) => errors.push(format!("callback for '{event}' failed: {e}")),
            }
        }

        // Documented contract: Ok unless EVERY callback failed.
        if success_count > 0 {
            if !errors.is_empty() {
                tracing::warn!(
                    event,
                    failed = errors.len(),
                    succeeded = success_count,
                    "partial callback failures for event"
                );
            }
            return Ok(());
        }

        if errors.is_empty() {
            return Ok(());
        }

        Err(crate::LuaError::Script(format!(
            "all {} callbacks for '{event}' failed: {}",
            errors.len(),
            errors.join("; ")
        )))
    }

    /// Remove all callbacks for a specific event.
    ///
    /// This drops the registry keys, allowing the Lua GC to collect
    /// the callback functions.
    pub fn off(&mut self, event: &str) {
        if let Some(entries) = self.callbacks.remove(event) {
            // RegistryKeys are dropped here, which removes them from the
            // Lua registry.
            drop(entries);
        }
    }

    /// Remove every callback registered by `owner` across all events.
    ///
    /// Used when a plugin is disabled or reloaded so stale callbacks from a
    /// removed plugin can never fire again.
    pub fn remove_owner(&mut self, owner: &str) {
        if owner.is_empty() {
            return;
        }
        self.callbacks.retain(|_, entries| {
            entries.retain(|e| e.owner != owner);
            !entries.is_empty()
        });
    }

    /// Remove every callback registered by `owner` for a single event.
    ///
    /// Backs the plugin-side `oz.off(event)` so one plugin can only ever
    /// unsubscribe its own callbacks, never another plugin's (PLG-04).
    pub fn off_for(&mut self, owner: &str, event: &str) {
        if owner.is_empty() {
            return;
        }
        if let Some(entries) = self.callbacks.get_mut(event) {
            entries.retain(|e| e.owner != owner);
            if entries.is_empty() {
                self.callbacks.remove(event);
            }
        }
    }

    /// Remove all callbacks for all events.
    pub fn clear(&mut self) {
        self.callbacks.clear();
    }

    /// Returns the number of events that have registered callbacks.
    pub fn event_count(&self) -> usize {
        self.callbacks.len()
    }

    /// Returns the total number of registered callbacks across all events.
    pub fn callback_count(&self) -> usize {
        self.callbacks.values().map(|v| v.len()).sum()
    }

    /// Check if any callbacks are registered for an event.
    pub fn has_callbacks(&self, event: &str) -> bool {
        self.callbacks.get(event).is_some_and(|v| !v.is_empty())
    }
}

#[cfg(test)]
#[path = "bridge_tests.rs"]
mod tests;
