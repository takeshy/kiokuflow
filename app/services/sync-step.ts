/** Bound a Push step so a suspended browser request/cache read cannot hold
 * the sync lock forever. Callers retain dirty data and never auto-retry writes.
 */
export async function runSyncStep<T>(
  label: string,
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 120_000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Drive sync timed out: ${label}. Local changes are kept. Check your connection and retry.`);
      reject(error);
      controller.abort(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
