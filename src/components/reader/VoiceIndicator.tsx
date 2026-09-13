"use client";

import { AnimatePresence, motion } from "motion/react";
import type { VoiceState } from "./hooks/useSpaceVoice";

/**
 * The listening state.
 *
 * Deliberately small and bottom-centred: the book has to stay visible and
 * readable while the reader is speaking, so this never covers the page.
 */
export function VoiceIndicator({
  state, transcript, error, supported, onDismissError, onCancel,
}: {
  state: VoiceState;
  transcript: string;
  error: string | null;
  /** False in browsers with no speech recognition, so we can say so. */
  supported: boolean;
  onDismissError: () => void;
  onCancel: () => void;
}) {
  const visible = state === "listening" || state === "submitting" || Boolean(error);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="voice"
          initial={{ opacity: 0, y: 14, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98, transition: { duration: 0.16 } }}
          transition={{ type: "spring", stiffness: 420, damping: 32 }}
          className="pointer-events-none fixed bottom-24 left-1/2 z-50 w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2"
          role="status"
          aria-live="polite"
        >
          <div className="pointer-events-auto rounded-[5px] border border-rule bg-paper/95 px-5 py-3.5 shadow-[0_18px_44px_-16px_rgba(34,32,28,0.5)] backdrop-blur-sm">
            {error ? (
              <div className="flex items-start gap-3">
                <p className="flex-1 text-[0.82rem] leading-relaxed text-ink-soft">{error}</p>
                <button
                  onClick={onDismissError}
                  className="shrink-0 text-[0.74rem] text-muted transition-colors hover:text-ink"
                >
                  Dismiss
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-oxblood opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-oxblood" />
                  </span>

                  <span className="label !text-ink">
                    {state === "submitting" ? "Thinking" : "Listening"}
                  </span>

                  <Waveform />

                  <button
                    onClick={onCancel}
                    className="ml-auto shrink-0 text-[0.7rem] text-faint transition-colors hover:text-ink"
                  >
                    esc to cancel
                  </button>
                </div>

                <p
                  className={`mt-2.5 min-h-[1.3rem] text-[0.88rem] leading-relaxed ${
                    transcript ? "text-ink" : "italic text-faint"
                  }`}
                >
                  {transcript || "Ask anything about this page…"}
                </p>

                {state === "listening" && (
                  <p className="mt-1.5 text-[0.7rem] text-faint">
                    {transcript
                      ? "Release space to ask"
                      : supported
                        ? "Release space to ask — if your browser is asking to use the microphone, allow it"
                        : "This browser has no speech recognition. Type your question instead."}
                  </p>
                )}
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Twelve bars at staggered phases — a suggestion of sound, not a real FFT. */
function Waveform() {
  return (
    <div className="flex h-4 items-center gap-[2px]" aria-hidden="true">
      {Array.from({ length: 12 }).map((_, i) => (
        <span
          key={i}
          className="wave-bar w-[2px] rounded-full bg-gold"
          style={{
            height: `${[40, 70, 100, 62, 88, 46, 76, 100, 54, 84, 60, 38][i]}%`,
            animationDelay: `${i * 0.07}s`,
          }}
        />
      ))}
    </div>
  );
}
