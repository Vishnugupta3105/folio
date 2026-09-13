"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { IconButton } from "@/components/ui/Button";
import { ArrowLeft, ArrowRight, Minus, Plus, Sparkle } from "@/components/ui/Icons";
import type { Spread } from "./BookCanvas";

export const ZOOM_STEPS = [0.75, 0.9, 1, 1.15, 1.35, 1.6, 2, 2.5];

/**
 * The bottom chrome: where you are, how to move, and how big the page is.
 * "Explain this page" lives here because it is about the page, not a selection.
 */
export function ReaderControls({
  page, pageCount, pageLabel, zoom, spread, progress, explaining,
  onTurn, onGoTo, onZoom, onFitWidth, onSpread, onExplainPage,
}: {
  page: number;
  pageCount: number;
  pageLabel: string | null;
  zoom: number;
  spread: Spread;
  progress: number;
  explaining: boolean;
  onTurn: (direction: "next" | "prev") => void;
  onGoTo: (page: number) => void;
  onZoom: (zoom: number) => void;
  onFitWidth: () => void;
  onSpread: (spread: Spread) => void;
  onExplainPage: () => void;
}) {
  const [jump, setJump] = useState("");
  const stepIndex = ZOOM_STEPS.findIndex((z) => z >= zoom - 0.001);

  return (
    <footer className="relative z-30 shrink-0 border-t border-rule bg-parchment/90 backdrop-blur-md">
      {/* Progress through the book, as a hairline rather than a widget. */}
      <div className="absolute -top-px left-0 h-px w-full bg-rule">
        <motion.div
          className="h-full bg-gold"
          animate={{ width: `${Math.round(progress * 100)}%` }}
          transition={{ duration: 0.45, ease: "easeOut" }}
        />
      </div>

      <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
        <div className="flex items-center gap-0.5">
          <IconButton label="Previous page (←)" onClick={() => onTurn("prev")} disabled={page <= 1}>
            <ArrowLeft />
          </IconButton>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const target = Number(jump);
              if (target >= 1 && target <= pageCount) onGoTo(target);
              setJump("");
            }}
            data-folio-typing
            className="flex items-center gap-1.5 px-1"
          >
            <input
              value={jump}
              onChange={(e) => setJump(e.target.value.replace(/\D/g, ""))}
              placeholder={String(page)}
              aria-label={`Page ${page} of ${pageCount}. Type a page number to jump.`}
              className="lining-figures h-7 w-11 rounded-[2px] border border-transparent bg-transparent text-center font-display text-[0.92rem] text-ink transition-colors placeholder:text-ink hover:border-rule focus:border-gold focus:outline-none"
            />
            <span className="lining-figures select-none font-display text-[0.85rem] text-faint">
              / {pageCount || "—"}
            </span>
          </form>

          <IconButton
            label="Next page (→)"
            onClick={() => onTurn("next")}
            disabled={page >= pageCount}
          >
            <ArrowRight />
          </IconButton>

          {/* The printed page number, when it differs from the physical index. */}
          {pageLabel && pageLabel !== String(page) && (
            <span
              className="ml-1 hidden font-display text-[0.72rem] italic text-faint sm:inline"
              title="Printed page number"
            >
              printed {pageLabel}
            </span>
          )}
        </div>

        <button
          onClick={onExplainPage}
          disabled={explaining}
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-[3px] border border-rule px-2.5 text-[0.76rem] text-ink-soft transition-colors hover:border-gold hover:text-gold disabled:opacity-45"
        >
          <Sparkle className="!h-3.5 !w-3.5" />
          <span className="hidden sm:inline">{explaining ? "Reading the page…" : "Explain this page"}</span>
          <span className="sm:hidden">Explain</span>
        </button>

        <div className="ml-2 flex items-center gap-0.5">
          <IconButton
            label="Zoom out"
            onClick={() => onZoom(ZOOM_STEPS[Math.max(stepIndex - 1, 0)])}
            disabled={stepIndex <= 0}
          >
            <Minus />
          </IconButton>
          <button
            onClick={onFitWidth}
            title="Fit the page (0)"
            className="h-8 min-w-[3.1rem] rounded-[3px] px-1.5 text-[0.74rem] tabular-nums text-muted transition-colors hover:bg-[color-mix(in_srgb,var(--color-ink)_5%,transparent)] hover:text-ink"
          >
            {Math.round(zoom * 100)}%
          </button>
          <IconButton
            label="Zoom in"
            onClick={() => onZoom(ZOOM_STEPS[Math.min(stepIndex + 1, ZOOM_STEPS.length - 1)])}
            disabled={stepIndex >= ZOOM_STEPS.length - 1}
          >
            <Plus />
          </IconButton>

          <button
            onClick={() => onSpread(spread === "double" ? "single" : "double")}
            title={spread === "double" ? "Show one page" : "Show two pages"}
            className="ml-1 hidden h-8 items-center rounded-[3px] px-2 text-[0.74rem] text-muted transition-colors hover:bg-[color-mix(in_srgb,var(--color-ink)_5%,transparent)] hover:text-ink lg:flex"
          >
            {spread === "double" ? "Two pages" : "One page"}
          </button>
        </div>
      </div>
    </footer>
  );
}
