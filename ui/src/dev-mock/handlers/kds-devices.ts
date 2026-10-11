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
 * about what it holds. All five are `_scoped`-only names (no unscoped base), so
 * `applyScopedAliases()` has nothing to mirror here; the registry set is
 * unchanged by the move.
 *
 * ⚠️ CORRECTION (2026-10-12): this header used to say the bodies "need no
 * shared-state seam" because each is a pure copy. As DRAFTS that was true, and it
 * is exactly what made them wrong — register returned a device and persisted
 * nothing, so list/get could never see it and the enrollment modal lied about
 * succeeding (the status indicator kept rendering 0/0). They now share
 * `mockKdsDevices` below, and the pairing is pinned by
 * __tests__/dev-mock-kds-device-persistence.test.ts. A pure-copy handler is only
 * correct when it also owns no state a sibling has to read.
 */
import type { MockHandler } from '../core/mockDispatcher';

/**
 * Registered devices, keyed by id.
 *
 * ⚠️ This map is the shared-state seam the file header used to say was
 * unnecessary. Each handler WAS a pure copy, and that is precisely why they
 * disagreed: register minted an id and threw the device away, while list
 * answered [] — so the enrollment modal reported success and the status
 * indicator kept rendering 0/0. Pinned by
 * __tests__/dev-mock-kds-device-persistence.test.ts.
 *
 * In-memory on purpose: this module has no `writeSlice`/
 * `readSlice` seam of its own, and device registration is a page-lifetime
 * concern in the preview. A reload clears it, which is what a fresh mock
 * session should look like.
 */
const mockKdsDevices = new Map<string, Record<string, unknown>>();

export const kdsDeviceHandlers: Record<string, MockHandler> = {
  // Active devices only: the status indicator counts a kitchen's live displays,
  // and a deactivated one must stop counting.
  'list_kds_devices_scoped': () =>
    Array.from(mockKdsDevices.values()).filter((d) => d['is_active'] !== false),
  'register_kds_device_scoped': (args: unknown) => {
    const input = (args as { input?: Record<string, unknown> })?.input ?? {};
    const now = new Date().toISOString();
    const device: Record<string, unknown> = {
      id: `kds-device-mock-${Date.now()}`,
      name: input['name'] ?? 'Mock KDS Device',
      restaurant_pos_id: input['restaurant_pos_id'] ?? 'resto-1',
      station_ids: input['station_ids'] ?? [],
      is_active: true,
      last_seen_at: now,
      connection_status: 'connected',
      created_at: now,
      updated_at: now,
    };
    mockKdsDevices.set(device['id'] as string, device);
    return device;
  },
  'get_kds_device_scoped': (args: unknown) => {
    const raw = (args as { args?: { id?: string }; id?: string })?.args ?? (args as { id?: string });
    const id = raw?.id;
    return (id ? mockKdsDevices.get(id) : undefined) ?? null;
  },
  'update_kds_device_status_scoped': (args: unknown) => {
    const raw = (args as { args?: { id?: string; connection_status?: string }; id?: string })?.args ?? (args as { id?: string });
    const device = raw?.id ? mockKdsDevices.get(raw.id) : undefined;
    if (device) {
      device['updated_at'] = new Date().toISOString();
      device['last_seen_at'] = device['updated_at'];
    }
    return device ?? null;
  },
  'deactivate_kds_device_scoped': (args: unknown) => {
    const raw = (args as { args?: { id?: string }; id?: string })?.args ?? (args as { id?: string });
    const device = raw?.id ? mockKdsDevices.get(raw.id) : undefined;
    if (device) {
      device['is_active'] = false;
      device['connection_status'] = 'disconnected';
      device['updated_at'] = new Date().toISOString();
    }
    return device ?? null;
  },
};
