//! Pure, deterministic helpers for the restaurant payments settings screen.
//!
//! RestaurantPaymentsScreen previously inlined a handful of pure routines —
//! normalising a new rail code, deciding whether a rail is a core payment
//! method, merging persisted rails back over a fixed core default set, and
//! detecting `dirty` state from two rail lists plus the EDC default. Extracting
//! them here makes the merge/default semantics exhaustively unit-testable and
//! keeps the screen focused on state + rendering.

/** The five core payment rail codes that always exist on the screen. */
export const CORE_RAIL_CODES = ['cash', 'card', 'qris', 'open_bill', 'credit'] as const;

/** Whether a rail code (case-insensitive) is one of the non-removable core methods. */
export const isCoreRail = (railCode: string): boolean =>
  CORE_RAIL_CODES.includes(railCode.toLowerCase() as (typeof CORE_RAIL_CODES)[number]);

/** Normalise a free-text rail code: trim, lowercase, and turn disallowed chars into hyphens. */
export const sanitizeRailCode = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');

/** A payment rail as persisted. */
export interface RawRail {
  rail_code: string;
  label: string;
  is_enabled: boolean;
  parameters?: string;
}

/** A payment rail in the screen's draft state (parameters always a string). */
export interface DraftRail {
  rail_code: string;
  label: string;
  is_enabled: boolean;
  parameters: string;
}

const CORE_DEFAULTS: Array<Pick<RawRail, 'rail_code' | 'label' | 'is_enabled'>> = [
  { rail_code: 'cash', label: 'Cash', is_enabled: true },
  { rail_code: 'card', label: 'Card / EDC Terminal', is_enabled: true },
  { rail_code: 'qris', label: 'QRIS', is_enabled: true },
  { rail_code: 'open_bill', label: 'Open Bill (Table Tab)', is_enabled: true },
  { rail_code: 'credit', label: 'Customer Credit', is_enabled: true },
];

/**
 * Merge persisted rails over the fixed core set.
 *
 * Each core rail is guaranteed to exist (in its core order); a persisted match
 * keeps its source label/state/parameters, falling back to the core default
 * label when the persisted label is empty. Any remaining non-core rails are
 * appended afterwards, in source order. `null`/`undefined` input yields exactly
 * the core set.
 */
export const mergeCoreRails = (rawRails: RawRail[] | null | undefined): DraftRail[] => {
  const existingMap = new Map<string, RawRail>(
    (rawRails || []).map((r) => [r.rail_code.toLowerCase(), r]),
  );

  const merged: DraftRail[] = [];
  for (const def of CORE_DEFAULTS) {
    const match = existingMap.get(def.rail_code);
    if (match) {
      merged.push({
        rail_code: match.rail_code,
        label: match.label || def.label,
        is_enabled: match.is_enabled,
        parameters: match.parameters || '{}',
      });
      existingMap.delete(def.rail_code);
    } else {
      merged.push({
        rail_code: def.rail_code,
        label: def.label,
        is_enabled: def.is_enabled,
        parameters: '{}',
      });
    }
  }

  for (const rem of existingMap.values()) {
    merged.push({
      rail_code: rem.rail_code,
      label: rem.label,
      is_enabled: rem.is_enabled,
      parameters: rem.parameters || '{}',
    });
  }
  return merged;
};

/**
 * Decide whether the payment screen is dirty.
 *
 * True when the default EDC terminal id changed, when the draft rail count
 * differs from the originals, when a draft/expected original is missing at an
 * index, or when any field of a rail at the same index differs.
 */
export const computeRailsDirty = (
  originals: DraftRail[],
  drafts: DraftRail[],
  originalDefaultEdc: string,
  defaultEdc: string,
): boolean => {
  if (defaultEdc !== originalDefaultEdc) return true;
  // Equal lengths guarantee that every index in `drafts` has a corresponding
  // `originals` element at the same position, so no defensive `!a || !b` guard
  // is needed inside the loop below.
  if (drafts.length !== originals.length) return true;
  for (let i = 0; i < drafts.length; i++) {
    const a = drafts[i]!;
    const b = originals[i]!;
    if (
      a.rail_code !== b.rail_code ||
      a.label !== b.label ||
      a.is_enabled !== b.is_enabled ||
      a.parameters !== b.parameters
    ) {
      return true;
    }
  }
  return false;
};
