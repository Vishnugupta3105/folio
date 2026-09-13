import type { Chunk } from "@/types";

/**
 * BM25 over a single book's chunks.
 *
 * A book is a small, closed corpus — a few thousand chunks at most — so lexical
 * retrieval runs in a millisecond with no embedding call, no vector store and no
 * API key. The `EmbeddingRetriever` seam in `retrieval/index.ts` exists so a
 * dense retriever can be swapped in later without touching callers.
 */

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "is", "it", "that",
  "this", "for", "on", "with", "as", "was", "are", "be", "by", "at", "from",
  "he", "she", "they", "we", "you", "i", "his", "her", "their", "our", "its",
  "not", "have", "has", "had", "do", "does", "did", "what", "which", "who",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

const K1 = 1.5;
const B = 0.75;

export interface ScoredChunk {
  chunk: Chunk;
  score: number;
}

export class BM25Index {
  private readonly docs: { chunk: Chunk; tf: Map<string, number>; length: number }[] = [];
  private readonly df = new Map<string, number>();
  private avgLength = 0;

  constructor(chunks: Chunk[]) {
    for (const chunk of chunks) {
      const terms = tokenize(chunk.text);
      const tf = new Map<string, number>();
      for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ chunk, tf, length: terms.length });
    }
    const total = this.docs.reduce((sum, d) => sum + d.length, 0);
    this.avgLength = this.docs.length ? total / this.docs.length : 1;
  }

  get size(): number {
    return this.docs.length;
  }

  search(query: string, limit: number, filter?: (c: Chunk) => boolean): ScoredChunk[] {
    const terms = tokenize(query);
    if (!terms.length) return [];
    const N = this.docs.length;
    const results: ScoredChunk[] = [];

    for (const doc of this.docs) {
      if (filter && !filter(doc.chunk)) continue;
      let score = 0;
      for (const term of terms) {
        const f = doc.tf.get(term);
        if (!f) continue;
        const n = this.df.get(term) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        const norm = 1 - B + B * (doc.length / this.avgLength);
        score += idf * ((f * (K1 + 1)) / (f + K1 * norm));
      }
      if (score > 0) results.push({ chunk: doc.chunk, score });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
