package mu.kasir.mobile

import java.util.concurrent.ConcurrentLinkedDeque
import java.util.concurrent.CopyOnWriteArrayList

/**
 * In-memory thread-safe event bus and circular cache for detected QRIS payments.
 */
object QrisNotificationBus {
    private val listeners = CopyOnWriteArrayList<(ParsedQrisPayment) -> Unit>()
    private val recentPayments = ConcurrentLinkedDeque<ParsedQrisPayment>()
    private const val MAX_RECENT = 20

    fun subscribe(listener: (ParsedQrisPayment) -> Unit): () -> Unit {
        listeners.add(listener)
        return { listeners.remove(listener) }
    }

    fun post(event: ParsedQrisPayment) {
        recentPayments.addFirst(event)
        while (recentPayments.size > MAX_RECENT) {
            recentPayments.pollLast()
        }
        for (listener in listeners) {
            try {
                listener(event)
            } catch (_: Exception) {}
        }
    }

    fun getRecent(): List<ParsedQrisPayment> = recentPayments.toList()
}
