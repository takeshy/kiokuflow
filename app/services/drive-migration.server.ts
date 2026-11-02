import { createHash, randomUUID } from "node:crypto";
import { google } from "googleapis";
import { FieldValue, type Firestore } from "@google-cloud/firestore";
import { buildEncryptedAuthFile } from "gemihub-sync-core/auth";
import { getFirestore, DRIVE_OAUTH_MIGRATIONS } from "./firestore.server";
import { getAccountByEmail, getStoredRefreshToken, encryptOAuthRefreshToken } from "./hubwork-accounts.server";
import type { HubworkAccount } from "~/types/hubwork";
import type { SessionTokens } from "./session.server";
import type { UserSettings } from "~/types/settings";
import { rebuildSyncMeta } from "./sync-meta.server";
import { clearSettingsCache } from "./user-settings.server";
import { createFile, findFileByExactName, updateFile } from "./google-drive.server";
import { MIGRATION_FOLDER_MIME, assertMigrationOwner, migrationEmail, isMigrationSystemFile, isMigrationGoogleFile, verifyMigrationSourceFiles,
  migrateDriveSettings, remapMigrationReferences, assertMigrationFileUnchanged,
  MigrationOwnerError, planMigrationTargets, type MigrationEntry, type MigrationFile } from "./drive-migration";
import { migrationDriveEmail, migrationList, migrationMetadata, migrationReadText, migrationGenerateIds,
  migrationMarker, migratedTarget, migrationCreateFolderOrEmpty, migrationBeginUpload, migrationCopyChunk,
  migrationCopySmallFile, MIGRATION_SMALL_FILE_LIMIT, assertCopiedMigrationFile, migrationWriteJson, migrationTrashOldSettings } from "./drive-migration-drive.server";
import { copyMigrationBatch, migrationMap, MIGRATION_BATCH_SIZE, MIGRATION_COPY_BUDGET_MS } from "./drive-migration-batch";

const COLLECTION = DRIVE_OAUTH_MIGRATIONS;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const sourceTokenCache = new Map<string, { token: string; expires: number }>();
interface MigrationJob {
  ownerEmail: string;
  sourceRoot: string;
  targetRoot: string;
  sourceClient: string;
  targetClient: string;
  encryptedRefreshToken?: string;
  status: "ready" | "copying" | "complete";
  prepared?: boolean;
  sourceSettings?: MigrationFile;
  targetSettingsId?: string;
  targetSettingsHash?: string;
  total?: number;
  copied?: number;
  cursor?: string | null;
  destinationVerified?: boolean;
  verifiedSettingsHash?: string;
  leaseOwner?: string;
  leaseExpires?: number;
}

export function driveMigrationEnabled(): boolean {
  return !!process.env.GOOGLE_MIGRATION_CLIENT_ID && !!process.env.GOOGLE_MIGRATION_CLIENT_SECRET
    && process.env.GOOGLE_MIGRATION_CLIENT_ID !== process.env.GOOGLE_CLIENT_ID;
}

