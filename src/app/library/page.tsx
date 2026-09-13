import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Library } from "@/components/library/Library";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const books = await db.listBooks(user.id);
  const progress = await Promise.all(books.map((b) => db.getProgress(user.id, b.id)));

  return (
    <Library
      user={user}
      initialBooks={books.map((book, i) => ({ ...book, progress: progress[i] }))}
    />
  );
}
