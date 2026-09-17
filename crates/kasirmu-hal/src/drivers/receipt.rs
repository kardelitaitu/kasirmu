/*
last audited 25-07-26 by RSA-Agent (oz-hal slice B: receipt deep read)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: HAL-1 FIXED 31-08-26 — layout padding/centering counted UTF-8 bytes (str::len()) where the column formatter counts characters, so multi-byte text stole padding from its own column. The original INFO severity understated this: currency_symbol returns € £ ¥ ₱ ฿ ₩ (2-3 bytes each), so EVERY price column shifted on EUR/GBP/JPY/PHP/THB/KRW receipts — not just Unicode store/product names as first recorded. All 8 sites now route through escpos::cell_width, and truncate() takes max-1 chars (inherently boundary-safe, replacing the old char_indices byte-slicing). East-Asian double-width remains unmodelled — needs a unicode-width dep, out of scope for Latin-script receipts. Otherwise exemplary: Money/format_minor delegation, documented PaperWidth/DecimalSeparator, per-store ReceiptConfig from settings, Indonesian NPWP/tax-id footer support, payment-link QR config hook
next: none | perf: N/A
*/
//! Receipt data types and ESC/POS formatting.
//!
//! Defines structured receipt models (`SalesReceipt`) and the
//! `format_sales_receipt` function that produces a ready-to-print
//! byte buffer. Display options are controlled through `ReceiptConfig`.
//!
//! # Layout (80 mm / 48 characters)
//!
//! ```text
//! ┌───────────────────────────────────────────────┐
//! │               STORE NAME                │
//! │             123 Main Street              │
//! ├───────────────────────────────────────────────┤
//! │ 01 Jan 2026           #REC-001         │
//! ├───────────────────────────────────────────────┤
//! │ Item                   Qty  Price  Total│
//! │ Milk 2%                  1  $3.50   $3.50│
//! │ Bread White              2  $2.00   $4.00│
//! ├───────────────────────────────────────────────┤
//! │ SUBTOTAL:                      $12.00│
//! │ TAX:                            $1.20│
//! ├───────────────────────────────────────────────┤
//! │ TOTAL:                        $13.20│
//! │                                       │
//! │ CASH:                          $20.00│
//! │ CHANGE:                         $6.80│
//! ├───────────────────────────────────────────────┤
//! │        Thanks for shopping!             │
//! └───────────────────────────────────────────────┘
//! ```

use oz_core::{Money, format_minor};

use super::escpos::{self, cell_width};

// ── Paper width ──────────────────────────────────────────

/// Thermal paper width presets.
#[derive(Debug, Clone, Copy)]
pub enum PaperWidth {
    /// ~58 mm paper (~32 monospace characters).
    Narrow,
    /// ~80 mm paper (~48 monospace characters).
    Standard,
}

impl PaperWidth {
    /// Maximum number of ASCII characters per line.
    #[must_use]
    pub fn chars(self) -> usize {
        match self {
            Self::Narrow => 32,
            Self::Standard => 48,
        }
    }
}

// ── Decimal separator ────────────────────────────────────

/// How fractional amounts are displayed on receipts.
#[derive(Debug, Clone, Copy)]
pub enum DecimalSeparator {
    /// Period separator: `12.50`
    Dot,
    /// Comma separator: `12,50`
    Comma,
    /// No fractional digits: `12`
    None,
}

impl DecimalSeparator {
    /// Which exponent to use when formatting. `None` means truncate
    /// fractional digits entirely.
    ///
    /// Note: the ESC/POS formatter now delegates exponent handling to
    /// `foundation::format_minor`; this method remains as the
    /// config-level API for the truncate-vs-keep decision.
    #[must_use]
    pub fn effective_exponent(self, raw: u32) -> Option<usize> {
        match self {
            Self::Dot | Self::Comma => Some(raw as usize),
            Self::None => None,
        }
    }
}

// ── Receipt display configuration ───────────────────────

