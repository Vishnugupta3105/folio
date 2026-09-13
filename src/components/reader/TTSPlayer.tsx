"use client";

import { AnimatePresence, motion } from "motion/react";
import { RATES } from "./hooks/useNarration";
import type { Voice } from "@/lib/tts/tts";
import { ArrowLeft, ArrowRight, Close, Pause, Play } from "@/components/ui/Icons";
import { IconButton } from "@/components/ui/Button";

/**
 * The narration player.
 *
 * A quiet strip above the controls on desktop and a persistent mini player on
 * mobile. It reports which sentence is being read, because that is the thing
 * the reader is actually tracking.
 */
export function TTSPlayer({
  open, playing, paused, sentenceIndex, sentenceCount, rate, voiceId, voices, error,
  onPlay, onPause, onSkip, onRate, onVoice, onClose, onDismissError,
}: {
  open: boolean;
  playing: boolean;
  paused: boolean;
  sentenceIndex: number;
  sentenceCount: number;
  rate: number;
  voiceId: string | null;
  voices: Voice[];
  error: string | null;
  onPlay: () => void;
  onPause: () => void;
  onSkip: (delta: number) => void;
  onRate: (rate: number) => void;
  onVoice: (id: string) => void;
  onClose: () => void;
  onDismissError: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="tts"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 16, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 34 }}
          className="relative z-30 shrink-0 border-t border-rule bg-parchment-deep/80 backdrop-blur-md"
          role="region"
          aria-label="Narration"
        >
          {error ? (
            <div className="flex items-center gap-3 px-4 py-3">
              <p className="flex-1 text-[0.8rem] text-ink-soft">{error}</p>
              <button
                onClick={onDismissError}
                className="text-[0.74rem] text-muted transition-colors hover:text-ink"
              >
                Dismiss
              </button>
            </div>
          ) : (
            <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
              <IconButton label="Previous sentence" onClick={() => onSkip(-1)}>
                <ArrowLeft />
              </IconButton>

              <button
                onClick={playing ? onPause : onPlay}
                aria-label={playing ? "Pause narration" : "Play narration"}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-oxblood text-parchment transition-colors hover:bg-oxblood-bright"
              >
                {playing ? <Pause /> : <Play />}
              </button>

              <IconButton label="Next sentence" onClick={() => onSkip(1)}>
                <ArrowRight />
              </IconButton>

              <div className="ml-2 min-w-0 flex-1">
                <p className="truncate text-[0.76rem] text-ink-soft">
                  {playing
                    ? "Reading aloud"
                    : paused
                      ? "Paused — press play, or say “continue”"
                      : "Ready to read"}
                </p>
                {sentenceCount > 0 && (
                  <div className="mt-1 h-[2px] w-full max-w-xs overflow-hidden rounded-full bg-rule">
                    <motion.div
                      className="h-full bg-gold"
                      animate={{
                        width: `${Math.round(((sentenceIndex + 1) / sentenceCount) * 100)}%`,
                      }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                )}
              </div>

              <label className="hidden items-center gap-1.5 sm:flex">
                <span className="sr-only">Narration speed</span>
                <select
                  value={rate}
                  onChange={(e) => onRate(Number(e.target.value))}
                  className="h-8 rounded-[3px] border border-rule bg-paper px-1.5 text-[0.74rem] text-ink focus:border-gold focus:outline-none"
                >
                  {RATES.map((r) => (
                    <option key={r} value={r}>
                      {r}×
                    </option>
                  ))}
                </select>
              </label>

              {voices.length > 0 && (
                <label className="hidden items-center gap-1.5 lg:flex">
                  <span className="sr-only">Narration voice</span>
                  <select
                    value={voiceId ?? ""}
                    onChange={(e) => onVoice(e.target.value)}
                    className="h-8 max-w-[10rem] truncate rounded-[3px] border border-rule bg-paper px-1.5 text-[0.74rem] text-ink focus:border-gold focus:outline-none"
                  >
                    {voices.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <IconButton label="Stop narration" onClick={onClose}>
                <Close />
              </IconButton>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
