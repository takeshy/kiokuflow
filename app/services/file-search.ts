import type { FileListItem } from "~/contexts/EditorContext";
import type { CachedFile } from "./indexeddb-cache";
import { isEncryptedFile } from "./crypto-core";

export type SearchTarget = "files" | "content";
export interface FileSearchResult {
  id?: string;
  name: string;
  mimeType?: string;
  snippet?: string;
  location?: string;
  match: "keyword" | "fuzzy" | "rag";
  jevVerified?: boolean;
}

/** Same inexpensive intent rules as kakeratta; short ambiguous names stay lexical. */
export function isSentenceSearch(value: string): boolean {
  const query = value.normalize("NFKC").trim();
  if (/[?？!！。\n\r]/u.test(query)) return true;
  if (/(教えて|おしえて|探して|さがして|調べて|しらべて|知りたい|思い出したい|どこ(?:で|の|に)?|どんな|いつ(?:の|食べ|飲ん|行っ)?|なぜ|どうして|について|だった|でした|ました|かった|食べた|飲んだ|買った|行った|読んだ|見た|使った|くて|ような)/u.test(query)) return true;
  if (/\b(what|where|when|why|how|which|who|find|tell|show|remember|recommend)\b/i.test(query)) return true;
  return query.split(/\s+/u).length >= 5 || (/[\p{Script=Hiragana}\p{Script=Han}]/u.test(query) && [...query].length > 20);
}

export function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\u30a1-\u30f6]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60));
}

/** Substring edit distance: one scan, O(text length * term length), bounded term size. */
function findTerm(text: string, term: string, fuzzy: boolean): { index: number; edits: number } | null {
  const exact = text.indexOf(term);
  if (exact >= 0) return { index: exact, edits: 0 };
  if (!fuzzy || term.length < 3 || term.length > 64) return null;
  const allowed = term.length <= 5 ? 1 : term.length <= 12 ? 2 : 3;
  let previous = Array.from({ length: term.length + 1 }, (_, index) => index);
  let row = new Array<number>(term.length + 1);
  for (let i = 0; i < text.length; i++) {
    row[0] = 0;
    for (let j = 1; j <= term.length; j++) row[j] = Math.min(row[j - 1] + 1, previous[j] + 1, previous[j - 1] + (text[i] === term[j - 1] ? 0 : 1));
    if (row[term.length] <= allowed) return { index: Math.max(0, i - term.length + 1), edits: row[term.length] };
    [previous, row] = [row, previous];
  }
  return null;
}

function matchText(text: string, query: string, fuzzy: boolean) {
  const terms = normalizeSearchText(query).trim().split(/\s+/u).filter(Boolean);
  if (!terms.length) return null;
  const normalized = normalizeSearchText(text);
  const matches = terms.map(term => findTerm(normalized, term, fuzzy));
  if (matches.some(match => !match)) return null;
  return { index: matches[0]!.index, edits: matches.reduce((sum, match) => sum + match!.edits, 0) };
}

function snippet(text: string, normalizedIndex: number): string {
  // Map compatibility-normalized/kana-folded positions back to the original
  // text, including half-width kana + combining marks, for readable excerpts.
  let normalizedOffset = 0;
  let originalOffset = 0;
  for (const segment of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) {
    originalOffset = segment.index;
    normalizedOffset += normalizeSearchText(segment.segment).length;
    if (normalizedOffset > normalizedIndex) break;
  }
  const start = Math.max(0, originalOffset - 40);
  const end = Math.min(text.length, originalOffset + 100);
  return `${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export function searchFileNames(files: FileListItem[], query: string, fuzzy = false): FileSearchResult[] {
  return files.flatMap(file => {
    const match = matchText(file.path || file.name, query, fuzzy);
    return match ? [{ id: file.id, name: file.name, location: file.path, match: match.edits ? "fuzzy" as const : "keyword" as const, edits: match.edits }] : [];
  }).sort((a, b) => a.edits - b.edits || a.name.localeCompare(b.name));
}

/** Restrict cached content to the current tree: stale/deleted/other-root files never participate. */
export function searchFileContents(files: FileListItem[], cached: CachedFile[], query: string, fuzzy = false): FileSearchResult[] {
  const visible = new Map(files.map(file => [file.id, file]));
  return cached.flatMap(file => {
    const current = visible.get(file.fileId);
    if (!current || file.encoding === "base64" || isEncryptedFile(file.content) || file.content.includes("\0") || /\.encrypted$/i.test(current.name)) return [];
    const match = matchText(file.content, query, fuzzy);
    return match ? [{ id: current.id, name: current.name, location: current.path, snippet: snippet(file.content, match.index), match: match.edits ? "fuzzy" as const : "keyword" as const, edits: match.edits }] : [];
  }).sort((a, b) => a.edits - b.edits || a.name.localeCompare(b.name));
}

export function resolveRagResults(results: { title: string; snippet?: string; mimeType?: string; uri?: string; jevVerified?: boolean }[], files: FileListItem[]): FileSearchResult[] {
  return results.map(result => {
    const exact = files.find(file => file.path === result.title);
    // Duplicate basenames must never open a different document by accident.
    const byName = files.filter(file => file.name === result.title);
    const file = exact || (byName.length === 1 ? byName[0] : undefined);
    return { id: file?.id, name: file?.name || result.title, location: file?.path || result.title, mimeType: result.mimeType, jevVerified: result.jevVerified, snippet: result.snippet ? result.snippet.slice(0, 400) + (result.snippet.length > 400 ? "…" : "") : undefined, match: "rag" };
  });
}

/** Keep the first (best) excerpt per file; lexical results survive expansion. */
export function mergeFileSearchResults(...groups: FileSearchResult[][]): FileSearchResult[] {
  const seen = new Set<string>();
  return groups.flat().filter(result => {
    const key = result.id || result.location || result.name;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
