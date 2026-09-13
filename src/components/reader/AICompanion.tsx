"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Turn } from "./hooks/useCompanion";
import { FOLLOW_UPS } from "@/lib/ai/actions";
import { Markdown } from "./Markdown";
import { Close, Mic, Sparkle } from "@/components/ui/Icons";
import { IconButton } from "@/components/ui/Button";

/**
 * The companion panel.
 *
 * It sits beside the book, never over it — a floating column on desktop, a
 * bottom sheet on mobile. It stays mounted while the reader keeps reading so
 * returning to it costs nothing, and it is resizable because a long explanation
 * and a one-line definition want different amounts of room.
 */
export function AICompanion({
  open, turns, thinking, voiceReplies, live, onClose, onAsk, onCitation, onToggleVoiceReplies, onStop,
}: {
  open: boolean;
  turns: Turn[];
  thinking: boolean;
  voiceReplies: boolean;
  /** False when no AI key is configured, so the panel can say so honestly. */
  live: boolean;
  onClose: () => void;
  onAsk: (question: string) => void;
  onCitation: (page: number) => void;
  onToggleVoiceReplies: () => void;
  onStop: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(400);
  const [draft, setDraft] = useState("");
  const streaming = turns.some((t) => t.streaming);

  // Opening the panel, and every new question, lands on the newest turn.
  //
  // A book with history opened scrolled to the top, so the reader held space,
  // asked something, and the panel presented the first answer of some earlier
  // conversation — indistinguishable from the companion ignoring the question
  // and replying with something canned. The newest exchange is the only one
  // they are waiting for.
  const newestTurn = turns.at(-1)?.id ?? null;
  useEffect(() => {
    if (!open) return;
    // The panel springs in from the right, so its height is not final this tick.
    const frame = requestAnimationFrame(() => {
      const element = scroller.current;
      if (element) element.scrollTop = element.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [open, newestTurn]);

  // Follow the stream, but only while the reader is already at the bottom —
  // yanking the view away from something they scrolled up to re-read is worse
  // than losing sight of the newest token.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const nearBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 140;
    if (nearBottom) element.scrollTop = element.scrollHeight;
  }, [turns, thinking]);

  // Drag the left edge to resize.
  const resizing = useRef(false);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!resizing.current) return;
      setWidth(Math.min(Math.max(window.innerWidth - e.clientX, 320), 620));
    };
    const up = () => {
      resizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const question = draft.trim();
    if (!question) return;
    setDraft("");
    onAsk(question);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="companion"
          initial={{ x: "100%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "100%", opacity: 0 }}
          transition={{ type: "spring", stiffness: 340, damping: 36, mass: 0.8 }}
          style={{ width: `min(${width}px, 100vw)` }}
          className="fixed inset-y-0 right-0 z-40 flex flex-col border-l border-rule bg-paper
            shadow-[-20px_0_48px_-24px_rgba(34,32,28,0.4)]
            max-md:inset-x-0 max-md:top-auto max-md:h-[72dvh] max-md:!w-full max-md:rounded-t-[10px] max-md:border-l-0 max-md:border-t"
          aria-label="AI companion"
        >
          {/* Resize handle (desktop) */}
          <div
            onMouseDown={() => {
              resizing.current = true;
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
            }}
            className="absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize md:block"
            aria-hidden="true"
          />

          <header className="flex items-center gap-2.5 border-b border-rule px-4 py-3.5">
            <Sparkle className="text-gold" />
            <h2 className="label !text-ink">Companion</h2>
            {!live && (
              <span
                className="rounded-full border border-rule px-2 py-0.5 text-[0.62rem] text-faint"
                title="Add GEMINI_API_KEY to .env.local to enable real answers"
              >
                no key
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={onToggleVoiceReplies}
                aria-pressed={voiceReplies}
                className={`rounded-[3px] px-2 py-1 text-[0.7rem] transition-colors ${
                  voiceReplies
                    ? "bg-[color-mix(in_srgb,var(--color-gold)_16%,transparent)] text-gold"
                    : "text-muted hover:text-ink"
                }`}
                title="Read answers aloud"
              >
                Voice {voiceReplies ? "on" : "off"}
              </button>
              <IconButton label="Close companion" onClick={onClose}>
                <Close />
              </IconButton>
            </div>
          </header>

          <div ref={scroller} className="scroll-quiet flex-1 overflow-y-auto overscroll-contain px-4 py-5">
            {turns.length === 0 ? (
              <EmptyCompanion />
            ) : (
              <div className="space-y-8">
                {turns.map((turn) => (
                  <TurnView
                    key={turn.id}
                    turn={turn}
                    thinking={thinking && turn.streaming && !turn.answer}
                    onCitation={onCitation}
                    onFollowUp={onAsk}
                  />
                ))}
              </div>
            )}
          </div>

          <form onSubmit={submit} className="border-t border-rule p-3" data-folio-typing>
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit(e);
                  }
                }}
                rows={1}
                placeholder="Ask about this page…"
                className="scroll-quiet max-h-28 min-h-[2.4rem] flex-1 resize-none rounded-[3px] border border-rule bg-parchment px-3 py-2 text-[0.84rem] leading-relaxed text-ink placeholder:text-faint focus:border-gold focus:outline-none"
              />
              {streaming ? (
                <button
                  type="button"
                  onClick={onStop}
                  className="h-9 shrink-0 rounded-[3px] border border-rule px-3 text-[0.76rem] text-muted transition-colors hover:text-ink"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  className="h-9 shrink-0 rounded-[3px] bg-oxblood px-3.5 text-[0.78rem] font-medium text-parchment transition-colors hover:bg-oxblood-bright disabled:opacity-35"
                >
                  Ask
                </button>
              )}
            </div>
            <p className="mt-2 flex items-center gap-1.5 px-0.5 text-[0.68rem] text-faint">
              <Mic className="!h-3 !w-3" />
              Hold <kbd className="rounded-[2px] border border-rule px-1 font-ui">space</kbd> anywhere
              in the book to ask out loud
            </p>
          </form>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function TurnView({
  turn, thinking, onCitation, onFollowUp,
}: {
  turn: Turn;
  thinking: boolean;
  onCitation: (page: number) => void;
  onFollowUp: (question: string) => void;
}) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 0.68, 0.16, 1] }}
    >
      {turn.selectedText && (
        <blockquote className="mb-3 border-l-2 border-gold/50 pl-3 font-display text-[0.86rem] italic leading-snug text-muted">
          {turn.selectedText.length > 220
            ? `${turn.selectedText.slice(0, 220)}…`
            : turn.selectedText}
        </blockquote>
      )}

      <p className="mb-3 text-[0.84rem] font-medium leading-relaxed text-ink">{turn.question}</p>

      {thinking ? (
        <ThinkingIndicator />
      ) : turn.error ? (
        <p className="rounded-[3px] border border-rule bg-parchment-deep/50 px-3 py-2.5 text-[0.82rem] leading-relaxed text-muted">
          {turn.error}
        </p>
      ) : (
        <div className={turn.streaming ? "streaming-caret" : undefined}>
          <Markdown text={turn.answer} onCitation={onCitation} />
        </div>
      )}

      {turn.sourcePages.length > 0 && !turn.streaming && turn.answer && (
        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[0.7rem] text-faint">
          <span>Based on</span>
          {condense(turn.sourcePages).map((label, i) => (
            <button
              key={i}
              onClick={() => onCitation(Number(/\d+/.exec(label)?.[0]))}
              className="rounded-[2px] border border-rule px-1.5 py-px transition-colors hover:border-gold hover:text-gold"
            >
              {label}
            </button>
          ))}
        </p>
      )}

      {!turn.streaming && turn.answer && !turn.error && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {FOLLOW_UPS.map((f) => (
            <button
              key={f.label}
              onClick={() => onFollowUp(f.prompt)}
              className="rounded-[3px] border border-rule px-2.5 py-1 text-[0.72rem] text-muted transition-colors hover:border-faint hover:text-ink"
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
    </motion.article>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 py-1" role="status">
      <span className="sr-only">Thinking</span>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1 w-1 rounded-full bg-gold"
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ duration: 1.05, repeat: Infinity, delay: i * 0.16, ease: "easeInOut" }}
        />
      ))}
      <span className="ml-1 text-[0.76rem] italic text-faint">Thinking…</span>
    </div>
  );
}

function EmptyCompanion() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <Sparkle className="!h-6 !w-6 text-gold/60" />
      <p className="mt-4 font-display text-[1.15rem] font-light text-ink">
        Ask the book anything.
      </p>
      <p className="mt-2 max-w-[16rem] text-[0.8rem] leading-relaxed text-muted">
        Select a passage and choose an action, or hold the spacebar and simply say what you
        want to know.
      </p>
    </div>
  );
}

/** Turns [82,83,84,91] into ["pp. 82–84", "p. 91"]. */
function condense(pages: number[]): string[] {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const out: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(i === j ? `p. ${sorted[i]}` : `pp. ${sorted[i]}–${sorted[j]}`);
    i = j + 1;
  }
  return out.slice(0, 4);
}
