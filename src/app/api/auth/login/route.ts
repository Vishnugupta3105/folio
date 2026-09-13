import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";
import { handle, json } from "@/lib/http";

export const POST = handle(async (request: Request) => {
  const { email, password } = await request.json();
  const record = await db.findUserByEmail(email ?? "");

  // One message for both failure modes, so the endpoint can't enumerate accounts.
  const invalid = () =>
    NextResponse.json({ error: "That email and password don't match." }, { status: 401 });

  if (!record?.passwordHash) return invalid();
  if (!(await verifyPassword(password ?? "", record.passwordHash))) return invalid();

  await createSession(record.id);
  const { passwordHash: _omit, ...user } = record;
  return json({ user });
});
