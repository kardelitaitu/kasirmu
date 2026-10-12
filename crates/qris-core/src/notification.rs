//! Android Bank Push Notification Parser & Matching Engine for QRIS.
//!
//! Provides zero-MDR automated verification of incoming QRIS payments by parsing
//! push notification text from Indonesian banking and e-wallet applications without
//! requiring third-party payment gateway fees or manual cashier transaction audits.
//!
//! Key types:
//! - [`BankNotification`]: Structured payment data extracted from push notification.
//! - [`parse_notification`]: Regex parser for raw notification text and app package names.
//! - [`QrisMatchEngine`]: Deduplication cache and pending invoice amount/unique-code matcher.
//! - [`MatchResult`]: Deterministic outcome of evaluating a notification against a sale.

use regex::Regex;
use std::collections::VecDeque;
use std::hash::{DefaultHasher, Hash, Hasher};

/// Structured payment record extracted from an Android push notification.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct BankNotification {
    /// Android package name of the banking/e-wallet application (e.g. `com.bca`).
    pub package_name: String,
    /// Canonical provider name (e.g. "BCA", "Mandiri", "BRI", "Bank Jatim", "GoPay", "ShopeePay", "DANA", "OVO", "BNI", "BSI", "QRIS").
    pub provider: String,
    /// Amount extracted in minor currency units (for IDR, whole rupiah as `i64`).
    pub amount_minor: i64,
    /// Formatted display amount (e.g. "Rp 50.000").
    pub amount_formatted: String,
    /// Extracted sender / customer name or phone number, if present in the notification.
    pub sender_name: Option<String>,
    /// Raw unparsed notification text body.
    pub raw_text: String,
    /// Notification delivery timestamp in milliseconds since Unix epoch.
    pub timestamp_ms: u64,
}

/// Known package prefixes for Indonesian banks and e-wallets.
const BCA_PACKAGES: &[&str] = &["com.bca", "id.co.bca"];
const MANDIRI_PACKAGES: &[&str] = &["id.bmri.livin", "id.co.mandiri.livin"];
const BRI_PACKAGES: &[&str] = &["id.co.bri.brimo", "id.co.bri"];
const BANK_JATIM_PACKAGES: &[&str] = &["com.bankjatim.jatimmobile", "id.co.bankjatim"];
const GOPAY_PACKAGES: &[&str] = &["com.gojek.gobiz", "com.gojek.merchant", "com.gojek.app"];
const SHOPEE_PACKAGES: &[&str] = &[
    "com.shopeepay.merchant",
    "com.shopeepay.id",
    "com.shopee.id",
];
const DANA_PACKAGES: &[&str] = &["id.dana"];
const OVO_PACKAGES: &[&str] = &["ovo.id"];
const BNI_PACKAGES: &[&str] = &["id.co.bni", "com.bni"];
const BSI_PACKAGES: &[&str] = &["id.co.bankbsi", "com.bsi"];

/// Keywords indicating incoming credit or successful payment receipt.
const PAYMENT_KEYWORDS: &[&str] = &[
    "qris",
    "transfer masuk",
    "dana masuk",
    "saldo masuk",
    "pembayaran",
    "diterima",
    "berhasil",
    "payment received",
    "incoming transfer",
    "transaksi berhasil",
    "terima uang",
];

/// Keywords indicating outward debits, bill payments, or security OTPs to reject.
const REJECT_KEYWORDS: &[&str] = &[
    "transfer keluar",
    "pembelian",
    "beli pulsa",
    "pulsa",
    "tagihan",
    "anda telah membayar",
    "kamu telah bayar",
    "saldo terpotong",
    "kamu telah kirim",
    "debet",
    "debit",
    "otp",
    "kode rahasia",
    "jangan berikan",
    "pin anda",
    "kode verifikasi",
];

