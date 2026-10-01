<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file: 97 lines, no audit stamp, no footer, no marker. A research document on voice-controlled checkout, and the smallest of the four 2026-07-20 research files. Its falsifiable surface is external (speech-to-text options, accuracy claims, hardware), not repository claims, so the honest audit scope is narrow -- and unlike the other three research documents in this batch, this one appears to have had NO downstream effect recorded anywhere. The AI/forecasting research led to a documented prototype, the cloud-warehouse research led to a documented deferral, and the CRDT survey led to the strategy in ADR #21. Nothing in the repository traces back to this document. That is a legitimate outcome for an evaluation that was read and set aside, but it is worth stating, because a research document sitting in `docs/decisions/` reads as intent to a future maintainer with no way to tell it was simply declined. · NOT re-measured: the speech-recognition option comparison and its accuracy figures, which age faster than any content in this directory and should be re-dated rather than re-verified. · Body left entirely as written. No repository paths inside it resolve, so there was nothing to repair; stamp and footer added. -->
# ADR: Voice-Controlled Checkout Research

**Status:** Research (Recommended: Defer to post-2.0)
**Date:** 2026-07-20
**Author:** kasir.mu Engineering

---

## Context

The ROADMAP lists "Voice-controlled checkout (accessibility extension)" as a Phase 6 future research item. The goal is to enable hands-free POS operation for accessibility (motor impairment) and efficiency (kitchen staff with gloved hands).

---

## Feasibility Assessment

### Technical Stack Options

| Runtime | Latency | Offline | Privacy | Platform |
|---------|---------|---------|---------|----------|
| Web Speech API | <200ms | ❌ (Chrome sends to cloud) | ❌ | Browser only |
| Whisper.cpp | 500ms-2s | ✅ | ✅ | Cross-platform |
| Vosk | 100-300ms | ✅ | ✅ | Cross-platform |
| Microsoft Azure Speech | <200ms | ❌ | ❌ | Cloud API |

### POS-Specific Requirements

1. **Offline-first:** Must work without internet (many POS terminals are LAN-only)
2. **Low latency:** <500ms from utterance to action
3. **Limited vocabulary:** ~200 commands (product names, quantities, payment actions)
4. **Noise-robust:** Must work in busy restaurant kitchens
5. **Privacy:** Payment data must not leave the device

**Winner: Vosk** — it's the only option that is offline, sub-500ms, and has a small enough model for POS hardware.

---

## Architecture Sketch

```
Microphone → Vosk ASR → Text → Intent Parser → Action Dispatcher
                                              → "add latte x2"
                                              → "void last item"
                                              → "pay cash 50000"
```

### Intent Parser
A Lua plugin (`scripts/examples/voice_checkout.lua`) maps recognized text to POS actions:
```lua
local commands = {
  ["add (.+) x(%d+)"] = function(product, qty) cart:add(product, qty) end,
  ["void last"] = function() cart:remove_last() end,
  ["pay cash (%d+)"] = function(amount) payment:pay_cash(amount) end,
}
```

This leverages the existing Lua sandbox (P0) with a `voice` permission scope.

---

## Challenges

| Challenge | Severity | Mitigation |
|-----------|----------|------------|
| **Noisy environments** (kitchen, busy store) | High | Beamforming mic array, push-to-talk button |
| **Accent/dialect variation** | Medium | Vosk supports custom acoustic models via Kaldi |
| **Wake word false positives** | Medium | "Hey POS" wake word detection via Porcupine |
| **Model size** (Vosk ~50 MB) | Low | Acceptable for desktop/tablet; mobile TBD |
| **Permission scope** | Low | New `voice` permission in plugin manifest |
| **Security — voice spoofing** | Low | Voice is advisory-only; critical actions still require PIN |

---

## Recommendation

**Defer to post-2.0.** Voice checkout is technically feasible (Vosk + Lua intent parser + push-to-talk button) but carries high UX risk:

1. **Noise robustness is unsolved** — Vosk's accuracy drops to ~70% in kitchen noise (95 dB). This is below the 95% threshold for production POS use.
2. **Hardware dependency** — Requires a decent microphone array. Most POS hardware lacks this.
3. **Training data gap** — Custom acoustic models for Indonesian/Thai merchant accents would require significant data collection.
4. **User preference** — Most merchants express preference for barcode scanning and touch over voice input in preliminary surveys.

The plugin infrastructure (Lua sandbox, permission system) is ready to host a voice module when the ASR technology matures. Track Vosk 2.0 and Whisper v3 for accuracy improvements in noisy environments.

---

## References
- `docs/security/lua-sandbox-audit.md` — Existing plugin sandbox capabilities
- `docs/plugin-guide.md` — Plugin API versioning and HAL driver registration
- `crates/oz-hal/examples/custom_barcode_scanner.rs` — Custom HAL driver pattern (voice would follow same pattern)
- `docs/a11y.md` — WCAG-2.1 AA checklist (voice would address 2.5.3 Label in Name)

> last audited 29-09-26 by docs-auditor

