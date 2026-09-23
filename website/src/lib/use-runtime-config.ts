/**
 * The React side of the runtime config's late arrival.
 *
 * Every URL-gated island reads `licenseApiUrl()` at render time and renders
 * either its real UI or its not-configured notice from that one read. The
 * Worker's `/__oz/runtime-config.js` is deferred, but an island's own module is
 * fetched in parallel and hydrates as soon as it is ready — so a config
 * response that takes about a second lands AFTER the first render, and without
 * this hook the island keeps the notice it rendered, with zero requests, until
 * the user reloads (measured in a browser 2026-09-23).
 *
 * `useRuntimeConfigArrival()` re-renders the caller once, at the moment a URL
 * becomes known, so the next render reads it and the island's own effects take
 * over from there. It is deliberately the smallest thing that can work: no
 * timer, no polling, no loading state — an island that is never given a config
 * keeps exactly the notice it renders today, and the hook costs nothing beyond
 * one event listener it removes on unmount.
 *
 * Only the islands that gate their whole UI on the URL need this (the account
 * dashboard and the auth/pairing forms). Click-time readers — the payment
 * helpers and the subscription section inside the loaded dashboard — read
 * `licenseApiUrl()` when the user acts, so they are already correct.
 */
import { useEffect, useReducer, useRef } from 'react';
import { licenseApiUrl, onRuntimeConfigArrived } from './runtime-config';

/** Re-render the caller when the runtime config supplies a URL it did not have. */
export function useRuntimeConfigArrival(): void {
  const rendered = useRef(licenseApiUrl());
  const [, arrived] = useReducer((n: number) => n + 1, 0);
  useEffect(
    () =>
      onRuntimeConfigArrived((url) => {
        // A URL this render already had is not news, and re-rendering on it
        // would only burn a render on every mount.
        if (url === rendered.current) return;
        rendered.current = url;
        arrived();
      }),
    [],
  );
}