/** Snapshot BEFORE login replaces the billing account's root/refresh token. */
export async function captureLegacyDriveMigration(account: HubworkAccount, targetRoot: string, store?: Firestore,
  inspectSource: (job: MigrationJob) => Promise<boolean> = hasLegacySourceSettings): Promise<boolean> {
  if (!driveMigrationEnabled()) return false;
  const db = store ?? getFirestore();
  const ref = db.collection(COLLECTION).doc(account.id);
  const candidate: MigrationJob = {
    ownerEmail: migrationEmail(account.email), sourceRoot: account.rootFolderId, targetRoot,
    sourceClient: digest(process.env.GOOGLE_MIGRATION_CLIENT_ID!), targetClient: digest(process.env.GOOGLE_CLIENT_ID!),
    encryptedRefreshToken: account.encryptedRefreshToken, status: "ready",
  };
  // Billing-only/stale registrations must not send an owner to an impossible migration.
  // Check outside the Firestore transaction; retries must not repeat Google token requests.
  if (!(await ref.get()).exists) {
    if (!account.rootFolderId || account.rootFolderId === targetRoot || !account.encryptedRefreshToken) return false;
    if (!(await inspectSource(candidate))) return false;
  }
  return db.runTransaction(async tx => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      const job = existing.data() as MigrationJob;
      assertMigrationOwner(account.email, job.ownerEmail);
      if (job.targetRoot !== targetRoot) throw new Error("引き継ぎ先のフォルダが変わっています。元の引き継ぎ先を確認してください。");
      return job.status !== "complete";
    }
    if (!account.rootFolderId || account.rootFolderId === targetRoot || !account.encryptedRefreshToken) return false;
    tx.create(ref, { ...candidate, createdAt: FieldValue.serverTimestamp() });
    return true;
  });
}

async function hasLegacySourceSettings(job: MigrationJob): Promise<boolean> {
  if (!/^[\w-]+$/.test(job.sourceRoot)) return false;
  try {
    const token = await legacyToken(job);
    return (await migrationList(token, job.sourceRoot)).some(file => file.name === "settings.json");
  } catch (error) {
    if (error instanceof MigrationOwnerError) return false;
    throw error;
  }
}

async function ownedJob(tokens: SessionTokens) {
  if (!driveMigrationEnabled() || !tokens.email || !tokens.accessToken || !tokens.rootFolderId || tokens.currentOrgId) return null;
  const account = await getAccountByEmail(tokens.email);
  if (!account) return null;
  const ref = getFirestore().collection(COLLECTION).doc(account.id);
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;
  const job = snapshot.data() as MigrationJob;
  assertMigrationOwner(tokens.email, job.ownerEmail);
  if (job.targetRoot !== tokens.rootFolderId || job.sourceRoot === job.targetRoot
    || job.targetClient !== digest(process.env.GOOGLE_CLIENT_ID!)
    || job.sourceClient !== digest(process.env.GOOGLE_MIGRATION_CLIENT_ID!)) {
    throw new Error("このGoogleログインでは引き継ぎ先を確認できません。kiokuflowにログインし直してください。");
  }
  return { ref, job };
}

export async function driveMigrationSummary(tokens: SessionTokens) {
  const found = await ownedJob(tokens);
  if (!found) return null;
  const current = found.job.cursor ? (await found.ref.collection("files").doc(found.job.cursor).get()).data() as MigrationEntry | undefined : undefined;
  return { status: found.job.status, prepared: !!found.job.prepared, total: found.job.total ?? 0,
    copied: found.job.copied ?? 0, currentFile: current?.path ?? null };
}

async function legacyToken(job: MigrationJob): Promise<string> {
  if (!job.encryptedRefreshToken) throw new Error("旧環境の認証がありません。");
  const cacheKey = digest(`${job.ownerEmail}:${job.encryptedRefreshToken}`);
  const cached = sourceTokenCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.token;
  const refresh = getStoredRefreshToken({ encryptedRefreshToken: job.encryptedRefreshToken });
  const client = new google.auth.OAuth2(process.env.GOOGLE_MIGRATION_CLIENT_ID, process.env.GOOGLE_MIGRATION_CLIENT_SECRET);
  client.setCredentials({ refresh_token: refresh });
  let access: string | undefined | null;
  try { access = (await client.refreshAccessToken()).credentials.access_token; } catch {
    throw new Error("旧環境の認証が失効しています。旧環境で再認証してから引き継ぎをやり直してください。");
  }
  if (!access) throw new Error("旧環境の認証を取得できませんでした。");
  assertMigrationOwner(await migrationDriveEmail(access), job.ownerEmail);
  sourceTokenCache.set(cacheKey, { token: access, expires: Date.now() + 50 * 60_000 });
  return access;
}

