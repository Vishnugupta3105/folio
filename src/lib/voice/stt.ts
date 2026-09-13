"use client";

/**
 * Speech-to-text behind a provider seam.
 *
 * The shipped provider is the browser's own recognition engine: it starts in
 * tens of milliseconds with no network round trip, which is what makes
 * hold-space-and-talk feel immediate. A streaming cloud provider can implement
 * the same interface without the reader knowing.
 */

export interface TranscriptEvent {
  transcript: string;
  isFinal: boolean;
  confidence: number;
}

export interface SpeechToTextService {
  readonly available: boolean;
  start(handlers: {
    onTranscript: (event: TranscriptEvent) => void;
    onError: (error: SttError) => void;
    onEnd: () => void;
  }): Promise<void>;
  stop(): void;
  abort(): void;
}

export type SttError =
  | { kind: "unsupported" }
  | { kind: "permission-denied" }
  | { kind: "no-speech" }
  | { kind: "network" }
  | { kind: "unknown"; detail: string };

export function sttErrorMessage(error: SttError): string {
  switch (error.kind) {
    case "unsupported":
      return "Voice questions need Chrome, Edge or Safari. You can still type your question.";
    case "permission-denied":
      return "Microphone access is required for voice questions. Enable it in your browser's site settings.";
    case "no-speech":
      return "Couldn't quite catch that. Try again.";
    case "network":
      return "Speech recognition couldn't reach the network. Type your question instead.";
    default:
      return "The microphone isn't responding. You can type your question instead.";
  }
}

interface RecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  onaudiostart: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      length: number;
      [alt: number]: { transcript: string; confidence: number };
    };
  };
}

function constructor(): (new () => RecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    | (new () => RecognitionLike)
    | null;
}

class BrowserSpeechToText implements SpeechToTextService {
  private recognition: RecognitionLike | null = null;
  private stopping = false;

  get available(): boolean {
    return constructor() !== null;
  }

  async start(handlers: {
    onTranscript: (event: TranscriptEvent) => void;
    onError: (error: SttError) => void;
    onEnd: () => void;
  }): Promise<void> {
    const Recognition = constructor();
    if (!Recognition) {
      handlers.onError({ kind: "unsupported" });
      return;
    }

    this.abort();
    this.stopping = false;

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      // Rebuild the whole transcript each time: interim results are revised in
      // place, so appending would duplicate words.
      let text = "";
      let isFinal = false;
      let confidence = 1;
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        text += result[0].transcript;
        if (result.isFinal) {
          isFinal = true;
          confidence = Math.min(confidence, result[0].confidence || 1);
        }
      }
      handlers.onTranscript({ transcript: text.trim(), isFinal, confidence });
    };

    recognition.onerror = (event) => {
      // A stop() we asked for surfaces as "aborted"; that isn't a failure.
      if (this.stopping && (event.error === "aborted" || event.error === "no-speech")) return;
      const map: Record<string, SttError> = {
        "not-allowed": { kind: "permission-denied" },
        "service-not-allowed": { kind: "permission-denied" },
        "no-speech": { kind: "no-speech" },
        network: { kind: "network" },
      };
      handlers.onError(map[event.error] ?? { kind: "unknown", detail: event.error });
    };

    recognition.onend = () => {
      handlers.onEnd();
      this.recognition = null;
    };

    this.recognition = recognition;
    try {
      recognition.start();
    } catch {
      // Starting twice in the same tick throws; the existing session is fine.
    }
  }

  stop(): void {
    this.stopping = true;
    try {
      this.recognition?.stop();
    } catch {
      /* already stopped */
    }
  }

  abort(): void {
    this.stopping = true;
    try {
      this.recognition?.abort();
    } catch {
      /* already stopped */
    }
    this.recognition = null;
  }
}

let service: SpeechToTextService | null = null;

export function speechToText(): SpeechToTextService {
  if (!service) service = new BrowserSpeechToText();
  return service;
}

/**
 * Asks for microphone permission ahead of time.
 *
 * Called when the reader opens so the first hold-space doesn't spend its first
 * half-second on a permission prompt.
 */
export async function warmMicrophone(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    return true;
  } catch {
    return false;
  }
}
