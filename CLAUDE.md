# just-one - Developer Guide for Claude

## CLAUDE.md Documentation Standards

**Critical: Token-Conscious Documentation**

- Be concise and instructional, not exhaustive
- No duplicate content across sections
- Minimal examples, only when essential
- CLAUDE.md is for instructions, not code dumps

**This file is for developers working ON the CLI tool, not users.**

## Project Purpose

**CLI tool** that ensures only one instance of a command runs at a time. Tracks processes by name using PID files. Kills the previous instance before starting a new one. Verifies process identity before killing to prevent PID reuse accidents.

## Architecture Quick Reference

**Source files** (`src/`):

- `index.ts` - Main handler logic and pure library export (handleRun, handleKill, handleList, handleStatus, handleKillAll, handleClean, handlePid, handleWait, handleLogs)
- `cli.ts` - CLI entry point (imports `main()` from index.ts, calls it, handles process exit)
- `lib/cli.ts` - Command-line argument parsing and validation
- `lib/process.ts` - Process spawn/kill/management logic (CRITICAL - see safety section)
- `lib/pid.ts` - PID file read/write/delete/list operations
- `lib/log.ts` - Log file operations (read, write, rotate, tail) for both foreground and daemon modes

**Test files:**

- `lib/cli.test.ts` - Unit tests for CLI parsing
- `lib/pid.test.ts` - Unit tests for PID operations
- `lib/process.test.ts` - Unit tests for process management
- `lib/log.test.ts` - Unit tests for log file operations
- `e2e/cli.e2e.test.ts` - End-to-end integration tests

**Key patterns:**

- **Pure function extraction** - Business logic in `lib/*.ts` (testable without mocking)
- **Cross-platform** - Windows uses `taskkill`, Unix uses `process.kill()`
- **PID validation** - All PIDs validated before shell interpolation
- **Log capture** - Both modes write to `.log` files; foreground tees via piped streams, daemon uses fd-based stdio (Unix) or piped-via-helper (Windows)
- **Daemon mode** - Unix: detached process with `stdio: ['ignore', logFd, logFd]`; Windows: detached `daemon-helper.js` wrapper with `shell: true` + piped stdio (resolves `.cmd` wrappers)
- **Log rotation** - Automatic at spawn time when >10MB (keeps 1 backup as `.log.1`)

**Build output:**

- `dist/cli.js` - CLI entry point (calls `main()`, handles exit)
- `dist/index.js` - Library export (pure, no side effects)
- `dist/index.d.ts` - TypeScript declarations
- `bin/just-one.js` - Shebang wrapper (imports `dist/cli.js`)
- `bin/daemon-helper.js` - Windows daemon mode wrapper (spawned by `spawnCommandDaemon`)

## CRITICAL: Process Killing Safety Guidelines

**NEVER kill processes by image name. ALWAYS kill by specific PID.**

### Safe Patterns (ALWAYS use these):

```bash
# Windows - kill specific PID and its process tree
taskkill /PID 1234 /T /F

# Unix - kill process group or specific PID
kill -TERM -1234  # process group (negative PID)
kill -TERM 1234   # specific process
```

### DANGEROUS Patterns (NEVER use these):

```bash
# DANGEROUS - kills ALL node.exe processes system-wide
taskkill /IM node.exe /F

# DANGEROUS - kills all matching processes
pkill node
killall node
```

### Why This Matters

Running `taskkill /IM node.exe /F` will kill EVERY node process on the machine, including:

- Other developers' processes on shared machines
- IDE language servers
- Build tools
- Unrelated applications

### Safe Process Management Checklist

1. **Always get PID from a trusted source** (PID file, spawn result)
2. **Validate PID before killing** (use `isValidPid()` from `process.ts`)
3. **Verify process identity** (use `isSameProcessInstance()` — exact start-tick match on Linux, exact start-time match on Windows and macOS, mtime comparison elsewhere)
4. **Use project's built-in mechanisms** (`just-one -k <name>`)
5. **In tests, store PIDs when spawning** and clean up using those specific PIDs

### Code Reference

The safe implementation is in `src/lib/process.ts`:

