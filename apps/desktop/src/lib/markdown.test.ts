// Markdown renderer: the common shapes + escaping (raw HTML never passes).

import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders headings, paragraphs and inline styles", () => {
    const html = renderMarkdown("# Title\n\nSome **bold** and *italic* and `code` text.\n");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<p>Some <strong>bold</strong> and <em>italic</em> and <code>code</code> text.</p>");
  });

  it("renders fenced code blocks without interpreting their contents", () => {
    const html = renderMarkdown("```ts\nconst x = <T>1;\n```\n");
    expect(html).toContain("<pre><code>const x = &lt;T&gt;1;</code></pre>");
  });

  it("renders lists and links", () => {
    const html = renderMarkdown("- one\n- two\n\n1. first\n2. second\n\n[link](https://example.com)\n");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>first</li>");
    expect(html).toContain('<a href="https://example.com">link</a>');
  });

  it("escapes raw HTML — nothing passes through unescaped", () => {
    const html = renderMarkdown("hello <script>alert(1)</script> world");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders blockquotes and horizontal rules", () => {
    const html = renderMarkdown("> quoted\n\n---\n");
    expect(html).toContain("<blockquote>quoted</blockquote>");
    expect(html).toContain("<hr/>");
  });
});
