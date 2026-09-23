//! `useDeviceIp` — device IP address indicator hook.
//!
//! Reports **both** addresses of the device, each resolved independently so one
//! failure cannot hide the other:
//! - `local` — the LAN address, via the Tauri IPC command `get_local_ip`.
//! - `public` — the internet-facing address, via ipify.org (free, no API key).
//!
//! `ip`/`source` are the single-value view of the same pair (public preferred,
//! then local), kept for callers that render one address.

import { useState, useEffect, useRef } from 'react';
import { getLocalIp } from '@/api/system';

/** Source of the IP address. */
export type IpSource = 'public' | 'local';

/** Return type of the `useDeviceIp` hook. */
export interface DeviceIpStatus {
  /** The LAN address of the device, or null if unavailable. */
  local: string | null;
  /** The internet-facing address, or null if the lookup failed. */
  public: string | null;
  /** Best-known single address — public if resolved, otherwise local, else null. */
  ip: string | null;
  /** Which address `ip` holds, or null when neither resolved. */
  source: IpSource | null;
}

/** How long to wait for the public-IP lookup before treating it as unavailable. */
const PUBLIC_IP_TIMEOUT_MS = 5_000;

/**
 * Detect the device's addresses — LAN and public, resolved in parallel.
 *
 * 1. `get_local_ip` Tauri IPC → `local` (no network round-trip; works offline)
 * 2. `https://api.ipify.org?format=json` → `public` (5s timeout)
 *
 * Each side fails independently to null, so an offline terminal still shows its
 * LAN address. The legacy fields stay consistent with the pair.
 */
export function useDeviceIp(): DeviceIpStatus {
  const [local, setLocal] = useState<string | null>(null);
  const [publicIp, setPublicIp] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    async function resolve() {
      const settled = await Promise.allSettled([
        getLocalIp(),
        (async () => {
          const response = await fetch('https://api.ipify.org?format=json', {
            signal: AbortSignal.timeout(PUBLIC_IP_TIMEOUT_MS),
          });
          if (!response.ok) return null;
          const data: { ip?: string } = await response.json();
          return data.ip ?? null;
        })(),
      ]);
      if (!mountedRef.current) return;

      const [localResult, publicResult] = settled;
      setLocal(localResult.status === 'fulfilled' ? (localResult.value ?? null) : null);
      setPublicIp(publicResult.status === 'fulfilled' ? (publicResult.value ?? null) : null);
    }

    resolve();

    return () => {
      mountedRef.current = false;
    };
  }, []);

  if (publicIp) return { local, public: publicIp, ip: publicIp, source: 'public' };
  if (local) return { local, public: null, ip: local, source: 'local' };
  return { local: null, public: null, ip: null, source: null };
}
