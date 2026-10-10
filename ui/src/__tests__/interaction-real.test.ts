import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  INTERACTION_SOUND_KEY,
  INTERACTION_VIBRATION_KEY,
  isInteractionSoundEnabled,
  isInteractionVibrationEnabled,
  setInteractionSoundEnabled,
  setInteractionVibrationEnabled,
  triggerInteraction,
} from '@/utils/interaction';

describe('interaction utilities (real implementation)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('pins the storage keys the runtime reads', () => {
    // These literals are the CONTRACT: the POS runtime reads them, and
    // `storageKeyPins.test.ts` pins the same pair. Asserting the constants against
    // the literals (rather than using one for both) is what makes a rename fail
    // here — a test that wrote and read through the same constant would move both
    // sides together and stay green while every device's saved preference was
    // orphaned.
    expect(INTERACTION_SOUND_KEY).toBe('pos.interaction_sound');
    expect(INTERACTION_VIBRATION_KEY).toBe('pos.interaction_vibration');
  });

  it('defaults sound and vibration to enabled', () => {
    expect(isInteractionSoundEnabled()).toBe(true);
    expect(isInteractionVibrationEnabled()).toBe(true);
  });

  it('updates sound preference via setInteractionSoundEnabled and reads from localStorage', () => {
    setInteractionSoundEnabled(false);
    expect(isInteractionSoundEnabled()).toBe(false);
    expect(localStorage.getItem('pos.interaction_sound')).toBe('false');

    setInteractionSoundEnabled(true);
    expect(isInteractionSoundEnabled()).toBe(true);
    expect(localStorage.getItem('pos.interaction_sound')).toBe('true');
  });

  it('updates vibration preference via setInteractionVibrationEnabled and reads from localStorage', () => {
    setInteractionVibrationEnabled(false);
    expect(isInteractionVibrationEnabled()).toBe(false);
    expect(localStorage.getItem('pos.interaction_vibration')).toBe('false');

    setInteractionVibrationEnabled(true);
    expect(isInteractionVibrationEnabled()).toBe(true);
    expect(localStorage.getItem('pos.interaction_vibration')).toBe('true');
  });

  it('vibrates device when vibration is enabled and navigator.vibrate is available', () => {
    const mockVibrate = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, vibrate: mockVibrate });

    setInteractionVibrationEnabled(true);
    triggerInteraction('add-to-cart');
    expect(mockVibrate).toHaveBeenCalledWith(15);

    mockVibrate.mockClear();
    setInteractionVibrationEnabled(false);
    triggerInteraction('add-to-cart');
    expect(mockVibrate).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
