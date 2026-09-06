import { loggedInvoke } from '@/utils/logged-invoke';

/** Organization/Tenant legal business identity. */
export interface LegalEntity {
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

/** Arguments for creating a Legal Entity. */
export interface CreateLegalEntityArgs {
  id: string;
  name: string;
  legalName: string;
  registrationNumber: string;
  taxId: string;
  status: 'active' | 'inactive';
}

/** Arguments for updating a Legal Entity. */
export interface UpdateLegalEntityArgs extends Omit<CreateLegalEntityArgs, 'id'> {
  id: string;
}

/** List Legal Entities for the authenticated Organization/Tenant. */
export const listLegalEntitiesScoped = (sessionToken: string): Promise<LegalEntity[]> =>
  loggedInvoke<LegalEntity[]>('list_legal_entities_scoped', { sessionToken });

/** Get one Legal Entity for the authenticated Organization/Tenant. */
export const getLegalEntityScoped = (
  sessionToken: string,
  id: string,
): Promise<LegalEntity | null> =>
  loggedInvoke<LegalEntity | null>('get_legal_entity_scoped', { sessionToken, id });

/** Create a Legal Entity for the authenticated Organization/Tenant. */
export const createLegalEntityScoped = (
  sessionToken: string,
  args: CreateLegalEntityArgs,
): Promise<LegalEntity> =>
  loggedInvoke<LegalEntity>('create_legal_entity_scoped', { sessionToken, args });

/** Update a Legal Entity for the authenticated Organization/Tenant. */
export const updateLegalEntityScoped = (
  sessionToken: string,
  args: UpdateLegalEntityArgs,
): Promise<LegalEntity> =>
  loggedInvoke<LegalEntity>('update_legal_entity_scoped', { sessionToken, args });