/// Per-store display options for receipts. Stored in the
/// `settings` table and loaded before each print.
#[derive(Debug, Clone)]
pub struct ReceiptConfig {
    /// Paper width — controls line length.
    pub paper_width: PaperWidth,
    /// Whether to prefix amounts with the currency symbol (e.g. `"$"`).
    pub show_currency: bool,
    /// Decimal separator style.
    pub decimal_separator: DecimalSeparator,
    /// Whether to print a tax line.
    pub show_tax: bool,
    /// Optional footer text (centered at the bottom).
    pub footer: Option<String>,
    /// Whether to print the table number line.
    pub show_table_number: bool,
    /// Whether to print a barcode (receipt number) at the bottom.
    pub barcode_enabled: bool,
    /// Optional payment link template. If set, a QR code is printed
    /// below the barcode. Use `{receipt}` and `{amount}` as placeholders.
    /// Example: `"https://pay.example.com/{receipt}"`
    pub payment_link_template: Option<String>,
}

impl Default for ReceiptConfig {
    fn default() -> Self {
        Self {
            paper_width: PaperWidth::Standard,
            show_currency: false,
            decimal_separator: DecimalSeparator::Dot,
            show_tax: true,
            footer: None,
            show_table_number: false,
            barcode_enabled: false,
            payment_link_template: None,
        }
    }
}

// ── Store info ───────────────────────────────────────────

/// Store information printed at the top of every receipt.
#[derive(Debug, Clone)]
pub struct StoreInfo {
    /// Store display name.
    pub name: String,
    /// Street address line(s), joined with ` / `.
    pub address: String,
    /// Optional tax registration number.
    pub tax_id: Option<String>,
}

// ── Line item ────────────────────────────────────────────

/// A single product line on a receipt.
#[derive(Debug, Clone)]
pub struct LineItem {
    /// Product display name.
    pub name: String,
    /// Quantity purchased.
    pub quantity: u32,
    /// Price per unit.
    pub unit_price: Money,
    /// Quantity × unit price.
    pub total_price: Money,
    /// Tax amount for this line (None if tax is not itemised).
    pub tax_amount: Option<Money>,
}

// ── Payment info ─────────────────────────────────────────

/// A payment applied to the receipt.
#[derive(Debug, Clone)]
pub struct PaymentInfo {
    /// Payment method label (e.g. `"CASH"`, `"CARD"`, `"QRIS"`).
    pub method: String,
    /// Amount tendered.
    pub amount: Money,
    /// Change returned, if applicable.
    pub change: Option<Money>,
}

// ── Sales receipt ────────────────────────────────────────

/// A complete sales receipt ready to format and print.
///
/// Display formatting (currency prefix, decimal separator, etc.)
/// is handled by [`ReceiptConfig`] passed to [`format_sales_receipt`].
#[derive(Debug, Clone)]
pub struct SalesReceipt {
    /// Store identity printed at the top.
    pub store: StoreInfo,
    /// Transaction date string (already localised).
    pub date: String,
    /// Sequential receipt / invoice number.
    pub receipt_number: String,
    /// Optional table number (printed after date line).
    pub table_number: Option<String>,
    /// Purchased line items.
    pub items: Vec<LineItem>,
    /// Subtotal before tax.
    pub subtotal: Money,
    /// Tax amount (None => no tax line).
    pub tax: Option<Money>,
    /// Grand total (subtotal + tax).
    pub total: Money,
    /// Payments tendered.
    pub payments: Vec<PaymentInfo>,
}

// ── Helpers ──────────────────────────────────────────────

