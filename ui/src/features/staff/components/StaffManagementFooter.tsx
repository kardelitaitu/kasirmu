/**
 * StaffManagementFooter — the status strip at the bottom of the Staff page.
 *
 * Staff and Roles register `fullscreen`, so AppShell renders them without
 * AppLayout — and AppLayout is what mounts the app's own StatusBar
 * (`app/StatusBar.tsx`, `AppLayout.tsx:324`). A fullscreen settings page
 * therefore has no status surface unless it brings one, which is why the KDS
 * screen carries `KdsScreenFooter`; this is the same idea for a management
 * page, and the shape the other settings pages will copy.
 *
 * It owns no data. The counts, the role count and the load timestamp are the
 * parent's — this component is presentational, so the page's single source of
 * truth stays in one place. The one value read here is the active instance,
 * because it names the scope the listed staff belong to and nothing else on
 * the page reads it.
 *
 * A snapshot that has not arrived renders NOTHING for the timestamp: `loadedAt`
 * is null while a load is in flight or after it failed, and the strip then
 * shows the scope alone rather than a time it cannot vouch for.
 *
 * The roster's counts are deliberately NOT repeated here. They are the stat row
 * at the top of the tab, which owns them; this strip is scope and freshness.
 */
import type { ReactNode } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useWorkspace } from '@/contexts/WorkspaceContext';

interface StaffManagementFooterProps {
  /**
   * When the current lists landed, or null when no successful load has
   * completed (initial load in flight, or the load failed).
   */
  loadedAt: number | null;
}

/** Renders the Staff page's bottom status strip. Owns no staff data. */
export function StaffManagementFooter({ loadedAt }: StaffManagementFooterProps) {
  const { l10n } = useLocalization();
  const { activeInstance } = useWorkspace();
  const locale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';

  // One expression, read twice (the Fluent var and the fallback child), so it
  // is computed once here rather than formatted at each site.
  const updatedTime =
    loadedAt === null
      ? ''
      : new Date(loadedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

  // Built as a list rather than written out in JSX so a missing value drops
  // its segment AND its separator: the separators are placed between, never
  // hardcoded after each part.
  const segments: { id: string; node: ReactNode }[] = [];
  if (loadedAt !== null) {
    segments.push(
      {
        id: 'updated',
        node: (
          <Localized id="staff-footer-updated" vars={{ time: updatedTime }}>
            <span>Updated {updatedTime}</span>
          </Localized>
        ),
      },
    );
  }
  const workspaceName = activeInstance?.name ?? activeInstance?.store_name ?? '';
  if (workspaceName) {
    segments.push({ id: 'workspace', node: <span>{workspaceName}</span> });
  }

  return (
    <footer className="staff-mgmt-footer">
      {segments.map((segment, index) => (
        <span className="staff-mgmt-footer-segment" key={segment.id}>
          {index > 0 && (
            <span className="staff-mgmt-footer-sep" aria-hidden="true">|</span>
          )}
          {segment.node}
        </span>
      ))}
    </footer>
  );
}
