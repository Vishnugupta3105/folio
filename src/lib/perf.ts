"use client";

/**
 * Latency instrumentation for the numbers that decide whether this feels fast:
 * speech-recognition start, first AI token, TTS start, page render.
 *
 * Logged in development only. `window.__folioPerf()` prints the table.
 */
type Metric =
  | "stt:start" | "stt:first-transcript" | "ai:request" | "ai:first-token"
  | "ai:complete" | "tts:start" | "page:render" | "book:open";

const samples = new Map<Metric, number[]>();
const marks = new Map<string, number>();

export function mark(key: string): void {
  marks.set(key, performance.now());
}

export function measure(metric: Metric, fromKey: string): number | null {
  const start = marks.get(fromKey);
  if (start === undefined) return null;
  const ms = performance.now() - start;
  const list = samples.get(metric) ?? [];
  list.push(ms);
  samples.set(metric, list.slice(-50));
  if (process.env.NODE_ENV !== "production") {
    console.debug(`[folio:perf] ${metric} ${ms.toFixed(0)}ms`);
  }
  return ms;
}

export function record(metric: Metric, ms: number): void {
  const list = samples.get(metric) ?? [];
  list.push(ms);
  samples.set(metric, list.slice(-50));
}

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as Record<string, unknown>).__folioPerf = () => {
    const rows = [...samples.entries()].map(([metric, values]) => ({
      metric,
      n: values.length,
      median: Math.round([...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]),
      p95: Math.round([...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)] ?? 0),
    }));
    console.table(rows);
  };
}
