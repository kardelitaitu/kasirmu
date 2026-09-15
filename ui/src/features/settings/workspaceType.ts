// ── Workspace type_key → settings-modal card type ───────────────────
//
// `activeWorkspace` (WorkspaceContext) is a workspace **type_key**, not an
// instance id: WorkspaceContext.tsx matches it against `instance.type_key`.
// The settings modal owns a card for only four of the verticals, so the two
// sets are not the same and the mapping has to live somewhere.
//
// It lives here rather than inside WorkspaceSettingsModal.tsx because the
// shells need it as a VALUE. AppShell and TabletAppShell both lazy-load the
// modal to keep it out of the main chunk; importing the map from the modal
// would drag the whole component back into that chunk.
//
// Keep this the only copy — it previously existed inline in AppShell and,
// before 3af8e2989, effectively again as a hardcoded literal in PosScreen.

export type WorkspaceType = 'store-pos' | 'restaurant-pos' | 'kds' | 'warehouse';

const WORKSPACE_TO_TYPE: Record<string, WorkspaceType> = {
  'restaurant-pos': 'restaurant-pos',
  'store-pos': 'store-pos',
  kds: 'kds',
  warehouse: 'warehouse',
};

/**
 * Map a workspace type_key onto the settings-modal card type.
 *
 * Returns null for keys with no card — `admin`, `inventory`, anything
 * unknown, and null/undefined. Callers must render nothing in that case
 * rather than falling back to a default card: a wrong card is worse than no
 * card, and `admin` is a reachable value (PosScreen's settings button sets
 * it when there is no onNavigate).
 */
export function toWorkspaceType(typeKey: string | null | undefined): WorkspaceType | null {
  if (!typeKey) return null;
  return WORKSPACE_TO_TYPE[typeKey] ?? null;
}
