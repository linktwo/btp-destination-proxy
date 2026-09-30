const cleanups = new Set<() => void>();
let installed = false;

/** Runs `cleanup` when the dev server process ends, including Ctrl+C. */
export function onShutdown(cleanup: () => void): void {
  cleanups.add(cleanup);
  if (installed) return;
  installed = true;
  process.once("exit", runCleanups);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => {
      runCleanups();
      // Listening for a signal disables Node's default exit. Restore it unless someone else handles the signal.
      if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
    });
  }
}

function runCleanups(): void {
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch {
      // Keep shutting down.
    }
  }
  cleanups.clear();
}
