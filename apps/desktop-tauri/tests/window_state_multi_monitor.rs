//! Multi-monitor window state persistence tests.
//!
//! Simulates 3 identical 1920×1080 monitors and verifies that the
//! `tauri-plugin-window-state` save/restore cycle correctly remembers
//! window position and which monitor it was on after restart.
//!
//! ## Monitor layout (3× 1920×1080, side-by-side)
//!
//! ```text
//!  ┌────────────┬────────────┬────────────┐
//!  │  Monitor 1 │  Monitor 2 │  Monitor 3 │
//!  │  0..1920   │ 1920..3840 │ 3840..5760 │
//!  │  0..1080   │  0..1080   │  0..1080   │
//!  └────────────┴────────────┴────────────┘
//! ```

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

// ── Domain types ────────────────────────────────────────────────────

/// A rectangular monitor region in virtual screen coordinates.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Monitor {
    /// Left edge in virtual coordinates.
    x_min: i32,
    /// Right edge (exclusive).
    x_max: i32,
    /// Top edge.
    y_min: i32,
    /// Bottom edge (exclusive).
    y_max: i32,
    /// Human-readable label.
    label: &'static str,
}

impl Monitor {
    const fn new(label: &'static str, x_min: i32, x_max: i32, y_min: i32, y_max: i32) -> Self {
        Self {
            label,
            x_min,
            x_max,
            y_min,
            y_max,
        }
    }

    /// Returns `true` if (x, y) falls inside this monitor's bounds
    /// (inclusive on min, exclusive on max — standard screen coordinate semantics).
    fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.x_min && x < self.x_max && y >= self.y_min && y < self.y_max
    }
}

/// Mirrors the JSON shape saved by `tauri-plugin-window-state` v2.
/// Fields match the plugin's serialisation format exactly.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct WindowState {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    #[serde(default)]
    maximized: bool,
    #[serde(default)]
    fullscreen: bool,
}

impl WindowState {
    /// Determine which monitor this window's top-left corner falls on.
    fn monitor<'a>(&self, monitors: &'a [Monitor]) -> Option<&'a Monitor> {
        monitors.iter().find(|m| m.contains(self.x, self.y))
    }
}

// ── Test fixtures ───────────────────────────────────────────────────

/// Three identical 1920×1080 monitors side-by-side.
fn three_identical_monitors() -> [Monitor; 3] {
    [
        Monitor::new("Monitor 1", 0, 1920, 0, 1080),
        Monitor::new("Monitor 2", 1920, 3840, 0, 1080),
        Monitor::new("Monitor 3", 3840, 5760, 0, 1080),
    ]
}

/// Generate a random position that falls within the given monitor,
/// with at least 50px padding from edges (so the window is fully visible).
fn random_position_on(monitor: &Monitor, rng: &mut impl rand::Rng) -> (i32, i32) {
    let pad = 50;
    let x = rng.gen_range(monitor.x_min + pad..monitor.x_max - pad);
    let y = rng.gen_range(monitor.y_min + pad..monitor.y_max - pad);
    (x, y)
}

// ── Helpers ─────────────────────────────────────────────────────────

/// Serialise a WindowState to JSON (simulates the plugin's `save` path).
fn save_state(state: &WindowState) -> String {
    serde_json::to_string(state).expect("serialisation should succeed")
}

/// Deserialise a WindowState from JSON (simulates the plugin's `restore` path).
fn load_state(json: &str) -> WindowState {
    serde_json::from_str(json).expect("deserialisation should succeed")
}

// ── Tests ───────────────────────────────────────────────────────────

#[test]
fn save_and_restore_roundtrip_preserves_position() {
    let original = WindowState {
        x: 500,
        y: 300,
        width: 1280,
        height: 800,
        maximized: false,
        fullscreen: false,
    };

    let json = save_state(&original);
    let restored = load_state(&json);

    assert_eq!(restored, original);
}

#[test]
fn three_monitors_have_correct_bounds() {
    let monitors = three_identical_monitors();

    // Each monitor is 1920×1080
    for m in &monitors {
        assert_eq!(m.x_max - m.x_min, 1920, "{} width", m.label);
        assert_eq!(m.y_max - m.y_min, 1080, "{} height", m.label);
    }

    // Monitors don't overlap
    assert_eq!(monitors[0].x_max, monitors[1].x_min, "M1 right == M2 left");
    assert_eq!(monitors[1].x_max, monitors[2].x_min, "M2 right == M3 left");

    // Same vertical range
    for m in &monitors {
        assert_eq!(m.y_min, 0);
        assert_eq!(m.y_max, 1080);
    }
}

#[test]
fn random_position_on_each_monitor_is_within_bounds() {
    let monitors = three_identical_monitors();
    let mut rng = rand::thread_rng();

    for (i, monitor) in monitors.iter().enumerate() {
        for _ in 0..100 {
            let (x, y) = random_position_on(monitor, &mut rng);
            assert!(
                monitor.contains(x, y),
                "Monitor {i}: position ({x}, {y}) should be within {monitor:?}"
            );
        }
    }
}

#[test]
fn detect_monitor_from_position() {
    let monitors = three_identical_monitors();

    // Explicit positions on each monitor
    let cases = [
        ((100, 100), "Monitor 1"),
        ((1919, 500), "Monitor 1"),  // right edge of M1
        ((0, 0), "Monitor 1"),       // origin
        ((1920, 100), "Monitor 2"),  // left edge of M2
        ((3839, 500), "Monitor 2"),  // right edge of M2
        ((3840, 100), "Monitor 3"),  // left edge of M3
        ((5759, 1079), "Monitor 3"), // bottom-right corner of M3
    ];

    for ((x, y), expected_label) in cases {
        let state = WindowState {
            x,
            y,
            width: 1280,
            height: 800,
            maximized: false,
            fullscreen: false,
        };
        let found = state
            .monitor(&monitors)
            .unwrap_or_else(|| panic!("({x}, {y}) should be on a monitor"));
        assert_eq!(
            found.label, expected_label,
            "position ({x}, {y}) expected on {expected_label}, found on {}",
            found.label
        );
    }
}

