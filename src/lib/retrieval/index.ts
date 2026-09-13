import "server-only";
import type { Chunk } from "@/types";
import { BM25Index, type ScoredChunk } from "./bm25";

/**
 * Retriever seam. BM25 is the shipped implementation; a dense/embedding
 * retriever can implement the same interface without changing the context
 * builder or any route.
 */
export interface Retriever {
  search(query: string, limit: number, filter?: (c: Chunk) => boolean): ScoredChunk[];
}

/**
 * Indexes are rebuilt from chunks on demand and cached per book, so the second
 * question about a book costs no index-building time at all.
 */
const cache = new Map<string, { index: BM25Index; builtAt: number }>();
const TTL = 15 * 60 * 1000;
const MAX_CACHED_BOOKS = 12;

/**
 * The chunks themselves are cached too.
 *
 * A book's text does not change between edits, but it is read on every search
 * keystroke and every AI question. Against a local file that was free; against
 * Postgres it is a network round trip each time, which made search feel slow
 * enough to look broken. Cached here, and dropped by `invalidateIndex` whenever
 * the book is re-indexed.
 */
const chunkCache = new Map<string, { chunks: Chunk[]; loadedAt: number }>();

export async function loadChunks(
  bookId: string,
  fetcher: () => Promise<Chunk[]>,
): Promise<Chunk[]> {
  const hit = chunkCache.get(bookId);
  if (hit && Date.now() - hit.loadedAt < TTL) return hit.chunks;

  const chunks = await fetcher();
  chunkCache.set(bookId, { chunks, loadedAt: Date.now() });

  if (chunkCache.size > MAX_CACHED_BOOKS) {
    const oldest = [...chunkCache.entries()].sort((a, b) => a[1].loadedAt - b[1].loadedAt)[0];
    if (oldest) chunkCache.delete(oldest[0]);
  }
  return chunks;
}

export function getIndex(bookId: string, chunks: () => Chunk[]): Retriever {
  const hit = cache.get(bookId);
  if (hit && Date.now() - hit.builtAt < TTL) return hit.index;

  const index = new BM25Index(chunks());
  cache.set(bookId, { index, builtAt: Date.now() });

  if (cache.size > MAX_CACHED_BOOKS) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].builtAt - b[1].builtAt)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  return index;
}

export function invalidateIndex(bookId: string): void {
  cache.delete(bookId);
  chunkCache.delete(bookId);
}

export type { ScoredChunk };
