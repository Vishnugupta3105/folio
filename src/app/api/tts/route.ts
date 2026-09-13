import { GoogleGenAI } from "@google/genai";
import { requireUser } from "@/lib/auth";
import { badRequest, handle } from "@/lib/http";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Gemini returns signed 16-bit little-endian mono PCM at this rate. */
export const PCM_SAMPLE_RATE = 24000;

/**
 * Cloud text-to-speech, when configured.
 *
 * The reader defaults to the browser's own synthesis because it reports
 * sentence boundaries in real time, which the narration highlight needs. This
 * route exists so a higher-quality voice can be swapped in for AI replies and
 * for browsers with poor built-in voices — the client calls it only when
 * `TTS_PROVIDER` is set to something other than `browser`.
 */
export const POST = handle(async (request: Request) => {
  await requireUser();

  const provider = process.env.TTS_PROVIDER ?? "browser";
  // Gemini speaks through the key that already answers the questions, so a
  // separate TTS_API_KEY is optional for it and required for the others.
  const key =
    process.env.TTS_API_KEY ||
    (provider === "gemini" ? process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY : undefined);

  if (provider === "browser" || !key) {
    return NextResponse.json(
      { error: "No cloud voice is configured; the browser voice is in use." },
      { status: 501 },
    );
  }

  const { text } = await request.json();
  if (!text?.trim()) return badRequest("Nothing to read.");

  // Streamed, because generating a whole reply before the first sound takes
  // 14-17s where the first chunk arrives in about two. The audio generates
  // faster than it plays, so playback never catches up with the stream.
  if (provider === "gemini") {
    return new Response(gemini(text, key), {
      headers: {
        "Content-Type": `audio/pcm; rate=${PCM_SAMPLE_RATE}`,
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  }

  const audio =
    provider === "elevenlabs"
      ? await elevenLabs(text, key)
      : provider === "openai"
        ? await openAI(text, key)
        : null;

  if (!audio) return badRequest(`Unknown TTS provider "${provider}".`);

  return new Response(audio, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" },
  });
});

/**
 * Gemini speech, streamed as raw PCM.
 *
 * The voices are prebuilt names rather than ids — "Kore" is a clear, even
 * reading voice; the full set is in the Gemini speech-generation docs.
 */
function gemini(text: string, key: string): ReadableStream<Uint8Array> {
  const client = new GoogleGenAI({ apiKey: key });
  const model = process.env.TTS_MODEL || "gemini-3.1-flash-tts-preview";
  const voiceName = process.env.TTS_VOICE || "Kore";

  return new ReadableStream({
    async start(controller) {
      try {
        const response = await client.models.generateContentStream({
          model,
          contents: [{ role: "user", parts: [{ text }] }],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          },
        });

        for await (const chunk of response) {
          const data = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
          if (data) controller.enqueue(new Uint8Array(Buffer.from(data, "base64")));
        }
        controller.close();
      } catch (error) {
        console.error("[folio:tts]", error);
        // The client falls back to the browser voice on a short or empty body,
        // so erroring the stream is better than closing it as if it succeeded.
        controller.error(error);
      }
    },
  });
}

async function elevenLabs(text: string, key: string): Promise<ArrayBuffer> {
  const voice = process.env.TTS_VOICE || "21m00Tcm4TlvDq8ikWAM";
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_turbo_v2_5" }),
  });
  if (!response.ok) throw new Error(`ElevenLabs responded ${response.status}`);
  return response.arrayBuffer();
}

async function openAI(text: string, key: string): Promise<ArrayBuffer> {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: process.env.TTS_VOICE || "alloy",
      input: text,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI responded ${response.status}`);
  return response.arrayBuffer();
}