async function prepare(job: MigrationJob, ref: FirebaseFirestore.DocumentReference, tokens: SessionTokens, sourceToken: string) {
  if (job.prepared) return;
  const root = await migrationMetadata(sourceToken, job.sourceRoot);
  if (root.mimeType !== MIGRATION_FOLDER_MIME) throw new Error("移行元のフォルダが見つかりません。");
  const targetFiles = await migrationList(tokens.accessToken, job.targetRoot);
  const settingsTargets = targetFiles.filter(f => f.name === "settings.json");
  if (settingsTargets.length !== 1) throw new Error("新環境の設定ファイルを一意に確認できません。");
  const pending = [{ id: job.sourceRoot, path: "", depth: 0 }];
  const visited = new Set<string>();
  const entries: Omit<MigrationEntry, "targetId">[] = [];
  let settings: MigrationFile | undefined;
  while (pending.length) {
    const parent = pending.shift()!;
    if (visited.has(parent.id) || parent.depth > 30) throw new Error("移行元のフォルダ構造を確認できませんでした。");
    visited.add(parent.id);
    for (const file of await migrationList(sourceToken, parent.id)) {
      const path = parent.path ? `${parent.path}/${file.name}` : file.name;
      if (path === "settings.json") {
        if (settings) throw new Error("旧環境に設定ファイルが複数あります。先に旧環境で整理してください。");
        settings = file;
      }
      if (isMigrationSystemFile(path)) continue;
      if (isMigrationGoogleFile(file)) continue;
      if (file.mimeType !== MIGRATION_FOLDER_MIME && (!file.md5Checksum || !Number.isSafeInteger(Number(file.size)))) {
        throw new Error("移行元のファイルのサイズまたはチェックサムが取得できませんでした。");
      }
      entries.push({ source: file, parent: parent.id, path, depth: parent.depth, done: false });
      if (entries.length > 20_000) throw new Error("移行対象が20,000件を超えています。個別の移行が必要です。");
      if (file.mimeType === MIGRATION_FOLDER_MIME) pending.push({ id: file.id, path, depth: parent.depth + 1 });
    }
  }
  if (!settings) throw new Error("旧GemiHubの設定ファイルが見つかりません。");
  // Parse before copying anything, so a corrupt settings file cannot strand a partial migration.
  migrateDriveSettings(await migrationReadText(sourceToken, settings.id), new Map());
  const planned = await planMigrationTargets(entries, job.sourceRoot, job.targetRoot,
    parent => parent === job.targetRoot ? Promise.resolve(targetFiles) : migrationList(tokens.accessToken, parent),
    count => migrationGenerateIds(tokens.accessToken, count));
  const prior = await ref.collection("files").get();
  // Interrupted planning does not create any Drive files. Rebuild its incomplete manifest.
  const operations = [
    ...prior.docs.map(doc => ({ remove: doc.ref })),
    ...planned.map((entry, i) => ({ set: ref.collection("files").doc(entry.source.id), entry: {
      ...entry, nextSourceId: planned[i + 1]?.source.id ?? null,
    } })),
  ];
  for (let i = 0; i < operations.length; i += 400) {
    const batch = getFirestore().batch();
    for (const operation of operations.slice(i, i + 400)) {
      if ("remove" in operation) batch.delete(operation.remove);
      else batch.set(operation.set, operation.entry);
    }
    await batch.commit();
  }
  await ref.update({ prepared: true, status: "copying", sourceSettings: settings,
    total: entries.length, copied: 0, cursor: entries[0]?.source.id ?? null,
    targetSettingsId: settingsTargets[0].id,
    targetSettingsHash: digest(await migrationReadText(tokens.accessToken, settingsTargets[0].id)) });
}

