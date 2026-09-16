/**
 * The pure half of the settings save: read-back diff -> merged payload -> which
 * tasks fire. Split out of ./useSettingsSave at that file's own request - the
 * hook keeps the read-back IPC call order, the setter mirrors, the
 * setTimeout(setSaved) sequencing and the toast/notify steps; this file keeps
 * the DECISION and nothing else.
 *
 * ZERO React, ZERO IPC, ZERO awaits: no hook call, no value import from
 * "@/api/*" (every api name here is an "import type", so the module loads with
 * no bridge at all), no clock, no setters. That is what makes planSaveTasks
 * table-testable directly - plain data in, plain data out, no renderHook.
 *
 * --- SAFETY: why Save cannot lose data ----------------------------------------
 *
 * Every task used to send the WHOLE draft DTO. The backend writes those DTOs
 * field-by-field unconditionally: run_set_receipt_settings re-stamps ten flat
 * keys (crates/oz-bridge/src/settings.rs:997-1007, tax_rounding_mode included),
 * run_set_store_settings stamps all six in one transaction (:1021-1026), and
 * update_sync_settings_data (crates/oz-bridge/src/sync.rs:64-82) does
 * server_url.as_deref().unwrap_or("") and writes it UNCONDITIONALLY, so a null
 * there CLEARS a configured URL. Only api_key is guarded with if let Some(..),
 * which is why an absent key preserves the stored one while an absent URL does
 * not. So any field the draft happened not to carry was written anyway, with
 * the draft's (possibly stale) value.
 *
 * That was reachable, not theoretical. switchOrganization
 * (contexts/WorkspaceContext.tsx:353-364) swaps sessionToken IN PLACE after a
 * PIN re-auth - no login screen, no unmount. SettingsContext refetches and
 * republishes store/currency, the page's currency effect follows, but the DRAFT
 * keeps the previous org's name/address/taxId/branch, because hydrate is
 * one-shot (SettingsPage.tsx, gated on !loading && !initialized, on purpose: a
 * later refetch must not eat the user's edits). One Ctrl+S then stamped the NEW
 * tenant's store row with the OLD tenant's identity. A partial load was the
 * second path: a failed sync read left syncServerUrl === '', and an untouched
 * Save cleared a configured URL.
 *
 * THE RULE, stated once here because every clause below is an instance of it:
 *
 *   a task fires IFF THE PAGE EDITED that field (draft vs the Revert target)
 *   AND the merged payload DIFFERS from the read-back.
 *
 * "Differs from the server" ALONE is the wrong test, and it was the bug: after
 * an org switch the previous tenant's defaultCurrency and brand name DO differ
 * from the new tenant's row, so a diff-only gate would write them straight over
 * it. The EDIT clause is what stops that - the page edited nothing, so nothing
 * fires, whatever the two values happen to look like.
 *
 * Consequences the hook relies on:
 *   * not-edited and no-diff are SKIPPED, not failures - see SaveTaskReason and
 *     SettingsSaveOutcome. A plan may therefore contain no write at all.
 *   * read-failed is a third state again: an unanswered read-back cannot be
 *     diffed, so it must not be written blind and must not be called a skip.
 *   * The store payload is FUSED with the draft currency (see the store task),
 *     because the store write and the currency write stamp the SAME column.
 *
 * The durable fix is a partial-write command server-side (send only the keys
 * you changed). Until then the read-back costs ~5 extra IPC reads per Save;
 * that is the price of not losing a tenant's identity, and it stays bounded by
 * this pair of files.
 */
import type { ReceiptSettingsDto, StoreSettingsDto } from '@/api/settings';
import type { SyncSettingsDto, UpdateSyncSettingsArgs } from '@/api/offline';

/** Loose view of a DTO, for generic key-wise diffing / merging. */
export type Flat = Record<string, unknown>;

/**
 * Per-task outcome, once the writes settle. skipped is deliberately NOT a
 * failure: it means the payload this page could produce equals what the server
 * already holds (or the page changed nothing in that family), so there was
 * nothing to write. It is a distinct state because the by-name lookup used to
 * read an omitted task as false = failed, and because "Save wrote nothing" must
 * not be encoded as "Save failed".
 */
