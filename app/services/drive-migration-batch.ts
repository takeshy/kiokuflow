import { MIGRATION_FOLDER_MIME, type MigrationEntry } from "./drive-migration";

export const MIGRATION_CONCURRENCY = 4;
export const MIGRATION_BATCH_SIZE = 24;
export const MIGRATION_BATCH_BUDGET_MS = 20_000;
export const MIGRATION_COPY_BUDGET_MS = 90_000;

export class MigrationRequestError extends Error {
  constructor(message: string, readonly retryable = false) { super(message); }
}

export function isRetryableMigrationError(error: unknown): boolean {
  if (error instanceof MigrationRequestError) return error.retryable;
  if (!(error instanceof Error)) return false;
  return ["TimeoutError", "AbortError"].includes(error.name)
    || (error instanceof TypeError && /fetch failed/i.test(error.message));
}

/** Wait for every started worker before releasing the migration's lease. */
export async function migrationMap<T>(items: T[], run: (item: T) => Promise<void>, concurrency = MIGRATION_CONCURRENCY): Promise<void> {
  let next = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failed && next < items.length) {
      const item = items[next++];
      try { await run(item); } catch (error) { failed = true; failure ??= error; }
    }
  }));
  if (failed) throw failure;
}

/** Each worker copies a parent first; shared parents run only once per batch. */
export async function copyMigrationBatch(entries: MigrationEntry[], sourceRoot: string, targetRoot: string, options: {
  load: (id: string) => Promise<MigrationEntry>;
  copy: (entry: MigrationEntry, parent: string) => Promise<boolean>;
  now?: () => number;
  budgetMs?: number;
}): Promise<void> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? MIGRATION_BATCH_BUDGET_MS);
  const known = new Map(entries.map(entry => [entry.source.id, entry]));
  const loads = new Map<string, Promise<MigrationEntry>>();
  const tasks = new Map<string, Promise<boolean>>();
  const load = (id: string) => {
    if (known.has(id)) return Promise.resolve(known.get(id)!);
    if (!loads.has(id)) loads.set(id, options.load(id));
    return loads.get(id)!;
  };
  const ensure = (entry: MigrationEntry, ancestors = new Set<string>()): Promise<boolean> => {
    if (ancestors.has(entry.source.id)) return Promise.reject(new Error("移行先のフォルダ構造を確認できません。"));
    if (entry.done) return Promise.resolve(true);
    if (tasks.has(entry.source.id)) return tasks.get(entry.source.id)!;
    const task = (async () => {
      if (now() >= deadline) return false;
      let parent = targetRoot;
      if (entry.parent !== sourceRoot) {
        const parentEntry = await load(entry.parent);
        if (parentEntry.source.mimeType !== MIGRATION_FOLDER_MIME) throw new Error("移行先の親フォルダを確認できません。");
        if (!(await ensure(parentEntry, new Set([...ancestors, entry.source.id])))) return false;
        parent = parentEntry.targetId;
      }
      if (now() >= deadline) return false;
      try {
        const done = await options.copy(entry, parent);
        if (done) entry.done = true;
        return done;
      } catch (error) {
        const detail = isRetryableMigrationError(error) ? "Google Driveへの通信が一時的に失敗しました。進捗は保存されています。"
          : error instanceof Error ? error.message : "コピーに失敗しました。";
        throw new MigrationRequestError(`${entry.path}: ${detail}`, isRetryableMigrationError(error));
      }
    })();
    tasks.set(entry.source.id, task);
    return task;
  };
  await migrationMap(entries, async entry => { await ensure(entry); });
}
