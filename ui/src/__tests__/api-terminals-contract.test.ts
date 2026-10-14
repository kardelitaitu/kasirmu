/**
 * @vitest-environment node
 *
 * This file's import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
// ── IPC contract tests for terminals.ts ────────────────────────────
//
// Verifies the Tauri command name and argument shape for every
// exported function in ui/src/api/terminals.ts (33 invoke calls, 0
// prior tests).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

import {
  listTerminals,
  listTerminalsScoped,
  getTerminalScoped,
  registerTerminalScoped,
  updateTerminalScoped,
  pingTerminalScoped,
  deleteTerminalScoped,
  listTerminalOverridesScoped,
  setTerminalOverrideScoped,
  deleteTerminalOverrideScoped,
  getTerminalProfileScoped,
} from '@/api/terminals';

describe('terminals.ts IPC contract', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('listTerminals invokes "list_terminals_scoped" with sessionToken', async () => {
    mockInvoke.mockResolvedValue([]);
    await listTerminals('tok');
    expect(mockInvoke).toHaveBeenCalledWith('list_terminals_scoped', { sessionToken: 'tok' });
  });

  it('listTerminalsScoped invokes "list_terminals_scoped" with sessionToken', async () => {
    mockInvoke.mockResolvedValue([]);
    await listTerminalsScoped('tok');
    expect(mockInvoke).toHaveBeenCalledWith('list_terminals_scoped', { sessionToken: 'tok' });
  });

  it('getTerminalScoped invokes "get_terminal_scoped" with sessionToken + id', async () => {
    mockInvoke.mockResolvedValue(null);
    await getTerminalScoped('tok', 'term-1');
    expect(mockInvoke).toHaveBeenCalledWith('get_terminal_scoped', {
      sessionToken: 'tok',
      id: 'term-1',
    });
  });

  it('registerTerminalScoped invokes "register_terminal_scoped" with sessionToken + args', async () => {
    mockInvoke.mockResolvedValue({ id: 't1' });
    await registerTerminalScoped('tok', { name: 'Register 1', deviceId: 'dev-1' });
    expect(mockInvoke).toHaveBeenCalledWith('register_terminal_scoped', {
      sessionToken: 'tok',
      args: { name: 'Register 1', deviceId: 'dev-1' },
    });
  });

  it('updateTerminalScoped invokes "update_terminal_scoped" with sessionToken + args', async () => {
    mockInvoke.mockResolvedValue({ id: 't1' });
    await updateTerminalScoped('tok', { id: 't1', name: 'Renamed', deviceId: 'dev-1', isActive: true });
    expect(mockInvoke).toHaveBeenCalledWith('update_terminal_scoped', {
      sessionToken: 'tok',
      args: { id: 't1', name: 'Renamed', deviceId: 'dev-1', isActive: true },
    });
  });

  it('pingTerminalScoped invokes "ping_terminal_scoped" with sessionToken + id', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await pingTerminalScoped('tok', 'term-1');
    expect(mockInvoke).toHaveBeenCalledWith('ping_terminal_scoped', {
      sessionToken: 'tok',
      id: 'term-1',
    });
  });

  it('deleteTerminalScoped invokes "delete_terminal_scoped" with sessionToken + id', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await deleteTerminalScoped('tok', 'term-1');
    expect(mockInvoke).toHaveBeenCalledWith('delete_terminal_scoped', {
      sessionToken: 'tok',
      id: 'term-1',
    });
  });

  it('listTerminalOverridesScoped invokes "list_terminal_overrides_scoped" with sessionToken + terminalId', async () => {
    mockInvoke.mockResolvedValue([]);
    await listTerminalOverridesScoped('tok', 'term-1');
    expect(mockInvoke).toHaveBeenCalledWith('list_terminal_overrides_scoped', {
      sessionToken: 'tok',
      terminalId: 'term-1',
    });
  });

  it('setTerminalOverrideScoped invokes "set_terminal_override_scoped" with sessionToken + terminalId + feature + enabled', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await setTerminalOverrideScoped('tok', 'term-1', 'cloud_sync', true);
    expect(mockInvoke).toHaveBeenCalledWith('set_terminal_override_scoped', {
      sessionToken: 'tok',
      terminalId: 'term-1',
      feature: 'cloud_sync',
      enabled: true,
    });
  });

  it('deleteTerminalOverrideScoped invokes "delete_terminal_override_scoped" with sessionToken + terminalId + feature', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await deleteTerminalOverrideScoped('tok', 'term-1', 'cloud_sync');
    expect(mockInvoke).toHaveBeenCalledWith('delete_terminal_override_scoped', {
      sessionToken: 'tok',
      terminalId: 'term-1',
      feature: 'cloud_sync',
    });
  });

  it('getTerminalProfileScoped invokes "get_terminal_profile_scoped" with sessionToken + terminalId', async () => {
    mockInvoke.mockResolvedValue(null);
    await getTerminalProfileScoped('tok', 'term-1');
    expect(mockInvoke).toHaveBeenCalledWith('get_terminal_profile_scoped', {
      sessionToken: 'tok',
      terminalId: 'term-1',
    });
  });

  it('propagates backend errors', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('permission denied'));
    await expect(listTerminalsScoped('tok')).rejects.toThrow('permission denied');
  });
});
