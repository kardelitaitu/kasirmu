//! DevicesConnectivityScreen — Hardware and connectivity management in Settings.
//!
//! Hosts the EDC Card Terminals configuration card for managing physical payment
//! terminals and driver bindings.

import { EdcTerminalsCard } from '../components/EdcTerminalsCard';

/** Devices & Connectivity settings screen: manages card payment terminals and hardware connectivity. */
export function DevicesConnectivityScreen() {
  return (
    <div className="settings-screen" style={{ padding: 'var(--space-6)', maxWidth: 1000 }}>
      <EdcTerminalsCard />
    </div>
  );
}
