//! Fuzz target for money parsing and arithmetic — feeds arbitrary byte
//! sequences to `Currency::from_str()` and `Money` operations, verifying
//! no panics, no overflows, no invalid states.

#![no_main]

use libfuzzer_sys::fuzz_target;
use foundation::money::{Currency, Money};

fuzz_target!(|data: &[u8]| {
    if let Ok(s) = std::str::from_utf8(data) {
        // ── Currency parsing ──────────────────────────────────
        if let Ok(currency) = s.parse::<Currency>() {
            let m = Money {
                minor_units: 0,
                currency,
            };
            // Zero-value arithmetic must always succeed.
            assert!(m.checked_add(m).is_some(), "zero+zero overflowed");
            assert!(m.checked_sub(m).is_some(), "zero-zero overflowed");
            assert!(m.checked_mul(1).is_some(), "zero*1 overflowed");
            assert!(m.checked_div(1).is_some(), "zero/1 overflowed");
        }
    }

    // ── Raw i64 arithmetic ──────────────────────────────────
    if data.len() >= 16 {
        let a = i64::from_le_bytes([data[0], data[1], data[2], data[3], data[4], data[5], data[6], data[7]]);
        let b = i64::from_le_bytes([data[8], data[9], data[10], data[11], data[12], data[13], data[14], data[15]]);

        let currency: Currency = "USD".parse().unwrap();
        let ma = Money { minor_units: a, currency };
        let mb = Money { minor_units: b, currency };

        // checked_add — must never panic.
        let _ = ma.checked_add(mb);

        // checked_sub — must never panic.
        let _ = ma.checked_sub(mb);

        // checked_mul with small multipliers — must never panic.
        for &m in &[0i64, 1, 2, 10, 100, -1, -10] {
            let _ = ma.checked_mul(m);
        }
    }
});
