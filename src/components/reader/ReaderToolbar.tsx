"use client";

import Link from "next/link";
import type { Book } from "@/types";
import { IconButton } from "@/components/ui/Button";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import {
  ArrowLeft, Bookmark, Expand, Note, Search, Settings, Sparkle, Speaker,
} from "@/components/ui/Icons";

export type PanelId = "search" | "notes" | "bookmarks" | "settings" | null;

/**
 * The top chrome. Minimal by design: a way back to the library, the book's
 * name, and the tools — nothing that competes with the page.
 */
export function ReaderToolbar({
  book, panel, bookmarked, companionOpen, narrating, live,
  onPanel, onBookmark, onCompanion, onNarrate, onFocusMode,
}: {
  book: Book;
  panel: PanelId;
  bookmarked: boolean;
  companionOpen: boolean;
  narrating: boolean;
  live: boolean;
  onPanel: (panel: PanelId) => void;
  onBookmark: () => void;
  onCompanion: () => void;
  onNarrate: () => void;
  onFocusMode: () => void;
}) {
  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-1 border-b border-rule bg-parchment/90 px-3 backdrop-blur-md sm:px-4">
      <Link
        href="/library"
        className="flex h-9 items-center gap-1.5 rounded-[3px] px-2 text-[0.8rem] text-muted transition-colors hover:bg-[color-mix(in_srgb,var(--color-ink)_5%,transparent)] hover:text-ink"
      >
        <ArrowLeft />
        <span className="hidden sm:inline">Library</span>
      </Link>

      <div className="mx-auto flex min-w-0 flex-col items-center px-3">
        <h1 className="max-w-[min(22rem,48vw)] truncate font-display text-[1rem] font-medium leading-tight text-ink">
          {book.title}
        </h1>
        {book.author && (
          <p className="max-w-[min(22rem,48vw)] truncate text-[0.68rem] text-faint">{book.author}</p>
        )}
      </div>

      <div className="flex items-center gap-0.5">
        <IconButton label="Read aloud" onClick={onNarrate} active={narrating}>
          <Speaker />
        </IconButton>
        <IconButton
          label={bookmarked ? "Remove bookmark (B)" : "Bookmark this page (B)"}
          onClick={onBookmark}
          active={bookmarked}
        >
          <Bookmark filled={bookmarked} />
        </IconButton>

        <span className="mx-1 hidden h-5 w-px bg-rule sm:block" aria-hidden="true" />

        <IconButton
          label="Search in book (⌘F)"
          onClick={() => onPanel(panel === "search" ? null : "search")}
          active={panel === "search"}
          className="max-sm:hidden"
        >
          <Search />
        </IconButton>
        <IconButton
          label="Notes and highlights"
          onClick={() => onPanel(panel === "notes" ? null : "notes")}
          active={panel === "notes"}
          className="max-sm:hidden"
        >
          <Note />
        </IconButton>
        <IconButton
          label="Focus mode (F)"
          onClick={onFocusMode}
          className="max-sm:hidden"
        >
          <Expand />
        </IconButton>
        <IconButton
          label="Reading settings"
          onClick={() => onPanel(panel === "settings" ? null : "settings")}
          active={panel === "settings"}
        >
          <Settings />
        </IconButton>

        <span className="mx-1 hidden h-5 w-px bg-rule sm:block" aria-hidden="true" />
        <ThemeToggle />

        <button
          onClick={onCompanion}
          aria-pressed={companionOpen}
          className={`ml-1 inline-flex h-9 items-center gap-1.5 rounded-[3px] px-2.5 text-[0.78rem] transition-colors ${
            companionOpen
              ? "bg-[color-mix(in_srgb,var(--color-gold)_16%,transparent)] text-gold"
              : "text-muted hover:bg-[color-mix(in_srgb,var(--color-ink)_5%,transparent)] hover:text-ink"
          }`}
          title="AI companion"
        >
          <Sparkle />
          <span className="hidden sm:inline">Companion</span>
          {/* A quiet dot rather than a badge: the AI's presence, not a notification. */}
          <span
            className={`h-1.5 w-1.5 rounded-full ${live ? "bg-gold" : "bg-faint"}`}
            title={live ? "Companion ready" : "No AI key configured"}
            aria-hidden="true"
          />
        </button>
      </div>
    </header>
  );
}
