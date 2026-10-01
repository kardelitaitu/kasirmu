//! Daemon health registry — makes a dead background task observable.
//!
//! # Why this exists (C23)
//!
//! Every daemon in both shells is spawned through [`crate::spawn_daemon`],
//! whose watchdog detected a panic and did nothing with it but log
//! `ERROR <name> panicked`. A log line is not a report when nothing reads
//! it: a daemon could die permanently and the only trace was one line in a
//! file nobody tails. The same argument this crate already applies to
//! write-only database projections applies here.
//!
//! This module turns daemon liveness into a value. A shell can ask
//! [`DaemonRegistry::dead`] and act; a future supervisor can restart from
//! that set; a diagnostics screen can list it. The registry is deliberately
//! inert — it records and answers, and decides nothing about policy.
//!
//! # What is deliberately NOT here
//!
//! **No automatic restart.** [`crate::spawn_daemon`] takes a consumed
//! future (`impl Future + 'static`), so the task cannot be re-created from
//! inside the watchdog without changing all 23 call sites to pass a factory.
//! Restart is therefore a real design change — restart-loop policy, backoff,
//! and what a second failure means — not a small one, and inventing it here
//! would have been the wrong call. What was missing is that the death was
//! *invisible*; it is now visible and actionable.
//!
//! # Thread-safety
//!
//! The registry is an `Arc`-shared `Mutex<HashMap>`, written once per daemon
//! transition. Locks are never held across an await, so it cannot deadlock
//! against the daemon tasks it observes.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// What is known about one spawned background task.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DaemonState {
    /// Registered, but the watchdog has not yet observed anything.
    Running,
    /// The task unwound. It is gone and will not come back.
    Panicked,
    /// The task returned although it was spawned as a daemon and was
    /// expected never to resolve.
    ExitedUnexpectedly,
    /// A one-shot task that finished normally. Not a failure.
    Completed,
    /// No such task was ever registered.
    Unknown,
}

/// One registered task and what is known about it.
#[derive(Debug, Clone)]
pub struct DaemonHealth {
    /// The name the task was spawned under.
    pub name: String,
    /// Whether the task was spawned as a daemon or a one-shot.
    pub kind: DaemonKind,
    /// The last state the watchdog observed.
    pub state: DaemonState,
}

/// Whether a task was spawned as a long-running daemon or a one-shot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DaemonKind {
    /// Expected never to resolve; a normal return is a failure.
    Daemon,
    /// Expected to finish; a normal return is success.
    OneShot,
}

/// A registry of spawned background tasks and their observed states.
#[derive(Debug, Clone, Default)]
pub struct DaemonRegistry {
    entries: Arc<Mutex<HashMap<String, DaemonHealth>>>,
}

impl DaemonRegistry {
    /// Create an empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Record a task as spawned and running.
    ///
    /// Registering the same name twice replaces the entry, which is what a
    /// restart of a named task means.
    pub fn register_named(&self, name: &str, kind: DaemonKind) {
        if let Ok(mut map) = self.entries.lock() {
            map.insert(
                name.to_owned(),
                DaemonHealth {
                    name: name.to_owned(),
                    kind,
                    state: DaemonState::Running,
                },
            );
        }
    }

    /// Record a daemon as spawned and running.
    pub fn register(&self, name: String) {
        self.register_named(&name, DaemonKind::Daemon);
    }

    /// Record the state the watchdog observed for a task.
    pub fn record(&self, name: &str, state: DaemonState) {
        if let Ok(mut map) = self.entries.lock() {
            if let Some(entry) = map.get_mut(name) {
                entry.state = state;
                return;
            }
            // A state recorded for an unregistered task still matters: it
            // means a task died that nothing declared, which is exactly the
            // kind of gap worth surfacing rather than dropping.
            map.insert(
                name.to_owned(),
                DaemonHealth {
                    name: name.to_owned(),
                    kind: DaemonKind::Daemon,
                    state,
                },
            );
        }
    }

    /// The last observed state of a task.
    pub fn state(&self, name: &str) -> DaemonState {
        self.entries
            .lock()
            .ok()
            .and_then(|m| m.get(name).map(|e| e.state))
            .unwrap_or(DaemonState::Unknown)
    }

    /// Every task that died and did not complete normally.
    ///
    /// A one-shot that finished its work is not a failure and is excluded;
    /// a daemon that returned is, because a daemon is defined by not
    /// returning.
    pub fn dead(&self) -> Vec<String> {
        let Ok(map) = self.entries.lock() else {
            return Vec::new();
        };
        let mut names: Vec<String> = map
            .values()
            .filter(|e| {
                matches!(
                    (e.kind, e.state),
                    (DaemonKind::Daemon, DaemonState::Panicked)
                        | (DaemonKind::Daemon, DaemonState::ExitedUnexpectedly)
                        | (_, DaemonState::Panicked)
                )
            })
            .map(|e| e.name.clone())
            .collect();
        names.sort();
        names
    }

    /// A snapshot of every registered task, sorted by name for stable output.
    pub fn snapshot(&self) -> Vec<DaemonHealth> {
        let Ok(map) = self.entries.lock() else {
            return Vec::new();
        };
        let mut all: Vec<DaemonHealth> = map.values().cloned().collect();
        all.sort_by(|a, b| a.name.cmp(&b.name));
        all
    }

    /// True when at least one daemon has died.
    pub fn has_dead_daemon(&self) -> bool {
        !self.dead().is_empty()
    }
}

#[cfg(test)]
#[path = "daemon_health_tests.rs"]
mod tests;
