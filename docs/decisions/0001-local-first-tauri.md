# ADR-0001: Local-first Tauri desktop architecture

**Status:** accepted
**Date:** 2026-08-13

## Context

The product replays the evolution of local Git repositories. Source code can be
sensitive, repositories can be huge, and Git is already local. The spec explicitly
forbids a conventional backend for core functionality ("Do not add a Node/Nest backend
unless a concrete requirement appears"; "Do not use Postgres for local Git history").

## Decision

Desktop app on **Tauri v2**: React + TypeScript frontend, Rust engine, system Git CLI.
No HTTP server, no remote backend, no Postgres. The Rust layer is the "backend", spoken
to over Tauri IPC commands.

## Consequences

- Core replay is fully offline; nothing is ever uploaded (privacy invariant).
- Web Workers are used only for presentation processing, per spec.
- A future web client can reuse the replay UI against a different data adapter; the
  current package boundary (typed domain models in the Rust layer, UI-only stores)
  keeps that option open without building the web app now.