export type SettingsSaveOutcome = 'fulfilled' | 'rejected' | 'skipped';

/**
 * The Revert target. Field-for-field the page's own SettingsSnapshot, restated
 * here because that interface is local to SettingsPage.tsx and this split
 * neither widens it nor exports it. The hook reads it as the 'saved' side of
 * every diff, refreshes it PER TASK and writes it back onto
 * savedSnapshotRef.current.
 */
export interface SettingsSaveSnapshot {
  receipt: ReceiptSettingsDto;
  store: StoreSettingsDto;
  defaultCurrency: string;
  sync: SyncSettingsDto;
  syncServerUrl: string;
  displayCardSize: number;
  displayFontSize: number;
  displayFontSmoothing: string;
  brandColour: string;
  brandStoreName: string;
}

/** What the page holds right now - the draft side of every diff. */
export interface SavePlanDraft {
  receipt: ReceiptSettingsDto;
  store: StoreSettingsDto;
  defaultCurrency: string;
  sync: SyncSettingsDto;
  syncServerUrl: string;
  /** Empty string means "the user typed no key". Not a Revert-tracked field. */
  syncApiKey: string;
  displayCardSize: number;
  displayFontSize: number;
  displayFontSmoothing: string;
  brandColour: string;
  brandStoreName: string;
}

/**
 * What the read-back answered, family by family. null is NOT "empty" - it means
 * that read never answered, which is its own outcome (read-failed) rather than
 * a diff against nothing.
 */
export interface SavePlanServer {
  receipt: ReceiptSettingsDto | null;
  store: StoreSettingsDto | null;
  prefs: Record<string, string> | null;
  sync: SyncSettingsDto | null;
  brand: { primary_colour: string; store_name: string } | null;
}

export type SaveTaskName =
  | 'receipt'
  | 'store'
  | 'currency'
  | 'prefs'
  | 'sync'
  | 'brandColour'
  | 'brandName';

/**
 * Why a planned task does what it does. write is the only firing reason; the
 * other three all mean "no call", two of them skips and one a loud failure the
 * hook counts towards 'failed'.
 *   not-edited  - the page changed nothing in this family (the org-switch case);
 *   no-diff     - the page edited, but the merged result equals the read-back;
 *   read-failed - no read-back to diff against, so nothing may be written.
 */
export type SaveTaskReason = 'write' | 'not-edited' | 'no-diff' | 'read-failed';

/** One entry of the plan: what to send, or why not to. */
export interface SaveTaskPlan {
  name: SaveTaskName;
  /** The merged payload to send; null unless fires. */
  payload: Flat | null;
  fires: boolean;
  reason: SaveTaskReason;
}

/** Keys whose draft value differs from base. Only keys the draft carries. */
export function changedKeys(draft: Flat, base: Flat): string[] {
  return Object.keys(draft).filter((k) => draft[k] !== base[k]);
}

/** base plus only the listed draft keys - the merged payload. */
export function mergeChanged(base: Flat, draft: Flat, keys: string[]): Flat {
  const out: Flat = { ...base };
  for (const k of keys) out[k] = draft[k];
  return out;
}

/** '' and whitespace are the same server state as null; keep them from reading
 *  as an edit (the sync URL is written unconditionally server-side). */
export function normUrl(v: string | null | undefined): string | null {
  return v && v.trim() ? v : null;
}

/** The three user-preference keys, in the order the prefs write sends them.
 *  Exported because the hook's runner maps over it to build its own call. */
export const PREF_KEYS = ['cardsize', 'fontsize', 'font-smoothing'] as const;

/** The two clauses plus the read-back state, resolved into one verdict. */
function verdict(opts: {
  name: SaveTaskName;
  readFailed: boolean;
  edited: boolean;
  differs: boolean;
  payload: Flat;
}): SaveTaskPlan {
  if (opts.readFailed) {
    return { name: opts.name, payload: null, fires: false, reason: 'read-failed' };
  }
  const fires = opts.edited && opts.differs;
  return {
    name: opts.name,
    payload: fires ? opts.payload : null,
    fires,
    reason: fires ? 'write' : opts.edited ? 'no-diff' : 'not-edited',
  };
}

