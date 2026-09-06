import { useLocalization } from '@fluent/react';

// Reuses the tier-locked visual language (same layout, no upsell CTA).
import './TierLockedFeature.css';

/**
 * §B administrative lock screen (todo-global-saas-1.md): rendered by
 * administrative SaaS screens (Analytics, Reports, Audit Log, Promotions,
 * Topology, …) when `useAdminGate()` reports locked — the subscription has
 * left `active` (expired into grace, canceled, paused, or unavailable).
 *
 * Deliberately NOT an upgrade prompt: the tier is not the problem, the
 * subscription state is — so the message points at verifying the
 * subscription instead of the pricing page. Operational screens never
 * render this; they keep working through the offline grace window.
 */
export default function AdminLockedFeature() {
  const { l10n } = useLocalization();

  return (
    <section className="tier-locked" aria-label={l10n.getString('admin-locked-title')}>
      <div className="tier-locked-content">
        <h2 className="tier-locked-title">{l10n.getString('admin-locked-title')}</h2>
        <p className="tier-locked-message">{l10n.getString('admin-locked-message')}</p>
      </div>
    </section>
  );
}
