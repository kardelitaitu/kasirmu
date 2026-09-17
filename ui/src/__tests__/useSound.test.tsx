/**
 * Tests for `useSound` — Web Audio API sound effects and speech synthesis.
 *
 * The hook synthesises short tones via the AudioContext API and reads
 * announcements via SpeechSynthesis. Both APIs are DOM-global singletons
 * that must be mocked so the tests run in any environment (jsdom, CI, etc.)
 * without producing audible output. The mute toggle (`setSoundEnabled`) and
 * the try/catch guards around every API call are the primary bug-prevention
 * targets.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { useSound as UseSoundHook } from '@/components/useSound';

/**
 * `useSound` holds a module-level `audioCtx` singleton, so each test must
 * get a FRESH module instance — otherwise the context created by an earlier
 * test is reused and later assertions observe stale mock objects. The hook
 * is re-imported after `vi.resetModules()` in `beforeEach`, and the rebound
 * `useSound` reference is what each test's `renderHook` closes over.
 */
let useSound: typeof UseSoundHook;

/* ── Web Audio API mocks ──────────────────────────────────────────── */

/** Reset the module-level AudioContext singleton so each test starts fresh. */
let mockAudioCtx: ReturnType<typeof createMockCtx>;

function createMockCtx() {
  const osc = {
    connect: vi.fn(),
    frequency: { value: 0 },
    type: '',
    start: vi.fn(),
    stop: vi.fn(),
  };
  const gain = {
    connect: vi.fn(),
    gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
  };
  return {
    createOscillator: vi.fn(() => ({ ...osc, frequency: { value: 0 }, start: vi.fn(), stop: vi.fn() })),
    createGain: vi.fn(() => ({ ...gain, gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } })),
    destination: 'mock-destination',
    state: 'running',
    resume: vi.fn(),
  };
}

let mockAudioCtor: ReturnType<typeof vi.fn>;

/* ── SpeechSynthesis mocks ────────────────────────────────────────── */

let mockSpeak: ReturnType<typeof vi.fn>;
let mockCancel: ReturnType<typeof vi.fn>;
let mockUtteranceCtor: ReturnType<typeof vi.fn>;

/* ── Setup / teardown ─────────────────────────────────────────────── */

