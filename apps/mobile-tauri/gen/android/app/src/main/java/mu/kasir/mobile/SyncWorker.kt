package mu.kasir.mobile

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Android Jetpack WorkManager worker for periodic background offline sync.
 *
 * Runs on a periodic schedule (15 minutes interval with 5 minutes flex) when
 * the device has an active network connection, nudging the Rust sync daemon
 * to drain pending offline sales even when the screen is locked or idle.
 */
class SyncWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    companion object {
        private const val WORK_NAME = "kasirmu_periodic_sync"

        /** JNI bridge to trigger the Rust sync daemon wakeup */
        @JvmStatic
        external fun nativeNudgeSync()

        /**
         * Enqueue periodic background sync with WorkManager.
         * Safe to call multiple times (uses KEEP policy).
         */
        @JvmStatic
        fun schedule(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val workRequest = PeriodicWorkRequestBuilder<SyncWorker>(
                15, TimeUnit.MINUTES,
                5, TimeUnit.MINUTES
            )
                .setConstraints(constraints)
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                workRequest
            )
        }
    }

    override suspend fun doWork(): Result {
        return try {
            nativeNudgeSync()
            Result.success()
        } catch (e: UnsatisfiedLinkError) {
            // Native library not loaded in this process
            Result.retry()
        } catch (e: Exception) {
            Result.failure()
        }
    }
}
