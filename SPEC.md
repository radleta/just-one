# just-one

A CLI tool that ensures only one instance of a command runs at a time. Kills the previous instance before starting a new one.

## Problem

When developing with dev servers (Storybook, Vite, webpack-dev-server, etc.), you often get:

```
Error: Port 6006 is already in use
```

Existing solutions:

- **kill-port**: Kills ANY process on that port (imprecise, might kill unrelated processes)
- **Manual**: Find PID, kill it, restart (tedious)
- **pm2**: Overkill for dev servers

## Solution

`just-one` tracks processes by name using PID files. When you run a command:

1. Check if a PID file exists for that name
2. If yes, kill that specific process (not just anything on the port)
3. Start the new process
4. Save its PID for next time

## Usage

### Basic usage with npx

```bash
# Run storybook, killing any previous instance named "storybook"
npx just-one --name storybook -- npx storybook dev -p 6006

# Run vite dev server
npx just-one --name vite -- npm run dev

# Shorter alias
npx just-one -n myapp -- node server.js
```

### Just kill a named process

```bash
npx just-one --kill storybook
npx just-one -k myapp
```

### List running processes

```bash
npx just-one --list
npx just-one -l
```

### Specify PID file location

```bash
# Default: ./.just-one/<name>.pid
npx just-one -n storybook -- npx storybook dev

# Custom directory
npx just-one -n storybook --pid-dir /tmp -- npx storybook dev
```

## CLI Options

| Option             | Alias | Description                                                         |
| ------------------ | ----- | ------------------------------------------------------------------- |
| `--name <name>`    | `-n`  | Required for run. Name to identify this process                     |
| `--daemon`         | `-D`  | Run in background (detached)                                        |
| `--no-log`         |       | Disable log file capture in foreground mode                         |
| `--logs <name>`    | `-L`  | View captured logs for a named process                              |
| `--tail`           | `-f`  | Follow log output in real-time (use with `--logs`)                  |
| `--lines <n>`      |       | Number of lines to show (use with `--logs`)                         |
| `--kill <name>`    | `-k`  | Kill the named process and exit                                     |
| `--kill-all`       | `-K`  | Kill all tracked processes                                          |
| `--status <name>`  | `-s`  | Check if a named process is running (exit 0/1)                      |
| `--ensure`         | `-e`  | Only start if not already running (use with `-n`)                   |
| `--pid <name>`     | `-p`  | Print the PID of a named process                                    |
| `--wait <name>`    | `-w`  | Wait for a named process to exit                                    |
| `--timeout <secs>` | `-t`  | Timeout in seconds (use with `--wait`)                              |
| `--grace <secs>`   | `-g`  | Grace period before force kill (default: 5s)                        |
| `--clean`          |       | Remove stale PID files, orphaned log files and abandoned temp files |
| `--list`           | `-l`  | List all tracked processes and their status                         |
| `--pid-dir <dir>`  | `-d`  | Directory for PID files (default: `.just-one/`)                     |
| `--quiet`          | `-q`  | Suppress output                                                     |
| `--help`           | `-h`  | Show help                                                           |
| `--version`        | `-v`  | Show version                                                        |

## How It Works

### PID File Management

```
.just-one/
  storybook.pid    # 12345
  vite.pid         # 67890
                   # startTime=1788887025388
```

Line 1 is the PID alone. Any following lines are `key=value` records of the
process's identity, used to detect PID reuse: `startTicks=` on Linux,
`startTime=` on Windows and macOS. Linux and macOS write theirs at spawn, where
reading the value is cheap; Windows records its own the first time the PID file
is verified, because reading it there costs a subprocess. A file carrying no
such line is read as a legacy record.

### Process Lifecycle

```
Start:
1. Read .just-one/<name>.pid
2. If exists, kill that PID (with children)
3. Spawn the command
4. Write new PID to file
5. Forward stdio

Stop (Ctrl+C):
1. Forward SIGINT/SIGTERM to child
2. Keep PID file (intentional - handles orphans on next run)

Kill (--kill):
1. Read PID file
2. Kill process
3. Delete PID file
```

### Cross-Platform

| Platform | Kill Command                                                      |
| -------- | ----------------------------------------------------------------- |
| Windows  | `taskkill /PID <pid> /T /F` (kills tree)                          |
| Unix     | `kill -SIGTERM -<pid>` (process group) then `kill -SIGTERM <pid>` |

