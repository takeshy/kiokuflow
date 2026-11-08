import { activeProjectMountKey, applyTimelineSnapshotCAS } from "./indexeddb-cache";
import { getCachedFile, getCachedRemoteMeta, type CachedFile } from "./indexeddb-cache-drive";
import { mergeTimelineSnapshots } from "./timeline-snapshot-merge";
import { parseTimeline, serializeTimeline } from "./timeline-format";
import { parseMemoFile } from "../dashboard/memo/memoTimeline";
import { withTimelineFileLock } from "./timeline-local-lock";
import { isTimelineDayPath } from "./timeline-path";

/** Daily Timeline drafts use the canonical file instead of generic placeholders. */
export async function migratePendingTimeline(draft: CachedFile, name: string): Promise<boolean> {
  if (activeProjectMountKey() || draft.encoding || !isTimelineDayPath(name)) return false;
  const account = await getCachedRemoteMeta();
  const response = await fetch("/api/drive/files", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "mergeTimeline", name, content: draft.content, timelineRootFolderId: account?.rootFolderId }),
  });
  if (!response.ok) throw new Error("Cannot save new Timeline posts; local changes were kept");
  const result = await response.json() as { file: { id: string; name: string; md5Checksum?: string; modifiedTime?: string }; content: string; rootFolderId: string };
  if (result.file.name !== name || typeof result.content !== "string" || !result.rootFolderId
    || (account?.rootFolderId && account.rootFolderId !== result.rootFolderId)) throw new Error("Timeline response belongs to another workspace");
  await withTimelineFileLock(name, async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await getCachedFile(draft.fileId);
      if (!current) return; // A deleted local draft must never delete the shared remote file.
      if (current.fileName && current.fileName !== name) throw new Error("Timeline was renamed while saving; local changes were kept");
      const target = await getCachedFile(result.file.id);
      let content = result.content;
      if (current.content !== draft.content || (target && target.content !== result.content)) {
        let merged = current.content === draft.content ? parseTimeline(result.content, name)
          : await mergeTimelineSnapshots(parseTimeline(current.content, name), parseTimeline(result.content, name), parseTimeline(draft.content, name), `${result.rootFolderId}\n${name}`);
        if (target && target.content !== result.content) merged = await mergeTimelineSnapshots(parseTimeline(target.content, name), merged, parseTimeline(result.content, name), `${result.rootFolderId}\n${name}`);
        merged.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
        content = serializeTimeline(merged, parseMemoFile(result.content).source || "timeline:Timeline");
      }
      const applied = await applyTimelineSnapshotCAS({
        file: { fileId: result.file.id, fileName: name, content, md5Checksum: result.file.md5Checksum ?? "", modifiedTime: result.file.modifiedTime ?? new Date().toISOString(), cachedAt: Date.now() },
        rootFolderId: result.rootFolderId, expectedFileId: draft.fileId, expectedContent: current.content,
        expectedTargetContent: target?.content, remoteContent: result.content,
      });
      if (applied) {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("file-id-migrated", { detail: { oldId: draft.fileId, newId: result.file.id, fileName: name, mimeType: "text/markdown" } }));
          window.dispatchEvent(new Event("sync-complete"));
        }
        return;
      }
    }
    throw new Error("Timeline cache changed while saving; retry synchronization");
  });
  return true;
}
