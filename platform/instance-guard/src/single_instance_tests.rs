use super::*;

#[test]
#[cfg(windows)]
fn test_to_wide() {
    let wide = to_wide("kasir.mu");
    let expected: Vec<u16> = "kasir.mu"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    assert_eq!(wide, expected);
}

#[test]
#[cfg(windows)]
fn test_mutex_acquisition_and_release() {
    // Unique to this process AND this call, so a concurrent test binary on the same host
    // cannot be holding the same name. This replaced a uuid dev-dependency: the test needs
    // uniqueness, and process id plus a nanosecond stamp already provides it without adding
    // a crate to the workspace.
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mutex_name = format!("Local\\kasirmu-unit-test-{}-{}", std::process::id(), stamp);
    let guard1 = acquire_windows(&mutex_name, std::time::Duration::from_millis(100));
    assert!(matches!(guard1, Acquisition::Acquired(_)));

    // Second attempt while guard1 is held should detect it is already running.
    let guard2 = acquire_windows(&mutex_name, std::time::Duration::from_millis(100));
    assert!(matches!(guard2, Acquisition::AlreadyRunning));

    // Release guard1 by dropping it.
    drop(guard1);

    // After dropping guard1, acquiring again should succeed.
    let guard3 = acquire_windows(&mutex_name, std::time::Duration::from_millis(100));
    assert!(matches!(guard3, Acquisition::Acquired(_)));
}

#[test]
fn test_acquire_general() {
    // Calling acquire() should return either Acquired or AlreadyRunning without panicking.
    let res = acquire();
    match res {
        Acquisition::Acquired(_guard) => {
            // Successfully acquired
        }
        Acquisition::AlreadyRunning => {
            // Already running in another process on test machine
        }
    }
}