## Examples

### package.json scripts

```json
{
  "scripts": {
    "storybook": "just-one -n storybook -- storybook dev -p 6006",
    "dev": "just-one -n vite -- vite",
    "dev:api": "just-one -n api -- node server.js",
    "stop": "just-one -k storybook && just-one -k vite && just-one -k api"
  }
}
```

### CI/CD - ensure clean state

```bash
# Kill any leftover dev servers before running tests
npx just-one -k storybook 2>/dev/null || true
npx just-one -k vite 2>/dev/null || true
npm test
```

### Multiple named instances

```bash
# Run two storybooks on different ports
npx just-one -n storybook-main -- storybook dev -p 6006
npx just-one -n storybook-docs -- storybook dev -p 6007
```

## Comparison with Alternatives

| Feature                | just-one       | kill-port    | pm2          |
| ---------------------- | -------------- | ------------ | ------------ |
| Kills by PID (precise) | Yes            | No (by port) | Yes          |
| Cross-platform         | Yes            | Yes          | Yes          |
| Zero config            | Yes            | Yes          | No           |
| Remembers processes    | Yes (PID file) | No           | Yes (daemon) |
| Lightweight            | ~150 LOC       | ~100 LOC     | Heavy        |
| Daemon required        | No             | No           | Yes          |
| npx friendly           | Yes            | Yes          | No           |

## Technical Details

### Dependencies

One runtime dependency, [pidusage](https://github.com/soyuka/pidusage), which
reports a process's start time cross-platform. It is used to verify process
identity before killing, and on the platforms that record their own evidence
(`/proc` on Linux, `ps -o lstart` on macOS) only as the fallback path.

Everything else is a Node.js built-in:

- `child_process` (spawn, execSync, execFileSync)
- `fs` (read/write/stat/rename/utimes, directory listing)
- `path` (join, dirname, basename)
- `process` (platform, kill, on)

### Node.js Version

Requires Node.js >= 20.0.0 (for stable ES modules)

### Exit Codes

| Code | Meaning                                      |
| ---- | -------------------------------------------- |
| 0    | Success (or child exited with 0)             |
| 1    | Error (invalid args, spawn failed, etc.)     |
| 1    | `--status`: not running. `--wait`: timed out |
| \*   | Child's exit code (passed through)           |

## Edge Cases

### Orphaned processes

If the parent dies unexpectedly (terminal closed, machine crash), the PID file remains. On next run, `just-one` will attempt to kill that PID. If the process is already dead, the kill fails silently and continues.

### PID reuse

On long-running systems, PIDs can be reused, so a tracked PID may belong to an
unrelated process by the time `just-one` acts on it. Before killing, the tracked
process's identity is verified: exactly against the recorded start ticks on
Linux or the recorded start time on Windows and macOS, and otherwise by
comparing the PID file's modification time against the process's start time
within a tolerance.
A process that fails verification is never killed, and the rejection message
names which comparison produced it — or says the start time could not be read,
where no comparison was possible.

### Concurrent starts

If two `just-one` commands with the same name start simultaneously, there's a race condition. First one wins, second one might kill the first. This is rare in practice and acceptable for dev tooling.

## File Structure

```
just-one/
  src/
    index.ts           # Handler logic, exported as a pure main()
    cli.ts             # CLI entry point (calls main(), handles process exit)
    lib/
      cli.ts           # Argument parsing and validation
      pid.ts           # PID file operations
      process.ts       # Process spawn/kill
      log.ts           # Log file read/write/rotate/tail
      *.test.ts        # Unit tests, beside the module they cover
    e2e/
      cli.e2e.test.ts  # End-to-end tests
  bin/
    just-one.js        # Shebang wrapper
    daemon-helper.js   # Windows daemon-mode wrapper
  dist/
    cli.js             # Compiled CLI entry point
    index.js           # Compiled library export
    index.d.ts         # TypeScript declarations
  package.json
  README.md
  LICENSE
```

## Prior Art

- [kill-port](https://www.npmjs.com/package/kill-port) - Kill by port number
- [terminate](https://www.npmjs.com/package/terminate) - Kill PID with children
- [fkill](https://www.npmjs.com/package/fkill) - Cross-platform process killer
- [pm2](https://www.npmjs.com/package/pm2) - Full process manager
- Linux `run-one` command - Similar concept for bash scripts

## License

MIT
