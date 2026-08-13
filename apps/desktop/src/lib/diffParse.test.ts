// Unified-diff parser and split-view pairing (presentation layer).

import { describe, expect, it } from "vitest";
import { buildSplitRows, parseDiff, wordDiff } from "./diffParse";

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 context one
-old line
+new line
+added line
 context two
`;

const RENAME_PATCH = `diff --git a/old.ts b/new.ts
similarity index 90%
rename from old.ts
rename to new.ts
index 1111111..2222222 100644
--- a/old.ts
+++ b/new.ts
@@ -1,2 +1,2 @@
-a
+b
 c
`;

describe("parseDiff", () => {
  it("parses hunks, line kinds, and line numbers", () => {
    const d = parseDiff(PATCH);
    expect(d.oldPath).toBe("src/a.ts");
    expect(d.newPath).toBe("src/a.ts");
    expect(d.hunks).toHaveLength(1);
    const h = d.hunks[0];
    expect(h.oldStart).toBe(1);
    expect(h.oldCount).toBe(3);
    expect(h.newStart).toBe(1);
    expect(h.newCount).toBe(4);
    expect(h.lines.map((l) => l.kind)).toEqual(["ctx", "del", "add", "add", "ctx"]);
    // Line numbers advance per side.
    expect(h.lines[0].oldNo).toBe(1);
    expect(h.lines[0].newNo).toBe(1);
    expect(h.lines[1].oldNo).toBe(2);
    expect(h.lines[1].newNo).toBeNull();
    expect(h.lines[2].oldNo).toBeNull();
    expect(h.lines[2].newNo).toBe(2);
  });

  it("detects renames with similarity", () => {
    const d = parseDiff(RENAME_PATCH);
    expect(d.isRename).toBe(true);
    expect(d.oldPath).toBe("old.ts");
    expect(d.newPath).toBe("new.ts");
    expect(d.similarity).toBe(90);
  });

  it("detects new files", () => {
    const d = parseDiff("diff --git a/x b/x\nnew file mode 100644\n--- /dev/null\n+++ b/x\n@@ -0,0 +1,1 @@\n+hello\n");
    expect(d.isNew).toBe(true);
    expect(d.oldPath).toBeNull();
    expect(d.newPath).toBe("x");
  });
});

describe("buildSplitRows", () => {
  it("pairs del/add runs sequentially", () => {
    const d = parseDiff(PATCH);
    const rows = buildSplitRows(d);
    const kinds = rows.map((r) => [r.left?.kind ?? "empty", r.right?.kind ?? "empty"]);
    expect(kinds).toEqual([
      ["ctx", "ctx"],
      ["del", "add"],
      ["empty", "add"],
      ["ctx", "ctx"],
    ]);
  });
});

describe("wordDiff", () => {
  it("splits common prefix and suffix", () => {
    const wd = wordDiff("const x = 123;", "const x = 456;");
    expect(wd.del).toEqual({ prefix: "const x = ", mid: "123", suffix: ";" });
    expect(wd.add).toEqual({ prefix: "const x = ", mid: "456", suffix: ";" });
  });

  it("handles fully-different lines", () => {
    const wd = wordDiff("abc", "xyz");
    expect(wd.del.mid).toBe("abc");
    expect(wd.add.mid).toBe("xyz");
    expect(wd.del.prefix).toBe("");
    expect(wd.del.suffix).toBe("");
  });
});
