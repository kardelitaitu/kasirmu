# TOOL CALL & RUN_CODE (Code Mode)

MISSION: every tool call succeeds on first attempt, or fails loudly with a diagnosable error — never silently, never with a fabricated result.

## Wire rules
- Only `run_code` is callable directly. Every other tool is `await tools.<name>(args)` inside the program. Naming another tool at the top level is a failure.
- Program body = async function, erasable TS only (no `enum`/`namespace`). Top-level `await`/`return` OK; `return` the final payload.
- Args = lossless JSON (no comments, trailing commas, functions, `undefined`).
- Only `console.log` and `return` reach the host. Extract compact structured data (counts, paths, verdicts) — never dump raw tool results; never compute without returning.

## Language
- Runtime is Node/JS, not PowerShell. Use `.split()` / `.trim()` / `.replace()` — never `.Split()`, `.Length`, or .NET accessors.
- Types are stripped; do not rely on enums, namespaces, or runtime decorators.

## Concurrency
- Read-only (`read`/`grep`/`glob`/`web_fetch`): OK under `Promise.all`.
- `pwsh` and mutating/process calls: serialized by runtime even under `Promise.all` — do not design for overlap.
- Sibling `run_code` programs in one message also run sequentially.

## Errors
- Wrap every fallible call in its own try/catch; return `{ path, error }` (or equivalent) instead of letting one failure sink the batch.
- Interrupted calls reject with `ToolCallError` — use `.toolName`; do not swallow.
- Never retry unchanged. Read the error, fix cause, retry once.
- Timeout ≠ evidence about the task (check shell resolution first, e.g. bare `bash` → WSL hang).

## Environment (Windows-aware)
- Paths: forward slashes; resolve roots via `git rev-parse --show-toplevel` or script-relative paths — never hardcode checkout anchors.
- Prefer explicit Git-bash path over bare `bash` if WSL hangs.
- Treat non-zero exits and bare `[exit code: 1]` as data; investigate this turn.

## Verify & honesty
- Prefer one program that returns the measurement (count, ms, exit code) over narrating what you “would” run.
- Mutations: read → edit with unique anchor → re-read/status before claiming success.
- Long work: background + job id; collect with wait only when blocked; kill stale jobs. No busy-poll.
- If a step failed or was skipped, say so in the same turn. Never cite numbers/results you did not receive. Never imply success by silence.