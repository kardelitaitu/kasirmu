// ── ipc-payload helpers ────────────────────────────────────────────
//
// These exist because an IPC command can resolve a value its declared type
// says is impossible. The cases below pin the two rules that matter: an
// array guard never invents rows, and a struct guard never flattens a
// legitimate `null` field into "never answered" — the distinction the
// useBackupStatus fix had to preserve ("Last backup: Never" is a real
// answer, a failed read is not).
import { describe, it, expect } from 'vitest';
import { asArray, asObject } from '@/utils/ipc-payload';

describe('asArray', () => {
  it('passes a real array through unchanged (same reference)', () => {
    const rows = [{ id: 'a' }];
    expect(asArray(rows)).toBe(rows);
  });

  it('returns an empty array for every absent shape', () => {
    expect(asArray(undefined)).toEqual([]);
    expect(asArray(null)).toEqual([]);
  });

  it('returns an empty array for a non-array payload', () => {
    // The failure this guards: a command answering a struct or a scalar where
    // the caller declared an array, then calling .map/.length on it.
    expect(asArray({ rows: [] } as unknown)).toEqual([]);
    expect(asArray('nope' as unknown)).toEqual([]);
    expect(asArray(0 as unknown)).toEqual([]);
  });

  it('preserves an empty array as empty, not as absent', () => {
    expect(asArray([])).toEqual([]);
  });

  it('does not treat array-like objects as arrays', () => {
    // { length: 0 } is not an array; returning it would re-introduce .map failures.
    expect(asArray({ length: 0 } as unknown)).toEqual([]);
  });
});

describe('asObject', () => {
  it('returns a real object unchanged, INCLUDING its null fields', () => {
    const payload = { last_backup: null, last_backup_size: null };
    const out = asObject(payload);
    expect(out).toBe(payload);
    expect(out!.last_backup).toBeNull();
  });

  it('returns null for an absent payload', () => {
    expect(asObject(undefined)).toBeNull();
    expect(asObject(null)).toBeNull();
  });

  it('returns null for a non-object payload', () => {
    expect(asObject('nope' as unknown)).toBeNull();
    expect(asObject(42 as unknown)).toBeNull();
  });

  it('treats an array as not-a-struct', () => {
    // An array IS an object; returning it from asObject would let a caller
    // read named fields off a list.
    expect(asObject([] as unknown)).toBeNull();
  });
});