/** A retry or a lost commit response cannot increment the completed count twice. */
export async function recordMigrationCopy(ref: FirebaseFirestore.DocumentReference, file: FirebaseFirestore.DocumentReference, lease: string, store: Firestore = getFirestore()): Promise<void> {
  await store.runTransaction(async tx => {
    const job = (await tx.get(ref)).data();
    const current = (await tx.get(file)).data();
    if (job?.leaseOwner !== lease) throw new Error("引き継ぎの実行権限が更新されました。この画面を開き直してください。");
    if (!current) throw new Error("引き継ぎの進捗情報を確認できませんでした。");
    if (current.done) return;
    tx.update(file, { done: true, upload: FieldValue.delete() });
    tx.update(ref, { copied: FieldValue.increment(1) });
  });
}

async function copyEntry(job: MigrationJob, ref: FirebaseFirestore.DocumentReference, tokens: SessionTokens, sourceToken: string,
  entry: MigrationEntry, parent: string, lease: string): Promise<boolean> {
  const next = ref.collection("files").doc(entry.source.id);
  const signal = AbortSignal.timeout(MIGRATION_COPY_BUDGET_MS);
  const marker = migrationMarker(job.sourceRoot);
  assertMigrationFileUnchanged(entry.source, await migrationMetadata(sourceToken, entry.source.id, signal));
  let existing = await migratedTarget(tokens.accessToken, entry, parent, marker, signal);
  if (!existing) {
    if (entry.source.mimeType === MIGRATION_FOLDER_MIME || Number(entry.source.size) === 0) {
      await migrationCreateFolderOrEmpty(tokens.accessToken, entry, parent, marker, signal);
    } else if (!entry.upload && Number(entry.source.size) <= MIGRATION_SMALL_FILE_LIMIT) {
      existing = await migrationCopySmallFile(sourceToken, tokens.accessToken, entry, parent, marker, signal);
    } else {
      let upload = entry.upload ? getStoredRefreshToken({ encryptedRefreshToken: entry.upload }) : null;
      if (!upload) {
        upload = await migrationBeginUpload(tokens.accessToken, entry, parent, marker, signal);
        await next.update({ upload: encryptOAuthRefreshToken(upload) });
      }
      const result = await migrationCopyChunk(sourceToken, tokens.accessToken, entry, upload, signal);
      if (result.expired) { await next.update({ upload: FieldValue.delete() }); return false; }
      if (!result.done) return false;
    }
    existing ??= await migratedTarget(tokens.accessToken, entry, parent, marker, signal);
  }
  if (!existing) throw new Error("コピー先のファイルを確認できませんでした。");
  assertCopiedMigrationFile(entry.source, existing);
  await recordMigrationCopy(ref, next, lease);
  return true;
}

async function copyStep(job: MigrationJob, ref: FirebaseFirestore.DocumentReference, tokens: SessionTokens, sourceToken: string, lease: string) {
  // Filtering a single indexed field works for manifests created by older releases too.
  const pending = await ref.collection("files").where("done", "==", false).limit(MIGRATION_BATCH_SIZE).get();
  try {
    await copyMigrationBatch(pending.docs.map(doc => doc.data() as MigrationEntry), job.sourceRoot, job.targetRoot, {
      load: async id => {
        const entry = (await ref.collection("files").doc(id).get()).data() as MigrationEntry | undefined;
        if (!entry) throw new Error("移行先の親フォルダを確認できません。");
        return entry;
      },
      copy: (entry, parent) => copyEntry(job, ref, tokens, sourceToken, entry, parent, lease),
    });
  } finally {
    const next = await ref.collection("files").where("done", "==", false).limit(1).get();
    await ref.update({ cursor: next.docs[0]?.id ?? null });
  }
}

