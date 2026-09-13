"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { PdfRenderer } from "@/lib/pdf/renderer";
import type { Highlight } from "@/types";
import { PageSurface } from "./PageSurface";
import { TextLayer, type Selection } from "./TextLayer";

export type Spread = "single" | "double";

interface Props {
  renderer: PdfRenderer;
  page: number;
  spread: Spread;
  zoom: number;
  highlights: Highlight[];
  spokenRange: { page: number; start: number; end: number } | null;
  onSelect: (selection: Selection | null) => void;
  onHighlightClick: (highlight: Highlight) => void;
  onTurn: (page: number) => void;
  /** Dims the document's own paper for reading at night. */
  night: boolean;
}

const FLIP_MS = 620;

/**
 * The book itself.
 *
 * A turn is a real fold: the leaf rotates on the spine in 3D, its back face
 * carrying the next page, with the shadow deepening as it passes vertical.
 * Only transforms and opacity animate, so the whole thing runs on the
 * compositor and never reflows the page beneath it.
 *
 * Text selection always wins over the gesture — the leaf is inert while you are
 * selecting, and turning happens through the margins, the arrows or the keys.
 */
export function BookCanvas({
  renderer, page, spread, zoom, highlights, spokenRange, night,
  onSelect, onHighlightClick, onTurn,
}: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [aspect, setAspect] = useState(1.414); // A4 until the real page reports
  const [flip, setFlip] = useState<{ direction: "next" | "prev"; from: number } | null>(null);
  const still = useReducedMotion();

  const total = renderer.pageCount;
  const isDouble = spread === "double";

  // In a double spread the left page is even and the right is odd, so page one
  // sits alone on the right exactly as it does in a bound book.
  const leftPage = isDouble ? (page % 2 === 0 ? page : page - 1) : page;
  const rightPage = isDouble ? leftPage + 1 : page;

  useEffect(() => {
    renderer.aspect(Math.min(page, total)).then(setAspect).catch(() => {});
  }, [renderer, page, total]);

  // Fit the spread inside the frame, honouring the zoom multiplier.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;

    const fit = () => {
      const available = element.getBoundingClientRect();
      const pad = 24;
      const maxWidth = available.width - pad * 2;
      const maxHeight = available.height - pad * 2;
      if (maxWidth <= 0 || maxHeight <= 0) return;

      const pages = isDouble ? 2 : 1;
      // Width-constrained or height-constrained, whichever binds first.
      const byWidth = maxWidth / pages;
      const byHeight = maxHeight / aspect;
      const pageWidth = Math.min(byWidth, byHeight) * zoom;
      setBox({ width: Math.floor(pageWidth), height: Math.floor(pageWidth * aspect) });
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [aspect, isDouble, zoom]);

  // Keep the neighbouring spread warm so the next turn has nothing to wait for.
  useEffect(() => {
    if (!box.width) return;
    const step = isDouble ? 2 : 1;
    const id = setTimeout(
      () => renderer.prefetch([page + step, page + step + 1, page - step, page - step + 1], box.width),
      120,
    );
    return () => clearTimeout(id);
  }, [renderer, page, box.width, isDouble]);

  const step = isDouble ? 2 : 1;
  const canGoNext = (isDouble ? rightPage : page) < total;
  const canGoPrev = page > 1;

  const turn = useCallback(
    (direction: "next" | "prev") => {
      if (flip) return;
      const target = direction === "next" ? page + step : page - step;
      if (target < 1 || target > total) return;

      // Reduced motion gets a straight cut rather than a fold.
      if (still) {
        onTurn(Math.max(1, Math.min(target, total)));
        return;
      }
      setFlip({ direction, from: page });
    },
    [flip, page, step, total, still, onTurn],
  );

  const commit = useCallback(() => {
    if (!flip) return;
    const target = flip.direction === "next" ? flip.from + step : flip.from - step;
    setFlip(null);
    onTurn(Math.max(1, Math.min(target, total)));
  }, [flip, step, total, onTurn]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ direction: "next" | "prev" }>).detail;
      turn(detail.direction);
    };
    window.addEventListener("folio:turn", handler);
    return () => window.removeEventListener("folio:turn", handler);
  }, [turn]);

  /**
   * Tap a page to turn it, the way you would nudge a real one: the right half
   * goes forward, the left half back.
   *
   * The hard part is telling a tap from the start of a selection. A press that
   * moved more than a few pixels was a drag, and a press that left text
   * selected was a selection — both are left alone. Everything else is a tap.
   */
  const press = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    press.current = { x: event.clientX, y: event.clientY };
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const start = press.current;
    press.current = null;
    if (!start || flip) return;

    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved > 6) return;

    // Selection wins, always.
    const selected = window.getSelection();
    if (selected && !selected.isCollapsed && selected.toString().trim()) return;

    // Don't hijack a click on a highlight, a link, or any control.
    if ((event.target as HTMLElement)?.closest?.("button, a, [data-folio-typing]")) return;

    const page = (event.currentTarget as HTMLElement).getBoundingClientRect();
    turn(event.clientX - page.left > page.width / 2 ? "next" : "prev");
  };

  // Touch: swipe turns the page. A long press falls through to text selection,
  // so a slow drag is never mistaken for a turn.
  const touch = useRef<{ x: number; y: number; at: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY, at: Date.now() };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const elapsed = Date.now() - start.at;
    if (elapsed > 450 || Math.abs(dx) < 55 || Math.abs(dy) > Math.abs(dx)) return;
    turn(dx < 0 ? "next" : "prev");
  };

  const showPage = (n: number) => n >= 1 && n <= total;

  /**
   * During a turn the destination page is already in place beneath the leaf.
   *
   * In a spread the two slots share the work: a forward turn reveals the next
   * recto on the right, a backward turn the previous verso on the left. With a
   * single page there is only one slot, so it has to carry the destination in
   * both directions.
   */
  const staticLeft = flip?.direction === "prev" ? leftPage - step : leftPage;
  const staticRight = !isDouble && flip
    ? flip.direction === "next" ? page + step : page - step
    : flip?.direction === "next" ? rightPage + step : rightPage;

  const pageProps = (n: number) => ({
    renderer,
    page: n,
    width: box.width,
    height: box.height,
    highlights: highlights.filter((h) => h.page === n),
    spokenRange: spokenRange?.page === n ? spokenRange : null,
    onSelect,
    onHighlightClick,
    disabled: Boolean(flip),
  });

  const shadow =
    "0 24px 60px -22px rgba(34,32,28,0.45), 0 3px 10px -3px rgba(34,32,28,0.18)";

  return (
    <div
      ref={frame}
      className="book-stage relative flex h-full w-full items-center justify-center overflow-hidden"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Margin turn zones. Wide enough to hit, narrow enough never to steal a
          selection that starts inside the text block. */}
      <TurnZone side="left" enabled={canGoPrev && !flip} onClick={() => turn("prev")} />
      <TurnZone side="right" enabled={canGoNext && !flip} onClick={() => turn("next")} />

      {box.width > 0 && (
        <div
          className={`relative ${night ? "night-page" : ""}`}
          style={{ width: isDouble ? box.width * 2 : box.width, height: box.height, boxShadow: shadow }}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
        >
          {/* ── Static spread ─────────────────────────────────────────────── */}
          <div className="absolute inset-0 flex">
            {isDouble && (
              <div className="relative" style={{ width: box.width, height: box.height }}>
                {showPage(staticLeft) ? (
                  <>
                    <PageSurface renderer={renderer} page={staticLeft} width={box.width} />
                    <TextLayer {...pageProps(staticLeft)} />
                  </>
                ) : (
                  <InsideCover side="left" />
                )}
              </div>
            )}

            <div className="relative" style={{ width: box.width, height: box.height }}>
              {showPage(staticRight) ? (
                <>
                  <PageSurface renderer={renderer} page={staticRight} width={box.width} />
                  <TextLayer {...pageProps(staticRight)} />
                </>
              ) : (
                <InsideCover side="right" />
              )}
            </div>
          </div>

          {/* The bound edge. */}
          {isDouble && (
            <div
              className="gutter pointer-events-none absolute inset-y-0 left-1/2 z-20 w-9 -translate-x-1/2"
              aria-hidden="true"
            />
          )}

          {/* ── The turning leaf ──────────────────────────────────────────── */}
          <AnimatePresence>
            {flip && (
              <Leaf
                key={`${flip.direction}-${flip.from}`}
                renderer={renderer}
                width={box.width}
                height={box.height}
                isDouble={isDouble}
                direction={flip.direction}
                front={flip.direction === "next" ? (isDouble ? rightPage : page) : (isDouble ? leftPage : page)}
                back={
                  flip.direction === "next"
                    ? isDouble ? rightPage + 1 : page + 1
                    : isDouble ? leftPage - 1 : page - 1
                }
                onDone={commit}
              />
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

/**
 * The leaf: two pages back to back, hinged on the spine.
 *
 * `rotateY` drives it; a gradient scrim over each face deepens as the leaf
 * approaches vertical, which is what sells the fold as a physical object rather
 * than a sliding rectangle.
 */
function Leaf({
  renderer, width, height, isDouble, direction, front, back, onDone,
}: {
  renderer: PdfRenderer;
  width: number;
  height: number;
  isDouble: boolean;
  direction: "next" | "prev";
  front: number;
  back: number;
  onDone: () => void;
}) {
  const forward = direction === "next";
  const total = renderer.pageCount;

  return (
    <motion.div
      className="leaf absolute top-0 z-30"
      style={{
        width,
        height,
        // Forward turns hinge on the left edge of the recto; back turns on the
        // right edge of the verso. In single-page mode the hinge is the spine
        // side of the one visible page.
        left: forward ? (isDouble ? width : 0) : 0,
        transformOrigin: forward ? "left center" : "right center",
      }}
      initial={{ rotateY: 0 }}
      animate={{ rotateY: forward ? -180 : 180 }}
      transition={{ duration: FLIP_MS / 1000, ease: [0.36, 0.06, 0.22, 1] }}
      onAnimationComplete={onDone}
    >
      {/* Front face */}
      <div className="leaf absolute inset-0 overflow-hidden bg-paper">
        {front >= 1 && front <= total ? (
          <PageSurface renderer={renderer} page={front} width={width} />
        ) : (
          <InsideCover side={forward ? "right" : "left"} />
        )}
        <motion.div
          className="pointer-events-none absolute inset-0"
          style={{
            background: forward
              ? "linear-gradient(to left, rgba(34,32,28,0.28), rgba(34,32,28,0) 55%)"
              : "linear-gradient(to right, rgba(34,32,28,0.28), rgba(34,32,28,0) 55%)",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.9, 0.2] }}
          transition={{ duration: FLIP_MS / 1000, times: [0, 0.5, 1] }}
        />
      </div>

      {/* Back face — the page you are turning to */}
      <div
        className="leaf absolute inset-0 overflow-hidden bg-paper"
        style={{ transform: "rotateY(180deg)" }}
      >
        {back >= 1 && back <= total ? (
          <PageSurface renderer={renderer} page={back} width={width} />
        ) : (
          <InsideCover side={forward ? "left" : "right"} />
        )}
        <motion.div
          className="pointer-events-none absolute inset-0"
          style={{
            background: forward
              ? "linear-gradient(to right, rgba(34,32,28,0.3), rgba(34,32,28,0) 55%)"
              : "linear-gradient(to left, rgba(34,32,28,0.3), rgba(34,32,28,0) 55%)",
          }}
          initial={{ opacity: 0.85 }}
          animate={{ opacity: [0.85, 0.9, 0] }}
          transition={{ duration: FLIP_MS / 1000, times: [0, 0.5, 1] }}
        />
      </div>
    </motion.div>
  );
}

/** The blank paper opposite page one, and after the last page. */
function InsideCover({ side }: { side: "left" | "right" }) {
  return (
    <div className="paper-grain h-full w-full bg-parchment-deep" aria-hidden="true">
      <div
        className="h-full w-full"
        style={{
          background:
            side === "left"
              ? "linear-gradient(to left, color-mix(in srgb, var(--color-ink) 6%, transparent), transparent 30%)"
              : "linear-gradient(to right, color-mix(in srgb, var(--color-ink) 6%, transparent), transparent 30%)",
        }}
      />
    </div>
  );
}

function TurnZone({
  side, enabled, onClick,
}: {
  side: "left" | "right";
  enabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!enabled}
      aria-label={side === "left" ? "Previous page" : "Next page"}
      tabIndex={-1}
      className={`group absolute inset-y-0 z-10 w-[clamp(24px,5vw,64px)] ${
        side === "left" ? "left-0" : "right-0"
      } disabled:pointer-events-none disabled:opacity-0`}
    >
      <span
        className={`absolute inset-y-0 w-full opacity-0 transition-opacity duration-300 group-hover:opacity-100 ${
          side === "left"
            ? "bg-gradient-to-r from-[color-mix(in_srgb,var(--color-ink)_7%,transparent)] to-transparent"
            : "bg-gradient-to-l from-[color-mix(in_srgb,var(--color-ink)_7%,transparent)] to-transparent"
        }`}
      />
    </button>
  );
}
