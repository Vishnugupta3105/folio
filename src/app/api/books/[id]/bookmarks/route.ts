import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, json, notFound } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

export const GET = handle(async (_r: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  return json({ bookmarks: await db.listBookmarks(user.id, id) });
});

export const POST = handle(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  if (!(await db.getBook(user.id, id))) return notFound("That book isn't in your library.");

  const { page, label } = await request.json();
  const pageNumber = Number(page) || 1;

  // Bookmarking is a toggle: a second press on the same page removes it.
  const existing = (await db.listBookmarks(user.id, id)).find((b) => b.page === pageNumber);
  if (existing) {
    await db.deleteBookmark(user.id, existing.id);
    return json({ bookmark: null, removed: existing.id });
  }

  const bookmark = await db.createBookmark({
    userId: user.id,
    bookId: id,
    page: pageNumber,
    label: label ? String(label).slice(0, 200) : null,
    createdAt: new Date().toISOString(),
  });
  return json({ bookmark });
});
