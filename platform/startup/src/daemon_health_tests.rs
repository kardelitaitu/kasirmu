//! Unit tests for the daemon health registry.
//!
//! These cover the registry as a value: transitions, the dead-set
//! definition, and the one-shot-is-not-a-failure rule. The watchdog
//! integration — that a real panicking task actually lands here — lives in
//! `startup_tests.rs`, because it needs the spawn harness.

use super::*;

#[test]
fn a_registered_daemon_starts_running() {
    let r = DaemonRegistry::new();
    r.register("a".into());
    assert_eq!(r.state("a"), DaemonState::Running);
    assert!(r.dead().is_empty(), "a running daemon is not dead");
}

#[test]
fn an_unregistered_name_reads_as_unknown() {
    let r = DaemonRegistry::new();
    assert_eq!(r.state("never-spawned"), DaemonState::Unknown);
}

#[test]
fn a_panicked_daemon_is_dead() {
    let r = DaemonRegistry::new();
    r.register("a".into());
    r.record("a", DaemonState::Panicked);
    assert_eq!(r.state("a"), DaemonState::Panicked);
    assert_eq!(r.dead(), vec!["a".to_string()]);
    assert!(r.has_dead_daemon());
}

#[test]
fn a_daemon_that_returned_is_dead_because_a_daemon_must_not_return() {
    let r = DaemonRegistry::new();
    r.register("a".into());
    r.record("a", DaemonState::ExitedUnexpectedly);
    assert_eq!(r.dead(), vec!["a".to_string()]);
}

#[test]
fn a_finished_one_shot_is_not_dead() {
    let r = DaemonRegistry::new();
    r.register_named("boot", DaemonKind::OneShot);
    r.record("boot", DaemonState::Completed);
    assert!(
        r.dead().is_empty(),
        "a one-shot that finished its work is success, not a failure"
    );
}

#[test]
fn a_panicked_one_shot_is_also_dead() {
    // The distinction the kind carries: a one-shot that *panics* is as much
    // a failure as a daemon that panics — only a normal return is success.
    let r = DaemonRegistry::new();
    r.register_named("boot", DaemonKind::OneShot);
    r.record("boot", DaemonState::Panicked);
    assert_eq!(r.dead(), vec!["boot".to_string()]);
}

#[test]
fn recording_a_state_for_an_unregistered_task_still_surfaces_it() {
    // A task that died without being registered is exactly the gap worth
    // seeing; dropping it would reintroduce the silence this module removes.
    let r = DaemonRegistry::new();
    r.record("ghost", DaemonState::Panicked);
    assert_eq!(r.state("ghost"), DaemonState::Panicked);
    assert_eq!(r.dead(), vec!["ghost".to_string()]);
}

#[test]
fn re_registering_a_name_resets_it_to_running() {
    // What a manual restart of a named task means.
    let r = DaemonRegistry::new();
    r.register("a".into());
    r.record("a", DaemonState::Panicked);
    assert!(r.has_dead_daemon());
    r.register("a".into());
    assert_eq!(r.state("a"), DaemonState::Running);
    assert!(!r.has_dead_daemon());
}

#[test]
fn dead_is_sorted_and_snapshot_is_stable() {
    let r = DaemonRegistry::new();
    for n in ["zeta", "alpha", "mid"] {
        r.register(n.into());
        r.record(n, DaemonState::Panicked);
    }
    assert_eq!(r.dead(), vec!["alpha", "mid", "zeta"]);
    let snapshot = r.snapshot();
    let names: Vec<&str> = snapshot.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, vec!["alpha", "mid", "zeta"]);
}

#[test]
fn the_registry_is_shared_by_clone_not_copied() {
    // The shells hold one registry and hand clones to each spawn; a clone
    // that did not share state would make the feature silently useless.
    let r = DaemonRegistry::new();
    let clone = r.clone();
    clone.register("a".into());
    assert_eq!(r.state("a"), DaemonState::Running);
    r.record("a", DaemonState::Panicked);
    assert_eq!(clone.state("a"), DaemonState::Panicked);
}
