package mu.kasir.mobile

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri

/**
 * Headless ContentProvider that schedules background sync on process boot.
 *
 * Runs during application startup before any Activity attaches, registering
 * the WorkManager periodic sync job without modifying UI Activity lifecycles.
 */
class SyncInitProvider : ContentProvider() {

    override fun onCreate(): Boolean {
        context?.let { ctx ->
            SyncWorker.schedule(ctx.applicationContext)
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
