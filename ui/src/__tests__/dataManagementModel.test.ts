// dataManagementModel tests ---------------------------------------------
//
// The data contract behind DataManagementScreen, moved out of the screen in
// DataManagement lane slice 1. The screen is 944 lines of wizards and IPC; these
// three rules are the only parts of it that are pure, and they are the parts a
// row added to DATA_TYPES can silently break — INITIAL_EXPORT seeds itself from
// the table, so a seventh type that forgets to join the union, or repeats a key,
// changes what gets exported by default without any test touching the screen.

import { describe, expect, it } from 'vitest';
import {
  DATA_TYPES,
  INITIAL_EXPORT,
  INITIAL_IMPORT,
  type DataType,
} from '@/features/settings/dataManagementModel';

describe('dataManagementModel', () => {
  it('offers exactly the six documented data types, in table order', () => {
    // The checklist the operator sees IS this list, and the export request sends
    // whatever is selected from it. A row appearing or disappearing here is a
    // product change, not a refactor, so it has to be a deliberate edit.
    expect(DATA_TYPES.map((t) => t.key)).toEqual<DataType[]>([
      'products',
      'categories',
      'sales',
      'customers',
      'users',
      'settings',
    ]);
  });

  it('names a distinct, convention-shaped Fluent id for both strings of every row', () => {
    // This case used to assert label/description were NON-EMPTY, because the model
    // held display text rendered raw into the DOM. The text is gone: the model now
    // carries ids only and settings.ftl / settings.id.ftl are the sole source for
    // what an operator reads. The invariant that replaces emptiness is the NAME —
    // dynamicFluentFamilies.test.ts enumerates data-mgmt-type-<key> independently,
    // so if this table drifted from that shape the family test would check keys the
    // screen never asks for and the checklist would render raw ids. Keys still feed
    // a Set<DataType>, so uniqueness is asserted for the same reason as before.
    const keys = DATA_TYPES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const row of DATA_TYPES) {
      expect(row.labelId).toBe(`data-mgmt-type-${row.key}`);
      expect(row.descriptionId).toBe(`data-mgmt-type-${row.key}-desc`);
      expect(row.labelId).not.toBe(row.descriptionId);
    }
    const ids = DATA_TYPES.flatMap((t) => [t.labelId, t.descriptionId]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('starts both wizards with every type selected and nothing else set', () => {
    // The invariants that hold the wizards together: export selects the WHOLE
    // table, so adding a seventh type cannot quietly make it opt-in; and both
    // wizards begin at step select with no file, no progress, no password and no
    // dry-run preview carried over from a previous run.
    expect(INITIAL_EXPORT.selectedTypes).toEqual(new Set(DATA_TYPES.map((t) => t.key)));
    expect(INITIAL_EXPORT.step).toBe('select');
    expect(INITIAL_EXPORT.password).toBe('');
    expect(INITIAL_EXPORT.passwordConfirm).toBe('');
    expect(INITIAL_EXPORT.outputFile).toBeNull();
    expect(INITIAL_IMPORT.step).toBe('select');
    expect(INITIAL_IMPORT.selectedFile).toBeNull();
    expect(INITIAL_IMPORT.metadata).toBeNull();
    expect(INITIAL_IMPORT.dryRun).toBeNull();
    expect(INITIAL_IMPORT.analysing).toBe(false);
  });
});
