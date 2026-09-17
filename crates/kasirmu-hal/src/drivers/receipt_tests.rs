use oz_core::Currency;

use super::*;

fn usd_money(amount: i64) -> Money {
    Money {
        minor_units: amount,
        currency: "USD".parse::<Currency>().unwrap(),
    }
}

fn default_config() -> ReceiptConfig {
    ReceiptConfig::default()
}

fn sample_receipt() -> SalesReceipt {
    SalesReceipt {
        store: StoreInfo {
            name: "OZ MART".into(),
            address: "123 Main Street / Springfield, IL 62701".into(),
            tax_id: Some("12-3456789".into()),
        },
        date: "01 Jan 2026".into(),
        receipt_number: "REC-001".into(),
        table_number: None,
        items: vec![
            LineItem {
                name: "Milk 2%".into(),
                quantity: 1,
                unit_price: usd_money(350),
                total_price: usd_money(350),
                tax_amount: Some(usd_money(35)),
            },
            LineItem {
                name: "Bread White".into(),
                quantity: 2,
                unit_price: usd_money(200),
                total_price: usd_money(400),
                tax_amount: Some(usd_money(40)),
            },
            LineItem {
                name: "Eggs (dozen)".into(),
                quantity: 1,
                unit_price: usd_money(450),
                total_price: usd_money(450),
                tax_amount: Some(usd_money(45)),
            },
        ],
        subtotal: usd_money(1200),
        tax: Some(usd_money(120)),
        total: usd_money(1320),
        payments: vec![PaymentInfo {
            method: "CASH".into(),
            amount: usd_money(2000),
            change: Some(usd_money(680)),
        }],
    }
}

#[test]
fn format_money_dot_default() {
    let cfg = default_config();
    assert_eq!(format_money(&usd_money(1550), &cfg), "15.50");
    assert_eq!(format_money(&usd_money(0), &cfg), "0.00");
    assert_eq!(format_money(&usd_money(100), &cfg), "1.00");
}

#[test]
fn format_money_comma() {
    let cfg = ReceiptConfig {
        decimal_separator: DecimalSeparator::Comma,
        ..default_config()
    };
    assert_eq!(format_money(&usd_money(1550), &cfg), "15,50");
}

#[test]
fn format_money_no_decimals() {
    let cfg = ReceiptConfig {
        decimal_separator: DecimalSeparator::None,
        ..default_config()
    };
    assert_eq!(format_money(&usd_money(1550), &cfg), "15");
    assert_eq!(format_money(&usd_money(100), &cfg), "1");
}

#[test]
fn format_money_with_currency() {
    let cfg = ReceiptConfig {
        show_currency: true,
        ..default_config()
    };
    assert_eq!(format_money(&usd_money(1550), &cfg), "$15.50");
}

#[test]
fn format_money_with_currency_no_decimals() {
    let cfg = ReceiptConfig {
        show_currency: true,
        decimal_separator: DecimalSeparator::None,
        ..default_config()
    };
    assert_eq!(format_money(&usd_money(2000), &cfg), "$20");
}

#[test]
fn format_money_negative() {
    let cfg = default_config();
    let m = Money {
        minor_units: -1550,
        currency: "USD".parse::<Currency>().unwrap(),
    };
    assert_eq!(format_money(&m, &cfg), "-15.50");
}

#[test]
fn format_money_negative_sub_major() {
    // -12 cents: the sign must survive delegation even though the major
    // part is zero (format_minor renders "-0.12", not "0.12").
    let cfg = default_config();
    let m = Money {
        minor_units: -12,
        currency: "USD".parse::<Currency>().unwrap(),
    };
    assert_eq!(format_money(&m, &cfg), "-0.12");

    let cfg = ReceiptConfig {
        decimal_separator: DecimalSeparator::None,
        ..default_config()
    };
    assert_eq!(format_money(&m, &cfg), "-0");
}

#[test]
fn format_money_idr_has_no_decimal_tail() {
    // IDR (exp 0) must not acquire a trailing ".0" — the minor unit
    // IS the Rupiah, so 4_450_000 Rp prints as-is under every separator.
    let m = Money {
        minor_units: 4_450_000,
        currency: "IDR".parse::<Currency>().unwrap(),
    };
    assert_eq!(format_money(&m, &default_config()), "4450000");
    let comma = ReceiptConfig {
        decimal_separator: DecimalSeparator::Comma,
        ..default_config()
    };
    assert_eq!(format_money(&m, &comma), "4450000");
    let none = ReceiptConfig {
        decimal_separator: DecimalSeparator::None,
        ..default_config()
    };
    assert_eq!(format_money(&m, &none), "4450000");
}

