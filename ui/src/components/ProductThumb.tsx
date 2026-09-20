//! ProductThumb — renders a product image via the Tauri asset protocol,
//! falling back to a coloured-initial tile when no image is available.
//!
//! The image hash is the content-addressed filename (`{hash16}.webp`) in the
//! app cache directory (`$APPCACHE/images/`). The component resolves the
//! cache dir once and converts the filesystem path to an asset-protocol URL
//! via `convertFileSrc`, so the Android WebView streams the file from disk
//! without bloating the IPC bridge.
//!
//! In the dev-mock (non-Tauri context) the hash is ignored and the fallback
//! tile is shown — the dev server has no real images to serve.
//!
//! Do NOT reintroduce an `isMounted` ref here. `ui/src/main.tsx` enables
//! `React.StrictMode`, whose dev double-invoke runs a mount effect's cleanup
//! once immediately; a ref set to `false` by that cleanup and never restored
//! leaves every later `.then()` early-returning, so `imgSrc` is never assigned
//! and the tile silently renders the initials fallback for good. The
//! per-effect `cancelled` flag below is sufficient — it covers unmount and
//! dependency change without any cross-effect state.

import { useState, useEffect } from 'react';
import { convertFileSrc } from '@/api/tauri';
import { getAppCacheDir } from '@/api/cache';

// ── Cache-dir resolution (lazy, once) ───────────────────────────────

let _cacheDir: string | null = null;
let _cacheDirPromise: Promise<string | null> | null = null;

async function resolveCacheDir(): Promise<string | null> {
  if (_cacheDir !== null) return _cacheDir;
  if (_cacheDirPromise !== null) return _cacheDirPromise;

  _cacheDirPromise = getAppCacheDir().then((dir) => {
    _cacheDir = dir;
    return dir;
  });

  return _cacheDirPromise;
}

// ── ProductThumb component ──────────────────────────────────────────

export interface ProductThumbProps {
  /** Content-addressed hash (16 hex chars) or null/undefined for no image. */
  hash?: string | null;
  /** Product display name — used for alt text and the fallback initial letter. */
  name: string;
  /** Optional CSS class for the wrapper element. */
  className?: string;
  /** Tile size in pixels (default 64). */
  size?: number;
  /** Whether to lazy-load the image (default true). */
  lazy?: boolean;
  /** Hue for the fallback colour (0-360), derived from category or product. */
  hue?: number;
  /**
   * Corner treatment. `square` (default) is the product-grid tile; `circle` is
   * the avatar treatment. The radius is set inline below, so a caller cannot
   * override it from a stylesheet — it has to be a prop.
   */
  shape?: 'square' | 'circle';
}

export function ProductThumb({
  hash,
  name,
  className = '',
  size = 64,
  lazy = true,
  hue = 0,
  shape = 'square',
}: ProductThumbProps) {
  const radius = shape === 'circle' ? 'var(--radius-full, 9999px)' : 'var(--radius-sm, 4px)';
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    // A new hash is a new file, so the previous attempt's failure must be
    // cleared. Resetting it only on the `!hash` branch (as this once did) means
    // one failed load keeps `loadError` true forever: with it set, no <img> is
    // mounted at all, so no later hash can ever attempt a load and the tile is
    // pinned to the initials fallback for the component's whole life.
    setLoadError(false);

    if (!hash) {
      setImgSrc(null);
      return;
    }

    let cancelled = false;

    resolveCacheDir().then((cacheDir) => {
      if (cancelled) return;
      if (!cacheDir) {
        // Can't resolve cache dir (dev-mock, test) — show fallback.
        setImgSrc(null);
        return;
      }
      const filePath = `${cacheDir}/images/${hash}.webp`;
      setImgSrc(convertFileSrc(filePath));
    });

    return () => { cancelled = true; };
  }, [hash]);

  if (imgSrc && !loadError) {
    return (
      <img
        className={className}
        src={imgSrc}
        alt={name}
        width={size}
        height={size}
        loading={lazy ? 'lazy' : undefined}
        decoding="async"
        onError={() => setLoadError(true)}
        style={{ objectFit: 'cover', borderRadius: radius }}
      />
    );
  }

  // Fallback: coloured-initial tile
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const bgColor = `hsl(${hue}, 45%, 55%)`;

  return (
    <div
      className={className}
      role="img"
      aria-label={name}
      style={{
        width: size,
        height: size,
        backgroundColor: bgColor,
        borderRadius: radius,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontWeight: 700,
        fontSize: size * 0.4,
        lineHeight: 1,
        userSelect: 'none',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}