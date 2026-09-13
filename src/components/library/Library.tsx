"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import type { Book, ReadingProgress, ReadingStatus, User } from "@/types";
import { BookCard } from "./BookCard";
import { UploadBook, type UploadState } from "./UploadBook";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { Book as BookIcon, Plus } from "@/components/ui/Icons";
import { api } from "@/lib/api";

export type LibraryBook = Book & { progress: ReadingProgress | null };

type Filter = "all" | "reading" | "finished" | "want-to-read";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "reading", label: "Reading" },
  { id: "finished", label: "Finished" },
  { id: "want-to-read", label: "Want to read" },
];

export function Library({ user, initialBooks }: { user: User; initialBooks: LibraryBook[] }) {
  const router = useRouter();
  const [books, setBooks] = useState(initialBooks);
  const [filter, setFilter] = useState<Filter>("all");
  const [uploads, setUploads] = useState<UploadState[]>([]);

  const continueReading = useMemo(
    () =>
      books
        .filter((b) => b.lastOpenedAt && (b.progress?.progress ?? 0) > 0 && b.status !== "finished")
        .slice(0, 4),
    [books],
  );

  const shelf = useMemo(
    () => (filter === "all" ? books : books.filter((b) => b.status === filter)),
    [books, filter],
  );

  const onBookAdded = useCallback((book: LibraryBook) => {
    setBooks((prev) => [book, ...prev.filter((b) => b.id !== book.id)]);
  }, []);

  const onBookUpdated = useCallback((book: Book) => {
    setBooks((prev) => prev.map((b) => (b.id === book.id ? { ...b, ...book } : b)));
  }, []);

  async function removeBook(id: string) {
    setBooks((prev) => prev.filter((b) => b.id !== id));
    await api(`/api/books/${id}`, { method: "DELETE" }).catch(() => router.refresh());
  }

  async function setStatus(id: string, status: ReadingStatus) {
    setBooks((prev) => prev.map((b) => (b.id === id ? { ...b, status } : b)));
    await api(`/api/books/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }).catch(() => router.refresh());
  }

  async function signOut() {
    await api("/api/auth/logout", { method: "POST" });
    router.replace("/");
    router.refresh();
  }

  const isEmpty = books.length === 0 && uploads.length === 0;

  return (
    <main className="paper-grain min-h-dvh bg-parchment">
      <header className="sticky top-0 z-30 border-b border-rule bg-parchment/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-5 px-6 py-4 sm:px-10">
          <Link href="/" className="font-display text-[1.3rem] font-semibold tracking-[0.03em] text-ink">
            Folio
          </Link>
          <div className="ml-auto flex items-center gap-2.5">
            <ThemeToggle />
            <UploadBook
              onAdded={onBookAdded}
              onUpdated={onBookUpdated}
              onRemoved={(id) => setBooks((prev) => prev.filter((b) => b.id !== id))}
              onProgress={setUploads}
            />
            <button
              onClick={signOut}
              className="ml-1 hidden text-[0.8rem] text-muted transition-colors hover:text-ink sm:block"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 pb-28 pt-12 sm:px-10">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="label">{greeting()}, {user.name.split(" ")[0]}</p>
            <h1 className="mt-2.5 font-display text-[2.6rem] font-light leading-none tracking-[-0.015em] text-ink">
              My Library
            </h1>
          </div>
          {books.length > 0 && (
            <nav className="flex items-center gap-1 text-[0.78rem]" aria-label="Filter books">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`rounded-[3px] px-3 py-1.5 transition-colors ${
                    filter === f.id
                      ? "bg-[color-mix(in_srgb,var(--color-ink)_7%,transparent)] text-ink"
                      : "text-muted hover:text-ink"
                  }`}
                  aria-pressed={filter === f.id}
                >
                  {f.label}
                </button>
              ))}
            </nav>
          )}
        </div>

        {/* In-flight uploads sit above the shelf with their real processing state. */}
        <AnimatePresence>
          {uploads.length > 0 && (
            <motion.section
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-10 overflow-hidden"
            >
              <div className="space-y-3 border-t border-rule pt-6">
                {uploads.map((upload) => (
                  <div key={upload.id} className="flex items-center gap-4">
                    <div className="h-11 w-8 shrink-0 rounded-[2px] border border-rule bg-paper" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-[0.98rem] text-ink">{upload.name}</p>
                      <p className="mt-0.5 text-[0.76rem] text-muted">{upload.status}</p>
                    </div>
                    <div className="h-[3px] w-28 overflow-hidden rounded-full bg-rule">
                      <motion.div
                        className="h-full bg-gold"
                        animate={{ width: `${Math.round(upload.percent * 100)}%` }}
                        transition={{ duration: 0.4, ease: "easeOut" }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {isEmpty ? (
          <EmptyLibrary />
        ) : (
          <>
            {continueReading.length > 0 && filter === "all" && (
              <section className="mt-14">
                <h2 className="label mb-7">Continue reading</h2>
                <div className="grid grid-cols-2 gap-x-7 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
                  {continueReading.map((book) => (
                    <BookCard key={book.id} book={book} onDelete={removeBook} onStatus={setStatus} featured />
                  ))}
                </div>
              </section>
            )}

            <section className="mt-16">
              <h2 className="label mb-7">
                {filter === "all" ? "All books" : FILTERS.find((f) => f.id === filter)?.label}
                <span className="ml-2 text-faint">{shelf.length}</span>
              </h2>
              {shelf.length === 0 ? (
                <p className="py-10 font-display text-[1.05rem] italic text-faint">
                  Nothing on this shelf yet.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-x-7 gap-y-10 sm:grid-cols-3 lg:grid-cols-5">
                  {shelf.map((book) => (
                    <BookCard key={book.id} book={book} onDelete={removeBook} onStatus={setStatus} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function EmptyLibrary() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 0.68, 0.16, 1] }}
      className="mt-20 flex flex-col items-center text-center"
    >
      {/* An empty shelf, drawn rather than illustrated. */}
      <div className="relative mb-11 w-full max-w-sm" aria-hidden="true">
        <div className="flex items-end justify-center gap-2.5 opacity-30">
          {[64, 78, 58, 84, 70].map((h, i) => (
            <div
              key={i}
              style={{ height: h }}
              className="w-7 rounded-t-[1px] border border-b-0 border-dashed border-faint"
            />
          ))}
        </div>
        <div className="h-px w-full bg-rule" />
        <div className="mx-auto h-1.5 w-[88%] rounded-b-[2px] bg-rule/60" />
      </div>

      <h2 className="font-display text-[2rem] font-light text-ink">Your library is waiting.</h2>
      <p className="mt-3 max-w-sm text-[0.9rem] leading-relaxed text-muted">
        Bring a book. We&rsquo;ll take care of the rest &mdash; the pages, the chapters, and a
        companion that reads along with you.
      </p>

      <label
        htmlFor="folio-upload"
        className="mt-9 inline-flex h-12 cursor-pointer items-center gap-2 rounded-[3px] bg-oxblood px-7 text-[0.88rem] font-medium text-parchment transition-colors hover:bg-oxblood-bright"
      >
        <Plus />
        Add your first book
      </label>
      <p className="mt-4 flex items-center gap-1.5 text-[0.75rem] text-faint">
        <BookIcon /> PDF or EPUB, up to 60 MB
      </p>
    </motion.div>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Still awake";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
