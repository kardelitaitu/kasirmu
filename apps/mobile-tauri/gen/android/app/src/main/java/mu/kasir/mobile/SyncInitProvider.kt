package mu.kasir.mobile

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri

import android.util.Log
import androidx.startup.AppInitializer
import androidx.work.WorkManagerInitializer

/**
 * Headless ContentProvider that schedules background sync on process boot.
 *
 * Runs during application startup before any Activity attaches, registering
 * the WorkManager periodic sync job without modifying UI Activity lifecycles.
 */
class SyncInitProvider : ContentProvider() {

    override fun onCreate(): Boolean {
        context?.let { ctx ->
            val appCtx = ctx.applicationContext
            try {
                AppInitializer.getInstance(appCtx)
                    .initializeComponent(WorkManagerInitializer::class.java)
            } catch (e: Exception) {
                Log.w("SyncInitProvider", "AppInitializer WorkManager init: ${e.message}")
            }
            try {
                SyncWorker.schedule(appCtx)
            } catch (e: Exception) {
                Log.e("SyncInitProvider", "Could not schedule SyncWorker on startup", e)
            }
        }
        return true
    }

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?
    ): Cursor? = null

    override fun getType(uri: Uri): String? = null

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

    override fun update(
        uri: Uri,
        values: ContentValues?,
        selection: String?,
        selectionArgs: Array<out String>?
    ): Int = 0
}
