# Open-source launch checklist

Everything code-side is done (LICENSE, community files, CI, release pipeline,
tests). These are the human steps between now and "public".

## 1. Create the repository

1. Create a **public** repo on GitHub (e.g. `git_replay`), empty — no README,
   no license (they exist here).
2. **Settings → Actions → General → Workflow permissions → Read and write**
   (required for tauri-action to publish releases).
3. Settings → General → enable **Discussions**.
4. Push:
   ```sh
   git remote add origin https://github.com/<owner>/git_replay.git
   git push -u origin main --tags
   ```

## 2. Replace the placeholders

Search the repo for `<owner>` and replace with your GitHub username:

- `README.md` (badge links, release link)
- `SUPPORT.md` (Discussions link)
- `.github/ISSUE_TEMPLATE/config.yml` (Discussions + docs links)

## 3. Verify the first CI run

The push triggers the CI workflow. Expect to iterate once — it has never run
on GitHub's runners (Linux apt packages, runner quirks). Fix whatever it
reports, then push the `v0.1.0` tag (already exists locally) to trigger the
release workflow, which builds all six installer formats as a draft release.

## 4. Optional but recommended

- **Windows code signing** (Azure Trusted Signing) — removes the SmartScreen
  warning. See `docs/signing.md`.
- **macOS signing + notarization** — removes the Gatekeeper warning. See
  `docs/signing.md`.
- **README screenshot/GIF** — a 10-second recording of the demo replay is the
  single best marketing asset for this kind of product.
- **Social launch note** — the demo fixture (`scripts/make-demo-fixture.sh`)
  is designed exactly for "try it in one click" links.

## 5. Known non-blockers

- macOS builds are ad-hoc signed until Apple secrets exist; the README
  documents right-click-open.
- `gh` is optional (PR mode degrades to fetch-only for public repos).
- Change-map caps and chapter heuristics are documented in the UI and
  `docs/review-2026-08.md`.
