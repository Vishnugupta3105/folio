"use client";

import { extractPageText, loadDocument, renderPageToCanvas, type PageText, type PDFDocumentProxy } from "./document";
import { record } from "@/lib/perf";

/**
 * Rasterises pages once and keeps the bitmaps.
 *
 * Turning a page has to be instant, and a page turn needs up to four pages on
 * screen at once (two static, two on the moving leaf). Rendering each of those
 * on demand would stutter, so pages are rasterised to ImageBitmaps, cached, and
 * blitted — and the spread on either side is warmed while the reader is idle.
 */
export class PdfRenderer {
  private readonly bitmaps = new Map<string, ImageBitmap>();
  private readonly pending = new Map<string, Promise<ImageBitmap>>();
  private readonly texts = new Map<number, Promise<PageText>>();
  private readonly order: string[] = [];
  private readonly limit = 14;

  private constructor(readonly doc: PDFDocumentProxy) {}

  static async open(url: string): Promise<PdfRenderer> {
    return new PdfRenderer(await loadDocument(url));
  }

  get pageCount(): number {
    return this.doc.numPages;
  }

  /** Intrinsic aspect ratio (height / width) of a page, for layout before render. */
  private ratios = new Map<number, number>();

  async aspect(page: number): Promise<number> {
    const cached = this.ratios.get(page);
    if (cached) return cached;
    const p = await this.doc.getPage(page);
    const viewport = p.getViewport({ scale: 1 });
    const ratio = viewport.height / viewport.width;
    this.ratios.set(page, ratio);
    return ratio;
  }

  /** Width is rounded so small resize jitters don't invalidate the cache. */
  private key(page: number, width: number): string {
    return `${page}@${Math.round(width / 8) * 8}`;
  }

  async bitmap(page: number, width: number): Promise<ImageBitmap> {
    const key = this.key(page, width);

    const cached = this.bitmaps.get(key);
    if (cached) return cached;

    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;

    const job = this.rasterise(page, Math.round(width / 8) * 8)
      .then((bitmap) => {
        this.bitmaps.set(key, bitmap);
        this.order.push(key);
        this.evict();
        this.pending.delete(key);
        return bitmap;
      })
      .catch((error) => {
        this.pending.delete(key);
        throw error;
      });

    this.pending.set(key, job);
    return job;
  }

  private async rasterise(page: number, width: number): Promise<ImageBitmap> {
    const started = performance.now();
    const proxy = await this.doc.getPage(page);

    // Cap the device pixel ratio: beyond 2x the extra pixels cost render time
    // without being visible, and a 500-page book would exhaust memory.
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const canvas = document.createElement("canvas");
    await renderPageToCanvas(proxy, canvas, width, dpr);
    proxy.cleanup();

    const bitmap = await createImageBitmap(canvas);
    // Release the intermediate canvas immediately — Safari holds onto them.
    canvas.width = 0;
    canvas.height = 0;

    record("page:render", performance.now() - started);
    return bitmap;
  }

  private evict(): void {
    while (this.order.length > this.limit) {
      const key = this.order.shift();
      if (!key) break;
      this.bitmaps.get(key)?.close();
      this.bitmaps.delete(key);
    }
  }

  text(page: number): Promise<PageText> {
    let job = this.texts.get(page);
    if (!job) {
      job = this.doc.getPage(page).then(async (proxy) => {
        const result = await extractPageText(proxy);
        proxy.cleanup();
        return result;
      });
      this.texts.set(page, job);
    }
    return job;
  }

  /** Warms pages the reader is likely to reach next. Failures are ignored. */
  prefetch(pages: number[], width: number): void {
    for (const page of pages) {
      if (page >= 1 && page <= this.pageCount) {
        void this.bitmap(page, width).catch(() => {});
        void this.text(page).catch(() => {});
      }
    }
  }

  destroy(): void {
    for (const bitmap of this.bitmaps.values()) bitmap.close();
    this.bitmaps.clear();
    this.order.length = 0;
    // The loading task owns the worker; destroying the proxy alone leaks it.
    void this.doc.loadingTask?.destroy();
  }
}
