import { describe, expect, it } from "vitest";
import { decodePcm16, splitSentences } from "@/lib/tts/tts";

/** Builds signed 16-bit little-endian PCM from sample values. */
function pcm(...values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((v, i) => view.setInt16(i * 2, v, true));
  return bytes;
}

describe("streaming PCM decode", () => {
  it("reads little-endian samples into the -1..1 range", () => {
    const { samples, leftover } = decodePcm16(pcm(0, 32767, -32768, 16384));
    expect(Array.from(samples)).toEqual([0, 32767 / 32768, -1, 0.5]);
    expect(leftover).toHaveLength(0);
  });

  it("carries a sample split across two chunks instead of dropping it", () => {
    const whole = pcm(1000, -2000, 3000);

    // Hand it over one byte at a time — the worst case the network can produce.
    const rebuilt: number[] = [];
    let carried: Uint8Array = new Uint8Array(0);
    for (const byte of whole) {
      const { samples, leftover } = decodePcm16(new Uint8Array([byte]), carried);
      carried = leftover;
      rebuilt.push(...samples);
    }

    expect(carried).toHaveLength(0);
    expect(rebuilt).toEqual(Array.from(decodePcm16(whole).samples));
    expect(rebuilt.map((s) => Math.round(s * 32768))).toEqual([1000, -2000, 3000]);
  });

  it("holds back a lone trailing byte until its partner arrives", () => {
    const first = decodePcm16(new Uint8Array([0x10]));
    expect(first.samples).toHaveLength(0);
    expect(first.leftover).toHaveLength(1);

    const second = decodePcm16(new Uint8Array([0x20]), first.leftover);
    expect(second.samples).toHaveLength(1);
    expect(Math.round(second.samples[0] * 32768)).toBe(0x2010);
  });
});

describe("sentence splitting", () => {
  it("keeps offsets that resolve back into the source text", () => {
    const text = "The first point. And a second one! A third?";
    for (const sentence of splitSentences(text)) {
      expect(text.slice(sentence.start, sentence.end)).toBe(sentence.text);
    }
  });
});