/// Parse raw notification text and package name into a structured [`BankNotification`].
///
/// Returns `None` if:
/// - The package name is not recognized and the text lacks incoming payment keywords.
/// - The text contains outward debit or OTP keywords.
/// - No valid IDR monetary amount could be extracted.
///
/// # Examples
///
/// ```
/// use qris_core::notification::parse_notification;
///
/// let notif = parse_notification(
///     "com.bca",
///     Some("BCA mobile"),
///     "QRIS Masuk: Rp 150.000 dari SITI NURHALIZA 15/09 11:20:05",
///     1726400000000,
/// ).expect("should parse BCA notification");
///
/// assert_eq!(notif.provider, "BCA");
/// assert_eq!(notif.amount_minor, 150_000);
/// assert_eq!(notif.sender_name.as_deref(), Some("SITI NURHALIZA"));
/// ```
pub fn parse_notification(
    package_name: &str,
    title: Option<&str>,
    text: &str,
    timestamp_ms: u64,
) -> Option<BankNotification> {
    let lower_pkg = package_name.to_lowercase();
    let combined_text = match title {
        Some(t) if !t.trim().is_empty() => format!("{t} | {text}"),
        _ => text.to_string(),
    };
    let lower_text = combined_text.to_lowercase();

    // 1. Check if package is a known payment app OR text contains credit keywords
    let is_known_app = is_known_payment_app(&lower_pkg);
    let has_keyword = PAYMENT_KEYWORDS.iter().any(|k| lower_text.contains(k));
    if !is_known_app && !has_keyword {
        return None;
    }

    // 2. Reject debits, outward transfers, and OTPs
    if REJECT_KEYWORDS.iter().any(|k| lower_text.contains(k)) {
        return None;
    }

    // 3. Extract amount
    let amount_minor = extract_amount(&combined_text)?;
    if amount_minor <= 0 {
        return None;
    }

    // 4. Resolve provider and sender
    let provider = resolve_provider(&lower_pkg, &lower_text);
    let sender_name = extract_sender_name(&combined_text);
    let amount_formatted = format_idr(amount_minor);

    Some(BankNotification {
        package_name: package_name.to_string(),
        provider,
        amount_minor,
        amount_formatted,
        sender_name,
        raw_text: combined_text,
        timestamp_ms,
    })
}

fn is_known_payment_app(pkg: &str) -> bool {
    BCA_PACKAGES.iter().any(|p| pkg.starts_with(p))
        || MANDIRI_PACKAGES.iter().any(|p| pkg.starts_with(p))
        || BRI_PACKAGES.iter().any(|p| pkg.starts_with(p))
        || BANK_JATIM_PACKAGES.iter().any(|p| pkg.starts_with(p))
        || GOPAY_PACKAGES.iter().any(|p| pkg.starts_with(p))
        || SHOPEE_PACKAGES.iter().any(|p| pkg.starts_with(p))
        || DANA_PACKAGES.iter().any(|p| pkg.starts_with(p))
        || OVO_PACKAGES.iter().any(|p| pkg.starts_with(p))
        || BNI_PACKAGES.iter().any(|p| pkg.starts_with(p))
        || BSI_PACKAGES.iter().any(|p| pkg.starts_with(p))
}

fn resolve_provider(pkg: &str, content: &str) -> String {
    if BCA_PACKAGES.iter().any(|p| pkg.starts_with(p)) || content.contains("bca") {
        "BCA".to_string()
    } else if MANDIRI_PACKAGES.iter().any(|p| pkg.starts_with(p))
        || content.contains("mandiri")
        || content.contains("livin")
    {
        "Mandiri".to_string()
    } else if BRI_PACKAGES.iter().any(|p| pkg.starts_with(p))
        || content.contains("bri")
        || content.contains("brimo")
    {
        "BRI".to_string()
    } else if BANK_JATIM_PACKAGES.iter().any(|p| pkg.starts_with(p))
        || content.contains("bank jatim")
    {
        "Bank Jatim".to_string()
    } else if GOPAY_PACKAGES.iter().any(|p| pkg.starts_with(p))
        || content.contains("gopay")
        || content.contains("gobiz")
    {
        "GoPay".to_string()
    } else if SHOPEE_PACKAGES.iter().any(|p| pkg.starts_with(p))
        || content.contains("shopeepay")
        || content.contains("shopee")
    {
        "ShopeePay".to_string()
    } else if BNI_PACKAGES.iter().any(|p| pkg.starts_with(p)) || content.contains("bni") {
        "BNI".to_string()
    } else if BSI_PACKAGES.iter().any(|p| pkg.starts_with(p))
        || content.contains("bsi")
        || content.contains("bank syariah indonesia")
    {
        "BSI".to_string()
    } else if OVO_PACKAGES.iter().any(|p| pkg.starts_with(p)) || content.contains("ovo") {
        "OVO".to_string()
    } else if DANA_PACKAGES.iter().any(|p| pkg.starts_with(p))
        || content.contains("dana bisnis")
        || content.contains("akun dana")
    {
        "DANA".to_string()
    } else {
        "QRIS".to_string()
    }
}

