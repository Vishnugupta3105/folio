import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Reader, type ReaderData } from "@/components/reader/Reader";
import { aiConfigured } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";

export default async function ReaderPage({
  params,
}: {
  params: Promise<{ bookId: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const { bookId } = await params;
  const book = await db.getBook(user.id, bookId);
  if (!book) notFound();

  // Everything the reader needs to restore the session, fetched in one pass so
  // the page opens with highlights, notes and conversation already in place.
  const [progress, highlights, notes, bookmarks, messages, preferences] = await Promise.all([
    db.getProgress(user.id, bookId),
    db.listHighlights(user.id, bookId),
    db.listNotes(user.id, bookId),
    db.listBookmarks(user.id, bookId),
    db.listMessages(user.id, bookId),
    db.getPreferences(user.id),
  ]);

  const data: ReaderData = {
    book,
    progress,
    highlights,
    notes,
    bookmarks,
    messages,
    preferences,
    aiLive: aiConfigured(),
  };

  return <Reader data={data} />;
}
