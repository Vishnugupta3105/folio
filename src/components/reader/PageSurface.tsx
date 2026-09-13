"use client";

import { useEffect, useRef, useState } from "react";
import type { PdfRenderer } from "@/lib/pdf/renderer";

/**
 * One rendered page. Draws the cached bitmap; shows ruled placeholder lines
 * while a page it hasn't seen before rasterises, so a turn never shows a hole.
 */
export function PageSurface({
  renderer, page, width, className = "", blank,
}: {
  renderer: PdfRenderer;
  page: number;
  width: number;
  className?: string;
  /** Renders the paper with no content — used for the inside-cover position. */
  blank?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (blank || !width) return;
    let cancelled = false;
    setReady(false);

    renderer
      .bitmap(page, width)
      .then((bitmap) => {
        const element = canvas.current;
        if (cancelled || !element) return;
        element.width = bitmap.width;
        element.height = bitmap.height;
        const context = element.getContext("2d", { alpha: false });
        if (!context) return;
        context.drawImage(bitmap, 0, 0);
        setReady(true);
      })
      .catch(() => {
        /* A page that won't render leaves the placeholder in place. */
      });

    return () => {
      cancelled = true;
    };
  }, [renderer, page, width, blank]);

  return (
    <div className={`relative h-full w-full overflow-hidden bg-paper ${className}`}>
      {!blank && (
        <canvas
          ref={canvas}
          className="block h-full w-full"
          style={{ opacity: ready ? 1 : 0, transition: "opacity 140ms ease-out" }}
        />
      )}
      {!ready && !blank && <PagePlaceholder />}
    </div>
  );
}

/** Ruled lines rather than a spinner — it reads as paper, not as loading. */
function PagePlaceholder() {
  return (
    <div className="absolute inset-0 flex flex-col justify-start gap-[1.35%] px-[11%] py-[14%]" aria-hidden="true">
      {Array.from({ length: 22 }).map((_, i) => (
        <div
          key={i}
          className="h-[0.55%] shrink-0 rounded-full bg-rule"
          style={{ width: `${[100, 98, 99, 96, 100, 92][i % 6]}%`, opacity: 0.55 }}
        />
      ))}
    </div>
  );
}