- `terminateProcess(pid, graceMs?)` - SIGTERM → wait grace period → SIGKILL escalation (preferred)
- `killProcess(pid)` - Sends SIGTERM to specific PID only
- `forceKillProcess(pid)` - Sends SIGKILL to specific PID (last resort)
- `isProcessAlive(pid)` - Checks if specific PID is running
- `isValidPid(pid)` - Validates PID range 1-4194304
- `getProcessStartTime(pid)` - Gets process start time via pidusage
- `getProcessStartTicks(pid)` - Gets start ticks from `/proc/<pid>/stat` (Linux only, null elsewhere)
- `getProcessLstart(pid)` - Gets the absolute start time from `ps -o lstart` in ms (macOS only, null elsewhere)
- `isSameProcessInstance(pid, mtime, evidence?)` - Verifies process identity, returning `{ same, basis, deltaMs? }` rather than a bare boolean. `basis` is `'ticks' | 'startTime' | 'mtime' | 'unreadable' | 'noPidFile'`; the last two mean nothing was compared — the process's start time could not be read, or the PID file could not be stat'd. `noPidFile` comes only from `isTrackedInstance`'s early return, never from `isSameProcessInstance`. `deltaMs` appears only on an mtime rejection. Never infer identity from `basis` — `same` is the decision

## Development Workflow

**Setup:**

```bash
git clone → npm install → npm run build
```

**Change cycle:**

```bash
# Edit src/ files
npm run validate  # lint + typecheck + test
npm run build     # build bundle
```

**Test the CLI locally:**

```bash
npm run build
# Windows: use ping for long-running process
node bin/just-one.js -n test -- ping -n 60 127.0.0.1
# Unix: use sleep
node bin/just-one.js -n test -- sleep 60

node bin/just-one.js -l  # list running
node bin/just-one.js -k test  # kill it
```

## Testing Strategy

**Unit tests** - Pure function testing without process spawning

- `cli.test.ts` - Argument parsing, validation, security (path traversal)
- `pid.test.ts` - PID file CRUD, error handling
- `process.test.ts` - Process operations with mocking

**E2E tests** (`e2e/cli.e2e.test.ts`) - Real process spawn/kill cycles

- Spawns actual long-running processes
- Tests process replacement (kill old, start new)
- Tests orphaned PID file handling
- Windows-specific timing adjustments

**Key commands:**

```bash
npm test           # Run tests once
npm run test:watch # Watch mode
npm run test:coverage # With coverage report (80% threshold)
```

**E2E Test Process Cleanup Pattern:**

```typescript
// Store PID when spawning
const child = spawn(...);
const pid = child.pid;

// In afterEach or finally block
try {
  if (process.platform === 'win32') {
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'pipe' });
  } else {
    process.kill(pid);
  }
} catch {
  // Process might already be dead
}
```

## Release Workflow

**Pre-release:**

```bash
npm run release:prepare  # validate + build + verify:package + size:check
```

**Release (uses standard-version for automatic changelog):**

```bash
npm run release          # Auto-bump based on conventional commits
npm run release:minor    # Force minor version bump
npm run release:major    # Force major version bump
# postrelease hook auto-pushes commits and tags
```

**GitHub Actions:**

- `.github/workflows/ci.yml` - Multi-platform testing
- `.github/workflows/release.yml` - Automated npm publish on tag push

## npm Scripts Reference

| Script                    | Purpose                                        |
| ------------------------- | ---------------------------------------------- |
| `npm run dev`             | Watch mode (tsup)                              |
| `npm run build`           | Production build                               |
| `npm test`                | Run tests                                      |
| `npm run validate`        | lint + typecheck + test                        |
| `npm run release:prepare` | Full pre-release validation                    |
| `npm run release`         | Bump version + update CHANGELOG + commit + tag |

## Key Metadata

