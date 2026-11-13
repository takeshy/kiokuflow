/** Pure BM25/RRF retrieval, shared by the personal and project RAG paths. */
export interface RankedText { chunkId: string; text: string }
export type RetrievalSource = "vector" | "bm25" | "both";

export function tokenizeRagText(text: string): string[] {
  const normalized = text.normalize("NFKC").toLowerCase();
  const tokens: string[] = [];
  const latin = normalized.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー]+/gu, run => {
    const chars = Array.from(run);
    if (chars.length < 2) tokens.push(run);
    else for (let i = 1; i < chars.length; i++) tokens.push(chars[i - 1] + chars[i]);
    return " ";
  });
  for (const match of latin.matchAll(/[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*/gu)) {
    tokens.push(match[0]);
    if (/[-_]/.test(match[0])) tokens.push(...match[0].split(/[-_]/));
  }
  return tokens;
}

/** Reuse token frequencies, but apply current path permissions before tokenizing or computing BM25 statistics. */
export function createRagKeywordIndex<T extends RankedText>(corpus: T[]) {
  const entries = corpus.map(candidate => ({ candidate, frequencies: undefined as { counts: Map<string, number>; length: number } | undefined }));
  return {
    rank(query: string, limit: number, accept: (candidate: T) => boolean = () => true): { candidate: T; score: number }[] {
      const terms = [...new Set(tokenizeRagText(query))];
      if (!terms.length) return [];
      const documents = entries.filter(entry => accept(entry.candidate)).map(entry => {
        if (!entry.frequencies) {
          const tokens = tokenizeRagText(entry.candidate.text);
          const counts = new Map<string, number>();
          for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
          entry.frequencies = { counts, length: tokens.length };
        }
        return { candidate: entry.candidate, ...entry.frequencies };
      });
      if (!documents.length) return [];
      const average = documents.reduce((sum, doc) => sum + doc.length, 0) / documents.length;
      if (!average) return [];
      const df = new Map(terms.map(term => [term, documents.filter(doc => doc.counts.has(term)).length]));
      return documents.map(doc => {
        const score = terms.reduce((sum, term) => {
          const tf = doc.counts.get(term) ?? 0;
          if (!tf) return sum;
          const count = df.get(term)!;
          return sum + Math.log(1 + (documents.length - count + 0.5) / (count + 0.5)) * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * doc.length / average));
        }, 0);
        return { candidate: doc.candidate, score };
      }).filter(hit => hit.score > 0).sort((a, b) => b.score - a.score || a.candidate.chunkId.localeCompare(b.candidate.chunkId)).slice(0, limit);
    },
  };
}

export function rankRagKeywords<T extends RankedText>(query: string, corpus: T[], limit: number): { candidate: T; score: number }[] {
  return createRagKeywordIndex(corpus).rank(query, limit);
}

export function fuseRagRanks<T extends RankedText>(vector: T[], lexical: T[], limit: number, k = 60): (T & { retrievalScore: number; retrievalSource: RetrievalSource })[] {
  const fused = new Map<string, T & { retrievalScore: number; retrievalSource: RetrievalSource }>();
  for (const [branch, list] of [vector, lexical].entries()) {
    const seen = new Set<string>();
    let rank = 0;
    for (const candidate of list) {
      if (seen.has(candidate.chunkId)) continue;
      seen.add(candidate.chunkId);
      let hit = fused.get(candidate.chunkId);
      if (!hit) {
        hit = { ...candidate, retrievalScore: 0, retrievalSource: branch === 0 ? "vector" : "bm25" };
        fused.set(candidate.chunkId, hit);
      } else if (branch === 1) hit.retrievalSource = "both";
      hit.retrievalScore += 1 / (k + ++rank);
    }
  }
  return [...fused.values()].sort((a, b) => b.retrievalScore - a.retrievalScore).slice(0, limit);
}