/// Extract Rupiah amount as integer minor units (`i64`).
pub fn extract_amount(text: &str) -> Option<i64> {
    // Regex for: Rp 50.000, Rp. 50.000,00, Rp50000, IDR 1,500,000.00
    let prefix_re = Regex::new(r"(?i)(?:rp\.?|idr)\s*([0-9]{1,3}(?:[.,][0-9]{3})+(?:[.,][0-9]{2})?|[0-9]+(?:[.,][0-9]{2})?)").ok()?;
    if let Some(caps) = prefix_re.captures(text) {
        if let Some(m) = caps.get(1) {
            if let Some(num) = parse_idr_amount_str(m.as_str()) {
                return Some(num);
            }
        }
    }

    // Suffix regex for: 50.000 Rp, 50000 IDR
    let suffix_re = Regex::new(
        r"(?i)([0-9]{1,3}(?:[.,][0-9]{3})+(?:[.,][0-9]{2})?|[0-9]+(?:[.,][0-9]{2})?)\s*(?:rp|idr)",
    )
    .ok()?;
    if let Some(caps) = suffix_re.captures(text) {
        if let Some(m) = caps.get(1) {
            if let Some(num) = parse_idr_amount_str(m.as_str()) {
                return Some(num);
            }
        }
    }

    None
}

/// Parse raw numeric IDR string into whole Rupiah minor units (`i64`).
fn parse_idr_amount_str(raw: &str) -> Option<i64> {
    let mut clean = raw.trim();
    if clean.is_empty() {
        return None;
    }

    // Strip trailing ,00 or .00 (cents)
    if clean.ends_with(",00") || clean.ends_with(".00") {
        clean = &clean[..clean.len() - 3];
    } else if let Some(last_delim) = clean.rfind(|c| c == '.' || c == ',') {
        // If there's a 2-digit decimal suffix like .50 or ,50 following a 3-digit thousand
        let suffix = &clean[last_delim + 1..];
        let prefix = &clean[..last_delim];
        if suffix.len() == 2 && (prefix.contains('.') || prefix.contains(',')) {
            clean = prefix;
        }
    }

    let digits: String = clean.chars().filter(|c| c.is_ascii_digit()).collect();
    digits.parse::<i64>().ok()
}

/// Extract sender / payer name from notification body if present.
pub fn extract_sender_name(text: &str) -> Option<String> {
    let re = Regex::new(r"(?i)\bdari\s+([A-Za-z0-9\s\.\-_]+?)(?:\s+(?:telah|berhasil|pada|sebesar|\d{2}/\d{2})|[\.,;\|]|\s*$)").ok()?;
    if let Some(caps) = re.captures(text) {
        if let Some(m) = caps.get(1) {
            let candidate = m.as_str().trim();
            if !candidate.is_empty()
                && candidate.len() <= 60
                && !candidate.eq_ignore_ascii_case("pelanggan")
            {
                return Some(candidate.to_string());
            }
        }
    }
    None
}

