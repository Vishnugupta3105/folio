"use client";

import { Fragment, useMemo } from "react";
import { Diagram, type DiagramSpec } from "./Diagram";

/**
 * Renders the companion's answers.
 *
 * A focused renderer rather than a markdown library: the model is instructed to
 * use a narrow subset (emphasis, small headings, bullets, inline code, page
 * citations), and citations need to become buttons that navigate the book,
 * which a generic renderer wouldn't do.
 */
export function Markdown({
  text, onCitation,
}: {
  text: string;
  onCitation?: (page: number) => void;
}) {
  const blocks = useMemo(() => parse(text), [text]);

  return (
    <div className="prose-folio">
      {blocks.map((block, i) => {
        if (block.kind === "diagram") {
          return <Diagram key={i} spec={block.spec} />;
        }
        if (block.kind === "heading") {
          return <h3 key={i}>{inline(block.text, onCitation)}</h3>;
        }
        if (block.kind === "list") {
          return (
            <ul key={i}>
              {block.items.map((item, j) => (
                <li key={j}>{inline(item, onCitation)}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{inline(block.text, onCitation)}</p>;
      })}
    </div>
  );
}

type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "diagram"; spec: DiagramSpec };

function parse(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.split("\n");
  let paragraph: string[] = [];
  let list: string[] = [];

  const flush = () => {
    if (paragraph.length) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ").trim() });
      paragraph = [];
    }
    if (list.length) {
      blocks.push({ kind: "list", items: list });
      list = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // A diagram arrives as a fenced block; collect it whole.
    if (line.trimStart().startsWith("```")) {
      flush();
      const tag = line.trim().slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        body.push(lines[i]);
        i++;
      }
      if (tag === "folio-diagram") {
        try {
          blocks.push({ kind: "diagram", spec: JSON.parse(body.join("\n")) as DiagramSpec });
        } catch {
          // A half-streamed diagram simply isn't drawn yet.
        }
      } else if (body.length) {
        blocks.push({ kind: "paragraph", text: body.join(" ") });
      }
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", text: heading[1] });
      continue;
    }

    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      if (paragraph.length) flush();
      list.push(bullet[1]);
      continue;
    }

    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      if (paragraph.length) flush();
      list.push(numbered[1]);
      continue;
    }

    if (list.length) flush();
    paragraph.push(line.trim());
  }

  flush();
  return blocks;
}

/** Inline emphasis, code, and clickable page citations. */
function inline(text: string, onCitation?: (page: number) => void): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  // One pass over bold, italic, code, and (p. 84) / (pp. 82–84) citations.
  const pattern =
    /(\*\*[^*]+\*\*)|(\*[^*]+\*)|(`[^`]+`)|(\(pp?\.\s*\d+(?:\s*[–-]\s*\d+)?\))/g;

  let last = 0;
  let key = 0;

  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) nodes.push(<Fragment key={key++}>{text.slice(last, at)}</Fragment>);
    const token = match[0];

    if (token.startsWith("**")) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={key++}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("(")) {
      const page = Number(/\d+/.exec(token)?.[0]);
      nodes.push(
        onCitation && page ? (
          <button
            key={key++}
            onClick={() => onCitation(page)}
            title={`Go to page ${page}`}
            className="mx-[0.1em] rounded-[2px] border-b border-dotted border-gold px-[0.15em] text-[0.9em] text-gold transition-colors hover:bg-[color-mix(in_srgb,var(--color-gold)_14%,transparent)]"
          >
            {token.slice(1, -1)}
          </button>
        ) : (
          <Fragment key={key++}>{token}</Fragment>
        ),
      );
    } else {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    last = at + token.length;
  }

  if (last < text.length) nodes.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return nodes;
}
