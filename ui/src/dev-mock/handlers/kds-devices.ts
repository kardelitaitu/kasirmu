/**
 * Dev-mock handlers — KDS **device management**.
 *
 * Extracted verbatim out of `tauri-api.ts`'s `entryHandlers` literal by
 * todo-refactor-devmock-router-consolidation.md **Phase 5.4**.
 *
 * Why a NEW module instead of `handlers/kds.ts` as the plan named: `kds.ts` owns
 * the KDS *order* workflow (tickets, line-item status, the display counter) and is
 * another domain's actively-edited file; these five keys are KDS *terminal
 * registration / presence*, a different concern. Putting them in their own module
 * keeps the extraction surgical (no concurrent-edit surface) and the file honest
 * about what it holds. Bodies are self-contained (only `Date.now()` / `new Date()`),
 * so — like Phases 5.2/5.3 — no shared-state seam is needed; each is a pure copy.
 * All five are `_scoped`-only names (no unscoped base), so `applyScopedAliases()`
 * has nothing to mirror here; the registry set is unchanged by the move.
 */
import type { MockHandler } from '../core/mockDispatcher';

export const kdsDeviceHandlers: Record<string, MockHandler> = {
  'list_kds_devices_scoped': () => [] as unknown[],
  'register_kds_device_scoped': (args: unknown) => {
    const input = (args as { input?: Record<string, unknown> })?.input ?? {};
    return {
      id: `kds-device-mock-${Date.now()}`,
      name: input['name'] ?? 'Mock KDS Device',
      restaurant_pos_id: input['restaurant_pos_id'] ?? 'resto-1',
      station_ids: input['station_ids'] ?? [],
      is_active: true,
      last_seen_at: new Date().toISOString(),
      connection_status: 'connected',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  },
  'get_kds_device_scoped': () => null,
  'update_kds_device_status_scoped': () => {},
  'deactivate_kds_device_scoped': () => {},
};
