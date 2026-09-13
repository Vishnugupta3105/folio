import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AIMessage, Book, Bookmark, Chunk, Highlight, Note,
  Preferences, ReadingProgress, ReadingSession, User,
} from "@/types";
import { type DataAdapter, defaultPreferences } from "./adapter";

/**
 * File-backed adapter for local development before Supabase keys exist.
 *
 * Real persistence (survives restarts, enforces ownership) but single-process —
 * writes are serialised through one promise chain, which is sufficient for a
 * dev server and explicitly not a production store.
 */

const ROOT = path.join(process.cwd(), ".data");
const DB = path.join(ROOT, "db.json");
const FILES = path.join(ROOT, "files");

interface Shape {
  users: (User & { passwordHash: string })[];
  books: Book[];
  progress: ReadingProgress[];
  highlights: Highlight[];
  notes: Note[];
  bookmarks: Bookmark[];
  chunks: Chunk[];
  messages: AIMessage[];
  preferences: Preferences[];
  sessions: ReadingSession[];
}

/** The hash never leaves the adapter except through findUserByEmail. */
const strip = ({ passwordHash: _omit, ...rest }: User & { passwordHash: string }): User => rest;

const empty: Shape = {
  users: [], books: [], progress: [], highlights: [], notes: [],
  bookmarks: [], chunks: [], messages: [], preferences: [], sessions: [],
};

let cache: Shape | null = null;
let cachedAt = 0;
let queue: Promise<unknown> = Promise.resolve();

/**
 * Reads the store, re-reading whenever the file has changed underneath us.
 *
 * The dev server evaluates this module more than once — server components and
 * route handlers don't share a module instance — so a write made by one is
 * invisible to the other unless the cache is invalidated by the file's mtime.
 * Holding a stale copy is how a freshly created account appears not to exist.
 */
async function load(): Promise<Shape> {
  try {
    const { mtimeMs } = await fs.stat(DB);
    if (cache && mtimeMs <= cachedAt) return cache;
    cache = { ...empty, ...JSON.parse(await fs.readFile(DB, "utf8")) };
    cachedAt = mtimeMs;
  } catch {
    // No file yet, or it is unreadable — start from empty but don't clobber a
    // cache we already hold in this instance.
    cache ??= structuredClone(empty);
  }
  return cache!;
}

async function flush(): Promise<void> {
  await fs.mkdir(ROOT, { recursive: true });
  await fs.writeFile(DB, JSON.stringify(cache, null, 2));
  // Claim the write we just made, so the next read doesn't discard our own
  // in-memory copy and re-parse it.
  cachedAt = (await fs.stat(DB)).mtimeMs;
}

/** Serialise every mutation so concurrent requests can't lose a write. */
function tx<T>(fn: (db: Shape) => T | Promise<T>): Promise<T> {
  const next = queue.then(async () => {
    const db = await load();
    const result = await fn(db);
    await flush();
    return result;
  });
  queue = next.catch(() => {});
  return next;
}

