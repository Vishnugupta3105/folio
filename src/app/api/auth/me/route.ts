import { currentUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";

export const GET = handle(async () => json({ user: await currentUser() }));
