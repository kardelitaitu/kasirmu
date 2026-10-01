import { useCallback } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';

/**
 * Navigate back to the workspace picker from any workspace screen.
 *
 * Thin wrapper around `useWorkspace().setActiveWorkspace(null)` that
 * avoids importing the full WorkspaceContext in every screen.
 */
export function useWorkspaceNav() {
  const { setActiveWorkspace } = useWorkspace();

  const goToWorkspacePicker = useCallback(() => {
    setActiveWorkspace(null);
    window.location.hash = '';
  }, [setActiveWorkspace]);

  return { goToWorkspacePicker };
}
