---
tags: [just-one-expert/windows-daemon]
summary: "Why the Windows daemon is started through a helper and `CreateProcessW` with no inherited handles, what happens when that launch falls back, and when to retire it"
page-kind: reference
---
# Windows daemon

`just-one -D` on Windows is a chain of two launches. What each file does is in its own header:

1. [`process.ts` `spawnCommandDaemon`](../../../src/lib/process.ts) starts
   `node bin/daemon-helper.js <logPath> <command> <args>` through
   [`windows-spawn.ts` `spawnDetachedWithoutInheritance`](../../../src/lib/windows-spawn.ts).
2. [`bin/daemon-helper.js`](../../../bin/daemon-helper.js) starts the real command with
   `shell: true` and piped stdio, and pipes the output to the log file.

Foreground mode and the Unix daemon are [spawn-and-signals](spawn-and-signals.md).

## Keep the helper

- Never start a Windows daemon with `shell: true` + `detached: true` + fd-based stdio. `cmd.exe`
  does not pass inherited file descriptors on to the grandchild, so the log file is created and
  stays empty. The helper header gives the mechanism.
- The helper needs `shell: true` to resolve `.cmd` wrappers, and every npm binary on Windows is one.
  Do not "simplify" the chain into a direct spawn of the command.

## Handle isolation

The helper is launched with no inherited handles because libuv's `CreateProcessW` always inherits
them, which leaves a caller's `| tail` (or a CI step, or an agent reading output) waiting until the
daemon stops. The `windows-spawn.ts` header owns the mechanism and the launch flags.

- **Fallback.** Any throw from the isolated launch (koffi missing, `CreateProcessW` failing) falls
  back to Node's `spawn` with `detached: true, stdio: 'ignore', env: process.env`, and
  `spawnCommandDaemon` returns `isolationFallback`. `handleRun` prints it as a one-line warning
  through `logError`, which ignores `--quiet`, so the warning always shows. The warning text is
  user-facing and quoted in `README.md` § Daemon Mode.
- **No opt-out.** There is deliberately no flag to skip isolation. Do not add one.
- **koffi** stays an `optionalDependencies` entry, loaded lazily with `createRequire` inside
  `bindWin32` (its comment gives the reason). It is never bundled: the built `dist/` chunk still
  calls `createRequire(import.meta.url)("koffi")` at run time. A top-level import would make every
  platform, and every install without optional dependencies, fail to load just-one.

## Retiring it

Delete `windows-spawn.ts`, and the koffi dependency with it, once a released Node carries
[libuv#5100](https://github.com/libuv/libuv/pull/5100), which does the same launch upstream (the
file header says so). Keep the helper: it solves the `.cmd` and empty-log problems, which #5100 does
not touch.

The regression test for the leak is described on [testing](testing.md).
