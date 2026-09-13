"use client";

import { motion } from "motion/react";

export interface DiagramSpec {
  type: "flow" | "timeline" | "hierarchy" | "compare";
  title?: string;
  nodes: { id: string; label: string; detail?: string; side?: "left" | "right" }[];
  edges?: { from: string; to: string; label?: string }[];
}

/**
 * Renders a structured diagram rather than generating an image.
 *
 * The model returns a small typed spec, so the result is crisp at any zoom,
 * legible in both themes, readable by a screen reader, and costs nothing beyond
 * the tokens of the JSON itself.
 */
export function Diagram({ spec }: { spec: DiagramSpec }) {
  if (!spec?.nodes?.length) return null;

  const nodes = spec.nodes.slice(0, 8);

  return (
    <figure className="!mt-5 rounded-[3px] border border-rule bg-parchment-deep/60 p-4">
      {spec.title && (
        <figcaption className="label mb-4 !text-[0.6rem]">{spec.title}</figcaption>
      )}

      {spec.type === "compare" ? (
        <div className="grid grid-cols-2 gap-3">
          {(["left", "right"] as const).map((side) => (
            <div key={side} className="space-y-2">
              {nodes
                .filter((n) => (n.side ?? (nodes.indexOf(n) % 2 === 0 ? "left" : "right")) === side)
                .map((node, i) => (
                  <Node key={node.id} node={node} index={i} />
                ))}
            </div>
          ))}
        </div>
      ) : spec.type === "hierarchy" ? (
        <div className="space-y-1.5">
          {nodes.map((node, i) => (
            <div key={node.id} style={{ paddingLeft: `${depth(spec, node.id) * 1.1}rem` }}>
              <Node node={node} index={i} />
            </div>
          ))}
        </div>
      ) : (
        <ol className="space-y-0">
          {nodes.map((node, i) => (
            <li key={node.id}>
              <Node node={node} index={i} />
              {i < nodes.length - 1 && (
                <div className="flex items-center gap-2 py-1 pl-4" aria-hidden="true">
                  <svg viewBox="0 0 8 22" className="h-5 w-2 text-faint" fill="none">
                    <path d="M4 0v16M4 21l-3-4M4 21l3-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  {edgeLabel(spec, node.id, nodes[i + 1].id) && (
                    <span className="text-[0.7rem] italic text-faint">
                      {edgeLabel(spec, node.id, nodes[i + 1].id)}
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </figure>
  );
}

function Node({
  node, index,
}: {
  node: DiagramSpec["nodes"][number];
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.055, duration: 0.3, ease: "easeOut" }}
      className="rounded-[2px] border border-rule bg-paper px-3 py-2"
    >
      <p className="font-display text-[0.88rem] font-medium leading-snug text-ink">{node.label}</p>
      {node.detail && (
        <p className="mt-0.5 text-[0.72rem] leading-relaxed text-muted">{node.detail}</p>
      )}
    </motion.div>
  );
}

function edgeLabel(spec: DiagramSpec, from: string, to: string): string | undefined {
  return spec.edges?.find((e) => e.from === from && e.to === to)?.label;
}

/** Depth of a node in a hierarchy, capped so a cycle can't hang the render. */
function depth(spec: DiagramSpec, id: string, seen = new Set<string>()): number {
  if (seen.has(id) || seen.size > 8) return 0;
  seen.add(id);
  const parent = spec.edges?.find((e) => e.to === id)?.from;
  return parent ? 1 + depth(spec, parent, seen) : 0;
}
