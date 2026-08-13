## What & why

<!-- What does this change do, and why is it the right way to do it? Link any related issues. -->

## Testing

<!-- How was this verified?

- [ ] `cargo test` in `apps/desktop/src-tauri` (44 engine tests)
- [ ] `npm test` in `apps/desktop` (vitest)
- [ ] `npm run build` (typecheck + bundle)
- [ ] Manually exercised in the app
-->

## Screenshots / recordings (UI changes)

<!-- Before/after where relevant. -->

## Checklist

- [ ] New git-parsing code has a fixture test pinning the byte format it targets
- [ ] Core functionality still works offline
- [ ] Raw git history is never silently hidden or rewritten
- [ ] Docs updated where behavior or architecture changed
