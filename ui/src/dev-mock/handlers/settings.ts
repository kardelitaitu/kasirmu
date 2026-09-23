/**
 * Dev-mock handlers — Settings domain.
 *
 * The three settings-family groups that were still literal in `tauri-api.ts`:
 * the store/receipt/hardware/credit settings reads and writes (the SETTINGS
 * banner block), the license/device-id group (the BOOT/SETUP banner), and the
 * trailing settings-WRITE + PG-sync patches. Extracted from `tauri-api.ts` by
 * the agent-3 work order (`todo-refactor-devmock-agents-3.md`, phase 3.2, box
 * :93); the bodies are moved verbatim, comments included — only their location
 * changes. The three exported maps are spread/registered at the EXACT positions
 * the keys occupied before, so neither the registry insertion order nor
 * dispatch precedence moves: `licenseHandlers` and `settingsHandlers` spread
 * back into the entry literal (object spread preserves position), and
 * `settingsWriteHandlers` is registered where the `handlers[...]=` statements
 * ran — registerHandlers is an Object.assign, so the call sits on the same line
 * of the same sequence. That matters because applyScopedAliases() only fills a
 * `_scoped` twin when it is still ABSENT: a moved key that arrived later than
 * the alias pass would answer with another command handler.
 *
 * What is deliberately NOT here: the receipt-FORMAT trio
 * (get_receipt_format_scoped / set_receipt_layout_scoped /
 * set_receipt_content_scoped) — that is the regional receipt axis, registered
 * under its own parity comment; `get/set/clear_device_binding`, a separate
 * command family per handlers/workspaces.ts; `get_sync_settings` /
 * get_sync_settings_scoped / update_sync_settings, which live under the
 * cloud-sync banner mid-literal rather than with the PG-sync patches; and the
 * two `handlers['set_settings*]` neighbours that stayed with their banner.
 */

import type { MockHandler } from '../core/mockDispatcher';

/**
 * True when the page was opened with `?license=inactive`.
 *
 * The boot gate routes to `LicenseActivationScreen` on an inactive/unknown
 * licence, and this mock answered a hardcoded `isActive: true` — so that screen
 * was unreachable in a browser. Same per-navigation seam as `?unprovisioned=1`,
 * `?nousers=1` and `?revoked=1`: changes no default, read at CALL time, guarded
 * because the handler also runs under jsdom where `search` may be empty.
 */
function inactiveLicenceRequested(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('license') === 'inactive';
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// BOOT / SETUP — license group (was literal at the BOOT/SETUP banner)
// ═══════════════════════════════════════════════════════════════

export const licenseHandlers: Record<string, MockHandler> = {
  'get_license_status': () => inactiveLicenceRequested()
    ? { isActive: false, status: 'inactive', tier: null, payload: null, message: 'No licence is activated on this device.' }
    : { isActive: true, status: 'valid', tier: 'pro', payload: null, message: null },
  // Field-for-field with `ServerLicenseStatus` (api/license.ts): tenantId, status,
  // tier, active, deviceRevoked, expiresAt, graceUntil, maxLocations. `deviceRevoked`
  // was absent, so this DTO did not actually match its declared type — nothing reads
  // it yet, but a missing field on a registry typed `(args) => unknown` is exactly
  // the drift that produced the `qr_url` defect (round 26).
  'check_license_status': () => ({ tenantId: 'tenant-1', status: 'active', tier: 'Pro', active: true, deviceRevoked: false, expiresAt: null, graceUntil: null, maxLocations: 5 }),
  'get_device_id': () => 'mock-device-id-001',
  'activate_license': () => true,
  'renew_license': () => true,
};

// ═══════════════════════════════════════════════════════════════
// SETTINGS — store / receipt / hardware / credit (was the SETTINGS banner)
// ═══════════════════════════════════════════════════════════════

export const settingsHandlers: Record<string, MockHandler> = {
  'get_store_settings': () => ({
    name: 'TOKO TEST', address: 'Jl. Contoh No. 123', taxId: 'TAX-001', currency: 'IDR', branch: 'Cabang A', logo: '',
  }),
  'get_store_settings_scoped': () => ({
    name: 'TOKO TEST', address: 'Jl. Contoh No. 123', taxId: 'TAX-001', currency: 'IDR', branch: 'Cabang A', logo: '',
  }),
  'set_store_settings': () => null,
  'set_store_settings_scoped': () => null,

  'get_receipt_settings': () => ({
    showCurrency: true, decimalSeparator: 'dot', showTax: true, footer: 'Terima kasih',
    paperWidth: 'standard', showTableNumber: false,
    marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
  }),
  'get_receipt_settings_scoped': () => ({
    showCurrency: true, decimalSeparator: 'dot', showTax: true, footer: 'Terima kasih',
    paperWidth: 'standard', showTableNumber: false,
    marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
  }),
  'set_receipt_settings': () => null,

  'set_receipt_settings_scoped': () => null,
  'get_setting': () => null,
  'set_setting_scoped': () => null,

  'get_hardware_settings': () => ({
    printerConnection: 'usb', printerDevicePath: '', printerPaperSize: '80mm',
    scannerDeviceId: '', scannerInputMode: 'usb',
  }),
  'set_hardware_settings_scoped': () => null,

  'get_credit_settings': () => ({ enabled: false, reminderIntervalHours: 24, maxLimitMinor: 1000000 }),
  'set_credit_settings': () => null,
  'set_credit_settings_scoped': () => null,
};

// ═══════════════════════════════════════════════════════════════
// Settings writes + PG sync (were trailing handlers[...] = ... patches)
// ═══════════════════════════════════════════════════════════════

export const settingsWriteHandlers: Record<string, MockHandler> = {
  'set_setting': () => true,
  'set_settings': () => true,
  'set_settings_scoped': () => true,

// PG sync
  'get_sync_plan': () => ({ pushed: 0, pulled: 0, conflicts: 0 }),
  'get_pg_sync_settings': () => ({
  enabled: false, host: '', port: '5432', dbname: '', user: '',
  }),
  'update_pg_sync_settings': () => true,
  'pg_sync_status': () => ({
  running: false, last_error: null, last_sync_at: null,
  }),
  'pg_sync_start': () => true,
  'pg_sync_stop': () => true,
};

// ═══════════════════════════════════════════════════════════════
// BRANDING — Phase 5.1 conversion (todo-refactor-devmock-router-
// consolidation.md): the two static brand-settings entries the router's
// entryHandlers literal held, moved verbatim under the banner that already
// named them. A named map, not folded into settingsHandlers, so nothing
// else's key set moves with it; this file has carried three domains since
// the enterprise lane's settings move — branding is a settings sibling,
// not a fourth one.
// ═══════════════════════════════════════════════════════════════

export const brandHandlers: Record<string, MockHandler> = {
  'get_brand_settings': () => ({
    primary_colour: '#147EFB',
    logo_path: null,
    store_name: 'kasir.mu Demo',
    colour_hover: null,
  }),
  'get_brand_settings_scoped': () => ({
    primary_colour: '#147EFB',
    logo_path: null,
    store_name: 'kasir.mu Demo',
    colour_hover: null,
  }),
};

