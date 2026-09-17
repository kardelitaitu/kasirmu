// ── Dev-mock Legal Entity round-trips ────────────────────────────
//
// The four `*_legal_entit*_scoped` commands were added to the dev mock so
// scripts/verify-ipc-parity.py stops reporting them as unanswerable — before
// that, `invoke()` returned null in browser preview and callers silently
// rendered their failure path (the gate calls this out explicitly).
//
// These pin the mock's contract against the real command implementation in
// apps/desktop-tauri/src/commands/legal_entities.rs:
//   - one seeded "Default Legal Entity", mirroring migration
//     20260908_legal_entities.sql, which auto-creates exactly one per tenant;
//   - creates and updates persist for the session, like the store mock;
//   - `tenantId` is Organization-level and never client-controlled;
//   - an unknown id yields null rather than the first-row fallback the store
//     mock uses, because the real `get` returns Option and the API layer
//     declares `LegalEntity | null`.
//
// jsdom has no window.__TAURI_INTERNALS__, so invoke() routes to the mock —
// the same path a browser preview takes.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invoke } from '@/dev-mock/tauri-api';

interface MockLegalEntityRow {
  id: string;
  tenantId: string;
  name: string;
  legalName: string;
  registrationNumber: string;
  taxId: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('dev-mock legal entity surface', () => {
  it('seeds exactly one Default Legal Entity for the staged tenant', async () => {
    const list = (await invoke('list_legal_entities_scoped')) as MockLegalEntityRow[];
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('Default Legal Entity');
    // Mirrors DEFAULT_TENANT_ID in the Rust command module.
    expect(list[0]?.tenantId).toBe('default');
  });

  it('persists a created entity across list calls like the real DB', async () => {
    const created = (await invoke('create_legal_entity_scoped', {
      args: {
        id: 'le-rt-1',
        name: 'PT Round Trip',
        legalName: 'PT Round Trip Tbk',
        registrationNumber: 'AHU-0001',
        taxId: '12.34.567.8-901.000',
        status: 'active',
      },
    })) as MockLegalEntityRow;
    expect(created.id).toBe('le-rt-1');
    expect(created.createdAt).toBe(created.updatedAt);

    const list = (await invoke('list_legal_entities_scoped')) as MockLegalEntityRow[];
    expect(list.some((e) => e.id === 'le-rt-1')).toBe(true);

    const fetched = (await invoke('get_legal_entity_scoped', {
      args: { id: 'le-rt-1' },
    })) as MockLegalEntityRow;
    expect(fetched.legalName).toBe('PT Round Trip Tbk');
  });

  it('ignores a client-supplied tenantId — the resource is Organization-scoped', async () => {
    const created = (await invoke('create_legal_entity_scoped', {
      args: { id: 'le-tenant-1', name: 'Sneaky', tenantId: 'other-tenant' },
    })) as MockLegalEntityRow;
    // The real command hardcodes DEFAULT_TENANT_ID and never reads one from
    // the caller; the mock must not imply the field is settable.
    expect(created.tenantId).toBe('default');
  });

  it('applies an update, preserving id, tenantId and createdAt', async () => {
    const created = (await invoke('create_legal_entity_scoped', {
      args: { id: 'le-up-1', name: 'Before', legalName: 'Before Legal' },
    })) as MockLegalEntityRow;

    const updated = (await invoke('update_legal_entity_scoped', {
      args: { id: 'le-up-1', name: 'After', taxId: 'TAX-9' },
    })) as MockLegalEntityRow;

    expect(updated.name).toBe('After');
    expect(updated.taxId).toBe('TAX-9');
    // Untouched fields survive — update is a full-row write in the real
    // command, so the mock must not blank what the payload omitted.
    expect(updated.legalName).toBe('Before Legal');
    expect(updated.id).toBe(created.id);
    expect(updated.tenantId).toBe('default');
    expect(updated.createdAt).toBe(created.createdAt);
  });

  it('returns null for an unknown id instead of falling back to the first row', async () => {
    // This is the deliberate divergence from getMockLocation, which answers a
    // bad id with MOCK_STORE. Callers branch on null, so the mock has to be
    // able to express the empty case.
    const missing = await invoke('get_legal_entity_scoped', { args: { id: 'le-nope' } });
    expect(missing).toBeNull();

    const badUpdate = await invoke('update_legal_entity_scoped', {
      args: { id: 'le-nope', name: 'Ghost' },
    });
    expect(badUpdate).toBeNull();
  });

  it('serves copies, so a caller mutating the result cannot corrupt mock state', async () => {
    const list = (await invoke('list_legal_entities_scoped')) as MockLegalEntityRow[];
    const first = list[0];
    expect(first).toBeDefined();
    if (first) first.name = 'CORRUPTED';
    const again = (await invoke('list_legal_entities_scoped')) as MockLegalEntityRow[];
    expect(again[0]?.name).not.toBe('CORRUPTED');
  });
});
