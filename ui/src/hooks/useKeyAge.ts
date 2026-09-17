import { useState, useEffect, useCallback } from 'react';
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
  const { addToast } = useToast();
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(async () => {
    if (dismissed) return;

    const daysLeft = await getDaysUntilRotation();
    if (daysLeft === null) return;

    if (daysLeft <= 0) {
      addToast({
        type: 'warning',
        message: 'Encryption key rotation is overdue. Please rotate keys from Security settings to maintain PCI-DSS compliance.',
        duration: 0, // Persistent until dismissed
      });
    } else if (daysLeft <= 5) {
      addToast({
        type: 'info',
        message: `Encryption key rotation due in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Please rotate from Security settings.`,
        duration: 10000,
      });
      setDismissed(true);
    }
  }, [addToast, dismissed]);

  useEffect(() => {
    // Check on mount
    check();
    // Check daily
    const interval = setInterval(check, 24 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [check]);
}