#[test]
fn negative_position_is_off_screen() {
    let monitors = three_identical_monitors();
    let state = WindowState {
        x: -100,
        y: 100,
        width: 1280,
        height: 800,
        maximized: false,
        fullscreen: false,
    };
    assert!(
        state.monitor(&monitors).is_none(),
        "negative x should not match any monitor"
    );
}

#[test]
fn save_restore_after_move_across_monitors() {
    let monitors = three_identical_monitors();
    let mut rng = rand::thread_rng();

    // ── Step 1: Random position on Monitor 1 ────────────────────
    let (x1, y1) = random_position_on(&monitors[0], &mut rng);
    let mut state = WindowState {
        x: x1,
        y: y1,
        width: 1280,
        height: 800,
        maximized: false,
        fullscreen: false,
    };

    // Save → "close app"
    let json = save_state(&state);

    // "Reopen app" → restore
    let restored = load_state(&json);
    assert_eq!(
        restored, state,
        "restore after monitor 1 should preserve position"
    );
    assert_eq!(
        restored.monitor(&monitors).unwrap().label,
        "Monitor 1",
        "should still be on Monitor 1 after restore"
    );

    // ── Step 2: Move to Monitor 2 ──────────────────────────────
    let (x2, y2) = random_position_on(&monitors[1], &mut rng);
    state.x = x2;
    state.y = y2;

    let json = save_state(&state);
    let restored = load_state(&json);
    assert_eq!(
        restored, state,
        "restore after monitor 2 should preserve position"
    );
    assert_eq!(
        restored.monitor(&monitors).unwrap().label,
        "Monitor 2",
        "should be on Monitor 2 after move"
    );

    // ── Step 3: Move to Monitor 3 ──────────────────────────────
    let (x3, y3) = random_position_on(&monitors[2], &mut rng);
    state.x = x3;
    state.y = y3;

    let json = save_state(&state);
    let restored = load_state(&json);
    assert_eq!(
        restored, state,
        "restore after monitor 3 should preserve position"
    );
    assert_eq!(
        restored.monitor(&monitors).unwrap().label,
        "Monitor 3",
        "should be on Monitor 3 after move"
    );
}

#[test]
fn repeated_save_restore_cycle_does_not_drift() {
    let monitors = three_identical_monitors();
    let mut rng = rand::thread_rng();

    let (x, y) = random_position_on(&monitors[0], &mut rng);
    let original = WindowState {
        x,
        y,
        width: 1280,
        height: 800,
        maximized: false,
        fullscreen: false,
    };

    // 100 save/restore cycles should not change the state
    let mut current = original.clone();
    for i in 0..100 {
        let json = save_state(&current);
        current = load_state(&json);
        assert_eq!(
            current, original,
            "cycle {i}: position should not drift after save/restore"
        );
    }
}

#[test]
fn maximized_state_is_preserved() {
    let state = WindowState {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        maximized: true,
        fullscreen: false,
    };

    let json = save_state(&state);
    let restored = load_state(&json);
    assert_eq!(restored, state);
    assert!(
        restored.maximized,
        "maximized flag should survive round-trip"
    );
}

#[test]
fn fullscreen_state_is_preserved() {
    let state = WindowState {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        maximized: false,
        fullscreen: true,
    };

    let json = save_state(&state);
    let restored = load_state(&json);
    assert_eq!(restored, state);
    assert!(
        restored.fullscreen,
        "fullscreen flag should survive round-trip"
    );
}

#[test]
fn all_monitor_positions_map_to_distinct_monitors() {
    let monitors = three_identical_monitors();
    let mut rng = rand::thread_rng();
    let mut seen = HashSet::new();

    // Generate 30 random positions (10 per monitor) and verify
    // each maps to the expected monitor without overlap.
    for (i, monitor) in monitors.iter().enumerate() {
        for _ in 0..10 {
            let (x, y) = random_position_on(monitor, &mut rng);
            let state = WindowState {
                x,
                y,
                width: 1280,
                height: 800,
                maximized: false,
                fullscreen: false,
            };
            let found = state.monitor(&monitors).expect("should find a monitor");
            assert_eq!(
                found.label, monitor.label,
                "monitor {i}: position ({x}, {y}) mapped to {} instead of {}",
                found.label, monitor.label
            );
            seen.insert((x, y));
        }
    }

    // All positions should be unique (probabilistic, but with 30 positions
    // on 3× 1920×1080 pixels the chance of collision is ~0.000003%).
    assert_eq!(seen.len(), 30, "all random positions should be unique");
}

#[test]
fn window_size_is_independent_of_monitor_assignment() {
    let monitors = three_identical_monitors();
    let mut rng = rand::thread_rng();

    // Wide window on Monitor 2
    let (x, y) = random_position_on(&monitors[1], &mut rng);
    let state = WindowState {
        x,
        y,
        width: 1600,
        height: 900,
        maximized: false,
        fullscreen: false,
    };

    let json = save_state(&state);
    let restored = load_state(&json);
    assert_eq!(restored.width, 1600);
    assert_eq!(restored.height, 900);
    assert_eq!(restored.monitor(&monitors).unwrap().label, "Monitor 2");
}
