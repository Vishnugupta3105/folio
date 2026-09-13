"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import type {
  AIMessage, Bookmark, Book, Highlight, HighlightColor, Note, Preferences, ReadingProgress,
} from "@/types";
import type { ActionId } from "@/lib/ai/actions";
import { api } from "@/lib/api";
import { mark, measure } from "@/lib/perf";
import { speakOnce } from "@/lib/tts/tts";
import { PdfRenderer } from "@/lib/pdf/renderer";

import { BookCanvas, type Spread } from "./BookCanvas";
import { EpubCanvas } from "./EpubCanvas";
import type { Selection } from "./TextLayer";
import { ReaderToolbar, type PanelId } from "./ReaderToolbar";
import { ReaderControls, ZOOM_STEPS } from "./ReaderControls";
import { SelectionToolbar } from "./SelectionToolbar";
import { AICompanion } from "./AICompanion";
import { VoiceIndicator } from "./VoiceIndicator";
import { TTSPlayer } from "./TTSPlayer";
import { SidePanel } from "./SidePanel";
import { NoteComposer } from "./NoteComposer";
import { BookOpening } from "./BookOpening";
import { OfflineNotice } from "./OfflineNotice";
import { useSpaceVoice } from "./hooks/useSpaceVoice";
import { useNarration } from "./hooks/useNarration";
import { useCompanion } from "./hooks/useCompanion";
import { useReadingSession } from "./hooks/useReadingSession";

export interface ReaderData {
  book: Book;
  progress: ReadingProgress | null;
  highlights: Highlight[];
  notes: Note[];
  bookmarks: Bookmark[];
  messages: AIMessage[];
  preferences: Preferences;
  aiLive: boolean;
}

/** "continue" and friends resume narration after a pause-and-ask. */
const RESUME_PHRASES = /^(continue|carry on|keep (going|reading)|resume|go on|carry on reading)\b/i;

