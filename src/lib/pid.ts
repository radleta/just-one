/**
 * PID file operations for just-one
 */

import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  utimesSync,
} from 'fs';
import { join, dirname } from 'path';

const START_TICKS_KEY = 'startTicks=';

export interface PidInfo {
  name: string;
  pid: number;
  exists: boolean;
  startTicks?: number | null;
}

export interface PidRecord {
  pid: number;
  /** Process start time in clock ticks since boot (Linux only, null elsewhere) */
  startTicks: number | null;
}

/**
 * Get the path to a PID file for a given name
 */
export function getPidFilePath(name: string, pidDir: string): string {
  return join(pidDir, `${name}.pid`);
}

/**
 * Read a PID file's full record: the PID plus, when it was written on a system
 * that supports them, the process's start ticks.
 *
 * File format is line-oriented: the PID alone on the first line, then optional
 * `key=value` lines. Files written by older versions hold only the bare PID.
 */
export function readPidRecord(name: string, pidDir: string): PidRecord | null {
  const pidFile = getPidFilePath(name, pidDir);

  if (!existsSync(pidFile)) {
    return null;
  }

  try {
    const [pidLine, ...rest] = readFileSync(pidFile, 'utf8').trim().split('\n');
    const pid = parseInt(pidLine ?? '', 10);

    if (isNaN(pid) || pid <= 0) {
      return null;
    }

    const ticksLine = rest.find(line => line.startsWith(START_TICKS_KEY));
    const ticks = ticksLine ? Number(ticksLine.slice(START_TICKS_KEY.length)) : NaN;

    return { pid, startTicks: Number.isFinite(ticks) ? ticks : null };
  } catch {
    return null;
  }
}

/**
 * Read the PID from a PID file
 * Returns null if the file doesn't exist or is invalid
 */
export function readPid(name: string, pidDir: string): number | null {
  return readPidRecord(name, pidDir)?.pid ?? null;
}

/**
 * Write a PID to a PID file, optionally recording the process's start ticks so
 * its identity can be verified exactly later.
 * Creates the directory if it doesn't exist
 */
export function writePid(
  name: string,
  pid: number,
  pidDir: string,
  startTicks?: number | null
): void {
  const pidFile = getPidFilePath(name, pidDir);
  const dir = dirname(pidFile);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const content = startTicks != null ? `${pid}\n${START_TICKS_KEY}${startTicks}` : String(pid);
  writeFileSync(pidFile, content, 'utf8');
}

/**
 * Record start ticks into an existing PID file that was written without them.
 *
 * The file's mtime is restored afterwards: older versions of just-one verify
 * identity by comparing that mtime against the process start time, so bumping
 * it would make a live process look stale to them.
 */
export function updateStartTicks(name: string, pidDir: string, startTicks: number): void {
  const pidFile = getPidFilePath(name, pidDir);

  try {
    const record = readPidRecord(name, pidDir);
    if (record === null) {
      return;
    }

    const { atimeMs, mtimeMs } = statSync(pidFile);
    writePid(name, record.pid, pidDir, startTicks);
    // Seconds as floats, not Date objects — Date truncates to whole milliseconds
    utimesSync(pidFile, atimeMs / 1000, mtimeMs / 1000);
  } catch {
    // Best effort — a failed backfill just leaves the file on the mtime path.
  }
}

/**
 * Delete a PID file
 * Returns true if the file was deleted, false if it didn't exist
 */
export function deletePid(name: string, pidDir: string): boolean {
  const pidFile = getPidFilePath(name, pidDir);

  if (!existsSync(pidFile)) {
    return false;
  }

  try {
    unlinkSync(pidFile);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the modification time of a PID file as Unix timestamp (milliseconds)
 * Returns null if file doesn't exist
 */
export function getPidFileMtime(name: string, pidDir: string): number | null {
  const pidFile = getPidFilePath(name, pidDir);
  try {
    const stats = statSync(pidFile);
    return stats.mtimeMs;
  } catch {
    return null;
  }
}

/**
 * List all PID files in the directory
 * Returns information about each tracked process
 */
export function listPids(pidDir: string): PidInfo[] {
  if (!existsSync(pidDir)) {
    return [];
  }

  const files = readdirSync(pidDir);
  const pidFiles = files.filter(f => f.endsWith('.pid'));

  return pidFiles.map(file => {
    // Remove .pid suffix (use slice to only remove from end)
    const name = file.slice(0, -4);
    const record = readPidRecord(name, pidDir);

    return {
      name,
      pid: record?.pid ?? 0,
      exists: record !== null,
      startTicks: record?.startTicks ?? null,
    };
  });
}
