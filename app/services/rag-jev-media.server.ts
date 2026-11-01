import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import type { RagChunk } from "./rag-store.server";
import type { JevContent, JevImage } from "./jev-rag.server";

/** Resolve only the indexed image or matched PDF pages; never judge a filename as evidence. */
export async function resolveRagMedia(candidate: RagChunk, readBytes: () => Promise<Uint8Array>, signal?: AbortSignal): Promise<JevContent | null> {
  if (!/^\[(?:pdf|image):/i.test(candidate.text.trim())) return null;
  signal?.throwIfAborted();
  const bytes = await readBytes();
  if (bytes.byteLength > 20 * 1024 * 1024) return null;
  const checksum = candidate.metadata.md5Checksum;
  if (checksum) {
    const hash = createHash(checksum.length === 64 ? "sha256" : "md5").update(bytes).digest(checksum.length === 64 || checksum.length === 32 ? "hex" : "base64");
    if (hash !== checksum) return null; // File changed since this embedding was indexed.
  }
  if (/^\[image:/i.test(candidate.text.trim())) {
    if (!/\.(png|jpe?g)$/i.test(candidate.docPath)) return null;
    const data = Buffer.from(bytes).toString("base64");
    if (data.length > 12 * 1024 * 1024) return null;
    return { text: "検索に一致した画像", images: [{ type: "image", data_base64: data, format: /\.png$/i.test(candidate.docPath) ? "png" : "jpeg" }] };
  }
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const root = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  const task = pdfjs.getDocument({ data: bytes.slice(), cMapUrl: `${root}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}/standard_fonts/` });
  try {
    const document = await task.promise;
    const range = /pages?\s+(\d+)(?:\s*-\s*(\d+))?/i.exec(candidate.metadata.pageLabel || candidate.text);
    const from = range ? Number(range[1]) : 1;
    const to = range ? Number(range[2] || range[1]) : document.numPages;
    if (from < 1 || to < from || to > document.numPages || to - from + 1 > 16) return null;
    const pages = [];
    const texts: string[] = [];
    for (let number = from; number <= to; number++) {
      signal?.throwIfAborted();
      const page = await document.getPage(number); pages.push(page);
      const text = await page.getTextContent();
      texts.push(text.items.map(item => "str" in item ? item.str : "").join(" "));
    }
    if (texts.every(text => text.trim())) return { text: texts.map((text, index) => `[Page ${from + index}]\n${text}`).join("\n\n") };
    const factory = document.canvasFactory as { create: (width: number, height: number) => { canvas: { toBuffer: (mime: string) => Uint8Array }; context: unknown }; destroy: (canvas: unknown) => void };
    const images: JevImage[] = [];
    let encodedSize = 0;
    for (const page of pages) {
      signal?.throwIfAborted();
      const raw = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(1.5, 1280 / Math.max(raw.width, raw.height)) });
      const canvas = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
      try {
        await page.render({ canvas: null, canvasContext: canvas.context as CanvasRenderingContext2D, viewport }).promise;
        const data = Buffer.from(canvas.canvas.toBuffer("image/jpeg")).toString("base64");
        encodedSize += data.length;
        if (encodedSize > 12 * 1024 * 1024) return null;
        images.push({ type: "image", format: "jpeg", data_base64: data });
      } finally { factory.destroy(canvas); }
    }
    return { text: `該当PDFページ: ${from}-${to}`, images };
  } finally { await task.destroy(); }
}
