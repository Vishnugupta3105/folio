import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";

type Params = { params: Promise<{ id: string; itemId: string }> };

export const DELETE = handle(async (_r: Request, { params }: Params) => {
  const user = await requireUser();
  const { itemId } = await params;
  await db.deleteNote(user.id, itemId);
  return json({ ok: true });
});
