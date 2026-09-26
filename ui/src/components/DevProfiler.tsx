import { Profiler, type ReactNode } from 'react';

/** Props for {@link DevProfiler}. */
export interface DevProfilerProps {
  /** Identifier React reports for this subtree. */
  id: string;
  /** The subtree to measure. */
  children: ReactNode;
}

/**
 * A React `Profiler` that exists ONLY in development builds.
 *
 * Two screens shipped a bare `<Profiler>` whose `onRender` calls
 * `console.debug` on every render over 1ms. That is a development aid, but
 * nothing gated it to development, and `vite.config.ts` does not set
 * `drop_console`, so in a production build the callback still ran on every
 * render of the kitchen board and the product lookup -- both of which
 * re-render on a polling tick -- and still wrote to the console.
 *
 * `import.meta.env.DEV` is replaced by a literal at build time, so the guard
 * is statically resolved: in production this returns `children` directly and
 * no `Profiler` (and no callback) is mounted at all, rather than being
 * mounted and then doing nothing.
 */
export function DevProfiler({ id, children }: DevProfilerProps) {
  if (!import.meta.env.DEV) {
    return <>{children}</>;
  }
  return (
    <Profiler
      id={id}
      onRender={(_id, phase, actualDuration) => {
        if (typeof actualDuration === 'number' && actualDuration > 1) {
          console.debug(
            `[Profiler] ${id}`,
            phase === 'mount' ? 'mount' : 'update',
            `${actualDuration.toFixed(1)}ms`,
          );
        }
      }}
    >
      {children}
    </Profiler>
  );
}
