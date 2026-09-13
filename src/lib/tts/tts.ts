"use client";

/**
 * Text-to-speech behind a provider seam.
 *
 * The browser provider is the default because it is the only one that reliably
 * reports sentence boundaries in real time, which is what the narration
 * highlight depends on. `/api/tts` proxies a cloud provider when one is
 * configured; the interface below is identical either way.
 */

export interface Voice {
  id: string;
  name: string;
  lang: string;
  /** Local voices start instantly; remote ones have network latency. */
  local: boolean;
}

export interface SpeakOptions {
  text: string;
  voiceId?: string | null;
  rate?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

export interface TextToSpeechService {
  readonly available: boolean;
  voices(): Promise<Voice[]>;
  speak(options: SpeakOptions): void;
  pause(): void;
  resume(): void;
  cancel(): void;
}

class BrowserTextToSpeech implements TextToSpeechService {
  private current: SpeechSynthesisUtterance | null = null;

  get available(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  async voices(): Promise<Voice[]> {
    if (!this.available) return [];

    const read = () =>
      speechSynthesis.getVoices().map((v) => ({
        id: v.voiceURI,
        name: v.name,
        lang: v.lang,
        local: v.localService,
      }));

    const immediate = read();
    if (immediate.length) return immediate;

    // Chrome populates the list asynchronously on first call.
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(read()), 700);
      speechSynthesis.addEventListener(
        "voiceschanged",
        () => {
          clearTimeout(timeout);
          resolve(read());
        },
        { once: true },
      );
    });
  }

  speak({ text, voiceId, rate = 1, onStart, onEnd, onError }: SpeakOptions): void {
    if (!this.available) {
      onError?.("This browser can't read aloud.");
      return;
    }

    // Narration and a spoken reply must never overlap, and they play through
    // two different engines — cancelling one has to reach the other.
    cloud?.cancel();
    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    utterance.pitch = 1;

    if (voiceId) {
      const voice = speechSynthesis.getVoices().find((v) => v.voiceURI === voiceId);
      if (voice) utterance.voice = voice;
    }

    utterance.onstart = () => onStart?.();
    utterance.onend = () => {
      if (this.current === utterance) this.current = null;
      onEnd?.();
    };
    utterance.onerror = (event) => {
      if (this.current === utterance) this.current = null;
      // A cancel we asked for arrives here too; it isn't a failure.
      if (event.error === "interrupted" || event.error === "canceled") return;
      onError?.("Narration stopped unexpectedly.");
    };

    this.current = utterance;
    speechSynthesis.speak(utterance);
  }

  pause(): void {
    if (this.available && speechSynthesis.speaking) speechSynthesis.pause();
  }

  resume(): void {
    if (this.available && speechSynthesis.paused) speechSynthesis.resume();
  }

  cancel(): void {
    cloud?.cancel();
    if (!this.available) return;
    this.current = null;
    speechSynthesis.cancel();
  }
}

/** Signed 16-bit little-endian mono PCM, matching `/api/tts`. */
const PCM_SAMPLE_RATE = 24000;

/**
 * Decodes a chunk of signed 16-bit little-endian PCM into Web Audio samples.
 *
 * Chunks arrive at whatever size the network hands over, so one sample's two
 * bytes can straddle the boundary between them. The odd trailing byte is
 * carried forward rather than dropped — losing it would shift every following
 * sample by one byte and turn the rest of the reply into static.
 */
