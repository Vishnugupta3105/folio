// Domain model. Shared verbatim between the server, the data adapters and the UI.

export type BookFormat = "pdf" | "epub";
export type ReadingStatus = "reading" | "finished" | "want-to-read";
export type HighlightColor = "amber" | "azure" | "sage" | "rose" | "neutral";

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface Book {
  id: string;
  userId: string;
  title: string;
  author: string | null;
  format: BookFormat;
  fileKey: string;
  coverUrl: string | null;
  pageCount: number;
  /** Printed page labels keyed by physical index, when the document declares them. */
  pageLabels: Record<string, string> | null;
  status: ReadingStatus;
  /** "pending" until the client has finished extracting and posting text. */
  indexState: "pending" | "indexing" | "ready" | "failed";
  createdAt: string;
  lastOpenedAt: string | null;
}

export interface ReadingProgress {
  bookId: string;
  userId: string;
  page: number;
  /** 0..1 */
  progress: number;
  chapter: string | null;
  /** Sentence index within the page, so narration resumes mid-page. */
  ttsSentence: number | null;
  updatedAt: string;
}

export interface Highlight {
  id: string;
  userId: string;
  bookId: string;
  page: number;
  text: string;
  color: HighlightColor;
  /** Character offsets into the page's extracted text layer (PDF). */
  startOffset: number;
  endOffset: number;
  /**
   * EPUB range, which has no fixed page geometry to measure offsets against.
   * Exactly one of this and the offsets above is meaningful, decided by format.
   */
  cfi: string | null;
  note: string | null;
  createdAt: string;
}

export interface Note {
  id: string;
  userId: string;
  bookId: string;
  page: number;
  selectedText: string | null;
  content: string;
  createdAt: string;
}

export interface Bookmark {
  id: string;
  userId: string;
  bookId: string;
  page: number;
  label: string | null;
  createdAt: string;
}

/** One retrievable unit of book text, always traceable to a physical page. */
export interface Chunk {
  id: string;
  bookId: string;
  page: number;
  chapter: string | null;
  chunkIndex: number;
  text: string;
}

export type AIRole = "user" | "assistant";

export interface AIMessage {
  id: string;
  bookId: string;
  userId: string;
  role: AIRole;
  content: string;
  page: number | null;
  selectedText: string | null;
  /** Pages the answer drew on, for the "Source: p. 84" citations. */
  sourcePages: number[] | null;
  createdAt: string;
}

export interface Preferences {
  userId: string;
  theme: "light" | "dark" | "system";
  voiceReplies: boolean;
  ttsVoice: string | null;
  ttsRate: number;
  spread: "single" | "double";
}

export interface ReadingSession {
  id: string;
  userId: string;
  bookId: string;
  startedAt: string;
  endedAt: string | null;
  pagesRead: number;
  questionsAsked: number;
}
