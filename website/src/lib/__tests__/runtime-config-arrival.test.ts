// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RUNTIME_CONFIG_EVENT, onRuntimeConfigArrived } from '../runtime-config';

/**
 * The late-arrival signal (see onRuntimeConfigArrived).
 *
 * This is the half of the not-configured contract that a static read cannot
 * cover: an island hydrates as soon as its module is ready, which can beat a
 * slow `/__oz/runtime-config.js`, and the URL the config brings must reach it
 * without a reload. Separate file from runtime-config.test.ts because that one
 * runs in the node environment to prove the no-`window` (SSR) path, and this
 * one needs a real element event target.
 */

/**
 * Deliver what the config script delivers: the global, then the event. `url`
 * omitted models the Worker with `LICENSE_API_URL` unset, which sends
 * `licenseApiUrl: null` — falsy either way, which is all the helper reads.
 */
function arrive(url?: string): void {
  window.__OZ_CONFIG__ = url ? { licenseApiUrl: url } : {};
  window.dispatchEvent(new Event(RUNTIME_CONFIG_EVENT));
}

afterEach(() => {
  window.__OZ_CONFIG__ = undefined;
});

describe('onRuntimeConfigArrived', () => {
  it('reports a URL that arrived after the caller had looked', () => {
    window.__OZ_CONFIG__ = undefined;
    const seen = vi.fn();
    const stop = onRuntimeConfigArrived(seen);

    expect(seen).not.toHaveBeenCalled();
    arrive('https://late.example');

    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith('https://late.example');
    stop();
  });

  it('reports a URL that was already set when the caller subscribed', () => {
    // The window between an island's render and its effect: the script can
    // land in between, and the caller must still hear about the URL.
    window.__OZ_CONFIG__ = { licenseApiUrl: 'https://early.example' };
    const seen = vi.fn();
    const stop = onRuntimeConfigArrived(seen);

    expect(seen).toHaveBeenCalledWith('https://early.example');
    stop();
  });

  it('reports nothing for a config that carries no URL', () => {
    window.__OZ_CONFIG__ = undefined;
    const seen = vi.fn();
    const stop = onRuntimeConfigArrived(seen);

    arrive();
    arrive();

    expect(seen).not.toHaveBeenCalled();
    stop();
  });

  it('stops reporting once unsubscribed', () => {
    window.__OZ_CONFIG__ = undefined;
    const seen = vi.fn();
    const stop = onRuntimeConfigArrived(seen);
    stop();

    arrive('https://late.example');

    expect(seen).not.toHaveBeenCalled();
  });

  it('keeps each subscriber independent', () => {
    window.__OZ_CONFIG__ = undefined;
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = onRuntimeConfigArrived(first);
    const stopSecond = onRuntimeConfigArrived(second);

    stopFirst();
    arrive('https://late.example');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('https://late.example');
    stopSecond();
  });
});
