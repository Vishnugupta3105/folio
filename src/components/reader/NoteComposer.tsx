"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/Button";

/** Writing a note. Attached to a selection when there is one, else to the page. */
export function NoteComposer({
  open, page, selectedText, onSave, onClose,
}: {
  open: boolean;
  page: number;
  selectedText: string | null;
  onSave: (content: string) => void;
  onClose: () => void;
}) {
  const [content, setContent] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setContent("");
      setTimeout(() => field.current?.focus(), 80);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--color-ink)_28%,transparent)] p-5 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: 0.24, ease: [0.22, 0.68, 0.16, 1] }}
            className="w-full max-w-[30rem] rounded-[4px] border border-rule bg-paper p-5 shadow-[0_26px_60px_-18px_rgba(34,32,28,0.5)]"
            data-folio-typing
          >
            <p className="label">Note · page {page}</p>

            {selectedText && (
              <blockquote className="mt-3 max-h-24 overflow-y-auto border-l-2 border-gold/50 pl-3 font-display text-[0.86rem] italic leading-relaxed text-muted">
                {selectedText}
              </blockquote>
            )}

            <textarea
              ref={field}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && content.trim()) {
                  onSave(content.trim());
                }
              }}
              rows={5}
              placeholder="What do you want to remember about this?"
              className="scroll-quiet mt-4 w-full resize-none rounded-[3px] border border-rule bg-parchment px-3 py-2.5 text-[0.86rem] leading-relaxed text-ink placeholder:text-faint focus:border-gold focus:outline-none"
            />

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!content.trim()}
                onClick={() => onSave(content.trim())}
              >
                Save note
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