async function finish(job: MigrationJob, ref: FirebaseFirestore.DocumentReference, tokens: SessionTokens, sourceToken: string) {
  if (job.destinationVerified) {
    await cleanup(job, ref, tokens, sourceToken);
    return;
  }
  const entries = (await ref.collection("files").get()).docs.map(doc => doc.data() as MigrationEntry);
  if (entries.length !== job.total || entries.some(entry => !entry.done) || !job.sourceSettings || !job.targetSettingsId) throw new Error("未完了のファイルがあります。");
  // Verify planned items and reject newly added copyable files.
  const expected = new Map(entries.map(entry => [entry.source.id, entry.source]));
  expected.set(job.sourceSettings.id, job.sourceSettings);
  await migrationMap([job.sourceRoot, ...entries.filter(e => e.source.mimeType === MIGRATION_FOLDER_MIME).map(e => e.source.id)], async parent => {
    verifyMigrationSourceFiles(expected, await migrationList(sourceToken, parent), parent === job.sourceRoot);
  });
  if (expected.size) throw new Error("移行元のファイルが削除または移動されています。引き継ぎを停止しました。");
  assertMigrationFileUnchanged(job.sourceSettings, await migrationMetadata(sourceToken, job.sourceSettings.id));
  const ids = new Map(entries.map(entry => [entry.source.id, entry.targetId]));
  ids.set(job.sourceRoot, job.targetRoot);
  ids.set(job.sourceSettings.id, job.targetSettingsId);
  const settings = migrateDriveSettings(await migrationReadText(sourceToken, job.sourceSettings.id), ids);
  const currentHash = digest(await migrationReadText(tokens.accessToken, job.targetSettingsId));
  if (currentHash !== job.targetSettingsHash && currentHash !== digest(settings)) {
    throw new Error("引き継ぎ先の設定が変更されました。上書きを停止しました。");
  }
  // History indexes are JSON keyed by Drive IDs. Preserve titles and metadata while remapping IDs.
  const rewrittenHashes = new Map<string, string>();
  for (const entry of entries.filter(e => /^history\//.test(e.path) && e.source.name === "_meta.json")) {
    const text = JSON.stringify(remapMigrationReferences(JSON.parse(await migrationReadText(sourceToken, entry.source.id)), ids), null, 2);
    const parent = entry.parent === job.sourceRoot ? job.targetRoot : ids.get(entry.parent)!;
    const target = await migratedTarget(tokens.accessToken, entry, parent, migrationMarker(job.sourceRoot));
    if (!target || ![entry.source.md5Checksum, createHash("md5").update(text).digest("hex")].includes(target.md5Checksum)) {
      throw new Error("履歴の一覧ファイルが変更されました。上書きを停止しました。");
    }
    await migrationWriteJson(tokens.accessToken, entry.targetId, text);
    rewrittenHashes.set(entry.targetId, createHash("md5").update(text).digest("hex"));
  }
  await migrationWriteJson(tokens.accessToken, job.targetSettingsId, settings);
  clearSettingsCache();
  const parsed = JSON.parse(settings) as UserSettings;
  const enc = parsed.encryption;
  if (enc?.enabled && enc.publicKey && enc.encryptedPrivateKey && enc.salt) {
    const auth = await buildEncryptedAuthFile({ refreshToken: tokens.refreshToken, apiOrigin: "https://kiokuflow.net" }, enc);
    const prior = await findFileByExactName(tokens.accessToken, "_encrypted-auth.json", job.targetRoot);
    if (prior) await updateFile(tokens.accessToken, prior.id, JSON.stringify(auth), "application/json");
    else await createFile(tokens.accessToken, "_encrypted-auth.json", JSON.stringify(auth), job.targetRoot, "application/json");
  }
  await rebuildSyncMeta(tokens.accessToken, job.targetRoot);
  // Recheck every copied target before removing the old encryption settings.
  const remaining = new Map(entries.map(entry => [entry.targetId, entry]));
  await migrationMap([job.targetRoot, ...entries.filter(e => e.source.mimeType === MIGRATION_FOLDER_MIME).map(e => e.targetId)], async parent => {
    for (const file of await migrationList(tokens.accessToken, parent)) {
      const entry = remaining.get(file.id);
      if (!entry) continue;
      const expectedParent = entry.parent === job.sourceRoot ? job.targetRoot : ids.get(entry.parent);
      if (parent !== expectedParent || file.name !== (entry.targetName ?? entry.source.name) || file.mimeType !== entry.source.mimeType
        || file.appProperties?.kiokuflowMigration !== migrationMarker(job.sourceRoot)
        || file.appProperties?.migrationSource !== entry.source.id) throw new Error("コピー先が変更されています。旧設定を残して停止しました。");
      const rewrittenHash = rewrittenHashes.get(file.id);
      if (rewrittenHash) {
        if (file.md5Checksum !== rewrittenHash) throw new Error("履歴のコピー内容が一致しません。");
      } else assertCopiedMigrationFile(entry.source, file);
      remaining.delete(file.id);
    }
  });
  if (remaining.size) throw new Error("コピー先のファイルが見つかりません。旧設定を残して停止しました。");
  if (digest(await migrationReadText(tokens.accessToken, job.targetSettingsId)) !== digest(settings)) {
    throw new Error("設定と暗号鍵のコピーを確認できませんでした。旧設定は削除していません。");
  }
  // This checkpoint makes cleanup recoverable even if the settings-trash response is lost.
  const verified = { destinationVerified: true, verifiedSettingsHash: digest(settings) };
  await ref.update(verified);
  await cleanup({ ...job, ...verified }, ref, tokens, sourceToken);
}

async function cleanup(job: MigrationJob, ref: FirebaseFirestore.DocumentReference, tokens: SessionTokens, sourceToken: string) {
  if (!job.destinationVerified || !job.verifiedSettingsHash || !job.sourceSettings || !job.targetSettingsId) {
    throw new Error("引き継ぎ先の検証が完了していません。旧設定は削除していません。");
  }
  if (digest(await migrationReadText(tokens.accessToken, job.targetSettingsId)) !== job.verifiedSettingsHash) {
    throw new Error("コピー後に新しい設定が変更されています。旧設定の削除を停止しました。");
  }
  await migrationTrashOldSettings(sourceToken, job.sourceRoot, job.sourceSettings);
  await ref.update({ status: "complete", completedAt: FieldValue.serverTimestamp(), encryptedRefreshToken: FieldValue.delete() });
  if (job.encryptedRefreshToken) sourceTokenCache.delete(digest(`${job.ownerEmail}:${job.encryptedRefreshToken}`));
}

export async function runDriveMigration(tokens: SessionTokens, intent: string): Promise<void> {
  const found = await ownedJob(tokens);
  if (!found) throw new Error("このアカウントの旧環境は見つかりません。");
  const { ref } = found;
  const lease = randomUUID();
  const job = await getFirestore().runTransaction(async tx => {
    const current = (await tx.get(ref)).data() as MigrationJob;
    if (current.status === "complete") return current;
    if ((current.leaseExpires ?? 0) > Date.now()) throw new Error("別の画面で引き継ぎを実行中です。しばらく待って再試行してください。");
    tx.update(ref, { leaseOwner: lease, leaseExpires: Date.now() + 10 * 60_000 });
    return current;
  });
  if (job.status === "complete") return;
  try {
    assertMigrationOwner(await migrationDriveEmail(tokens.accessToken), job.ownerEmail);
    const sourceToken = await legacyToken(job);
    if (intent === "prepare") await prepare(job, ref, tokens, sourceToken);
    else if (intent === "step" && job.prepared) await copyStep(job, ref, tokens, sourceToken, lease);
    else if (intent === "finish" && job.prepared) await finish(job, ref, tokens, sourceToken);
    else throw new Error("引き継ぎの操作が不正です。");
  } finally {
    await getFirestore().runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (current?.leaseOwner === lease) tx.update(ref, { leaseOwner: FieldValue.delete(), leaseExpires: FieldValue.delete() });
    });
  }
}