/** A whole-DTO family (receipt, store): merge only the page's edits onto the
 *  server's own row, then fire only if that merge differs from the row. A key
 *  the page does not carry (logo) is not in the draft, so it stays server-side. */
function planDtoTask(opts: {
  name: SaveTaskName;
  server: object | null;
  draft: Flat;
  saved: Flat;
}): SaveTaskPlan {
  if (!opts.server) {
    return { name: opts.name, payload: null, fires: false, reason: 'read-failed' };
  }
  const server = opts.server as Flat;
  const pageEdits = changedKeys(opts.draft, opts.saved);
  const payload = mergeChanged(server, opts.draft, pageEdits);
  return verdict({
    name: opts.name,
    readFailed: false,
    edited: pageEdits.length > 0,
    differs: changedKeys(payload, server).length > 0,
    payload,
  });
}

/**
 * The whole plan: seven named tasks over five read-back families, in the order
 * the hook sends them. No IPC, no setters, no toast - the hook turns each write
 * payload into its own call, refreshes the snapshot per task and does the
 * notify / toast steps. 'saved' is the Revert target, i.e. the page's own
 * record of what the user actually changed since hydrate; saved === null
 * (pre-hydrate) is handled by the hook, which sends NOTHING, so this function
 * never has to guess at it.
 */
