import "server-only";
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import type { User } from "@/types";

const scryptAsync = promisify(scrypt) as (
  password: string, salt: string, keylen: number,
) => Promise<Buffer>;

const COOKIE = "folio_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set in production");
  }
  // Stable dev fallback so sessions survive a hot reload.
  return "folio-development-secret-do-not-use-in-production";
}

/** scrypt with a per-user salt. Deliberately slow — that is the point. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await scryptAsync(password, salt, 64);
  return `${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const key = await scryptAsync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  // Length check first: timingSafeEqual throws on a mismatch.
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** `<userId>.<expiry>.<hmac>` — stateless, tamper-evident, no extra dependency. */
function sign(userId: string, expiresAt: number): string {
  const payload = `${userId}.${expiresAt}`;
  const mac = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

function verify(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expiry, mac] = parts;
  const expected = createHmac("sha256", secret()).update(`${userId}.${expiry}`).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(expiry) < Date.now()) return null;
  return userId;
}

export async function createSession(userId: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, sign(userId, Date.now() + MAX_AGE * 1000), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** The authenticated user, or null. Every route handler starts here. */
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const userId = verify(token);
  if (!userId) return null;
  return db.findUserById(userId);
}

/** Throws a 401-shaped error when unauthenticated. */
export class Unauthorized extends Error {
  constructor() {
    super("Unauthorized");
  }
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new Unauthorized();
  return user;
}
