---
num: 52
area: settings
title: ADR #52: Tracked Settings Funnel Refuses Cleartext Credentials
status: Accepted (2026-09-12)
---

# ADR #52: Tracked Settings Funnel Refuses Cleartext Credentials

**Status:** Accepted (2026-09-12) · branch `0.0.37`. Landed in `0f26a4b29` (refusal in both tracked accessors
plus five refusal tests); the measurements it rests on are the census test in `5a536af6a` and the
registration of `sync.auth_token` as a credential in `b2196d701`.

## Context

The credential deny list (`keys::SECRET_KEY_DENY_LIST`, predicate `is_secret_setting_key`) was built as
an egress and visibility policy, and its own doc text promises exactly that much: membership means a key
is "never readable through the raw `get_setting` IPC, never replicated to a peer, never packaged"
(`platform/core/src/settings/keys.rs:133`), and the predicate's own doc is a read promise — "a credential
that the raw get_setting IPC surface must never return" (`keys.rs:298`, C-2). The local write was
deliberately left unfiltered: ADR #51 records that encryption binds to the typed setter (`typed.rs:339`),
never to list membership, and filtering the write path would break the lifecycle managers that mint these
very keys. At-rest FORM was, by design, nobody's business but the typed setter's — every guarantee in this
area was about EXIT.

The census test (`crates/oz-core/tests/credential_storage_form.rs`, `5a536af6a`) made the cost of that
premise measurable, and the measurement is bad on every axis it checks:
- Through the funnel, ZERO of the fourteen credential keys land as ciphertext in either table:
  `Settings::set_tracked` writes the value into `settings.value` AND a delta row into
  `setting_updated.value` (`raw.rs:272`), while a later typed-setter save re-encrypts only the live row
  and writes no delta (`a_cleartext_delta_survives_a_later_encrypted_save`) — the cleartext copy survives
  in the ledger indefinitely.
- Classification requires decrypting: `settings.value` is a bare TEXT column with no marker, the only
  shape predicate in the tree (`oz_crypto::looks_like_ciphertext`) is private, and a 44-character base64
  plaintext decoy is indistinguishable from ciphertext without a key
  (`nothing_in_the_stored_form_marks_a_row_as_ciphertext`) — no detection gate was possible.

## Decision

`Settings::set_tracked` and `Settings::set_batch_tracked` now refuse any key answering
`keys::is_secret_setting_key`, excepting one key bound to the keys constant:
`CLEARTEXT_CREDENTIAL_EXCEPTION` = `keys::SMTP_CONFIG`, which both shells legitimately funnel-write after
merging their password JSON. `set_tracked` is the one door all three renderer-reachable funnels pass
through (bridge `run_set_setting`, bridge `run_set_settings_batch`, tablet `run_set_setting`), so with
this change **no renderer-reachable door can store a credential in cleartext.**
- **The refusal is an error, not the ingest policy's warn-and-skip** — `PlatformError::Internal` naming
  the key and never the value (a value in an error string is a leak through the log lane), with the
  message shape of the manager-key guard: the renderer-reachable doors must fail loudly, not quietly
  drop a credential write the operator believes happened.
- **The batch door is guarded by a pre-pass BEFORE any write** — one deny-listed row aborts the whole
  batch, all-or-nothing, because the batch path has been the gap once already; a per-row skip would
  leave the batch door the new front door the single-write guard closed.
- **The exception lives beside the refusal, deliberately not threaded through callers** — a policy that
  exists in three call sites is exactly the one a fourth funnel forgets.
- **Five tests iterate the live `SECRET_KEY_DENY_LIST`** (`raw_tests.rs`), so a deny-list key registered
  concurrently is covered the moment it lands, plus the ordinary-key positive control, the
  `smtp_config` exception, and the batch all-or-nothing refusal.

This is the first time the design says something about at-rest FORM rather than about exit: the deny list
remains an egress list everywhere else; this decision gives its predicate a write face at exactly one
accessor, the renderer-reachable one, while leaving trusted writers alone.

## Consequences

- A credential the UI or a bridge lane tries to save through the tracked funnel now FAILS the save
  instead of persisting cleartext; a caller using the funnel as a generic setter for a credential key
  must move to the typed setter (which encrypts) or stop writing the key.
- `sync.auth_token` (`b2196d701`) is now registered, denied on read, refused on both untrusted egress
  lanes, and refused on write — the full perimeter for that key.
- New deny-list keys inherit the refusal automatically; the tests bind to the live list, not a snapshot copy.

## What this does not do

- **It does not make no code able to store a credential in cleartext.** `Settings::set`, `set_batch`,
  `Store::set_setting`, the cloud route and the CLI door all still write what they are handed — trusted
  writers stay unfiltered on purpose, because the lifecycle managers mint these keys.
- **It does not erase existing cleartext** in either `settings.value` or the `setting_updated` ledger;
  rows already written stay until a migration or a rewrite touches them, and the ledger copy survives
  the typed-setter rewrite (see Context).
- **It does not reach the whole-file backup.** `Store::backup` is a page copy that consults no policy;
  the CLI README already says the `.db` and `.backup.db` files remain the plaintext carrier.
- **It does not reach the per-pull snapshot pile** — separately bounded at `24436557c` and scoped per
  store at `c37fa5a74`.

## Open item

The settings screen still posts `sync.auth_token` at `ui/src/features/settings/SettingsPage.tsx:479`
through a best-effort catch that swallows the new error, so the write is now a silent no-op against dead
UI. Deleting the mirror is parked: the working tree has been typecheck-red since Sep 11 (another
session's half-finished WorkspaceHome extraction) and the pre-commit typecheck gate reads the working
tree, so an honest ui commit cannot land from this worktree until that file is clean.

Nothing above is verified end to end; every claim traces to a named file or one of the four commits.
