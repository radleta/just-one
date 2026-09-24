---
tags: [just-one-expert/repo-tooling]
summary: "The local and CI tooling around a commit: husky's hooks path, the pre-commit guards, what lint-staged and prettier touch (wiki pages included), and what CI checks"
page-kind: reference
---
# Repo tooling

## Git hooks

- husky sets `core.hooksPath` to `.husky/_` (through `package.json` `prepare: husky`), so nothing in
  `.git/hooks/` ever runs. Put a hook in `.husky/<hook>`.
- [`.husky/pre-commit`](../../../.husky/pre-commit) refuses a commit that stages `coverage/` or
  `node_modules/`, then runs lint-staged.

## Formatting

- lint-staged (`package.json` `lint-staged`) runs prettier on staged `*.{json,md,yml,yaml}` at any
  depth, and eslint plus prettier on `*.ts`.
- `.claude/` is in [`.prettierignore`](../../../.prettierignore) because the wiki tooling owns the
  format of these pages: prettier would realign their tables and rewrite the fenced `## Pages`
  region that `wiki-write` generates. Keep that entry.
- `npm run format:check`, which CI runs, globs only `src/**/*.ts` and root-level
  `*.{json,md,yml,yaml}`, and `npm run lint` covers only `src`. A slip in `bin/` or `scripts/` is
  not caught by CI; format and check those by hand.

## CI

[`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) owns the platform and Node matrix. It
runs only on a push or pull request to `main`, so commits on `develop` are not CI-tested until the
pull request opens. Run `npm run validate` locally before pushing `develop`. Releases are
[release-process](release-process.md).
