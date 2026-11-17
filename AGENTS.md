# Development conventions

This public checkout is the sole development directory. Make all subsequent
changes here and push reviewed commits to this repository. Never replace this
checkout with another export.

- NexusDownload is a portable Windows download manager built with Electron,
  React, TypeScript and aria2. Use pnpm and the checked-in lockfile.
- Keep core modules host-neutral. The renderer uses shared transport contracts;
  shared modules contain pure types, schemas and data without IO.
- Put product core modules in `src/core/nexus/` and routes in
  `src/renderer/routes/nexus-*/`. Use protocol constants and semantic icons.
- Follow `design/final/DESIGN.md`, including its concise wording rules.
  Translate user-facing copy in all 26 catalogs and preserve placeholders.
- Never log or commit credentials, signed download URLs or private account data.
- Do not modify `website/` unless the task explicitly includes it.
- Before every commit run `pnpm run check:boundaries`, `pnpm run lint`,
  `pnpm exec tsc --noEmit` and relevant tests. Locale changes also require
  `pnpm run check:i18n`; new files require `pnpm run check:file-names`.
- Inspect staged changes and run `git diff --cached --check` before committing.
- Use Chinese commit messages. Keep generated screenshots and test output ignored.
- Publish matching version tags through the release workflow. Verify downloaded
  release checksums and portable startup. Retain only the latest local package
  and remove temporary extracted applications after testing.
