import "server-only";
import { GoogleGenAI, ThinkingLevel, type ThinkingConfig } from "@google/genai";

/**
 * Provider seam for the language model.
 *
 * `GeminiProvider` is the production path. `MockProvider` exists so the reader,
 * the voice loop and the streaming UI can be built and tested before an API key
 * exists — it streams a real SSE response with real timing, it simply does not
 * reach a model. Selection is by configuration, never by code change.
 */

export interface StreamRequest {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  /** Voice answers are shorter; page explanations are longer. */
  maxTokens?: number;
  /** Lower effort keeps first-token latency low for short reading questions. */
  effort?: "low" | "medium" | "high";
}

export interface AIProvider {
  readonly name: string;
  readonly live: boolean;
  stream(req: StreamRequest): AsyncIterable<string>;
}

/**
 * A reading question should start answering fast; a page breakdown can think.
 *
 * How you say that changed between model generations: 2.x takes a token budget,
 * 3.x takes a named level and rejects the budget outright with a 400. Both are
 * expressed here so a model swap is still just an env var.
 */
const THINKING_BUDGET: Record<NonNullable<StreamRequest["effort"]>, number> = {
  low: 0,
  medium: 1024,
  high: 4096,
};

const THINKING_LEVEL: Record<NonNullable<StreamRequest["effort"]>, ThinkingLevel> = {
  // MINIMAL rather than LOW: a reading question wants its first word back now,
  // and the retrieved passages already carry the reasoning the answer needs.
  low: ThinkingLevel.MINIMAL,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

function thinkingConfig(
  model: string,
  effort: NonNullable<StreamRequest["effort"]>,
): ThinkingConfig {
  // Anything past the 2.x line uses levels. Unknown future names get levels too,
  // which is the forward-compatible guess — and the retry below covers the rest.
  return /^gemini-[012]\./.test(model)
    ? { thinkingBudget: THINKING_BUDGET[effort] }
    : { thinkingLevel: THINKING_LEVEL[effort] };
}

class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  readonly live = true;
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
    this.model = process.env.FOLIO_AI_MODEL || "gemini-3.5-flash-lite";
  }

  async *stream(req: StreamRequest): AsyncIterable<string> {
    const effort = req.effort ?? "low";

    // Gemini alternates user/model turns; the system prompt is separate.
    const contents = req.messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

    const config = {
      systemInstruction: req.system,
      maxOutputTokens: req.maxTokens ?? 2048,
      temperature: 0.4,
    };

    let response;
    try {
      response = await this.client.models.generateContentStream({
        model: this.model,
        contents,
        config: { ...config, thinkingConfig: thinkingConfig(this.model, effort) },
      });
    } catch (error) {
      // A model that rejects our thinking config is still perfectly usable with
      // its own default. Better to answer a little slower than not at all.
      if (!isBadRequest(error)) throw error;
      console.warn(
        `[folio] ${this.model} rejected the thinking config; retrying with its default.`,
      );
      response = await this.client.models.generateContentStream({
        model: this.model,
        contents,
        config,
      });
    }

    for await (const chunk of response) {
      const text = chunk.text;
      if (text) yield text;
    }
  }
}

class MockProvider implements AIProvider {
  readonly name = "mock";
  readonly live = false;

  async *stream(req: StreamRequest): AsyncIterable<string> {
    const question = req.messages.at(-1)?.content ?? "";
    const selected = /<selected-text[^>]*>\n([\s\S]*?)\n<\/selected-text>/.exec(question)?.[1];
    const asked = /<question>\n([\s\S]*?)\n<\/question>/.exec(question)?.[1] ?? question;

    const body = [
      "**Folio is running without an AI key.**",
      "",
      "Everything else on this page is real — the book, your highlights, notes, bookmarks, the voice capture and the narration all work. This panel is the only thing standing in.",
      "",
      selected
        ? `You asked about this passage: *"${selected.slice(0, 160).trim()}${selected.length > 160 ? "…" : ""}"*`
        : `You asked: *"${asked.slice(0, 160).trim()}"*`,
      "",
      "Add `GEMINI_API_KEY` to `.env.local` and restart, and this same panel will stream a real answer about the page you're on.",
    ].join("\n");

    // Stream in word groups with realistic pacing so the streaming UI is
    // genuinely exercised rather than resolved instantly.
    const tokens = body.match(/\S+\s*/g) ?? [];
    for (let i = 0; i < tokens.length; i += 2) {
      await new Promise((r) => setTimeout(r, 18));
      yield tokens.slice(i, i + 2).join("");
    }
  }
}

function isBadRequest(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("400") || /invalid argument/i.test(message);
}

let provider: AIProvider | null = null;

/** The key is read once, on first use, so tests can set it before the call. */
export function aiProvider(): AIProvider {
  if (!provider) {
    const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    provider = key ? new GeminiProvider(key) : new MockProvider();
  }
  return provider;
}

/** Whether real answers are available, for the UI to state honestly. */
export function aiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}
