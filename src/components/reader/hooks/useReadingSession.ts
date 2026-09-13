"use client";

import { useEffect, useRef } from "react";
import { api } from "@/lib/api";

/**
 * Records a sitting: when it started, how many distinct pages were read, how
 * many questions were asked.
 *
 * Writes exactly twice — once on open, once on the way out — so tracking never
 * competes with reading for the network.
 */
export function useReadingSession({
  bookId, page, questionsAsked, ready,
}: {
  bookId: string;
  page: number;
  questionsAsked: number;
  ready: boolean;
}) {
  const sessionId = useRef<string | null>(null);
  const pagesSeen = useRef(new Set<number>());
  const questions = useRef(0);

  pagesSeen.current.add(page);
  questions.current = questionsAsked;

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    void api<{ session: { id: string } }>(`/api/books/${bookId}/session`, { method: "POST" })
      .then(({ session }) => {
        if (!cancelled) sessionId.current = session.id;
      })
      .catch(() => {});

    const close = () => {
      const id = sessionId.current;
      if (!id) return;
      const body = JSON.stringify({
        sessionId: id,
        pagesRead: pagesSeen.current.size,
        questionsAsked: questions.current,
        ended: true,
      });
      // A beacon survives the page going away; fetch would be cancelled.
      if (!navigator.sendBeacon?.(`/api/books/${bookId}/session`, new Blob([body], { type: "application/json" }))) {
        void api(`/api/books/${bookId}/session`, { method: "PATCH", body }).catch(() => {});
      }
    };

    window.addEventListener("pagehide", close);
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", close);
      close();
    };
  }, [bookId, ready]);
}
