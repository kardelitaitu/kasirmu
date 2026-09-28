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
    let mutex_name = format!("Local\\kasirmu-unit-test-{}", uuid::Uuid::new_v4());
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
