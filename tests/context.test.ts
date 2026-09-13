import { describe, expect, it } from "vitest";
import { buildReadingContext, requestsSpoilers, selectHistory } from "@/lib/ai/context";
import type { AIMessage, Book, Chunk } from "@/types";

const book: Book = {
  id: "book-1", userId: "u", title: "The Reading Brain", author: "M. Wolf",
  format: "pdf", fileKey: "k", coverUrl: null, pageCount: 300, pageLabels: null,
  status: "reading", indexState: "ready", createdAt: "", lastOpenedAt: null,
};

const chunks: Chunk[] = [
  { id: "c0", bookId: "book-1", page: 3, chapter: "One", chunkIndex: 0, text: "An early passage on how sustained attention is trained over years." },
  { id: "c1", bookId: "book-1", page: 10, chapter: "One", chunkIndex: 0, text: "Attention is built, not given." },
  { id: "c2", bookId: "book-1", page: 11, chapter: "One", chunkIndex: 1, text: "The reader on this page considers attention." },
  { id: "c3", bookId: "book-1", page: 12, chapter: "One", chunkIndex: 2, text: "The current page discusses sustained attention directly." },
  { id: "c4", bookId: "book-1", page: 250, chapter: "Ten", chunkIndex: 3, text: "In the end the protagonist abandons attention entirely." },
];

const base = {
  book, chunks, currentPage: 12, selectedText: null, highlights: [], history: [],
};

describe("reading context", () => {
  it("never places future pages in the context window", () => {
    const context = buildReadingContext({
      ...base, question: "what happens with attention", allowSpoilers: false,
    });
    expect(context.sourcePages).not.toContain(250);
    expect(context.userContent).not.toContain("abandons attention");
  });

  it("includes future pages once spoilers are explicitly allowed", () => {
    const context = buildReadingContext({
      ...base, question: "what happens with attention", allowSpoilers: true,
    });
    expect(context.sourcePages).toContain(250);
  });

  it("states the reading position in the system prompt", () => {
    const context = buildReadingContext({ ...base, question: "x", allowSpoilers: false });
    expect(context.system).toContain("page 12 of 300");
    expect(context.system).toContain("Spoiler protection");
  });

  it("drops the spoiler rule when spoilers were requested", () => {
    const context = buildReadingContext({ ...base, question: "x", allowSpoilers: true });
    expect(context.system).not.toContain("Spoiler protection");
  });

  it("gives the current page and the selection pride of place", () => {
    const context = buildReadingContext({
      ...base,
      selectedText: "sustained attention",
      question: "explain this",
      allowSpoilers: false,
    });
    expect(context.userContent).toContain("<selected-text");
    expect(context.userContent).toContain('<current-page number="12">');
    expect(context.userContent).toContain("<preceding-pages>");
    // The selection must appear before the retrieved passages.
    expect(context.userContent.indexOf("<selected-text")).toBeLessThan(
      context.userContent.indexOf("<relevant-passages"),
    );
  });

  it("never sends the whole book", () => {
    const many: Chunk[] = Array.from({ length: 500 }, (_, i) => ({
      id: `c${i}`, bookId: "book-1", page: i + 1, chapter: null, chunkIndex: i,
      text: `Page ${i + 1} discusses attention at length and in detail.`,
    }));
    const context = buildReadingContext({
      ...base, chunks: many, currentPage: 400, question: "attention", allowSpoilers: false,
    });
    expect(context.sourcePages.length).toBeLessThan(15);
  });
});

describe("spoiler intent", () => {
  it.each([
    "spoil it for me", "tell me the ending", "how does it end?",
    "what happens later in the book", "give me spoilers",
  ])("recognises %s", (question) => {
    expect(requestsSpoilers(question)).toBe(true);
  });

  it.each([
    "what does the author mean here", "explain this passage",
    "give me an example", "who is this character",
  ])("does not over-trigger on %s", (question) => {
    expect(requestsSpoilers(question)).toBe(false);
  });
});

describe("conversation history", () => {
  const message = (i: number, content: string): AIMessage => ({
    id: `m${i}`, bookId: "book-1", userId: "u", role: i % 2 === 0 ? "user" : "assistant",
    content, page: 1, selectedText: null, sourcePages: null,
    createdAt: new Date(2026, 0, 1, 0, i).toISOString(),
  });

  it("returns short histories untouched", () => {
    const history = [message(0, "a"), message(1, "b")];
    expect(selectHistory(history, "anything")).toEqual(history);
  });

  it("keeps recent turns and pulls back relevant older ones", () => {
    const history = [
      message(0, "tell me about mitochondria and cellular respiration"),
      message(1, "mitochondria generate ATP through respiration"),
      ...Array.from({ length: 10 }, (_, i) => message(i + 2, `unrelated filler turn ${i}`)),
    ];
    const selected = selectHistory(history, "more about mitochondria please");

    expect(selected.length).toBeLessThan(history.length);
    expect(selected.some((m) => m.content.includes("mitochondria"))).toBe(true);
    // And the last turn is always carried forward.
    expect(selected.at(-1)?.content).toBe(history.at(-1)?.content);
  });
});
