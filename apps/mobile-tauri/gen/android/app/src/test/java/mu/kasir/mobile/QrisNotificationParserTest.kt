package mu.kasir.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class QrisNotificationParserTest {

    @Test
    fun parseBcaTransferMasuk() {
        val result = QrisNotificationParser.parse(
            packageName = "com.bca",
            title = "BCA mobile",
            content = "Transfer Masuk Rp 50.000 dari BUDI SANTOSO"
        )
        assertNotNull(result)
        assertEquals("BCA", result!!.provider)
        assertEquals(50000L, result.amountMinor)
    }

    @Test
    fun parseBcaQrisSuccess() {
        val result = QrisNotificationParser.parse(
            packageName = "id.co.bca.mybca",
            title = "myBCA",
            content = "Transaksi QRIS sebesar Rp 75.000 berhasil"
        )
        assertNotNull(result)
        assertEquals("BCA", result!!.provider)
        assertEquals(75000L, result.amountMinor)
    }

    @Test
    fun parseBcaWithCents() {
        val result = QrisNotificationParser.parse(
            packageName = "com.bca",
            title = "BCA",
            content = "Dana masuk Rp. 150.000,00 dari AHMAD"
        )
        assertNotNull(result)
        assertEquals("BCA", result!!.provider)
        assertEquals(150000L, result.amountMinor)
    }

    @Test
    fun parseMandiriLivinQris() {
        val result = QrisNotificationParser.parse(
            packageName = "id.bmri.livin",
            title = "Livin' by Mandiri",
            content = "Dana masuk Rp 85.000 via QRIS"
        )
        assertNotNull(result)
        assertEquals("Mandiri", result!!.provider)
        assertEquals(85000L, result.amountMinor)
    }

    @Test
    fun parseBriBrimoQris() {
        val result = QrisNotificationParser.parse(
            packageName = "id.co.bri.brimo",
            title = "BRImo",
            content = "Notifikasi Transaksi: Dana masuk Rp 120.000 berhasil"
        )
        assertNotNull(result)
        assertEquals("BRI", result!!.provider)
        assertEquals(120000L, result.amountMinor)
    }

    @Test
    fun parseBankJatimQris() {
        val result = QrisNotificationParser.parse(
            packageName = "id.co.bankjatim.mobile",
            title = "Bank Jatim",
            content = "QRIS Merchant: Transaksi Rp 45.000 berhasil"
        )
        assertNotNull(result)
        assertEquals("Bank Jatim", result!!.provider)
        assertEquals(45000L, result.amountMinor)
    }

    @Test
    fun parseGoPayGoBiz() {
        val result = QrisNotificationParser.parse(
            packageName = "com.gojek.merchant",
            title = "GoBiz",
            content = "Pembayaran QRIS Rp 35.000 berhasil diterima"
        )
        assertNotNull(result)
        assertEquals("GoPay", result!!.provider)
        assertEquals(35000L, result.amountMinor)
    }

    @Test
    fun parseShopeePay() {
        val result = QrisNotificationParser.parse(
            packageName = "com.shopeepay.id",
            title = "ShopeePay",
            content = "Pembayaran QRIS sebesar Rp 25.000 berhasil diterima"
        )
        assertNotNull(result)
        assertEquals("ShopeePay", result!!.provider)
        assertEquals(25000L, result.amountMinor)
    }

    @Test
    fun parseDana() {
        val result = QrisNotificationParser.parse(
            packageName = "id.dana",
            title = "DANA",
            content = "Kamu menerima saldo Rp 60.000 via QRIS"
        )
        assertNotNull(result)
        assertEquals("DANA", result!!.provider)
        assertEquals(60000L, result.amountMinor)
    }

    @Test
    fun parseGenericBankFallback() {
        val result = QrisNotificationParser.parse(
            packageName = "com.otherbank.mobile",
            title = "Bank Lain",
            content = "Transfer Masuk Rp 100.000 berhasil"
        )
        assertNotNull(result)
        assertEquals("QRIS", result!!.provider)
        assertEquals(100000L, result.amountMinor)
    }

    @Test
    fun ignoresOutwardTransfersAndDebits() {
        val debitResult = QrisNotificationParser.parse(
            packageName = "com.bca",
            title = "BCA mobile",
            content = "Anda telah membayar Rp 50.000 ke RESTORAN MAJU"
        )
        assertNull(debitResult)

        val transferOutResult = QrisNotificationParser.parse(
            packageName = "id.bmri.livin",
            title = "Livin'",
            content = "Transfer keluar Rp 75.000 ke rekening 123456"
        )
        assertNull(transferOutResult)

        val otpResult = QrisNotificationParser.parse(
            packageName = "id.co.bri.brimo",
            title = "BRImo",
            content = "Kode OTP transaksi Anda adalah 987654"
        )
        assertNull(otpResult)
    }

    @Test
    fun ignoresUnrelatedNotifications() {
        val chatResult = QrisNotificationParser.parse(
            packageName = "com.whatsapp",
            title = "WhatsApp",
            content = "Halo apa kabar? Apakah ada diskon hari ini?"
        )
        assertNull(chatResult)
    }
}
