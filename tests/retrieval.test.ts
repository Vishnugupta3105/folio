import { describe, expect, it } from "vitest";
import { chunkPages, detectChapter } from "@/lib/retrieval/chunk";
import { BM25Index, tokenize } from "@/lib/retrieval/bm25";
import type { Chunk } from "@/types";

describe("chunking", () => {
  it("keeps every chunk tied to its physical page", () => {
    const chunks = chunkPages("book", [
      { page: 1, text: "a".repeat(3000), chapter: "One" },
      { page: 2, text: "short page", chapter: "One" },
    ]);

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.bookId === "book")).toBe(true);
    // A chunk must never span a page boundary, or a citation would be wrong.
    expect(new Set(chunks.map((c) => c.page))).toEqual(new Set([1, 2]));
    expect(chunks.filter((c) => c.page === 2)).toHaveLength(1);
  });

  it("numbers chunks in reading order", () => {
    const chunks = chunkPages("b", [
      { page: 1, text: "x".repeat(2500) },
      { page: 2, text: "y".repeat(2500) },
    ]);
    const indices = chunks.map((c) => c.chunkIndex);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(new Set(indices).size).toBe(indices.length);
  });

  it("skips pages with no text rather than emitting empty chunks", () => {
    expect(chunkPages("b", [{ page: 1, text: "   \n  " }])).toHaveLength(0);
  });

  it("strips characters Postgres will not store, keeping the text around them", () => {
    const nul = String.fromCharCode(0);
    const loneSurrogate = String.fromCharCode(0xd800);

    // Both of these made the insert fail outright, so one bad glyph from a PDF
    // font table took down the whole book's upload.
    expect(chunkPages("b", [{ page: 1, text: `clean${nul} text` }])[0].text).toBe("clean text");
    expect(chunkPages("b", [{ page: 1, text: `clean${loneSurrogate} text` }])[0].text).toBe("clean text");
    // A well-formed pair is ordinary content and must survive untouched.
    expect(chunkPages("b", [{ page: 1, text: "a 😀 emoji" }])[0].text).toBe("a 😀 emoji");
  });

  it("treats a page that extracted to nothing as empty rather than throwing", () => {
    expect(chunkPages("b", [{ page: 1, text: null as unknown as string }])).toHaveLength(0);
  });

  it("detects chapter headings but ignores ordinary prose", () => {
    expect(detectChapter("Chapter Four\nThe morning was cold.")).toBe("Chapter Four");
    expect(detectChapter("PART II\nsomething")).toBe("PART II");
    expect(detectChapter("He turned to chapter four of the manual and read on.")).toBeNull();
    expect(detectChapter("Just a paragraph of running text that happens to be long.")).toBeNull();
  });
});

describe("BM25 retrieval", () => {
  const chunk = (id: string, page: number, text: string): Chunk => ({
    id, bookId: "b", page, chapter: null, chunkIndex: page, text,
  });

  const index = new BM25Index([
    chunk("a", 1, "The reading brain is assembled from circuits evolved for vision and speech."),
    chunk("b", 2, "Deep attention erodes under constant interruption from screens."),
    chunk("c", 3, "A recipe for bread requires flour, water, salt and time."),
  ]);

  it("ranks the relevant passage first", () => {
    const [top] = index.search("attention and interruption", 3);
    expect(top.chunk.id).toBe("b");
  });

  it("returns nothing for a query of only stopwords", () => {
    expect(index.search("the and of", 5)).toHaveLength(0);
  });

  it("honours the page filter, which is what enforces spoiler protection", () => {
    const results = index.search("attention interruption bread", 5, (c) => c.page <= 2);
    expect(results.every((r) => r.chunk.page <= 2)).toBe(true);
  });

  it("strips punctuation and stopwords when tokenizing", () => {
    expect(tokenize("The author's claim, however, is that...")).toEqual([
      "author's", "claim", "however", "that",
    ].filter((t) => t !== "that"));
  });
});

describe("search inside the book", () => {
  // Ranked retrieval and Cmd+F are different jobs: the first answers "what is
  // this about", the second "where does this string appear".
  it("ignores stopwords when ranking", () => {
    const index = new BM25Index([
      { id: "a", bookId: "b", page: 1, chapter: null, chunkIndex: 0, text: "The quick brown fox" },
    ]);
    expect(index.search("the", 5)).toHaveLength(0);
  });
});
