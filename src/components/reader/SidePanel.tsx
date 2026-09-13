"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Bookmark as BookmarkType, Highlight, Note as NoteType, Preferences } from "@/types";
import type { PanelId } from "./ReaderToolbar";
import type { Spread } from "./BookCanvas";
import { api } from "@/lib/api";
import { Close, Search as SearchIcon, Trash } from "@/components/ui/Icons";
import { IconButton } from "@/components/ui/Button";

interface SearchHit {
  page: number;
  chapter: string | null;
  snippet: string;
}

const TITLES: Record<NonNullable<PanelId>, string> = {
  search: "Search in book",
  notes: "Notes & highlights",
  bookmarks: "Bookmarks",
  settings: "Reading",
};

/** The left rail. One panel at a time, never more than a third of the width. */
export function SidePanel({
  panel, bookId, highlights, notes, bookmarks, preferences, spread, indexReady,
  onClose, onGoTo, onDeleteHighlight, onDeleteNote, onDeleteBookmark, onPreferences, onSpread,
  dark, dimPage, onDimPage,
}: {
  panel: PanelId;
  bookId: string;
  highlights: Highlight[];
  notes: NoteType[];
  bookmarks: BookmarkType[];
  preferences: Preferences;
  spread: Spread;
  indexReady: boolean;
  onClose: () => void;
  onGoTo: (page: number) => void;
  onDeleteHighlight: (id: string) => void;
  onDeleteNote: (id: string) => void;
  onDeleteBookmark: (id: string) => void;
  onPreferences: (patch: Partial<Preferences>) => void;
  onSpread: (spread: Spread) => void;
  dark: boolean;
  dimPage: boolean;
  onDimPage: () => void;
}) {
  return (
    <AnimatePresence>
      {panel && (
        <motion.aside
          key="panel"
          initial={{ x: "-100%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "-100%", opacity: 0 }}
          transition={{ type: "spring", stiffness: 340, damping: 36, mass: 0.8 }}
          className="absolute inset-y-0 left-0 z-30 flex w-[min(21rem,88vw)] flex-col border-r border-rule bg-paper shadow-[20px_0_44px_-24px_rgba(34,32,28,0.4)]"
          aria-label={TITLES[panel]}
        >
          <header className="flex items-center gap-2 border-b border-rule px-4 py-3.5">
            <h2 className="label !text-ink">{TITLES[panel]}</h2>
            <IconButton label="Close panel" onClick={onClose} className="ml-auto">
              <Close />
            </IconButton>
          </header>

          <div className="scroll-quiet flex-1 overflow-y-auto overscroll-contain">
            {panel === "search" && (
              <SearchPanel bookId={bookId} indexReady={indexReady} onGoTo={onGoTo} />
            )}
            {panel === "notes" && (
              <NotesPanel
                highlights={highlights}
                notes={notes}
                onGoTo={onGoTo}
                onDeleteHighlight={onDeleteHighlight}
                onDeleteNote={onDeleteNote}
              />
            )}
            {panel === "bookmarks" && (
              <BookmarksPanel
                bookmarks={bookmarks}
                onGoTo={onGoTo}
                onDelete={onDeleteBookmark}
              />
            )}
            {panel === "settings" && (
              <SettingsPanel
                preferences={preferences}
                spread={spread}
                onPreferences={onPreferences}
                onSpread={onSpread}
                dark={dark}
                dimPage={dimPage}
                onDimPage={onDimPage}
              />
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function SearchPanel({
  bookId, indexReady, onGoTo,
}: {
  bookId: string;
  indexReady: boolean;
  onGoTo: (page: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  // Debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    setSearching(true);
    const id = setTimeout(async () => {
      try {
        const data = await api<{ results: SearchHit[] }>(
          `/api/books/${bookId}/search?q=${encodeURIComponent(term)}`,
        );
        setResults(data.results);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 240);
    return () => clearTimeout(id);
  }, [query, bookId]);

  return (
    <div data-folio-typing>
      <div className="border-b border-rule p-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a word or phrase…"
            className="h-9 w-full rounded-[3px] border border-rule bg-parchment pl-8 pr-3 text-[0.84rem] text-ink placeholder:text-faint focus:border-gold focus:outline-none"
          />
        </div>
        {!indexReady && (
          <p className="mt-2 text-[0.72rem] leading-relaxed text-faint">
            Still reading this book. Search will cover more of it as it finishes.
          </p>
        )}
      </div>

      {searching && !results && <Hint>Searching…</Hint>}
      {results?.length === 0 && <Hint>Nothing matched that.</Hint>}

      <ul>
        {results?.map((hit, i) => (
          <li key={i}>
            <button
              onClick={() => onGoTo(hit.page)}
              className="block w-full border-b border-rule px-4 py-3 text-left transition-colors hover:bg-parchment-deep/60"
            >
              <p className="label !text-[0.6rem]">
                {hit.chapter ? `${hit.chapter} — ` : ""}Page {hit.page}
              </p>
              <p className="mt-1.5 line-clamp-3 font-display text-[0.84rem] leading-[1.55] text-ink-soft">
                {hit.snippet}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NotesPanel({
  highlights, notes, onGoTo, onDeleteHighlight, onDeleteNote,
}: {
  highlights: Highlight[];
  notes: NoteType[];
  onGoTo: (page: number) => void;
  onDeleteHighlight: (id: string) => void;
  onDeleteNote: (id: string) => void;
}) {
  const entries = [
    ...highlights.map((h) => ({ kind: "highlight" as const, page: h.page, item: h })),
    ...notes.map((n) => ({ kind: "note" as const, page: n.page, item: n })),
  ].sort((a, b) => a.page - b.page);

  if (!entries.length) {
    return <Hint>Nothing marked yet. Select a passage to highlight it or attach a note.</Hint>;
  }

  return (
    <ul>
      {entries.map((entry) => (
        <li
          key={`${entry.kind}-${entry.item.id}`}
          className="group border-b border-rule px-4 py-3"
        >
          <div className="flex items-start gap-2">
            <button onClick={() => onGoTo(entry.page)} className="min-w-0 flex-1 text-left">
              <p className="label !text-[0.6rem]">
                {entry.kind === "highlight" ? "Highlight" : "Note"} · p. {entry.page}
              </p>

              {entry.kind === "highlight" ? (
                <p
                  className="mt-1.5 line-clamp-4 font-display text-[0.86rem] leading-[1.55] text-ink"
                  style={{
                    boxShadow: `inset 0 -0.55em 0 var(--color-hl-${entry.item.color})`,
                  }}
                >
                  {entry.item.text}
                </p>
              ) : (
                <>
                  {entry.item.selectedText && (
                    <p className="mt-1.5 line-clamp-2 border-l-2 border-rule pl-2 font-display text-[0.78rem] italic leading-snug text-muted">
                      {entry.item.selectedText}
                    </p>
                  )}
                  <p className="mt-1.5 line-clamp-4 text-[0.82rem] leading-relaxed text-ink-soft">
                    {entry.item.content}
                  </p>
                </>
              )}
            </button>

            <button
              onClick={() =>
                entry.kind === "highlight"
                  ? onDeleteHighlight(entry.item.id)
                  : onDeleteNote(entry.item.id)
              }
              aria-label={`Delete this ${entry.kind}`}
              className="shrink-0 rounded-[2px] p-1 text-faint opacity-0 transition-opacity hover:text-oxblood focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Trash />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function BookmarksPanel({
  bookmarks, onGoTo, onDelete,
}: {
  bookmarks: BookmarkType[];
  onGoTo: (page: number) => void;
  onDelete: (id: string) => void;
}) {
  if (!bookmarks.length) {
    return <Hint>No bookmarks yet. Press B while reading to mark a page.</Hint>;
  }

  return (
    <ul>
      {bookmarks.map((bookmark) => (
        <li key={bookmark.id} className="group flex items-center gap-2 border-b border-rule px-4">
          <button
            onClick={() => onGoTo(bookmark.page)}
            className="flex-1 py-3 text-left font-display text-[0.92rem] text-ink"
          >
            Page {bookmark.page}
            {bookmark.label && (
              <span className="ml-2 text-[0.76rem] text-muted">{bookmark.label}</span>
            )}
          </button>
          <button
            onClick={() => onDelete(bookmark.id)}
            aria-label={`Remove bookmark on page ${bookmark.page}`}
            className="rounded-[2px] p-1 text-faint opacity-0 transition-opacity hover:text-oxblood focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Trash />
          </button>
        </li>
      ))}
    </ul>
  );
}

function SettingsPanel({
  preferences, spread, onPreferences, onSpread, dark, dimPage, onDimPage,
}: {
  preferences: Preferences;
  spread: Spread;
  onPreferences: (patch: Partial<Preferences>) => void;
  onSpread: (spread: Spread) => void;
  dark: boolean;
  dimPage: boolean;
  onDimPage: () => void;
}) {
  return (
    <div className="space-y-6 p-4">
      <Setting label="Page layout">
        <div className="flex gap-1.5">
          {(["double", "single"] as const).map((value) => (
            <button
              key={value}
              onClick={() => onSpread(value)}
              className={`flex-1 rounded-[3px] border px-2 py-1.5 text-[0.76rem] transition-colors ${
                spread === value
                  ? "border-gold text-gold"
                  : "border-rule text-muted hover:text-ink"
              }`}
            >
              {value === "double" ? "Two pages" : "One page"}
            </button>
          ))}
        </div>
      </Setting>

      {dark && (
        <Setting
          label="Dim the page"
          hint="Turns the document's own paper warm and dark, so a bright PDF doesn't undo dark mode."
        >
          <Switch on={dimPage} onToggle={onDimPage} />
        </Setting>
      )}

      <Setting label="AI voice replies" hint="Answers are spoken aloud as they stream.">
        <Switch
          on={preferences.voiceReplies}
          onToggle={() => onPreferences({ voiceReplies: !preferences.voiceReplies })}
        />
      </Setting>

      <div className="rounded-[3px] border border-rule bg-parchment-deep/50 p-3">
        <p className="label mb-2.5 !text-[0.6rem]">Shortcuts</p>
        <dl className="space-y-1.5 text-[0.75rem]">
          {[
            ["Hold space", "Ask out loud"],
            ["← →", "Turn the page"],
            ["⌘F", "Search in book"],
            ["B", "Bookmark"],
            ["N", "New note"],
            ["H", "Highlight selection"],
            ["F", "Focus mode"],
            ["Esc", "Close / exit focus"],
          ].map(([key, action]) => (
            <div key={key} className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0">
                <kbd className="rounded-[2px] border border-rule bg-paper px-1.5 py-0.5 font-ui text-[0.68rem] text-ink-soft">
                  {key}
                </kbd>
              </dt>
              <dd className="text-right text-muted">{action}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

function Setting({
  label, hint, children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[0.82rem] text-ink">{label}</p>
        {hint && <p className="mt-0.5 text-[0.72rem] leading-relaxed text-faint">{hint}</p>}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      className={`relative h-6 w-11 rounded-full transition-colors ${on ? "bg-gold" : "bg-rule"}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-paper shadow-sm transition-[left] ${
          on ? "left-[1.4rem]" : "left-0.5"
        }`}
      />
    </button>
  );
}

const Hint = ({ children }: { children: React.ReactNode }) => (
  <p className="px-4 py-8 text-center text-[0.8rem] leading-relaxed text-faint">{children}</p>
);
