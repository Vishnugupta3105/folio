"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ePub, { type Book as EpubBook, type Rendition } from "epubjs";
import type { Highlight } from "@/types";
import type { Selection } from "./TextLayer";
import type { Spread } from "./BookCanvas";
import { LOCATION_CHARS } from "@/lib/epub/ingest";

const TINTS: Record<Highlight["color"], string> = {
  amber: "#f2dd9a",
  azure: "#bcd3e4",
  sage: "#c4d7bd",
  rose: "#eec6cd",
  neutral: "#e0d9cb",
};

/**
 * The EPUB reader.
 *
 * A reflowable book has no page geometry, so it can't share the PDF's
 * canvas-and-text-layer machinery: epub.js paginates the text itself inside an
 * iframe. That rules out folding a page in 3D — you cannot rotate live document
 * content without rasterising it first, and rasterising would break selection.
 * Per the spec's own rule, selection wins, so turns here are a paper slide
 * rather than a fold. Everything above this component — position, highlights,
 * notes, search, AI, narration — is identical for both formats.
 */
export function EpubCanvas({
  bookId, page, pageCount, spread, zoom, highlights, night,
  onSelect, onHighlightClick, onTurn, onReady,
}: {
  bookId: string;
  page: number;
  pageCount: number;
  spread: Spread;
  zoom: number;
  highlights: Highlight[];
  night: boolean;
  onSelect: (selection: Selection | null) => void;
  onHighlightClick: (highlight: Highlight) => void;
  onTurn: (page: number) => void;
  onReady: (info: { pageCount: number } | { error: string }) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const book = useRef<EpubBook | null>(null);
  const rendition = useRef<Rendition | null>(null);
  const [ready, setReady] = useState(false);

  // The page we last navigated to ourselves, so the rendition telling us where
  // it landed doesn't bounce back as a fresh navigation request.
  const applied = useRef(page);
  const turnRef = useRef(onTurn);
  const selectRef = useRef(onSelect);
  useEffect(() => {
    turnRef.current = onTurn;
    selectRef.current = onSelect;
  });

  // ── Open the book once ───────────────────────────────────────────────────
  useEffect(() => {
    const element = host.current;
    if (!element) return;

    let cancelled = false;
    // Tearing the book down while it is still opening leaves the in-flight
    // request to resolve against a destroyed instance, which then re-probes for
    // an unpacked EPUB and 404s. Destruction waits for the open to settle.
    let settled = false;

    const teardown = () => {
      try {
        rendition.current?.destroy();
        instance.destroy();
      } catch {
        /* already torn down */
      }
      rendition.current = null;
      book.current = null;
    };
    // `openAs` is required: our file route has no .epub extension, and without
    // it epub.js looks for an unpacked directory and never becomes ready.
    const instance = ePub(`/api/books/${bookId}/file`, { openAs: "epub" });
    book.current = instance;

    instance.ready
      .then(async () => {
        if (cancelled) return;
        await instance.locations.generate(LOCATION_CHARS);
        if (cancelled) return;

        const view = instance.renderTo(element, {
          width: "100%",
          height: "100%",
          flow: "paginated",
          spread: "none",
          allowScriptedContent: false,
        });
        rendition.current = view;

        /**
         * Tap a page to turn it. The click happens inside the iframe, so it
         * never reaches this document — epub.js hands us each section's
         * document as it renders, and the listener goes on there instead.
         */
        view.hooks.content.register((contents: { document: Document; window: Window }) => {
          let start: { x: number; y: number } | null = null;

          contents.document.addEventListener("pointerdown", (event: PointerEvent) => {
            start = { x: event.clientX, y: event.clientY };
          });

          contents.document.addEventListener("pointerup", (event: PointerEvent) => {
            const from = start;
            start = null;
            if (!from) return;
            if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > 6) return;

            // Selection and links win over the gesture.
            const selected = contents.window.getSelection();
            if (selected && !selected.isCollapsed && selected.toString().trim()) return;
            if ((event.target as HTMLElement)?.closest?.("a")) return;

            const width = contents.document.documentElement.clientWidth || 1;
            void (event.clientX > width / 2 ? view.next() : view.prev());
          });
        });

        view.on("relocated", (location: { start?: { cfi?: string } }) => {
          const cfi = location?.start?.cfi;
          if (!cfi) return;
          const at = instance.locations.locationFromCfi(cfi);
          const next = Math.max(1, (Number(at) || 0) + 1);
          if (next !== applied.current) {
            applied.current = next;
            turnRef.current(next);
          }
        });

        // Selection inside the iframe: the text and the range come from epub.js,
        // the rectangle has to be translated out of the iframe's coordinates.
        view.on("selected", async (cfiRange: string, contents: { window: Window }) => {
          try {
            const range = await instance.getRange(cfiRange);
            const text = range?.toString().replace(/\s+/g, " ").trim() ?? "";
            if (!text) return;

            const inner = contents.window.getSelection()?.getRangeAt(0).getBoundingClientRect();
            const frame = contents.window.frameElement?.getBoundingClientRect();
            const rect =
              inner && frame
                ? {
                    top: frame.top + inner.top,
                    left: frame.left + inner.left,
                    width: inner.width,
                    height: inner.height,
                  }
                : { top: 120, left: 120, width: 0, height: 0 };

            selectRef.current({
              page: applied.current,
              text,
              startOffset: 0,
              endOffset: text.length,
              cfi: cfiRange,
              rect,
            });
          } catch {
            /* A selection we can't resolve is simply ignored. */
          }
        });

        await view.display(instance.locations.cfiFromLocation(Math.max(0, page - 1)) || undefined);
        if (cancelled) return;

        applied.current = page;
        setReady(true);
        onReady({ pageCount: Math.max(1, instance.locations.length()) });
      })
      .catch(() => {
        if (!cancelled) {
          onReady({ error: "This EPUB couldn't be opened. The file may be damaged." });
        }
      })
      .finally(() => {
        settled = true;
        if (cancelled) teardown();
      });

    return () => {
      cancelled = true;
      if (settled) teardown();
    };
    // Deliberately opens once: page changes are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  // ── Navigate when the page changes from outside ──────────────────────────
  useEffect(() => {
    const view = rendition.current;
    const instance = book.current;
    if (!ready || !view || !instance || page === applied.current) return;

    applied.current = page;
    const cfi = instance.locations.cfiFromLocation(Math.max(0, page - 1));
    if (cfi) void view.display(cfi);
  }, [page, ready]);

  // ── Typography, theme and zoom ───────────────────────────────────────────
  useEffect(() => {
    const view = rendition.current;
    if (!view || !ready) return;

    // A reflowable book should look like the rest of Folio: warm paper, a
    // serif face, generous measure — and legible at night.
    view.themes.register("folio", {
      body: {
        "background": night ? "#1e1b16" : "#fffdf8",
        "color": night ? "#e9e1d1" : "#22201c",
        "font-family": "'Iowan Old Style', Georgia, serif",
        "line-height": "1.62",
        "padding": "0 6% !important",
        "text-align": "justify",
        "hyphens": "auto",
      },
      "p, li": { "color": night ? "#cfc6b5" : "#4a463f" },
      "h1, h2, h3": { "color": night ? "#e9e1d1" : "#22201c", "font-weight": "600" },
      "a": { "color": night ? "#c4787a" : "#75292c" },
      "::selection": { background: "rgba(154,127,63,0.34)" },
    });
    view.themes.select("folio");
    view.themes.fontSize(`${Math.round(zoom * 100)}%`);
  }, [ready, night, zoom]);

  // ── Highlights ───────────────────────────────────────────────────────────
  const painted = useRef(new Set<string>());
  useEffect(() => {
    const view = rendition.current;
    if (!view || !ready) return;

    for (const highlight of highlights) {
      if (!highlight.cfi || painted.current.has(highlight.id)) continue;
      try {
        view.annotations.highlight(
          highlight.cfi,
          {},
          () => onHighlightClick(highlight),
          undefined,
          { fill: TINTS[highlight.color], "fill-opacity": "0.45", "mix-blend-mode": "multiply" },
        );
        painted.current.add(highlight.id);
      } catch {
        /* A range that no longer resolves is skipped rather than throwing. */
      }
    }

    // Remove anything that was deleted while the book stayed open.
    const live = new Set(highlights.map((h) => h.id));
    for (const id of painted.current) {
      if (live.has(id)) continue;
      const gone = highlights.find((h) => h.id === id);
      if (gone?.cfi) {
        try {
          view.annotations.remove(gone.cfi, "highlight");
        } catch {
          /* already gone */
        }
      }
      painted.current.delete(id);
    }
  }, [highlights, ready, onHighlightClick]);

  // ── Turning ──────────────────────────────────────────────────────────────
  const turn = useCallback((direction: "next" | "prev") => {
    const view = rendition.current;
    if (!view) return;
    void (direction === "next" ? view.next() : view.prev());
  }, []);

  useEffect(() => {
    const handler = (event: Event) =>
      turn((event as CustomEvent<{ direction: "next" | "prev" }>).detail.direction);
    window.addEventListener("folio:turn", handler);
    return () => window.removeEventListener("folio:turn", handler);
  }, [turn]);

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden p-6">
      <button
        onClick={() => turn("prev")}
        disabled={page <= 1}
        aria-label="Previous page"
        tabIndex={-1}
        className="group absolute inset-y-0 left-0 z-10 w-[clamp(24px,5vw,64px)] disabled:pointer-events-none disabled:opacity-0"
      >
        <span className="absolute inset-y-0 w-full bg-gradient-to-r from-[color-mix(in_srgb,var(--color-ink)_7%,transparent)] to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      </button>
      <button
        onClick={() => turn("next")}
        disabled={page >= pageCount}
        aria-label="Next page"
        tabIndex={-1}
        className="group absolute inset-y-0 right-0 z-10 w-[clamp(24px,5vw,64px)] disabled:pointer-events-none disabled:opacity-0"
      >
        <span className="absolute inset-y-0 w-full bg-gradient-to-l from-[color-mix(in_srgb,var(--color-ink)_7%,transparent)] to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      </button>

      <div
        className="relative h-full w-full max-w-[min(100%,58rem)] overflow-hidden rounded-[2px] bg-paper shadow-[0_24px_60px_-22px_rgba(34,32,28,0.45),0_3px_10px_-3px_rgba(34,32,28,0.18)]"
        style={{ maxWidth: spread === "double" ? undefined : "42rem" }}
      >
        <div ref={host} className="h-full w-full" />
        {!ready && (
          <p className="absolute inset-0 flex items-center justify-center font-display text-[1rem] italic text-faint">
            Setting the type…
          </p>
        )}
      </div>
    </div>
  );
}
