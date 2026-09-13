import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, json, notFound } from "@/lib/http";

type Params = { params: Promise<{ id: string; itemId: string }> };

export const PATCH = handle(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { itemId } = await params;
  const { color, note } = await request.json();

  const highlight = await db.updateHighlight(user.id, itemId, {
    ...(color !== undefined ? { color } : {}),
    ...(note !== undefined ? { note } : {}),
  });
  if (!highlight) return notFound("That highlight no longer exists.");
  return json({ highlight });
});

export const DELETE = handle(async (_r: Request, { params }: Params) => {
  const user = await requireUser();
  const { itemId } = await params;
  await db.deleteHighlight(user.id, itemId);
  return json({ ok: true });
});
