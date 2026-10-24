import { useState, useEffect, useCallback } from 'react';
import { useLocalization } from '@fluent/react';
import { useToast } from '@/components/Toast';
import { getKeyRotationInfo } from '@/api/security';

const ROTATION_DAYS = 90;
const STORAGE_KEY = 'oz-key-created-at';

/** Fallback: get key creation timestamp from localStorage. */
function getLocalCreatedAt(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

/** Fallback: store key creation timestamp in localStorage. */
export function setLocalCreatedAt(iso: string) {
  localStorage.setItem(STORAGE_KEY, iso);
}

/**
 * Get the key age in days, trying the backend first and falling back
 * to localStorage. Returns null if not tracked.
 */
export async function getKeyAgeDays(): Promise<number | null> {
  try {
    const status = await getKeyRotationInfo();
    // Sync localStorage cache from authoritative backend value
    if (status.createdAt) {
      setLocalCreatedAt(status.createdAt);
    }
    if (status.ageDays !== null) {
      return status.ageDays;
    }
  } catch {
    // Backend unavailable — fall through to localStorage
  }

  const stored = getLocalCreatedAt();
  if (!stored) return null;
  const created = new Date(stored).getTime();
  return Math.floor((Date.now() - created) / (1000 * 60 * 60 * 24));
}

/**
 * Get days until rotation is due (negative if overdue).
 * Async because it may query the backend.
 */
export async function getDaysUntilRotation(): Promise<number | null> {
  const age = await getKeyAgeDays();
  if (age === null) return null;
  return ROTATION_DAYS - age;
}

/**
 * Hook that shows a toast notification when the key is approaching
 * 90 days old. Checks once on mount and sets up a daily check.
 * Uses the Tauri backend if available, falls back to localStorage.
 */
export function useKeyRotationReminder() {
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(async () => {
    if (dismissed) return;

    const daysLeft = await getDaysUntilRotation();
    if (daysLeft === null) return;

    // Both strings go through Fluent, which this hook did NOT do until it was
    // measured: the messages were hardcoded English and the day count was a
    // hand-rolled `${n} day${n === 1 ? '' : 's'}`, which is an ENGLISH plural rule
    // baked into TypeScript. Indonesian has no plural inflection at all, so that
    // ternary was never right for the app's second locale; a Fluent `[one]`/`*[other]`
    // selector lets each bundle answer in its own grammar.
    if (daysLeft <= 0) {
      addToast({
        type: 'warning',
        message: l10n.getString('settings-key-rotation-overdue'),
        duration: 0, // Persistent until dismissed
      });
    } else if (daysLeft <= 5) {
      addToast({
        type: 'info',
        message: l10n.getString('settings-key-rotation-due', { count: daysLeft }),
        duration: 10000,
      });
      setDismissed(true);
    }
  }, [addToast, dismissed, l10n]);

  useEffect(() => {
    // Check on mount
    check();
    // Check daily
    const interval = setInterval(check, 24 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [check]);
}
