import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, json, notFound } from "@/lib/http";
import { invalidateIndex } from "@/lib/retrieval";

type Params = { params: Promise<{ id: string }> };

export const GET = handle(async (_request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  const book = await db.getBook(user.id, id);
  if (!book) return notFound("That book isn't in your library.");

  // Everything the reader needs to open at exactly the right place, in one trip.
  const [progress, highlights, notes, bookmarks, messages] = await Promise.all([
    db.getProgress(user.id, id),
    db.listHighlights(user.id, id),
    db.listNotes(user.id, id),
    db.listBookmarks(user.id, id),
    db.listMessages(user.id, id),
  ]);

  return json({ book, progress, highlights, notes, bookmarks, messages });
});

export const PATCH = handle(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  const patch = await request.json();

  // Only these fields are client-writable — ids and ownership are not.
  const allowed = (({ title, author, status, pageCount, pageLabels, coverUrl, lastOpenedAt, indexState }) =>
    ({ title, author, status, pageCount, pageLabels, coverUrl, lastOpenedAt, indexState }))(patch);
  for (const key of Object.keys(allowed) as (keyof typeof allowed)[]) {
    if (allowed[key] === undefined) delete allowed[key];
  }

  const book = await db.updateBook(user.id, id, allowed);
  if (!book) return notFound("That book isn't in your library.");
  return json({ book });
});

export const DELETE = handle(async (_request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  await db.deleteBook(user.id, id);
  invalidateIndex(id);
  return json({ ok: true });
});
