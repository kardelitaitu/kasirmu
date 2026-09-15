/**
 * Dev-mock handlers — Terminals / device binding family.
 *
 * Created by todo-refactor-devmock-router-consolidation.md Phase 5.1: the
 * six `get/set/clear_device_binding` (± `_scoped`) entries that sat in the
 * router's `entryHandlers` under the WORKSPACES banner, moved verbatim.
 * `handlers/workspaces.ts:17-19` declined them on the extraction pass —
 * correctly, as it turned out: `get/set/clear_device_binding` is the
 * terminals command family (`ui/src/api/terminals.ts`), not a workspace
 * one. This is the properly-named home its refusal asked for, the same
 * shape the Phase 5.4 `kds-devices.ts` took: a static map, no state, and
 * the router registers it as-is.
 */
import type { MockHandler } from '../core/mockDispatcher';

export const deviceBindingHandlers: Record<string, MockHandler> = {
  'get_device_binding': () => ({ bounded: true, boundStoreId: 'store-1', boundInstanceId: 'ws-1', signatureValid: true }),
  'get_device_binding_scoped': () => ({ bounded: true, boundStoreId: 'store-1', boundInstanceId: 'ws-1', signatureValid: true }),
  'set_device_binding': () => null,
  'set_device_binding_scoped': () => null,
  'clear_device_binding': () => null,
  'clear_device_binding_scoped': () => null,
};
