// ── DevProfiler ───────────────────────────────────────────────────
//
// The kitchen board and the product lookup each shipped a bare React
// <Profiler> whose onRender wrote to the console on every render over 1ms.
// Nothing gated it to development and vite.config.ts does not set
// drop_console, so the callback ran in production too.
//
// `Profiler` adds no DOM node, so the two branches cannot be told apart by
// querying the document. The gate is therefore asserted by SUBSITUTING
// React's `Profiler` with a recorder: the component under test imports it from
// the same module object this file mocks, so `profilerCalls` counts exactly
// the times a `Profiler` element was actually constructed.
//
// Two weaker shapes were tried first and BOTH were vacuous, which is why this
// one is written this way -- each is recorded because each looks reasonable:
//   * `expect(console.debug).not.toHaveBeenCalled()` in production PASSED with
//     the gate removed: `onRender` lands after a synchronous assertion
//     (measured SPY_CALLS=0 while the Profiler's own log line still printed).
//   * the mirror assertion in development FAILED with the gate PRESENT: the
//     callback only logs above a 1ms threshold and a test render measured
//     0.31ms and 0.14ms, so it asserted the threshold, not the gate.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type * as ReactTypes from 'react';

const profilerCalls: string[] = [];

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactTypes>();
  return {
    ...actual,
    Profiler: ({ id, children }: { id: string; children: ReactNode }) => {
      profilerCalls.push(id);
      return <>{children}</>;
    },
  };
});

import { DevProfiler } from '@/components/DevProfiler';

describe('DevProfiler', () => {
  beforeEach(() => {
    profilerCalls.length = 0;
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders its children in a production build', () => {
    vi.stubEnv('DEV', false);
    render(
      <DevProfiler id="Probe">
        <span>content</span>
      </DevProfiler>,
    );
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('renders its children in a development build', () => {
    vi.stubEnv('DEV', true);
    render(
      <DevProfiler id="Probe">
        <span>content</span>
      </DevProfiler>,
    );
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('mounts NO Profiler in a production build', () => {
    vi.stubEnv('DEV', false);
    render(
      <DevProfiler id="Probe">
        <span>content</span>
      </DevProfiler>,
    );
    expect(profilerCalls).toEqual([]);
  });

  it('DOES mount a Profiler in a development build', () => {
    vi.stubEnv('DEV', true);
    render(
      <DevProfiler id="Probe">
        <span>content</span>
      </DevProfiler>,
    );
    expect(profilerCalls).toEqual(['Probe']);
  });
});
