"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { speechToText, sttErrorMessage, warmMicrophone, type SttError } from "@/lib/voice/stt";
import { mark, measure } from "@/lib/perf";

export type VoiceState =
  | "idle"
  | "listening"
  | "submitting"
  | "error";

/**
 * Hold space, talk, release, send.
 *
 * The state machine deliberately starts capture on `keydown` rather than
 * waiting for `keyup` — the microphone has to be live by the time the reader
 * has finished drawing breath, or the first words are lost.
 *
 * It stays out of the way everywhere it should: while typing in a field, while
 * a modifier is held, and on auto-repeat when a key is simply held down.
 */
export function useSpaceVoice({
  enabled, onSubmit, onCancel,
}: {
  enabled: boolean;
  onSubmit: (transcript: string) => void;
  onCancel?: () => void;
}) {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const held = useRef(false);
  const latest = useRef("");
  const cancelled = useRef(false);
  const lowConfidence = useRef(false);
  /**
   * One capture produces exactly one request.
   *
   * Two paths race to finish a capture: the recogniser's own `onend`, and the
   * timeout that covers engines which never fire it. Whichever arrives first
   * wins, and this latch makes the other a no-op.
   */
  const settled = useRef(false);
  /** Lets `begin` reach the latest `finish` without becoming unstable itself. */
  const finishRef = useRef<() => void>(() => {});

  const stt = useMemo(() => speechToText(), []);

  /**
   * The caller's handlers, held in a ref rather than closed over.
   *
   * The keyboard listeners must be registered exactly once per `enabled` change,
   * because their cleanup calls `stt.abort()` — anything that makes that effect
   * re-run kills a capture already in progress. `finish` and `cancel` used to
   * depend on `onSubmit`/`onCancel`, and the reader passes inline closures, so
   * every render rebuilt them and re-ran the effect. `begin()` sets state, which
   * renders, so the microphone was aborted about a millisecond after it opened:
   * nothing was ever heard, and every release said "Couldn't quite catch that."
   */
  const handlers = useRef({ onSubmit, onCancel });
  handlers.current = { onSubmit, onCancel };

  // Ask for the microphone once, up front, so the first question doesn't pay
  // for the permission prompt.
  useEffect(() => {
    if (!enabled || !stt.available) return;
    let cancelledWarm = false;
    const id = setTimeout(() => {
      if (!cancelledWarm) void warmMicrophone();
    }, 1200);
    return () => {
      cancelledWarm = true;
      clearTimeout(id);
    };
  }, [enabled, stt.available]);

  const begin = useCallback(() => {
    cancelled.current = false;
    lowConfidence.current = false;
    settled.current = false;
    latest.current = "";
    setTranscript("");
    setError(null);
    setState("listening");
    mark("stt");

    void stt.start({
      onTranscript: ({ transcript: text, confidence, isFinal }) => {
        if (!latest.current && text) measure("stt:first-transcript", "stt");
        latest.current = text;
        setTranscript(text);
        if (isFinal && confidence > 0 && confidence < 0.5) lowConfidence.current = true;
      },
      onError: (e: SttError) => {
        setError(sttErrorMessage(e));
        setState("error");
        held.current = false;
      },
      onEnd: () => {
        // Recognition ended. If the key is already up, this is the moment the
        // transcript is final and can be sent.
        if (!held.current) finishRef.current();
      },
    });
  }, [stt]);

  const finish = useCallback(() => {
    if (settled.current) return;
    settled.current = true;

    const text = latest.current.trim();

    if (cancelled.current) {
      setState("idle");
      setTranscript("");
      return;
    }

    if (!text) {
      setError("Couldn't quite catch that. Try again.");
      setState("error");
      return;
    }

    // Don't send something the recogniser itself doubts — offer a retry instead.
    if (lowConfidence.current && text.split(/\s+/).length < 3) {
      setError("Couldn't quite catch that. Try again.");
      setState("error");
      return;
    }

    setState("submitting");
    handlers.current.onSubmit(text);
    setState("idle");
    setTranscript("");
  }, []);

  finishRef.current = finish;

  const cancel = useCallback(() => {
    cancelled.current = true;
    held.current = false;
    stt.abort();
    setState("idle");
    setTranscript("");
    setError(null);
    handlers.current.onCancel?.();
  }, [stt]);

  useEffect(() => {
    if (!enabled) return;

    const isTyping = (target: EventTarget | null): boolean => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      const tag = element.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        element.isContentEditable ||
        Boolean(element.closest?.("[data-folio-typing]"))
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      if (isTyping(event.target)) return;
      // A modifier means the reader meant a different shortcut.
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // Space would otherwise scroll the document.
      event.preventDefault();

      // Auto-repeat fires keydown many times; only the first one starts capture.
      if (event.repeat || held.current) return;

      held.current = true;
      begin();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !held.current) return;
      event.preventDefault();
      held.current = false;

      // Stop capture and let `onEnd` deliver the final transcript. A recogniser
      // that never fires `onEnd` is covered by the timeout below.
      stt.stop();
      setTimeout(() => {
        if (!held.current && !cancelled.current) finish();
      }, 450);
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && held.current) cancel();
    };

    // Releasing the key outside the window still has to end the capture, or the
    // microphone would stay open indefinitely.
    const onBlur = () => {
      if (held.current) {
        held.current = false;
        stt.stop();
        setTimeout(() => finish(), 300);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("keydown", onEscape);
    window.addEventListener("blur", onBlur);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("keydown", onEscape);
      window.removeEventListener("blur", onBlur);
      stt.abort();
    };
  }, [enabled, begin, finish, cancel, stt]);

  /** Press-and-hold equivalent for touch, where there is no spacebar. */
  const holdStart = useCallback(() => {
    if (held.current) return;
    held.current = true;
    begin();
  }, [begin]);

  const holdEnd = useCallback(() => {
    if (!held.current) return;
    held.current = false;
    stt.stop();
    setTimeout(() => {
      if (!held.current && !cancelled.current) finish();
    }, 450);
  }, [stt, finish]);

  return {
    state,
    transcript,
    error,
    supported: stt.available,
    cancel,
    dismissError: () => {
      setError(null);
      setState("idle");
    },
    holdStart,
    holdEnd,
  };
}
