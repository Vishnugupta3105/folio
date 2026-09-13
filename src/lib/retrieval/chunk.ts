import type { Chunk } from "@/types";

export interface PageText {
  page: number;
  text: string;
  /** Heading detected on or before this page, used as a chapter label. */
  chapter?: string | null;
}

const TARGET = 900;   // characters — roughly 200 tokens, a readable paragraph group
const OVERLAP = 150;  // carried across boundaries so a split sentence stays findable

/**
 * Strips characters Postgres refuses to store in a `text` column.
 *
 * U+0000 and unpaired surrogates both make the insert fail outright
 * ("unsupported Unicode escape sequence", "invalid input syntax for type json"),
 * and PDF text layers produce both routinely out of broken font encodings. One
 * bad glyph anywhere in a book would otherwise fail the whole batch, so the
 * upload dies on the document it was asked to read. The local file adapter
 * accepts them happily, which is why this only ever bites against Supabase.
 */
function storable(text: string): string {
  return text
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

/**
 * Splits extracted page text into retrievable chunks.
 *
 * Page number is carried on every chunk so an answer can always cite
 * "Source: p. 84" and the citation can navigate. Chunks never span pages.
 */
export function chunkPages(bookId: string, pages: PageText[]): Omit<Chunk, "id">[] {
  const chunks: Omit<Chunk, "id">[] = [];
  let index = 0;

  for (const page of pages) {
    // `?? ""` rather than trusting the caller: a page that extracted to nothing
    // arrives as null from some documents, and `.replace` on it took the whole
    // request down with a 500.
    const text = storable(page.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;

    if (text.length <= TARGET) {
      chunks.push({
        bookId, page: page.page, chapter: page.chapter ?? null, chunkIndex: index++, text,
      });
      continue;
    }

    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + TARGET, text.length);
      if (end < text.length) {
        // Prefer a sentence boundary so chunks read as coherent passages.
        const boundary = text.lastIndexOf(". ", end);
        if (boundary > start + TARGET * 0.5) end = boundary + 1;
      }
      chunks.push({
        bookId,
        page: page.page,
        chapter: page.chapter ?? null,
        chunkIndex: index++,
        text: text.slice(start, end).trim(),
      });
      if (end >= text.length) break;
      start = end - OVERLAP;
    }
  }

  return chunks;
}

/**
 * Detects a chapter heading on a page.
 *
 * Deliberately conservative — a wrong chapter label is worse than none, because
 * chapter is used to scope AI retrieval.
 */
export function detectChapter(text: string): string | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 6);
  for (const line of lines) {
    if (line.length > 70) continue;
    if (/^(chapter|part|book|section)\s+([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(line)) {
      return line;
    }
  }
  return null;
}
