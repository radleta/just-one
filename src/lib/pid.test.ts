import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { getPidFilePath, readPid, writePid, deletePid, listPids, getPidFileMtime } from './pid.js';

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
