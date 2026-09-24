---
tags: [just-one-expert/spawn-and-signals]
summary: "Foreground versus daemon stdio, log capture and rotation, environment inheritance on every spawn path, and how Ctrl+C reaches a child on each platform"
page-kind: reference
---
# Spawn and signals

The spawn functions are [`process.ts` `spawnCommand`](../../../src/lib/process.ts) (foreground) and
`spawnCommandDaemon` (daemon). Their doc comments own the stdio choice for each mode. The Windows
daemon has its own page, [windows-daemon](windows-daemon.md), because its constraints are the
opposite of foreground mode's.

## Foreground versus daemon

- Foreground with logging pipes stdout/stderr and tees them to the terminal and the log file.
  `--no-log` inherits stdio instead. Foreground may use `shell: true` on Windows because its stdio
  is piped or inherited, never fd-based, and it is not detached there.
- The Unix daemon hands the log file's fd straight to the child
  (`stdio: ['ignore', logFd, logFd]`, `detached: true`). That is safe on Unix and is exactly what
  breaks on Windows.

## Environment inheritance

Every daemon spawn passes `env: process.env` explicitly: the Unix branch of `spawnCommandDaemon`,
its Windows fallback `spawn`, and the command spawn in
[`bin/daemon-helper.js`](../../../bin/daemon-helper.js). The `CreateProcessW` launch passes a NULL
environment block instead, which inherits just-one's live environment. Any new spawn path does the
same. What it guards: a daemon that lost the caller's PATH additions (npm scripts, nvm, pyenv, a
venv) fails to find its command.

## Log capture and rotation

- Both modes write `<pid-dir>/<name>.log`. Rotation runs once, in `handleRun`, before the spawn:
  [`log.ts` `rotateLogIfNeeded`](../../../src/lib/log.ts) against `DEFAULT_MAX_LOG_SIZE`, keeping one
  `.log.1` backup. A running process's log is never rotated underneath it.
- Every log writer swallows its stream's `error` event (`spawnCommand` and the helper both do, and
  their comments say why). A new log writer does the same, or a removed directory or full disk
  crashes the process that owns the child.

## Ctrl+C and exit codes

- [`process.ts` `setupSignalHandlers`](../../../src/lib/process.ts) forwards signals in foreground
  mode; its doc comment owns the Windows case, where piped stdio (log capture on) may keep
  `CTRL_C_EVENT` from reaching the child, so it sends SIGTERM explicitly, with a force-kill after
  `WINDOWS_GRACEFUL_TIMEOUT_MS`. `--no-log` changes which path a Windows child's Ctrl+C takes; test
  both when you touch it. The user-facing description is `README.md` § How It Works (the
  cross-platform details).
- A child killed by a signal exits just-one with `128 + n`. The same mapping (SIGTERM 15, SIGINT 2,
  anything else 1) is written twice, in `setupSignalHandlers` and in the helper's `close` handler.
  Change both together. The user-facing exit codes are `README.md` § Exit Codes.
