"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";

/**
 * The opening.
 *
 * Only ever shown the first time a book is opened — a returning reader goes
 * straight to their page, because making them watch a cover swing open every
 * session would be a gimmick rather than a pleasure.
 */
export function BookOpening({
  show, title, author, coverUrl, status,
}: {
  show: boolean;
  title: string;
  author: string | null;
  coverUrl: string | null;
  /** The real processing stage, not a fake progress bar. */
  status: string | null;
}) {
  const still = useReducedMotion();

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="opening"
          className="paper-grain absolute inset-0 z-50 flex flex-col items-center justify-center bg-parchment"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.42, ease: "easeOut" } }}
        >
          <motion.div
            className="relative"
            style={{ perspective: 1600 }}
            initial={still ? false : { scale: 0.88, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.45, ease: [0.22, 0.68, 0.16, 1] }}
          >
            {/* The cover swings open on the spine. */}
            <motion.div
              className="h-[15rem] w-[10rem] origin-left overflow-hidden rounded-[2px] rounded-l-[1px] bg-paper shadow-[0_18px_40px_-14px_rgba(34,32,28,0.5)] ring-1 ring-rule"
              style={{ transformStyle: "preserve-3d" }}
              initial={{ rotateY: 0 }}
              animate={still ? { rotateY: 0 } : { rotateY: -118 }}
              transition={{ delay: 0.32, duration: 0.62, ease: [0.36, 0.06, 0.22, 1] }}
            >
              {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-parchment-deep p-4">
                  <p className="line-clamp-5 text-center font-display text-[0.9rem] leading-tight text-ink">
                    {title}
                  </p>
                </div>
              )}
            </motion.div>

            {/* The first page waiting beneath it. */}
            <div className="absolute inset-0 -z-10 rounded-[2px] bg-paper ring-1 ring-rule" />
          </motion.div>

          <motion.div
            className="mt-10 text-center"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.4 }}
          >
            <h2 className="max-w-[20rem] font-display text-[1.35rem] font-light leading-snug text-ink">
              {title}
            </h2>
            {author && <p className="mt-1 text-[0.8rem] text-muted">{author}</p>}
            {status && (
              <p className="mt-5 text-[0.78rem] italic text-faint" role="status">
                {status}
              </p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
