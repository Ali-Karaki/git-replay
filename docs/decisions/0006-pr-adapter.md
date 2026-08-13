# ADR-0006: Pull requests as a replay source

**Status:** accepted
**Date:** 2026-08-13

## Context

The spec (§9.4, §20) treats a PR as just another way of selecting a history,
and asks that force-push "versions" of a PR be preserved where observable.
Core replay must stay local and offline-first; GitHub access is an explicit,
user-triggered integration.

## Decision

- A PR is resolved to an ordinary `ReplayRange` (base oid → head oid) and fed
  through the exact same engine as local refs — the PR adapter is an input
  adapter, not a second code path.
- Metadata and force-push history come from the `gh` CLI (JSON for the PR,
  GraphQL `HEAD_REF_FORCE_PUSHED` timeline events for versions). Without `gh`,
  public PRs still work via `git fetch origin refs/pull/N/head`.
- Replaying a historical version fetches that version's head SHA; versions
  GitHub no longer serves produce a clear "no longer fetchable" error.

## Consequences

- Requires network + (for private repos) credentials — both are opt-in and
  never automatic; opening a local repository still never touches the network.
- `gh` is not a hard dependency: the app degrades to fetch-only mode.
- Force-push archival depends on GitHub retaining the objects — the app
  observes, it does not archive (spec: "preserving observed PR versions").