#[test]
fn format_money_kwd_three_decimals() {
    // KWD (exp 3): 12 fils → 0.012 — the exponent a naive /100 misses.
    let m = Money {
        minor_units: 12,
        currency: "KWD".parse::<Currency>().unwrap(),
    };
    assert_eq!(format_money(&m, &default_config()), "0.012");
    let comma = ReceiptConfig {
        decimal_separator: DecimalSeparator::Comma,
        ..default_config()
    };
    assert_eq!(format_money(&m, &comma), "0,012");
    let none = ReceiptConfig {
        decimal_separator: DecimalSeparator::None,
        ..default_config()
    };
    assert_eq!(format_money(&m, &none), "0");
}

#[test]
fn format_money_currency_prefix_after_sign() {
    let cfg = ReceiptConfig {
        show_currency: true,
        ..default_config()
    };
    let m = Money {
        minor_units: -1550,
        currency: "USD".parse::<Currency>().unwrap(),
    };
    assert_eq!(format_money(&m, &cfg), "-$15.50");
}

#[test]
fn truncate_short_string() {
    assert_eq!(truncate("Hello", 10), "Hello");
}

#[test]
fn truncate_long_string() {
    assert_eq!(truncate("Hello World", 8), "Hello W…");
}

#[test]
fn truncate_multibyte_never_splits_a_codepoint() {
    // "café latte" is c,a,f,é(2 bytes),space,… — a byte cut at 5 lands inside
    // é and used to yield "caf…" (4 bytes of content + ellipsis). That was
    // HAL-1: the budget is a COLUMN width, so it must be counted in cells.
    // Taking max-1 *characters* is inherently boundary-safe, so the
    // panic-safety this test was written for still holds, now at the right
    // width: 5 cells = "café" + "…".
    assert_eq!(truncate("café latte", 5), "café…");
    assert_eq!(cell_width(&truncate("café latte", 5)), 5);
    // A cut that lands mid-codepoint in byte space still yields valid UTF-8.
    for width in 1..12 {
        let cut = truncate("café ☕ latte", width);
        assert!(
            cell_width(&cut) <= width.max(1),
            "width {width} produced a {}-cell result",
            cell_width(&cut)
        );
    }
}

#[test]
fn sales_receipt_contains_store_name() {
    let data = format_sales_receipt(&sample_receipt(), &default_config());
    let text = String::from_utf8_lossy(&data);
    assert!(text.contains("OZ MART"));
}

#[test]
fn sales_receipt_contains_receipt_number() {
    let data = format_sales_receipt(&sample_receipt(), &default_config());
    let text = String::from_utf8_lossy(&data);
    assert!(text.contains("#REC-001"));
}

#[test]
fn sales_receipt_contains_item_names() {
    let data = format_sales_receipt(&sample_receipt(), &default_config());
    let text = String::from_utf8_lossy(&data);
    assert!(text.contains("Milk 2%"));
    assert!(text.contains("Bread White"));
    assert!(text.contains("Eggs (dozen)"));
}

#[test]
fn sales_receipt_contains_total() {
    let data = format_sales_receipt(&sample_receipt(), &default_config());
    let text = String::from_utf8_lossy(&data);
    assert!(text.contains("13.20"));
}

#[test]
fn sales_receipt_contains_tax_when_show_tax() {
    let cfg = ReceiptConfig {
        show_tax: true,
        ..default_config()
    };
    let data = format_sales_receipt(&sample_receipt(), &cfg);
    let text = String::from_utf8_lossy(&data);
    assert!(text.contains("TAX:"));
    assert!(text.contains("1.20"));
}

#[test]
fn sales_receipt_hides_tax_when_show_tax_false() {
    let cfg = ReceiptConfig {
        show_tax: false,
        ..default_config()
    };
    let data = format_sales_receipt(&sample_receipt(), &cfg);
    let text = String::from_utf8_lossy(&data);
    assert!(
        !text.contains("TAX:"),
        "tax should not appear when show_tax=false"
    );
}

