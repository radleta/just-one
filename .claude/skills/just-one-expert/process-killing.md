---
tags: [just-one-expert/process-killing]
summary: "How just-one stops a process: the kill-by-PID checklist, what each kill function does, and the ways taskkill and process groups differ from what their names suggest"
page-kind: reference
---
# Process killing

`CLAUDE.md` holds the hard rule: kill one specific PID, never by image name. This page is how the
code keeps it.

## Checklist for any path that kills

1. Take the PID from a trusted source only: the PID file or a spawn result.
2. Validate it before it reaches a shell command. See [input-validation](input-validation.md).
3. Verify it is the process just-one started. See [process-identity](process-identity.md). A
   process that fails verification is never killed: the handlers report it, delete the PID file and
   move on.
4. From a shell, stop a tracked process with `just-one -k <name>`, not a hand-written `taskkill` or
   `kill`. That path runs steps 2 and 3 for you.

## Which function to call

Every handler kill (`handleKill`, `handleKillAll`, and `handleRun` replacing an instance) goes
through [`process.ts` `terminateProcess`](../../../src/lib/process.ts), whose doc comment gives the
flow. Call it, never `killProcess` or `forceKillProcess` on their own: those two neither wait nor
escalate, and the handlers delete the PID file only once `terminateProcess` returns true.

## What a kill does on each platform

- **Windows.** Every attempt, the first included, is `taskkill /PID <pid> /T /F`. `/F` forces from
  the first call, so a kill has no graceful phase on Windows and `--grace` only sets how long to wait
  for the death. `/T` takes the tree: the command runs under `cmd.exe` (`shell: true`), so without
  `/T` the shell dies and the real server keeps its port. Keep `/T` on every `taskkill`.
- **Unix.** `killProcess` sends SIGTERM to the process group (`-pid`) and falls back to the single
  PID only when the group kill throws. After the grace period `forceKillProcess` sends SIGKILL to
  the group and to the PID. The group kill reaches grandchildren only because
  [`spawnCommand`](../../../src/lib/process.ts) and the Unix branch of `spawnCommandDaemon` spawn
  with `detached: true`, which makes the child a group leader. Keep that flag: a child that leads no
  group has no group numbered by its PID, so the kill falls back to the PID alone and its children
  survive.

Liveness is [`process.ts` `isProcessAlive`](../../../src/lib/process.ts): `tasklist` on Windows,
signal 0 on Unix. The user-facing version of this table is `README.md` § How It Works.
