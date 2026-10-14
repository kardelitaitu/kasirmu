package mu.kasir.mobile

data class ParsedQrisPayment(
    val provider: String,
    val amountMinor: Long,
    val amountFormatted: String,
    val rawText: String,
    val packageName: String,
    val timestamp: Long
)

/**
 * Parses push notification content from Indonesian banking and e-wallet apps
 * to extract settled QRIS payments with zero payment gateway MDR fees.
 */
object QrisNotificationParser {
    // Regex matching IDR amounts:
    // Rp 50.000, Rp. 50.000,00, Rp50000, IDR 1,500,000.00, Rp 1.500.000
    private val IDR_AMOUNT_REGEX = Regex(
        """(?:Rp\.?|IDR)\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})?|[0-9]+(?:[.,][0-9]{2})?)""",
        RegexOption.IGNORE_CASE
    )

    private val IDR_SUFFIX_REGEX = Regex(
        """([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})?|[0-9]+(?:[.,][0-9]{2})?)\s*(?:Rp|IDR)""",
        RegexOption.IGNORE_CASE
    )

    // Known package prefixes
    private val BCA_PACKAGES = listOf("com.bca", "id.co.bca")
    private val MANDIRI_PACKAGES = listOf("id.bmri.livin")
    private val BRI_PACKAGES = listOf("id.co.bri")
    private val BANK_JATIM_PACKAGES = listOf("id.co.bankjatim")
    private val GOPAY_PACKAGES = listOf("com.gojek.merchant", "com.gojek.gobiz", "com.gojek.app")
    private val SHOPEE_PACKAGES = listOf("com.shopee.id", "com.shopeepay.id")
    private val DANA_PACKAGES = listOf("id.dana")
    private val OVO_PACKAGES = listOf("ovo.id")

    // Keywords that indicate incoming credit / payment success
    private val PAYMENT_KEYWORDS = listOf(
        "qris", "transfer masuk", "dana masuk", "saldo masuk",
        "pembayaran", "diterima", "berhasil", "payment received",
        "incoming transfer", "transaksi berhasil", "terima uang"
    )

    fun parse(
        packageName: String,
        title: String?,
        content: String,
        postTime: Long = System.currentTimeMillis()
    ): ParsedQrisPayment? {
        val lowerContent = content.lowercase()
        val lowerPkg = packageName.lowercase()

        // 1. Check if package is a known payment app OR content has payment keywords
        val isKnownApp = isKnownPaymentApp(lowerPkg)
        val hasKeyword = PAYMENT_KEYWORDS.any { lowerContent.contains(it) }

        if (!isKnownApp && !hasKeyword) {
            return null
        }

        // Filter out debits / outward transfers / OTPs
        if (isDebitOrOutward(lowerContent)) {
            return null
        }

        // 2. Extract IDR amount
        val amountMinor = extractAmount(content) ?: return null

        // 3. Determine provider name
        val provider = resolveProvider(lowerPkg, lowerContent)
        val formatted = formatIdr(amountMinor)

        return ParsedQrisPayment(
            provider = provider,
            amountMinor = amountMinor,
            amountFormatted = formatted,
            rawText = content,
            packageName = packageName,
            timestamp = postTime
        )
    }

    private fun isKnownPaymentApp(pkg: String): Boolean {
        return BCA_PACKAGES.any { pkg.startsWith(it) } ||
               MANDIRI_PACKAGES.any { pkg.startsWith(it) } ||
               BRI_PACKAGES.any { pkg.startsWith(it) } ||
               BANK_JATIM_PACKAGES.any { pkg.startsWith(it) } ||
               GOPAY_PACKAGES.any { pkg.startsWith(it) } ||
               SHOPEE_PACKAGES.any { pkg.startsWith(it) } ||
               DANA_PACKAGES.any { pkg.startsWith(it) } ||
               OVO_PACKAGES.any { pkg.startsWith(it) }
    }

    private fun isDebitOrOutward(content: String): Boolean {
        val debitKeywords = listOf(
            "transfer keluar", "pembelian berhasil", "pulsa berhasil",
            "tagihan berhasil dibayar", "anda telah membayar", "debet", "debit",
            "saldo terpotong", "kamu telah kirim", "otp", "kode rahasia"
        )
        return debitKeywords.any { content.contains(it) }
    }

    fun extractAmount(text: String): Long? {
        val match = IDR_AMOUNT_REGEX.find(text) ?: IDR_SUFFIX_REGEX.find(text)
        if (match != null) {
            val rawNum = match.groupValues[1]
            return parseIdrAmountString(rawNum)
        }
        return null
    }

    fun parseIdrAmountString(raw: String): Long? {
        var clean = raw.trim()
        if (clean.isEmpty()) return null

        // If it ends with ,00 or .00 (cents that don't exist in circulating rupiah):
        if (clean.endsWith(",00") || clean.endsWith(".00")) {
            clean = clean.substring(0, clean.length - 3)
        }

        // Check if there is a decimal separator with 2 digits at the end like ,50 or .50
        val decimalMatch = Regex("""[.,](\d{2})$""").find(clean)
        if (decimalMatch != null && clean.contains(Regex("""\d{1,3}[.,]\d{3}"""))) {
            clean = clean.substring(0, decimalMatch.range.first)
        }

        // Strip all periods and commas (thousands separators)
        val digitsOnly = clean.replace(".", "").replace(",", "")
        return digitsOnly.toLongOrNull()
    }

    private fun resolveProvider(pkg: String, content: String): String {
        return when {
            BCA_PACKAGES.any { pkg.startsWith(it) } || content.contains("bca") -> "BCA"
            MANDIRI_PACKAGES.any { pkg.startsWith(it) } || content.contains("mandiri") || content.contains("livin") -> "Mandiri"
            BRI_PACKAGES.any { pkg.startsWith(it) } || content.contains("bri") || content.contains("brimo") -> "BRI"
            BANK_JATIM_PACKAGES.any { pkg.startsWith(it) } || content.contains("bank jatim") -> "Bank Jatim"
            GOPAY_PACKAGES.any { pkg.startsWith(it) } || content.contains("gopay") || content.contains("gobiz") -> "GoPay"
            SHOPEE_PACKAGES.any { pkg.startsWith(it) } || content.contains("shopeepay") || content.contains("shopee") -> "ShopeePay"
            DANA_PACKAGES.any { pkg.startsWith(it) } || content.contains("dana") -> "DANA"
            OVO_PACKAGES.any { pkg.startsWith(it) } || content.contains("ovo") -> "OVO"
            content.contains("bni") -> "BNI"
            content.contains("bsi") -> "BSI"
            else -> "QRIS"
        }
    }

    private fun formatIdr(amount: Long): String {
        return "Rp %,d".format(java.util.Locale.GERMAN, amount).replace(".", ".")
    }
}
