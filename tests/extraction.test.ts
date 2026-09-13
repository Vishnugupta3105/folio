import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { chunkPages, detectChapter } from "@/lib/retrieval/chunk";
import { splitSentences } from "@/lib/tts/tts";

/**
 * Extraction against a real document.
 *
 * The browser pipeline can't be clicked through here, but its two load-bearing
 * guarantees can: that the text of a page is recovered with usable offsets, and
 * that a chunk always knows which physical page it came from. Uses the pdf.js
 * legacy build, which is the Node-compatible one.
 */
const PDF = "/Users/siddhantmanglam/Downloads/CAT/CAT-2024-Slot-02-Final-with-Answer-Keys.pdf";

async function openDocument() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await readFile(PDF));
  return pdfjs.getDocument({ data, useSystemFonts: false }).promise;
}

/** Mirrors src/lib/pdf/document.ts — offsets must line up with the text exactly. */
async function extract(page: Awaited<ReturnType<Awaited<ReturnType<typeof openDocument>>["getPage"]>>) {
  const content = await page.getTextContent();
  const items: { text: string; offset: number }[] = [];
  let text = "";
  for (const raw of content.items) {
    if (!("str" in raw)) continue;
    const item = raw as { str: string; hasEOL?: boolean };
    if (item.str) {
      items.push({ text: item.str, offset: text.length });
      text += item.str;
    }
    if (item.hasEOL) text += "\n";
    else if (item.str && !item.str.endsWith(" ")) text += " ";
  }
  return { text, items };
}

describe("real document extraction", () => {
  it("recovers text with offsets that point at the right characters", async () => {
    const doc = await openDocument();
    expect(doc.numPages).toBeGreaterThan(0);

    // Page one is often a cover or a plate; find the first page with real prose.
    let text = "";
    let items: { text: string; offset: number }[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, 8) && text.length < 400; n++) {
      ({ text, items } = await extract(await doc.getPage(n)));
    }

    expect(text.length).toBeGreaterThan(400);
    expect(items.length).toBeGreaterThan(10);

    // This is the contract every highlight and every narration cursor rests on.
    for (const item of items.slice(0, 200)) {
      expect(text.slice(item.offset, item.offset + item.text.length)).toBe(item.text);
    }

    await doc.loadingTask.destroy();
  }, 30_000);

  it("chunks a real book without ever losing the page number", async () => {
    const doc = await openDocument();
    const pages = [];

    let chapter: string | null = null;
    for (let n = 1; n <= Math.min(doc.numPages, 12); n++) {
      const page = await doc.getPage(n);
      const { text } = await extract(page);
      chapter = detectChapter(text) ?? chapter;
      pages.push({ page: n, text, chapter });
    }

    const chunks = chunkPages("real-book", pages);
    expect(chunks.length).toBeGreaterThan(0);

    for (const chunk of chunks) {
      expect(chunk.page).toBeGreaterThanOrEqual(1);
      expect(chunk.page).toBeLessThanOrEqual(12);
      expect(chunk.text.trim().length).toBeGreaterThan(0);
      // A chunk that ran away would blow the context budget.
      expect(chunk.text.length).toBeLessThan(1400);
    }

    await doc.loadingTask.destroy();
  }, 30_000);

  it("splits real page text into sentences whose offsets still resolve", async () => {
    const doc = await openDocument();
    let text = "";
    for (let n = 1; n <= Math.min(doc.numPages, 8) && text.length < 400; n++) {
      ({ text } = await extract(await doc.getPage(n)));
    }

    for (const sentence of splitSentences(text)) {
      expect(text.slice(sentence.start, sentence.end)).toBe(sentence.text);
    }

    await doc.loadingTask.destroy();
  }, 30_000);
});