export function planSaveTasks({
  draft,
  saved,
  server,
}: {
  draft: SavePlanDraft;
  saved: SettingsSaveSnapshot;
  server: SavePlanServer;
}): SaveTaskPlan[] {
  const planned: SaveTaskPlan[] = [];

  planned.push(
    planDtoTask({
      name: 'receipt',
      server: server.receipt,
      draft: { ...draft.receipt } as Flat,
      saved: { ...saved.receipt } as Flat,
    }),
  );

  // FUSED value, never store alone: the store write stamps the currency column
  // (settings.rs:1024) and the currency task writes that SAME column, so a
  // currency-only edit must count as a store change too - otherwise the two
  // writers split and one of them re-stamps the old code.
  planned.push(
    planDtoTask({
      name: 'store',
      server: server.store,
      draft: { ...draft.store, currency: draft.defaultCurrency } as Flat,
      saved: { ...saved.store, currency: saved.defaultCurrency } as Flat,
    }),
  );

  // Currency: the same column as store.currency, written through the context.
  // A single-value write, so the merged payload is the server's code unless the
  // page edited it - which is why a currency that merely drifted (an org switch,
  // a partial load) can never be pushed into the tenant's row. Its read-back IS
  // the store row, so a missing store read fails that task too.
  planned.push(
    verdict({
      name: 'currency',
      readFailed: !server.store,
      edited: draft.defaultCurrency !== saved.defaultCurrency,
      differs: draft.defaultCurrency !== (server.store?.currency ?? null),
      payload: { currency: draft.defaultCurrency },
    }),
  );

  // Preferences: three string keys on the server, numbers in the draft.
  if (!server.prefs) {
    planned.push({ name: 'prefs', payload: null, fires: false, reason: 'read-failed' });
  } else {
    const serverPrefs = server.prefs;
    const draftPrefs: Flat = {
      cardsize: String(draft.displayCardSize),
      fontsize: String(draft.displayFontSize),
      'font-smoothing': draft.displayFontSmoothing,
    };
    const savedPrefs: Flat = {
      cardsize: String(saved.displayCardSize),
      fontsize: String(saved.displayFontSize),
      'font-smoothing': saved.displayFontSmoothing,
    };
    const mergedPrefs: Flat = {};
    for (const k of PREF_KEYS) {
      mergedPrefs[k] = draftPrefs[k] !== savedPrefs[k]
        ? draftPrefs[k]
        : (serverPrefs[k] ?? draftPrefs[k]);
    }
    const differs = PREF_KEYS.some((k) => mergedPrefs[k] !== serverPrefs[k]);
    planned.push(
      verdict({
        name: 'prefs',
        readFailed: false,
        // The merge already carries the server's value for every key the page
        // did NOT touch, so a diff on an untouched key is only possible when
        // the server holds no value for it at all - which the old code wrote
        // rather than skipped, and this '||' keeps that behaviour exactly.
        edited: PREF_KEYS.some((k) => draftPrefs[k] !== savedPrefs[k]) || differs,
        differs,
        payload: mergedPrefs,
      }),
    );
  }

  // Sync: serverUrl is written UNCONDITIONALLY server-side, so the merged
  // payload has to carry the server's own URL unless the page edited the
  // field - that is what stops a partial load (an empty draft URL) from
  // clearing a configured one. apiKey is still only sent when the user typed
  // one, and a typed key is by itself an edit worth writing.
  if (!server.sync) {
    planned.push({ name: 'sync', payload: null, fires: false, reason: 'read-failed' });
  } else {
    const serverSync = server.sync;
    const draftUrl = normUrl(draft.syncServerUrl);
    const savedUrl = normUrl(saved.syncServerUrl);
    const serverUrl = normUrl(serverSync.serverUrl);
    const typedKey = draft.syncApiKey !== '';
    const payload: UpdateSyncSettingsArgs = {
      serverUrl: draftUrl !== savedUrl ? draftUrl : serverUrl,
      enabled: draft.sync.enabled !== saved.sync.enabled ? draft.sync.enabled : serverSync.enabled,
    };
    if (typedKey) payload.apiKey = draft.syncApiKey;
    planned.push(
      verdict({
        name: 'sync',
        readFailed: false,
        // A typed key is an edit by itself; URL and enabled read through
        // normUrl, so '' and '   ' are the same server state as null and cannot
        // look like an edit. Every field the page left alone took the server's
        // own value into the payload above, so differs can only be true when
        // edited is too - which is why the AND below is the old fires
        // expression, not a new gate.
        edited:
          typedKey || draftUrl !== savedUrl || draft.sync.enabled !== saved.sync.enabled,
        differs:
          typedKey || payload.serverUrl !== serverUrl || payload.enabled !== serverSync.enabled,
        payload: { ...payload } as Flat,
      }),
    );
  }

  // Brand: two independent single-column writes; each merges to the server's
  // value unless the page edited it.
  if (!server.brand) {
    planned.push({ name: 'brandColour', payload: null, fires: false, reason: 'read-failed' });
    planned.push({ name: 'brandName', payload: null, fires: false, reason: 'read-failed' });
  } else {
    const brand = server.brand;
    planned.push(
      verdict({
        name: 'brandColour',
        readFailed: false,
        edited: draft.brandColour !== saved.brandColour,
        differs: draft.brandColour !== brand.primary_colour,
        payload: { value: draft.brandColour },
      }),
    );
    planned.push(
      verdict({
        name: 'brandName',
        readFailed: false,
        edited: draft.brandStoreName !== saved.brandStoreName,
        differs: draft.brandStoreName !== brand.store_name,
        payload: { value: draft.brandStoreName },
      }),
    );
  }

  return planned;
}

/** The task names a plan actually sends, in send order. */
export function firingTaskNames(planned: readonly SaveTaskPlan[]): SaveTaskName[] {
  return planned.filter((t) => t.fires).map((t) => t.name);
}

/** The families whose read-back never answered: failed, never skipped. */
export function readFailedTasks(planned: readonly SaveTaskPlan[]): SaveTaskPlan[] {
  return planned.filter((t) => t.reason === 'read-failed');
}

/**
 * The three-way outcome of one named task, given what was actually sent. An
 * omitted task is skipped - NOT false, NOT a failure - which is the whole
 * reason the hook looks results up BY NAME instead of by position. A sent task
 * is fulfilled only when its own settled entry says so; a missing slot counts
 * as rejected rather than silently becoming a skip.
 */
export function classifyOutcome(
  name: SaveTaskName,
  sent: ReadonlyArray<readonly [SaveTaskName, unknown]>,
  settled: ReadonlyArray<PromiseSettledResult<unknown>>,
): SettingsSaveOutcome {
  const idx = sent.findIndex(([k]) => k === name);
  if (idx < 0) return 'skipped';
  return settled[idx] && settled[idx].status === 'fulfilled' ? 'fulfilled' : 'rejected';
}
