# just-one — agent notes

Load the `just-one-expert` skill before any work in this repo: its wiki
(`.claude/skills/just-one-expert/`) holds how just-one works, its platform traps, and how to test
and release it. This file holds only what every turn needs. Add knowledge to the wiki, not here.

## Never kill a process by image name

Kill only one specific PID taken from a PID file or a spawn result, validated with `isValidPid()`
and verified with `isSameProcessInstance()` first. `taskkill /IM node.exe /F`, `pkill node` and
`killall node` kill every matching process on the machine, IDE servers and other sessions included.

- Windows: `taskkill /PID <pid> /T /F`
- Unix: `kill -TERM -<pid>` (group), `kill -TERM <pid>`
- Tests: record the PID you spawned and clean up by that PID.

Details: wiki `process-killing`, `process-identity`, `testing`.

## Before calling a change done

`npm run validate`, then `npm run build` (commands: README.md § Development).

## Releases

Cut from an up-to-date `main` only. Only `npm run release` pushes; `release:minor` and
`release:major` do not. Follow wiki `release-process`.

## Where things live

User docs: README.md. History: CHANGELOG.md. Everything else: the wiki's `## Pages` in
`.claude/skills/just-one-expert/SKILL.md`.