/// Format `i64` minor units into human-readable Indonesian Rupiah string.
pub fn format_idr(amount: i64) -> String {
    let s = amount.to_string();
    let is_neg = s.starts_with('-');
    let digits = if is_neg { &s[1..] } else { &s[..] };

    let mut formatted = String::with_capacity(digits.len() + digits.len() / 3 + 4);
    let len = digits.len();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (len - i) % 3 == 0 {
            formatted.push('.');
        }
        formatted.push(c);
    }

    if is_neg {
        format!("-Rp {formatted}")
    } else {
        format!("Rp {formatted}")
    }
}

/// Result of evaluating an incoming bank notification against an open checkout.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MatchResult {
    /// Exact match with the requested checkout amount.
    Exact,
    /// Match with a unique code (*kode unik*) offset (e.g. Total 50.000 + 12 = 50.012).
    UniqueCode {
        /// Offset amount in rupiah added to the base sale.
        offset: i64,
    },
    /// Notification amount did not match the checkout total.
    Mismatch,
    /// Notification was already processed (duplicate push from OS or unlock).
    Duplicate,
    /// Notification timestamp is older than the permissible checkout TTL.
    Expired,
}

/// In-memory LRU deduplication cache and payment matcher.
#[derive(Debug, Clone)]
pub struct QrisMatchEngine {
    recent_hashes: VecDeque<u64>,
    max_history: usize,
    unique_code_max: Option<i64>,
}

impl Default for QrisMatchEngine {
    fn default() -> Self {
        Self::new(100, Some(99))
    }
}

impl QrisMatchEngine {
    /// Create a new match engine with specified history size and maximum unique code offset.
    pub fn new(max_history: usize, unique_code_max: Option<i64>) -> Self {
        Self {
            recent_hashes: VecDeque::with_capacity(max_history),
            max_history,
            unique_code_max,
        }
    }

    /// Compute cryptographic fingerprint for a notification.
    pub fn compute_hash(notif: &BankNotification) -> u64 {
        let mut hasher = DefaultHasher::new();
        notif.package_name.hash(&mut hasher);
        notif.amount_minor.hash(&mut hasher);
        notif.timestamp_ms.hash(&mut hasher);
        hasher.finish()
    }

    /// Check if a notification hash has already been recorded.
    pub fn is_duplicate(&self, notif: &BankNotification) -> bool {
        let h = Self::compute_hash(notif);
        self.recent_hashes.contains(&h)
    }

    /// Record a processed notification in the deduplication cache.
    pub fn record(&mut self, notif: &BankNotification) {
        let h = Self::compute_hash(notif);
        if self.recent_hashes.contains(&h) {
            return;
        }
        if self.recent_hashes.len() >= self.max_history {
            self.recent_hashes.pop_back();
        }
        self.recent_hashes.push_front(h);
    }

    /// Evaluate an incoming notification against an open checkout.
    ///
    /// Parameters:
    /// - `target_amount_minor`: The open sale invoice amount (minor units, whole rupiah).
    /// - `notif`: The parsed notification.
    /// - `max_age_ms`: Maximum permissible age in milliseconds (e.g. 600,000 for 10 minutes).
    /// - `current_time_ms`: Current wall-clock time in milliseconds.
    pub fn matches(
        &mut self,
        target_amount_minor: i64,
        notif: &BankNotification,
        max_age_ms: u64,
        current_time_ms: u64,
    ) -> MatchResult {
        // 1. Deduplication check
        if self.is_duplicate(notif) {
            return MatchResult::Duplicate;
        }

        // 2. TTL expiration check
        if current_time_ms > notif.timestamp_ms && current_time_ms - notif.timestamp_ms > max_age_ms
        {
            return MatchResult::Expired;
        }

        // 3. Exact match
        if notif.amount_minor == target_amount_minor {
            self.record(notif);
            return MatchResult::Exact;
        }

        // 4. Unique code (*kode unik*) match
        if let Some(max_offset) = self.unique_code_max {
            if notif.amount_minor > target_amount_minor {
                let offset = notif.amount_minor - target_amount_minor;
                if offset > 0 && offset <= max_offset {
                    self.record(notif);
                    return MatchResult::UniqueCode { offset };
                }
            }
        }

        MatchResult::Mismatch
    }
}

#[cfg(test)]
#[path = "notification_tests.rs"]
mod tests;