#[test]
fn sales_receipt_shows_per_line_tax() {
    let cfg = ReceiptConfig {
        show_tax: true,
        ..default_config()
    };
    let data = format_sales_receipt(&sample_receipt(), &cfg);
    let text = String::from_utf8_lossy(&data);
    assert!(text.contains("Tax:"), "per-line tax label should appear");
    assert!(text.contains("0.35"), "milk tax should appear");
    assert!(text.contains("0.40"), "bread tax should appear");
    assert!(text.contains("0.45"), "egg tax should appear");
}

#[test]
fn sales_receipt_hides_per_line_tax_when_show_tax_false() {
    let cfg = ReceiptConfig {
        show_tax: false,
        ..default_config()
    };
    let data = format_sales_receipt(&sample_receipt(), &cfg);
    let text = String::from_utf8_lossy(&data);
    assert!(
        !text.contains("Tax:"),
        "per-line tax should not appear when show_tax=false"
    );
}

#[test]
fn sales_receipt_contains_currency_when_enabled() {
    let cfg = ReceiptConfig {
        show_currency: true,
        ..default_config()
    };
    let data = format_sales_receipt(&sample_receipt(), &cfg);
    let text = String::from_utf8_lossy(&data);
    assert!(
        text.contains("$13.20"),
        "receipt should show $ prefix: {:?}",
        text
    );
}

#[test]
fn sales_receipt_contains_payment_and_change() {
    let data = format_sales_receipt(&sample_receipt(), &default_config());
    let text = String::from_utf8_lossy(&data);
    assert!(text.contains("CASH"));
    assert!(text.contains("20.00"));
    assert!(text.contains("CHANGE:"));
    assert!(text.contains("6.80"));
}

#[test]
fn sales_receipt_prints_idr_without_trailing_decimal() {
    // IDR (exp 0): the Rupiah minor unit IS the whole amount — the
    // printer byte buffer must show "4450000" with no trailing ".0"
    // (the pre-delegation formatter emitted "4450000.0" for exp-0
    // currencies under the default Dot separator).
    let idr: Currency = "IDR".parse().unwrap();
    let money = |minor: i64| Money {
        minor_units: minor,
        currency: idr,
    };
    let r = SalesReceipt {
        store: StoreInfo {
            name: "TOKO OZ".into(),
            address: "Jl. Melati 1 / Jakarta".into(),
            tax_id: None,
        },
        date: "01 Jan 2026".into(),
        receipt_number: "REC-IDR".into(),
        table_number: None,
        items: vec![LineItem {
            name: "Paket Nasi".into(),
            quantity: 1,
            unit_price: money(4_450_000),
            total_price: money(4_450_000),
            tax_amount: None,
        }],
        subtotal: money(4_450_000),
        tax: None,
        total: money(4_450_000),
        payments: vec![PaymentInfo {
            method: "CASH".into(),
            amount: money(4_450_000),
            change: None,
        }],
    };

    let data = format_sales_receipt(&r, &default_config());
    let text = String::from_utf8_lossy(&data);
    assert!(
        text.contains("4450000"),
        "IDR amount must print raw: {text}"
    );
    // The negative assertion scans the WHOLE buffer (not just the TOTAL
    // line) on purpose: every value here is 4_450_000, so any single
    // formatted value regressing to a trailing decimal fails the test.
    assert!(
        !text.contains("4450000.0") && !text.contains("4450000."),
        "IDR must not gain a fractional tail under the Dot separator: {text}"
    );

    // The currency-prefix path must also print without a decimal tail.
    let cfg = ReceiptConfig {
        show_currency: true,
        ..default_config()
    };
    let data = format_sales_receipt(&r, &cfg);
    let text = String::from_utf8_lossy(&data);
    assert!(
        text.contains("Rp4450000"),
        "prefixed IDR amount must print raw: {text}"
    );
}

#[test]
fn sales_receipt_contains_footer() {
    let cfg = ReceiptConfig {
        footer: Some("Thank you for shopping!".into()),
        ..default_config()
    };
    let data = format_sales_receipt(&sample_receipt(), &cfg);
    let text = String::from_utf8_lossy(&data);
    assert!(text.contains("Thank you for shopping!"));
}

#[test]
fn sales_receipt_starts_with_esc_init() {
    let data = format_sales_receipt(&sample_receipt(), &default_config());
    assert!(data.starts_with(escpos::ESC_INIT));
}

