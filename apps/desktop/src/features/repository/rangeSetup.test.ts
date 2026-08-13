// Default-mode suggestion: the open flow must never lead a user into an
// empty replay (the "I opened a repo and nothing happened" bug).

import { describe, expect, it } from "vitest";
import { suggestInitialMode } from "./RangeSetup";

describe("suggestInitialMode", () => {
  it("prefers a branch replay when base and head differ", () => {
    expect(suggestInitialMode("main", "feature/work")).toBe("branch");
  });

  it("falls back to the entire repository when there is nothing to branch from", () => {
    // Single-branch repo: default branch == checked-out branch.
    expect(suggestInitialMode("main", "main")).toBe("entire");
  });

  it("falls back when the head is detached or unknown", () => {
    expect(suggestInitialMode("main", "")).toBe("entire");
    expect(suggestInitialMode(null, "main")).toBe("entire");
  });
});
