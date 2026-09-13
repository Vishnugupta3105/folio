import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { badRequest, handle, json, notFound } from "@/lib/http";
import type { HighlightColor } from "@/types";

type Params = { params: Promise<{ id: string }> };

const COLORS: HighlightColor[] = ["amber", "azure", "sage", "rose", "neutral"];

export const GET = handle(async (_r: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  return json({ highlights: await db.listHighlights(user.id, id) });
});

export const POST = handle(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  if (!(await db.getBook(user.id, id))) return notFound("That book isn't in your library.");

  const { page, text, color, startOffset, endOffset, note, cfi } = await request.json();
  if (!text?.trim()) return badRequest("Nothing was selected.");

  const highlight = await db.createHighlight({
    userId: user.id,
    bookId: id,
    page: Number(page) || 1,
    text: String(text).slice(0, 5000),
    color: COLORS.includes(color) ? color : "amber",
    startOffset: Number(startOffset) || 0,
    endOffset: Number(endOffset) || 0,
    cfi: cfi ? String(cfi).slice(0, 500) : null,
    note: note ? String(note).slice(0, 5000) : null,
    createdAt: new Date().toISOString(),
  });
  return json({ highlight });
});
