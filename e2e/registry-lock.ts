import { mkdirSync, rmSync } from "node:fs";

// Cross-worker mutex for the ONE shared registry file (public/configs/character-gym.json). Several
// specs snapshot it, write it through the dev endpoint, assert, and restore it — and Playwright runs
// spec FILES on separate workers (workers=4), so two of them can be inside that read-modify-write at
// the same wall-clock instant, losing a mutation or racing a restore. `mkdir` is atomic (EEXIST if
// the dir exists), which is all a coarse lock needs.
//
// ponytail: one global lock across the whole critical section — fine because these are the only
// specs that mutate the file, and each holds it for a couple of seconds. A crash between acquire and
// release leaves a stale dir; the next run's first acquirer waits out the timeout and throws, which
// is a loud, correct failure rather than silent corruption.

const LOCK_DIR = "e2e/.registry-lock"; // cwd-relative; e2e/ always exists

export async function withRegistryLock<T>(fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      mkdirSync(LOCK_DIR); // non-recursive: throws EEXIST while another worker holds it
      break;
    } catch {
      if (Date.now() > deadline) throw new Error("registry-lock: timed out waiting for the lock");
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(LOCK_DIR, { recursive: true, force: true });
  }
}
