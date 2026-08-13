// Highlighted code: token runs from the highlighting worker rendered as
// nested spans reproducing hljs's class stack — the same look the old HTML
// string had, with React escaping every text run. No HTML strings anywhere.

import type { HighlightToken } from "../workers/highlight.worker";

export function HighlightedTokens({ tokens }: { tokens: HighlightToken[] }) {
  return (
    <>
      {tokens.map((tok) => {
        let inner: React.ReactNode = tok.text;
        for (const cls of tok.cls) {
          inner = <span className={cls}>{inner}</span>;
        }
        return <span key={`${tok.cls.join(".")}:${tok.text}`}>{inner}</span>;
      })}
    </>
  );
}
