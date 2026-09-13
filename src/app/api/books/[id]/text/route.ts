import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, json, notFound } from "@/lib/http";
import { loadChunks } from "@/lib/retrieval";

type Params = { params: Promise<{ id: string }> };

/**
 * The text of one page, from the index.
 *
 * A PDF's text comes straight out of pdf.js in the browser, but an EPUB has no
 * page geometry to extract from — its text lives in the index built at upload.
 * Narration reads from here so both formats can be read aloud the same way.
 */
export const GET = handle(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  const page = Number(new URL(request.url).searchParams.get("page")) || 1;

  if (!(await db.getBook(user.id, id))) return notFound("That book isn't in your library.");

  const text = (await loadChunks(id, () => db.listChunks(id)))
    .filter((chunk) => chunk.page === page)
    .map((chunk) => chunk.text)
    .join(" ");

  return json({ page, text });
});
