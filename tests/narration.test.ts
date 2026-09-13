import { describe, expect, it } from "vitest";
import { splitSentences } from "@/lib/tts/tts";

describe("sentence splitting", () => {
  it("reports offsets that point at the exact words in the page text", () => {
    const text = "The mind is two. It does not always agree. Wolf calls this the reading brain.";
    const sentences = splitSentences(text);

    expect(sentences).toHaveLength(3);
    // This is the contract the narration highlight depends on: slicing the page
    // text by a sentence's offsets must reproduce that sentence exactly.
    for (const sentence of sentences) {
      expect(text.slice(sentence.start, sentence.end)).toBe(sentence.text);
    }
  });

  it("keeps offsets accurate across newlines and leading whitespace", () => {
    const text = "First line.\n\n   Second sentence here. Third one.";
    for (const sentence of splitSentences(text)) {
      expect(text.slice(sentence.start, sentence.end)).toBe(sentence.text);
    }
  });

  it("handles quotes and brackets closing after the stop", () => {
    const text = 'He said "it is over." Then he left.';
    const sentences = splitSentences(text);
    expect(sentences).toHaveLength(2);
    expect(sentences[0].text).toBe('He said "it is over."');
    expect(text.slice(sentences[1].start, sentences[1].end)).toBe("Then he left.");
  });

  it("skips page furniture that would be read aloud as nonsense", () => {
    const sentences = splitSentences("42\n\n• • •\n\nReal prose begins here.");
    expect(sentences.map((s) => s.text)).toEqual(["Real prose begins here."]);
  });

  it("returns nothing for an empty or blank page", () => {
    expect(splitSentences("")).toHaveLength(0);
    expect(splitSentences("   \n \n ")).toHaveLength(0);
  });

  it("does not lose the last sentence when it has no terminator", () => {
    const text = "A complete thought. An unterminated one";
    const sentences = splitSentences(text);
    expect(sentences.at(-1)?.text).toBe("An unterminated one");
  });
});
