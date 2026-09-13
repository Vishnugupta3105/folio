import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, json, notFound } from "@/lib/http";
import { getIndex, loadChunks } from "@/lib/retrieval";

type Params = { params: Promise<{ id: string }> };

/** Search inside the book. Same index that powers AI retrieval. */
export const GET = handle(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  const query = new URL(request.url).searchParams.get("q")?.trim();

  if (!query) return json({ results: [] });
  if (!(await db.getBook(user.id, id))) return notFound("That book isn't in your library.");

  const chunks = await loadChunks(id, () => db.listChunks(id));
  let hits = getIndex(id, () => chunks).search(query, 40);

  // Ranked search drops stopwords, so a literal lookup for a common word or a
  // short phrase comes back empty. Search-inside-a-book has to behave like
  // Cmd+F: if ranking found nothing, fall back to finding the actual string.
  if (!hits.length) {
    const needle = query.toLowerCase();
    hits = chunks
      .filter((chunk) => chunk.text.toLowerCase().includes(needle))
      .slice(0, 40)
      .map((chunk) => ({ chunk, score: 0 }));
  }

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results = hits.map(({ chunk, score }) => {
    // Centre the snippet on the first matching term so the result is readable.
    const lower = chunk.text.toLowerCase();
    let at = -1;
    for (const term of terms) {
      const i = lower.indexOf(term);
      if (i !== -1 && (at === -1 || i < at)) at = i;
    }
    const from = Math.max(0, at - 70);
    const to = Math.min(chunk.text.length, (at === -1 ? 0 : at) + 150);
    return {
      page: chunk.page,
      chapter: chunk.chapter,
      score,
      snippet: `${from > 0 ? "…" : ""}${chunk.text.slice(from, to).trim()}${to < chunk.text.length ? "…" : ""}`,
    };
  });

  // One result per page keeps the list scannable.
  const seen = new Set<number>();
  return json({
    results: results.filter((r) => !seen.has(r.page) && seen.add(r.page)).slice(0, 20),
  });
});
