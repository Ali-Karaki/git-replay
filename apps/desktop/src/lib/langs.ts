// File extension → highlight.js language id (common bundle).

const BY_EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  vue: "xml",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  conf: "ini",
  cfg: "ini",
  sql: "sql",
  rb: "ruby",
  php: "php",
  swift: "swift",
  lua: "lua",
  pl: "perl",
  ex: "elixir",
  exs: "elixir",
  hs: "haskell",
  clj: "clojure",
  dart: "dart",
  r: "r",
  scala: "scala",
  groovy: "groovy",
  gradle: "groovy",
  makefile: "makefile",
  mk: "makefile",
  cmake: "cmake",
  dockerfile: "dockerfile",
};

const BY_NAME: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  cmakelists: "cmake",
  ".gitignore": "bash",
  ".gitattributes": "bash",
};

export function langForPath(path: string): string | null {
  const base = path.toLowerCase();
  const name = base.slice(base.lastIndexOf("/") + 1);
  if (BY_NAME[name]) return BY_NAME[name];
  const dot = name.lastIndexOf(".");
  if (dot === -1) return null;
  return BY_EXT[name.slice(dot + 1)] ?? null;
}