/// Format a `Money` value according to display config.
///
/// The decimal math — exponent lookup, major/fraction split, sign and
/// zero-padding — is delegated to `foundation::format_minor`, which
/// renders the signed decimal with a `.` separator and the currency's
/// canonical exponent (e.g. `"15.50"`, `"-0.012"`, or `"4450000"` for
/// exp-0 IDR). This wrapper only applies the receipt-specific display
/// config: the currency prefix and the decimal separator style.
fn format_money(m: &Money, config: &ReceiptConfig) -> String {
    let raw = format_minor(m.minor_units, m.currency);
    let (sign, digits) = match raw.strip_prefix('-') {
        Some(rest) => ("-", rest),
        None => ("", raw.as_str()),
    };
    // exp-0 currencies (IDR/JPY/KRW/…) have no fractional minor unit, so
    // `digits` may be a bare major part with nothing after the dot.
    let (major, frac) = digits
        .split_once('.')
        .map_or((digits, None), |(maj, fr)| (maj, Some(fr)));

    let prefix = if config.show_currency {
        currency_symbol(&m.currency)
    } else {
        ""
    };

    match (config.decimal_separator, frac) {
        (DecimalSeparator::Comma, Some(fr)) => format!("{sign}{prefix}{major},{fr}"),
        (DecimalSeparator::Dot, Some(fr)) => format!("{sign}{prefix}{major}.{fr}"),
        // `None` separator, or an exp-0 currency with nothing after the dot.
        (_, _) => format!("{sign}{prefix}{major}"),
    }
}

/// Best-effort currency symbol for the given ISO-4217 code.
/// Falls back to the code itself if no common symbol is known.
fn currency_symbol(currency: &oz_core::Currency) -> &'static str {
    let code = std::str::from_utf8(&currency.0).unwrap_or("  ");
    match code {
        "USD" | "SGD" | "HKD" => "$",
        "EUR" => "€",
        "GBP" => "£",
        "JPY" => "¥",
        "IDR" => "Rp",
        "MYR" => "RM",
        "PHP" => "₱",
        "THB" => "฿",
        "KRW" => "₩",
        "BRL" => "R$",
        _ => "$",
    }
}

/// Truncate a string to at most `max` character cells, appending `…` if cut.
///
/// Taking `max - 1` *characters* rather than slicing bytes is inherently
/// UTF-8 boundary-safe, so a multi-byte name like "café" can never be split
/// mid-codepoint.
fn truncate(s: &str, max: usize) -> String {
    if cell_width(s) <= max {
        s.to_owned()
    } else if max > 1 {
        let kept: String = s.chars().take(max - 1).collect();
        format!("{kept}…")
    } else {
        "…".to_owned()
    }
}

// ── Builder ──────────────────────────────────────────────

/// Internal builder that accumulates ESC/POS bytes.
struct ReceiptBuilder {
    buf: Vec<u8>,
    width: usize,
}

impl ReceiptBuilder {
    fn new(width: usize) -> Self {
        Self {
            buf: Vec::with_capacity(2048),
            width,
        }
    }

    fn init(&mut self) {
        self.buf.extend_from_slice(escpos::ESC_INIT);
        self.buf.extend_from_slice(escpos::LINE_SPACING_DEFAULT);
        self.buf.extend_from_slice(escpos::FONT_A);
    }

    fn left(&mut self) {
        self.buf.extend_from_slice(escpos::ALIGN_LEFT);
    }

    fn text(&mut self, s: &str) {
        self.buf.extend_from_slice(s.as_bytes());
        self.buf.extend_from_slice(escpos::LF);
    }

    fn center(&mut self, s: &str) {
        self.buf.extend_from_slice(escpos::ALIGN_CENTER);
        self.buf.extend_from_slice(s.as_bytes());
        self.buf.extend_from_slice(escpos::LF);
        self.left();
    }

    fn bold_center(&mut self, s: &str) {
        self.buf.extend_from_slice(escpos::BOLD_ON);
        self.center(s);
        self.buf.extend_from_slice(escpos::BOLD_OFF);
    }

    fn bold(&mut self, s: &str) {
        self.buf.extend_from_slice(escpos::BOLD_ON);
        self.text(s);
        self.buf.extend_from_slice(escpos::BOLD_OFF);
    }

    fn separator(&mut self) {
        self.text(&"─".repeat(self.width));
    }

