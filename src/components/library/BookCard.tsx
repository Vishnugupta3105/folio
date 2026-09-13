"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import type { LibraryBook } from "./Library";
import type { ReadingStatus } from "@/types";
import { Check, Trash } from "@/components/ui/Icons";

/**
 * A book on the shelf. The cover is the object; metadata sits beneath it in
 * small type, the way a spine label would.
 */
const STATUSES: { id: ReadingStatus; label: string }[] = [
  { id: "reading", label: "Reading" },
  { id: "finished", label: "Finished" },
  { id: "want-to-read", label: "Want to read" },
];

export function BookCard({
  book, onDelete, onStatus, featured,
}: {
  book: LibraryBook;
  onDelete: (id: string) => void;
  onStatus: (id: string, status: ReadingStatus) => void;
  featured?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const percent = Math.round((book.progress?.progress ?? 0) * 100);
  const page = book.progress?.page ?? 1;
  const preparing = book.indexState === "pending" || book.indexState === "indexing";

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 0.68, 0.16, 1] }}
      className="group relative"
    >
      <Link href={`/reader/${book.id}`} className="block focus-visible:outline-offset-4">
        {/* The cover, with the spine edge that makes it read as a physical object. */}
        <div
          className="relative aspect-[2/3] w-full overflow-hidden rounded-[2px] rounded-l-[1px] bg-paper
            shadow-[0_10px_26px_-12px_rgba(34,32,28,0.45),0_1px_2px_rgba(34,32,28,0.1)]
            ring-1 ring-rule transition-[transform,box-shadow] duration-[350ms] ease-[cubic-bezier(0.22,0.68,0.16,1)]
            group-hover:-translate-y-1.5 group-hover:shadow-[0_20px_38px_-14px_rgba(34,32,28,0.5),0_2px_4px_rgba(34,32,28,0.12)]"
        >
          {book.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={book.coverUrl}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <FallbackCover title={book.title} author={book.author} />
          )}

          {/* Spine shading along the bound edge. */}
          <div
            className="pointer-events-none absolute inset-y-0 left-0 w-[7%]"
            style={{
              background:
                "linear-gradient(to right, color-mix(in srgb, var(--color-ink) 22%, transparent), color-mix(in srgb, var(--color-ink) 4%, transparent) 60%, transparent)",
            }}
          />

          {preparing && (
            <div className="absolute inset-x-0 bottom-0 bg-[color-mix(in_srgb,var(--color-ink)_78%,transparent)] px-2.5 py-1.5 text-center text-[0.62rem] tracking-[0.08em] text-parchment">
              PREPARING
            </div>
          )}

          {percent > 0 && !preparing && (
            <div className="absolute inset-x-0 bottom-0 h-[3px] bg-[color-mix(in_srgb,var(--color-ink)_14%,transparent)]">
              <div className="h-full bg-gold" style={{ width: `${percent}%` }} />
            </div>
          )}
        </div>

        <h3
          className={`mt-3.5 line-clamp-2 font-display leading-[1.28] text-ink ${
            featured ? "text-[1.05rem]" : "text-[0.95rem]"
          }`}
        >
          {book.title}
        </h3>
        {book.author && (
          <p className="mt-1 line-clamp-1 text-[0.75rem] text-muted">{book.author}</p>
        )}
        <p className="lining-figures mt-1.5 text-[0.72rem] text-faint">
          {preparing
            ? "Getting ready…"
            : percent > 0
              ? `${percent}% · p. ${page}${book.pageCount ? ` of ${book.pageCount}` : ""}`
              : book.status === "finished"
                ? "Finished"
                : "Not started"}
        </p>
      </Link>

      {/* Shelf status. Quiet until the card is hovered or focused. */}
      <div className="relative mt-1.5 h-5">
        {choosing ? (
          <div className="absolute left-0 top-0 z-10 flex flex-col gap-px rounded-[3px] border border-rule bg-paper p-1 shadow-[0_10px_26px_-10px_rgba(34,32,28,0.4)]">
            {STATUSES.map((status) => (
              <button
                key={status.id}
                onClick={() => {
                  onStatus(book.id, status.id);
                  setChoosing(false);
                }}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-[2px] px-2 py-1 text-left text-[0.72rem] text-ink transition-colors hover:bg-[color-mix(in_srgb,var(--color-ink)_6%,transparent)]"
              >
                <span className="w-3 shrink-0 text-gold">
                  {book.status === status.id && <Check className="!h-3 !w-3" />}
                </span>
                {status.label}
              </button>
            ))}
          </div>
        ) : (
          <button
            onClick={() => setChoosing(true)}
            className="rounded-[2px] text-[0.7rem] text-faint opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
          >
            {STATUSES.find((s) => s.id === book.status)?.label ?? "Reading"} &middot; change
          </button>
        )}
      </div>

      {/* Removal stays out of the way until the card is hovered or focused. */}
      <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100">
        {confirming ? (
          <div className="flex items-center gap-1 rounded-[3px] bg-paper/95 p-1 shadow-sm ring-1 ring-rule">
            <button
              onClick={() => onDelete(book.id)}
              className="rounded-[2px] px-2 py-1 text-[0.68rem] text-oxblood hover:bg-[color-mix(in_srgb,var(--color-oxblood)_10%,transparent)]"
            >
              Remove
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-[2px] px-2 py-1 text-[0.68rem] text-muted hover:text-ink"
            >
              Keep
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            aria-label={`Remove ${book.title}`}
            className="rounded-[3px] bg-paper/90 p-1.5 text-muted shadow-sm ring-1 ring-rule transition-colors hover:text-oxblood"
          >
            <Trash />
          </button>
        )}
      </div>
    </motion.article>
  );
}

/** Typeset cover for books whose first page gave us nothing usable. */
function FallbackCover({ title, author }: { title: string; author: string | null }) {
  // A stable hue per title so a shelf of fallbacks still looks deliberate.
  const seed = [...title].reduce((a, c) => a + c.charCodeAt(0), 0);
  const tint = ["#efe8da", "#e6e3d8", "#eae4dc", "#e9e6db", "#ece5da"][seed % 5];

  return (
    <div
      className="flex h-full w-full flex-col justify-between p-4"
      style={{ background: tint }}
    >
      <div className="h-px w-full bg-[color-mix(in_srgb,#22201c_18%,transparent)]" />
      <div>
        <p className="line-clamp-5 font-display text-[0.95rem] font-medium leading-[1.24] text-[#22201c]">
          {title}
        </p>
        {author && (
          <p className="mt-2 line-clamp-2 text-[0.64rem] uppercase tracking-[0.12em] text-[#22201c]/55">
            {author}
          </p>
        )}
      </div>
      <div className="h-px w-full bg-[color-mix(in_srgb,#22201c_18%,transparent)]" />
    </div>
  );
}
