import { invoke } from '@/api/tauri';
import { recordIpcTiming } from './perf-metrics';
import { emitIpcError, redactedDiagnostic } from './app-error';

/**
 * Invoke a Tauri command with console timing logs for dev observability.
 *
 * ERR-06: every failure is normalized exactly once at this IPC boundary —
 * typed `AppError` parsing, retry classification, and a correlation id are
 * attached, and structured events are emitted for telemetry subscribers.
 * The original error is always rethrown unchanged so callers keep control;
 * screens should render `userErrorMessage(err, …)` instead of `err.message`.
 */
export async function loggedInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const start = performance.now();
  if (import.meta.env.DEV) console.log(`[tauri] ${cmd} → started`);
  try {
    const result = await invoke<T>(cmd, args);
    const ms = performance.now() - start;
    if (import.meta.env.DEV) console.log(`[tauri] ${cmd} → succeeded (${Math.round(ms)}ms)`);
    // PERF-06: capture aggregate-only IPC latency (p50/p95/max per command).
    recordIpcTiming(cmd, ms);
    return result;
  } catch (err) {
    const ms = performance.now() - start;
    if (import.meta.env.DEV) console.log(`[tauri] ${cmd} → failed (${Math.round(ms)}ms)`, redactedDiagnostic(err));
    // ERR-06: classify + correlate + notify subscribers once.
    emitIpcError(cmd, err);
    recordIpcTiming(cmd, ms);
    throw err;
  }
}
