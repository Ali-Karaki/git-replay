# Security Policy

## Supported versions

Git Replay is early-stage software. Only the latest release receives security
fixes.

| Version | Supported |
|---------|-----------|
| latest release | ✅ |
| everything else | ❌ |

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report them privately to the maintainers (contact channel to be announced with
the public launch). Include:

- a description of the issue and its impact,
- steps to reproduce (including git version and OS),
- the affected version,
- any workarounds you know of.

We aim to acknowledge reports within 72 hours and to publish a fix plus a
security advisory for confirmed issues.

## Security design notes

Git Replay is local-first by design:

- Opening or replaying a repository never uploads its contents anywhere. The
  only network use is what you explicitly trigger (fetching a PR).
- Git is the source of truth; the SQLite database is a derived cache and
  contains no data that isn't recoverable from the repository.
- Untrusted data (commit messages, file contents) is rendered with escaping in
  place — the markdown preview escapes raw HTML, and diff/file content is
  rendered through HTML-escaped highlighting output.
