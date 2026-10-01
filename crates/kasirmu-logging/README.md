# kasirmu-logging

<!-- Audit stamp: 2026-09-29 · DSH-Agent · status: ACCURATE (0 findings) · re-verified against tree: all 4 init fns present (init, init_json, init_with_file, init_json_with_file) with matching signatures; RUST_LOG default info; retention_days cleanup logic present; hourly rotation; L-1 fix retains the tracing_appender WorkerGuard in a process-global registry. PRIOR STAMP (2026-07-22 · Hermes-Agent; re-audited 2026-08-31 by docs-auditor) also verified "syslog (Linux) + eventlog (Windows) pub mods present" — those modules were DELETED 2026-09-29 (C29 / decision D13) and that claim is removed rather than left stale. The earlier "#![warn(missing_docs)] present" claim was also stale: the lint is inherited via `[lints] workspace = true`. -->

Structured logging facade wrapping the `tracing` ecosystem.

## Public API

| Function | Format | Output |
|----------|--------|--------|
| `init()` | Human-readable text | stdout |
| `init_json()` | Newline-delimited JSON | stdout |
| `init_with_file(dir, prefix, days)` | Human-readable text | stdout + rolling file |
| `init_json_with_file(dir, prefix, days)` | JSON | stdout + rolling file |

All four read `RUST_LOG` (default `info`). File appender rotates hourly; files older than `retention_days` are cleaned up.

```rust
kasirmu_logging::init();                                      // dev
kasirmu_logging::init_json_with_file("logs", "kasirmu", 30);   // production
```

### Platform modules — removed

There are no platform-specific sinks. The `syslog` (Linux) and `eventlog`
(Windows) modules were deleted 2026-09-29 (C29 / decision D13): both were
unwired — zero callers tree-wide — and both were redundant with the stdout
initialisers above, which the container and the host already capture. The
crate is now pure safe Rust and denies `unsafe_code` crate-wide.

## Conventions

- `init()` should be called once, early in `main`/`run`, before any `tracing` macro.
- `missing_docs` is warned via `[lints] workspace = true`, inherited from the
  root `[workspace.lints]`.

> last audited 29-09-26 by docs-auditor
