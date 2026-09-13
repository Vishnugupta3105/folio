"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * The hero mockup: an open book with one sentence highlighted and the companion
 * answering beside it. It has to communicate the whole product without a caption,
 * so the AI bubble arrives a beat after the page settles.
 */
export function HeroBook() {
  const still = useReducedMotion();

  const lines = [
    "of the mind as two systems. System 1 operates",
    "automatically and quickly, with little or no effort",
    "and no sense of voluntary control. System 2",
    null, // the highlighted line
    "activities that demand it, including complex",
    "computations. The operations of System 2 are often",
    "associated with the subjective experience of agency,",
    "choice, and concentration.",
  ];

  return (
    <motion.div
      initial={still ? false : { opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: [0.22, 0.68, 0.16, 1] }}
      className="relative flex items-center justify-center lg:pl-4"
      aria-hidden="true"
    >
      {/* The book */}
      <div className="relative w-full max-w-[30rem]">
        <div className="relative grid grid-cols-2 overflow-hidden rounded-[2px] bg-paper shadow-[0_24px_60px_-20px_rgba(34,32,28,0.34),0_2px_6px_rgba(34,32,28,0.1)] ring-1 ring-rule">
          {/* Verso */}
          <div className="px-7 py-9 sm:px-8">
            <p className="label mb-6 !text-[0.58rem] text-faint">Chapter One</p>
            <div className="space-y-[0.62rem]">
              {["Every author I know is asked the same", "question, and every author gives some", "version of the same answer. The mind is", "not one thing. It is two, and they do not", "always agree with each other."].map((line, i) => (
                <p key={i} className="font-display text-[0.83rem] leading-[1.5] text-ink-soft">
                  {line}
                </p>
              ))}
            </div>
            <div className="mt-8 space-y-[0.62rem] opacity-55">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-[0.42rem] rounded-full bg-rule" style={{ width: `${92 - i * 6}%` }} />
              ))}
            </div>
            <p className="mt-9 font-display text-[0.68rem] text-faint">18</p>
          </div>

          {/* Gutter */}
          <div className="gutter pointer-events-none absolute inset-y-0 left-1/2 w-10 -translate-x-1/2" />

          {/* Recto */}
          <div className="border-l border-rule/70 px-7 py-9 sm:px-8">
            <div className="space-y-[0.62rem]">
              {lines.map((line, i) =>
                line === null ? (
                  <motion.p
                    key="highlighted"
                    initial={still ? false : { backgroundSize: "0% 100%" }}
                    animate={{ backgroundSize: "100% 100%" }}
                    transition={{ delay: 0.85, duration: 0.6, ease: "easeOut" }}
                    style={{
                      backgroundImage:
                        "linear-gradient(var(--color-hl-amber), var(--color-hl-amber))",
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "left center",
                    }}
                    className="w-fit font-display text-[0.83rem] leading-[1.5] text-ink decoration-clone box-decoration-clone px-0.5"
                  >
                    is effortful, and it takes over the
                  </motion.p>
                ) : (
                  <p key={i} className="font-display text-[0.83rem] leading-[1.5] text-ink-soft">
                    {line}
                  </p>
                ),
              )}
            </div>
            <p className="mt-9 text-right font-display text-[0.68rem] text-faint">19</p>
          </div>
        </div>

        {/* The companion, arriving a beat after the highlight lands */}
        <motion.div
          initial={still ? false : { opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 1.5, duration: 0.55, ease: [0.22, 0.68, 0.16, 1] }}
          className="absolute -bottom-7 -right-3 w-[16.5rem] rounded-[3px] border border-rule bg-paper p-4 shadow-[0_16px_40px_-14px_rgba(34,32,28,0.4)] sm:-right-8"
        >
          <div className="flex items-center gap-2 border-b border-rule pb-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" />
            <span className="label !text-[0.56rem]">Companion</span>
            <span className="ml-auto font-display text-[0.68rem] italic text-faint">p. 19</span>
          </div>
          <p className="mt-3 text-[0.775rem] leading-[1.62] text-ink-soft">
            The author means deliberate attention &mdash; the kind you feel yourself spending.
            <motion.span
              initial={still ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 2.3, duration: 0.4 }}
            >
              {" "}It is the effort itself that makes it System 2.
            </motion.span>
          </p>
        </motion.div>
      </div>
    </motion.div>
  );
}
