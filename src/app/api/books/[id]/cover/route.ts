import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { badRequest, handle, json, notFound } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

const MAX_COVER_BYTES = 2 * 1024 * 1024;

/** Stores the cover the client rendered from the book's first page. */
export const POST = handle(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  const book = await db.getBook(user.id, id);
  if (!book) return notFound("That book isn't in your library.");

  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_COVER_BYTES) {
    return badRequest("That cover image is the wrong size.");
  }
  // Reject anything that isn't actually a JPEG or PNG.
  const head = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  const isJpeg = head[0] === 0xff && head[1] === 0xd8;
  const isPng = head[0] === 0x89 && head[1] === 0x50;
  if (!isJpeg && !isPng) return badRequest("Covers must be JPEG or PNG.");

  await db.putFile(`${book.fileKey}.cover`, bytes, isJpeg ? "image/jpeg" : "image/png");
  const updated = await db.updateBook(user.id, id, { coverUrl: `/api/books/${id}/cover` });
  return json({ book: updated });
});

export const GET = handle(async (_r: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  const book = await db.getBook(user.id, id);
  if (!book) return notFound();

  const file = await db.getFile(`${book.fileKey}.cover`);
  if (!file) return notFound("No cover stored for this book.");

  return new Response(file.bytes, {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "private, max-age=604800",
    },
  });
});
