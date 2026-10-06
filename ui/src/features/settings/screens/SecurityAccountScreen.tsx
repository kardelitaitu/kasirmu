//! SecurityAccountScreen — Settings → Security & Account.
//!
//! The last scaffold in this folder to be filled in, and the only one that was
//! GREENFIELD: its provenance says "no existing settings section feeds this
//! page yet", so unlike its siblings there was nothing to compose by name. The
//! content below was therefore chosen from what the app ALREADY has and does not
//! expose here, rather than invented.
//!
//! WHAT THIS PAGE OWNS — two blocks, both grounded in existing surfaces:
//!
//!  1. THE ACTIVE SESSION. Who is signed in, and as what. The tablet shows the
//!     signed-in identity NOWHERE: `components/RoleBadge.tsx` renders the
//!     display name, the role chip and a logout control, and its only production
//!     import is `app/AppLayout.tsx` — the DESKTOP shell. So on the tablet an
//!     operator cannot see which account they are acting as, nor their role,
//!     from inside Settings. This block reuses that component verbatim rather
//!     than re-implementing it, so the two shells cannot drift.
//!
//!  2. THE AUDIT TRAIL SCOPE NOTE. `security-trail-scope-note` already exists in
//!     shared.ftl and states which events are recorded (sign-ins, sign-outs,
//!     impersonation, staff account changes). It belonged on a security page and
//!     had no page; it has one now.
//!
//! WHAT THIS PAGE DELIBERATELY DOES NOT DO. No password/PIN change control, no
//! session list, no 2FA, no device revocation — NONE of those commands exist in
//! the mobile auth surface (`apps/mobile-tauri/src/commands/auth.rs` exposes
//! has_users, staff_check_username, staff_login, create_session,
//! list_organizations, switch_organization, impersonate_user_scoped,
//! destroy_session, session_keepalive, refresh_picker_ticket, verify_pin).
//! PIN editing already lives in Staff Management's detail drawer. Rendering
//! controls for commands that do not exist would ship a button that errors.
//!
//! The orphaned `EmailReportSettings` (SMTP credentials, zero props) was
//! considered for this page and REJECTED: its own title is "Email Reports", and
//! hosting outbound-report SMTP under "Security & Account" would mislabel it.
//! It needs its own home, not this one.

import { Localized } from '@fluent/react';
import { Card } from '@/components/Card';
import RoleBadge from '@/components/RoleBadge';
import './screens-placeholder.css';
import './SecurityAccountScreen.css';

/** Settings → Security & Account: the active session and the audit-trail scope. */
export function SecurityAccountScreen() {
  return (
    <section className="settings-screen-placeholder">
      <h1 className="settings-screen-placeholder-title">
        <Localized id="settings-nav-security-account">Security &amp; Account</Localized>
      </h1>
      {/* The migration note stays (SettingsPage.test.tsx asserts it on every
          screen, migrated ones included). */}
      <p className="settings-screen-placeholder-note">
        <Localized id="settings-screen-migrating">
          Existing settings content will move here selectively.
        </Localized>
      </p>

      <Card
        shadow="sm"
        header={<Localized id="settings-section-security"><h2 className="settings-section-title">Active session</h2></Localized>}
      >
        {/* The same component the desktop shell renders. It returns null without
            a session, which is the correct state for a locked shell. */}
        <div className="settings-security-session">
          <RoleBadge />
        </div>
        <p className="settings-hint settings-security-trail-note">
          <Localized id="security-trail-scope-note">
            <span>
              Sign-ins, sign-outs, impersonation and staff account changes are recorded in the audit log.
            </span>
          </Localized>
        </p>
      </Card>
    </section>
  );
}
