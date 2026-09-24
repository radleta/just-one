---
name: just-one-expert
description: "Everything learned about just-one, the single-instance process CLI in this repo: its design and the decisions behind it, how it behaves on Windows, macOS and Linux, its tests, tooling, CI and release process, and the traps found along the way. Use for any work in this repo — code, tests, docs, CI, releases, or answering how just-one works — even when the change looks small or unrelated to what the wiki already covers."
wiki: true
---

<role>
  <identity>just-one expert</identity>
  <purpose>Hold what has been learned about just-one that the code and docs do not say on their own, so no future session in this repo has to rediscover it.</purpose>
</role>

## Pages
<!-- Pages are listed below, one bullet per page: a markdown link to the page
     file, an em dash, then that page's one-line summary. wiki-write writes
     them into the fenced region on every write. -->
<!-- BEGIN:PAGES -->
- [process-killing](process-killing.md) — How just-one stops a process: the kill-by-PID checklist, what each kill function does, and the ways taskkill and process groups differ from what their names suggest
- [process-identity](process-identity.md) — How a tracked PID is proven to be the same process before any kill: evidence per platform, the mtime fallback and its WSL2 failure, verdict semantics, and when evidence gets recorded
- [pid-file](pid-file.md) — The PID file as a shared on-disk contract: its format rules, atomic write and orphaned `.tmp` reclaim, mtime preservation, compatibility with older just-one versions, and the accepted same-name race
- [windows-daemon](windows-daemon.md) — Why the Windows daemon is started through a helper and `CreateProcessW` with no inherited handles, what happens when that launch falls back, and when to retire it
- [spawn-and-signals](spawn-and-signals.md) — Foreground versus daemon stdio, log capture and rotation, environment inheritance on every spawn path, and how Ctrl+C reaches a child on each platform
- [architecture](architecture.md) — Where code goes and why: pure logic in `src/lib` behind the coverage gate, the import direction between `pid.ts` and `process.ts`, the pure library entry versus the CLI entry, and what `bin/` wraps
- [input-validation](input-validation.md) — What must be validated before a value reaches a shell command or a file path, and where each check lives
- [testing](testing.md) — How to test just-one without harming the machine or fooling yourself: PID-scoped cleanup, Windows e2e traps, the PowerShell pipe-leak test, testing a published version, and smoke-testing the CLI by hand
- [release-process](release-process.md) — Cutting a release: from `main` only, pull first, which script pushes and which does not, what the release workflow rejects, and which warnings are expected
- [repo-tooling](repo-tooling.md) — The local and CI tooling around a commit: husky's hooks path, the pre-commit guards, what lint-staged and prettier touch (wiki pages included), and what CI checks
<!-- END:PAGES -->

## Meta
- [Schema](schema.md) — Wiki conventions and page-type definitions

## Foundational Principles

- Every file in the repo has one job and every fact lives in one place: see
  [schema.md § Where knowledge lives](schema.md).
- Public repo: no private repos, projects, people, or `scratch` paths on any page.
