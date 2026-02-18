/**
 * Daemon wrapper for Windows.
 *
 * Spawned by just-one in daemon mode to work around a Node.js limitation:
 * detached + fd-based stdio doesn't let cmd.exe pass inherited file descriptors
 * to grandchild processes (log files are created but stay empty).
 *
 * This wrapper:
 *   1. Spawns the real command with shell: true + piped stdio (not fd-based)
 *   2. Pipes stdout/stderr to the log file
 *   3. Forwards signals and exit codes
 *
 * Usage (internal — not a user-facing command):
 *   node daemon-helper.js <logPath> <command> [args...]
 */

import { spawn } from 'child_process';
import { createWriteStream } from 'fs';

const [logPath, command, ...args] = process.argv.slice(2);

if (!logPath || !command) {
  process.stderr.write('daemon-helper: missing logPath or command\n');
  process.exit(1);
}

const logStream = createWriteStream(logPath, { flags: 'a' });

logStream.on('error', () => {
  // Log stream errors (disk full, directory removed, etc.) must not crash the
  // helper. The child process continues regardless — matching the resilience
  // pattern used by spawnCommand's foreground log stream.
});

const child = spawn(command, args, {
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

child.stdout.pipe(logStream, { end: false });
child.stderr.pipe(logStream, { end: false });

let exiting = false;

child.on('error', err => {
  if (exiting) return;
  exiting = true;
  logStream.write(`[just-one daemon] Failed to start: ${err.message}\n`);
  logStream.end(() => process.exit(1));
});

// Use 'close' (not 'exit') to ensure all piped stdio data is flushed before
// ending the log stream.
child.on('close', (code, signal) => {
  if (exiting) return;
  exiting = true;
  logStream.end(() => {
    if (signal) {
      process.exit(128 + (signal === 'SIGTERM' ? 15 : signal === 'SIGINT' ? 2 : 1));
    }
    process.exit(code ?? 1);
  });
});

// Forward termination signals to child for graceful shutdown.
// With taskkill /T /F the entire tree is killed directly (no signal needed),
// but process.kill(pid, 'SIGTERM') from Node.js delivers SIGTERM here.
const forwardSignal = sig => {
  try {
    child.kill(sig);
  } catch {
    // Child may already be dead
  }
};

process.on('SIGTERM', () => forwardSignal('SIGTERM'));
process.on('SIGINT', () => forwardSignal('SIGINT'));
