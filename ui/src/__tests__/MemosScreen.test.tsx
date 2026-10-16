import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import sharedFtl from '@/locales/shared.ftl?raw';

vi.mock('@/api/memos', () => ({
  createMemoScoped: vi.fn(),
  listAuthoredMemosScoped: vi.fn(),
  publishMemoScoped: vi.fn(),
  reviseMemoScoped: vi.fn(),
  stopMemoScoped: vi.fn(),
}));

vi.mock('@/api/locations', () => ({
  listLocationsScoped: vi.fn(),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok-1', activeWorkspace: null, logout: vi.fn() }),
}));

vi.mock('@/contexts/SubscriptionContext', () => ({
  useAdminGate: () => ({ locked: false, reason: null }),
}));

import MemosScreen from '@/features/memo/MemosScreen';
import { createMemoScoped, listAuthoredMemosScoped, reviseMemoScoped } from '@/api/memos';
import { listLocationsScoped } from '@/api/locations';

const mockCreateMemo = createMemoScoped as ReturnType<typeof vi.fn>;
const mockListMemos = listAuthoredMemosScoped as ReturnType<typeof vi.fn>;
const mockReviseMemo = reviseMemoScoped as ReturnType<typeof vi.fn>;
const mockListLocations = listLocationsScoped as ReturnType<typeof vi.fn>;

function renderScreen() {
  return renderWithFluentSync(<MemosScreen />, sharedFtl);
}

describe('MemosScreen', () => {
  beforeEach(() => {
    mockListMemos.mockReset();
    mockCreateMemo.mockReset();
    mockReviseMemo.mockReset();
    mockListLocations.mockReset();
    mockListMemos.mockResolvedValue([]);
    mockListLocations.mockResolvedValue([]);
    mockCreateMemo.mockResolvedValue({ id: 'memo-1' });
    mockReviseMemo.mockResolvedValue({ id: 'memo-1' });
  });

  // A double submit on Create draft must not store the draft TWICE.
  //
  // `canSubmit` includes `!creating`, but `creating` is STATE: React commits it on its
  // next render, after the second submit of a real double tap. core does not refuse the
  // replay either -- `create_memo_draft` mints a fresh `uuid::Uuid::now_v7()` and INSERTs
  // unconditionally (crates/kasirmu-core/src/db/memos.rs:83), with no dedupe -- so two
  // submits store TWO identical drafts.
  //
  // SHAPE 3 (round 139): both submits inside ONE act() batch. Sequential `fireEvent`
  // wraps each dispatch in its own act() and React commits `setCreating(true)` between
  // them, disabling the button -- that shape reports 1 call where a real double submit
  // sends 2.
  it('creates one memo draft for a double submit while the first is in flight', async () => {
    let releaseCreate: ((v: unknown) => void) | undefined;
    const heldCreate = new Promise((resolve) => { releaseCreate = resolve; });
    mockCreateMemo.mockImplementation(() => heldCreate as never);
    renderScreen();

    await waitFor(() => {
    });

    fireEvent.change(screen.getByPlaceholderText(/close the drawer/i), { target: { value: 'Closing early' } });
    fireEvent.change(screen.getByPlaceholderText(/message|body/i), { target: { value: 'We close at 8pm.' } });

    const form = screen.getByPlaceholderText(/close the drawer/i).closest('form')!;
    await act(async () => {
      fireEvent.submit(form);
      // The disabled flag React set is not yet authoritative for a live double submit;
      // dropping it sends the second submit to the handler the way a real one would.
      form.querySelectorAll('button[type=submit]').forEach((b) => b.removeAttribute('disabled'));
      fireEvent.submit(form);
    });

    expect(
      mockCreateMemo.mock.calls.length,
      'a second submit re-sent the create while the first was in flight; core has no ' +
        'dedupe, so this stores TWO identical memo drafts',
    ).toBe(1);

    releaseCreate?.({ id: 'memo-1' });
    await waitFor(() => {
      expect(mockCreateMemo).toHaveBeenCalledTimes(1);
    });
  });
});