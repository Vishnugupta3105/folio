import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { badRequest, handle, json, notFound } from "@/lib/http";
import { chunkPages, type PageText } from "@/lib/retrieval/chunk";
import { invalidateIndex } from "@/lib/retrieval";

type Params = { params: Promise<{ id: string }> };

/**
 * Receives text the client extracted from the document and turns it into the
 * retrieval index.
 *
 * Extraction runs in the browser in a worker: pdf.js is already parsing the file
 * there to render it, so re-parsing on the server would duplicate the work and
 * block a serverless function for minutes on a long book. The client posts
 * batches as it goes, so a book becomes answerable page by page.
 */
export const POST = handle(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;

  const book = await db.getBook(user.id, id);
  if (!book) return notFound("That book isn't in your library.");

  const { pages, complete } = (await request.json()) as {
    pages: PageText[];
    complete: boolean;
  };
  if (!Array.isArray(pages)) return badRequest("Expected extracted pages.");

  // A chunk with no page number can never be cited or navigated to, and the
  // insert would fail on the not-null column anyway. Say so rather than letting
  // it surface as "something went wrong".
  if (pages.some((page) => !page || !Number.isFinite(Number(page.page)))) {
    return badRequest("Every extracted page needs a page number.");
  }

  // Each batch replaces only its own pages. Re-chunking the whole book on every
  // batch is what the merge here used to do, and it was wrong twice over: it
  // wiped the pages it wasn't given, and it rebuilt page text by concatenating
  // chunks that overlap by design, so the stored text grew on every pass.
  const numbers = pages.map((page) => Number(page.page));
  await db.saveChunks(id, chunkPages(id, pages), numbers);
  invalidateIndex(id);

  await db.updateBook(user.id, id, { indexState: complete ? "ready" : "indexing" });
  return json({ ok: true, pagesIndexed: pages.length });
});
