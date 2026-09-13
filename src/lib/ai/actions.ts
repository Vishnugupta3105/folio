/**
 * The AI action system. Adding a mode means adding one entry here — nothing in
 * the UI or the route handler needs to change.
 */
export type ActionId =
  | "ask" | "explain" | "simplify" | "example" | "summarize"
  | "define" | "translate" | "challenge" | "connect" | "visualize"
  | "teach" | "explain-page";

export interface Action {
  id: ActionId;
  label: string;
  /** Shown on the selection toolbar's first row. */
  primary?: boolean;
  /** Built from the selection; `ask` uses the reader's own words instead. */
  prompt: (selection: string) => string;
}

export const ACTIONS: Record<ActionId, Action> = {
  ask: {
    id: "ask", label: "Ask AI", primary: true,
    prompt: (s) => s,
  },
  explain: {
    id: "explain", label: "Explain", primary: true,
    prompt: (s) => `Explain what this passage means, in context:\n\n"${s}"`,
  },
  simplify: {
    id: "simplify", label: "Simplify", primary: true,
    prompt: (s) => `Restate this in the plainest language you can, without losing the meaning:\n\n"${s}"`,
  },
  example: {
    id: "example", label: "Example", primary: true,
    prompt: (s) => `Give one concrete example that illustrates this idea:\n\n"${s}"`,
  },
  summarize: {
    id: "summarize", label: "Summarize",
    prompt: (s) => `Summarize this passage in two or three sentences:\n\n"${s}"`,
  },
  define: {
    id: "define", label: "Define",
    prompt: (s) => `Define "${s}" — first the general meaning, then how the author is using it here.`,
  },
  translate: {
    id: "translate", label: "Translate",
    prompt: (s) => `Translate this into clear modern English. If it is already modern English, translate it into simpler English and say so:\n\n"${s}"`,
  },
  challenge: {
    id: "challenge", label: "Challenge",
    prompt: (s) => `Push back on this claim. What is the strongest counterargument, and what would the author say in reply?\n\n"${s}"`,
  },
  connect: {
    id: "connect", label: "Connect",
    prompt: (s) => `How does this connect to what came earlier in the book? Cite the pages you draw on.\n\n"${s}"`,
  },
  teach: {
    id: "teach", label: "Teach me",
    prompt: (s) => `Teach me this as a patient tutor would — assume I am fifteen and curious. Build it up from something I already understand:\n\n"${s}"`,
  },
  visualize: {
    id: "visualize", label: "Visualize",
    prompt: (s) => `Turn this into a diagram.

Reply with a short sentence naming what the diagram shows, then a single fenced code block tagged \`folio-diagram\` containing JSON of this shape:
{"type":"flow"|"timeline"|"hierarchy"|"compare","title":string,"nodes":[{"id":string,"label":string,"detail"?:string}],"edges"?:[{"from":string,"to":string,"label"?:string}]}

Use "flow" for processes, "timeline" for sequences in time, "hierarchy" for parent/child structure, "compare" for two-sided contrasts (give each node a "side":"left"|"right"). Keep it to 8 nodes at most. If the passage genuinely has no structure worth drawing, say so in one sentence and produce no code block.

Passage:
"${s}"`,
  },
  "explain-page": {
    id: "explain-page", label: "Explain this page",
    prompt: () => `Explain the page I am currently reading, using exactly this structure and these headings:

### What's happening
Two or three sentences.

### The key idea
One sentence.

### Worth knowing
Three to five bullets, each a short phrase followed by a clause of explanation.

### Why it matters
Two sentences.

### Connection
How this follows from what I have already read. Cite pages. If this is the opening of the book, say so instead.`,
  },
};

export const PRIMARY_ACTIONS = Object.values(ACTIONS).filter((a) => a.primary);
export const MORE_ACTIONS = Object.values(ACTIONS).filter(
  (a) => !a.primary && a.id !== "explain-page",
);

/** Follow-ups offered under a finished answer. */
export const FOLLOW_UPS: { label: string; prompt: string }[] = [
  { label: "Explain more simply", prompt: "Explain that more simply." },
  { label: "Give me an example", prompt: "Give me a concrete example of that." },
  { label: "Connect to earlier", prompt: "How does that connect to what I've already read? Cite pages." },
  { label: "Why does it matter?", prompt: "Why does that matter?" },
];
