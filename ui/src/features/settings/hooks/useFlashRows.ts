//! Row-flash state for Settings -> Data Management.
//!
//! Owns the 'a section just changed, pulse it green' behaviour that previously
//! lived inline in DataManagementScreen.tsx: the flashRows map, the per-key
//! timeout registry, and the unmount cleanup. Moved out verbatim - no signature
//! and no timing changed - so the screen can read as a coordinator.
//!
//! Deliberately NOT hoisted above this feature. triggerFlash is owned per screen,
//! not shared: LicenseSettings.tsx:108 holds its own (key: string) copy and
//! FeatureToggleScreen.tsx:132 a differently-typed
//! (key: string, kind: enabled | disabled) one, so a third caller would have to
//! widen the parameter before reusing this - that is a change to two sibling
//! screens, not a move. The consumers this hook does serve are the two wizard
//! hooks, which already take triggerFlash as a prop (hooks/useExportWizard.ts:27,
//! hooks/useImportWizard.ts:27).

import { useCallback, useEffect, useRef, useState } from 'react';

/** Duration (ms) for the row flash animation. */
const FLASH_DURATION = 1_400;

/** What a flashed key currently means to the renderer. */
export type FlashState = 'updated';

/**
 * Returns the flash map for presentational children plus the trigger.
 * triggerFlash stays stable (empty deps): it touches only refs and uses the
 * functional setState form, exactly as it did inline.
 */
export function useFlashRows(): {
  flashRows: Map<string, FlashState>;
  triggerFlash: (key: string) => void;
} {
  // Track recently-updated sections for a brief green background pulse.
  const [flashRows, setFlashRows] = useState<Map<string, FlashState>>(new Map());
  const flashTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const triggerFlash = useCallback((key: string) => {
    setFlashRows((prev) => {
      const next = new Map(prev);
      next.set(key, 'updated');
      return next;
    });
    const existing = flashTimeoutsRef.current.get(key);
    if (existing) clearTimeout(existing);
    const tid = setTimeout(() => {
      setFlashRows((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      flashTimeoutsRef.current.delete(key);
    }, FLASH_DURATION);
    flashTimeoutsRef.current.set(key, tid);
  }, []);

  // Cleanup flash timeouts on unmount.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    return () => {
      flashTimeoutsRef.current.forEach((tid) => clearTimeout(tid));
      flashTimeoutsRef.current.clear();
    };
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  return { flashRows, triggerFlash };
}
