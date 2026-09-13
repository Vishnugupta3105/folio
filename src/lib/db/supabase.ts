import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AIMessage, Book, Bookmark, Chunk, Highlight, Note,
  Preferences, ReadingProgress, ReadingSession, User,
} from "@/types";
import { type DataAdapter, defaultPreferences } from "./adapter";

const BUCKET = "books";
/**
 * Lifetime of a direct download link. Long enough for a reading session — the
 * browser re-requests the route, and so re-signs, on every reload — and short
 * enough that a copied URL stops working the same afternoon.
 */
const DOWNLOAD_TTL_SECONDS = 60 * 60;

let client: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!client) {
    client = createClient(
      // Either name works. Nothing in the browser talks to Supabase directly —
      // every read and write goes through our own routes — so the NEXT_PUBLIC_
      // prefix is accepted for familiarity rather than required.
      (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)!,
      // Service role: server-only. Never imported from a client component.
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
  }
  return client;
}

/** Rows come back snake_case; the domain model is camelCase. */
const toBook = (r: Record<string, unknown>): Book => ({
  id: r.id as string,
  userId: r.user_id as string,
  title: r.title as string,
  author: (r.author as string) ?? null,
  format: r.format as Book["format"],
  fileKey: r.file_key as string,
  coverUrl: (r.cover_url as string) ?? null,
  pageCount: (r.page_count as number) ?? 0,
  pageLabels: (r.page_labels as Book["pageLabels"]) ?? null,
  status: r.status as Book["status"],
  indexState: r.index_state as Book["indexState"],
  createdAt: r.created_at as string,
  lastOpenedAt: (r.last_opened_at as string) ?? null,
});

const fromBook = (b: Partial<Book>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  if (b.userId !== undefined) out.user_id = b.userId;
  if (b.title !== undefined) out.title = b.title;
  if (b.author !== undefined) out.author = b.author;
  if (b.format !== undefined) out.format = b.format;
  if (b.fileKey !== undefined) out.file_key = b.fileKey;
  if (b.coverUrl !== undefined) out.cover_url = b.coverUrl;
  if (b.pageCount !== undefined) out.page_count = b.pageCount;
  if (b.pageLabels !== undefined) out.page_labels = b.pageLabels;
  if (b.status !== undefined) out.status = b.status;
  if (b.indexState !== undefined) out.index_state = b.indexState;
  if (b.createdAt !== undefined) out.created_at = b.createdAt;
  if (b.lastOpenedAt !== undefined) out.last_opened_at = b.lastOpenedAt;
  return out;
};

const toHighlight = (r: Record<string, unknown>): Highlight => ({
  id: r.id as string,
  userId: r.user_id as string,
  bookId: r.book_id as string,
  page: r.page as number,
  text: r.text as string,
  color: r.color as Highlight["color"],
  startOffset: (r.start_offset as number) ?? 0,
  endOffset: (r.end_offset as number) ?? 0,
  cfi: (r.cfi as string) ?? null,
  note: (r.note as string) ?? null,
  createdAt: r.created_at as string,
});

const toMessage = (r: Record<string, unknown>): AIMessage => ({
  id: r.id as string,
  userId: r.user_id as string,
  bookId: r.book_id as string,
  role: r.role as AIMessage["role"],
  content: r.content as string,
  page: (r.page as number) ?? null,
  selectedText: (r.selected_text as string) ?? null,
  sourcePages: (r.source_pages as number[]) ?? null,
  createdAt: r.created_at as string,
});

