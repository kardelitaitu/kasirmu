import { useState, useEffect } from 'react';
import { getMachineId } from '@/api/license';
import { useToast } from '@/components/Toast';
import './ConnectionStatus.css';
import './MachineIdStatus.css';

/** Displays the hardware-bound machine ID as a copyable pill chip. */
export default function MachineIdStatus() {
  const [machineId, setMachineId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { addToast } = useToast();

  useEffect(() => {
    let mounted = true;
    getMachineId()
      .then(id => {
        if (mounted) {
          setMachineId(id);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setMachineId(null);
          setLoading(false);
        }
      });
    return () => { mounted = false; };
  }, []);

  const handleCopy = () => {
    if (!machineId) return;
    navigator.clipboard.writeText(machineId).then(() => {
      addToast({ type: 'success', message: 'Hardware ID copied to clipboard' });
    });
  };

  const displayId = loading
    ? '···············'
    : machineId ?? 'unavailable';

  return (
    <button
      type="button"
      className={`connection-status machine-id-chip${machineId ? ' machine-id-chip--ready' : ''}${loading ? ' machine-id-chip--loading' : ''}`}
      onClick={handleCopy}
      tabIndex={machineId ? 0 : -1}
      title={machineId ? `Hardware ID: ${machineId} — Click to copy` : 'Hardware ID unavailable'}
      aria-label={`Hardware ID: ${displayId}. Click to copy.`}
      style={{ cursor: machineId ? 'pointer' : 'default' }}
    >
      <span className="connection-latency machine-id-value">{displayId}</span>

      {machineId && (
        <svg
          className="machine-id-copy-icon"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}
