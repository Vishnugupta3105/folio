"use client";

import { chunkPages } from "@/lib/retrieval/chunk";
import { detectChapter } from "@/lib/retrieval/chunk";
import { extractPageText, loadDocument, readMetadata, readPageLabels } from "./document";
import { api } from "@/lib/api";

export interface IngestReport {
  title: string | null;
  author: string | null;
  pageCount: number;
  pageLabels: Record<string, string> | null;
  /** True when the document yielded almost no text — a scan, most likely. */
  needsOcr: boolean;
}

const BATCH = 20;

/**
 * Parses an uploaded book in the browser and streams the result to the server.
 *
 * Extraction runs here rather than server-side because pdf.js is already in the
 * page, it works off the main thread, and a 500-page book would otherwise tie up
 * a serverless function for minutes. The book becomes answerable in batches, so
 * the reader can start on page one while page four hundred is still being read.
 */
export async function ingestPdf(
  bookId: string,
  onProgress: (done: number, total: number) => void,
): Promise<IngestReport> {
  const doc = await loadDocument(`/api/books/${bookId}/file`);
  const total = doc.numPages;

  const [meta, pageLabels] = await Promise.all([readMetadata(doc), readPageLabels(doc)]);

  await renderCover(bookId, doc);

  let extractedCharacters = 0;
  let chapter: string | null = null;
  let batch: { page: number; text: string; chapter: string | null }[] = [];

  for (let n = 1; n <= total; n++) {
    const page = await doc.getPage(n);
    const { text } = await extractPageText(page);
    page.cleanup();

    extractedCharacters += text.length;
    // Chapter headings carry forward until the next one is found.
    chapter = detectChapter(text) ?? chapter;
    batch.push({ page: n, text, chapter });

    if (batch.length >= BATCH || n === total) {
      await api(`/api/books/${bookId}/index`, {
        method: "POST",
        body: JSON.stringify({ pages: batch, complete: n === total }),
      });
      batch = [];
      onProgress(n, total);
    }
  }

  return {
    ...meta,
    pageCount: total,
    pageLabels,
    // Under ~80 characters a page across the book means there is no text layer.
    needsOcr: extractedCharacters / Math.max(total, 1) < 80,
  };
}

/** Renders page one to a JPEG and stores it as the book's provisional cover. */
async function renderCover(bookId: string, doc: Awaited<ReturnType<typeof loadDocument>>) {
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const width = 520;
    const scale = width / viewport.width;
    const scaled = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(scaled.width);
    canvas.height = Math.floor(scaled.height);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvas, canvasContext: context, viewport: scaled }).promise;
    page.cleanup();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82),
    );
    if (!blob) return;

    await fetch(`/api/books/${bookId}/cover`, { method: "POST", body: blob });
  } catch {
    // A missing cover is cosmetic — the typeset fallback covers it.
  }
}

export { chunkPages };