export const localAdapter: DataAdapter = {
  kind: "local",

  createUser: (input) =>
    tx((db) => {
      const user = { id: randomUUID(), ...input, createdAt: new Date().toISOString() };
      db.users.push(user);
      db.preferences.push(defaultPreferences(user.id));
      return strip(user);
    }),

  findUserByEmail: async (email) => {
    const db = await load();
    return db.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
  },

  findUserById: async (id) => {
    const db = await load();
    const u = db.users.find((x) => x.id === id);
    return u ? strip(u) : null;
  },

  listBooks: async (userId) => {
    const db = await load();
    return db.books
      .filter((b) => b.userId === userId)
      .sort((a, b) => (b.lastOpenedAt ?? b.createdAt).localeCompare(a.lastOpenedAt ?? a.createdAt));
  },

  getBook: async (userId, bookId) => {
    const db = await load();
    return db.books.find((b) => b.id === bookId && b.userId === userId) ?? null;
  },

  createBook: (book) =>
    tx((db) => {
      const created: Book = { id: randomUUID(), ...book };
      db.books.push(created);
      return created;
    }),

  updateBook: (userId, bookId, patch) =>
    tx((db) => {
      const book = db.books.find((b) => b.id === bookId && b.userId === userId);
      if (!book) return null;
      Object.assign(book, patch, { id: book.id, userId: book.userId });
      return book;
    }),

  deleteBook: (userId, bookId) =>
    tx((db) => {
      db.books = db.books.filter((b) => !(b.id === bookId && b.userId === userId));
      db.progress = db.progress.filter((p) => p.bookId !== bookId);
      db.highlights = db.highlights.filter((h) => h.bookId !== bookId);
      db.notes = db.notes.filter((n) => n.bookId !== bookId);
      db.bookmarks = db.bookmarks.filter((b) => b.bookId !== bookId);
      db.chunks = db.chunks.filter((c) => c.bookId !== bookId);
      db.messages = db.messages.filter((m) => m.bookId !== bookId);
    }),

  putFile: async (key, bytes, contentType) => {
    const target = path.join(FILES, key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from(bytes));
    await fs.writeFile(`${target}.meta`, contentType);
  },

  // No object store here; the browser posts to /api/books/[id]/file instead.
  createDirectUpload: async () => null,
  // No object store to redirect to; the route serves these off disk.
  createDirectDownload: async () => null,

  getFile: async (key) => {
    try {
      const target = path.join(FILES, key);
      const [bytes, contentType] = await Promise.all([
        fs.readFile(target),
        fs.readFile(`${target}.meta`, "utf8").catch(() => "application/octet-stream"),
      ]);
      // Copy out of Node's pooled buffer so the ArrayBuffer is exactly this file.
      return {
        bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        contentType,
      };
    } catch {
      return null;
    }
  },

  deleteFile: async (key) => {
    await fs.rm(path.join(FILES, key), { force: true });
    await fs.rm(path.join(FILES, `${key}.meta`), { force: true });
  },

  getProgress: async (userId, bookId) => {
    const db = await load();
    return db.progress.find((p) => p.bookId === bookId && p.userId === userId) ?? null;
  },

  saveProgress: (progress) =>
    tx((db) => {
      const i = db.progress.findIndex(
        (p) => p.bookId === progress.bookId && p.userId === progress.userId,
      );
      if (i === -1) db.progress.push(progress);
      else db.progress[i] = progress;
    }),

  listHighlights: async (userId, bookId) => {
    const db = await load();
    return db.highlights
      .filter((h) => h.bookId === bookId && h.userId === userId)
      .sort((a, b) => a.page - b.page || a.startOffset - b.startOffset);
  },

  createHighlight: (h) =>
    tx((db) => {
      const created: Highlight = { id: randomUUID(), ...h };
      db.highlights.push(created);
      return created;
    }),

  updateHighlight: (userId, id, patch) =>
    tx((db) => {
      const h = db.highlights.find((x) => x.id === id && x.userId === userId);
      if (!h) return null;
      Object.assign(h, patch, { id: h.id, userId: h.userId });
      return h;
    }),

  deleteHighlight: (userId, id) =>
    tx((db) => {
      db.highlights = db.highlights.filter((h) => !(h.id === id && h.userId === userId));
    }),

  listNotes: async (userId, bookId) => {
    const db = await load();
    return db.notes
      .filter((n) => n.bookId === bookId && n.userId === userId)
      .sort((a, b) => a.page - b.page);
  },

  createNote: (n) =>
    tx((db) => {
      const created: Note = { id: randomUUID(), ...n };
      db.notes.push(created);
      return created;
    }),

  deleteNote: (userId, id) =>
    tx((db) => {
      db.notes = db.notes.filter((n) => !(n.id === id && n.userId === userId));
    }),

  listBookmarks: async (userId, bookId) => {
    const db = await load();
    return db.bookmarks
      .filter((b) => b.bookId === bookId && b.userId === userId)
      .sort((a, b) => a.page - b.page);
  },

  createBookmark: (b) =>
    tx((db) => {
      const created: Bookmark = { id: randomUUID(), ...b };
      db.bookmarks.push(created);
      return created;
    }),

  deleteBookmark: (userId, id) =>
    tx((db) => {
      db.bookmarks = db.bookmarks.filter((b) => !(b.id === id && b.userId === userId));
    }),

  saveChunks: (bookId, chunks, pages) =>
    tx((db) => {
      const replacing = new Set(pages);
      db.chunks = db.chunks.filter((c) => c.bookId !== bookId || !replacing.has(c.page));
      for (const c of chunks) db.chunks.push({ id: randomUUID(), ...c });
    }),

  listChunks: async (bookId) => {
    const db = await load();
    return db.chunks
      .filter((c) => c.bookId === bookId)
      // Page first: chunk_index only orders within the batch that wrote it.
      .sort((a, b) => a.page - b.page || a.chunkIndex - b.chunkIndex);
  },

  listMessages: async (userId, bookId) => {
    const db = await load();
    return db.messages
      .filter((m) => m.bookId === bookId && m.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  createMessage: (m) =>
    tx((db) => {
      const created: AIMessage = { id: randomUUID(), ...m };
      db.messages.push(created);
      return created;
    }),

  getPreferences: async (userId) => {
    const db = await load();
    return db.preferences.find((p) => p.userId === userId) ?? defaultPreferences(userId);
  },

  savePreferences: (prefs) =>
    tx((db) => {
      const i = db.preferences.findIndex((p) => p.userId === prefs.userId);
      if (i === -1) db.preferences.push(prefs);
      else db.preferences[i] = prefs;
    }),

  startSession: (s) =>
    tx((db) => {
      const created: ReadingSession = { id: randomUUID(), ...s };
      db.sessions.push(created);
      return created;
    }),

  updateSession: (userId, id, patch) =>
    tx((db) => {
      const s = db.sessions.find((x) => x.id === id && x.userId === userId);
      if (s) Object.assign(s, patch, { id: s.id, userId: s.userId });
    }),
};
