import { describe, expect, it } from "vitest";
import { ACTIONS, MORE_ACTIONS, PRIMARY_ACTIONS } from "@/lib/ai/actions";

describe("AI actions", () => {
  it("keeps the selection toolbar to four primary actions", () => {
    expect(PRIMARY_ACTIONS).toHaveLength(4);
    expect(PRIMARY_ACTIONS.map((a) => a.id)).toEqual(["ask", "explain", "simplify", "example"]);
  });

  it("carries the selected text into every prompt", () => {
    const selection = "the author's central claim";
    for (const action of [...PRIMARY_ACTIONS, ...MORE_ACTIONS]) {
      expect(action.prompt(selection)).toContain(selection);
    }
  });

  it("asks for a structured diagram rather than an image", () => {
    const prompt = ACTIONS.visualize.prompt("a supply chain");
    expect(prompt).toContain("folio-diagram");
    expect(prompt).toMatch(/flow.*timeline.*hierarchy.*compare/s);
    expect(prompt).not.toMatch(/generate an image|dall-?e/i);
  });

  it("gives explain-page a fixed structure so the answer is scannable", () => {
    const prompt = ACTIONS["explain-page"].prompt("");
    for (const heading of ["What's happening", "The key idea", "Worth knowing", "Why it matters", "Connection"]) {
      expect(prompt).toContain(heading);
    }
  });
});
