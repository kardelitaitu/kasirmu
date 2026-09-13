# Orchestrator Agent 5: Device-Keyed Offline Replay for LAN KDS Sync

**Document:** `todo-kds-agents-5.md`
**Role:** Orchestrator Agent 5 (Multi-Terminal Resilience Architect)
**Goal:** Make reconnect replay actually work for real tablets. Found and stamped by Agent 4's live validation (`0302039258`, `done-todo-kds-agents-2.md` follow-up section).

## The problem (evidence, not theory)
`crates/oz-lan` buffers events for a peer whose socket write fails, keyed by the **ephemeral TCP peer address (ip:port)**. A real KDS tablet that drops and reconnects gets a NEW source port — so the buffer under the dead address is never found and replay is effectively dead in production. Agent 4's tests only see replay by rebinding the exact local port. Meanwhile `device_id` is ALREADY on the wire: hello/discover carry serde-default `station_ids` + `device_id` (kds-sync), parsed into `PeerSubscription`.

## Task
1. Key the per-peer offline buffer by `device_id` when the subscription has one; keep `peer_addr` keying as the legacy path for device-less (pre-kds-sync) peers. Both paths tested.
2. When a hello/discover presents a `device_id` that has a pending buffer from a DIFFERENT address: drain it, replay through the same station filter, attach the new address, log the handoff.
3. Bounded retention: per-device cap + total cap (drop-oldest + `tracing::warn!`); no unbounded memory.

## Verification
- New `cargo test -p oz-lan` covering: reconnect-on-new-port gets its buffered events; legacy no-device peer unchanged; filter respected on device-keyed replay; cap drops oldest.
- Existing suite green: `cargo test -p oz-lan` (63+1 baseline), `cargo test -p oz-pos-app kds_lan_live` (5/5), `--lib registration` 12/12, `--lib state` 13/13.

## Fence & law
`crates/oz-lan/**` ONLY (lib.rs + kds_sync.rs + their test files) + this doc. NO desktop-client, NO bridge, NO `ui/**`. Wire format frozen — no serialization changes. `feat(kds-lan):` subjects; one-line pathspec commits; new files via the sanctioned add-chain; per-file `rustfmt --edition 2024` ONLY (the hook no longer runs cargo fmt; NEVER --all/-p). No clippy mid-run, no push/branch/stash/amend. Stamp honestly, then rename this doc → `done-todo-kds-agents-5.md`.
