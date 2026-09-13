// ── Security: Key Rotation & Age ──────────────────────────────────

import { loggedInvoke } from '@/utils/logged-invoke';

/** Metadata about the current encryption key (no key material exposed). */
export interface KeyRotationStatus {
  /** Whether a key exists in the OS keyring. */
  hasKey: boolean;
  /** ISO 8601 timestamp of when the current key was created. */
  createdAt: string | null;
  /** Number of days since key creation (null if unknown). */
  ageDays: number | null;
}

/** Result of a successful key rotation. */
export interface RotationInfo {
  /** Key name (e.g. 'oz-pos/encryption-key'). */
  keyName: string;
  /** ISO 8601 timestamp of when the new key was created. */
  createdAt: string;
  /** Number of bytes in the generated key. */
  keyBytes: number;
}

/** Get the current key rotation status (key age, creation timestamp). */
export const getKeyRotationInfo = (): Promise<KeyRotationStatus> =>
  loggedInvoke<KeyRotationStatus>('get_key_rotation_info');

/**
 * Result of a rotation. There is deliberately NO wrapper for the old
 * `rotate_encryption_key`: that command was ungated and is deleted, and its one
 * and only front-end reference was the wrapper here. The type stays because it
 * is the declared response shape of the surviving gated command
 * `rotate_encryption_key_scoped`, which no screen calls yet — so key rotation has
 * no front door in this build. A scoped wrapper is a decision for an owner, not
 * a side effect of this commit.
 */