#[test]
fn sales_receipt_ends_with_cut() {
    let data = format_sales_receipt(&sample_receipt(), &default_config());
    assert!(data.ends_with(escpos::CUT_FULL));
}

#[test]
fn narrow_width_uses_32_chars() {
    let cfg = ReceiptConfig {
        paper_width: PaperWidth::Narrow,
        ..default_config()
    };
    let data = format_sales_receipt(&sample_receipt(), &cfg);
    let text = String::from_utf8_lossy(&data);
    for line in text.lines() {
        let dash_count = line.chars().filter(|&c| c == '─').count();
        if dash_count > 0 {
            assert!(dash_count <= 32, "separator too long: {dash_count}");
        }
    }
}

#[test]
fn right_line_pads_correctly() {
    let result = right_line("TOTAL:", "13.20", 48);
    assert!(result.starts_with("TOTAL:"));
    assert!(result.ends_with("13.20"));
}

#[test]
fn decimal_separator_effective_exponent() {
    assert_eq!(DecimalSeparator::Dot.effective_exponent(2), Some(2));
    assert_eq!(DecimalSeparator::Comma.effective_exponent(3), Some(3));
    assert_eq!(DecimalSeparator::None.effective_exponent(2), None);
}

#[test]
fn currency_symbol_known_codes() {
    let usd: oz_core::Currency = "USD".parse().unwrap();
    let eur: oz_core::Currency = "EUR".parse().unwrap();
    let idr: oz_core::Currency = "IDR".parse().unwrap();
    assert_eq!(currency_symbol(&usd), "$");
    assert_eq!(currency_symbol(&eur), "€");
    assert_eq!(currency_symbol(&idr), "Rp");
}

#[test]
fn receipt_prints_table_number_when_enabled_and_provided() {
    let cfg = ReceiptConfig {
        show_table_number: true,
        ..default_config()
    };
    let mut r = sample_receipt();
    r.table_number = Some("5".into());
    let data = format_sales_receipt(&r, &cfg);
    let text = String::from_utf8_lossy(&data);
    assert!(
        text.contains("Table: 5"),
        "receipt should contain 'Table: 5'"
    );
}

#[test]
fn receipt_hides_table_number_when_disabled() {
    let cfg = ReceiptConfig {
        show_table_number: false,
        ..default_config()
    };
    let mut r = sample_receipt();
    r.table_number = Some("5".into());
    let data = format_sales_receipt(&r, &cfg);
    let text = String::from_utf8_lossy(&data);
    assert!(
        !text.contains("Table:"),
        "receipt should not contain 'Table:'"
    );
}

#[test]
fn receipt_hides_table_number_when_none() {
    let cfg = ReceiptConfig {
        show_table_number: true,
        ..default_config()
    };
    let mut r = sample_receipt();
    r.table_number = None;
    let data = format_sales_receipt(&r, &cfg);
    let text = String::from_utf8_lossy(&data);
    assert!(
        !text.contains("Table:"),
        "receipt should not contain 'Table:'"
    );
}

// ── Barcode & QR code tests ───────────────────────────────────────

#[test]
fn barcode_appears_when_enabled() {
    let cfg = ReceiptConfig {
        barcode_enabled: true,
        ..default_config()
    };
    let data = format_sales_receipt(&sample_receipt(), &cfg);
    // Should contain GS h A0 (barcode height command)
    assert!(
        data.windows(3).any(|w| w == [0x1D, 0x68, 0xA0]),
        "missing GS h barcode height command"
    );
    // Should contain GS k (barcode print command)
    assert!(
        data.windows(2).any(|w| w == [0x1D, 0x6B]),
        "missing GS k barcode print command"
    );
    // Should contain the receipt number data
    let receipt_bytes = b"#REC-001";
    assert!(
        data.windows(receipt_bytes.len())
            .any(|w| w == receipt_bytes),
        "barcode should encode receipt number"
    );
}

#[test]
fn barcode_omitted_when_disabled() {
    let cfg = ReceiptConfig {
        barcode_enabled: false,
        ..default_config()
    };
    let data = format_sales_receipt(&sample_receipt(), &cfg);
    // Should NOT contain GS h A0 (barcode command prefix)
    // But could contain other GS commands, so we check for GS h specifically
    let gs_h_count = data.windows(2).filter(|w| *w == [0x1D, 0x68]).count();
    assert_eq!(gs_h_count, 0, "no GS h commands expected");
}

