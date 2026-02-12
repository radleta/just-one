/**
 * Cross-platform process handling for just-one
 */

import { spawn, execSync, ChildProcess, type StdioOptions } from 'child_process';
import { openSync, closeSync, createWriteStream } from 'fs';
import pidusage from 'pidusage';

const isWindows = process.platform === 'win32';

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
 * Check if a running process is the same instance we originally spawned.
 * Compares process start time with PID file modification time.
 *
 * Returns true if:
 * - Process exists AND start time is within tolerance of pidFileMtime
 *
 * Returns false if:
 * - Process doesn't exist
 * - Can't determine process start time
 * - Start time doesn't match (likely PID reuse)
 */
export async function isSameProcessInstance(pid: number, pidFileMtimeMs: number): Promise<boolean> {
  const processStartTime = await getProcessStartTime(pid);
  if (processStartTime === null) {
    return false;
  }

  const diff = Math.abs(processStartTime - pidFileMtimeMs);
  return diff <= START_TIME_TOLERANCE_MS;
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
 * Spawn a command in daemon mode (detached, with output captured to log file).
 * The parent process does not wait for the child — it calls child.unref().
 */
export function spawnCommandDaemon(
  command: string,
  args: string[],
  logFilePath: string
): SpawnResult {
  const logFd = openSync(logFilePath, 'a');

  try {
    const stdio: StdioOptions = ['ignore', logFd, logFd];

    const child = spawn(command, args, {
      stdio,
      // Don't use shell on Windows for daemon mode. With shell: true, Node spawns
      // cmd.exe which doesn't reliably pass fd-based stdio to grandchild processes
      // when combined with detached: true (known Node.js issue on Windows).
      // CreateProcess still searches PATH, so executables are found without a shell.
      detached: true,
    });

    if (child.pid === undefined) {
      throw new Error('Failed to spawn daemon process');
    }

    child.unref();

    return {
      child,
      pid: child.pid,
    };
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
