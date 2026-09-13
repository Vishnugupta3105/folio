import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, json, notFound } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

/**
 * Reading sessions.
 *
 * Recorded because a reader's own history is worth having — how much of a book
 * they got through in a sitting, which pages they asked about. Deliberately not
 * surfaced as streaks or targets: the product is reading, not a habit tracker.
 */
export const POST = handle(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  if (!(await db.getBook(user.id, id))) return notFound("That book isn't in your library.");

  // `sendBeacon` can only issue a POST, so a closing beacon arrives here with
  // the same body the PATCH would have carried.
  const closing = await request.json().catch(() => null);
  if (closing?.sessionId) {
    await db.updateSession(user.id, closing.sessionId, {
      pagesRead: Number(closing.pagesRead) || 0,
      questionsAsked: Number(closing.questionsAsked) || 0,
      endedAt: new Date().toISOString(),
    });
    return json({ ok: true });
  }

  const session = await db.startSession({
    userId: user.id,
    bookId: id,
    startedAt: new Date().toISOString(),
    endedAt: null,
    pagesRead: 0,
    questionsAsked: 0,
  });
  return json({ session });
});

export const PATCH = handle(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  await params;

  const { sessionId, pagesRead, questionsAsked, ended } = await request.json();
  if (!sessionId) return json({ ok: true });

  await db.updateSession(user.id, sessionId, {
    ...(typeof pagesRead === "number" ? { pagesRead } : {}),
    ...(typeof questionsAsked === "number" ? { questionsAsked } : {}),
    ...(ended ? { endedAt: new Date().toISOString() } : {}),
  });
  return json({ ok: true });
});
