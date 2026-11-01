import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { resolveRagMedia } from "./rag-jev-media.server";
import type { RagChunk } from "./rag-store.server";
function chunk(text: string, docPath = "scan.pdf", metadata: Partial<RagChunk["metadata"]> = {}): RagChunk {
  return { chunkId: "scan", orgId: "org", projectId: "project", settingName: "index", docPath, chunkIndex: 0, text, embedding: [], updatedAt: 0, metadata: { fileName: docPath, contentType: "application/pdf", ...metadata } };
}
test("Jev PDF resolver extracts only the matched pages", async () => {
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText("Excluded page", { font }); pdf.addPage().drawText("Matched page", { font });
  const bytes = await pdf.save();
  const result = await resolveRagMedia(chunk("[Pdf: scan.pdf pages 2-2 of 2]"), async () => bytes);
  assert.match(result!.text, /Matched page/); assert.doesNotMatch(result!.text, /Excluded page/); assert.equal(result!.images, undefined);
});
test("image-only PDF pages render as JPEG assets for Jev", async () => {
  const pdf = await PDFDocument.create(); pdf.addPage([200, 200]).drawRectangle({ x: 20, y: 20, width: 100, height: 100, color: rgb(1, 0, 0) });
  const bytes = await pdf.save();
  const result = await resolveRagMedia(chunk("[Pdf: scan.pdf pages 1-1 of 1]"), async () => bytes);
  assert.equal(result?.images?.length, 1); assert.equal(result!.images![0].format, "jpeg");
  assert.ok(Buffer.from(result!.images![0].data_base64, "base64").byteLength > 100);
});
test("changed media, unsupported formats and out-of-range PDFs are retained as unchecked", async () => {
  const bytes = Uint8Array.from([1, 2, 3]);
  assert.equal(await resolveRagMedia(chunk("[Image: photo.png]", "photo.png", { md5Checksum: "0".repeat(64) }), async () => bytes), null);
  assert.equal(await resolveRagMedia(chunk("[Image: photo.gif]", "photo.gif"), async () => bytes), null);
  const result = await resolveRagMedia(chunk("[Image: photo.png]", "photo.png", { md5Checksum: createHash("sha256").update(bytes).digest("hex") }), async () => bytes);
  assert.equal(result?.images?.[0].data_base64, "AQID");
  const pdf = await PDFDocument.create(); pdf.addPage(); const pdfBytes = await pdf.save();
  assert.equal(await resolveRagMedia(chunk("[Pdf: scan.pdf pages 2-3 of 3]"), async () => pdfBytes), null);
  assert.equal(await resolveRagMedia(chunk("[Video: video.mp4]", "video.mp4"), async () => assert.fail("Unsupported media was downloaded")), null);
});
