import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { badRequest, handle, json } from "@/lib/http";
import type { Book, BookFormat } from "@/types";

const MAX_BYTES = 60 * 1024 * 1024;

const FORMATS: Record<string, BookFormat> = {
  "application/pdf": "pdf",
  "application/epub+zip": "epub",
};

export const GET = handle(async () => {
  const user = await requireUser();
  const books = await db.listBooks(user.id);
  // The library needs progress alongside each book to render "72% · p. 218".
  const progress = await Promise.all(books.map((b) => db.getProgress(user.id, b.id)));
  return json({
    books: books.map((book, i) => ({ ...book, progress: progress[i] })),
  });
});

/**
 * Creates the book row and hands back somewhere to put the file.
 *
 * The bytes never pass through this function: serverless request bodies are
 * capped well below the size of a real book, so the browser uploads straight to
 * object storage using the returned URL. Adapters without an object store
 * return no URL, and the client posts to `/api/books/[id]/file` instead.
 */
export const POST = handle(async (request: Request) => {
  const user = await requireUser();
  const { name, size, type } = await request.json();

  if (!name) return badRequest("No file was chosen.");
  if (Number(size) > MAX_BYTES) {
    return badRequest("That book is larger than 60 MB. Try a smaller file.");
  }

  const lower = String(name).toLowerCase();
  const format =
    FORMATS[type as string] ??
    (lower.endsWith(".pdf") ? "pdf" : lower.endsWith(".epub") ? "epub" : null);

  if (!format) {
    return badRequest("This book format isn't supported yet. Folio reads PDF and EPUB.");
  }

  const fileKey = `${user.id}/${randomUUID()}.${format}`;
  const now = new Date().toISOString();

  const book = await db.createBook({
    userId: user.id,
    // Provisional: the client replaces these with real document metadata once
    // it has parsed the file, which it can do far faster than the server.
    title: String(name).replace(/\.(pdf|epub)$/i, "").trim() || "Untitled",
    author: null,
    format,
    fileKey,
    coverUrl: null,
    pageCount: 0,
    pageLabels: null,
    status: "reading",
    indexState: "pending",
    createdAt: now,
    lastOpenedAt: null,
  } satisfies Omit<Book, "id">);

  const upload = await db.createDirectUpload(
    fileKey,
    format === "pdf" ? "application/pdf" : "application/epub+zip",
  );

  return json({ book, uploadUrl: upload?.url ?? null });
});