export function Reader({ data }: { data: ReaderData }) {
  const { book } = data;

  const isPdf = book.format === "pdf";

  const [renderer, setRenderer] = useState<PdfRenderer | null>(null);
  /** EpubCanvas owns its own pagination and reports the count it settled on. */
  const [epubPages, setEpubPages] = useState(book.pageCount);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Open exactly where the reader stopped. This is read once, at mount.
  const [page, setPage] = useState(() => Math.max(1, data.progress?.page ?? 1));
  const [spread, setSpread] = useState<Spread>(data.preferences.spread);
  /**
   * A spread needs room. Below roughly a tablet each page would be too small to
   * read, so the layout collapses to one page regardless of the preference —
   * and restores it when there is room again, without overwriting the choice.
   */
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const effectiveSpread: Spread = narrow ? "single" : spread;

  /**
   * Dimming the page is a property of this screen in this room, not of the
   * account, so it lives beside the theme in local storage rather than in the
   * database. It follows the theme unless the reader says otherwise.
   */
  const [dark, setDark] = useState(false);
  const [dimPage, setDimPage] = useState(true);
  useEffect(() => {
    setDimPage(localStorage.getItem("folio-dim-page") !== "off");
    const root = document.documentElement;
    const sync = () => setDark(root.getAttribute("data-theme") === "dark");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  const toggleDimPage = useCallback(() => {
    setDimPage((on) => {
      localStorage.setItem("folio-dim-page", on ? "off" : "on");
      return !on;
    });
  }, []);
  const [zoom, setZoom] = useState(1);
  const [focusMode, setFocusMode] = useState(false);
  const [panel, setPanel] = useState<PanelId>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [companionOpen, setCompanionOpen] = useState(false);
  const [narrationOpen, setNarrationOpen] = useState(false);
  const [preferences, setPreferences] = useState(data.preferences);

  const [highlights, setHighlights] = useState(data.highlights);
  const [notes, setNotes] = useState(data.notes);
  const [bookmarks, setBookmarks] = useState(data.bookmarks);

  // Only a first-time open gets the cover animation.
  const [opening, setOpening] = useState(!data.book.lastOpenedAt);
  const [openingStatus, setOpeningStatus] = useState<string | null>("Opening your book…");

  const pageCount = book.pageCount || (isPdf ? renderer?.pageCount ?? 0 : epubPages);

  const indexReady = book.indexState === "ready";

  // ── The document ─────────────────────────────────────────────────────────
  // Only a PDF is rasterised here; an EPUB paginates itself inside EpubCanvas
  // and reports back when it is ready.
  useEffect(() => {
    if (!isPdf) return;
    let live = true;
    let instance: PdfRenderer | null = null;
    mark("book");

    PdfRenderer.open(`/api/books/${book.id}/file`)
      .then((r) => {
        if (!live) {
          r.destroy();
          return;
        }
        instance = r;
        setRenderer(r);
        measure("book:open", "book");
        setOpeningStatus("Ready to read.");
        setTimeout(() => setOpening(false), data.book.lastOpenedAt ? 0 : 700);
      })
      .catch(() => {
        if (!live) return;
        setLoadError(
          "This book couldn't be opened. The file may be damaged, or it may be a format Folio can't read yet.",
        );
        setOpening(false);
      });

    return () => {
      live = false;
      instance?.destroy();
    };
  }, [book.id, isPdf, data.book.lastOpenedAt]);

  const onEpubReady = useCallback(
    (info: { pageCount: number } | { error: string }) => {
      if ("error" in info) {
        setLoadError(info.error);
        setOpening(false);
        return;
      }
      setEpubPages(info.pageCount);
      measure("book:open", "book");
      setOpeningStatus("Ready to read.");
      setOpening(false);
    },
    [],
  );

  // ── Reading position ─────────────────────────────────────────────────────
  // Local state is the source of truth while reading; the server is told after
  // the page settles, so a flaky network never costs the reader their place.
  const savedPage = useRef(page);
  const bookIdRef = useRef(book.id);
  bookIdRef.current = book.id;
  useEffect(() => {
    if (page === savedPage.current) return;
    const id = setTimeout(() => {
      savedPage.current = page;
      void api(`/api/books/${book.id}/progress`, {
        method: "PUT",
        body: JSON.stringify({ page, ttsSentence: null }),
      }).catch(() => {
        // Offline. Mark the save as not done so the next attempt — a page turn,
        // or the flush on the way out — sends it again.
        savedPage.current = -1;
      });
    }, 900);
    return () => clearTimeout(id);
  }, [page, book.id]);

  // And on the way out, so closing the tab mid-page doesn't lose it.
  //
  // The current page is read through a ref rather than a dependency: depending
  // on `page` would re-run this effect on every turn, and its cleanup would
  // fire a beacon each time — a burst of redundant writes during normal reading.
  const livePage = useRef(page);
  livePage.current = page;

  useEffect(() => {
    const flush = () => {
      if (livePage.current === savedPage.current) return;
      savedPage.current = livePage.current;
      // A beacon is the only request that reliably outlives the page, and it
      // can only be a POST — which is why the route accepts both verbs.
      navigator.sendBeacon?.(
        `/api/books/${bookIdRef.current}/progress`,
        new Blob([JSON.stringify({ page: livePage.current })], { type: "application/json" }),
      );
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  // ── Narration ────────────────────────────────────────────────────────────
  // A PDF's words come from pdf.js, already in the page. An EPUB has no page
  // geometry to read from, so its words come from the index built at upload.
  const textFor = useCallback(
    async (n: number): Promise<string> => {
      if (isPdf) return renderer ? (await renderer.text(n)).text : "";
      const data = await api<{ text: string }>(`/api/books/${book.id}/text?page=${n}`);
      return data.text;
    },
    [isPdf, renderer, book.id],
  );

  const narration = useNarration({
    textFor: isPdf && !renderer ? null : textFor,
    pageCount: book.pageCount || epubPages || renderer?.pageCount || 1,
    page,
    onAdvancePage: setPage,
    startSentence: data.progress?.ttsSentence,
  });

  // ── Companion ────────────────────────────────────────────────────────────
  const speakingReply = useRef(false);
  const companion = useCompanion({
    initialMessages: data.messages,
    onAnswerComplete: (answer, voice) => {
      // A question asked out loud is answered out loud — that is the whole point
      // of holding space, and it shouldn't depend on a panel toggle the reader
      // never saw. The toggle governs typed questions, which is what it says on
      // the button. (A second `if (!preferences.voiceReplies) return` used to sit
      // here and silently cancelled the `|| voice` case, so spoken questions came
      // back in silence unless Voice happened to be on.)
      if (!voice && !preferences.voiceReplies) return;
      speakingReply.current = true;
      speakOnce(stripMarkdown(answer), narration.voiceId, narration.rate);
    },
  });

  const askedDuringNarration = useRef(false);

  const ask = useCallback(
    (input: { question?: string; action?: ActionId; selectedText?: string | null; voice?: boolean }) => {
      setCompanionOpen(true);
      void companion.ask({
        bookId: book.id,
        page,
        question: input.question,
        action: input.action,
        selectedText: input.selectedText ?? null,
        voice: input.voice,
      });
    },
    [companion, book.id, page],
  );

  // ── Hold space to ask ────────────────────────────────────────────────────
  const voice = useSpaceVoice({
    enabled: !opening && !loadError,
    onSubmit: (transcript) => {
      // "Continue" while narration is paused resumes the book rather than
      // becoming a question — this is what makes pause-and-ask feel like talking
      // to a narrator instead of operating a player.
      if (askedDuringNarration.current && RESUME_PHRASES.test(transcript.trim())) {
        askedDuringNarration.current = false;
        narration.resumeFromInterrupt();
        return;
      }
      ask({ question: transcript, selectedText: selection?.text ?? null, voice: true });
    },
    onCancel: () => {
      if (askedDuringNarration.current) {
        askedDuringNarration.current = false;
        narration.resumeFromInterrupt();
      }
    },
  });

  // Starting to speak pauses the narrator mid-sentence.
  useEffect(() => {
    if (voice.state === "listening" && narration.playing) {
      askedDuringNarration.current = narration.interrupt();
    }
  }, [voice.state, narration]);

  useReadingSession({
    bookId: book.id,
    page,
    questionsAsked: companion.turns.length,
    ready: Boolean(renderer),
  });

  // ── Page navigation ──────────────────────────────────────────────────────
  const turn = useCallback((direction: "next" | "prev") => {
    window.dispatchEvent(new CustomEvent("folio:turn", { detail: { direction } }));
  }, []);

  const goTo = useCallback(
    (target: number) => {
      const clamped = Math.max(1, Math.min(target, pageCount || target));
      setPage(clamped);
      setSelection(null);
    },
    [pageCount],
  );

  // ── Highlights, notes, bookmarks ─────────────────────────────────────────
  const addHighlight = useCallback(
    async (color: HighlightColor) => {
      if (!selection) return;
      const current = selection;
      setSelection(null);
      window.getSelection()?.removeAllRanges();

      // Optimistic: the mark appears under the cursor immediately.
      const optimistic: Highlight = {
        id: `temp-${Date.now()}`,
        userId: "",
        bookId: book.id,
        page: current.page,
        text: current.text,
        color,
        startOffset: current.startOffset,
        endOffset: current.endOffset,
        cfi: current.cfi ?? null,
        note: null,
        createdAt: new Date().toISOString(),
      };
      setHighlights((prev) => [...prev, optimistic]);

      try {
        const { highlight } = await api<{ highlight: Highlight }>(
          `/api/books/${book.id}/highlights`,
          { method: "POST", body: JSON.stringify({ ...optimistic }) },
        );
        setHighlights((prev) => prev.map((h) => (h.id === optimistic.id ? highlight : h)));
      } catch {
        setHighlights((prev) => prev.filter((h) => h.id !== optimistic.id));
      }
    },
    [selection, book.id],
  );

  const deleteHighlight = useCallback(
    async (id: string) => {
      setHighlights((prev) => prev.filter((h) => h.id !== id));
      await api(`/api/books/${book.id}/highlights/${id}`, { method: "DELETE" }).catch(() => {});
    },
    [book.id],
  );

  const saveNote = useCallback(
    async (content: string) => {
      const selectedText = selection?.text ?? null;
      const notePage = selection?.page ?? page;
      setNoteOpen(false);
      setSelection(null);

      try {
        const { note } = await api<{ note: Note }>(`/api/books/${book.id}/notes`, {
          method: "POST",
          body: JSON.stringify({ page: notePage, selectedText, content }),
        });
        setNotes((prev) => [...prev, note]);
        setPanel("notes");
      } catch {
        /* The composer already closed; the reader can try again. */
      }
    },
    [selection, page, book.id],
  );

  const deleteNote = useCallback(
    async (id: string) => {
      setNotes((prev) => prev.filter((n) => n.id !== id));
      await api(`/api/books/${book.id}/notes/${id}`, { method: "DELETE" }).catch(() => {});
    },
    [book.id],
  );

  const openHighlight = useCallback(
    (highlight: Highlight) => {
      goTo(highlight.page);
      setPanel("notes");
    },
    [goTo],
  );

  const bookmarked = useMemo(() => bookmarks.some((b) => b.page === page), [bookmarks, page]);

  const toggleBookmark = useCallback(async () => {
    const existing = bookmarks.find((b) => b.page === page);
    if (existing) setBookmarks((prev) => prev.filter((b) => b.id !== existing.id));

    try {
      const result = await api<{ bookmark: Bookmark | null }>(`/api/books/${book.id}/bookmarks`, {
        method: "POST",
        body: JSON.stringify({ page }),
      });
      if (result.bookmark) setBookmarks((prev) => [...prev, result.bookmark!]);
    } catch {
      if (existing) setBookmarks((prev) => [...prev, existing]);
    }
  }, [bookmarks, page, book.id]);

  const deleteBookmark = useCallback(
    async (id: string) => {
      setBookmarks((prev) => prev.filter((b) => b.id !== id));
      await api(`/api/books/${book.id}/bookmarks/${id}`, { method: "DELETE" }).catch(() => {});
    },
    [book.id],
  );

  const savePreferences = useCallback(async (patch: Partial<Preferences>) => {
    setPreferences((prev) => ({ ...prev, ...patch }));
    await api("/api/preferences", { method: "PUT", body: JSON.stringify(patch) }).catch(() => {});
  }, []);

  const changeSpread = useCallback(
    (next: Spread) => {
      setSpread(next);
      void savePreferences({ spread: next });
    },
    [savePreferences],
  );

  // ── Keyboard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const typing = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return Boolean(
        element &&
          (element.tagName === "INPUT" ||
            element.tagName === "TEXTAREA" ||
            element.isContentEditable ||
            element.closest?.("[data-folio-typing]")),
      );
    };

    const handler = (event: KeyboardEvent) => {
      // Search is the one shortcut that has to work while typing elsewhere.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setPanel("search");
        return;
      }

      // Escape unwinds one layer at a time, most transient first, and works
      // from anywhere including a text field — nothing about typing makes
      // "close this" the wrong response.
      if (event.key === "Escape") {
        (event.target as HTMLElement)?.blur?.();
        if (selection) setSelection(null);
        else if (panel) setPanel(null);
        else if (companionOpen) setCompanionOpen(false);
        else if (focusMode) setFocusMode(false);
        return;
      }

      if (typing(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case "ArrowRight":
        case "PageDown":
          event.preventDefault();
          turn("next");
          break;
        case "ArrowLeft":
        case "PageUp":
          event.preventDefault();
          turn("prev");
          break;
        case "Home":
          event.preventDefault();
          goTo(1);
          break;
        case "End":
          event.preventDefault();
          goTo(pageCount);
          break;
        case "b":
        case "B":
          event.preventDefault();
          void toggleBookmark();
          break;
        case "n":
        case "N":
          event.preventDefault();
          setNoteOpen(true);
          break;
        case "h":
        case "H":
          if (selection) {
            event.preventDefault();
            void addHighlight("amber");
          }
          break;
        case "f":
        case "F":
          event.preventDefault();
          setFocusMode((v) => !v);
          break;
        case "0":
          event.preventDefault();
          setZoom(1);
          break;
        case "+":
        case "=":
          event.preventDefault();
          setZoom((z) => ZOOM_STEPS[Math.min(ZOOM_STEPS.indexOf(z) + 1, ZOOM_STEPS.length - 1)] ?? z);
          break;
        case "-":
          event.preventDefault();
          setZoom((z) => ZOOM_STEPS[Math.max(ZOOM_STEPS.indexOf(z) - 1, 0)] ?? z);
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [turn, goTo, pageCount, toggleBookmark, addHighlight, selection, panel, companionOpen, focusMode]);

  // Trackpad and ctrl+wheel zoom.
  useEffect(() => {
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((z) => Math.min(Math.max(z * (event.deltaY < 0 ? 1.08 : 0.93), 0.5), 3));
    };
    window.addEventListener("wheel", wheel, { passive: false });
    return () => window.removeEventListener("wheel", wheel);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-parchment px-6 text-center">
        <h1 className="font-display text-[1.6rem] font-light text-ink">
          This book wouldn&rsquo;t open.
        </h1>
        <p className="max-w-sm text-[0.88rem] leading-relaxed text-muted">{loadError}</p>
        <a
          href="/library"
          className="mt-2 rounded-[3px] border border-rule px-5 py-2.5 text-[0.84rem] text-ink transition-colors hover:border-faint"
        >
          Back to library
        </a>
      </div>
    );
  }

  const spokenRange = narration.current;

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-parchment">
      <BookOpening
        show={opening}
        title={book.title}
        author={book.author}
        coverUrl={book.coverUrl}
        status={openingStatus}
      />

      {/* Focus mode hides the chrome without unmounting it, so nothing reloads. */}
      <motion.div
        animate={{ height: focusMode ? 0 : "auto", opacity: focusMode ? 0 : 1 }}
        transition={{ duration: 0.28, ease: [0.22, 0.68, 0.16, 1] }}
        className="shrink-0 overflow-hidden"
      >
        <ReaderToolbar
          book={book}
          panel={panel}
          bookmarked={bookmarked}
          companionOpen={companionOpen}
          narrating={narration.playing || narrationOpen}
          live={data.aiLive}
          onPanel={setPanel}
          onBookmark={toggleBookmark}
          onCompanion={() => setCompanionOpen((v) => !v)}
          onNarrate={() => {
            if (narrationOpen) {
              narration.stop();
              setNarrationOpen(false);
            } else {
              setNarrationOpen(true);
              void narration.play();
            }
          }}
          onFocusMode={() => setFocusMode(true)}
        />
      </motion.div>

      <div className="relative flex min-h-0 flex-1">
        <SidePanel
          panel={panel}
          bookId={book.id}
          highlights={highlights}
          notes={notes}
          bookmarks={bookmarks}
          preferences={preferences}
          spread={effectiveSpread}
          indexReady={indexReady}
          onClose={() => setPanel(null)}
          onGoTo={goTo}
          onDeleteHighlight={deleteHighlight}
          onDeleteNote={deleteNote}
          onDeleteBookmark={deleteBookmark}
          onPreferences={savePreferences}
          onSpread={changeSpread}
          dark={dark}
          dimPage={dimPage}
          onDimPage={toggleDimPage}
        />

        <main
          className={`relative min-w-0 flex-1 transition-[background-color] duration-500 ${
            focusMode ? "bg-parchment-deep" : "bg-parchment"
          }`}
        >
          {!isPdf ? (
            <EpubCanvas
              bookId={book.id}
              page={page}
              pageCount={pageCount || 1}
              spread={effectiveSpread}
              zoom={zoom}
              highlights={highlights}
              night={dark && dimPage}
              onSelect={setSelection}
              onHighlightClick={openHighlight}
              onTurn={setPage}
              onReady={onEpubReady}
            />
          ) : renderer ? (
            <BookCanvas
              renderer={renderer}
              page={page}
              spread={effectiveSpread}
              zoom={zoom}
              highlights={highlights}
              spokenRange={spokenRange}
              onSelect={setSelection}
              onHighlightClick={openHighlight}
              onTurn={setPage}
              night={dark && dimPage}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="font-display text-[1rem] italic text-faint">Opening your book…</p>
            </div>
          )}

          {focusMode && (
            <button
              onClick={() => setFocusMode(false)}
              className="absolute right-4 top-4 z-20 rounded-[3px] border border-rule bg-paper/80 px-3 py-1.5 text-[0.72rem] text-muted backdrop-blur-sm transition-colors hover:text-ink"
            >
              Esc to exit focus
            </button>
          )}
        </main>
      </div>

      <TTSPlayer
        open={narrationOpen}
        playing={narration.playing}
        paused={narration.paused}
        sentenceIndex={narration.sentenceIndex}
        sentenceCount={narration.sentenceCount}
        rate={narration.rate}
        voiceId={narration.voiceId}
        voices={narration.voices}
        error={narration.error}
        onPlay={() => void narration.play()}
        onPause={narration.pause}
        onSkip={narration.skip}
        onRate={narration.setRate}
        onVoice={narration.setVoice}
        onClose={() => {
          narration.stop();
          setNarrationOpen(false);
        }}
        onDismissError={narration.dismissError}
      />

      <motion.div
        animate={{ height: focusMode ? 0 : "auto", opacity: focusMode ? 0 : 1 }}
        transition={{ duration: 0.28, ease: [0.22, 0.68, 0.16, 1] }}
        className="shrink-0 overflow-hidden"
      >
        <ReaderControls
          page={page}
          pageCount={pageCount}
          pageLabel={book.pageLabels?.[String(page)] ?? null}
          zoom={zoom}
          spread={effectiveSpread}
          progress={pageCount ? page / pageCount : 0}
          explaining={companion.turns.some((t) => t.streaming)}
          onTurn={turn}
          onGoTo={goTo}
          onZoom={setZoom}
          onFitWidth={() => setZoom(1)}
          onSpread={changeSpread}
          onExplainPage={() => ask({ action: "explain-page" })}
        />
      </motion.div>

      <SelectionToolbar
        selection={selection}
        onAction={(action) => {
          const text = selection?.text ?? null;
          setSelection(null);
          window.getSelection()?.removeAllRanges();
          ask({ action, selectedText: text });
        }}
        onHighlight={addHighlight}
        onNote={() => setNoteOpen(true)}
        onDismiss={() => setSelection(null)}
      />

      <NoteComposer
        open={noteOpen}
        page={selection?.page ?? page}
        selectedText={selection?.text ?? null}
        onSave={saveNote}
        onClose={() => setNoteOpen(false)}
      />

      <AICompanion
        open={companionOpen}
        turns={companion.turns}
        thinking={companion.thinking}
        voiceReplies={preferences.voiceReplies}
        live={data.aiLive}
        onClose={() => setCompanionOpen(false)}
        onAsk={(question) => ask({ question, selectedText: selection?.text ?? null })}
        onCitation={goTo}
        onToggleVoiceReplies={() => void savePreferences({ voiceReplies: !preferences.voiceReplies })}
        onStop={companion.stop}
      />

      <OfflineNotice />

      <VoiceIndicator
        state={voice.state}
        transcript={voice.transcript}
        error={voice.error}
        supported={voice.supported}
        onDismissError={voice.dismissError}
        onCancel={voice.cancel}
      />

      {/* Hold-to-talk for touch, where there is no spacebar. */}
      <button
        onPointerDown={(e) => {
          e.preventDefault();
          voice.holdStart();
        }}
        onPointerUp={voice.holdEnd}
        onPointerCancel={voice.holdEnd}
        aria-label="Hold to ask a question out loud"
        className={`fixed bottom-[4.6rem] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full shadow-[0_10px_28px_-8px_rgba(34,32,28,0.5)] transition-transform md:hidden ${
          voice.state === "listening"
            ? "scale-110 bg-oxblood-bright text-parchment"
            : "bg-oxblood text-parchment"
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v3" />
        </svg>
      </button>
    </div>
  );
}

/** Markdown reads badly aloud; strip it before handing text to a voice. */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}