beforeEach(async () => {
  vi.resetModules();

  // Fresh AudioContext mock. The constructor mock MUST be a regular function
  // (not an arrow) — the hook calls `new AudioContext()`, and arrows are not
  // constructable ("is not a constructor").
  mockAudioCtx = createMockCtx();
  mockAudioCtor = vi.fn(function () { return mockAudioCtx; });
  Object.defineProperty(window, 'AudioContext', {
    value: mockAudioCtor,
    configurable: true,
    writable: true,
  });

  // Fresh SpeechSynthesis mock. Same constructability rule for the utterance
  // constructor: the hook calls `new SpeechSynthesisUtterance(text)`.
  mockSpeak = vi.fn();
  mockCancel = vi.fn();
  mockUtteranceCtor = vi.fn(function (text: string) { return { text }; });
  Object.defineProperty(window, 'speechSynthesis', {
    value: { speak: mockSpeak, cancel: mockCancel },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    value: mockUtteranceCtor,
    configurable: true,
    writable: true,
  });

  // Re-import the hook after the module reset so its `audioCtx` singleton
  // starts null.
  ({ useSound } = await import('@/components/useSound'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ── Helpers ──────────────────────────────────────────────────────── */

function renderSound() {
  return renderHook(() => useSound());
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe('useSound', () => {
  /* ── API shape ─────────────────────────────────────────────────── */

  it('returns the expected API surface', () => {
    const { result } = renderSound();
    expect(result.current).toHaveProperty('playBeep');
    expect(result.current).toHaveProperty('playError');
    expect(result.current).toHaveProperty('playSuccess');
    expect(result.current).toHaveProperty('playAlert');
    expect(result.current).toHaveProperty('speak');
    expect(result.current).toHaveProperty('setSoundEnabled');
    expect(typeof result.current.playBeep).toBe('function');
  });

  /* ── Mute toggle ───────────────────────────────────────────────── */

  it('does not play when sound is disabled', () => {
    const { result } = renderSound();
    act(() => { result.current.setSoundEnabled(false); });
    act(() => { result.current.playBeep(); });
    expect(mockAudioCtx.createOscillator).not.toHaveBeenCalled();
  });

  it('does not speak when sound is disabled', () => {
    const { result } = renderSound();
    act(() => { result.current.setSoundEnabled(false); });
    act(() => { result.current.speak('hello'); });
    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it('plays again after re-enabling sound', () => {
    const { result } = renderSound();
    act(() => { result.current.setSoundEnabled(false); });
    act(() => { result.current.setSoundEnabled(true); });
    act(() => { result.current.playBeep(); });
    expect(mockAudioCtx.createOscillator).toHaveBeenCalled();
  });

  /* ── AudioContext lifecycle ────────────────────────────────────── */

  it('creates an AudioContext lazily on first play', () => {
    const { result } = renderSound();
    expect(mockAudioCtor).not.toHaveBeenCalled();
    act(() => { result.current.playBeep(); });
    expect(mockAudioCtor).toHaveBeenCalledTimes(1);
  });

  it('reuses the same AudioContext across calls (singleton)', () => {
    const { result } = renderSound();
    act(() => { result.current.playBeep(); });
    act(() => { result.current.playError(); });
    act(() => { result.current.playSuccess(); });
    expect(mockAudioCtor).toHaveBeenCalledTimes(1);
  });

  it('resumes a suspended AudioContext', () => {
    mockAudioCtx.state = 'suspended';
    const { result } = renderSound();
    act(() => { result.current.playBeep(); });
    expect(mockAudioCtx.resume).toHaveBeenCalled();
  });

  it('does not crash when AudioContext constructor throws', () => {
    mockAudioCtor = vi.fn(function () { throw new Error('audio not supported'); });
    Object.defineProperty(window, 'AudioContext', {
      value: mockAudioCtor,
      configurable: true,
      writable: true,
    });
    const { result } = renderSound();
    expect(() => {
      act(() => { result.current.playBeep(); });
    }).not.toThrow();
  });

  /* ── playBeep ──────────────────────────────────────────────────── */

  it('playBeep creates a sine oscillator at 880 Hz with gain 0.25', () => {
    const { result } = renderSound();
    act(() => { result.current.playBeep(); });
    // First oscillator from the mock.
    const osc = mockAudioCtx.createOscillator.mock.results[0]?.value;
    expect(osc).toBeDefined();
    expect(osc.frequency.value).toBe(880);
    expect(osc.type).toBe('sine');
    const gain = mockAudioCtx.createGain.mock.results[0]?.value;
    expect(gain.gain.value).toBe(0.25);
  });

  /* ── playError ─────────────────────────────────────────────────── */

  it('playError creates a sawtooth oscillator at 180 Hz with gain 0.2', () => {
    const { result } = renderSound();
    act(() => { result.current.playError(); });
    const osc = mockAudioCtx.createOscillator.mock.results[0]?.value;
    expect(osc.frequency.value).toBe(180);
    expect(osc.type).toBe('sawtooth');
    const gain = mockAudioCtx.createGain.mock.results[0]?.value;
    expect(gain.gain.value).toBe(0.2);
  });

  /* ── playSuccess ───────────────────────────────────────────────── */

  it('playSuccess plays three ascending notes (C5, E5, G5)', () => {
    const { result } = renderSound();
    act(() => { result.current.playSuccess(); });
    // Three oscillators for the three notes.
    expect(mockAudioCtx.createOscillator).toHaveBeenCalledTimes(3);
    const freqs = mockAudioCtx.createOscillator.mock.results.map((r) => r.value.frequency.value);
    expect(freqs).toEqual([523, 659, 784]);
    // Each oscillator uses a sine wave.
    const types = mockAudioCtx.createOscillator.mock.results.map((r) => r.value.type);
    expect(types).toEqual(['sine', 'sine', 'sine']);
  });

  /* ── playAlert ─────────────────────────────────────────────────── */

  it('playAlert plays three ascending square-wave pulses (C5, E5, G5)', () => {
    const { result } = renderSound();
    act(() => { result.current.playAlert(); });
    expect(mockAudioCtx.createOscillator).toHaveBeenCalledTimes(3);
    const freqs = mockAudioCtx.createOscillator.mock.results.map((r) => r.value.frequency.value);
    expect(freqs).toEqual([523, 659, 784]);
    // Alert uses square waves.
    const types = mockAudioCtx.createOscillator.mock.results.map((r) => r.value.type);
    expect(types).toEqual(['square', 'square', 'square']);
  });

  /* ── speak ─────────────────────────────────────────────────────── */

  it('speak creates a SpeechSynthesisUtterance with the given text', () => {
    const { result } = renderSound();
    act(() => { result.current.speak('Hello World'); });
    expect(mockUtteranceCtor).toHaveBeenCalledWith('Hello World');
  });

  it('speak sets rate, pitch, and volume on the utterance', () => {
    const { result } = renderSound();
    act(() => { result.current.speak('test'); });
    const utterance = mockUtteranceCtor.mock.results[0]?.value;
    expect(utterance.rate).toBe(0.9);
    expect(utterance.pitch).toBe(1.1);
    expect(utterance.volume).toBe(0.8);
  });

  it('speak cancels any ongoing speech before speaking', () => {
    const { result } = renderSound();
    act(() => { result.current.speak('Hello'); });
    expect(mockCancel).toHaveBeenCalled();
    expect(mockSpeak).toHaveBeenCalled();
    // Cancel is called before Speak.
    expect(mockCancel.mock.invocationCallOrder[0]).toBeLessThan(
      mockSpeak.mock.invocationCallOrder[0]!,
    );
  });

  it('speak does not throw when speechSynthesis is unavailable', () => {
    Object.defineProperty(window, 'speechSynthesis', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const { result } = renderSound();
    expect(() => {
      act(() => { result.current.speak('Hello'); });
    }).not.toThrow();
  });

  it('speak does not throw when SpeechSynthesisUtterance constructor throws', () => {
    mockUtteranceCtor = vi.fn(function () { throw new Error('synthesis unavailable'); });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: mockUtteranceCtor,
      configurable: true,
      writable: true,
    });
    const { result } = renderSound();
    expect(() => {
      act(() => { result.current.speak('Hello'); });
    }).not.toThrow();
  });

  /* ── Error resilience ──────────────────────────────────────────── */

  it('playBeep does not throw when createOscillator throws', () => {
    mockAudioCtx.createOscillator = vi.fn(() => { throw new Error('osc error'); });
    const { result } = renderSound();
    act(() => { result.current.setSoundEnabled(true); });
    expect(() => {
      act(() => { result.current.playBeep(); });
    }).not.toThrow();
  });

  it('playBeep does not throw when createGain throws', () => {
    mockAudioCtx.createGain = vi.fn(() => { throw new Error('gain error'); });
    const { result } = renderSound();
    expect(() => {
      act(() => { result.current.playBeep(); });
    }).not.toThrow();
  });
});