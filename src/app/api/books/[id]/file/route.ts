import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, notFound } from "@/lib/http";
import { NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

/**
 * Streams the book file itself. The storage key is never exposed to the client —
 * the only way to reach a file is through this route, which checks ownership.
 */
export const GET = handle(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  const book = await db.getBook(user.id, id);
  if (!book) return notFound("That book isn't in your library.");

  const file = await db.getFile(book.fileKey);
  if (!file) return notFound("The file for this book is missing.");

  const body = file.bytes;
  const total = body.byteLength;
  const range = request.headers.get("range");

  // pdf.js fetches byte ranges so a large book starts rendering before the whole
  // file has arrived. Honouring Range is what makes a 500-page PDF open fast.
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
      if (start <= end) {
        return new Response(body.slice(start, end + 1), {
          status: 206,
          headers: {
            "Content-Type": file.contentType,
            "Content-Length": String(end - start + 1),
            "Content-Range": `bytes ${start}-${end}/${total}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, max-age=31536000, immutable",
          },
        });
      }
    }
  }

  return new Response(body, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(total),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
});

const MAX_BYTES = 60 * 1024 * 1024;

/**
 * Accepts the file itself, for adapters with no object store (local
 * development). In production the browser uploads straight to storage and this
 * never runs.
 */
export const PUT = handle(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  const book = await db.getBook(user.id, id);
  if (!book) return notFound("That book isn't in your library.");

  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: "That file is the wrong size." }, { status: 400 });
  }

  // Check the magic bytes rather than trusting the declared type.
  const header = String.fromCharCode(...new Uint8Array(bytes, 0, 4));
  const valid = book.format === "pdf" ? header === "%PDF" : header.startsWith("PK");
  if (!valid) {
    return NextResponse.json(
      { error: `That file says it's ${book.format.toUpperCase()} but doesn't look like one.` },
      { status: 400 },
    );
  }

  await db.putFile(
    book.fileKey,
    bytes,
    book.format === "pdf" ? "application/pdf" : "application/epub+zip",
  );
  return NextResponse.json({ ok: true });
});
