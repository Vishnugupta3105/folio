"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { splitSentences, textToSpeech, type Sentence, type Voice } from "@/lib/tts/tts";
import { mark, measure } from "@/lib/perf";

export interface NarrationState {
  playing: boolean;
  paused: boolean;
  /** The sentence currently being spoken, with offsets for the page highlight. */
  current: { page: number; start: number; end: number } | null;
  sentenceIndex: number;
  sentenceCount: number;
  rate: number;
  voiceId: string | null;
  voices: Voice[];
  error: string | null;
}

export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

/**
 * macOS and Windows both ship a pile of legacy and novelty voices alongside a
 * few genuinely good neural ones, and `getVoices()` returns them in no useful
 * order. This ranks them so the default sounds like a person reading rather
 * than a 2005 screen reader.
 */
const PREMIUM = /premium|enhanced|neural|natural|siri/i;
// Deep, natural male voices, best first. Present only if downloaded.
const MALE = /\b(tom|evan|aaron|alex|daniel|oliver|reed|rishi|guy|ryan)\b/i;
const NOVELTY =
  /bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|albert|bruce|fred|junior|ralph|kathy|princess|deranged|hysterical|bells/i;

export function rankVoices(voices: Voice[]): Voice[] {
  const english = voices.filter((v) => /^en/i.test(v.lang));
  const pool = english.length ? english : voices;

  return [...pool].sort((a, b) => score(b) - score(a));
}

function score(voice: Voice): number {
  let points = 0;
  // A neural voice is the single biggest jump in quality.
  if (PREMIUM.test(voice.name)) points += 100;
  // Asked for: a male voice by default where one is available.
  if (MALE.test(voice.name)) points += 40;
  // Local voices start instantly; remote ones stall before the first word.
  if (voice.local) points += 20;
  if (/en[-_]?(US|GB)/i.test(voice.lang)) points += 10;
  // Never default to a joke voice.
  if (NOVELTY.test(voice.name)) points -= 500;
  return points;
}

/**
 * Reads the book aloud, one sentence at a time.
 *
 * Sentence-at-a-time is a deliberate choice over a single page-long utterance:
 * it is the only way to know exactly which words are being spoken right now, so
 * the highlight on the page stays truthful. When a page runs out, narration
 * carries on into the next one.
 */
