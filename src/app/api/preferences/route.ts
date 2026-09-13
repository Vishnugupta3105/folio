import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";

export const GET = handle(async () => {
  const user = await requireUser();
  return json({ preferences: await db.getPreferences(user.id) });
});

export const PUT = handle(async (request: Request) => {
  const user = await requireUser();
  const current = await db.getPreferences(user.id);
  const patch = await request.json();

  const preferences = {
    ...current,
    ...(patch.theme !== undefined ? { theme: patch.theme } : {}),
    ...(patch.voiceReplies !== undefined ? { voiceReplies: Boolean(patch.voiceReplies) } : {}),
    ...(patch.ttsVoice !== undefined ? { ttsVoice: patch.ttsVoice } : {}),
    ...(patch.ttsRate !== undefined ? { ttsRate: Number(patch.ttsRate) } : {}),
    ...(patch.spread !== undefined ? { spread: patch.spread } : {}),
    userId: user.id,
  };
  await db.savePreferences(preferences);
  return json({ preferences });
});
