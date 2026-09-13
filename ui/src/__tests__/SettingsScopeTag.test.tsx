import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithFluentSync } from "@/__tests__/test-utils/render";
import settingsFtl from "@/locales/settings.ftl?raw";
import { SettingsScopeTag, type SettingsScopeLevel } from "@/features/settings/SettingsScopeTag";

describe("SettingsScopeTag", () => {
  const scopes: Array<{ scope: SettingsScopeLevel; expectedText: RegExp; testId: string }> = [
    { scope: "organization", expectedText: /organization/i, testId: "settings-scope-tag-organization" },
    { scope: "legal-entity", expectedText: /legal entity/i, testId: "settings-scope-tag-legal-entity" },
    { scope: "location", expectedText: /location/i, testId: "settings-scope-tag-location" },
    { scope: "workspace", expectedText: /workspace/i, testId: "settings-scope-tag-workspace" },
    { scope: "terminal", expectedText: /terminal/i, testId: "settings-scope-tag-terminal" },
  ];

  it.each(scopes)(
    "renders tag for $scope with correct label and testid",
    ({ scope, expectedText, testId }) => {
      renderWithFluentSync(<SettingsScopeTag scope={scope} />, settingsFtl);
      const tag = screen.getByTestId(testId);
      expect(tag).toBeInTheDocument();
      expect(tag).toHaveTextContent(expectedText);
      expect(tag).toHaveClass(`settings-scope-tag--${scope}`);
    },
  );
});
