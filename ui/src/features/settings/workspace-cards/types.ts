/** Variant controlling card width, padding, and chrome. */
export type WorkspaceCardVariant = 'full-page' | 'modal' | 'inspector-drawer';

/** Shared props interface consumed by all workspace settings cards. */
export interface WorkspaceCardProps {
  /** Session token for authenticated API calls. */
  sessionToken?: string;
  /**
   * Kept optional for call-site compatibility only. Both readers it
   * once existed for are gone: `set_receipt_settings` was retired in
   * T10 and `set_hardware_settings` in T11, so no card may pass a
   * renderer-named actor to a permission check any more.
   */
  userId?: string;
  /** Inventory location ID scoping deduction rules. */
  locationId?: string;
  /**
   * Terminal ID for register-local hardware bindings.
   * Required when `variant='modal'` so the card knows which register's
   * hardware to display.
   */
  terminalId?: string;
  /** Rendering context controlling width, padding, and header bar. */
  variant?: WorkspaceCardVariant;
  /** Fired after successful save — parent can dismiss modal or refresh. */
  onSaved?: () => void;
}
