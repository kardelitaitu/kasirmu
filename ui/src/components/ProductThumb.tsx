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

import { useState, useEffect, useRef } from 'react';
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
}

export function ProductThumb({
  hash,
  name,
  className = '',
  size = 64,
  lazy = true,
  hue = 0,
}: ProductThumbProps) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!hash) {
      setImgSrc(null);
      setLoadError(false);
      return;
    }

    let cancelled = false;

    resolveCacheDir().then((cacheDir) => {
      if (cancelled || !mountedRef.current) return;
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
        style={{ objectFit: 'cover', borderRadius: 'var(--radius-sm, 4px)' }}
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
        borderRadius: 'var(--radius-sm, 4px)',
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