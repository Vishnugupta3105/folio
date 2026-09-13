import "server-only";
import type { AIMessage, Book, Chunk, Highlight } from "@/types";
import { getIndex, type ScoredChunk } from "@/lib/retrieval";

export interface ContextRequest {
  book: Book;
  chunks: Chunk[];
  currentPage: number;
  selectedText: string | null;
  question: string;
  highlights: Highlight[];
  history: AIMessage[];
  /** Explicit opt-in to content past the reader's position. */
  allowSpoilers: boolean;
}

export interface BuiltContext {
  system: string;
  userContent: string;
  /** Pages the model was actually shown, for citation rendering. */
  sourcePages: number[];
}

const NEARBY_RADIUS = 2;
const RETRIEVED_LIMIT = 6;
const HISTORY_LIMIT = 6;

const SYSTEM = `You are the reading companion inside Folio, a digital book reader. The reader is holding a book open in front of them; you are a voice beside it, not a chatbot in another window.

How you answer:
- Lead with the answer. No preamble, no "Great question!", no restating what was asked.
- Two or three short paragraphs at most unless the reader asks for more. Voice answers should be shorter still.
- Explain in plain language. Reach for an example when it genuinely clarifies.
- Distinguish what the author claims from what is established fact. Say "the author argues" when that is what is happening.
- Cite pages when you draw on the book: write them inline as (p. 84) or (pp. 82–84).
- If the passages you were given do not answer the question, say so plainly and answer from general knowledge while making that switch explicit. Never invent something and attribute it to the book.
- Ask a clarifying question only when the question genuinely cannot be answered otherwise.

Formatting: plain prose with markdown emphasis where it helps. Short bold labels and bullet lists are fine for structured requests like "explain this page". Never use headings above ###.`;

const SPOILER_RULE = `
Spoiler protection — this matters:
The reader is on page {page} of {total}. You have been given passages only from that point and earlier. Do not reveal, foreshadow, or hint at anything that happens later in the book, even if you can infer it. If answering properly requires later content, say that the answer lies ahead and offer to explain it if they want the spoiler.`;

const SPOILERS_ALLOWED = `
The reader has explicitly asked for information beyond their current position, so the whole book is available to you.`;

/**
 * Assembles the model's view of what the reader is looking at.
 *
 * Priority order, strongest first: selected text, the current page, nearby
 * pages, semantically retrieved passages, the reader's own highlights, and
 * relevant prior turns. The full book is never sent.
 */
export function buildReadingContext(req: ContextRequest): BuiltContext {
  const { book, chunks, currentPage, selectedText, question, allowSpoilers } = req;

  // Spoiler protection is a retrieval-level filter, not just a prompt request:
  // future pages are never placed in the context window at all.
  const horizon = allowSpoilers ? Number.POSITIVE_INFINITY : currentPage;
  const visible = chunks.filter((c) => c.page <= horizon);

  // The index is built over the whole book and never over `visible`. Caching an
  // index already narrowed to one reading position would mean a later question —
  // from further on, or one that asks for spoilers — searching a corpus that
  // silently excludes the pages it needs.

  const currentPageChunks = visible.filter((c) => c.page === currentPage);
  const nearby = visible.filter(
    (c) => c.page >= currentPage - NEARBY_RADIUS && c.page < currentPage,
  );

  const chapter = currentPageChunks[0]?.chapter ?? null;

  // Retrieve against the selection when there is one — it is the sharpest
  // signal about what the reader actually means by "this".
  const query = selectedText ? `${selectedText} ${question}` : question;
  const alreadyShown = new Set([...currentPageChunks, ...nearby].map((c) => c.id));
  const retrieved: ScoredChunk[] = getIndex(book.id, () => chunks)
    .search(query, RETRIEVED_LIMIT * 2, (c) => c.page <= horizon && !alreadyShown.has(c.id))
    .slice(0, RETRIEVED_LIMIT);

  const sourcePages = [
    ...new Set([
      ...currentPageChunks.map((c) => c.page),
      ...nearby.map((c) => c.page),
      ...retrieved.map((r) => r.chunk.page),
    ]),
  ].sort((a, b) => a - b);

  const sections: string[] = [];

  sections.push(
    `<book title="${escapeAttr(book.title)}"${
      book.author ? ` author="${escapeAttr(book.author)}"` : ""
    } pages="${book.pageCount}" />`,
  );
  sections.push(
    `<reading-position page="${currentPage}"${chapter ? ` chapter="${escapeAttr(chapter)}"` : ""} />`,
  );

  if (selectedText) {
    sections.push(`<selected-text page="${currentPage}">\n${selectedText.trim()}\n</selected-text>`);
  }

  if (currentPageChunks.length) {
    sections.push(
      `<current-page number="${currentPage}">\n${
        currentPageChunks.map((c) => c.text).join("\n\n")
      }\n</current-page>`,
    );
  }

  if (nearby.length) {
    sections.push(
      `<preceding-pages>\n${
        nearby.map((c) => `[p. ${c.page}] ${c.text}`).join("\n\n")
      }\n</preceding-pages>`,
    );
  }

  if (retrieved.length) {
    sections.push(
      `<relevant-passages note="retrieved from elsewhere in what the reader has already read">\n${
        retrieved.map((r) => `[p. ${r.chunk.page}] ${r.chunk.text}`).join("\n\n")
      }\n</relevant-passages>`,
    );
  }

  // The reader's own highlights on or near this page reveal what they care about.
  const relevantHighlights = req.highlights.filter(
    (h) => Math.abs(h.page - currentPage) <= NEARBY_RADIUS && h.page <= horizon,
  );
  if (relevantHighlights.length) {
    sections.push(
      `<reader-highlights>\n${
        relevantHighlights.map((h) => `[p. ${h.page}] "${h.text}"${h.note ? ` — their note: ${h.note}` : ""}`).join("\n")
      }\n</reader-highlights>`,
    );
  }

  sections.push(`<question>\n${question}\n</question>`);

  const system =
    SYSTEM +
    (allowSpoilers
      ? SPOILERS_ALLOWED
      : SPOILER_RULE.replace("{page}", String(currentPage)).replace(
          "{total}",
          String(book.pageCount),
        ));

  return { system, userContent: sections.join("\n\n"), sourcePages };
}

/**
 * Selects prior turns worth replaying. Recency plus lexical relevance — the
 * whole conversation is never resent.
 */
export function selectHistory(history: AIMessage[], question: string): AIMessage[] {
  if (history.length <= HISTORY_LIMIT) return history;

  const recent = history.slice(-HISTORY_LIMIT + 2);
  const older = history.slice(0, -HISTORY_LIMIT + 2);
  const terms = new Set(question.toLowerCase().split(/\W+/).filter((t) => t.length > 3));

  const scored = older
    .map((m) => {
      const words = new Set(m.content.toLowerCase().split(/\W+/));
      let overlap = 0;
      for (const t of terms) if (words.has(t)) overlap++;
      return { message: m, overlap };
    })
    .filter((s) => s.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 2)
    .map((s) => s.message);

  return [...scored, ...recent].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Detects an explicit request for content beyond the reading position. */
export function requestsSpoilers(question: string): boolean {
  return /\b(spoil|spoiler|spoilers|ahead|later in the book|end of the book|ending|how does it end|rest of the book|whole book|entire book)\b/i.test(
    question,
  );
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, "&quot;").slice(0, 200);
}
