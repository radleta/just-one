/**
 * Cross-platform process handling for just-one
 */

import { spawn, execSync, ChildProcess } from 'child_process';

const isWindows = process.platform === 'win32';

// Constants for process polling
const DEFAULT_WAIT_TIMEOUT_MS = 2000;
const CHECK_INTERVAL_MS = 100;

/**
 * Validate that a PID is a safe positive integer for use in system calls
 */
function isValidPid(pid: number): boolean {
  return Number.isInteger(pid) && pid > 0 && pid <= 4194304; // Max PID on most systems
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
 * @param timeoutMs - Maximum time to wait (default: 2000ms)
 */
export async function waitForProcessToDie(
  pid: number,
  timeoutMs: number = DEFAULT_WAIT_TIMEOUT_MS
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

export interface SpawnResult {
  child: ChildProcess;
  pid: number;
}

/**
 * Spawn a command with stdio forwarding
 */
export function spawnCommand(command: string, args: string[]): SpawnResult {
  // On Windows, pass entire command as a single string to avoid escaping issues
  // with shell: true (DEP0190 warning and argument handling)
  const spawnCmd = isWindows ? `${command} ${args.join(' ')}` : command;
  const spawnArgs = isWindows ? [] : args;

  const child = spawn(spawnCmd, spawnArgs, {
    stdio: 'inherit',
    shell: isWindows,
    detached: !isWindows,
  });

  if (child.pid === undefined) {
    throw new Error('Failed to spawn process');
  }

  return {
    child,
    pid: child.pid,
  };
}

/**
 * Set up signal handlers to forward signals to child process
 * Note: Both SIGINT and SIGTERM are forwarded as SIGTERM to ensure
 * consistent graceful shutdown behavior across different termination methods.
 */
export function setupSignalHandlers(child: ChildProcess, onExit?: () => void): void {
  const handleSignal = (_signal: NodeJS.Signals) => {
    if (child.pid && isValidPid(child.pid)) {
      if (isWindows) {
        try {
          // PID is validated as a safe integer above before interpolation
          execSync(`taskkill /PID ${child.pid} /T /F`, {
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        } catch {
          // Process might already be dead
        }
      } else {
        // Forward as SIGTERM for graceful shutdown
        child.kill('SIGTERM');
      }
    }
  };

  // Forward both SIGINT (Ctrl+C) and SIGTERM to child as SIGTERM
  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));

  child.on('exit', (code, signal) => {
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
