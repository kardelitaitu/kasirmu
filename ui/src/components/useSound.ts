import { useCallback } from 'react';

let audioCtx: AudioContext | null = null;

// Module-level mute state shared by EVERY useSound() instance. The mute
// toggle must silence all sound paths app-wide (POS beeps, KDS SLA
// escalation alerts, TTS callouts) — a per-instance ref previously let a
// muted kitchen keep receiving red-escalation sirens because each card's
// hook instance had its own enabled flag.
let soundEnabled = true;

function getAudioCtx(): AudioContext | null {
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Hook that provides sound-effect playback functions (beep, error,
 * success, alert) using the Web Audio API. Each callback synthesises
 * a short tone — no audio files required. Respects the `setSoundEnabled`
 * mute toggle, which is GLOBAL: muting in any one instance (e.g. the
 * retail sound toggle or the KDS settings panel) silences every instance.
 */
export function useSound() {
  const setEnabled = useCallback((v: boolean) => {
    soundEnabled = v;
  }, []);

  const playBeep = useCallback(() => {
    if (!soundEnabled) return;
    const ctx = getAudioCtx();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.value = 0.25;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.stop(ctx.currentTime + 0.12);
    } catch { /* ignore */ }
  }, []);

  const playError = useCallback(() => {
    if (!soundEnabled) return;
    const ctx = getAudioCtx();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 180;
      osc.type = 'sawtooth';
      gain.gain.value = 0.2;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.stop(ctx.currentTime + 0.35);
    } catch { /* ignore */ }
  }, []);

  const playSuccess = useCallback(() => {
    if (!soundEnabled) return;
    const ctx = getAudioCtx();
    if (!ctx) return;
    try {
      const notes = [523, 659, 784];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.1 + 0.25);
        osc.start(ctx.currentTime + i * 0.1);
        osc.stop(ctx.currentTime + i * 0.1 + 0.3);
      });
    } catch { /* ignore */ }
  }, []);

  const playAlert = useCallback(() => {
    if (!soundEnabled) return;
    const ctx = getAudioCtx();
    if (!ctx) return;
    try {
      // Three ascending pulses: 523Hz → 659Hz → 784Hz (C5 → E5 → G5)
      [523, 659, 784].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = 'square';
        gain.gain.setValueAtTime(0.18, ctx.currentTime + i * 0.18);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.15);
        osc.start(ctx.currentTime + i * 0.18);
        osc.stop(ctx.currentTime + i * 0.18 + 0.2);
      });
    } catch { /* ignore */ }
  }, []);

  const speak = useCallback((text: string) => {
    if (!soundEnabled || typeof window === 'undefined' || !window.speechSynthesis) return;
    try {
      // Cancel any ongoing speech to avoid overlapping announcements.
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.9;
      utterance.pitch = 1.1;
      utterance.volume = 0.8;
      window.speechSynthesis.speak(utterance);
    } catch { /* ignore */ }
  }, []);

  return { playBeep, playError, playSuccess, playAlert, speak, setSoundEnabled: setEnabled };
}
