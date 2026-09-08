import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  getPidFilePath,
  readPid,
  readPidRecord,
  writeIdentityEvidence,
  writePid,
  deletePid,
  listPids,
  getPidFileMtime,
} from './pid.js';

const TEST_DIR = '.test-just-one';

describe('PID operations', () => {
  beforeEach(() => {
    // Clean up test directory before each test
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test directory after each test
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe('getPidFilePath', () => {
    it('returns correct path for simple name', () => {
      const path = getPidFilePath('myapp', TEST_DIR);
      expect(path).toBe(join(TEST_DIR, 'myapp.pid'));
    });

    it('returns correct path for name with dashes', () => {
      const path = getPidFilePath('my-cool-app', TEST_DIR);
      expect(path).toBe(join(TEST_DIR, 'my-cool-app.pid'));
    });

    it('returns correct path for custom directory', () => {
      const path = getPidFilePath('myapp', '/custom/path');
      expect(path).toBe(join('/custom/path', 'myapp.pid'));
    });
  });

  describe('readPid', () => {
    it('returns null when PID file does not exist', () => {
      const pid = readPid('nonexistent', TEST_DIR);
      expect(pid).toBeNull();
    });

    it('reads PID from file', () => {
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(join(TEST_DIR, 'myapp.pid'), '12345', 'utf8');

      const pid = readPid('myapp', TEST_DIR);
      expect(pid).toBe(12345);
    });

    it('handles whitespace in PID file', () => {
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(join(TEST_DIR, 'myapp.pid'), '  12345  \n', 'utf8');

      const pid = readPid('myapp', TEST_DIR);
      expect(pid).toBe(12345);
    });

    it('returns null for invalid PID (non-numeric)', () => {
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(join(TEST_DIR, 'myapp.pid'), 'not-a-number', 'utf8');

      const pid = readPid('myapp', TEST_DIR);
      expect(pid).toBeNull();
    });

    it('returns null for invalid PID (zero)', () => {
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(join(TEST_DIR, 'myapp.pid'), '0', 'utf8');

      const pid = readPid('myapp', TEST_DIR);
      expect(pid).toBeNull();
    });

    it('returns null for invalid PID (negative)', () => {
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(join(TEST_DIR, 'myapp.pid'), '-1', 'utf8');

      const pid = readPid('myapp', TEST_DIR);
      expect(pid).toBeNull();
    });

    it('returns null for empty file', () => {
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(join(TEST_DIR, 'myapp.pid'), '', 'utf8');

      const pid = readPid('myapp', TEST_DIR);
      expect(pid).toBeNull();
    });
  });

  describe('writePid', () => {
    it('creates directory and writes PID file', () => {
      writePid('myapp', 12345, TEST_DIR);

      expect(existsSync(TEST_DIR)).toBe(true);
      const content = readFileSync(join(TEST_DIR, 'myapp.pid'), 'utf8');
      expect(content).toBe('12345');
    });

    it('overwrites existing PID file', () => {
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(join(TEST_DIR, 'myapp.pid'), '11111', 'utf8');

      writePid('myapp', 22222, TEST_DIR);

      const content = readFileSync(join(TEST_DIR, 'myapp.pid'), 'utf8');
      expect(content).toBe('22222');
    });

    it('works with nested directory', () => {
      const nestedDir = join(TEST_DIR, 'nested', 'path');
      writePid('myapp', 12345, nestedDir);

      expect(existsSync(nestedDir)).toBe(true);
      const content = readFileSync(join(nestedDir, 'myapp.pid'), 'utf8');
      expect(content).toBe('12345');
    });
  });

  describe('deletePid', () => {
    it('returns false when PID file does not exist', () => {
      const result = deletePid('nonexistent', TEST_DIR);
      expect(result).toBe(false);
    });

    it('deletes PID file and returns true', () => {
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(join(TEST_DIR, 'myapp.pid'), '12345', 'utf8');

      const result = deletePid('myapp', TEST_DIR);
      expect(result).toBe(true);
      expect(existsSync(join(TEST_DIR, 'myapp.pid'))).toBe(false);
    });

    it('keeps directory after deleting PID file', () => {
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(join(TEST_DIR, 'myapp.pid'), '12345', 'utf8');

      deletePid('myapp', TEST_DIR);
      expect(existsSync(TEST_DIR)).toBe(true);
    });
  });

  describe('listPids', () => {
    it('returns empty array when directory does not exist', () => {
      const pids = listPids(TEST_DIR);
      expect(pids).toEqual([]);
    });

    it('returns empty array when directory is empty', () => {
      mkdirSync(TEST_DIR, { recursive: true });

      const pids = listPids(TEST_DIR);
      expect(pids).toEqual([]);
    });

    it('lists all PID files', () => {
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(join(TEST_DIR, 'app1.pid'), '111', 'utf8');
      writeFileSync(join(TEST_DIR, 'app2.pid'), '222', 'utf8');
      writeFileSync(join(TEST_DIR, 'app3.pid'), '333', 'utf8');

      const pids = listPids(TEST_DIR);
      expect(pids).toHaveLength(3);

      const names = pids.map(p => p.name).sort();
      expect(names).toEqual(['app1', 'app2', 'app3']);
    });

    it('ignores non-.pid files', () => {
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(join(TEST_DIR, 'app1.pid'), '111', 'utf8');
      writeFileSync(join(TEST_DIR, 'readme.txt'), 'hello', 'utf8');
      writeFileSync(join(TEST_DIR, 'config.json'), '{}', 'utf8');

      const pids = listPids(TEST_DIR);
      expect(pids).toHaveLength(1);
      expect(pids[0]?.name).toBe('app1');
    });

    it('reports correct PID values', () => {
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(join(TEST_DIR, 'app1.pid'), '12345', 'utf8');
      writeFileSync(join(TEST_DIR, 'app2.pid'), '67890', 'utf8');

      const pids = listPids(TEST_DIR);
      const app1 = pids.find(p => p.name === 'app1');
      const app2 = pids.find(p => p.name === 'app2');

      expect(app1?.pid).toBe(12345);
      expect(app2?.pid).toBe(67890);
    });

    it('handles invalid PID files gracefully', () => {
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(join(TEST_DIR, 'valid.pid'), '12345', 'utf8');
      writeFileSync(join(TEST_DIR, 'invalid.pid'), 'not-a-number', 'utf8');

      const pids = listPids(TEST_DIR);
      expect(pids).toHaveLength(2);

      const valid = pids.find(p => p.name === 'valid');
      const invalid = pids.find(p => p.name === 'invalid');

      expect(valid?.pid).toBe(12345);
      expect(valid?.exists).toBe(true);
      expect(invalid?.pid).toBe(0);
      expect(invalid?.exists).toBe(false);
    });
  });

  describe('readPidRecord', () => {
    it('round-trips a PID written with start ticks', () => {
      writePid('ticks-test', 12345, TEST_DIR, { startTicks: 987654 });

      expect(readPidRecord('ticks-test', TEST_DIR)).toEqual({
        pid: 12345,
        startTicks: 987654,
        startTime: null,
      });
      expect(readPid('ticks-test', TEST_DIR)).toBe(12345);
    });

    it('reads a legacy bare-PID file with no start ticks', () => {
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(join(TEST_DIR, 'legacy.pid'), '12345', 'utf8');

      expect(readPidRecord('legacy', TEST_DIR)).toEqual({
        pid: 12345,
        startTicks: null,
        startTime: null,
      });
    });

    it('omits start ticks when none are supplied', () => {
      writePid('no-ticks', 12345, TEST_DIR);

      expect(readFileSync(join(TEST_DIR, 'no-ticks.pid'), 'utf8')).toBe('12345');
      expect(readPidRecord('no-ticks', TEST_DIR)?.startTicks).toBeNull();
    });

    it('exposes start ticks through listPids', () => {
      writePid('listed', 12345, TEST_DIR, { startTicks: 555 });

      expect(listPids(TEST_DIR).find(p => p.name === 'listed')?.startTicks).toBe(555);
    });
  });

  // Files written by other just-one versions, or touched by other tooling, must
  // stay readable — the parser's tolerance is the backwards-compatibility contract.
  describe('PID file format compatibility', () => {
    function writeRaw(name: string, content: string): void {
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(join(TEST_DIR, `${name}.pid`), content, 'utf8');
    }

    it('reads a file with CRLF line endings', () => {
      writeRaw('crlf', '12345\r\nstartTicks=999\r\n');

      expect(readPidRecord('crlf', TEST_DIR)).toEqual({
        pid: 12345,
        startTicks: 999,
        startTime: null,
      });
    });

    it('ignores a non-numeric startTicks value and falls back to no ticks', () => {
      writeRaw('garbage', '12345\nstartTicks=not-a-number');

      expect(readPidRecord('garbage', TEST_DIR)).toEqual({
        pid: 12345,
        startTicks: null,
        startTime: null,
      });
    });

    // Number('') is 0, so an empty value must be rejected before it becomes
    // evidence of 0 — which would hard-reject a live process on the exact branch
    it('treats an empty startTime value as absent, not as zero', () => {
      writeRaw('empty-time', '12345\nstartTime=');

      expect(readPidRecord('empty-time', TEST_DIR)?.startTime).toBeNull();
    });

    it('treats an empty startTicks value as absent, not as zero', () => {
      writeRaw('empty-ticks', '12345\nstartTicks=   ');

      expect(readPidRecord('empty-ticks', TEST_DIR)?.startTicks).toBeNull();
    });

    it('ignores unknown keys a future version might add', () => {
      writeRaw('future', '12345\nsomethingNew=abc\nstartTicks=777');

      expect(readPidRecord('future', TEST_DIR)).toEqual({
        pid: 12345,
        startTicks: 777,
        startTime: null,
      });
    });

    it('rejects a file whose first line is not a PID', () => {
      writeRaw('bogus', 'startTicks=777\n12345');

      expect(readPidRecord('bogus', TEST_DIR)).toBeNull();
    });

    it('reads a startTime evidence key', () => {
      writeRaw('wintime', '12345\nstartTime=1788887025388');

      expect(readPidRecord('wintime', TEST_DIR)).toEqual({
        pid: 12345,
        startTicks: null,
        startTime: 1788887025388,
      });
    });

    it('ignores a non-numeric startTime value and falls back to no evidence', () => {
      writeRaw('bad-time', '12345\nstartTime=not-a-number');

      expect(readPidRecord('bad-time', TEST_DIR)?.startTime).toBeNull();
    });

    it('surfaces both evidence keys when a file somehow carries both', () => {
      writeRaw('both', '12345\nstartTicks=777\nstartTime=888');

      expect(readPidRecord('both', TEST_DIR)).toEqual({
        pid: 12345,
        startTicks: 777,
        startTime: 888,
      });
    });

    it('writes only the ticks key when both kinds of evidence are supplied', () => {
      writePid('one-key', 12345, TEST_DIR, { startTicks: 777, startTime: 888 });

      expect(readFileSync(join(TEST_DIR, 'one-key.pid'), 'utf8')).toBe('12345\nstartTicks=777');
    });

    it('writes a bare PID when the evidence object carries nothing', () => {
      writePid('empty-evidence', 12345, TEST_DIR, { startTicks: null, startTime: null });

      expect(readFileSync(join(TEST_DIR, 'empty-evidence.pid'), 'utf8')).toBe('12345');
    });

    it('keeps the PID on the first line so older versions can parse it', () => {
      writePid('legible', 12345, TEST_DIR, { startTicks: 999 });

      const content = readFileSync(join(TEST_DIR, 'legible.pid'), 'utf8');
      // Older versions parseInt the whole file, which stops at the newline
      expect(parseInt(content, 10)).toBe(12345);
    });
  });

  describe('writeIdentityEvidence', () => {
    it('records ticks into a legacy bare-PID file', () => {
      writePid('backfill', 12345, TEST_DIR);

      writeIdentityEvidence('backfill', TEST_DIR, { startTicks: 4242 });

      expect(readPidRecord('backfill', TEST_DIR)).toEqual({
        pid: 12345,
        startTicks: 4242,
        startTime: null,
      });
    });

    it('records a start time into a legacy bare-PID file', () => {
      writePid('backfill-time', 12345, TEST_DIR);

      writeIdentityEvidence('backfill-time', TEST_DIR, { startTime: 1788887025388 });

      expect(readPidRecord('backfill-time', TEST_DIR)).toEqual({
        pid: 12345,
        startTicks: null,
        startTime: 1788887025388,
      });
    });

    it('preserves the file mtime so older versions still verify the process', () => {
      writePid('preserve', 12345, TEST_DIR);
      const before = getPidFileMtime('preserve', TEST_DIR);

      writeIdentityEvidence('preserve', TEST_DIR, { startTicks: 4242 });

      expect(getPidFileMtime('preserve', TEST_DIR)).toBe(before);
    });

    it('does nothing when the PID file is missing', () => {
      writeIdentityEvidence('absent', TEST_DIR, { startTicks: 4242 });

      expect(readPidRecord('absent', TEST_DIR)).toBeNull();
    });

    it('leaves no temporary file behind', () => {
      writePid('atomic', 12345, TEST_DIR);

      writeIdentityEvidence('atomic', TEST_DIR, { startTime: 999 });

      expect(readdirSync(TEST_DIR).filter(f => f.startsWith('atomic'))).toEqual(['atomic.pid']);
    });
  });

  describe('getPidFileMtime', () => {
    it('returns mtime for existing PID file', () => {
      const before = Date.now();
      writePid('mtime-test', 12345, TEST_DIR);
      const after = Date.now();

      const mtime = getPidFileMtime('mtime-test', TEST_DIR);
      expect(mtime).not.toBeNull();
      // Allow 100ms tolerance for file system timing variations
      expect(mtime).toBeGreaterThanOrEqual(before - 100);
      expect(mtime).toBeLessThanOrEqual(after + 100);
    });

    it('returns null for non-existent PID file', () => {
      const mtime = getPidFileMtime('nonexistent', TEST_DIR);
      expect(mtime).toBeNull();
    });
  });
});
