// ui/src/features/kds/kdsSettingsModel.ts
//
// Pure settings model for the KDS: the shape persisted/held by `KdsScreen`
// and edited by the live `KdsHamburgerPanel`. Extracted verbatim from
// `KdsSettingsPanel.tsx` when that component was retired (todo-kds-agents-6)
// — it rendered nowhere (register.tsx wires only KdsScreen + ExpoScreen),
// but both live consumers imported its `KdsSettings` / `DisplayDensity`
// types and its `DEFAULT_SETTINGS`, so the model survives the component.
// Values are deliberately unchanged: this is a move, not a redesign.
// Keep this file free of UI so the board, the hamburger panel, and any
// future surface share one source of truth for the defaults.

/** Number of order card columns on the KDS open tab (1–5). */
export type DisplayDensity = number;

export interface KdsSettings {
  /** Whether new-ticket sound is enabled. */
  soundEnabled: boolean;
  /** Escalation threshold in minutes before a ticket turns yellow. */
  yellowThresholdMin: number;
  /** Escalation threshold in minutes before a ticket turns red. */
  redThresholdMin: number;
  /** Whether to auto-advance tickets after a configurable delay. */
  autoAcknowledge: boolean;
  /** Number of order card columns (1–5). */
  density: DisplayDensity;
}

export const DEFAULT_SETTINGS: KdsSettings = {
  soundEnabled: true,
  yellowThresholdMin: 5,
  redThresholdMin: 10,
  autoAcknowledge: false,
  density: 3,
};
