import { test as base, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * E2E fixtures providing pre-authenticated page objects via Playwright
 * `storageState`. The auth fixture performs a full login once per worker
 * and serializes localStorage to disk, so every subsequent test that uses
 * `loggedInPage` starts already authenticated (~3s saving per test).
 *
 * The state file is PER WORKER, not one shared path. A single path is a data
 * race: with `workers: 4` (playwright.config.ts) four worker processes read
 * and write it concurrently, so a worker can read a half-written file, fail
 * its "already logged in?" probe, log in again and clobber another worker's
 * session. Each worker now owns `<project>-w<workerIndex>.json`.
 *
 * `workerIndex` is a process-global monotonic counter in the Playwright
 * runner (`lastWorkerIndex++` per WorkerHost, never reset), so it is unique
 * across projects — desktop and tablet cannot collide on it. The project name
 * is included anyway so a filename identifies its owner at a glance.
 *
 * Reads tolerate a missing or corrupt file (a fresh worker legitimately has
 * none) and mean "log in fresh" rather than throwing. Writes go to a
 * per-process temp file and are renamed into place, so a reader — including a
 * worker of the other project or of a concurrent run in the same checkout —
 * sees either the whole old file or the whole new one, never a partial one.
 *
 * Usage:
 *   import { test } from '../fixtures';
 *   test('my test', async ({ loggedInPage }) => { ... });
 */

/**
 * Auth state lives under `e2e-results/`, which .gitignore already excludes
 * (`/ui/e2e-results`). Deliberately not `ui/.e2e-auth-<worker>.json`: that
 * rule is an exact filename (`/ui/.e2e-auth.json`), so sibling names would be
 * untracked-but-not-ignored in a shared checkout.
 */
const AUTH_DIR = path.join(__dirname, '..', 'e2e-results', '.auth');

export type LoggedInFixture = {
  /**
   * A page that is already authenticated as the given role.
   * The page starts at the workspace picker (WorkspaceHome).
   */
  loggedInPage: Page;
};

/** Per-worker auth state path. Unique within a run across all projects. */
function authFileFor(projectName: string, workerIndex: number): string {
  return path.join(AUTH_DIR, `${projectName}-w${workerIndex}.json`);
}

/**
 * Resolve a saved auth state path, tolerating a missing or corrupt file.
 *
 * A fresh worker has no file yet, and a writer that died mid-write can leave
 * unparseable JSON. Both mean "log in fresh"; neither may throw, because a
 * throw here fails the test rather than re-authenticating it.
 *
 * The path is validated by parsing it now and handing the path to Playwright,
 * which parses it again. That is safe because only this worker ever writes
 * this path (see `authFileFor`), and the write is atomic (see below).
 */
function readAuthState(file: string): string | undefined {
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'));
    return file;
  } catch {
    return undefined;
  }
}

/**
 * Write auth state atomically: temp file in the same directory, then rename.
 *
 * A rename within one filesystem is atomic, so no reader ever observes a
 * partially written file — which is what a plain in-place write allows. The
 * temp name carries the PID so two processes can never share a temp file.
 *
 * The retry is not decoration: measured on Windows, a rename over a file that
 * a concurrent reader has open fails with EPERM. Against a reader hammering
 * the path, 1 attempt lost ~40% of writes, 3 attempts lost ~1.4%, 8 lost
 * none — all with zero partial reads in every case. The loop bounds the
 * failure; atomicity is what makes it safe to retry.
 */
const RENAME_ATTEMPTS = 8;

function writeAuthStateAtomic(file: string, state: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(state));
  } catch (err) {
    console.warn(`[e2e] could not write auth state to ${file}: ${String(err)}`);
    return;
  }
  for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // EPERM/EACCES/EBUSY: a reader (or scanner) holds the target open on
      // Windows. Retry briefly; anything else is a real error.
      const retryable = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
      if (!retryable || attempt === RENAME_ATTEMPTS - 1) {
        // Never let a failed cache write fail the test: the login already
        // succeeded, and the next test simply logs in again.
        try {
          fs.rmSync(tmp, { force: true });
        } catch {
          /* best effort */
        }
        console.warn(`[e2e] could not persist auth state to ${file}: ${String(err)}`);
        return;
      }
    }
  }
}

/**
 * Extended test with the `loggedInPage` fixture.
 *
 * The fixture performs login once per worker using storageState.
 * The first test in the worker runs the login flow; all subsequent
 * tests reuse the serialized state.
 *
 * `LoggedInFixture` is the second type argument because the fixture is
 * worker-scoped: a worker fixture cannot be declared as a test fixture.
 */
export const test = base.extend<{}, LoggedInFixture>({
  loggedInPage: [
    async ({ browser }, use, workerInfo) => {
      const authFile = authFileFor(
        workerInfo.project.name,
        workerInfo.workerIndex,
      );

      // Create a new context that tries to load saved auth state. A missing
      // or corrupt file yields no storageState at all, i.e. a clean context.
      const savedState = readAuthState(authFile);
      const context = await browser.newContext(
        savedState ? { storageState: savedState } : {},
      );
      const page = await context.newPage();

      // Check if we're already logged in (workspace home visible).
      await page.goto('/');
      const alreadyLoggedIn = await page
        .locator('.workspace-home')
        .isVisible({ timeout: 3_000 })
        .catch(() => false);

      if (!alreadyLoggedIn) {
        // Perform fresh login.
        await page.goto('/');
        await page.waitForSelector('.staff-login-screen', { timeout: 15_000 });

        // Enter username.
        const usernameInput = page.locator('.staff-login-input').first();
        await usernameInput.fill('staff');

        // Submit.
        await page.locator('.staff-login-submit-btn').click();

        // Wait for PIN pad.
        await page.locator('.staff-login-pad').waitFor({ state: 'visible', timeout: 10_000 });

        // Enter PIN.
        for (const digit of '1234') {
          const key = page.locator('.staff-login-pad-key').filter({ hasText: digit });
          await key.click();
          await page.waitForTimeout(80);
        }

        // Wait for workspace home.
        await page.waitForSelector('.workspace-home', { timeout: 15_000 });

        // Save the auth state for subsequent tests in this worker.
        writeAuthStateAtomic(authFile, await page.context().storageState());
      }

      await use(page);
      await context.close();
    },
    { scope: 'worker' },
  ],
});

export { expect } from '@playwright/test';