export function decodePcm16(
  chunk: Uint8Array,
  carried: Uint8Array = new Uint8Array(0),
): { samples: Float32Array; leftover: Uint8Array } {
  const bytes = new Uint8Array(carried.length + chunk.length);
  bytes.set(carried);
  bytes.set(chunk, carried.length);

  const usable = bytes.length - (bytes.length % 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, usable);
  const samples = new Float32Array(usable / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;

  return { samples, leftover: bytes.slice(usable) };
}
/** Start speaking on a fifth of a second; wait for more before each later block. */
const FIRST_BLOCK = PCM_SAMPLE_RATE * 0.2;
const BLOCK = PCM_SAMPLE_RATE * 0.5;

/**
 * The cloud voice, for AI replies only.
 *
 * Page narration stays on the browser engine: the reading highlight is driven by
 * its real-time sentence boundaries, which recorded audio cannot report without
 * forced alignment. A spoken answer has no highlight to keep in step, so it is
 * free to use a voice that sounds like a person.
 *
 * Audio is played through Web Audio rather than an `<audio>` element because the
 * response is raw PCM arriving in ~40ms pieces: buffers are scheduled back to
 * back on the context clock as they land, so the first words play while the rest
 * is still being generated.
 */
class CloudReplyVoice {
  private context: AudioContext | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private request: AbortController | null = null;
  /** Bumped by every cancel, so a stream that is still arriving stops writing. */
  private generation = 0;

  cancel(): void {
    this.generation++;
    this.request?.abort();
    this.request = null;
    for (const source of this.sources) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        /* already finished */
      }
    }
    this.sources.clear();
    this.nextTime = 0;
    const context = this.context;
    this.context = null;
    if (context) void context.close().catch(() => {});
  }

  /** Resolves true when the reply was spoken, false when the caller should fall back. */
  async speak({ text, rate = 1, onStart, onEnd }: SpeakOptions): Promise<boolean> {
    this.cancel();
    const mine = this.generation;

    let response: Response;
    const request = new AbortController();
    this.request = request;
    try {
      response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: request.signal,
      });
    } catch {
      return false;
    }
    // 501 is the honest "no cloud voice configured"; anything else failed too.
    if (!response.ok || !response.body || this.generation !== mine) return false;

    const Constructor =
      typeof window !== "undefined"
        ? window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!Constructor) return false;

    const context = new Constructor({ sampleRate: PCM_SAMPLE_RATE });
    this.context = context;

    const reader = response.body.getReader();
    let leftover: Uint8Array = new Uint8Array(0);
    let pending: Float32Array[] = [];
    let pendingLength = 0;
    let started = false;
    let finished = false;

    const flush = (minimum: number) => {
      if (pendingLength < minimum || pendingLength === 0 || this.generation !== mine) return;

      const merged = new Float32Array(pendingLength);
      let at = 0;
      for (const part of pending) {
        merged.set(part, at);
        at += part.length;
      }
      pending = [];
      pendingLength = 0;

      const buffer = context.createBuffer(1, merged.length, PCM_SAMPLE_RATE);
      buffer.copyToChannel(merged, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      source.connect(context.destination);

      if (!started) {
        // A short lead-in so the first block is scheduled ahead of the clock
        // rather than fractionally behind it, which clips the opening word.
        this.nextTime = context.currentTime + 0.08;
        started = true;
        onStart?.();
      }
      const at2 = Math.max(this.nextTime, context.currentTime);
      source.start(at2);
      this.nextTime = at2 + buffer.duration / rate;

      this.sources.add(source);
      source.onended = () => {
        this.sources.delete(source);
        if (finished && this.generation === mine && this.sources.size === 0) onEnd?.();
      };
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (this.generation !== mine) return false;
        if (done) break;

        const decoded = decodePcm16(value, leftover);
        leftover = decoded.leftover;
        const samples = decoded.samples;

        pending.push(samples);
        pendingLength += samples.length;
        flush(started ? BLOCK : FIRST_BLOCK);
      }
    } catch {
      if (!started) return false;
    }

    finished = true;
    flush(1);
    if (!started) return false;
    if (this.sources.size === 0) onEnd?.();
    return true;
  }
}

let cloud: CloudReplyVoice | null = null;
function cloudReplyVoice(): CloudReplyVoice {
  if (!cloud) cloud = new CloudReplyVoice();
  return cloud;
}

let service: TextToSpeechService | null = null;

export function textToSpeech(): TextToSpeechService {
  if (!service) service = new BrowserTextToSpeech();
  return service;
}

/**
 * Speaks one passage through the configured provider, for AI voice replies.
 *
 * The cloud voice is tried first and the browser voice covers every way it can
 * fail — unconfigured, rate limited, offline. A reply the reader can't hear is a
 * worse outcome than one that sounds synthetic.
 */
export function speakOnce(text: string, voiceId: string | null, rate: number): void {
  void cloudReplyVoice()
    .speak({ text, rate })
    .then((spoken) => {
      if (!spoken) textToSpeech().speak({ text, voiceId, rate });
    });
}

/** Stops a spoken reply that is still playing. */
export function cancelSpokenReply(): void {
  cloud?.cancel();
}

export interface Sentence {
  text: string;
  /** Character offsets into the page's extracted text, for the highlight. */
  start: number;
  end: number;
}

/**
 * Splits a page into sentences with their offsets preserved.
 *
 * Offsets are what let the narration highlight land on the exact words in the
 * text layer, so the split must never lose or shift a character.
 */
export function splitSentences(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  // Break after . ! ? or a newline, tolerating quotes and brackets on the way out.
  const pattern = /[^.!?\n]+(?:[.!?]+["')\]]*|\n+|$)/g;

  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const trimmedStart = start + (raw.length - raw.trimStart().length);
    const body = raw.trim();

    // Skip fragments that are page furniture rather than prose.
    if (body.length < 2 || !/\p{L}/u.test(body)) continue;

    sentences.push({ text: body, start: trimmedStart, end: trimmedStart + body.length });
  }

  return sentences;
}
