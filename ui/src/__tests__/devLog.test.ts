/**
 * @vitest-environment node
 *
 * This file's entire import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDevLog, devLog, getDevLog } from '../utils/devLog';

/**
 * The dev-log bus is the ONE pattern for in-app diagnostics: emit with
 * `devLog.<level>(source, message)` so the line reaches the devtools
 * console as `[source] message`, and every entry is recorded for tests to
 * assert on (getDevLog) without spying on console internals.
 */

describe('devLog shared diagnostic bus', () => {
  beforeEach(() => clearDevLog());
  afterEach(() => {
    clearDevLog();
    vi.restoreAllMocks();
  });

  it('emits a [source]-prefixed line to the matching devtools console level', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    devLog.warn('topology', 'guard dropped 1 wire');
    devLog.error('sync', 'quarantine failed');
    devLog.info('sync', 'poll started');

    expect(warn).toHaveBeenCalledWith('[topology] guard dropped 1 wire');
    expect(error).toHaveBeenCalledWith('[sync] quarantine failed');
    expect(info).toHaveBeenCalledWith('[sync] poll started');
  });

  it('records every entry for tests to assert on', () => {
    devLog.warn('topology', 'a');
    devLog.info('sync', 'b');
    devLog.error('sync', 'c');

    expect(getDevLog()).toEqual([
      { level: 'warn', source: 'topology', message: 'a' },
      { level: 'info', source: 'sync', message: 'b' },
      { level: 'error', source: 'sync', message: 'c' },
    ]);
  });

  it('caps the buffer so a long-running session cannot grow unbounded', () => {
    for (let i = 0; i < 120; i += 1) devLog.warn('topology', `drop ${i}`);

    const log = getDevLog();
    expect(log).toHaveLength(100);
    expect(log[0]!.message).toBe('drop 20'); // oldest 20 evicted
    expect(log[99]!.message).toBe('drop 119');
  });

  it('clearDevLog resets the buffer between scopes', () => {
    devLog.warn('topology', 'a');
    clearDevLog();
    expect(getDevLog()).toEqual([]);
  });
});