export function useNarration({
  textFor, pageCount, page, onAdvancePage, startSentence,
}: {
  /** Where a page's words come from — pdf.js for a PDF, the index for an EPUB. */
  textFor: ((page: number) => Promise<string>) | null;
  pageCount: number;
  page: number;
  onAdvancePage: (page: number) => void;
  startSentence?: number | null;
}) {
  const tts = textToSpeech();

  const [state, setState] = useState<NarrationState>({
    playing: false,
    paused: false,
    current: null,
    sentenceIndex: 0,
    sentenceCount: 0,
    rate: 1,
    voiceId: null,
    voices: [],
    error: null,
  });

  const sentences = useRef<Sentence[]>([]);
  const index = useRef(0);
  const pageRef = useRef(page);
  const active = useRef(false);
  const settings = useRef({ rate: 1, voiceId: null as string | null });

  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  useEffect(() => {
    tts.voices().then((all) => {
      const voices = rankVoices(all);
      setState((s) => ({
        ...s,
        voices,
        // The first entry is the best available voice, not merely the first the
        // system happens to list — which on macOS is a dated novelty-adjacent
        // voice that makes the whole feature sound cheap.
        voiceId: s.voiceId ?? voices[0]?.id ?? null,
      }));
    });
  }, [tts]);

  useEffect(() => {
    settings.current = { rate: state.rate, voiceId: state.voiceId };
  }, [state.rate, state.voiceId]);

  const loadPage = useCallback(
    async (n: number): Promise<Sentence[]> => {
      if (!textFor) return [];
      return splitSentences(await textFor(n));
    },
    [textFor],
  );

  /** Speaks sentence `i` on the current page, advancing when it finishes. */
  const speakFrom = useCallback(
    (i: number) => {
      const list = sentences.current;

      if (i >= list.length) {
        // Page finished — continue into the next one.
        const next = pageRef.current + 1;
        if (!textFor || next > pageCount) {
          active.current = false;
          setState((s) => ({ ...s, playing: false, current: null }));
          return;
        }
        void loadPage(next).then((loaded) => {
          if (!active.current) return;
          sentences.current = loaded;
          index.current = 0;
          pageRef.current = next;
          onAdvancePage(next);
          setState((s) => ({ ...s, sentenceCount: loaded.length }));
          // An empty page (a plate, a divider) shouldn't stall the narration.
          if (loaded.length === 0) speakFrom(0);
          else speakFrom(0);
        });
        return;
      }

      const sentence = list[i];
      index.current = i;
      setState((s) => ({
        ...s,
        playing: true,
        paused: false,
        sentenceIndex: i,
        current: { page: pageRef.current, start: sentence.start, end: sentence.end },
      }));

      mark("tts");
      tts.speak({
        text: sentence.text,
        voiceId: settings.current.voiceId,
        rate: settings.current.rate,
        onStart: () => {
          if (i === 0) measure("tts:start", "tts");
        },
        onEnd: () => {
          if (!active.current) return;
          speakFrom(i + 1);
        },
        onError: (message) => {
          active.current = false;
          setState((s) => ({ ...s, playing: false, current: null, error: message }));
        },
      });
    },
    [textFor, pageCount, loadPage, onAdvancePage, tts],
  );

  const play = useCallback(async () => {
    if (!textFor) return;
    if (!tts.available) {
      setState((s) => ({ ...s, error: "This browser can't read aloud." }));
      return;
    }

    // Resuming from a pause continues the same sentence rather than restarting.
    if (state.paused) {
      active.current = true;
      tts.resume();
      setState((s) => ({ ...s, playing: true, paused: false }));
      return;
    }

    const list = await loadPage(page);
    sentences.current = list;
    pageRef.current = page;
    active.current = true;

    const from = Math.max(0, Math.min(startSentence ?? 0, Math.max(list.length - 1, 0)));
    setState((s) => ({ ...s, sentenceCount: list.length, error: null }));
    speakFrom(from);
  }, [textFor, tts, state.paused, loadPage, page, startSentence, speakFrom]);

  const pause = useCallback(() => {
    tts.pause();
    setState((s) => ({ ...s, playing: false, paused: true }));
  }, [tts]);

  const stop = useCallback(() => {
    active.current = false;
    tts.cancel();
    setState((s) => ({ ...s, playing: false, paused: false, current: null }));
  }, [tts]);

  const skip = useCallback(
    (delta: number) => {
      if (!sentences.current.length) return;
      active.current = true;
      const target = Math.max(0, index.current + delta);
      tts.cancel();
      speakFrom(target);
    },
    [tts, speakFrom],
  );

  /**
   * Pause-and-ask: narration stops where it is and can be resumed from the
   * exact same sentence once the question has been answered.
   */
  const interrupt = useCallback(() => {
    if (!state.playing) return false;
    tts.cancel();
    setState((s) => ({ ...s, playing: false, paused: true }));
    return true;
  }, [state.playing, tts]);

  const resumeFromInterrupt = useCallback(() => {
    if (!state.paused) return;
    active.current = true;
    tts.cancel();
    speakFrom(index.current);
  }, [state.paused, tts, speakFrom]);

  const setRate = useCallback(
    (rate: number) => {
      setState((s) => ({ ...s, rate }));
      settings.current.rate = rate;
      // The rate of an utterance already speaking can't change, so restart the
      // current sentence at the new speed.
      if (active.current && state.playing) {
        tts.cancel();
        setTimeout(() => speakFrom(index.current), 40);
      }
    },
    [tts, state.playing, speakFrom],
  );

  const setVoice = useCallback(
    (voiceId: string) => {
      setState((s) => ({ ...s, voiceId }));
      settings.current.voiceId = voiceId;
      if (active.current && state.playing) {
        tts.cancel();
        setTimeout(() => speakFrom(index.current), 40);
      }
    },
    [tts, state.playing, speakFrom],
  );

  // Never leave a voice speaking after the reader has closed the book.
  useEffect(
    () => () => {
      active.current = false;
      tts.cancel();
    },
    [tts],
  );

  return {
    ...state,
    play,
    pause,
    stop,
    skip,
    interrupt,
    resumeFromInterrupt,
    setRate,
    setVoice,
    dismissError: () => setState((s) => ({ ...s, error: null })),
  };
}
