import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, json, notFound } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

const save = handle(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  const book = await db.getBook(user.id, id);
  if (!book) return notFound("That book isn't in your library.");

  const { page, chapter, ttsSentence } = await request.json();
  const clamped = Math.max(1, Math.min(Number(page) || 1, book.pageCount || Number.MAX_SAFE_INTEGER));

  await db.saveProgress({
    userId: user.id,
    bookId: id,
    page: clamped,
    progress: book.pageCount ? clamped / book.pageCount : 0,
    chapter: chapter ?? null,
    ttsSentence: typeof ttsSentence === "number" ? ttsSentence : null,
    updatedAt: new Date().toISOString(),
  });
  await db.updateBook(user.id, id, { lastOpenedAt: new Date().toISOString() });

  return json({ ok: true });
});

export const PUT = save;

/**
 * `navigator.sendBeacon` can only issue a POST, and a beacon is the only thing
 * that reliably survives the tab closing — so the last save of a reading session
 * arrives here rather than as a PUT.
 */
export const POST = save;
