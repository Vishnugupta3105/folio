"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Plus } from "@/components/ui/Icons";
import type { Book } from "@/types";
import type { LibraryBook } from "./Library";

export interface UploadState {
  id: string;
  name: string;
  status: string;
  /** 0..1 */
  percent: number;
}

/**
 * Upload, then processing.
 *
 * The book row exists on the server the moment the bytes land, so it appears in
 * the library immediately. Parsing — metadata, cover, page text — runs here in
 * the browser afterwards and reports real progress, never a fake bar.
 */
export function UploadBook({
  onAdded, onUpdated, onRemoved, onProgress,
}: {
  onAdded: (book: LibraryBook) => void;
  onUpdated: (book: Book) => void;
  onRemoved: (bookId: string) => void;
  onProgress: (uploads: UploadState[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => onProgress(uploads), [uploads, onProgress]);

  const update = useCallback((id: string, patch: Partial<UploadState>) => {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }, []);

  const process = useCallback(
    async (file: File) => {
      const tempId = `${file.name}-${Date.now()}`;
      let created: string | null = null;
      setError(null);
      setUploads((prev) => [
        ...prev,
        { id: tempId, name: file.name, status: "Uploading…", percent: 0.05 },
      ]);

      try {
        // Validate before uploading anything: a 40 MB round trip that ends in
        // "unsupported format" is a waste of the reader's time.
        const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
        const signature = String.fromCharCode(...header);
        const looksRight =
          signature === "%PDF" || (signature.startsWith("PK") && /\.epub$/i.test(file.name));
        if (!looksRight) {
          throw new Error("This book format isn't supported yet. Folio reads PDF and EPUB.");
        }

        const { book, uploadUrl } = await api<{ book: Book; uploadUrl: string | null }>(
          "/api/books",
          {
            method: "POST",
            body: JSON.stringify({ name: file.name, size: file.size, type: file.type }),
          },
        );

        created = book.id;
        onAdded({ ...book, progress: null });
        update(tempId, { status: "Uploading…", percent: 0.08, name: book.title });

        // The bytes go straight to storage when the platform provides a signed
        // URL, so a large book never has to squeeze through a function.
        const response = await fetch(uploadUrl ?? `/api/books/${book.id}/file`, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          throw new Error(detail.error ?? "The upload didn't finish. Try again.");
        }

        update(tempId, { status: "Reading the pages…", percent: 0.18 });

        if (book.format === "pdf") {
          const { ingestPdf } = await import("@/lib/pdf/ingest");
          const report = await ingestPdf(book.id, (done, total) => {
            update(tempId, {
              status:
                done < total * 0.4
                  ? "Reading the pages…"
                  : done < total * 0.85
                    ? "Organizing chapters…"
                    : "Preparing your AI companion…",
              percent: 0.18 + (done / total) * 0.74,
            });
          });

          const { book: finished } = await api<{ book: Book }>(`/api/books/${book.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              // Document metadata beats the filename when it exists.
              title: report.title || book.title,
              author: report.author || book.author,
              pageCount: report.pageCount,
              pageLabels: report.pageLabels,
              indexState: "ready",
            }),
          });
          onUpdated(finished);
          // The document's own title is better than the filename we started with.
          update(tempId, { name: finished.title });

          if (report.needsOcr) {
            setError(
              `“${finished.title}” looks like a scan — there is no text to select or search. You can still read it, but the companion won't be able to quote from it.`,
            );
          }
        } else {
          const { ingestEpub } = await import("@/lib/epub/ingest");
          const report = await ingestEpub(book.id, (done, total) => {
            update(tempId, {
              status: done < total * 0.5 ? "Reading the pages…" : "Organizing chapters…",
              percent: 0.18 + (done / total) * 0.74,
            });
          });
          const { book: finished } = await api<{ book: Book }>(`/api/books/${book.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              title: report.title || book.title,
              author: report.author || book.author,
              pageCount: report.pageCount,
              indexState: "ready",
            }),
          });
          onUpdated(finished);
          update(tempId, { name: finished.title });
        }

        update(tempId, { status: "Ready to read.", percent: 1 });
        setTimeout(() => setUploads((prev) => prev.filter((u) => u.id !== tempId)), 1400);
      } catch (e) {
        setUploads((prev) => prev.filter((u) => u.id !== tempId));
        setError(e instanceof Error ? e.message : "That book couldn't be added.");
        // Don't leave a half-created book sitting on the shelf.
        if (created) {
          onRemoved(created);
          void api(`/api/books/${created}`, { method: "DELETE" }).catch(() => {});
        }
      }
    },
    [onAdded, onUpdated, onRemoved, update],
  );

  const handleFiles = useCallback(
    (files: FileList | null) => {
      for (const file of Array.from(files ?? [])) void process(file);
    },
    [process],
  );

  // Drop anywhere on the library.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        setDragging(true);
      }
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      handleFiles(e.dataTransfer?.files ?? null);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [handleFiles]);

  return (
    <>
      <input
        ref={input}
        id="folio-upload"
        type="file"
        accept=".pdf,.epub,application/pdf,application/epub+zip"
        multiple
        className="sr-only"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <button
        onClick={() => input.current?.click()}
        className="inline-flex h-9 items-center gap-1.5 rounded-[3px] border border-rule px-3.5 text-[0.8rem] text-ink transition-colors hover:border-faint hover:bg-[color-mix(in_srgb,var(--color-ink)_4%,transparent)]"
      >
        <Plus />
        Add book
      </button>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-parchment/80 backdrop-blur-sm">
          <div className="rounded-[3px] border-2 border-dashed border-gold px-14 py-11 text-center">
            <p className="font-display text-[1.6rem] font-light text-ink">Let it go.</p>
            <p className="mt-1.5 text-[0.8rem] text-muted">PDF or EPUB</p>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="fixed bottom-6 left-1/2 z-50 w-[min(30rem,calc(100vw-3rem))] -translate-x-1/2 rounded-[3px] border border-rule bg-paper px-4 py-3.5 shadow-[0_14px_36px_-12px_rgba(34,32,28,0.4)]"
        >
          <p className="text-[0.82rem] leading-relaxed text-ink-soft">{error}</p>
          <button
            onClick={() => setError(null)}
            className="mt-2 text-[0.74rem] text-muted transition-colors hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
