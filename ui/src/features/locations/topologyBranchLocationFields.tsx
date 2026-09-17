/**
 * Branch Location profile fields for the topology node inspector.
 *
 * Extracted from NodeTopologyEditor.tsx (slice G7-a). Pure relocation: the
 * module-scope BranchLocationFields component plus the regional timezone
 * preset helpers it alone uses, moved VERBATIM - identical JSX, identical
 * class names, identical props. The component keeps owning its lazy profile
 * fetch and the serialized blur-persist loop; the editor passes
 * beginInspectorEdit in as a prop so field edits still flow through the
 * dirty and save cycle exactly as before the move.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Localized } from '@fluent/react';
import type { useLocalization } from '@fluent/react';
import { useToast } from '@/frontend/shared/Toast';
import { updateLocationProfileScoped, getLocationProfileScoped, type LocationProfile } from '@/api/locations';

/** Bounded preset list the slice-4 regional editor offers for
 *  `locations.timezone` (ADR #48 Decision 2): exactly the three Indonesian
 *  IANA zones, rendered as a native select — no free-text entry, no search
 *  box. Mirrors `kasirmu_core::regional::LOCATION_TIMEZONES`, which the write
 *  boundary (`update_location_profile_scoped`) enforces fail-closed
 *  alongside the legacy `UTC` column-default sentinel, so the editor must
 *  never send anything else. A future zone extends both lists together. */
const LOCATION_TIMEZONE_PRESETS = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'] as const;
type LocationTimezonePreset = (typeof LOCATION_TIMEZONE_PRESETS)[number];
/** Whether tz is one of the three preset Indonesian location timezones. */
const isLocationTimezonePreset = (tz: string): tz is LocationTimezonePreset =>
  (LOCATION_TIMEZONE_PRESETS as readonly string[]).includes(tz);

