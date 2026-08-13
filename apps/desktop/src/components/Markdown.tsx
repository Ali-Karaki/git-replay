// Markdown rendering: the parser (lib/markdown.ts) produces a typed AST,
// this component renders it as React elements. No dangerouslySetInnerHTML —
// React's text escaping makes raw-HTML injection impossible by construction.
// Parser-assigned node ids are the React keys.

import { Fragment, useMemo } from "react";
import { type Block, type Inline, parseMarkdown } from "../lib/markdown";

function InlineNodes({ nodes, onNavigate }: { nodes: Inline[]; onNavigate?: (href: string) => void }) {
  return nodes.map((n) => {
    switch (n.t) {
      case "text":
        return <Fragment key={n.id}>{n.s}</Fragment>;
      case "code":
        return <code key={n.id}>{n.s}</code>;
      case "strong":
        return (
          <strong key={n.id}>
            <InlineNodes nodes={n.c} onNavigate={onNavigate} />
          </strong>
        );
      case "em":
        return (
          <em key={n.id}>
            <InlineNodes nodes={n.c} onNavigate={onNavigate} />
          </em>
        );
      case "a": {
        const external = /^https?:/i.test(n.href) || n.href.startsWith("#");
        return (
          <a
            key={n.id}
            href={external ? n.href : undefined}
            onClick={
              onNavigate && !external
                ? (e) => {
                    e.preventDefault();
                    onNavigate(n.href);
                  }
                : undefined
            }
          >
            <InlineNodes nodes={n.c} onNavigate={onNavigate} />
          </a>
        );
      }
      default:
        return null;
    }
  });
}

function BlockNode({ block, onNavigate }: { block: Block; onNavigate?: (href: string) => void }) {
  switch (block.t) {
    case "p":
      return (
        <p>
          <InlineNodes nodes={block.c} onNavigate={onNavigate} />
        </p>
      );
    case "h": {
      const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return (
        <Tag>
          <InlineNodes nodes={block.c} onNavigate={onNavigate} />
        </Tag>
      );
    }
    case "hr":
      return <hr />;
    case "quote":
      return (
        <blockquote>
          <InlineNodes nodes={block.c} onNavigate={onNavigate} />
        </blockquote>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag>
          {block.items.map((item) => (
            <li key={item.id}>
              <InlineNodes nodes={item.c} onNavigate={onNavigate} />
            </li>
          ))}
        </Tag>
      );
    }
    case "pre":
      return (
        <pre>
          <code>{block.code}</code>
        </pre>
      );
    default:
      return null;
  }
}

export function Markdown({ src, onNavigate }: { src: string; onNavigate?: (href: string) => void }) {
  const blocks = useMemo(() => parseMarkdown(src), [src]);
  return blocks.map((b) => <BlockNode key={b.id} block={b} onNavigate={onNavigate} />);
}