#[test]
fn qr_code_appears_when_template_provided() {
    let cfg = ReceiptConfig {
        payment_link_template: Some("https://pay.example.com/{receipt}".into()),
        ..default_config()
    };
    let data = format_sales_receipt(&sample_receipt(), &cfg);
    // Should contain GS ( k (QR code command prefix)
    assert!(
        data.windows(3).any(|w| w == [0x1D, 0x28, 0x6B]),
        "missing GS ( k QR code commands"
    );
    // Should contain the payment URL
    let url = b"https://pay.example.com/REC-001";
    assert!(
        data.windows(url.len()).any(|w| w == url),
        "QR code should contain payment URL with receipt number"
    );
}

#[test]
fn qr_code_with_amount_placeholder() {
    let cfg = ReceiptConfig {
        payment_link_template: Some("https://pay.example.com/{receipt}/{amount}".into()),
        ..default_config()
    };
    let data = format_sales_receipt(&sample_receipt(), &cfg);
    let expected = b"https://pay.example.com/REC-001/1320";
    assert!(
        data.windows(expected.len()).any(|w| w == expected),
        "QR should encode URL with amount"
    );
}

#[test]
fn qr_code_omitted_when_template_none() {
    let cfg = ReceiptConfig {
        payment_link_template: None,
        ..default_config()
    };
    let data = format_sales_receipt(&sample_receipt(), &cfg);
    let url = b"pay.example.com";
    assert!(
        !data.windows(url.len()).any(|w| w == url),
        "QR payment URL should not appear when template is None"
    );
}

#[test]
fn barcode_and_qr_both_appear_when_configured() {
    let item = sample_receipt();
    let cfg = ReceiptConfig {
        barcode_enabled: true,
        payment_link_template: Some("https://pay.example.com/qr".into()),
        ..default_config()
    };
    let data = format_sales_receipt(&item, &cfg);
    // Both barcode and QR commands should appear
    assert!(
        data.windows(2).any(|w| w == [0x1D, 0x6B]),
        "barcode command missing"
    );
    assert!(
        data.windows(3).any(|w| w == [0x1D, 0x28, 0x6B]),
        "QR command missing"
    );
}

// ── HAL-1 regression: multi-byte text must not steal column padding ───

#[test]
fn truncate_returns_exactly_max_cells_for_multibyte_text() {
    for name in [
        "ayam gepuk",
        "kopi ☕☕☕ latte",
        "sate padang",
        "es teh manis",
    ] {
        let cut = truncate(name, 8);
        assert_eq!(
            cell_width(&cut),
            8,
            "truncating {name:?} to 8 cells gave {cut:?}"
        );
    }
    // Under-width text is returned untouched.
    assert_eq!(truncate("short", 10), "short");
    // Degenerate widths still fit the budget.
    assert_eq!(cell_width(&truncate("ab", 1)), 1);
    assert_eq!(truncate("", 4), "");
}

#[test]
fn right_pad_pads_to_cells_not_bytes() {
    for s in ["€1,00", "₩12,345", "Rp 50.000", "฿25.50"] {
        assert_eq!(
            cell_width(&right_pad(s, 12)),
            12,
            "{s:?} did not land on a 12-cell column"
        );
    }
    // Already at or over the column: returned unchanged.
    assert_eq!(right_pad("₩12,345", 3), "₩12,345");
}

#[test]
fn right_line_ends_the_value_exactly_on_the_margin() {
    // Regression: the old content width reserved a separator space the
    // padding branch never emitted, so every totals line landed one cell
    // short of the margin the line-item rows and separator() reach.
    for (label, value) in [
        ("Total", "Rp 1.320"),
        ("Subtotal", "€12.50"),
        ("Tax", "₩1,000"),
        ("Change", "$6.80"),
    ] {
        let line = right_line(label, value, 32);
        assert_eq!(
            cell_width(&line),
            32,
            "{label}/{value} did not end on the 32-cell margin"
        );
    }
}

#[test]
fn right_line_overflows_gracefully_when_nothing_fits() {
    let line = right_line("A very long label", "123456", 10);
    assert_eq!(line, "A very long label 123456");
}