- **Repo:** github.com/radleta/just-one
- **Package:** `just-one`
- **Author:** Richard Adleta
- **License:** MIT
- **Engines:** Node 20+
- **Dependencies:** [pidusage](https://github.com/soyuka/pidusage) (cross-platform process metrics for PID verification)

## Cross-Platform Notes

| Platform | Kill Method                     | Check Alive                    |
| -------- | ------------------------------- | ------------------------------ |
| Windows  | `taskkill /PID ${pid} /T /F`    | `tasklist /FI "PID eq ${pid}"` |
| Unix     | `process.kill(-pid, 'SIGTERM')` | `process.kill(pid, 0)`         |

- Windows: `/T` flag kills process tree (children)
- Unix: Negative PID kills process group
- Both use SIGTERM for graceful shutdown (not SIGKILL)

**IMPORTANT: Daemon mode spawn on Windows:**

- **NEVER** use `shell: true` + `detached: true` with fd-based stdio — `cmd.exe` doesn't pass inherited file descriptors to grandchild processes (known Node.js issue). Log files will be created but stay empty.
- **Daemon mode uses a helper wrapper** (`bin/daemon-helper.js`): the parent spawns `node daemon-helper.js <logPath> <command> <args>` with `detached: true, stdio: 'ignore', env: process.env`. The helper then spawns the real command with `shell: true` + piped stdio + `env: process.env`, piping output to the log file. This resolves `.cmd` wrappers (every npm binary on Windows) while avoiding the fd-based stdio limitation.
- **Environment inheritance** — All daemon spawn calls (both platforms) explicitly pass `env: process.env` to ensure the detached child inherits the caller's full environment (PATH, custom vars, etc.). Without this, commands that depend on PATH augmentation (npm scripts, nvm, pyenv, venv) may fail in daemon mode.
- Foreground mode (`spawnCommand`) can use `shell: true` because it uses piped stdio (not fd-based) and `detached: false` on Windows.
- **Foreground piped stdio + Windows signals:** With `stdio: ['inherit', 'pipe', 'pipe']`, stdin is inherited but stdout/stderr are piped. `CTRL_C_EVENT` may not be delivered to the child, so `setupSignalHandlers` explicitly sends `SIGTERM` when `pipedStdio=true`.

## PID Reuse Protection

The tool verifies process identity before killing it, so a recycled PID belonging to an unrelated process is never killed.

**Linux (preferred):** `writePid` records the process's start ticks (field 22 of `/proc/<pid>/stat`) in the PID file next to the PID, and `isSameProcessInstance` compares them exactly. Ticks count from boot, so they are immune to wall-clock jumps.

**Windows:** `startTime=` records pidusage's start time in integer milliseconds, compared exactly. On Windows that value reduces to the OS-reported `creation.getTime()`, measured stable across repeated reads and identical between the `wmic` and `gwmi` backends, so an exact comparison is safe on either.

**macOS:** `startTime=` records `ps -o lstart` parsed to epoch ms, compared exactly. `lstart` is the process's absolute start recorded at fork — whole seconds, but byte-identical on every read and unchanged across sleep/wake (verified: `launchd` still reports boot time after 12 days of uptime). It is not pidusage's value: pidusage's `ps` backend derives the start from `etime` minus a moving timestamp, measured here at 945 ms of spread across 20 reads, so that value can never be compared exactly. `getProcessLstart` pins `TZ=UTC` and `LC_ALL=C` because `ps` formats the field with strftime — without them the value shifts when the machine changes timezone and stops parsing under a non-English locale (`de_DE` renders it `Mi. 9 Sep. 08:32:33 2026`). A `ps` call costs 3.5 ms, cheap enough to record at spawn rather than lazily as Windows does. Residual gap: two processes that start in the same wall-clock second are indistinguishable, so the reuse window is ≤1 s rather than ≤5 s.

**BSD/other, and legacy bare-PID files:** falls back to comparing the PID file's mtime against the process start time from pidusage, with a 5 s tolerance.

The fallback is unreliable wherever the wall clock and the uptime clock diverge. On WSL2 a host suspend freezes `/proc/uptime` while the wall clock keeps running, so pidusage's `timestamp - elapsed` drifts hours later than the real start and every live daemon reads as foreign — `-e` spawns duplicates, `-k`/`-s` refuse the daemon they started. The recorded evidence exists to close that hole.

**PID file format:** first line is the PID; optional following lines are `key=value`. Two evidence keys are defined — `startTicks=` (Linux) and `startTime=` (Windows, macOS) — and at most one is written per file. A `startTime=` value must be read back through the source that wrote it (`getProcessLstart` on macOS, pidusage elsewhere); crossing them compares whole seconds against milliseconds and never matches. `readPidRecord` parses both this and the legacy bare-PID form, tolerates CRLF, ignores unknown keys, and treats a non-numeric value as absent.

**Rejection diagnostics:** the three rejection messages (`handleKill`, `handleRun`'s stale-PID branch, `handleStatus`) compose from the verdict via `describeRejection`, which lives beside the verdict in `lib/process.ts` and is imported by `index.ts` — it sits there so every basis's message is provable inside the `src/lib/**` coverage gate without exporting anything from the published entry point. An evidence rejection says the recorded start does not match; an mtime rejection reports the measured delta and deliberately does **not** claim a different process, because it cannot establish one — a multi-hour delta is the WSL2 clock signature. An `unreadable` rejection (`getProcessStartTime` returned `null`, on either the recorded-`startTime` path or the mtime path) claims neither: it says the start time could not be read, since asserting a difference would name a comparison that never ran. A `noPidFile` rejection — `isTrackedInstance` could not stat the PID file — says that instead, because the two name different missing things and a reader told the wrong one looks in the wrong place.

**Evidence recording:** when a legacy bare-PID file verifies successfully, `recordIdentityEvidence` (async) records ticks on Linux, `lstart` on macOS, or the pidusage start time on Windows, in place, so later checks use the exact comparison — a process started by an older version becomes drift-proof without a restart. It no-ops on every other platform. It only fires on paths where the PID file survives (`-s`, `-pid`, and the `-e` skip branch), never right before a kill. Recording is lazy on Windows by design: reading the start time there costs a `wmic`/PowerShell subprocess, which must stay off the spawn path `-e` runs every invocation. Linux and macOS record at spawn instead — a `/proc` read and a 3.5 ms `ps` call — so on those platforms this function only upgrades files an older version left bare.

`writeIdentityEvidence` restores the file's mtime via `utimesSync` afterwards: an older just-one sharing the same PID dir still verifies by mtime, and bumping it would make live processes look stale to that version. Pass float seconds, not `Date` objects — `Date` truncates to whole milliseconds. The restore is not bit-exact on APFS: float seconds near 1.8e9 exhaust a double's digits before APFS's sub-microsecond tail, so the macOS e2e test asserts the mtime survives to within 1 ms rather than exactly.

**Atomic writes:** `writePid` writes to a `.tmp` sibling and `renameSync`s it into place, so a concurrent reader — an older just-one included — never `parseInt`s a truncated first line. The mtime restoration runs on the final path, after the rename.

A write interrupted between the two calls leaves `<name>.pid.<writerPid>.tmp` behind, and every other path filters on `.pid`. `--clean` reclaims one whose embedded writer PID is dead (`listTempPidFiles` / `deleteTempPidFile` in `pid.ts`) and spares one whose writer is alive, since that is a write in flight rather than litter. `pid.ts` cannot run the liveness check itself — `process.ts` imports it, so the import cannot go the other way — which is why the writer PID comes back with each entry and `handleClean` filters.

**Compatibility, both directions (verified against a real 1.4.2 install):** an old version reads a new file correctly, because its `parseInt` stops at the newline; a new version reads a legacy file and falls back to the mtime path. A shared PID dir with mixed versions is safe.

**Do not prove cross-version compatibility with `JUST_ONE_NPX=1 JUST_ONE_CLI=@radleta/just-one@<v> npx vitest run src/e2e/`.** When `<v>` equals the version in the local `package.json`, npx resolves the workspace build and the run silently tests the current code against itself — it passed 79/79 while the published 1.4.2 actually fails 6 of them. Install the published tarball into a temp dir and point `JUST_ONE_CLI` at its `bin/just-one.js` by absolute path instead. `npm run test:npm` honors an inherited `JUST_ONE_CLI` (`${JUST_ONE_CLI:-@radleta/just-one}`) and otherwise tests `latest`. It still forces `JUST_ONE_NPX=1`, so it cannot take the absolute-path route above — use a bare `vitest run src/e2e/` with `JUST_ONE_CLI` set for that.

## Common Issues

- **"Port already in use"** - That's what this tool solves! Use `just-one -n myapp -- <cmd>`
- **Process not killed on Windows** - Ensure using `/T` flag to kill tree
- **Orphaned PID file** - Normal behavior; next run will detect and handle
- **Orphaned `.pid.<pid>.tmp` file** - Left by a `writePid` killed between its write and its rename; `just-one --clean` removes it once its writer PID is dead
- **E2E tests flaky on Windows** - Increase timeouts (Windows process ops are slower)
- **Daemon loses caller's environment (PATH, etc.)** - Was caused by daemon spawn calls not explicitly passing `env: process.env`; now fixed — all daemon spawn paths (both platforms + daemon-helper.js) explicitly inherit the caller's environment
- **Windows daemon tests: empty logs** - Was caused by `shell: true` + `detached: true` with fd stdio; now fixed via daemon-helper.js wrapper (see Cross-Platform Notes)
- **Windows file locking in test cleanup** - Kill tracked daemon processes before `rmSync`; use retry logic for directory removal
- **Windows `cmd.exe` quoting** - Avoid `node -e 'console.log("...")'` in tests; write helper `.js` scripts to disk instead
- **`fs.watchFile` unreliable on CI** - Use `setInterval` + `statSync` polling instead (libuv may skip poll intervals under load)

## Security Considerations

**Input validation in `cli.ts`:**

- Names: No `/`, `\`, or `..` (path traversal prevention)
- PID directory: No `..` sequences
- Max lengths enforced (255 for names, 1024 for paths)

**PID validation in `process.ts`:**

- Range: 1 to 4,194,304 (max PID on most systems)
- Integer check prevents command injection

---

**Remember:** This is developer context for building the CLI tool. For usage docs, see README.md.
