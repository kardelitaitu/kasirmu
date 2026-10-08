import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (...args: unknown[]) => mockInvoke(...args),
}));

import {
  resolveBootStore,
  listWorkspacesScoped,
  listWorkspaceScreensScoped,
  listWorkspaces,
  listAllWorkspacesScoped,
  DEFAULT_WORKSPACE_TYPES,
} from '@/api/workspaces';

describe('workspaces.ts API contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolveBootStore calls correct command', async () => {
    mockInvoke.mockResolvedValue({ id: 'ws1', name: 'Default' });
    await resolveBootStore('device-1');
    expect(mockInvoke).toHaveBeenCalledWith('resolve_boot_store', { deviceId: 'device-1' });
  });

  it('resolveBootStore with no args defaults to null', async () => {
    mockInvoke.mockResolvedValue({ id: 'ws1' });
    await resolveBootStore();
    expect(mockInvoke).toHaveBeenCalledWith('resolve_boot_store', { deviceId: null });
  });

  it('listWorkspacesScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await listWorkspacesScoped('tok');
    expect(mockInvoke).toHaveBeenCalledWith('list_workspaces_scoped', { sessionToken: 'tok' });
  });

  it('listWorkspaceScreensScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await listWorkspaceScreensScoped('tok', 'pos');
    expect(mockInvoke).toHaveBeenCalledWith('list_workspace_screens_scoped', { sessionToken: 'tok', typeKey: 'pos' });
  });

  it('listWorkspaces calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await listWorkspaces('ticket-1', 'store-1');
    expect(mockInvoke).toHaveBeenCalledWith('list_workspaces', { ticket: 'ticket-1', storeId: 'store-1' });
  });

  it('listAllWorkspacesScoped calls list_all_workspaces_scoped when available', async () => {
    const customTypes = [{ key: 'custom', name: 'Custom', description: '', icon: '' }];
    mockInvoke.mockResolvedValue(customTypes);
    const result = await listAllWorkspacesScoped('tok');
    expect(mockInvoke).toHaveBeenCalledWith('list_all_workspaces_scoped', { sessionToken: 'tok' });
    expect(result).toEqual(customTypes);
  });

  it('listAllWorkspacesScoped falls back to DEFAULT_WORKSPACE_TYPES on command not found', async () => {
    mockInvoke.mockRejectedValue(new Error('Command list_all_workspaces_scoped not found'));
    const result = await listAllWorkspacesScoped('tok');
    expect(result).toEqual(DEFAULT_WORKSPACE_TYPES);
  });

  it('listAllWorkspacesScoped propagates unexpected errors', async () => {
    mockInvoke.mockRejectedValue(new Error('boom'));
    await expect(listAllWorkspacesScoped('tok')).rejects.toThrow('boom');
  });

  it('propagates errors', async () => {
    mockInvoke.mockRejectedValue(new Error('workspace not found'));
    await expect(listWorkspacesScoped('bad')).rejects.toThrow('workspace not found');
  });
});
