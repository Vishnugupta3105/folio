"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Selection } from "./TextLayer";
import type { HighlightColor } from "@/types";
import { MORE_ACTIONS, PRIMARY_ACTIONS, type ActionId } from "@/lib/ai/actions";
import { Highlighter, Note } from "@/components/ui/Icons";

const COLORS: { id: HighlightColor; token: string; label: string }[] = [
  { id: "amber", token: "var(--color-hl-amber)", label: "Amber" },
  { id: "azure", token: "var(--color-hl-azure)", label: "Blue" },
  { id: "sage", token: "var(--color-hl-sage)", label: "Green" },
  { id: "rose", token: "var(--color-hl-rose)", label: "Rose" },
  { id: "neutral", token: "var(--color-hl-neutral)", label: "Neutral" },
];

/**
 * The toolbar that follows a selection.
 *
 * Four actions and a highlight control on the first row; everything else behind
 * "More". It is deliberately small — this is a reading interaction, not a menu.
 */
export function SelectionToolbar({
  selection, onAction, onHighlight, onNote, onDismiss,
}: {
  selection: Selection | null;
  onAction: (action: ActionId) => void;
  onHighlight: (color: HighlightColor) => void;
  onNote: () => void;
  onDismiss: () => void;
}) {
  const toolbar = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [colors, setColors] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, above: true });

  useEffect(() => {
    setExpanded(false);
    setColors(false);
  }, [selection?.startOffset, selection?.page]);

  // Place above the selection, flipping below when there isn't room, and always
  // clamped inside the viewport.
  useEffect(() => {
    if (!selection) return;
    const id = requestAnimationFrame(() => {
      const element = toolbar.current;
      if (!element) return;
      const box = element.getBoundingClientRect();
      const { rect } = selection;

      const above = rect.top > box.height + 20;
      const top = above ? rect.top - box.height - 10 : rect.top + rect.height + 10;
      const left = Math.min(
        Math.max(rect.left + rect.width / 2 - box.width / 2, 12),
        window.innerWidth - box.width - 12,
      );
      setPosition({ top, left, above });
    });
    return () => cancelAnimationFrame(id);
  }, [selection, expanded, colors]);

  // Dismiss on outside click or Escape without clearing the selection first,
  // so the reader can keep reading with the words still selected.
  useEffect(() => {
    if (!selection) return;
    const click = (event: MouseEvent) => {
      if (!toolbar.current?.contains(event.target as Node)) onDismiss();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    // Deferred so the mouseup that created the selection doesn't dismiss it.
    const id = setTimeout(() => {
      window.addEventListener("mousedown", click);
      window.addEventListener("keydown", key);
    }, 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener("mousedown", click);
      window.removeEventListener("keydown", key);
    };
  }, [selection, onDismiss]);

  return (
    <AnimatePresence>
      {selection && (
        <motion.div
          ref={toolbar}
          key="selection-toolbar"
          initial={{ opacity: 0, y: position.above ? 5 : -5, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
          transition={{ duration: 0.18, ease: [0.22, 0.68, 0.16, 1] }}
          style={{ top: position.top, left: position.left }}
          className="fixed z-50 max-w-[min(30rem,calc(100vw-1.5rem))] rounded-[4px] border border-rule bg-paper p-1 shadow-[0_14px_34px_-12px_rgba(34,32,28,0.45)]"
          role="toolbar"
          aria-label="Selection actions"
        >
          <div className="flex items-center gap-0.5">
            {colors ? (
              <>
                {COLORS.map((color) => (
                  <button
                    key={color.id}
                    onClick={() => onHighlight(color.id)}
                    aria-label={`Highlight ${color.label}`}
                    title={color.label}
                    className="m-0.5 h-6 w-6 rounded-full ring-1 ring-inset ring-[color-mix(in_srgb,var(--color-ink)_16%,transparent)] transition-transform hover:scale-110"
                    style={{ background: color.token }}
                  />
                ))}
                <Divider />
                <Item onClick={() => setColors(false)}>Back</Item>
              </>
            ) : expanded ? (
              <>
                {MORE_ACTIONS.map((action) => (
                  <Item key={action.id} onClick={() => onAction(action.id)}>
                    {action.label}
                  </Item>
                ))}
                <Divider />
                <Item onClick={() => setExpanded(false)}>Back</Item>
              </>
            ) : (
              <>
                {PRIMARY_ACTIONS.map((action) => (
                  <Item key={action.id} onClick={() => onAction(action.id)}>
                    {action.label}
                  </Item>
                ))}
                <Divider />
                <IconItem label="Highlight" onClick={() => setColors(true)}>
                  <Highlighter />
                </IconItem>
                <IconItem label="Add note" onClick={onNote}>
                  <Note />
                </IconItem>
                <Item onClick={() => setExpanded(true)} className="!text-muted">
                  More
                </Item>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Item({
  children, onClick, className = "",
}: {
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap rounded-[2px] px-2.5 py-1.5 text-[0.78rem] text-ink transition-colors hover:bg-[color-mix(in_srgb,var(--color-ink)_6%,transparent)] ${className}`}
    >
      {children}
    </button>
  );
}

function IconItem({
  children, label, onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-[2px] px-2 py-1.5 text-ink transition-colors hover:bg-[color-mix(in_srgb,var(--color-ink)_6%,transparent)]"
    >
      {children}
    </button>
  );
}

const Divider = () => <span className="mx-0.5 h-4 w-px shrink-0 bg-rule" aria-hidden="true" />;
