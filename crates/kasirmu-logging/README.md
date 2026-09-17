# kasirmu-logging

<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings) · fully verified against tree: all 4 init fns present (init, init_json, init_with_file, init_json_with_file) with matching signatures; syslog (Linux) + eventlog (Windows) pub mods present; #![warn(missing_docs)] present; RUST_LOG default info; retention_days cleanup logic present · RE-AUDITED 2026-08-31 by docs-auditor: all 4 init fns + signatures re-confirmed (init_with_file/init_json_with_file take log_dir/file_prefix/retention_days), syslog+eventlog pub mods (lib.rs:31/33), RUST_LOG→info fallback (lib.rs:80), hourly rotation (rolling::hourly lib.rs:206/260), retention_days cleanup; L-1 fix (a53e3eda, 08-30) now retains the tracing_appender WorkerGuard in a process-global registry so file logging actually survives init — the README's "stdout + rolling file" claim is now backed by working code (was aspirational before the fix) -->

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
kasirmu_logging::init_json_with_file("logs", "oz-pos", 30);   // production
```

### Platform modules

| Module | Platform | Output |
|--------|----------|--------|
| `syslog` | Linux | Syslog |
| `eventlog` | Windows | Event Log |

## Conventions

- `init()` should be called once, early in `main`/`run`, before any `tracing` macro.
- `missing_docs` is warned via `[lints] workspace = true`, inherited from the
  root `[workspace.lints]`.

> last audited 31-08-26 by docs-auditor
