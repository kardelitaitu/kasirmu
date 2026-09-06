import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (...args: unknown[]) => mockInvoke(...args),
}));

import {
  createLegalEntityScoped,
  getLegalEntityScoped,
  listLegalEntitiesScoped,
  updateLegalEntityScoped,
} from '@/api/legalEntities';

const TOKEN = 'tok_legal_entity';

const ENTITY = {
  id: 'entity-1',
  tenantId: 'default',
  name: 'Main Entity',
  legalName: 'Main Entity LLC',
  registrationNumber: 'REG-1',
  taxId: 'TAX-1',
  status: 'active' as const,
  createdAt: '2026-09-06T00:00:00Z',
  updatedAt: '2026-09-06T00:00:00Z',
};

describe('legalEntities.ts API contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists Legal Entities through the scoped command', async () => {
    mockInvoke.mockResolvedValue([ENTITY]);
    await listLegalEntitiesScoped(TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('list_legal_entities_scoped', {
      sessionToken: TOKEN,
    });
  });

  it('gets one Legal Entity through the scoped command', async () => {
    mockInvoke.mockResolvedValue(ENTITY);
    const result = await getLegalEntityScoped(TOKEN, ENTITY.id);
    expect(mockInvoke).toHaveBeenCalledWith('get_legal_entity_scoped', {
      sessionToken: TOKEN,
      id: ENTITY.id,
    });
    expect(result?.tenantId).toBe('default');
  });

  it('creates a Legal Entity through the scoped command', async () => {
    const args = {
      id: ENTITY.id,
      name: ENTITY.name,
      legalName: ENTITY.legalName,
      registrationNumber: ENTITY.registrationNumber,
      taxId: ENTITY.taxId,
      status: ENTITY.status,
    };
    mockInvoke.mockResolvedValue(ENTITY);
    await createLegalEntityScoped(TOKEN, args);
    expect(mockInvoke).toHaveBeenCalledWith('create_legal_entity_scoped', {
      sessionToken: TOKEN,
      args,
    });
  });

  it('updates a Legal Entity through the scoped command', async () => {
    const args = {
      id: ENTITY.id,
      name: 'Updated Entity',
      legalName: 'Updated Entity LLC',
      registrationNumber: 'REG-2',
      taxId: 'TAX-2',
      status: 'inactive' as const,
    };
    mockInvoke.mockResolvedValue({ ...ENTITY, ...args });
    await updateLegalEntityScoped(TOKEN, args);
    expect(mockInvoke).toHaveBeenCalledWith('update_legal_entity_scoped', {
      sessionToken: TOKEN,
      args,
    });
  });
});
