// ── Export / import across the Android content-URI bridge ────────
//
// `pickExportPath` and `pickImportFile` are the two places where a value from
// the file dialog stops being a filesystem path. Both branches are driven here
// with the plugins mocked, because only one of them is reachable from a
// developer machine: the `content://` branch is the one that cannot be
// exercised by clicking around, and it is the one the tablet actually runs.
//
// The export side is the half with no desktop analogue — Rust writes the file,
// so the bytes have to be walked back out to the user's URI in JS. That is what
// most of these cases pin.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  remove: vi.fn(),
  appCacheDir: vi.fn(),
  join: vi.fn(),
  logged: vi.fn(),
}));

vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (...args: unknown[]) => mocks.logged(...args),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open, save: mocks.save }));
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

import { exportData, pickExportPath, pickImportFile } from '@/api/data';

/** A URI of the kind the SAF save dialog returns on Android. */
const SAVE_URI = 'content://com.android.providers.downloads.documents/document/msf%3A99';

/** A URI of the kind the SAF open dialog returns on Android. */
const OPEN_URI = 'content://com.android.providers.downloads.documents/document/msf%3A42';

const CACHE_DIR = '/data/user/0/mu.kasir.mobile/cache';

/** Position of the second `writeFile` argument — the bytes being moved. */
const BYTES = new Uint8Array([7, 8, 9]);

describe('pickExportPath / exportData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appCacheDir.mockResolvedValue(CACHE_DIR);
    mocks.join.mockImplementation(async (...parts: string[]) => parts.join('/'));
    mocks.remove.mockResolvedValue(undefined);
    mocks.readFile.mockResolvedValue(BYTES);
  });

  it('returns null when the save dialog is dismissed', async () => {
    mocks.save.mockResolvedValue(null);

    await expect(pickExportPath()).resolves.toBeNull();
  });

  it('passes a desktop destination through untouched, with no cache round trip', async () => {
    mocks.save.mockResolvedValue('C:\\Users\\me\\Documents\\export.kasirpkg');

    const target = await pickExportPath();

    expect(target).toBe('C:\\Users\\me\\Documents\\export.kasirpkg');
    expect(mocks.appCacheDir).not.toHaveBeenCalled();
  });

  it('turns a content:// destination into a cache path the command can write', async () => {
    mocks.save.mockResolvedValue(SAVE_URI);

    const target = await pickExportPath();

    expect(target).toMatch(/^\/data\/user\/0\/mu\.kasir\.mobile\/cache\/export-[0-9a-f-]{36}\.kasirpkg$/);
    // Nothing is copied yet — there are no bytes to move.
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it('copies the written cache file out to the URI the user chose, then drops it', async () => {
    mocks.save.mockResolvedValue(SAVE_URI);
    const cachePath = await pickExportPath();
    expect(cachePath).toBeTruthy();

    mocks.logged.mockResolvedValue({
      path: cachePath,
      sizeBytes: BYTES.length,
      types: ['products'],
    });

    const result = await exportData('tok', {
      types: ['products'],
      password: 'secret',
      outputPath: cachePath!,
    });

    expect(mocks.readFile).toHaveBeenCalledWith(cachePath);
    expect(mocks.writeFile).toHaveBeenCalledWith(SAVE_URI, BYTES);
    // The cache copy is the only other copy; leaving it behind is not an export.
    expect(mocks.remove).toHaveBeenCalledWith(cachePath);

    // What the UI shows is the user's destination, not a cache path that no
    // longer exists by the time it is rendered.
    expect(result.path).toBe(SAVE_URI);
    expect(result.sizeBytes).toBe(BYTES.length);
  });

  it('does not bridge an export that was never picked through the picker', async () => {
    mocks.logged.mockResolvedValue({ path: '/tmp/direct.kasirpkg', sizeBytes: 1, types: [] });

    const result = await exportData('tok', {
      types: [],
      password: 'secret',
      outputPath: '/tmp/direct.kasirpkg',
    });

    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(result.path).toBe('/tmp/direct.kasirpkg');
  });

  it('leaves a pending destination alone when the command itself fails', async () => {
    mocks.save.mockResolvedValue(SAVE_URI);
    const cachePath = await pickExportPath();
    mocks.logged.mockRejectedValue(new Error('export failed'));

    await expect(
      exportData('tok', { types: [], password: 'secret', outputPath: cachePath! }),
    ).rejects.toThrow('export failed');

    // No bytes were written, so there is nothing to move and no cache file to
    // remove; the failure propagates rather than being swallowed by the bridge.
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});

describe('pickImportFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appCacheDir.mockResolvedValue(CACHE_DIR);
    mocks.join.mockImplementation(async (...parts: string[]) => parts.join('/'));
    mocks.remove.mockResolvedValue(undefined);
    mocks.readFile.mockResolvedValue(BYTES);
  });

  it('returns null when the picker is dismissed', async () => {
    mocks.open.mockResolvedValue(null);

    await expect(pickImportFile()).resolves.toBeNull();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it('passes a desktop path through untouched', async () => {
    mocks.open.mockResolvedValue('/home/me/Downloads/backup.kasirpkg');

    await expect(pickImportFile()).resolves.toBe('/home/me/Downloads/backup.kasirpkg');
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it('copies a content:// pick into the app cache so tokio can open it', async () => {
    mocks.open.mockResolvedValue(OPEN_URI);

    const path = await pickImportFile();

    expect(mocks.readFile).toHaveBeenCalledWith(OPEN_URI);

    const [name, bytes, options] = mocks.writeFile.mock.calls[0] as [
      string,
      Uint8Array,
      { baseDir: number },
    ];
    expect(name).toMatch(/^import-[0-9a-f-]{36}\.kasirpkg$/);
    expect(bytes).toEqual(BYTES);
    expect(options.baseDir).toBe(16);

    // The two import commands read this with `tokio::fs`, which has no base
    // directory, so the absolute form is what has to come back.
    expect(path).toBe(`${CACHE_DIR}/${name}`);
  });

  it('does not delete the copy it just made', async () => {
    mocks.open.mockResolvedValue(OPEN_URI);

    const path = await pickImportFile();

    // Deliberate: `import_preview` and `import_data` both read this file, with
    // a password prompt and a confirm dialog in between, so it must outlive the
    // pick. Nothing here knows when the flow is finished.
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(path).toContain('/cache/import-');
  });
});
