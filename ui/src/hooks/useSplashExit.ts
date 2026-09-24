import { useState, useEffect, useRef } from 'react';
import { animDuration } from '@/utils/animation';

const MS_200 = 200;

export interface UseSplashExitResult {
  splashMounted: boolean;
  splashExiting: boolean;
}

/**
 * Manages the graceful crossfade exit of the AppBootSplash loading screen (T3).
 *
 * When `loading` flips from `true` to `false`, keeps the splash mounted for
 * the duration of the CSS fade-out animation (200ms, or 0ms under reduced-motion).
 * During the fade, `splashExiting` is true so `.app-splash--exiting` runs its
 * fade-out keyframe with `pointer-events: none`, revealing the active shell underneath.
 */
export function useSplashExit(loading: boolean): UseSplashExitResult {
  const [splashMounted, setSplashMounted] = useState(loading);
  const [splashExiting, setSplashExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (loading) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setSplashExiting(false);
      setSplashMounted(true);
    } else if (splashMounted) {
      setSplashExiting(true);
      timerRef.current = setTimeout(() => {
        setSplashMounted(false);
        setSplashExiting(false);
        timerRef.current = null;
      }, animDuration(MS_200));
    }
  }, [loading, splashMounted]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return { splashMounted, splashExiting };
}
