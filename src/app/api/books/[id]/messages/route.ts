import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

export const GET = handle(async (_r: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  return json({ messages: await db.listMessages(user.id, id) });
});
