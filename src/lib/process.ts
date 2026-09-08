/**
 * Cross-platform process handling for just-one
 */

import { spawn, execSync, ChildProcess, type StdioOptions } from 'child_process';
import { existsSync, openSync, closeSync, createWriteStream, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import pidusage from 'pidusage';
import type { IdentityEvidence } from './pid.js';

const isWindows = process.platform === 'win32';
const isLinux = process.platform === 'linux';

// Constants for process termination
const DEFAULT_GRACE_PERIOD_MS = 5000; // How long to wait after SIGTERM before escalating
const FORCE_KILL_WAIT_MS = 2000; // How long to wait after SIGKILL for process to die
const CHECK_INTERVAL_MS = 100;

/**
 * Validate that a PID is a safe positive integer for use in system calls
 */
export function isValidPid(pid: number): boolean {
  return Number.isInteger(pid) && pid > 0 && pid <= 4194304; // Max PID on most systems
}

// Tolerance for comparing PID file mtime with process start time
const START_TIME_TOLERANCE_MS = 5000; // 5 seconds

// Position of starttime (field 22) within /proc/<pid>/stat once the fields
// preceding it — pid (1) and comm (2) — have been sliced off.
const STARTTIME_INDEX_AFTER_COMM = 19;

/**
 * Get the start time of a process as Unix timestamp (milliseconds)
 * Returns null if process doesn't exist or start time can't be determined
 */
export async function getProcessStartTime(pid: number): Promise<number | null> {
  if (!isValidPid(pid)) {
    return null;
  }

  try {
    const stats = await pidusage(pid);
    // Calculate start time from current timestamp minus elapsed time
    return stats.timestamp - stats.elapsed;
  } catch {
    return null; // Process doesn't exist or can't get stats
  }
}

/**
 * Get a process's start time as raw clock ticks since boot (Linux only).
 * Returns null on other platforms, or when /proc/<pid>/stat is unreadable.
 *
 * Field 22 of /proc/<pid>/stat is immune to wall-clock movement, unlike the
 * uptime-derived start time from pidusage. That matters on WSL2, where a host
 * suspend freezes /proc/uptime while the wall clock keeps running, making every
 * live process look like it started later than it did.
 */
export function getProcessStartTicks(pid: number): number | null {
  if (!isLinux || !isValidPid(pid)) {
    return null;
  }

  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    // The comm field (2) is parenthesized and may itself contain spaces and
    // parens, so fields are only unambiguous after the final ')'.
    const afterComm = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const ticks = Number(afterComm[STARTTIME_INDEX_AFTER_COMM]);
    return Number.isFinite(ticks) ? ticks : null;
  } catch {
    return null;
  }
}

/** Which comparison produced an identity verdict. */
export type IdentityBasis = 'ticks' | 'startTime' | 'mtime';

export interface IdentityVerdict {
  same: boolean;
  /**
   * The path that produced the answer. Only 'ticks' and 'startTime' are exact;
   * a 'mtime' answer is a proxy either way, so nothing may infer identity from
   * this field alone — that is what `same` is for.
   */
  basis: IdentityBasis;
  /**
   * |processStartTime - pidFileMtimeMs|, populated only on an mtime rejection.
   * A large value is the clock-drift signature, not PID reuse.
   */
  deltaMs?: number;
}

/**
 * Check if a running process is the same instance we originally spawned.
 *
 * Resolution order: recorded start ticks compared exactly (Linux), else a
 * recorded start time compared exactly (Windows), else the process start time
 * compared against the PID file's modification time within a tolerance.
 *
 * Reports false if the process doesn't exist, its start time can't be
 * determined, or the recorded evidence doesn't match (likely PID reuse).
 */
export async function isSameProcessInstance(
  pid: number,
  pidFileMtimeMs: number,
  evidence?: IdentityEvidence
): Promise<IdentityVerdict> {
  if (evidence?.startTicks != null) {
    const currentTicks = getProcessStartTicks(pid);
    // A null read proves nothing here: a tick-bearing file read on a platform
    // without /proc must fall through rather than reject.
    if (currentTicks !== null) {
      return { same: currentTicks === evidence.startTicks, basis: 'ticks' };
    }
  }

  if (evidence?.startTime != null) {
    const startTime = await getProcessStartTime(pid);
    // Unlike ticks, a null read here does mean the process is gone: the
    // recorded value came from the very source that just failed to answer.
    if (startTime === null) {
      return { same: false, basis: 'mtime' };
    }
    return { same: startTime === evidence.startTime, basis: 'startTime' };
  }

  const processStartTime = await getProcessStartTime(pid);
  if (processStartTime === null) {
    return { same: false, basis: 'mtime' };
  }

  // Rounded where it is built, because it reaches the user as text. A file's
  // mtime is fractional on every real filesystem — 100ns on NTFS, nanoseconds
  // on ext4 — while the start time is whole milliseconds, so the raw
  // difference carries a fractional tail.
  const deltaMs = Math.round(Math.abs(processStartTime - pidFileMtimeMs));
  return deltaMs <= START_TIME_TOLERANCE_MS
    ? { same: true, basis: 'mtime' }
    : { same: false, basis: 'mtime', deltaMs };
}

