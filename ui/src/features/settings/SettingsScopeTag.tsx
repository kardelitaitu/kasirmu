import { Localized } from "@fluent/react";
import "./SettingsScopeTag.css";

/**
 * The 5 canonical scope levels from todo-global-saas-1.md §H.
 * Every Settings section belongs to one of these scopes.
 */
export type SettingsScopeLevel =
  | "organization"
  | "legal-entity"
  | "location"
  | "workspace"
  | "terminal";

const SCOPE_META: Record<SettingsScopeLevel, { id: string; defaultText: string }> = {
  organization: { id: "settings-scope-organization", defaultText: "Organization" },
  "legal-entity": { id: "settings-scope-legal-entity", defaultText: "Legal Entity" },
  location: { id: "settings-scope-location", defaultText: "Location" },
  workspace: { id: "settings-scope-workspace", defaultText: "Workspace" },
  terminal: { id: "settings-scope-terminal", defaultText: "Terminal" },
};

export interface SettingsScopeTagProps {
  /** Scope level for the settings section. */
  scope: SettingsScopeLevel;
  /** Optional additional CSS class names. */
  className?: string;
}

/**
 * Inline pill tag for labeling the configuration scope level of a Settings section (§H).
 *
 * Deliberately carries NO native `title`: the pill already renders the scope
 * name as visible text, and the old `title="Configuration Scope: …"` produced
 * a square OS-rendered browser tooltip that stacked on top of the nav item's
 * own React <Tooltip> bubble — the settings-sidebar "double tooltip" report.
 * It was also hardcoded English (unlocalized). Native tooltips are now pinned
 * out by `__tests__/nativeTooltipCompliance.test.ts`.
 */
export function SettingsScopeTag({ scope, className }: SettingsScopeTagProps) {
  const meta = SCOPE_META[scope];

  return (
    <span
      className={`settings-scope-tag settings-scope-tag--${scope}${className ? ` ${className}` : ""}`}
      data-testid={`settings-scope-tag-${scope}`}
    >
      <Localized id={meta.id}>
        <span>{meta.defaultText}</span>
      </Localized>
    </span>
  );
}
