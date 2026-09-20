// ── The Android content-URI bridge ────────────────────────────────
//
// `pickImageFile` has three branches and only one of them is reachable on a
// desktop machine, so all three are driven here with the plugins mocked. The
// branch that matters most — the `content://` one — is the branch no developer
// can exercise by clicking around, which is the reason this file exists.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pickImageFile } from '@/api/image-pick';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  remove: vi.fn(),
  appCacheDir: vi.fn(),
  join: vi.fn(),
}));

// `pickImageFile` imports these dynamically so the browser bundle never carries
// them; vitest intercepts dynamic imports the same as static ones.
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
  remove: mocks.remove,
  BaseDirectory: { AppCache: 16 },
}));
vi.mock('@tauri-apps/api/path', () => ({
  appCacheDir: mocks.appCacheDir,
  join: mocks.join,
}));

/** A URI in the shape `DialogPlugin.kt:117` actually returns on Android. */
const CONTENT_URI =
  'content://com.android.providers.media.documents/document/image%3A1234';

/**
 * `isTauriWebview()` tests for a CALLABLE `invoke`, not for the key's presence
 * (`api/tauri.ts:29-57`), so a bare `{}` — and the dev preview's
 * `{ transformCallback }` — both correctly read as "not Tauri".
 */
function stubTauriWebview(on: boolean): void {
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown };
  if (on) w.__TAURI_INTERNALS__ = { invoke: () => Promise.resolve() };
  else delete w.__TAURI_INTERNALS__;
}

describe('pickImageFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.open.mockReset();
    mocks.readFile.mockReset();
    mocks.writeFile.mockReset();
    mocks.remove.mockReset();
    mocks.appCacheDir.mockReset();
    mocks.join.mockReset();

    mocks.appCacheDir.mockResolvedValue('/data/user/0/mu.kasir.mobile/cache');
    mocks.join.mockImplementation(async (...parts: string[]) => parts.join('/'));
    mocks.remove.mockResolvedValue(undefined);
  });

  it('returns null outside a webview without opening the picker', async () => {
    stubTauriWebview(false);

    await expect(pickImageFile()).resolves.toBeNull();
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('returns null when the picker is dismissed', async () => {
    stubTauriWebview(true);
    // The documented cancel path: the Kotlin callback rejects, the plugin
    // absorbs it into `f(None)`, and the command resolves to null. A caller
    // that treats this as an error fires on every dismissed picker.
    mocks.open.mockResolvedValue(null);

    await expect(pickImageFile()).resolves.toBeNull();
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it('passes a desktop path through untouched and never deletes it', async () => {
    stubTauriWebview(true);
    mocks.open.mockResolvedValue('C:\\Users\\me\\Pictures\\photo.png');

    const picked = await pickImageFile();

    expect(picked?.path).toBe('C:\\Users\\me\\Pictures\\photo.png');
    // No bridging, and — the part that would be destructive if it regressed —
    // no write, and no attempt to remove the user's own file.
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();

    picked?.release();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('bridges a content:// URI into the app cache and returns an absolute path', async () => {
    stubTauriWebview(true);
    mocks.open.mockResolvedValue(CONTENT_URI);
    mocks.readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));

    const picked = await pickImageFile();

    // Read through the content resolver...
    expect(mocks.readFile).toHaveBeenCalledWith(CONTENT_URI);

    // ...written under the scope-allowed stem, relative to the app cache so the
    // plugin's own resolution is what the capability's $APPCACHE pattern sees.
    const [name, bytes, options] = mocks.writeFile.mock.calls[0] as [
      string,
      Uint8Array,
      { baseDir: number },
    ];
    expect(name).toMatch(/^image-pick-[0-9a-f-]{36}\.img$/);
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(options.baseDir).toBe(16);

    // The URI has no usable extension, so the fallback applies. The Rust ingest
    // sniffs magic bytes and ignores this entirely.
    expect(name.endsWith('.img')).toBe(true);

    // Rust needs the ABSOLUTE path — `tokio::fs::read` has no base directory.
    expect(picked?.path).toBe(`/data/user/0/mu.kasir.mobile/cache/${name}`);
  });

  it('keeps a real extension when the URI carries one', async () => {
    stubTauriWebview(true);
    mocks.open.mockResolvedValue('content://com.android.externalstorage.documents/x%2Fphoto.webp');
    mocks.readFile.mockResolvedValue(new Uint8Array([1]));

    const picked = await pickImageFile();

    expect(picked?.path).toMatch(/\.webp$/);
  });

  it('releases the cache copy on demand, and tolerates it already being gone', async () => {
    stubTauriWebview(true);
    mocks.open.mockResolvedValue(CONTENT_URI);
    mocks.readFile.mockResolvedValue(new Uint8Array([1]));

    const picked = await pickImageFile();
    const name = picked?.path.split('/').pop();

    picked?.release();
    expect(mocks.remove).toHaveBeenCalledWith(name, { baseDir: 16 });

    // Android may have reclaimed the cache entry, so a failed remove must not
    // surface as an unhandled rejection.
    mocks.remove.mockRejectedValue(new Error('ENOENT'));
    expect(() => picked?.release()).not.toThrow();
    await Promise.resolve();
  });
});
