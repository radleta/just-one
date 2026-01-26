# just-one

A CLI tool that ensures only one instance of a command runs at a time. Kills the previous instance before starting a new one.

## Why This Exists

When developing with dev servers (Storybook, Vite, webpack-dev-server, etc.), you often get:

```
Error: Port 6006 is already in use
```

Existing solutions have drawbacks:
- **kill-port** - Kills ANY process on that port (imprecise, might kill unrelated processes)
- **Manual** - Find PID, kill it, restart (tedious)
- **pm2** - Overkill for dev servers

`just-one` tracks processes by name using PID files. When you run a command, it kills the previous instance (if any) and starts fresh—precisely targeting only the process it started.

## Features

- **Named process tracking** - Each process gets a unique name for precise targeting
- **Automatic cleanup** - Previous instance killed before starting new one
- **Cross-platform** - Works on Windows, macOS, and Linux
- **Minimal dependencies** - Only [pidusage](https://github.com/soyuka/pidusage) for process verification
- **PID file management** - Survives terminal closes and system restarts
- **PID reuse protection** - Verifies process identity before killing to prevent accidents

## Installation

```bash
npm install -g @radleta/just-one
```

Or use with npx (no install required):

```bash
npx @radleta/just-one -n myapp -- npm run dev
```

## Usage

### Basic usage

```bash
# Run storybook, killing any previous instance named "storybook"
just-one -n storybook -- npx storybook dev -p 6006

# Run vite dev server
just-one -n vite -- npm run dev

# Run any command
just-one -n myapp -- node server.js
```

### Kill a named process

```bash
just-one -k storybook
just-one --kill myapp
```

### List tracked processes

```bash
just-one -l
just-one --list
```

### Specify custom PID directory

```bash
# Default: ./.just-one/<name>.pid
just-one -n storybook -- npx storybook dev

# Custom directory
just-one -n storybook -d /tmp -- npx storybook dev
```

## CLI Options

| Option | Alias | Description |
|--------|-------|-------------|
| `--name <name>` | `-n` | Required for run. Name to identify this process |
| `--kill <name>` | `-k` | Kill the named process and exit |
| `--list` | `-l` | List all tracked processes and their status |
| `--pid-dir <dir>` | `-d` | Directory for PID files (default: `.just-one/`) |
| `--quiet` | `-q` | Suppress output |
| `--help` | `-h` | Show help |
| `--version` | `-v` | Show version |

## package.json Scripts

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

## How It Works

```
.just-one/
  storybook.pid    # Contains: 12345
  vite.pid         # Contains: 67890
```

1. Check if a PID file exists for that name
2. If yes, verify it's the same process we started (by comparing start times)
3. If verified, kill that specific process (and its children)
4. Start the new process
5. Save its PID for next time

### PID Reuse Protection

Operating systems can reuse PIDs after a process terminates. To prevent accidentally killing an unrelated process that received the same PID, `just-one` compares:
- The PID file's modification time (when we recorded the PID)
- The process's actual start time (from the OS)

If these don't match within 5 seconds, the PID file is considered stale and the process is not killed.

### Cross-Platform Process Handling

| Platform | Kill Method |
|----------|-------------|
| Windows | `taskkill /PID <pid> /T /F` (kills process tree) |
| Unix/Mac | `kill -SIGTERM -<pid>` (process group) |

## Use Cases

- **Dev servers** - Storybook, Vite, webpack-dev-server, Next.js
- **Background processes** - API servers, database seeders, watchers
- **CI/CD** - Ensure clean state before running tests
- **Multiple instances** - Run named instances on different ports

```bash
# Run two storybooks on different ports
just-one -n storybook-main -- storybook dev -p 6006
just-one -n storybook-docs -- storybook dev -p 6007
```

## Comparison

| Feature | just-one | kill-port | pm2 |
|---------|----------|-----------|-----|
| Kills by PID (precise) | Yes | No (by port) | Yes |
| PID reuse protection | Yes | No | No |
| Cross-platform | Yes | Yes | Yes |
| Zero config | Yes | Yes | No |
| Remembers processes | Yes (PID file) | No | Yes (daemon) |
| Lightweight | Yes (1 dep) | Yes | Heavy |
| Daemon required | No | No | Yes |

## Requirements

- Node.js >= 18.0.0

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

## License

MIT
