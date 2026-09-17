# shared-ui/locales/offline.ftl — Offline queue

offline-queue-title = Offline Queue
offline-queue-loading = Loading queue…
offline-queue-empty = All transactions synced. No pending items.
offline-queue-error = Failed to load queue. Please try again.
offline-queue-retry = Retry
offline-queue-sync-all = Sync All
offline-queue-syncing = Syncing…
offline-queue-sync-success = Synced { $synced } items, { $failed } failed.
offline-queue-pending-count = { $count } pending
offline-queue-summary-pending = pending
offline-queue-summary-synced = synced
offline-queue-summary-failed = failed
offline-queue-summary-conflicts = conflicts
offline-queue-plan-label = Plan
offline-queue-plan-free = Free
offline-queue-plan-pro = Pro
offline-queue-plan-upgrade-hint = Upgrade to sync to the cloud
offline-queue-plan-required = Cloud sync requires a paid plan
offline-queue-plan-required-hint = Your local sales keep working — upgrade to sync them to the cloud.
offline-queue-last-synced = Last synced { $time }
offline-queue-last-synced-never = Never synced
offline-queue-oldest-pending = Oldest pending { $time }
offline-queue-oldest-pending-none = Queue empty
offline-queue-time-just-now = just now
offline-queue-time-minutes-ago = { $count }m ago
offline-queue-time-hours-ago = { $count }h ago
offline-queue-time-days-ago = { $count }d ago
offline-queue-action = Action
offline-queue-status = Status
offline-queue-retries = Retries
offline-queue-last-error = Last Error
offline-queue-created = Created
offline-queue-synced-at = Synced At
offline-queue-delete = Delete
offline-queue-none = —
offline-queue-table-aria = Offline queue items
offline-queue-pull-to-refresh = Pull to refresh
offline-queue-release-to-refresh = Release to refresh
offline-queue-status-pending = Pending
offline-queue-status-synced = Synced
offline-queue-status-failed = Failed
offline-queue-table-actions = Actions
offline-queue-sync-all-label = Sync all pending offline items
offline-queue-delete-error = Failed to delete item
offline-queue-sync-error = Sync failed
# P1-3: Shown when sync conflicts were resolved during the last sync cycle
offline-queue-conflict-count = { $count } item(s) resolved via sync conflict.
# ERR-07: Non-blocking notice after repeated poll failures
offline-queue-status-stale = Queue status may be out of date.
offline-queue-last-refreshed = Last refreshed { $time }
# ERR-09: Accessible status while a reload is in flight with rows visible
offline-queue-refreshing = Refreshing…
# SYNC-11: Quarantined remote items (dead-lettered sync pulls)
offline-queue-quarantine-title = Quarantined Remote Items
offline-queue-quarantine-description = Items from the sync server that repeatedly failed to apply. Requeue after fixing the underlying issue.
offline-queue-quarantine-empty = No quarantined items.
offline-queue-quarantine-item-id = Item ID
offline-queue-quarantine-attempts = Attempts
offline-queue-quarantine-requeue = Requeue
offline-queue-quarantine-requeue-aria = Requeue { $itemId }
offline-queue-quarantine-requeue-error = Failed to requeue item
offline-queue-quarantine-table-aria = Quarantined remote sync items