/**
 * Check if a process with the given PID is still running
 */
export function isProcessAlive(pid: number): boolean {
  try {
    if (!isValidPid(pid)) {
      return false;
    }
    if (isWindows) {
      // Windows: tasklist returns exit code 0 if process found
      // PID is validated as a safe integer above before interpolation
      const output = execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output.includes(String(pid));
    } else {
      // Unix/Mac: kill -0 checks if process exists without killing it
      process.kill(pid, 0);
      return true;
    }
  } catch {
    return false;
  }
}

/**
 * Kill a process by PID
 * Returns true if the process was killed, false if it wasn't running
 */
export function killProcess(pid: number): boolean {
  if (!isValidPid(pid) || !isProcessAlive(pid)) {
    return false;
  }

  try {
    if (isWindows) {
      // Windows: taskkill with /T kills the process tree, /F forces
      // PID is validated as a safe integer above before interpolation
      execSync(`taskkill /PID ${pid} /T /F`, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } else {
      // Unix: try to kill process group first (catches child processes),
      // fall back to killing just the process if group kill fails
      const killed = tryKillUnix(-pid) || tryKillUnix(pid);
      if (!killed) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper to attempt Unix kill with error handling
 */
function tryKillUnix(pid: number): boolean {
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for a process to die, with timeout
 * @param pid - Process ID to wait for
 * @param timeoutMs - Maximum time to wait (default: 5000ms)
 */
export async function waitForProcessToDie(
  pid: number,
  timeoutMs: number = DEFAULT_GRACE_PERIOD_MS
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));
  }

  return !isProcessAlive(pid);
}

/**
 * Force kill a process by PID using SIGKILL (Unix) or taskkill /F (Windows).
 * This is a last resort after SIGTERM fails.
 */
export function forceKillProcess(pid: number): boolean {
  if (!isValidPid(pid) || !isProcessAlive(pid)) {
    return false;
  }

  try {
    if (isWindows) {
      // PID is validated as a safe integer above before interpolation
      execSync(`taskkill /PID ${pid} /T /F`, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } else {
      // Try process group first, then individual PID
      let killed = false;
      try {
        process.kill(-pid, 'SIGKILL');
        killed = true;
      } catch {
        /* group kill may fail */
      }
      try {
        process.kill(pid, 'SIGKILL');
        killed = true;
      } catch {
        /* individual kill may fail */
      }
      if (!killed) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Terminate a process with graceful shutdown and SIGKILL escalation.
 *
 * Flow: SIGTERM → wait grace period → SIGKILL → wait 2s → give up
 *
 * @param pid - Process ID to terminate
 * @param gracePeriodMs - How long to wait after SIGTERM before escalating (default: 5000ms)
 * @returns true if process is dead, false if it could not be killed
 */
export async function terminateProcess(pid: number, gracePeriodMs?: number): Promise<boolean> {
  const grace = gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;

  if (!isValidPid(pid)) {
    return false;
  }

  // Already dead? Nothing to do.
  if (!isProcessAlive(pid)) {
    return true;
  }

  // Step 1: Send SIGTERM (or taskkill /F on Windows)
  killProcess(pid);

  // Step 2: Wait for graceful shutdown
  const died = await waitForProcessToDie(pid, grace);
  if (died) {
    return true;
  }

  // Step 3: Escalate to SIGKILL (Unix) / re-attempt taskkill (Windows)
  forceKillProcess(pid);
  return await waitForProcessToDie(pid, FORCE_KILL_WAIT_MS);
}

export interface SpawnResult {
  child: ChildProcess;
  pid: number;
}

/**
 * Spawn a command with stdio forwarding.
 * When logFilePath is provided, stdout/stderr are piped and tee'd to both
 * the terminal and the log file. When omitted, stdio is inherited directly.
 */
export function spawnCommand(command: string, args: string[], logFilePath?: string): SpawnResult {
  const stdio: StdioOptions = logFilePath ? ['inherit', 'pipe', 'pipe'] : 'inherit';

  const child = spawn(command, args, {
    stdio,
    shell: isWindows,
    detached: !isWindows,
  });

  if (child.pid === undefined) {
    throw new Error('Failed to spawn process');
  }

  if (logFilePath && child.stdout && child.stderr) {
    const logStream = createWriteStream(logFilePath, { flags: 'a' });
    logStream.on('error', () => {
      // Log stream errors (ENOENT from directory removal, disk full, etc.)
      // must not become unhandled exceptions. stdout/stderr are still piped
      // to the terminal, so the process continues to work normally.
    });
    child.stdout.pipe(process.stdout);
    child.stdout.pipe(logStream);
    child.stderr.pipe(process.stderr);
    child.stderr.pipe(logStream);
    child.on('exit', () => logStream.end());
  }

  return {
    child,
    pid: child.pid,
  };
}

/**
 * Resolve the path to bin/daemon-helper.js by walking up from the current module.
 * Works from both dist/ (production build) and src/lib/ (vitest).
 */
let _daemonHelperPath: string | undefined;
function getDaemonHelperPath(): string {
  if (_daemonHelperPath) return _daemonHelperPath;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, 'bin', 'daemon-helper.js');
    if (existsSync(candidate)) {
      _daemonHelperPath = candidate;
      return candidate;
    }
    dir = dirname(dir);
  }
  throw new Error('Cannot find bin/daemon-helper.js — package installation may be corrupted');
}

/**
 * Spawn a command in daemon mode (detached, with output captured to log file).
 * The parent process does not wait for the child — it calls child.unref().
 *
 * On Windows, spawns a lightweight helper process (daemon-helper.js) that uses
 * shell: true + piped stdio to resolve .cmd wrappers. Direct fd-based stdio with
 * cmd.exe + detached doesn't work (known Node.js limitation — logs stay empty).
 *
 * On Unix, uses fd-based stdio directly (no .cmd issue, no shell needed).
 */
export function spawnCommandDaemon(
  command: string,
  args: string[],
  logFilePath: string
): SpawnResult {
  if (isWindows) {
    // Pre-create the log file so callers can rely on its existence immediately
    // (matching the Unix fd-based path which creates via openSync before spawn).
    // The helper opens with append mode, so no data is lost.
    closeSync(openSync(logFilePath, 'a'));

    const helperPath = getDaemonHelperPath();
    const child = spawn(process.execPath, [helperPath, logFilePath, command, ...args], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: process.env,
    });

    if (child.pid === undefined) {
      throw new Error('Failed to spawn daemon process');
    }

    child.unref();
    return { child, pid: child.pid };
  }

  // Unix: fd-based stdio works reliably with detached processes
  const logFd = openSync(logFilePath, 'a');
  try {
    const child = spawn(command, args, {
      stdio: ['ignore', logFd, logFd] as StdioOptions,
      detached: true,
      env: process.env,
    });

    if (child.pid === undefined) {
      throw new Error('Failed to spawn daemon process');
    }

    child.unref();
    return { child, pid: child.pid };
  } finally {
    closeSync(logFd);
  }
}

// Grace period for Windows child process to exit before force-killing
const WINDOWS_GRACEFUL_TIMEOUT_MS = 2000;

/**
 * Set up signal handlers to forward signals to child process
 *
 * Unix: forwards SIGTERM to child for graceful shutdown.
 *
 * Windows: when stdio is inherited, the child shares the console, so Ctrl+C
 * delivers CTRL_C_EVENT to the child directly — no forwarding needed. When
 * pipedStdio is true (stdout/stderr are piped for log capture), the child
 * may not receive CTRL_C_EVENT automatically, so we explicitly call
 * child.kill('SIGTERM') as a defensive fallback. The force-kill timeout
 * remains as a safety net regardless.
 */
export function setupSignalHandlers(
  child: ChildProcess,
  onExit?: () => void,
  pipedStdio?: boolean
): void {
  let forceKillTimer: ReturnType<typeof setTimeout> | null = null;

  const forceKillWindows = () => {
    if (child.pid && isValidPid(child.pid) && isProcessAlive(child.pid)) {
      try {
        execSync(`taskkill /PID ${child.pid} /T /F`, {
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch {
        // Process might already be dead
      }
    }
  };

  const handleSignal = (_signal: NodeJS.Signals) => {
    if (child.pid && isValidPid(child.pid)) {
      if (isWindows) {
        // With inherited stdio, the child gets CTRL_C_EVENT from the OS directly.
        // With piped stdio (log capture), the child may not get the event, so we
        // explicitly send SIGTERM as a defensive fallback. If the child already
        // received the event, the kill is harmless (child is already shutting down).
        if (pipedStdio) {
          child.kill('SIGTERM');
        }
        if (forceKillTimer === null) {
          forceKillTimer = setTimeout(forceKillWindows, WINDOWS_GRACEFUL_TIMEOUT_MS);
          forceKillTimer.unref();
        }
      } else {
        // Forward as SIGTERM for graceful shutdown
        child.kill('SIGTERM');
      }
    }
  };

  // Forward both SIGINT (Ctrl+C) and SIGTERM to child
  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));

  child.on('exit', (code, signal) => {
    // Child exited gracefully — cancel the force-kill timer if pending
    if (forceKillTimer !== null) {
      clearTimeout(forceKillTimer);
      forceKillTimer = null;
    }
    if (onExit) {
      onExit();
    }
    if (signal) {
      process.exit(128 + (signal === 'SIGTERM' ? 15 : signal === 'SIGINT' ? 2 : 1));
    }
    process.exit(code ?? 0);
  });

  child.on('error', err => {
    console.error(`Failed to start process: ${err.message}`);
    process.exit(1);
  });
}
