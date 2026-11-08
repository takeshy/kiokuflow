import { createHash } from "node:crypto";
import { getFileMetadata, readFile, type DriveFile } from "./google-drive.server";

export interface DriveSnapshot { name: string; content: string; file: DriveFile; etag: string }

/** The v2 metadata ETag and If-Match guard the actual content write. */
export async function readTimelineDriveSnapshot(accessToken: string, file: DriveFile, signal: AbortSignal, readContent = readFile): Promise<DriveSnapshot> {
  const metadata = async () => {
    const response = await fetch(`https://www.googleapis.com/drive/v2/files/${encodeURIComponent(file.id)}?fields=etag,md5Checksum`, { headers: { Authorization: `Bearer ${accessToken}` }, signal });
    if (!response.ok) throw new Error("Cannot inspect Timeline file version");
    const value = await response.json() as { etag?: string; md5Checksum?: string };
    if (typeof value.etag !== "string" || !value.etag) throw new Error("Timeline file has no conditional-write version");
    return value;
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await metadata();
    const content = await readContent(accessToken, file.id);
    const after = await metadata();
    if (before.etag === after.etag) return { file: { ...file, md5Checksum: after.md5Checksum }, name: file.name, content, etag: after.etag! };
  }
  throw new Error("Timeline file changed repeatedly while reading");
}

export async function writeTimelineDriveSnapshot(accessToken: string, snapshot: DriveSnapshot, content: string, signal: AbortSignal, resolveMetadata = getFileMetadata): Promise<DriveFile | null> {
  const response = await fetch(`https://www.googleapis.com/upload/drive/v2/files/${encodeURIComponent(snapshot.file.id)}?uploadType=media`, {
    method: "PUT", headers: { Authorization: `Bearer ${accessToken}`, "If-Match": snapshot.etag, "Content-Type": snapshot.file.mimeType || "text/markdown" }, body: content, signal,
  });
  if (response.status === 412) return null;
  if (!response.ok) throw new Error("Cannot save synchronized Timeline");
  const file = await resolveMetadata(accessToken, snapshot.file.id);
  // Another writer may win after our PUT but before the metadata GET. Do not
  // mark our old body as synchronized against that newer body's checksum.
  if (file.md5Checksum && file.md5Checksum !== createHash("md5").update(content).digest("hex")) return null;
  return file;
}
