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

- `index.ts` - CLI entry point and main handler logic (handleRun, handleKill, handleList, handleStatus, handleKillAll, handleClean, handlePid, handleWait, handleLogs)
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
- **Log capture** - Both modes write to `.log` files; foreground tees via piped streams, daemon uses fd-based stdio
- **Daemon mode** - Detached process with `stdio: ['ignore', logFd, logFd]`
- **Log rotation** - Automatic at spawn time when >10MB (keeps 1 backup as `.log.1`)

**Build output:**

- `dist/index.js` - ESM bundle (main entry)
- `dist/index.d.ts` - TypeScript declarations
- `bin/just-one.js` - Shebang wrapper

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
3. **Verify process identity** (use `isSameProcessInstance()` to check start time matches)
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
- `isSameProcessInstance(pid, mtime)` - Verifies process identity by comparing start times

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
- Foreground mode (`spawnCommand`) can use `shell: true` because it uses piped stdio (not fd-based) and `detached: false` on Windows.
- **Foreground piped stdio + Windows signals:** With `stdio: ['inherit', 'pipe', 'pipe']`, stdin is inherited but stdout/stderr are piped. `CTRL_C_EVENT` may not be delivered to the child, so `setupSignalHandlers` explicitly sends `SIGTERM` when `pipedStdio=true`.
- `spawn()` with `shell: false` still finds executables in PATH via `CreateProcess` on Windows.

## PID Reuse Protection

The tool verifies process identity before killing by comparing:

- PID file modification time (when we wrote the PID)
- Process start time (from OS via pidusage)

If these don't match within 5 seconds, the PID was likely reused by an unrelated process and we skip killing it. This prevents accidentally killing unrelated processes on systems with aggressive PID recycling (common on Windows).

## Common Issues

- **"Port already in use"** - That's what this tool solves! Use `just-one -n myapp -- <cmd>`
- **Process not killed on Windows** - Ensure using `/T` flag to kill tree
- **Orphaned PID file** - Normal behavior; next run will detect and handle
- **E2E tests flaky on Windows** - Increase timeouts (Windows process ops are slower)
- **Windows daemon tests: empty logs** - Caused by `shell: true` + `detached: true` with fd stdio (see Cross-Platform Notes)
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
