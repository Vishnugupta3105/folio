"use client";

import { useCallback, useRef, useState } from "react";
import type { ActionId } from "@/lib/ai/actions";
import type { AIMessage } from "@/types";
import { mark, measure } from "@/lib/perf";

export interface Turn {
  id: string;
  question: string;
  answer: string;
  selectedText: string | null;
  page: number;
  sourcePages: number[];
  streaming: boolean;
  error: string | null;
}

export interface AskInput {
  bookId: string;
  page: number;
  question?: string;
  selectedText?: string | null;
  action?: ActionId;
  /** Voice answers are short and get spoken back. */
  voice?: boolean;
}

/**
 * Owns the conversation with the companion.
 *
 * Answers stream token by token; the panel never waits for a complete response.
 * A new question aborts the one in flight, so pressing space twice in a row
 * can't leave two answers racing into the same panel.
 */
export function useCompanion({
  initialMessages, onAnswerComplete,
}: {
  initialMessages: AIMessage[];
  onAnswerComplete?: (answer: string, voice: boolean) => void;
}) {
  const [turns, setTurns] = useState<Turn[]>(() => rebuild(initialMessages));
  const [thinking, setThinking] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const ask = useCallback(
    async (input: AskInput) => {
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;

      const id = `turn-${Date.now()}`;
      const question = input.question?.trim() || labelFor(input.action);

      setTurns((prev) => [
        ...prev,
        {
          id,
          question,
          answer: "",
          selectedText: input.selectedText ?? null,
          page: input.page,
          sourcePages: [],
          streaming: true,
          error: null,
        },
      ]);
      setThinking(true);
      mark("ai");

      const patch = (update: Partial<Turn>) =>
        setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...update } : t)));

      try {
        const response = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: abort.signal,
        });

        if (!response.ok || !response.body) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? "The companion couldn't be reached.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let answer = "";
        let firstToken = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line; anything after the last
          // one is a partial frame and stays in the buffer.
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const event = /^event: (.+)$/m.exec(frame)?.[1];
            const raw = /^data: (.*)$/m.exec(frame)?.[1];
            if (!event || raw === undefined) continue;

            const data = JSON.parse(raw);
            if (event === "sources") {
              patch({ sourcePages: data.pages ?? [] });
            } else if (event === "delta") {
              if (!firstToken) {
                firstToken = true;
                measure("ai:first-token", "ai");
                setThinking(false);
              }
              answer += data;
              patch({ answer });
            } else if (event === "error") {
              patch({ error: data.message, streaming: false });
            } else if (event === "done") {
              patch({ streaming: false, sourcePages: data.pages ?? [] });
            }
          }
        }

        measure("ai:complete", "ai");
        patch({ streaming: false });
        if (answer) onAnswerComplete?.(answer, Boolean(input.voice));
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          setTurns((prev) => prev.filter((t) => t.id !== id));
        } else {
          patch({
            streaming: false,
            error:
              error instanceof Error
                ? error.message
                : "Your book is still here — the AI is temporarily unavailable.",
          });
        }
      } finally {
        setThinking(false);
        if (controller.current === abort) controller.current = null;
      }
    },
    [onAnswerComplete],
  );

  const stop = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setThinking(false);
    setTurns((prev) => prev.map((t) => (t.streaming ? { ...t, streaming: false } : t)));
  }, []);

  return { turns, thinking, ask, stop, clear: () => setTurns([]) };
}

/** Rebuilds the saved message list into question/answer pairs. */
function rebuild(messages: AIMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      turns.push({
        id: message.id,
        question: message.content,
        answer: "",
        selectedText: message.selectedText,
        page: message.page ?? 1,
        sourcePages: [],
        streaming: false,
        error: null,
      });
    } else {
      const last = turns.at(-1);
      if (last && !last.answer) {
        last.answer = message.content;
        last.sourcePages = message.sourcePages ?? [];
      }
    }
  }
  return turns;
}

function labelFor(action?: ActionId): string {
  const labels: Partial<Record<ActionId, string>> = {
    explain: "Explain this",
    simplify: "Say that more simply",
    example: "Give me an example",
    summarize: "Summarize this",
    define: "Define this",
    translate: "Translate this",
    challenge: "Challenge this",
    connect: "Connect this to earlier",
    teach: "Teach me this",
    visualize: "Visualize this",
    "explain-page": "Explain this page",
  };
  return labels[action ?? "ask"] ?? "Ask about this";
}
