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
  renameSync,
} from 'fs';
import { join, dirname } from 'path';

const START_TICKS_KEY = 'startTicks=';
const START_TIME_KEY = 'startTime=';

/**
 * Evidence of a process's identity, recorded in its PID file so a later check
 * can tell the original process from an unrelated one that reused its PID.
 *
 * At most one kind is recorded per file: ticks where the platform supplies them
 * (Linux), the start time where it does not but the value is exact (Windows).
 */
export interface IdentityEvidence {
  /** Process start time in clock ticks since boot (Linux) */
  startTicks?: number | null;
  /** Process start time as a Unix timestamp in milliseconds (Windows) */
  startTime?: number | null;
}

export interface PidInfo {
  name: string;
  pid: number;
  exists: boolean;
  startTicks?: number | null;
  startTime?: number | null;
}

export interface PidRecord {
  pid: number;
  /** Process start time in clock ticks since boot (Linux only, null elsewhere) */
  startTicks: number | null;
  /** Process start time in milliseconds (Windows only, null elsewhere) */
  startTime: number | null;
}

/**
 * Get the path to a PID file for a given name
 */
export function getPidFilePath(name: string, pidDir: string): string {
  return join(pidDir, `${name}.pid`);
}

/**
 * Read a PID file's full record: the PID plus whatever identity evidence the
 * platform that wrote it was able to record.
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

    return {
      pid,
      startTicks: readNumericKey(rest, START_TICKS_KEY),
      startTime: readNumericKey(rest, START_TIME_KEY),
    };
  } catch {
    return null;
  }
}

/**
 * Read a `key=value` line's numeric value, treating a missing key and an
 * unparseable value alike: the evidence is simply absent.
 */
function readNumericKey(lines: string[], key: string): number | null {
  const line = lines.find(l => l.startsWith(key));
  if (line === undefined) {
    return null;
  }
  // Number('') and Number('  ') are both 0, which would turn an empty value
  // into recorded evidence of 0 — and evidence of 0 hard-rejects a live
  // process on the exact branch. An empty value is no value.
  const raw = line.slice(key.length).trim();
  if (raw === '') {
    return null;
  }

  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Read the PID from a PID file
 * Returns null if the file doesn't exist or is invalid
 */
export function readPid(name: string, pidDir: string): number | null {
  return readPidRecord(name, pidDir)?.pid ?? null;
}

/**
 * Render a PID file's contents. The PID is alone on line 1 — older versions
 * parseInt the whole file and stop at the newline — followed by at most one
 * evidence key. Ticks win when both are supplied: they are the exact value.
 */
function formatPidFile(pid: number, evidence?: IdentityEvidence): string {
  if (evidence?.startTicks != null) {
    return `${pid}\n${START_TICKS_KEY}${evidence.startTicks}`;
  }
  if (evidence?.startTime != null) {
    return `${pid}\n${START_TIME_KEY}${evidence.startTime}`;
  }
  return String(pid);
}

/**
 * Write a PID to a PID file, optionally recording identity evidence so the
 * process can be verified exactly later.
 * Creates the directory if it doesn't exist
 */
export function writePid(
  name: string,
  pid: number,
  pidDir: string,
  evidence?: IdentityEvidence
): void {
  const pidFile = getPidFilePath(name, pidDir);
  const dir = dirname(pidFile);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Written to a sibling and renamed into place, so a concurrent reader — an
  // older just-one sharing the directory included — never parseInts a partial
  // first line. The temp name carries our PID so parallel writers don't collide.
  const tmpFile = `${pidFile}.${process.pid}.tmp`;
  writeFileSync(tmpFile, formatPidFile(pid, evidence), 'utf8');
  renameSync(tmpFile, pidFile);
}

/**
 * Record identity evidence into an existing PID file that was written without it.
 *
 * The file's mtime is restored afterwards — on the final path, after the
 * rename: older versions of just-one verify identity by comparing that mtime
 * against the process start time, so bumping it would make a live process look
 * stale to them.
 */
export function writeIdentityEvidence(
  name: string,
  pidDir: string,
  evidence: IdentityEvidence
): void {
  const pidFile = getPidFilePath(name, pidDir);

  try {
    const record = readPidRecord(name, pidDir);
    if (record === null) {
      return;
    }

    const { atimeMs, mtimeMs } = statSync(pidFile);
    writePid(name, record.pid, pidDir, evidence);
    // Seconds as floats, not Date objects — Date truncates to whole milliseconds
    utimesSync(pidFile, atimeMs / 1000, mtimeMs / 1000);
  } catch {
    // Best effort — a failed write just leaves the file on the mtime path.
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

/** An abandoned candidate left behind by an interrupted `writePid`. */
export interface TempPidFile {
  /** Absolute path to the `.tmp` file. */
  path: string;
  /** PID of the just-one process that was writing it. */
  writerPid: number;
}

/**
 * List the `<name>.pid.<writerPid>.tmp` siblings in a PID directory.
 *
 * `writePid` renames its temp file into place, so one of these survives only
 * when a write was interrupted between the two calls. Nothing else removes
 * them: every other path filters on `.pid`. The writer's PID comes back with
 * each entry so the caller can leave a write that is still in flight alone —
 * this module cannot make that check itself without importing `process.ts`,
 * which imports this one.
 */
export function listTempPidFiles(pidDir: string): TempPidFile[] {
  if (!existsSync(pidDir)) {
    return [];
  }

  try {
    return readdirSync(pidDir).reduce<TempPidFile[]>((found, file) => {
      const writerPid = /\.pid\.(\d+)\.tmp$/.exec(file)?.[1];
      if (writerPid !== undefined) {
        found.push({ path: join(pidDir, file), writerPid: parseInt(writerPid, 10) });
      }
      return found;
    }, []);
  } catch {
    return [];
  }
}

/**
 * Delete a file listed by `listTempPidFiles`. Returns false if it is already
 * gone or could not be removed — a concurrent writer may have just renamed it.
 */
export function deleteTempPidFile(path: string): boolean {
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
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
      startTime: record?.startTime ?? null,
    };
  });
}
