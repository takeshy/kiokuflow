import { createHash, randomUUID } from "node:crypto";
import { getFirestore, isFirestoreAvailable } from "./firestore.server";
import { findFilesByExactName, getFileMetadata, type DriveFile } from "./google-drive.server";
import { readTimelineDriveSnapshot, writeTimelineDriveSnapshot } from "./timeline-drive-snapshot.server";
import { mergeTimelineSnapshots } from "./timeline-snapshot-merge";
import { parseTimeline, serializeTimeline } from "./timeline-format";
import { parseMemoFile } from "../dashboard/memo/memoTimeline";
import type { Firestore } from "@google-cloud/firestore";

const API = "https://www.googleapis.com/drive/v3";
const FIELDS = "id,name,mimeType,parents,trashed,md5Checksum,modifiedTime,createdTime,size";
// Credential-less, single-server installations still share reservations between
// requests. Hosted instances elect a durable ID in a Firestore transaction.
const localReservations = new Map<string, Promise<string>>();

async function driveFetch(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: `Bearer ${token}` },
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
}

async function generateId(token: string, signal: AbortSignal): Promise<string> {
  const response = await driveFetch(token, `${API}/files/generateIds?count=1&space=drive&type=files`, { signal });
  if (!response.ok) throw new Error(`Cannot reserve Timeline file ID (${response.status})`);
  const { ids } = await response.json() as { ids?: string[] };
  if (!ids?.[0]) throw new Error("Drive did not return a Timeline file ID");
  return ids[0];
}

export async function reserveTimelineFileId(token: string, root: string, name: string, signal: AbortSignal, deps: {
  database: () => Firestore | null; generate: typeof generateId;
} = { database: () => isFirestoreAvailable() ? getFirestore() : null, generate: generateId }): Promise<string> {
  const key = createHash("sha256").update(JSON.stringify([root, name])).digest("hex");
  const db = deps.database();
  if (!db) {
    let pending = localReservations.get(key);
    if (!pending) {
      pending = deps.generate(token, signal).catch(error => { localReservations.delete(key); throw error; });
      localReservations.set(key, pending);
    }
    return pending;
  }
  const ref = db.collection("timeline-drive-files").doc(key);
  const existing = (await ref.get()).data()?.fileId;
  if (typeof existing === "string" && existing) return existing;
  const proposed = await deps.generate(token, signal);
  return db.runTransaction(async transaction => {
    const current = (await transaction.get(ref)).data()?.fileId;
    if (typeof current === "string" && current) return current;
    transaction.set(ref, { fileId: proposed, rootFolderId: root, name });
    return proposed;
  });
}

/** A pre-generated ID makes even a lost create response safe to retry. */
export async function createReservedTimelineFile(token: string, root: string, name: string, id: string, signal: AbortSignal): Promise<DriveFile> {
  const boundary = `timeline-${randomUUID()}`;
  const metadata = { id, name, parents: [root], mimeType: name.endsWith(".json") ? "application/json" : "text/markdown",
    appProperties: { kiokuflowSource: "timeline" } };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\n\r\n\r\n--${boundary}--\r\n`;
  const response = await driveFetch(token, `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${FIELDS}`, {
    method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body, signal,
  });
  if (response.status === 409) return getFileMetadata(token, id, { signal });
  if (!response.ok) throw new Error(`Cannot create Timeline file (${response.status})`);
  return response.json() as Promise<DriveFile>;
}

export const timelineFileDependencies = {
  find: findFilesByExactName,
  reserve: reserveTimelineFileId,
  create: createReservedTimelineFile,
  read: readTimelineDriveSnapshot,
  write: writeTimelineDriveSnapshot,
};
type Dependencies = typeof timelineFileDependencies;

export async function ensureTimelineDriveFile(token: string, root: string, name: string, signal: AbortSignal, deps: Dependencies = timelineFileDependencies): Promise<DriveFile> {
  const matches = await deps.find(token, name, root, { signal });
  if (matches.length > 1) throw new Error("Duplicate Timeline files must be resolved before synchronizing");
  if (matches[0]) return matches[0];
  const id = await deps.reserve(token, root, name, signal);
  const file = await deps.create(token, root, name, id, signal);
  if (file.id !== id || file.name !== name || file.trashed || !file.parents?.includes(root)) {
    throw new Error("Reserved Timeline file was moved, renamed or deleted; local changes were kept");
  }
  return file;
}

/** Merge new-day drafts by post ID; never overwrite another device's posts. */
export async function saveNewTimelineFile(token: string, root: string, name: string, desired: string, signal: AbortSignal, deps: Dependencies = timelineFileDependencies): Promise<{ file: DriveFile; content: string }> {
  const file = await ensureTimelineDriveFile(token, root, name, signal, deps);
  for (let attempt = 0; attempt < 5; attempt++) {
    const snapshot = await deps.read(token, file, signal);
    const entries = await mergeTimelineSnapshots(parseTimeline(desired, name), parseTimeline(snapshot.content, name), [], `${root}\n${name}`);
    entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const source = parseMemoFile(snapshot.content).source || parseMemoFile(desired).source || "timeline:Timeline";
    const content = desired === snapshot.content ? desired : serializeTimeline(entries, source);
    if (content === snapshot.content) return { file: snapshot.file, content };
    const saved = await deps.write(token, snapshot, content, signal);
    if (saved) return { file: saved, content };
  }
  throw new Error("Timeline changed repeatedly; local changes were kept. Retry synchronization.");
}

/** Generic create callers cannot consume a merged body: reject a competing
 * creation instead of marking an incomplete local copy as synchronized. */
export class TimelineFileConflictError extends Error {}

export async function createTimelineFileChecked(token: string, root: string, name: string, content: string, signal: AbortSignal, deps: Dependencies = timelineFileDependencies): Promise<DriveFile> {
  const file = await ensureTimelineDriveFile(token, root, name, signal, deps);
  const snapshot = await deps.read(token, file, signal);
  if (snapshot.content === content) return snapshot.file;
  if (snapshot.content) throw new TimelineFileConflictError("Timeline file already exists. Pull or synchronize Timeline before pushing.");
  const saved = await deps.write(token, snapshot, content, signal);
  if (!saved) throw new TimelineFileConflictError("Timeline file changed during creation. Retry synchronization.");
  return saved;
}
