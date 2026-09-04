// Unit tests for nextActionKey — pure function that maps a KDS status
// to the Fluent translation key for the advance action button.

import { describe, it, expect } from 'vitest';
import { nextActionKey } from '@/features/kds/components/KdsTicketCard';

describe('nextActionKey', () => {
  it('pending → kds-advance-start', () => {
    expect(nextActionKey('pending')).toBe('kds-advance-start');
  });

  it('preparing → kds-advance-ready', () => {
    expect(nextActionKey('preparing')).toBe('kds-advance-ready');
  });

  it('ready → kds-advance-serve', () => {
    expect(nextActionKey('ready')).toBe('kds-advance-serve');
  });

  it('served → null (terminal)', () => {
    expect(nextActionKey('served')).toBeNull();
  });

  it('cancelled → null (terminal)', () => {
    expect(nextActionKey('cancelled')).toBeNull();
  });

  it('unknown status → null', () => {
    expect(nextActionKey('random')).toBeNull();
    expect(nextActionKey('')).toBeNull();
  });
});
