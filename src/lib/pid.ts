/**
 * PID file operations for just-one
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';

export interface PidInfo {
  name: string;
  pid: number;
  exists: boolean;
}

/**
 * Get the path to a PID file for a given name
 */
export function getPidFilePath(name: string, pidDir: string): string {
  return join(pidDir, `${name}.pid`);
}

/**
 * Read the PID from a PID file
 * Returns null if the file doesn't exist or is invalid
 */
export function readPid(name: string, pidDir: string): number | null {
  const pidFile = getPidFilePath(name, pidDir);

  if (!existsSync(pidFile)) {
    return null;
  }

  try {
    const content = readFileSync(pidFile, 'utf8').trim();
    const pid = parseInt(content, 10);

    if (isNaN(pid) || pid <= 0) {
      return null;
    }

    return pid;
  } catch {
    return null;
  }
}

/**
 * Write a PID to a PID file
 * Creates the directory if it doesn't exist
 */
export function writePid(name: string, pid: number, pidDir: string): void {
  const pidFile = getPidFilePath(name, pidDir);
  const dir = dirname(pidFile);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(pidFile, String(pid), 'utf8');
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
    const pid = readPid(name, pidDir);

    return {
      name,
      pid: pid ?? 0,
      exists: pid !== null,
    };
  });
}
