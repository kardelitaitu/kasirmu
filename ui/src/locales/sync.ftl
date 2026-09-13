# Sync conflict review
#
# Keys for SyncConflictReviewScreen and ConflictDiffViewer. Every key here is
# referenced from `ui/src/features/sync/**`; the FTL orphan gate (pre-commit
# step 10) fails the commit if a key is added that nothing reads.

sync-conflicts-title = Sync Conflicts
sync-conflicts-show-resolved = Show resolved history
sync-conflicts-loading = Loading…
sync-conflicts-empty = No conflicts to review.

# Operational copy for failure paths. These keys reach the bundle via
# `l10nErrorMessage(…, 'sync-conflicts-error-*')` and `getString`, never as a
# <Localized id>, so the orphan gate matches them on their string literal.
sync-conflicts-error-load = Failed to load conflicts.
sync-conflicts-error-resolve = Failed to record the resolution.
sync-conflicts-resolved-elsewhere = This conflict was already resolved elsewhere. Refreshing.

# Severity filter tabs. The vocabulary mirrors the `severity` CHECK constraint
# on `sync_conflicts`; renaming one here without renaming the column value
# would leave a tab that filters to nothing.
sync-conflicts-severity-high = High
sync-conflicts-severity-medium = Medium
sync-conflicts-severity-low = Low
sync-conflicts-severity-all = All

# Diff viewer. The two panes are labelled by origin, not by "left/right", so a
# translated layout that reverses reading order still names the right side.
sync-conflicts-pane-local = Terminal { $terminal }
sync-conflicts-pane-remote = Cloud / Terminal B
sync-conflicts-accept-local = Accept Store A
sync-conflicts-accept-remote = Accept Cloud
sync-conflicts-custom-merge = Custom Merge
