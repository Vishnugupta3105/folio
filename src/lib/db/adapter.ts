import type {
  AIMessage, Book, Bookmark, Chunk, Highlight, Note,
  Preferences, ReadingProgress, ReadingSession, User,
} from "@/types";

/**
 * The single seam between the application and its storage.
 *
 * Two implementations ship: `supabase` (production) and `local` (a file-backed
 * adapter for development before keys exist). Nothing above this interface
 * knows which one is active.
 *
 * Every method takes `userId` and every implementation MUST scope its reads and
 * writes to it — ownership is enforced here, not in the route handlers.
 */
export interface DataAdapter {
  readonly kind: "supabase" | "local";

  createUser(input: { name: string; email: string; passwordHash: string }): Promise<User>;
  findUserByEmail(email: string): Promise<(User & { passwordHash: string }) | null>;
  findUserById(id: string): Promise<User | null>;

  listBooks(userId: string): Promise<Book[]>;
  getBook(userId: string, bookId: string): Promise<Book | null>;
  createBook(book: Omit<Book, "id">): Promise<Book>;
  updateBook(userId: string, bookId: string, patch: Partial<Book>): Promise<Book | null>;
  deleteBook(userId: string, bookId: string): Promise<void>;

  putFile(key: string, bytes: ArrayBuffer, contentType: string): Promise<void>;
  /**
   * A URL the browser can upload straight to, bypassing the server entirely.
   *
   * Serverless platforms cap request bodies well below the size of a real book
   * (Vercel's limit is 4.5 MB), so the bytes must never pass through a function.
   * Returns null for adapters with no object store, where the upload route is
   * used instead.
   */
  createDirectUpload(key: string, contentType: string): Promise<{ url: string } | null>;
  getFile(key: string): Promise<{ bytes: ArrayBuffer; contentType: string } | null>;
  deleteFile(key: string): Promise<void>;

  getProgress(userId: string, bookId: string): Promise<ReadingProgress | null>;
  saveProgress(progress: ReadingProgress): Promise<void>;

  listHighlights(userId: string, bookId: string): Promise<Highlight[]>;
  createHighlight(h: Omit<Highlight, "id">): Promise<Highlight>;
  updateHighlight(userId: string, id: string, patch: Partial<Highlight>): Promise<Highlight | null>;
  deleteHighlight(userId: string, id: string): Promise<void>;

  listNotes(userId: string, bookId: string): Promise<Note[]>;
  createNote(n: Omit<Note, "id">): Promise<Note>;
  deleteNote(userId: string, id: string): Promise<void>;

  listBookmarks(userId: string, bookId: string): Promise<Bookmark[]>;
  createBookmark(b: Omit<Bookmark, "id">): Promise<Bookmark>;
  deleteBookmark(userId: string, id: string): Promise<void>;

  /**
   * Replaces the stored chunks for exactly the pages listed in `pages`.
   *
   * Scoped to pages rather than to the book because ingest streams a long book
   * in batches: replacing the whole index on every batch left only the final
   * one stored, so a 200-page book ended up answerable on its last 40 pages.
   * `pages` is passed separately from `chunks` because a page that extracted to
   * no text produces no chunks but must still clear whatever it had before.
   * Re-sending a page is idempotent.
   */
  saveChunks(bookId: string, chunks: Omit<Chunk, "id">[], pages: number[]): Promise<void>;
  listChunks(bookId: string): Promise<Chunk[]>;

  listMessages(userId: string, bookId: string): Promise<AIMessage[]>;
  createMessage(m: Omit<AIMessage, "id">): Promise<AIMessage>;

  getPreferences(userId: string): Promise<Preferences>;
  savePreferences(prefs: Preferences): Promise<void>;

  startSession(s: Omit<ReadingSession, "id">): Promise<ReadingSession>;
  updateSession(userId: string, id: string, patch: Partial<ReadingSession>): Promise<void>;
}

export const defaultPreferences = (userId: string): Preferences => ({
  userId,
  theme: "system",
  voiceReplies: false,
  ttsVoice: null,
  ttsRate: 1,
  spread: "double",
});
