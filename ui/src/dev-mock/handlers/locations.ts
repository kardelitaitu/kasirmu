/**
 * Dev-mock handlers — Locations domain (memos, legal entities, cart deduction).
 *
 * Extracted from `tauri-api.ts` by the agent-4 work order
 * (`todo-refactor-devmock-agents-4.md`, phase 4.4); the code is moved
 * verbatim, comments included — only its location changes.
 *
 * Memo and legal-entity state is self-contained; `mockStores` (location
 * profiles) stays in the router because it is shared with receipt/workspace
 * mocks owned by Agent 3.
 */

import type { MockHandler } from '../core/mockDispatcher';
import type { UnwrapArgs } from './catalog';
import { MOCK_LEGAL_ENTITY } from '../core/mockSeedData';

export interface LocationsDeps {
  unwrapArgs: UnwrapArgs;
}

export function createLocationsHandlers(deps: LocationsDeps): Record<string, MockHandler> {
  const { unwrapArgs } = deps;

const mockLegalEntities: Array<typeof MOCK_LEGAL_ENTITY> = [{ ...MOCK_LEGAL_ENTITY }];

/** List the Legal Entity rows served by the dev mock. */
function listMockLegalEntities(): Array<typeof MOCK_LEGAL_ENTITY> {
  return mockLegalEntities.map((entity) => ({ ...entity }));
}

/** Resolve one Legal Entity by id.
 *  Unlike `getMockLocation`, an unknown id returns `null` rather than falling
 *  back to the first row: the real command returns `Option<LegalEntityDto>`
 *  and `ui/src/api/legalEntities.ts` declares `LegalEntity | null`, so callers
 *  branch on the empty case and the mock must be able to express it. */
function getMockLegalEntity(args: unknown): typeof MOCK_LEGAL_ENTITY | null {
  const { id } = unwrapArgs<{ id?: string }>(args);
  return mockLegalEntities.find((entity) => entity.id === id) ?? null;
}

/** Create a Legal Entity and persist it in the session-local mock list. */
function createMockLegalEntity(args: unknown): typeof MOCK_LEGAL_ENTITY {
  const payload = unwrapArgs<Partial<typeof MOCK_LEGAL_ENTITY>>(args);
  const now = new Date().toISOString();
  const created = {
    ...MOCK_LEGAL_ENTITY,
    ...payload,
    id: payload.id ?? `le-${Date.now()}`,
    // Organization-level resource: the staged tenant sentinel is fixed, so a
    // client-supplied tenantId is ignored exactly as the real command ignores it.
    tenantId: MOCK_LEGAL_ENTITY.tenantId,
    createdAt: now,
    updatedAt: now,
  };
  mockLegalEntities.push(created);
  return { ...created };
}

/** Update a Legal Entity and persist it in the session-local mock list.
 *  An unknown id returns `null`; the real command surfaces an error there, so
 *  this stays closer to the backend than the location mock's first-row
 *  fallback. `id` and `tenantId` are never taken from the payload. */
function updateMockLegalEntity(args: unknown): typeof MOCK_LEGAL_ENTITY | null {
  const { id, ...rest } = unwrapArgs<Partial<typeof MOCK_LEGAL_ENTITY> & { id?: string }>(args);
  const existing = mockLegalEntities.find((entity) => entity.id === id);
  if (!existing) return null;
  const updated = {
    ...existing,
    ...rest,
    id: existing.id,
    tenantId: existing.tenantId,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  const idx = mockLegalEntities.findIndex((entity) => entity.id === updated.id);
  if (idx !== -1) mockLegalEntities[idx] = updated;
  return { ...updated };
}


interface MockMemo {
  id: string;
  tenantId: string;
  /** Locations the memo targets; empty ⇒ Organization Memo (all locations). */
  locationIds: string[];
  authorUserId: string;
  authorRole: string;
  title: string;
  body: string;
  status: string;
  duration: string;
  revision: number;
  publishedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/** A memo plus this terminal's delivery state, as the dev mock serves it.
 *  Mirrors `ui/src/api/memos.ts` `ActiveMemo`. */
interface MockActiveMemo {
  memo: MockMemo;
  deliveryStatus: string;
}

/** Mutable memo list backing the dev mock — acknowledgements persist for the
 *  session exactly like the real recipient row (dev preview parity). Seeded
 *  with one Organization and one Location memo so the tier-stacking display
 *  has something to order. */
const mockMemos: MockActiveMemo[] = [
  {
    memo: {
      id: 'memo-org-1',
      tenantId: 'default',
      locationIds: [],
      authorUserId: 'user-owner',
      authorRole: 'role-owner',
      title: 'End-of-day checklist',
      body: 'Close the drawer, count the float, and log the safe before you leave.',
      status: 'published',
      duration: '24h',
      revision: 1,
      publishedAt: '2026-09-08T09:00:00.000Z',
      expiresAt: '2026-09-09T09:00:00.000Z',
      createdAt: '2026-09-08T09:00:00.000Z',
    },
    deliveryStatus: 'pending',
  },
  {
    memo: {
      id: 'memo-loc-1',
      tenantId: 'default',
      locationIds: ['loc-default'],
      authorUserId: 'user-manager',
      authorRole: 'role-manager',
      title: 'Restock aisle 3',
      body: 'Refill the front shelf before doors open.',
      status: 'published',
      duration: '12h',
      revision: 1,
      publishedAt: '2026-09-08T10:00:00.000Z',
      expiresAt: '2026-09-08T22:00:00.000Z',
      createdAt: '2026-09-08T10:00:00.000Z',
    },
    deliveryStatus: 'pending',
  },
];
const MEMO_CADENCE = { baseIntervalSecs: 900, kdsIntervalSecs: 2 * 900 };


/** Cadence served with the memo list — mirrors `kasirmu_core::memo`:
 *  `NOTIFICATION_BASE_INTERVAL_SECS` (900s) and the derived
 *  `kds_notification_interval_secs()` (2 × base). Expressed as base × 2 so
 *  the multiplier intent survives a base change, exactly like the backend. */
function listMockActiveMemos(): {
  memos: MockActiveMemo[];
  cadence: { baseIntervalSecs: number; kdsIntervalSecs: number };
} {
  return {
    memos: mockMemos
      .filter((m) => m.memo.status === 'published')
      .sort((a, b) => Number(a.memo.locationIds.length === 0) - Number(b.memo.locationIds.length === 0))
      .map((m) => ({ ...m, memo: { ...m.memo } })),
    cadence: { ...MEMO_CADENCE },
  };
}

/** Acknowledge a memo on the caller's terminal in the session-local mock.
 *  Returns `null` to match the real command's `Result<(), AppError>` (void). */
function acknowledgeMockMemo(args: unknown): null {
  const { memoId } = unwrapArgs<{ memoId?: string }>(args);
  if (memoId) {
    const idx = mockMemos.findIndex((m) => m.memo.id === memoId);
    if (idx !== -1) mockMemos[idx] = { ...mockMemos[idx], deliveryStatus: 'acknowledged' } as MockActiveMemo;
  }
  return null;
}

/** Display-duration to wall-clock offset, mirroring `MemoDuration`. */
const MEMO_DURATION_MS: Record<string, number> = {
  '12h': 12 * 3_600_000,
  '24h': 24 * 3_600_000,
  '3d': 72 * 3_600_000,
  '7d': 168 * 3_600_000,
  '30d': 720 * 3_600_000,
};

/** Create a memo draft in the session-local mock (dev preview parity with
 *  the real `create_memo_scoped` command). The draft is invisible to
 *  terminals until published. */
function createMockMemo(args: unknown): MockMemo {
  const payload = unwrapArgs<{
    locationIds?: string[];
    title?: string;
    body?: string;
    duration?: string;
  }>(args);
  const memo: MockMemo = {
    id: `memo-${Date.now()}`,
    tenantId: 'default',
    locationIds: payload.locationIds ?? [],
    authorUserId: 'user-1',
    authorRole: 'role-manager',
    title: payload.title ?? '(untitled)',
    body: payload.body ?? '',
    status: 'draft',
    duration: payload.duration ?? '24h',
    revision: 0,
    publishedAt: null,
    expiresAt: null,
    createdAt: new Date().toISOString(),
  };
  mockMemos.push({ memo, deliveryStatus: 'pending' });
  return { ...memo };
}

/** Publish a draft in the session-local mock: stamps publication/expiry and
 *  revision 1, matching the real `publish_memo_scoped` command. Unknown ids
 *  reject (the real command errors). */
function publishMockMemo(args: unknown): MockMemo {
  const { memoId } = unwrapArgs<{ memoId?: string }>(args);
  const found = mockMemos.find((m) => m.memo.id === memoId);
  if (!found) {
    throw new Error(`memo not found: ${memoId}`);
  }
  if (found.memo.status !== 'draft') {
    throw new Error(`memo ${memoId} is not a draft`);
  }
  const now = Date.now();
  const expiresMs = MEMO_DURATION_MS[found.memo.duration] ?? 24 * 3_600_000;
  found.memo = {
    ...found.memo,
    status: 'published',
    revision: 1,
    publishedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + expiresMs).toISOString(),
  };
  return { ...found.memo };
}

/** List every memo the session user authored, newest first — the read behind
 *  the authoring screen (matches `list_authored_memos_scoped`). The mock
 *  serves the whole list; single-user previews cannot exercise per-author
 *  filtering. */
function listMockAuthoredMemos(): MockMemo[] {
  return mockMemos
    .map((m) => ({ ...m.memo }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Early-stop a published memo in the session-local mock (dev preview parity
 *  with the real `stop_memo_scoped` command, A2 ruling: author or
 *  `memo:stop`). Unknown ids and non-published memos reject, matching the
 *  real command's state guard. */
function stopMockMemo(args: unknown): MockMemo {
  const { memoId } = unwrapArgs<{ memoId?: string }>(args);
  const found = mockMemos.find((m) => m.memo.id === memoId);
  if (!found) {
    throw new Error(`memo not found: ${memoId}`);
  }
  if (found.memo.status !== 'published') {
    throw new Error(`memo ${memoId} is not published`);
  }
  found.memo = {
    ...found.memo,
    status: 'stopped',
  };
  return { ...found.memo };
}

/** Revise a published memo in the session-local mock: bumps the revision
 *  with the corrected content (dev preview parity with the real
 *  `revise_memo_scoped`). Published-only, like the real command. */
function reviseMockMemo(args: unknown): MockMemo {
  const payload = unwrapArgs<{ memoId?: string; args?: { title?: string; body?: string } }>(args);
  const found = mockMemos.find((m) => m.memo.id === payload.memoId);
  if (!found) {
    throw new Error(`memo not found: ${payload.memoId}`);
  }
  if (found.memo.status !== 'published') {
    throw new Error(`memo ${payload.memoId} is not published`);
  }
  found.memo = {
    ...found.memo,
    title: payload.args?.title ?? found.memo.title,
    body: payload.args?.body ?? found.memo.body,
    revision: found.memo.revision + 1,
  };
  return { ...found.memo };
}


  return {
  'list_legal_entities_scoped': listMockLegalEntities,
  'get_legal_entity_scoped': getMockLegalEntity,
  'create_legal_entity_scoped': createMockLegalEntity,
  'update_legal_entity_scoped': updateMockLegalEntity,

  'list_active_memos_scoped': listMockActiveMemos,
  'acknowledge_memo_scoped': acknowledgeMockMemo,
  'list_authored_memos_scoped': listMockAuthoredMemos,

  // Memo authoring (desktop management surface). The dev mock mirrors the
  // real commands: drafts are invisible to terminals until published.
  'create_memo_scoped': createMockMemo,
  'publish_memo_scoped': publishMockMemo,
  'stop_memo_scoped': stopMockMemo,
  'revise_memo_scoped': reviseMockMemo,

  'get_cart_deduction_location': () => ({ locationId: 'loc-1', locationName: 'Main Store' }),
  'override_cart_deduction_location_scoped': () => null,
  };
}
