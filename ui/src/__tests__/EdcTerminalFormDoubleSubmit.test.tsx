// ── A double submit on the EDC terminal form must create ONE terminal ────
//
// `handleSubmit` (EdcTerminalsCard.tsx:150) is the form's `onSubmit` and pressing Enter in
// the Terminal Name field submits the form natively, never consulting the Save BUTTON
// (which is guarded by `disabled={submitting}`). The handler's own `if (submitting) return`
// could not refuse the second submit either: the flag is STATE, so both submits inside
// one tick read the value from the render that built the closure. Round 186 replaced it
// with `submittingRef`, which is synchronous.
//
// Same mechanism as `TableManagementScreen.handleSaveTableModal` (round 60) and
// `.handleConfirmReservation` (round 61): a form's own submit path is a second door.
//
// `createEdcTerminalScoped` INSERTS, so two submits configure two terminals for one
// register — and the operator then has to work out which one the register actually uses.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import { ToastProvider } from '@/components/Toast';
import settingsFtl from '@/locales/settings.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import { EdcTerminalsCard } from '@/features/settings/components/EdcTerminalsCard';

const { mockCreate, mockList } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockList: vi.fn(),
}));

vi.mock('@/api/edc', () => ({
  listEdcTerminalsScoped: (...a: unknown[]) => mockList(...a),
  createEdcTerminalScoped: (...a: unknown[]) => mockCreate(...a),
  updateEdcTerminalScoped: vi.fn(),
  deleteEdcTerminalScoped: vi.fn(),
  edcTerminalStatusScoped: vi.fn().mockResolvedValue({ status: 'ready' }),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok-1', resolvedStoreId: 'store-1' }),
}));

describe('EdcTerminalsCard — the add-terminal form', () => {
  beforeEach(() => {
    mockList.mockReset().mockResolvedValue([]);
    mockCreate.mockReset();
  });

  it('does not create two terminals when the form is submitted twice', async () => {
    // Pending for the whole test: the first submit is still in flight when the second
    // lands, which is the only arrangement that can produce two writes from one form.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((res) => { release = res; });
    mockCreate.mockImplementation((() => gate.then(() => ({}))) as never);

    renderWithProviders(
      <ToastProvider>
        <EdcTerminalsCard />
      </ToastProvider>,
      settingsFtl,
      sharedFtl,
    );

    // Open the add form. With no terminals the card renders its empty state.
    await waitFor(() => expect(document.querySelector('.edc-terminals-card')).not.toBeNull());
    const addBtn = await waitFor(() => {
      const b = Array.from(document.querySelectorAll('button'))
        .find((el) => /add|new terminal/i.test(el.textContent ?? ''));
      expect(b, 'the add-terminal control was not found').toBeDefined();
      return b as HTMLElement;
    });
    fireEvent.click(addBtn);

    // Fill the two fields the handler requires (name and address).
    const nameInput = await waitFor(() => {
      const el = document.querySelector('#edc-name');
      expect(el, 'the add-terminal modal did not open').not.toBeNull();
      return el as HTMLInputElement;
    });
    fireEvent.change(nameInput, { target: { value: 'Terminal A' } });
    const addrInput = document.querySelector('#edc-address') as HTMLInputElement | null;
    expect(addrInput, 'no address field in the add-terminal form').not.toBeNull();
    fireEvent.change(addrInput!, { target: { value: 'tcp://10.0.0.5:9100' } });

    // Two submits with NO await between them — the form's own path, which is what
    // pressing Enter twice in the name field produces.
    const form = document.querySelector('.edc-form') as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(
      mockCreate.mock.calls.length,
      'a double submit configured more than one terminal',
    ).toBe(1);

    release?.();
  });
});
