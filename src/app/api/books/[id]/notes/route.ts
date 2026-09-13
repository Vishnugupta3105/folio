import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { badRequest, handle, json, notFound } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

export const GET = handle(async (_r: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  return json({ notes: await db.listNotes(user.id, id) });
});

export const POST = handle(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  if (!(await db.getBook(user.id, id))) return notFound("That book isn't in your library.");

  const { page, selectedText, content } = await request.json();
  if (!content?.trim()) return badRequest("A note needs some words in it.");

  const note = await db.createNote({
    userId: user.id,
    bookId: id,
    page: Number(page) || 1,
    selectedText: selectedText ? String(selectedText).slice(0, 2000) : null,
    content: String(content).slice(0, 10000),
    createdAt: new Date().toISOString(),
  });
  return json({ note });
});