/** Branch Location profile fields — fetched lazily from the backend. */
export function BranchLocationFields({ nodeId, sessionToken, l10n, beginInspectorEdit }: {
  nodeId: string;
  sessionToken: string | null | undefined;
  l10n: ReturnType<typeof useLocalization>['l10n'];
  beginInspectorEdit: (id: string) => void;
}) {
  const [profile, setProfile] = useState<LocationProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Partial<Pick<LocationProfile, 'address' | 'currency' | 'timezone' | 'tax_id'>> | null>(null);
  const active = draft && profile ? { ...profile, ...draft } : profile;
  const { addToast } = useToast();

  // ── Serialized blur-persist ─────────────────────────────────────
  // The four fields each fire persist on blur. Naive per-field saves race:
  // blurring Address then immediately Currency (before the first update
  // resolves) builds the second payload from the STALE pre-Address profile,
  // silently overwriting the Address change. Keep the latest profile and
  // draft in refs, serialize the IPC calls, and loop until no queued edit
  // remains — so every accumulated field change rides the final payload.
  // The draft is only cleared once the whole chain settles, so a failed
  // save keeps the user's edits visible (with an error toast) for a retry
  // instead of reverting them silently.
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const saveInFlightRef = useRef(false);
  const queuedRef = useRef(false);

  const persist = useCallback(async () => {
    if (!sessionToken || !profileRef.current) return;
    if (saveInFlightRef.current) {
      // A save is running; mark a newer edit arrived so the loop re-reads
      // the latest draft instead of the snapshot already in flight.
      queuedRef.current = true;
      return;
    }
    saveInFlightRef.current = true;
    try {
      // Drain the queue: each pass snapshots the CURRENT profile + draft.
      // A blur arriving mid-save sets queuedRef, forcing another pass with
      // the accumulated edits once the in-flight update commits.
      while (true) {
        queuedRef.current = false;
        const currentDraft = draftRef.current;
        if (!currentDraft) break;
        const merged = { ...profileRef.current, ...currentDraft };
        const updated = await updateLocationProfileScoped(sessionToken, merged);
        profileRef.current = updated;
        setProfile(updated);
        if (queuedRef.current) continue;
        setDraft(null);
        break;
      }
    } catch {
      // Keep the draft so the user's edits stay visible; surface the failure.
      addToast({ message: l10n.getString('topology-inspector-save-error'), type: 'error' });
    } finally {
      saveInFlightRef.current = false;
    }
  }, [sessionToken, addToast, l10n]);

  useEffect(() => {
    let cancelled = false;
    // Session token resolves asynchronously after the workspace is selected.
    // Do not fire a scoped IPC call with a null token — keep the section in
    // its loading state until the token is available (effect re-runs on change).
    if (!sessionToken) {
      setLoading(true);
      return () => { cancelled = true; };
    }
    setLoading(true);
    getLocationProfileScoped(sessionToken, nodeId)
      .then((p) => { if (!cancelled) { setProfile(p); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [nodeId, sessionToken]);

  if (loading) {
    return (
      <div className="inspector-section">
        <h4 className="inspector-section-title"><Localized id="topology-inspector-section-location">Branch Location</Localized></h4>
        <Localized id="shared-loading"><span className="inspector-type-label">Loading…</span></Localized>
      </div>
    );
  }

  if (!active) return null;

  return (
    <div className="inspector-section">
      <h4 className="inspector-section-title"><Localized id="topology-inspector-section-location">Branch Location</Localized></h4>
      {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- label wraps input via <Localized> span */}
      <label className="inspector-field">
        <span><Localized id="topology-inspector-address">Address</Localized></span>
        <input
          type="text"
          value={active.address}
          placeholder={l10n.getString('topology-inspector-address-placeholder')}
          onChange={(e) => { beginInspectorEdit(nodeId); setDraft((d) => ({ ...d ?? {}, address: e.target.value })); }}
          onBlur={persist}
        />
      </label>
      <div className="inspector-field-row">
        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
        <label className="inspector-field inspector-field--half">
          <span><Localized id="topology-inspector-currency">Currency</Localized></span>
          <input
            type="text"
            value={active.currency}
            placeholder="USD"
            maxLength={3}
            onChange={(e) => { beginInspectorEdit(nodeId); setDraft((d) => ({ ...d ?? {}, currency: e.target.value.toUpperCase() })); }}
            onBlur={persist}
          />
        </label>
        <label className="inspector-field inspector-field--half">
          <span><Localized id="topology-inspector-timezone">Timezone</Localized></span>
          <select
            aria-label={l10n.getString('topology-inspector-timezone')}
            value={isLocationTimezonePreset(active.timezone) ? active.timezone : ''}
            onChange={(e) => {
              // Fail-closed client side: only a preset may enter the draft.
              // The placeholder option is disabled, so this guard also
              // rejects the programmatic '' case — mirroring the server
              // boundary, which accepts presets plus the legacy UTC sentinel
              // only (08faea6f0).
              const tz = e.target.value;
              if (!isLocationTimezonePreset(tz)) return;
              beginInspectorEdit(nodeId);
              setDraft((d) => ({ ...d ?? {}, timezone: tz }));
            }}
            onBlur={persist}
          >
            {/* Legacy sentinel rows (column default 'UTC') show a disabled
                placeholder instead of a fake preset; preset rows hide it. */}
            {!isLocationTimezonePreset(active.timezone) && (
              <option value="" disabled>{l10n.getString('topology-inspector-timezone-placeholder')}</option>
            )}
            <option value="Asia/Jakarta">{l10n.getString('topology-inspector-timezone-asia-jakarta')}</option>
            <option value="Asia/Makassar">{l10n.getString('topology-inspector-timezone-asia-makassar')}</option>
            <option value="Asia/Jayapura">{l10n.getString('topology-inspector-timezone-asia-jayapura')}</option>
          </select>
        </label>
      </div>
      {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
      <label className="inspector-field">
        <span><Localized id="topology-inspector-tax-id">Tax ID</Localized></span>
        <input
          type="text"
          value={active.tax_id}
          placeholder={l10n.getString('topology-inspector-tax-id-placeholder')}
          onChange={(e) => { beginInspectorEdit(nodeId); setDraft((d) => ({ ...d ?? {}, tax_id: e.target.value })); }}
          onBlur={persist}
        />
      </label>
    </div>
  );
}
