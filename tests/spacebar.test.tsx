// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSpaceVoice } from "@/components/reader/hooks/useSpaceVoice";

/**
 * A stand-in for the browser's recognition engine that records its lifecycle,
 * so the tests can assert on when capture actually starts and stops.
 */
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  static startCount = 0;

  continuous = false;
  interimResults = false;
  lang = "";
  maxAlternatives = 1;
  started = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;

  constructor() {
    FakeRecognition.instances.push(this);
  }
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return true;
  }
  start() {
    this.started = true;
    FakeRecognition.startCount++;

  }
  stop() {
    this.started = false;
    this.onend?.();
  }
  abort() {
    this.started = false;
  }

  /** Simulates the engine returning a transcript. */
  say(transcript: string, isFinal = true, confidence = 0.95) {
    this.onresult?.({
      resultIndex: 0,
      results: { length: 1, 0: { isFinal, length: 1, 0: { transcript, confidence } } },
    });
  }
}

const press = (options: KeyboardEventInit = {}) =>
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true, ...options }));
const release = (options: KeyboardEventInit = {}) =>
  window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", bubbles: true, cancelable: true, ...options }));

const latest = () => FakeRecognition.instances.at(-1)!;

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecognition.instances = [];
  FakeRecognition.startCount = 0;
  (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
  (navigator as unknown as Record<string, unknown>).mediaDevices = {
    getUserMedia: async () => ({ getTracks: () => [] }),
  };
});

afterEach(() => {
  vi.useRealTimers();
});

function harness() {
  const onSubmit = vi.fn();
  const view = renderHook(() => useSpaceVoice({ enabled: true, onSubmit }));
  return { onSubmit, ...view };
}

describe("hold space to ask", () => {
  it("1. starts listening on keydown, not on keyup", () => {
    const { result } = harness();
    act(() => void press());
    expect(latest().started).toBe(true);
    expect(result.current.state).toBe("listening");
  });

  it("2. submits the transcript on keyup", () => {
    const { result, onSubmit } = harness();
    act(() => void press());
    act(() => latest().say("what does the author mean here"));
    expect(result.current.transcript).toBe("what does the author mean here");

    act(() => {
      release();
      vi.advanceTimersByTime(500);
    });
    expect(onSubmit).toHaveBeenCalledWith("what does the author mean here");
  });

  it("3. stays out of the way while typing in a field", () => {
    harness();
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();

    act(() => void input.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true }),
    ));

    expect(FakeRecognition.startCount).toBe(0);
    input.remove();
  });

  it("4. ignores auto-repeat, so one hold is one request", () => {
    const { onSubmit } = harness();
    act(() => {
      press();
      press({ repeat: true });
      press({ repeat: true });
      press({ repeat: true });
    });
    expect(FakeRecognition.startCount).toBe(1);

    act(() => latest().say("one question"));
    act(() => {
      release();
      vi.advanceTimersByTime(500);
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("5. keeps listening however long the key is held", () => {
    const { result } = harness();
    act(() => void press());
    act(() => void vi.advanceTimersByTime(30_000));
    expect(result.current.state).toBe("listening");
    expect(latest().started).toBe(true);
  });

  it("6. closes the microphone when the window loses focus mid-hold", () => {
    const { onSubmit } = harness();
    act(() => void press());
    act(() => latest().say("a question asked before switching away"));

    act(() => {
      window.dispatchEvent(new Event("blur"));
      vi.advanceTimersByTime(500);
    });
    expect(latest().started).toBe(false);
    expect(onSubmit).toHaveBeenCalled();
  });

  it("7. surfaces a denied microphone as guidance, not a crash", () => {
    const { result } = harness();
    act(() => void press());
    act(() => latest().onerror?.({ error: "not-allowed" }));

    expect(result.current.state).toBe("error");
    expect(result.current.error).toMatch(/microphone access is required/i);
  });

  it("8. cancels on Escape without submitting", () => {
    const { result, onSubmit } = harness();
    act(() => void press());
    act(() => latest().say("never mind"));

    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    act(() => void vi.advanceTimersByTime(600));

    expect(result.current.state).toBe("idle");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("9. offers a retry instead of sending nothing", () => {
    const { result, onSubmit } = harness();
    act(() => void press());
    act(() => {
      release();
      vi.advanceTimersByTime(500);
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/couldn't quite catch/i);
  });

  it("10. prevents the browser's default spacebar scroll", () => {
    harness();
    const event = new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true });
    act(() => void window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves other shortcuts alone when a modifier is held", () => {
    harness();
    act(() => void press({ metaKey: true }));
    expect(FakeRecognition.startCount).toBe(0);
  });

  /**
   * The reader passes inline closures, so `onSubmit` and `onCancel` are new
   * objects on every render — and `useSpaceVoice` renders the moment capture
   * starts. Every test above passes one stable `vi.fn()`, which is why they all
   * went on passing while hold-to-talk was completely dead in the actual app:
   * the listener effect re-ran and its cleanup aborted the live microphone.
   */
  it("survives a caller that passes a new handler on every render", () => {
    const submitted: string[] = [];
    const { result, rerender } = renderHook(() =>
      useSpaceVoice({
        enabled: true,
        onSubmit: (t) => void submitted.push(t),
        onCancel: () => {},
      }),
    );

    act(() => void press());
    expect(latest().started).toBe(true);

    // Whatever else the reader is doing — narration ticking, a page turning —
    // must not reach into the capture.
    act(() => void rerender());
    act(() => void rerender());
    expect(latest().started).toBe(true);
    expect(result.current.state).toBe("listening");

    act(() => latest().say("what does the author mean here"));
    act(() => {
      release();
      vi.advanceTimersByTime(500);
    });

    expect(submitted).toEqual(["what does the author mean here"]);
    expect(result.current.error).toBeNull();
  });

  it("declines a transcript the recogniser itself doubts", () => {
    const { result, onSubmit } = harness();
    act(() => void press());
    act(() => latest().say("uh", true, 0.2));
    act(() => {
      release();
      vi.advanceTimersByTime(500);
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/couldn't quite catch/i);
  });
});
