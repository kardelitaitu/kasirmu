// ── IPC contract tests for legalEntities.ts ─────────────────────
//
// Verifies every exported function calls loggedInvoke with the
// correct IPC command name and argument shape, and that the value
// resolved by the backend is passed through untouched.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

import {
  listLegalEntitiesScoped,
  getLegalEntityScoped,
  createLegalEntityScoped,
  updateLegalEntityScoped,
  type CreateLegalEntityArgs,
  type LegalEntity,
} from '@/api/legalEntities';

const ENTITY: LegalEntity = {
  id: 'entity-1',
  tenantId: 'default',
  name: 'Main Entity',
  legalName: 'Main Entity LLC',
  registrationNumber: 'REG-1',
  taxId: 'TAX-1',
  status: 'active',
  createdAt: '2026-09-06T00:00:00Z',
  updatedAt: '2026-09-06T00:00:00Z',
};

const CREATE_ARGS: CreateLegalEntityArgs = {
  id: 'entity-1',
  name: 'Main Entity',
  legalName: 'Main Entity LLC',
  registrationNumber: 'REG-1',
  taxId: 'TAX-1',
  status: 'active',
};

describe('legalEntities.ts IPC contract', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('listLegalEntitiesScoped → list_legal_entities_scoped with sessionToken only', async () => {
    mockInvoke.mockResolvedValue([ENTITY]);
    const result = await listLegalEntitiesScoped('tok_legal');
    expect(mockInvoke).toHaveBeenCalledWith('list_legal_entities_scoped', {
      sessionToken: 'tok_legal',
    });
    expect(result).toEqual([ENTITY]);
  });

  it('getLegalEntityScoped → get_legal_entity_scoped with sessionToken + top-level id', async () => {
    mockInvoke.mockResolvedValue(ENTITY);
    const result = await getLegalEntityScoped('tok_legal', 'entity-1');
    expect(mockInvoke).toHaveBeenCalledWith('get_legal_entity_scoped', {
      sessionToken: 'tok_legal',
      id: 'entity-1',
    });
    expect(result).toEqual(ENTITY);
  });

  it('getLegalEntityScoped passes null through for an unknown id', async () => {
    mockInvoke.mockResolvedValue(null);
    const result = await getLegalEntityScoped('tok_legal', 'missing');
    expect(mockInvoke).toHaveBeenCalledWith('get_legal_entity_scoped', {
      sessionToken: 'tok_legal',
      id: 'missing',
    });
    expect(result).toBeNull();
  });

  it('createLegalEntityScoped → create_legal_entity_scoped with sessionToken + args', async () => {
    mockInvoke.mockResolvedValue(ENTITY);
    const result = await createLegalEntityScoped('tok_legal', CREATE_ARGS);
    expect(mockInvoke).toHaveBeenCalledWith('create_legal_entity_scoped', {
      sessionToken: 'tok_legal',
      args: CREATE_ARGS,
    });
    expect(result).toEqual(ENTITY);
  });

  it('updateLegalEntityScoped → update_legal_entity_scoped with sessionToken + args', async () => {
    const args = { ...CREATE_ARGS, name: 'Updated Entity', status: 'inactive' as const };
    mockInvoke.mockResolvedValue({ ...ENTITY, ...args });
    const result = await updateLegalEntityScoped('tok_legal', args);
    expect(mockInvoke).toHaveBeenCalledWith('update_legal_entity_scoped', {
      sessionToken: 'tok_legal',
      args,
    });
    expect(result.status).toBe('inactive');
  });

  it('propagates backend errors', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('tax id already in use'));
    await expect(createLegalEntityScoped('tok_legal', CREATE_ARGS)).rejects.toThrow(
      'tax id already in use',
    );
  });
});
