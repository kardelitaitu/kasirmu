/**
 * Route Screen-Group Compliance Gate.
 *
 * Verifies that:
 * 1. Multi-Route Screen Invariant: Any component registered under multiple routes
 *    (e.g. StaffManagementScreen for 'staff', 'roles', 'trash') MUST declare
 *    a matching `screenGroup` in its `registerPage` calls so that switching between
 *    its sub-routes / tabs does not unmount the screen or remount the shell container.
 * 2. Shell Key Contract Invariant: Both `AppShell.tsx` and `TabletAppShell.tsx` MUST
 *    key the `.workspace-fullscreen` wrapper by `pageRegistration.screenGroup ?? currentRoute`,
 *    preventing accidental reverts to bare `key={currentRoute}`.
 * 3. Staff Management Alignment: The routes 'staff', 'roles', and 'trash' must
 *    strictly share the screenGroup 'staff-management'.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

const FEATURES_DIR = resolve(__dirname, '../features');
const APP_DIR = resolve(__dirname, '../app');

interface ParsedRegistration {
  route: string;
  component: string;
  fullscreen: boolean;
  screenGroup?: string | undefined;
}

/** Parses registerPage calls from a file content. */
function parseRegisterPageCalls(source: string): ParsedRegistration[] {
  const results: ParsedRegistration[] = [];
  const regex = /registerPage\(\s*\{([\s\S]*?)\}\s*\)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(source)) !== null) {
    const body = match[1] ?? '';
    const routeMatch = /route:\s*['"]([^'"]+)['"]/.exec(body);
    const componentMatch = /component:\s*([A-Za-z0-9_]+)/.exec(body);
    const fullscreenMatch = /fullscreen:\s*(true|false)/.exec(body);
    const screenGroupMatch = /screenGroup:\s*['"]([^'"]+)['"]/.exec(body);

    if (routeMatch && componentMatch) {
      results.push({
        route: routeMatch[1]!,
        component: componentMatch[1]!,
        fullscreen: fullscreenMatch ? fullscreenMatch[1] === 'true' : false,
        screenGroup: screenGroupMatch ? screenGroupMatch[1] : undefined,
      });
    }
  }

  return results;
}

describe('Route ScreenGroup Compliance Gate', () => {
  it('enforces that components shared across multiple routes declare a matching screenGroup', () => {
    const registerFiles: string[] = [];

    function findRegisterFiles(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          findRegisterFiles(full);
        } else if (entry.name === 'register.tsx' || entry.name === 'register.ts') {
          registerFiles.push(full);
        }
      }
    }

    findRegisterFiles(FEATURES_DIR);
    expect(registerFiles.length).toBeGreaterThan(0);

    const allRegistrations: (ParsedRegistration & { file: string })[] = [];
    for (const file of registerFiles) {
      const content = readFileSync(file, 'utf-8');
      const parsed = parseRegisterPageCalls(content);
      for (const p of parsed) {
        allRegistrations.push({ ...p, file });
      }
    }

    // Group by component
    const byComponent = new Map<string, typeof allRegistrations>();
    for (const reg of allRegistrations) {
      const list = byComponent.get(reg.component) ?? [];
      list.push(reg);
      byComponent.set(reg.component, list);
    }

    // For any fullscreen component registered at more than 1 route (such as
    // StaffManagementScreen which serves tabs 'staff', 'roles', 'trash'),
    // all of its registrations MUST declare a non-empty screenGroup, and all must agree.
    const violations: string[] = [];
    for (const [component, regs] of byComponent) {
      const isFullscreen = regs.some((r) => r.fullscreen);
      if (isFullscreen && regs.length > 1) {
        const groups = regs.map((r) => r.screenGroup);
        const missingGroup = regs.filter((r) => !r.screenGroup);
        if (missingGroup.length > 0) {
          violations.push(
            `Fullscreen component ${component} is registered at ${regs.length} routes (${regs.map((r) => r.route).join(', ')}), but routes [${missingGroup.map((r) => r.route).join(', ')}] are missing screenGroup.`,
          );
        } else {
          const uniqueGroups = Array.from(new Set(groups));
          if (uniqueGroups.length > 1) {
            violations.push(
              `Fullscreen component ${component} is registered with conflicting screenGroups: ${uniqueGroups.join(', ')}.`,
            );
          }
        }
      }
    }

    expect(
      violations,
      `Multi-route components must declare a consistent screenGroup to prevent remounting on tab switch.\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('guarantees staff, roles, and trash routes are assigned screenGroup "staff-management"', () => {
    const staffRegisterFile = join(FEATURES_DIR, 'staff/register.tsx');
    const content = readFileSync(staffRegisterFile, 'utf-8');
    const parsed = parseRegisterPageCalls(content);

    const staffRoutes = ['staff', 'roles', 'trash'];
    for (const r of staffRoutes) {
      const found = parsed.find((p) => p.route === r);
      expect(found, `Expected route '${r}' to be registered in staff/register.tsx`).toBeDefined();
      expect(found?.screenGroup, `Expected route '${r}' to have screenGroup 'staff-management'`).toBe('staff-management');
    }
  });

  it('enforces that AppShell and TabletAppShell key fullscreen wrappers with screenGroup', () => {
    const appShellContent = readFileSync(join(APP_DIR, 'AppShell.tsx'), 'utf-8');
    const tabletAppShellContent = readFileSync(join(APP_DIR, 'tablet/TabletAppShell.tsx'), 'utf-8');

    // Both shells must contain the contract key binding
    expect(
      appShellContent,
      'AppShell.tsx must key workspace-fullscreen with pageRegistration.screenGroup ?? currentRoute',
    ).toContain('key={pageRegistration.screenGroup ?? currentRoute}');

    expect(
      tabletAppShellContent,
      'TabletAppShell.tsx must key workspace-fullscreen with pageRegistration.screenGroup ?? currentRoute',
    ).toContain('key={pageRegistration.screenGroup ?? currentRoute}');
  });
});
