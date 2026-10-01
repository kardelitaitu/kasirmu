/** Named interaction events that can trigger sound and vibration feedback. */
export type InteractionName =
  | 'add-to-cart'
  | 'qty-change'
  | 'remove-item'
  | 'undo-cart'
  | 'pay'
  | 'open-bill';

interface InteractionConfig {
  sound: string;
  vibrate: boolean;
}

const INTERACTIONS: Record<InteractionName, InteractionConfig> = {
  'add-to-cart': { sound: 'click.mp3', vibrate: false },
  'qty-change':  { sound: 'click.mp3', vibrate: false },
  'remove-item': { sound: 'click.mp3', vibrate: false },
  'undo-cart':   { sound: 'click.mp3', vibrate: false },
  'pay':         { sound: 'click.mp3', vibrate: false },
  'open-bill':   { sound: 'click.mp3', vibrate: false },
};

const audioCache = new Map<string, HTMLAudioElement>();

function getAudio(filename: string): HTMLAudioElement | null {
  const cached = audioCache.get(filename);
  if (cached) return cached;
  try {
    const url = new URL(`../assets/sounds/${filename}`, import.meta.url).href;
    const audio = new Audio(url);
    audio.volume = 0.25;
    audioCache.set(filename, audio);
    return audio;
  } catch {
    return null;
  }
}

/** Check if interaction sound is enabled */
export function isInteractionSoundEnabled(): boolean {
  try {
    const val = localStorage.getItem('pos.interaction_sound');
    if (val !== null) return val === 'true';
  } catch {
    /* ignore storage errors */
  }
  return true;
}

/** Check if interaction vibration is enabled */
export function isInteractionVibrationEnabled(): boolean {
  try {
    const val = localStorage.getItem('pos.interaction_vibration');
    if (val !== null) return val === 'true';
  } catch {
    /* ignore storage errors */
  }
  return true;
}

/** Set interaction sound preference */
export function setInteractionSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem('pos.interaction_sound', String(enabled));
  } catch {
    /* ignore storage errors */
  }
}

/** Set interaction vibration preference */
export function setInteractionVibrationEnabled(enabled: boolean): void {
  try {
    localStorage.setItem('pos.interaction_vibration', String(enabled));
  } catch {
    /* ignore storage errors */
  }
}

/** Play the configured sound and (optionally) vibrate for the given interaction. */
export function triggerInteraction(name: InteractionName): void {
  const config = INTERACTIONS[name];
  if (!config) return;

  if (isInteractionSoundEnabled()) {
    const audio = getAudio(config.sound);
    if (audio) {
      audio.currentTime = 0;
      try {
        const p = audio.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {});
        }
      } catch {
        // Ignore audio play errors in restricted environments
      }
    }
  }

  if (isInteractionVibrationEnabled() && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(15);
    } catch {
      // Ignored if platform restricts vibration
    }
  }
}

