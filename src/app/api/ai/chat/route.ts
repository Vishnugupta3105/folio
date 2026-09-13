import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { aiProvider } from "@/lib/ai/provider";
import { ACTIONS, type ActionId } from "@/lib/ai/actions";
import { buildReadingContext, requestsSpoilers, selectHistory } from "@/lib/ai/context";
import { loadChunks } from "@/lib/retrieval";
import { NextResponse } from "next/server";

// Streaming needs the Node runtime; the edge runtime can't reach the adapters.
export const runtime = "nodejs";
export const maxDuration = 60;

interface ChatBody {
  bookId: string;
  page: number;
  question?: string;
  selectedText?: string | null;
  action?: ActionId;
  /** Voice answers are kept short and are spoken aloud. */
  voice?: boolean;
}

export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });
  }

  const body = (await request.json()) as ChatBody;
  const book = await db.getBook(user.id, body.bookId);
  if (!book) {
    return NextResponse.json({ error: "That book isn't in your library." }, { status: 404 });
  }

  // An action turns a selection into a question; `ask` uses the reader's words.
  const action = body.action ? ACTIONS[body.action] : ACTIONS.ask;
  const selection = body.selectedText?.trim() || null;
  const question =
    action.id === "ask" || action.id === "explain-page"
      ? body.question?.trim() || action.prompt(selection ?? "")
      : action.prompt(selection ?? body.question ?? "");

  if (!question) {
    return NextResponse.json({ error: "There was no question to ask." }, { status: 400 });
  }

  const [chunks, highlights, history] = await Promise.all([
    loadChunks(book.id, () => db.listChunks(book.id)),
    db.listHighlights(user.id, book.id),
    db.listMessages(user.id, book.id),
  ]);

  const context = buildReadingContext({
    book,
    chunks,
    currentPage: body.page,
    selectedText: selection,
    question,
    highlights,
    history,
    allowSpoilers: requestsSpoilers(body.question ?? question),
  });

  const messages = [
    ...selectHistory(history, question).map((m) => ({
      role: m.role,
      content: m.content,
    })),
    { role: "user" as const, content: context.userContent },
  ];

  const now = new Date().toISOString();
  await db.createMessage({
    userId: user.id,
    bookId: book.id,
    role: "user",
    content: question,
    page: body.page,
    selectedText: selection,
    sourcePages: null,
    createdAt: now,
  });

  const system = body.voice
    ? `${context.system}\n\nThis answer will be spoken aloud. Keep it under 90 words, use no markdown, no bullets and no headings — just clear spoken sentences.`
    : context.system;

  const encoder = new TextEncoder();
  const provider = aiProvider();
  let answer = "";

  // The reader can close the panel, turn the page or leave mid-answer. When the
  // response is cancelled the controller is already closed, so every write is
  // guarded and the model loop is stopped rather than left generating into a
  // socket nobody is reading.
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };

      // Sources go first so the panel can render citations before the prose
      // arrives — it makes the answer feel grounded from the first token.
      send("sources", { pages: context.sourcePages, live: provider.live });

      try {
        for await (const delta of provider.stream({
          system,
          messages,
          maxTokens: body.voice ? 400 : action.id === "explain-page" ? 1600 : 1200,
          effort: action.id === "explain-page" || action.id === "visualize" ? "medium" : "low",
        })) {
          if (closed) break;
          answer += delta;
          send("delta", delta);
        }
        send("done", { pages: context.sourcePages });
      } catch (error) {
        console.error("[folio:ai]", error);
        const detail = error instanceof Error ? error.message : String(error);
        // A free-tier key hits its per-minute ceiling long before anything is
        // actually broken, and "temporarily unavailable" sends people hunting
        // for a bug that isn't there.
        const rateLimited = detail.includes("429") || /quota|rate limit/i.test(detail);
        send("error", {
          message: rateLimited
            ? "That's this key's rate limit for the moment. Your book is still here — wait a minute and ask again."
            : "Your book is still here — the AI is temporarily unavailable.",
        });
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed by the client going away */
          }
        }
        if (answer) {
          // Persisted after the stream so the conversation survives a reload,
          // and so the next question can draw on this one.
          await db.createMessage({
            userId: user.id,
            bookId: book.id,
            role: "assistant",
            content: answer,
            page: body.page,
            selectedText: selection,
            sourcePages: context.sourcePages,
            createdAt: new Date().toISOString(),
          }).catch(() => {});
        }
      }
    },
    cancel() {
      // The reader went away; stop feeding the model loop.
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disables proxy buffering, which would otherwise defeat streaming.
      "X-Accel-Buffering": "no",
    },
  });
}
