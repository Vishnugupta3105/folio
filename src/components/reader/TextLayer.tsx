"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PdfRenderer } from "@/lib/pdf/renderer";
import type { PageText } from "@/lib/pdf/document";
import type { Highlight } from "@/types";

export interface Selection {
  page: number;
  text: string;
  startOffset: number;
  endOffset: number;
  /** Set for EPUB, where a range is a CFI rather than a character offset. */
  cfi?: string | null;
  /** Viewport coordinates of the selection, for positioning the toolbar. */
  rect: { top: number; left: number; width: number; height: number };
}

const TINTS: Record<Highlight["color"], string> = {
  amber: "var(--color-hl-amber)",
  azure: "var(--color-hl-azure)",
  sage: "var(--color-hl-sage)",
  rose: "var(--color-hl-rose)",
  neutral: "var(--color-hl-neutral)",
};

/**
 * The invisible, selectable text sitting exactly over the rendered page.
 *
 * Everything that needs to point at words goes through this layer: selection
 * offsets for highlights, the highlight rectangles themselves, and the sentence
 * the narrator is currently reading. Offsets are character positions in the
 * page's extracted text, which is what the server stores — so a highlight made
 * at one zoom level lands in the right place at any other.
 */
export function TextLayer({
  renderer, page, width, height, highlights, spokenRange, onSelect, onHighlightClick, disabled,
}: {
  renderer: PdfRenderer;
  page: number;
  width: number;
  height: number;
  highlights: Highlight[];
  /** Character range currently being read aloud. */
  spokenRange: { start: number; end: number } | null;
  onSelect: (selection: Selection | null) => void;
  onHighlightClick: (highlight: Highlight) => void;
  disabled?: boolean;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<PageText | null>(null);
  const [scale, setScale] = useState(1);
  const [rects, setRects] = useState<{ id: string; color: string; boxes: DOMRect[] }[]>([]);
  const [spokenBoxes, setSpokenBoxes] = useState<DOMRect[]>([]);
  /** Bumped once the spans have been stretched, so rects measure correctly. */
  const [measureToken, setMeasureToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    renderer.text(page).then((text) => {
      if (!cancelled) setContent(text);
    }).catch(() => {});
    renderer.aspect(page).then(() => {}).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [renderer, page]);

  // pdf.js positions text in PDF units; the layer needs the same scale the
  // canvas was rendered at.
  useEffect(() => {
    let cancelled = false;
    renderer.doc.getPage(page).then((proxy) => {
      if (cancelled) return;
      const viewport = proxy.getViewport({ scale: 1 });
      setScale(width / viewport.width);
      proxy.cleanup();
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [renderer, page, width]);

  /** Builds a DOM Range across the layer for a character range in the page text. */
  const rangeFor = useCallback(
    (start: number, end: number): Range | null => {
      const root = layer.current;
      if (!root || !content) return null;

      const range = document.createRange();
      let placedStart = false;

      for (const span of Array.from(root.querySelectorAll<HTMLElement>("span[data-offset]"))) {
        const from = Number(span.dataset.offset);
        const length = span.textContent?.length ?? 0;
        const to = from + length;
        const node = span.firstChild;
        if (!node) continue;

        if (!placedStart && start < to) {
          range.setStart(node, Math.max(0, Math.min(start - from, length)));
          placedStart = true;
        }
        if (placedStart && end <= to) {
          range.setEnd(node, Math.max(0, Math.min(end - from, length)));
          return range;
        }
        if (placedStart) range.setEnd(node, length);
      }
      return placedStart ? range : null;
    },
    [content],
  );

  const measure = useCallback(
    (start: number, end: number): DOMRect[] => {
      const root = layer.current;
      const range = rangeFor(start, end);
      if (!range || !root) return [];
      const origin = root.getBoundingClientRect();
      return Array.from(range.getClientRects())
        .filter((r) => r.width > 0.5 && r.height > 0.5)
        .map(
          (r) =>
            new DOMRect(r.left - origin.left, r.top - origin.top, r.width, r.height),
        );
    },
    [rangeFor],
  );

  // Highlight rectangles are recomputed whenever the page, its size, or the
  // highlight set changes — never on every frame.
  useEffect(() => {
    if (!content) return;
    const id = requestAnimationFrame(() => {
      setRects(
        highlights.map((h) => ({
          id: h.id,
          color: TINTS[h.color],
          boxes: measure(h.startOffset, h.endOffset),
        })),
      );
    });
    return () => cancelAnimationFrame(id);
  }, [content, highlights, measure, width, height, measureToken]);

  useEffect(() => {
    if (!content || !spokenRange) {
      setSpokenBoxes([]);
      return;
    }
    const id = requestAnimationFrame(() =>
      setSpokenBoxes(measure(spokenRange.start, spokenRange.end)),
    );
    return () => cancelAnimationFrame(id);
  }, [content, spokenRange, measure, width, height, measureToken]);

  /** Turns a browser selection inside this layer into character offsets. */
  const readSelection = useCallback(() => {
    const root = layer.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;

    const spanOf = (node: Node): HTMLElement | null => {
      const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
      return element?.closest<HTMLElement>("span[data-offset]") ?? null;
    };

    const startSpan = spanOf(range.startContainer);
    const endSpan = spanOf(range.endContainer);
    if (!startSpan || !endSpan) return;

    const startOffset = Number(startSpan.dataset.offset) + range.startOffset;
    const endOffset = Number(endSpan.dataset.offset) + range.endOffset;
    const text = selection.toString().replace(/\s+/g, " ").trim();
    if (!text || endOffset <= startOffset) return;

    const box = range.getBoundingClientRect();
    onSelect({
      page,
      text,
      startOffset,
      endOffset,
      rect: { top: box.top, left: box.left, width: box.width, height: box.height },
    });
  }, [onSelect, page]);

  const spans = useMemo(() => {
    if (!content) return null;
    return content.items.map((item, i) => {
      // pdf.js transform is [scaleX, skewY, skewX, scaleY, x, y] in PDF space,
      // where y counts up from the bottom of the page.
      const [, b, , d, x, y] = item.transform;
      const fontHeight = Math.hypot(b || 0, d || 0) || item.height || 10;

      return (
        <span
          key={i}
          data-offset={item.offset}
          data-width={item.width * scale}
          style={{
            left: `${x * scale}px`,
            top: `${height - (y + fontHeight) * scale}px`,
            fontSize: `${fontHeight * scale}px`,
            fontFamily: "serif",
          }}
        >
          {item.text}
        </span>
      );
    });
  }, [content, scale, height]);

  // Each run is stretched horizontally to the width pdf.js measured in the
  // original font. Without this, selection rectangles drift away from the
  // glyphs painted on the canvas — measured rather than guessed, because the
  // substitute font's metrics are never the document's.
  useLayoutEffect(() => {
    const root = layer.current;
    if (!root || !spans) return;

    const id = requestAnimationFrame(() => {
      for (const span of Array.from(root.querySelectorAll<HTMLElement>("span[data-offset]"))) {
        const target = Number(span.dataset.width);
        if (!target) continue;
        span.style.transform = "";
        const natural = span.getBoundingClientRect().width;
        if (natural > 0.5) span.style.transform = `scaleX(${target / natural})`;
      }
      // Rect measurement must happen after the stretch, or highlights land wrong.
      setMeasureToken((n) => n + 1);
    });
    return () => cancelAnimationFrame(id);
  }, [spans, width, height]);

  return (
    <>
      {/* Highlights sit under the text so selection still reads cleanly. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        {rects.map((entry) =>
          entry.boxes.map((box, i) => (
            <div
              key={`${entry.id}-${i}`}
              onClick={() => {
                const highlight = highlights.find((h) => h.id === entry.id);
                if (highlight) onHighlightClick(highlight);
              }}
              className="pointer-events-auto absolute cursor-pointer rounded-[1px] transition-opacity hover:opacity-80"
              style={{
                left: box.x,
                top: box.y - box.height * 0.06,
                width: box.width,
                height: box.height * 1.12,
                background: entry.color,
                mixBlendMode: "multiply",
              }}
            />
          )),
        )}

        {/* The sentence being read aloud. */}
        {spokenBoxes.map((box, i) => (
          <div
            key={`spoken-${i}`}
            className="absolute rounded-[1px]"
            style={{
              left: box.x,
              top: box.y - box.height * 0.1,
              width: box.width,
              height: box.height * 1.2,
              background: "color-mix(in srgb, var(--color-gold) 30%, transparent)",
              mixBlendMode: "multiply",
              transition: "opacity 160ms ease-out",
            }}
          />
        ))}
      </div>

      <div
        ref={layer}
        className="text-layer"
        style={{ pointerEvents: disabled ? "none" : "auto", userSelect: disabled ? "none" : "text" }}
        onMouseUp={readSelection}
        onTouchEnd={readSelection}
      >
        {spans}
      </div>
    </>
  );
}
