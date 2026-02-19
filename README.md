# just-one

[![npm version](https://img.shields.io/npm/v/@radleta/just-one)](https://www.npmjs.com/package/@radleta/just-one)
[![CI](https://github.com/radleta/just-one/actions/workflows/ci.yml/badge.svg)](https://github.com/radleta/just-one/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@radleta/just-one)](LICENSE)
[![node](https://img.shields.io/node/v/@radleta/just-one)](package.json)

A CLI tool that ensures only one instance of a command runs at a time. Tracks processes by name using PID files, kills the previous instance before starting a new one, and verifies process identity to prevent PID reuse accidents.

**Quick start:**

```bash
npx @radleta/just-one -n dev -- npm run dev
```

> The `--` separator tells `just-one` where its own options end and your command begins.

## Table of Contents

- [Motivation](#motivation)
- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [CLI Options](#cli-options)
- [package.json Scripts](#packagejson-scripts)
- [How It Works](#how-it-works)
- [Use Cases](#use-cases)
- [Comparison](#comparison)
- [Programmatic Usage](#programmatic-usage)
- [Requirements](#requirements)
- [Development](#development)
- [Contributing](#contributing)
- [Changelog](#changelog)
- [License](#license)

## Motivation

When developing with dev servers (Storybook, Vite, webpack-dev-server, etc.), you often get:

```
Error: Port 6006 is already in use
```

Existing solutions have drawbacks:

- **kill-port** — Kills ANY process on that port (imprecise, might kill unrelated processes)
- **Manual** — Find PID, kill it, restart (tedious)
- **pm2** — Overkill for dev servers

`just-one` tracks processes by name using PID files. When you run a command, it kills the previous instance (if any) and starts fresh — precisely targeting only the process it started.

## Features

- **Named process tracking** — Each process gets a unique name for precise targeting
- **Automatic cleanup** — Previous instance killed before starting new one
- **PID reuse protection** — Verifies process identity before killing to prevent accidents
- **Log capture** — stdout/stderr captured to log file in both foreground and daemon modes
- **Daemon mode** — Run processes in the background (detached)
- **Log viewing** — View captured logs, follow in real-time (like `tail -f`)
- **Log rotation** — Automatic rotation at 10MB (keeps 1 backup)
- **Cross-platform** — Works on Windows, macOS, and Linux
- **Minimal dependencies** — Only [pidusage](https://github.com/soyuka/pidusage) for process verification

## Installation

```bash
npm install -g @radleta/just-one
```

Or use with npx (no install required):

```bash
npx @radleta/just-one -n myapp -- npm run dev
```

## Usage

### Basic Usage

```bash
# Run storybook, killing any previous instance named "storybook"
just-one -n storybook -- npx storybook dev -p 6006

# Run vite dev server
just-one -n vite -- npm run dev

# Run any command
just-one -n myapp -- node server.js
```

### Ensure a Process Is Running (Idempotent)

```bash
# Only starts if not already running — safe to call repeatedly
just-one -n vite -e -- npm run dev
```

### Log Capture

Output is automatically captured to `.just-one/<name>.log` in both foreground and daemon modes:

```bash
# Foreground — output appears in terminal AND is saved to log file
just-one -n myapp -- npm start

# Disable log capture if you don't need it
just-one -n myapp --no-log -- npm start
```

### Daemon Mode (Background)

```bash
# Run in background — parent exits immediately, output captured to log file
just-one -n myapp -D -- npm start
```

### Viewing Logs

```bash
# View all captured logs (works for both foreground and daemon processes)
just-one -L myapp

# View last 50 lines
just-one -L myapp --lines 50

# Follow logs in real-time (like tail -f) — auto-exits when process dies
just-one -L myapp -f

# Show last 20 lines then follow
just-one -L myapp -f --lines 20
```

### Check If a Process Is Running

```bash
just-one -s storybook        # exit 0 if running, exit 1 if stopped
just-one --status myapp
```

### Get the PID for Scripting

```bash
pid=$(just-one -p myapp -q)  # prints just the PID number
```

### Kill a Named Process

```bash
just-one -k storybook
just-one --kill myapp
```

### Kill All Tracked Processes

```bash
just-one -K
just-one --kill-all
```

### Wait for a Process to Exit

```bash
just-one -w myapp             # wait indefinitely
just-one -w myapp -t 30       # wait up to 30 seconds
```

### List Tracked Processes

```bash
just-one -l
just-one --list
```

### Clean Up Stale PID Files and Logs

```bash
just-one --clean              # removes stale PID files and their associated log files
```

### Specify Custom PID Directory

```bash
# Default: ./.just-one/<name>.pid
just-one -n storybook -- npx storybook dev

# Custom directory
just-one -n storybook -d /tmp -- npx storybook dev
```

## CLI Options

| Option             | Alias | Description                                        |
| ------------------ | ----- | -------------------------------------------------- |
| `--name <name>`    | `-n`  | Required for run. Name to identify this process    |
| `--daemon`         | `-D`  | Run in background (detached)                       |
| `--no-log`         |       | Disable log file capture in foreground mode        |
| `--logs <name>`    | `-L`  | View captured logs for a named process             |
| `--tail`           | `-f`  | Follow log output in real-time (use with `--logs`) |
| `--lines <n>`      |       | Number of lines to show (use with `--logs`)        |
| `--kill <name>`    | `-k`  | Kill the named process and exit                    |
| `--kill-all`       | `-K`  | Kill all tracked processes                         |
| `--status <name>`  | `-s`  | Check if a named process is running (exit 0/1)     |
| `--ensure`         | `-e`  | Only start if not already running (use with `-n`)  |
| `--pid <name>`     | `-p`  | Print the PID of a named process                   |
| `--wait <name>`    | `-w`  | Wait for a named process to exit                   |
| `--timeout <secs>` | `-t`  | Timeout in seconds (use with `--wait`)             |
| `--grace <secs>`   | `-g`  | Grace period before force kill (default: 5s)       |
| `--clean`          |       | Remove stale PID files and orphaned log files      |
| `--list`           | `-l`  | List all tracked processes and their status        |
| `--pid-dir <dir>`  | `-d`  | Directory for PID files (default: `.just-one/`)    |
| `--quiet`          | `-q`  | Suppress output                                    |
| `--help`           | `-h`  | Show help                                          |
| `--version`        | `-v`  | Show version                                       |

## package.json Scripts

```json
{
  "scripts": {
    "storybook": "just-one -n storybook -- storybook dev -p 6006",
    "dev": "just-one -n vite -e -- vite",
    "dev:api": "just-one -n api -D -- node server.js",
    "dev:logs": "just-one -L api -f",
    "dev:quick": "just-one -n quick --no-log -- node scripts/check.js",
    "stop": "just-one -K"
  }
}
```

## How It Works

```
.just-one/
  storybook.pid    # Contains: 12345
  storybook.log    # Captured output (both foreground and daemon)
  storybook.log.1  # Rotated backup (auto-managed)
  vite.pid         # Contains: 67890
```

1. Check if a PID file exists for that name
2. If yes, verify it's the same process we started (by comparing start times)
3. If verified, send SIGTERM and wait up to 5 seconds (configurable with `--grace`)
4. If still alive, escalate to SIGKILL (force kill)
5. Start the new process
6. Save its PID for next time

### PID Reuse Protection

Operating systems can reuse PIDs after a process terminates. To prevent accidentally killing an unrelated process that received the same PID, `just-one` compares:

- The PID file's modification time (when we recorded the PID)
- The process's actual start time (from the OS)

If these don't match within 5 seconds, the PID file is considered stale and the process is not killed.

<details>
<summary><strong>Cross-platform process handling details</strong></summary>

| Platform | Kill Method                                      | Signal Handling                                                                                     |
| -------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Windows  | `taskkill /PID <pid> /T /F` (kills process tree) | On Ctrl+C, relies on OS-delivered `CTRL_C_EVENT` for graceful shutdown with a force-kill safety net |
| Unix/Mac | `kill -SIGTERM -<pid>` (process group)           | Forwards `SIGTERM` to child process                                                                 |

**Windows graceful shutdown:** In foreground mode with log capture, stdout/stderr are piped so `CTRL_C_EVENT` may not reach the child automatically. `just-one` sends an explicit `SIGTERM` as a defensive fallback, with a force-kill safety net after 2 seconds. With `--no-log`, the child shares the console directly and receives `CTRL_C_EVENT` from the OS.

</details>

## Use Cases

- **Dev servers** — Storybook, Vite, webpack-dev-server, Next.js
- **Background processes** — API servers, database seeders, watchers
- **CI/CD** — Ensure clean state before running tests
- **Multiple instances** — Run named instances on different ports

```bash
# Run two storybooks on different ports
just-one -n storybook-main -- storybook dev -p 6006
just-one -n storybook-docs -- storybook dev -p 6007
```

## Comparison

| Feature                | just-one        | kill-port    | pm2          |
| ---------------------- | --------------- | ------------ | ------------ |
| Kills by PID (precise) | **Yes**         | No (by port) | Yes          |
| PID reuse protection   | **Yes**         | No           | No           |
| Status check           | Yes             | No           | Yes          |
| Cross-platform         | Yes             | Yes          | Yes          |
| Zero config            | Yes             | Yes          | No           |
| Remembers processes    | Yes (PID file)  | No           | Yes (daemon) |
| Lightweight            | **Yes (1 dep)** | Yes          | Heavy        |
| Daemon mode            | Yes             | No           | Yes          |
| Log capture & tailing  | Yes             | No           | Yes          |

## Programmatic Usage

The package exports a `main()` function that mirrors the CLI interface:

```ts
import { main } from '@radleta/just-one';

// main() reads from process.argv and returns an exit code
const exitCode = await main();
```

This is primarily designed for embedding `just-one` in custom CLI tooling. For most use cases, the CLI is the recommended interface.

## Requirements

- Node.js >= 20.0.0

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Lint + typecheck + test
npm run validate
```

## Contributing

Contributions are welcome! Please open an [issue](https://github.com/radleta/just-one/issues) to discuss what you'd like to change, or submit a [pull request](https://github.com/radleta/just-one/pulls) directly.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a history of changes to this project.

## License

[MIT](LICENSE)