    fn blank(&mut self) {
        self.text("");
    }

    fn feed(&mut self, n: u8) {
        self.buf.extend_from_slice(&escpos::feed(n));
    }

    fn cut(&mut self) {
        self.buf.extend_from_slice(escpos::CUT_FULL);
    }

    fn barcode(&mut self, barcode_type: escpos::BarcodeType, data: &[u8]) {
        self.left();
        self.blank();
        self.buf
            .extend_from_slice(&escpos::barcode(barcode_type, data));
        self.buf.extend_from_slice(escpos::LF);
    }

    fn qr_code(&mut self, data: &[u8], module_size: u8) {
        self.blank();
        self.buf
            .extend_from_slice(&escpos::qr_code(data, module_size));
        self.buf.extend_from_slice(escpos::LF);
    }

    fn build(self) -> Vec<u8> {
        self.buf
    }
}

// ── Column layout helpers ────────────────────────────────

/// Column widths for the item table, keyed by paper width.
struct TableCols {
    name: usize,
    qty: usize,
    price: usize,
    total: usize,
    sep: &'static str,
}

impl TableCols {
    fn for_width(w: usize) -> Self {
        match w {
            32 => Self {
                name: 16,
                qty: 3,
                price: 5,
                total: 5,
                sep: " ",
            },
            _ => Self {
                name: 26,
                qty: 4,
                price: 6,
                total: 6,
                sep: "  ",
            },
        }
    }
}

// ── Public formatter ─────────────────────────────────────

