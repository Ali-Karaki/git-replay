// Formatting helpers.

import { describe, expect, it } from "vitest";
import { basename, dirname, formatBytes, formatCount, isGeneratedPath, shortSha } from "./format";

describe("path helpers", () => {
  it("splits basename and dirname", () => {
    expect(basename("src/worker.ts")).toBe("worker.ts");
    expect(basename("worker.ts")).toBe("worker.ts");
    expect(dirname("src/worker.ts")).toBe("src");
    expect(dirname("worker.ts")).toBe("");
  });

  it("shortens shas", () => {
    expect(shortSha("0123456789abcdef0123456789abcdef01234567")).toBe("0123456");
  });
});

describe("formatting", () => {
  it("formats counts", () => {
    expect(formatCount(42)).toBe("42");
    expect(formatCount(1500)).toBe("1.5k");
    expect(formatCount(2_500_000)).toBe("2.5M");
  });

  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("generated-file heuristic", () => {
  it("flags lockfiles and build output", () => {
    expect(isGeneratedPath("package-lock.json")).toBe(true);
    expect(isGeneratedPath("pnpm-lock.yaml")).toBe(true);
    expect(isGeneratedPath("yarn.lock")).toBe(true);
    expect(isGeneratedPath("dist/bundle.js")).toBe(true);
    expect(isGeneratedPath("node_modules/x/index.js")).toBe(true);
    expect(isGeneratedPath("app.min.js")).toBe(true);
  });

  it("leaves source files alone", () => {
    expect(isGeneratedPath("src/worker.ts")).toBe(false);
    expect(isGeneratedPath("package.json")).toBe(false);
    expect(isGeneratedPath("README.md")).toBe(false);
  });
});
