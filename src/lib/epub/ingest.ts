"use client";

import ePub from "epubjs";
import { api } from "@/lib/api";

export interface EpubReport {
  title: string | null;
  author: string | null;
  pageCount: number;
}

/**
 * EPUB has no pages — it has a flowing spine. Folio slices it into fixed-size
 * locations and treats each as a page, so progress, bookmarks, highlights and
 * AI citations all speak the same "page N" language as a PDF.
 *
 * The slice size matches what `locations.generate` uses, so the page numbers
 * produced here line up with the positions the renderer navigates to.
 */
export const LOCATION_CHARS = 1400;

export async function ingestEpub(
  bookId: string,
  onProgress: (done: number, total: number) => void,
): Promise<EpubReport> {
  // epub.js picks archived-vs-unpacked from the URL's extension. Our file route
  // has none, so without `openAs` it goes looking for META-INF/container.xml as
  // a directory, 404s, and `ready` never settles.
  const book = ePub(`/api/books/${bookId}/file`, { openAs: "epub" });
  await book.ready;

  const metadata = await book.loaded.metadata;
  await book.locations.generate(LOCATION_CHARS);

  const spine = book.spine as unknown as {
    spineItems: {
      href: string;
      // Resolves with the section's <html> element, not a Document.
      load: (request: unknown) => Promise<Element>;
      unload: () => void;
    }[];
  };
  const items = spine.spineItems ?? [];

  // Chapter titles come from the navigation document, keyed by file. Entries
  // without an href do exist in the wild, so every lookup is guarded.
  const chapterByHref = new Map<string, string>();
  try {
    const nav = await book.loaded.navigation;
    const walk = (entries: { href?: string; label?: string; subitems?: unknown[] }[]) => {
      for (const entry of entries ?? []) {
        if (entry.href && entry.label) {
          chapterByHref.set(entry.href.split("#")[0], entry.label.trim());
        }
        if (Array.isArray(entry.subitems)) {
          walk(entry.subitems as { href?: string; label?: string }[]);
        }
      }
    };
    walk(nav.toc as { href?: string; label?: string; subitems?: unknown[] }[]);
  } catch {
    // A book with no navigation document simply has unlabelled chapters.
  }

  /**
   * Pages are numbered by running character position across the whole spine,
   * which is exactly how `locations.generate` divides the book — so page N here
   * is the same place as location N there.
   */
  let consumed = 0;
  let pending: { page: number; text: string; chapter: string | null }[] = [];
  let posted = 0;

  const flush = async (complete: boolean) => {
    if (!pending.length && !complete) return;
    await api(`/api/books/${bookId}/index`, {
      method: "POST",
      body: JSON.stringify({ pages: pending, complete }),
    });
    posted += pending.length;
    pending = [];
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      const root = await item.load(book.load.bind(book));
      // Prefer the body so the <title> in head isn't read aloud as prose;
      // fall back to the whole element for sections shaped unusually.
      const body = root?.querySelector?.("body") ?? root;
      const text = (body?.textContent ?? "").replace(/\s+/g, " ").trim();
      item.unload();
      const chapter = chapterByHref.get(item.href?.split("#")[0] ?? "") ?? null;

      for (let offset = 0; offset < text.length; offset += LOCATION_CHARS) {
        pending.push({
          page: Math.floor((consumed + offset) / LOCATION_CHARS) + 1,
          text: text.slice(offset, offset + LOCATION_CHARS),
          chapter,
        });
      }
      consumed += text.length;
    } catch (error) {
      // One malformed section shouldn't stop the rest of the book indexing,
      // but it shouldn't vanish either.
      console.warn(`[folio:epub] section failed ${item.href}`, String(error).slice(0,200));
    }

    if (pending.length >= 20 || i === items.length - 1) {
      await flush(i === items.length - 1);
    }
    onProgress(i + 1, items.length);
  }

  await storeCover(bookId, book);

  // Prefer the page count the text actually produced; fall back to the
  // generated locations for a book we couldn't read the text of.
  const pageCount = Math.max(1, posted || book.locations.length());
  book.destroy();

  return {
    title: metadata.title?.trim() || null,
    author: metadata.creator?.trim() || null,
    pageCount,
  };
}

async function storeCover(bookId: string, book: ReturnType<typeof ePub>) {
  try {
    const url = await book.coverUrl();
    if (!url) return;
    const blob = await (await fetch(url)).blob();
    if (!blob.size || blob.size > 2 * 1024 * 1024) return;
    await fetch(`/api/books/${bookId}/cover`, { method: "POST", body: blob });
  } catch {
    // The typeset fallback cover handles it.
  }
}
