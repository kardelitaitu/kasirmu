// ── kdsSettingsModel tests ─────────────────────────────────────────
//
// Model contract for the KDS settings, salvaged from the retired
// KdsSettingsPanel component suite (todo-kds-agents-6). Assertions that
// drove the unreachable component (gear button, portal open/close,
// switches, sliders, density buttons) died with it; the value/shape
// contract those tests pinned — defaults identity, field set, and the
// invariants the panel UI enforced by construction — survives here, so
// the live consumers (KdsScreen state, KdsHamburgerPanel editing) cannot
// drift silently.

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS,
  type KdsSettings,
  type DisplayDensity,
} from '@/features/kds/kdsSettingsModel';

describe('kdsSettingsModel', () => {
  describe('DEFAULT_SETTINGS', () => {
    it('carries exactly the five documented fields', () => {
      // A sixth field appearing here silently changes what KdsScreen seeds
      // and what KdsHamburgerPanel must render controls for.
      expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual([
        'autoAcknowledge',
        'density',
        'redThresholdMin',
        'soundEnabled',
        'yellowThresholdMin',
      ]);
    });

    it('defaults to sound on, yellow 5 min, red 10 min, auto-accept off, 3 columns', () => {
      // Was asserted through the panel (checked switch, slider values,
      // pressed density button); as model data it needs no renderer.
      expect(DEFAULT_SETTINGS.soundEnabled).toBe(true);
      expect(DEFAULT_SETTINGS.yellowThresholdMin).toBe(5);
      expect(DEFAULT_SETTINGS.redThresholdMin).toBe(10);
      expect(DEFAULT_SETTINGS.autoAcknowledge).toBe(false);
      expect(DEFAULT_SETTINGS.density).toBe(3);
    });

    it('keeps the escalation ladder ordered: red threshold above yellow', () => {
      // The panel enforced red min = max(yellow + 1, 6) via the slider
      // floor; the underlying invariant — a ticket can only turn red
      // later than yellow — is a model property the defaults must satisfy.
      expect(DEFAULT_SETTINGS.redThresholdMin).toBeGreaterThan(
        DEFAULT_SETTINGS.yellowThresholdMin,
      );
    });

    it('keeps density inside the documented 1–5 column range', () => {
      // The panel rendered exactly buttons 1–5; density outside that
      // range has no UI and no column layout.
      const density: DisplayDensity = DEFAULT_SETTINGS.density;
      expect(Number.isInteger(density)).toBe(true);
      expect(density).toBeGreaterThanOrEqual(1);
      expect(density).toBeLessThanOrEqual(5);
    });
  });

  describe('KdsSettings shape', () => {
    it('accepts a defaults spread with single-field overrides', () => {
      // The exact usage pattern of both consumers: { ...DEFAULT_SETTINGS, x }.
      const settings: KdsSettings = { ...DEFAULT_SETTINGS, soundEnabled: false };
      expect(settings).toEqual({
        soundEnabled: false,
        yellowThresholdMin: 5,
        redThresholdMin: 10,
        autoAcknowledge: false,
        density: 3,
      });
    });
  });
});
