"use client";

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

/**
 * pdf.js plumbing.
 *
 * The library is imported lazily, on first use. A top-level import would pull
 * the whole of pdf.js into the server render of every client component that
 * touches this module, where it warns and does nothing useful.
 *
 * The worker is copied into /public at install time (scripts/copy-pdf-assets),
 * so parsing and rasterising never touch the main thread — this is what keeps
 * page turns smooth while a long book is still being indexed.
 */
type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;

async function pdfjs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((module) => {
      module.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return module;
    });
  }
  return pdfjsPromise;
}

export interface TextItem {
  text: string;
  /** Character offset of this item within the page's full text. */
  offset: number;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
}

export interface PageText {
  page: number;
  text: string;
  items: TextItem[];
}

export async function loadDocument(url: string): Promise<PDFDocumentProxy> {
  const { getDocument } = await pdfjs();
  return getDocument({
    url,
    // Range requests let a 500-page book start rendering almost immediately.
    disableRange: false,
    disableStream: false,
    // Standard fonts are needed for documents that don't embed them.
    // Served from /public and version-matched to the installed pdf.js.
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
  }).promise;
}

/** Extracts a page's text plus the offset of every item, which highlights need. */
export async function extractPageText(page: PDFPageProxy): Promise<PageText> {
  const content = await page.getTextContent();
  const items: TextItem[] = [];
  let text = "";

  for (const raw of content.items) {
    if (!("str" in raw)) continue;
    const item = raw as {
      str: string; transform: number[]; width: number; height: number;
      fontName: string; hasEOL?: boolean;
    };
    if (item.str) {
      items.push({
        text: item.str,
        offset: text.length,
        transform: item.transform,
        width: item.width,
        height: item.height,
        fontName: item.fontName,
      });
      text += item.str;
    }
    // pdf.js marks line ends; without this every page is one run-on line.
    if (item.hasEOL) text += "\n";
    else if (item.str && !item.str.endsWith(" ")) text += " ";
  }

  return { page: page.pageNumber, text, items };
}

/** Printed page labels ("xii", "3") when the document declares them. */
export async function readPageLabels(
  doc: PDFDocumentProxy,
): Promise<Record<string, string> | null> {
  try {
    const labels = await doc.getPageLabels();
    if (!labels) return null;
    const map: Record<string, string> = {};
    let differs = false;
    labels.forEach((label, i) => {
      map[String(i + 1)] = label;
      if (label !== String(i + 1)) differs = true;
    });
    // Only worth storing when the printed numbering actually diverges from the
    // physical index — otherwise it's noise.
    return differs ? map : null;
  } catch {
    return null;
  }
}

export async function readMetadata(
  doc: PDFDocumentProxy,
): Promise<{ title: string | null; author: string | null }> {
  try {
    const meta = await doc.getMetadata();
    const info = meta.info as { Title?: string; Author?: string } | undefined;
    const clean = (v?: string) => {
      const t = v?.trim();
      // Producers love to leave the source filename in the Title field.
      return t && t.length > 1 && !/\.(pdf|docx?|indd)$/i.test(t) ? t : null;
    };
    return { title: clean(info?.Title), author: clean(info?.Author) };
  } catch {
    return { title: null, author: null };
  }
}

/** Renders a page to a canvas at the given CSS width, accounting for DPR. */
export async function renderPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  cssWidth: number,
  dpr: number,
): Promise<{ width: number; height: number; scale: number }> {
  const base = page.getViewport({ scale: 1 });
  const scale = cssWidth / base.width;
  const viewport = page.getViewport({ scale: scale * dpr });

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${Math.floor(base.height * scale)}px`;

  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas unavailable");

  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return { width: cssWidth, height: base.height * scale, scale };
}

export type { PDFDocumentProxy, PDFPageProxy };