/** Every query below filters on user_id — ownership is never assumed. */
export const supabaseAdapter: DataAdapter = {
  kind: "supabase",

  async createUser({ name, email, passwordHash }) {
    const { data, error } = await db()
      .from("app_users")
      .insert({ name, email, password_hash: passwordHash })
      .select()
      .single();
    if (error) throw error;
    await db().from("preferences").insert({ user_id: data.id }).select();
    return { id: data.id, name: data.name, email: data.email, createdAt: data.created_at };
  },

  async findUserByEmail(email) {
    // Columns are named rather than selected with `*` so a database missing
    // password_hash fails loudly here. Selecting everything would succeed, leave
    // passwordHash undefined, and make a schema problem look to the person
    // signing in like a wrong password.
    const { data, error } = await db()
      .from("app_users")
      .select("id,name,email,created_at,password_hash")
      .ilike("email", email)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id, name: data.name, email: data.email,
      createdAt: data.created_at, passwordHash: data.password_hash,
    };
  },

  async findUserById(id) {
    const { data, error } = await db()
      .from("app_users").select("id,name,email,created_at").eq("id", id).maybeSingle();
    if (error) throw error;
    return data
      ? { id: data.id, name: data.name, email: data.email, createdAt: data.created_at }
      : null;
  },

  async listBooks(userId) {
    const { data, error } = await db()
      .from("books").select().eq("user_id", userId)
      .order("last_opened_at", { ascending: false, nullsFirst: false });
    if (error) throw error;
    return (data ?? []).map(toBook);
  },

  async getBook(userId, bookId) {
    const { data } = await db()
      .from("books").select().eq("id", bookId).eq("user_id", userId).maybeSingle();
    return data ? toBook(data) : null;
  },

  async createBook(book) {
    const { data, error } = await db().from("books").insert(fromBook(book)).select().single();
    if (error) throw error;
    return toBook(data);
  },

  async updateBook(userId, bookId, patch) {
    const { data } = await db()
      .from("books").update(fromBook(patch))
      .eq("id", bookId).eq("user_id", userId).select().maybeSingle();
    return data ? toBook(data) : null;
  },

  async deleteBook(userId, bookId) {
    // Cascades handle the child rows; the storage object needs an explicit delete.
    const book = await this.getBook(userId, bookId);
    if (book) await this.deleteFile(book.fileKey);
    await db().from("books").delete().eq("id", bookId).eq("user_id", userId);
  },

  async putFile(key, bytes, contentType) {
    const { error } = await db().storage
      .from(BUCKET)
      .upload(key, bytes, { contentType, upsert: true });
    if (error) throw error;
  },

  async createDirectUpload(key) {
    const { data, error } = await db().storage.from(BUCKET).createSignedUploadUrl(key);
    if (error || !data) throw error ?? new Error("Could not prepare the upload.");
    return { url: data.signedUrl };
  },

  async createDirectDownload(key) {
    const { data, error } = await db().storage
      .from(BUCKET).createSignedUrl(key, DOWNLOAD_TTL_SECONDS);
    // Falling back to the proxy is better than failing to open the book, and
    // small books go through it perfectly well.
    if (error || !data) return null;
    return { url: data.signedUrl };
  },

  async getFile(key) {
    const { data, error } = await db().storage.from(BUCKET).download(key);
    if (error || !data) return null;
    return {
      bytes: await data.arrayBuffer(),
      contentType: data.type || "application/octet-stream",
    };
  },

  async deleteFile(key) {
    await db().storage.from(BUCKET).remove([key, `${key}.cover`]);
  },

  async getProgress(userId, bookId) {
    const { data } = await db()
      .from("reading_progress").select()
      .eq("user_id", userId).eq("book_id", bookId).maybeSingle();
    if (!data) return null;
    return {
      userId: data.user_id, bookId: data.book_id, page: data.page,
      progress: data.progress, chapter: data.chapter ?? null,
      ttsSentence: data.tts_sentence ?? null, updatedAt: data.updated_at,
    };
  },

  async saveProgress(p) {
    await db().from("reading_progress").upsert(
      {
        user_id: p.userId, book_id: p.bookId, page: p.page, progress: p.progress,
        chapter: p.chapter, tts_sentence: p.ttsSentence, updated_at: p.updatedAt,
      },
      { onConflict: "user_id,book_id" },
    );
  },

  async listHighlights(userId, bookId) {
    const { data } = await db()
      .from("highlights").select().eq("user_id", userId).eq("book_id", bookId)
      .order("page").order("start_offset");
    return (data ?? []).map(toHighlight);
  },

  async createHighlight(h) {
    const { data, error } = await db().from("highlights").insert({
      user_id: h.userId, book_id: h.bookId, page: h.page, text: h.text,
      color: h.color, start_offset: h.startOffset, end_offset: h.endOffset, cfi: h.cfi,
      note: h.note, created_at: h.createdAt,
    }).select().single();
    if (error) throw error;
    return toHighlight(data);
  },

  async updateHighlight(userId, id, patch) {
    const row: Record<string, unknown> = {};
    if (patch.color !== undefined) row.color = patch.color;
    if (patch.note !== undefined) row.note = patch.note;
    const { data } = await db()
      .from("highlights").update(row).eq("id", id).eq("user_id", userId).select().maybeSingle();
    return data ? toHighlight(data) : null;
  },

  async deleteHighlight(userId, id) {
    await db().from("highlights").delete().eq("id", id).eq("user_id", userId);
  },

  async listNotes(userId, bookId) {
    const { data } = await db()
      .from("notes").select().eq("user_id", userId).eq("book_id", bookId).order("page");
    return (data ?? []).map((r) => ({
      id: r.id, userId: r.user_id, bookId: r.book_id, page: r.page,
      selectedText: r.selected_text ?? null, content: r.content, createdAt: r.created_at,
    }));
  },

  async createNote(n) {
    const { data, error } = await db().from("notes").insert({
      user_id: n.userId, book_id: n.bookId, page: n.page,
      selected_text: n.selectedText, content: n.content, created_at: n.createdAt,
    }).select().single();
    if (error) throw error;
    return {
      id: data.id, userId: data.user_id, bookId: data.book_id, page: data.page,
      selectedText: data.selected_text ?? null, content: data.content, createdAt: data.created_at,
    };
  },

  async deleteNote(userId, id) {
    await db().from("notes").delete().eq("id", id).eq("user_id", userId);
  },

  async listBookmarks(userId, bookId) {
    const { data } = await db()
      .from("bookmarks").select().eq("user_id", userId).eq("book_id", bookId).order("page");
    return (data ?? []).map((r) => ({
      id: r.id, userId: r.user_id, bookId: r.book_id,
      page: r.page, label: r.label ?? null, createdAt: r.created_at,
    }));
  },

  async createBookmark(b) {
    const { data, error } = await db().from("bookmarks").insert({
      user_id: b.userId, book_id: b.bookId, page: b.page,
      label: b.label, created_at: b.createdAt,
    }).select().single();
    if (error) throw error;
    return {
      id: data.id, userId: data.user_id, bookId: data.book_id,
      page: data.page, label: data.label ?? null, createdAt: data.created_at,
    };
  },

  async deleteBookmark(userId, id) {
    await db().from("bookmarks").delete().eq("id", id).eq("user_id", userId);
  },

  async saveChunks(bookId, chunks, pages) {
    // Only the pages in this batch: see the note on the interface. Deleted in
    // groups so the `in` list can't overflow the request URL on a long book.
    for (let i = 0; i < pages.length; i += 200) {
      const { error } = await db().from("chunks").delete()
        .eq("book_id", bookId).in("page", pages.slice(i, i + 200));
      if (error) throw error;
    }
    // Batch the insert — a 500-page book produces thousands of rows.
    for (let i = 0; i < chunks.length; i += 500) {
      const rows = chunks.slice(i, i + 500).map((c) => ({
        book_id: c.bookId, page: c.page, chapter: c.chapter,
        chunk_index: c.chunkIndex, text: c.text,
      }));
      const { error } = await db().from("chunks").insert(rows);
      if (error) throw error;
    }
  },

  async listChunks(bookId) {
    const all: Chunk[] = [];
    // Supabase caps a single select; page through so long books index fully.
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db()
        .from("chunks").select().eq("book_id", bookId)
        // Page first: chunk_index only orders within the batch that wrote it,
        // and a page is always written by exactly one batch.
        .order("page").order("chunk_index").range(from, from + 999);
      if (error) throw error;
      if (!data?.length) break;
      all.push(...data.map((r) => ({
        id: r.id, bookId: r.book_id, page: r.page,
        chapter: r.chapter ?? null, chunkIndex: r.chunk_index, text: r.text,
      })));
      if (data.length < 1000) break;
    }
    return all;
  },

  async listMessages(userId, bookId) {
    const { data } = await db()
      .from("ai_messages").select().eq("user_id", userId).eq("book_id", bookId)
      .order("created_at");
    return (data ?? []).map(toMessage);
  },

  async createMessage(m) {
    const { data, error } = await db().from("ai_messages").insert({
      user_id: m.userId, book_id: m.bookId, role: m.role, content: m.content,
      page: m.page, selected_text: m.selectedText,
      source_pages: m.sourcePages, created_at: m.createdAt,
    }).select().single();
    if (error) throw error;
    return toMessage(data);
  },

  async getPreferences(userId) {
    const { data } = await db()
      .from("preferences").select().eq("user_id", userId).maybeSingle();
    if (!data) return defaultPreferences(userId);
    return {
      userId: data.user_id, theme: data.theme, voiceReplies: data.voice_replies,
      ttsVoice: data.tts_voice ?? null, ttsRate: data.tts_rate, spread: data.spread,
    };
  },

  async savePreferences(p) {
    await db().from("preferences").upsert({
      user_id: p.userId, theme: p.theme, voice_replies: p.voiceReplies,
      tts_voice: p.ttsVoice, tts_rate: p.ttsRate, spread: p.spread,
    });
  },

  async startSession(s) {
    const { data, error } = await db().from("reading_sessions").insert({
      user_id: s.userId, book_id: s.bookId, started_at: s.startedAt,
    }).select().single();
    if (error) throw error;
    return {
      id: data.id, userId: data.user_id, bookId: data.book_id,
      startedAt: data.started_at, endedAt: data.ended_at ?? null,
      pagesRead: data.pages_read, questionsAsked: data.questions_asked,
    };
  },

  async updateSession(userId, id, patch) {
    const row: Record<string, unknown> = {};
    if (patch.endedAt !== undefined) row.ended_at = patch.endedAt;
    if (patch.pagesRead !== undefined) row.pages_read = patch.pagesRead;
    if (patch.questionsAsked !== undefined) row.questions_asked = patch.questionsAsked;
    await db().from("reading_sessions").update(row).eq("id", id).eq("user_id", userId);
  },
};
