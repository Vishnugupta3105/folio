"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

/**
 * Network state, stated once and quietly.
 *
 * An already-open book keeps working offline — the file, the rendered pages and
 * every mark are in memory, and reading position is held locally until it can
 * sync. The only thing the reader needs to know is that nothing is being lost.
 */
export function OfflineNotice() {
  const [offline, setOffline] = useState(false);
  const [recovered, setRecovered] = useState(false);

  useEffect(() => {
    const goOffline = () => {
      setOffline(true);
      setRecovered(false);
    };
    const goOnline = () => {
      setOffline(false);
      // Only mention coming back if they were told about going away.
      setRecovered((was) => was || document.hasFocus());
      setTimeout(() => setRecovered(false), 3200);
    };

    setOffline(!navigator.onLine);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  return (
    <AnimatePresence>
      {(offline || recovered) && (
        <motion.p
          key={offline ? "offline" : "online"}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.26, ease: [0.22, 0.68, 0.16, 1] }}
          role="status"
          className="pointer-events-none fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-full border border-rule bg-paper/95 px-4 py-1.5 text-[0.74rem] text-ink-soft shadow-[0_8px_24px_-10px_rgba(34,32,28,0.4)] backdrop-blur-sm"
        >
          {offline
            ? "You're offline. Your reading progress will sync when you're back."
            : "Back online. Everything synced."}
        </motion.p>
      )}
    </AnimatePresence>
  );
}