/// Build an ESC/POS byte buffer for a sales receipt.
///
/// `config` controls display options (currency prefix, decimal
/// separator, paper width, tax visibility, footer text).
///
/// The returned buffer can be sent directly to any printer via
/// `ReceiptPrinter::print_raw` — it includes the initialisation
/// sequence, all text and formatting commands, a 3-line paper feed,
/// and a full paper cut.
pub fn format_sales_receipt(r: &SalesReceipt, config: &ReceiptConfig) -> Vec<u8> {
    let w = config.paper_width.chars();
    let mut b = ReceiptBuilder::new(w);

    b.init();
    b.blank();

    // ── Header (centered + bold) ──────────────────────
    b.bold_center(&r.store.name);
    for line in r.store.address.split('/') {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            b.center(trimmed);
        }
    }
    if let Some(ref tax_id) = r.store.tax_id {
        b.center(&format!("NPWP: {tax_id}"));
    }
    b.blank();
    b.separator();

    // ── Date / receipt number ─────────────────────────
    let right_text = format!("#{}", r.receipt_number);
    let left_text = &r.date;
    let gap = " ".repeat(w.saturating_sub(cell_width(left_text) + cell_width(&right_text) + 1));
    b.text(&format!("{left_text}{gap}{right_text}"));

    // ── Table number (optional) ────────────────────────
    if config.show_table_number
        && let Some(ref tn) = r.table_number
    {
        let table_line = format!("Table: {tn}");
        let table_gap = " ".repeat(w.saturating_sub(cell_width(&table_line)));
        b.text(&format!("{table_gap}{table_line}"));
    }

    b.separator();

    // ── Column headers ────────────────────────────────
    let cols = TableCols::for_width(w);
    {
        let name_w = cols.name.saturating_sub(4);
        let qty_h = right_pad("Qty", cols.qty);
        let price_h = right_pad("Price", cols.price);
        let total_h = right_pad("Total", cols.total);
        let header = format!(
            "Item{:<name_w$}{s}{qty_h}{s}{price_h}{s}{total_h}",
            "",
            s = cols.sep,
        );
        b.bold(&header);
    }

    // ── Line items ────────────────────────────────────
    for item in &r.items {
        let name = truncate(&item.name, cols.name);
        let qty_s = format!("{}", item.quantity);
        let price_s = format_money(&item.unit_price, config);
        let total_s = format_money(&item.total_price, config);

        let qty_pad = cols.qty.saturating_sub(cell_width(&qty_s));
        let price_pad = cols.price.saturating_sub(cell_width(&price_s));
        let total_pad = cols.total.saturating_sub(cell_width(&total_s));

        let line = format!(
            "{:<name$}{sep}{:>qty_pad$}{qty_s}{sep}{:>price_pad$}{price_s}{sep}{:>total_pad$}{total_s}",
            name,
            "",
            "",
            "",
            name = cols.name,
            sep = cols.sep,
            qty_pad = qty_pad,
            price_pad = price_pad,
            total_pad = total_pad,
        );
        b.text(&line);
        if config.show_tax
            && let Some(ref tax) = item.tax_amount
        {
            let indent = cols.name
                + cell_width(cols.sep)
                + cols.qty
                + cell_width(cols.sep)
                + cols.price
                + cell_width(cols.sep);
            let tax_str = format_money(tax, config);
            let tax_line = format!(
                "{:indent$}Tax: {:>tax_pad$}{tax_str}",
                "",
                "",
                indent = indent,
                tax_pad = cols.total.saturating_sub(cell_width(&tax_str) + 5)
            );
            b.text(&tax_line);
        }
    }
    b.separator();

    // ── Totals (right-aligned) ────────────────────────
    b.text(&right_line(
        "SUBTOTAL:",
        &format_money(&r.subtotal, config),
        w,
    ));
    if config.show_tax
        && let Some(ref tax) = r.tax
    {
        b.text(&right_line("TAX:", &format_money(tax, config), w));
    }
    b.separator();
    b.bold(&right_line("TOTAL:", &format_money(&r.total, config), w));
    b.blank();

    // ── Payments ──────────────────────────────────────
    for pmt in &r.payments {
        b.text(&right_line(
            &pmt.method.to_uppercase(),
            &format_money(&pmt.amount, config),
            w,
        ));
        if let Some(ref chg) = pmt.change {
            b.text(&right_line("CHANGE:", &format_money(chg, config), w));
        }
    }

    // ── Footer ────────────────────────────────────────
    if let Some(ref footer) = config.footer {
        b.separator();
        b.center(footer);
    }

    b.blank();

    // ── Barcode (receipt number) ──────────────────
    if config.barcode_enabled {
        let receipt_barcode = format!("#{}", r.receipt_number);
        b.barcode(escpos::BarcodeType::Code128, receipt_barcode.as_bytes());
    }

    // ── QR code (payment link) ────────────────────
    if let Some(ref template) = config.payment_link_template {
        let qr_data = template
            .replace("{receipt}", &r.receipt_number)
            .replace("{amount}", &r.total.minor_units.to_string());
        if !qr_data.is_empty() {
            b.qr_code(qr_data.as_bytes(), 5);
        }
    }

    b.feed(3);
    b.cut();
    b.build()
}

/// Right-pad a string to at least `width` characters with leading spaces.
fn right_pad(s: &str, width: usize) -> String {
    if cell_width(s) >= width {
        s.to_owned()
    } else {
        format!("{:>width$}", s, width = width)
    }
}

/// Line with the value right-aligned so it ends exactly on the margin:
/// `"LABEL         12.50"`.
///
/// The gap is `width - label - value` cells. The previous version added a
/// `+ 1` to the content width for a separator space that the padding branch
/// then never emitted, so every totals line landed one cell short of the
/// margin that [`right_pad`]-padded line items and `separator()` reach —
/// visible as the `Total` column edge jagging against the item rows.
fn right_line(label: &str, value: &str, width: usize) -> String {
    let gap_cells = width.saturating_sub(cell_width(label) + cell_width(value));
    if gap_cells == 0 {
        // No room to align: emit a single space and let the line overflow.
        format!("{label} {value}")
    } else {
        format!("{label}{}{value}", " ".repeat(gap_cells))
    }
}

// ── Tests ────────────────────────────────────────────────

#[cfg(test)]
#[path = "receipt_tests.rs"]
mod tests;
