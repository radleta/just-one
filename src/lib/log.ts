/**
 * Log file operations for just-one (both foreground and daemon modes)
 */

import {
  existsSync,
  statSync,
  renameSync,
  unlinkSync,
  readFileSync,
  readdirSync,
  openSync,
  readSync,
  closeSync,
} from 'fs';
import { join } from 'path';

const DEFAULT_MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Get the path to a log file for a given name
 */
export function getLogFilePath(name: string, pidDir: string): string {
  return join(pidDir, `${name}.log`);
}

/**
 * Get the path to a backup log file for a given name
 */
export function getBackupLogFilePath(name: string, pidDir: string): string {
  return join(pidDir, `${name}.log.1`);
}

/**
 * Get the size of a log file in bytes
 * Returns 0 if the file doesn't exist
 */
export function getLogFileSize(name: string, pidDir: string): number {
  const logPath = getLogFilePath(name, pidDir);
  try {
    const stats = statSync(logPath);
    return stats.size;
  } catch {
    return 0;
  }
}

/**
 * Rotate the log file if it exceeds the maximum size.
 * Renames current .log to .log.1 (overwriting any existing backup).
 * Returns true if rotation occurred.
 */
export function rotateLogIfNeeded(
  name: string,
  pidDir: string,
  maxSize: number = DEFAULT_MAX_LOG_SIZE
): boolean {
  const size = getLogFileSize(name, pidDir);
  if (size <= maxSize) {
    return false;
  }

  const logPath = getLogFilePath(name, pidDir);
  const backupPath = getBackupLogFilePath(name, pidDir);

  // Remove existing backup if present
  try {
    if (existsSync(backupPath)) {
      unlinkSync(backupPath);
    }
  } catch {
    // Ignore errors removing old backup
  }

  renameSync(logPath, backupPath);
  return true;
}

/**
 * Read lines from a log file.
 * If lastN is provided, returns only the last N lines.
 * Returns empty array if the file doesn't exist.
 */
export function readLogLines(name: string, pidDir: string, lastN?: number): string[] {
  const logPath = getLogFilePath(name, pidDir);

  if (!existsSync(logPath)) {
    return [];
  }

  try {
    const content = readFileSync(logPath, 'utf8');
    if (content.length === 0) {
      return [];
    }

    const lines = content.split('\n');
    // Remove trailing empty line from final newline
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    if (lastN === undefined) {
      return lines;
    }
    if (lastN === 0) {
      return [];
    }
    return lines.slice(-lastN);
  } catch {
    return [];
  }
}

export interface TailOptions {
  onLine: (line: string) => void;
  onError?: (err: Error) => void;
  initialLines?: number;
  pollIntervalMs?: number;
}

export interface TailHandle {
  stop: () => void;
}

/**
 * Follow a log file in real-time using setInterval polling.
 * Reads from last byte offset on each change, calling onLine for each new line.
 * Optionally emits the last N lines of existing content first.
 */
export function tailLogFile(name: string, pidDir: string, options: TailOptions): TailHandle {
  const logPath = getLogFilePath(name, pidDir);
  const pollIntervalMs = options.pollIntervalMs ?? 500;

  // Emit initial lines if requested
  if (options.initialLines !== undefined && options.initialLines > 0) {
    const initial = readLogLines(name, pidDir, options.initialLines);
    for (const line of initial) {
      options.onLine(line);
    }
  }

  // Track current file offset
  let offset = 0;
  try {
    if (existsSync(logPath)) {
      offset = statSync(logPath).size;
    }
  } catch {
    // File may not exist yet, start from 0
  }

  let partialLine = '';

  const checkForChanges = () => {
    let newSize: number;
    try {
      if (!existsSync(logPath)) return;
      newSize = statSync(logPath).size;
    } catch {
      return;
    }

    if (newSize <= offset) {
      // File was truncated or unchanged — reset to new size
      offset = newSize;
      return;
    }

    const bytesToRead = newSize - offset;
    try {
      const fd = openSync(logPath, 'r');
      try {
        const buf = Buffer.alloc(bytesToRead);
        readSync(fd, buf, 0, bytesToRead, offset);
        offset = newSize;

        const chunk = buf.toString('utf8');
        const parts = chunk.split('\n');

        // Prepend any partial line from last read
        if (parts.length > 0) {
          parts[0] = partialLine + parts[0]!;
          partialLine = '';
        }

        // Last element is either empty (if chunk ended with \n) or a partial line
        const lastPart = parts.pop();
        if (lastPart !== undefined && lastPart !== '') {
          partialLine = lastPart;
        }

        for (const line of parts) {
          options.onLine(line);
        }
      } finally {
        closeSync(fd);
      }
    } catch (err) {
      if (options.onError && err instanceof Error) {
        options.onError(err);
      }
    }
  };

  const intervalId = setInterval(checkForChanges, pollIntervalMs);

  return {
    stop: () => {
      clearInterval(intervalId);
    },
  };
}

/**
 * List names that have log files (.log or .log.1) but no corresponding .pid file.
 * Returns deduplicated list of names.
 */
export function listOrphanedLogNames(pidDir: string): string[] {
  if (!existsSync(pidDir)) {
    return [];
  }

  try {
    const files = readdirSync(pidDir);
    const pidNames = new Set(files.filter(f => f.endsWith('.pid')).map(f => f.slice(0, -4)));

    const logNames = new Set<string>();
    for (const f of files) {
      if (f.endsWith('.log.1')) {
        logNames.add(f.slice(0, -6));
      } else if (f.endsWith('.log')) {
        logNames.add(f.slice(0, -4));
      }
    }

    return [...logNames].filter(name => !pidNames.has(name));
  } catch {
    return [];
  }
}

/**
 * Delete log files (.log and .log.1) for a given name.
 * Silently ignores missing files.
 */
export function deleteLogFiles(name: string, pidDir: string): void {
  const logPath = getLogFilePath(name, pidDir);
  const backupPath = getBackupLogFilePath(name, pidDir);

  try {
    if (existsSync(logPath)) {
      unlinkSync(logPath);
    }
  } catch {
    // Ignore
  }

  try {
    if (existsSync(backupPath)) {
      unlinkSync(backupPath);
    }
  } catch {
    // Ignore
  }
}
