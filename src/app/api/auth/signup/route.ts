import { db } from "@/lib/db";
import { createSession, hashPassword } from "@/lib/auth";
import { badRequest, handle, json } from "@/lib/http";

export const POST = handle(async (request: Request) => {
  const { name, email, password } = await request.json();

  if (!name?.trim()) return badRequest("Please tell us your name.");
  if (!email?.includes("@")) return badRequest("That doesn't look like an email address.");
  if (!password || password.length < 8) {
    return badRequest("Please choose a password of at least 8 characters.");
  }
  if (await db.findUserByEmail(email)) {
    return badRequest("An account already exists for that email.");
  }

  const user = await db.createUser({
    name: name.trim(),
    email: email.trim().toLowerCase(),
    passwordHash: await hashPassword(password),
  });
  await createSession(user.id);
  return json({ user });
});
