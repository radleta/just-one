import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import {
  getLogFilePath,
  getBackupLogFilePath,
  getLogFileSize,
  rotateLogIfNeeded,
  readLogLines,
  tailLogFile,
  deleteLogFiles,
} from './log.js';

const TEST_DIR = '.test-just-one-log';

describe('Log operations', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe('getLogFilePath', () => {
    it('returns correct path for simple name', () => {
      const path = getLogFilePath('myapp', TEST_DIR);
      expect(path).toBe(join(TEST_DIR, 'myapp.log'));
    });

    it('returns correct path for name with dashes', () => {
      const path = getLogFilePath('my-cool-app', TEST_DIR);
      expect(path).toBe(join(TEST_DIR, 'my-cool-app.log'));
    });

    it('returns correct path for custom directory', () => {
      const path = getLogFilePath('myapp', '/custom/path');
      expect(path).toBe(join('/custom/path', 'myapp.log'));
    });
  });

  describe('getBackupLogFilePath', () => {
    it('returns correct backup path', () => {
      const path = getBackupLogFilePath('myapp', TEST_DIR);
      expect(path).toBe(join(TEST_DIR, 'myapp.log.1'));
    });

    it('returns correct backup path for custom directory', () => {
      const path = getBackupLogFilePath('myapp', '/custom/path');
      expect(path).toBe(join('/custom/path', 'myapp.log.1'));
    });
  });

  describe('getLogFileSize', () => {
    it('returns 0 when log file does not exist', () => {
      const size = getLogFileSize('nonexistent', TEST_DIR);
      expect(size).toBe(0);
    });

    it('returns correct size for existing file', () => {
      const logPath = getLogFilePath('myapp', TEST_DIR);
      writeFileSync(logPath, 'hello world\n');
      const size = getLogFileSize('myapp', TEST_DIR);
      expect(size).toBe(12); // "hello world\n"
    });

    it('returns 0 for empty file', () => {
      const logPath = getLogFilePath('myapp', TEST_DIR);
      writeFileSync(logPath, '');
      const size = getLogFileSize('myapp', TEST_DIR);
      expect(size).toBe(0);
    });
  });

  describe('rotateLogIfNeeded', () => {
    it('does not rotate when file is under max size', () => {
      const logPath = getLogFilePath('myapp', TEST_DIR);
      writeFileSync(logPath, 'small content\n');

      const rotated = rotateLogIfNeeded('myapp', TEST_DIR, 1024);
      expect(rotated).toBe(false);
      expect(existsSync(logPath)).toBe(true);
    });

    it('rotates when file exceeds max size', () => {
      const logPath = getLogFilePath('myapp', TEST_DIR);
      const backupPath = getBackupLogFilePath('myapp', TEST_DIR);
      writeFileSync(logPath, 'x'.repeat(200));

      const rotated = rotateLogIfNeeded('myapp', TEST_DIR, 100);
      expect(rotated).toBe(true);
      expect(existsSync(logPath)).toBe(false);
      expect(existsSync(backupPath)).toBe(true);
      expect(readFileSync(backupPath, 'utf8')).toBe('x'.repeat(200));
    });

    it('overwrites existing backup on rotation', () => {
      const logPath = getLogFilePath('myapp', TEST_DIR);
      const backupPath = getBackupLogFilePath('myapp', TEST_DIR);

      writeFileSync(backupPath, 'old backup content');
      writeFileSync(logPath, 'y'.repeat(200));

      const rotated = rotateLogIfNeeded('myapp', TEST_DIR, 100);
      expect(rotated).toBe(true);
      expect(readFileSync(backupPath, 'utf8')).toBe('y'.repeat(200));
    });

    it('does not rotate when file does not exist', () => {
      const rotated = rotateLogIfNeeded('nonexistent', TEST_DIR, 100);
      expect(rotated).toBe(false);
    });

    it('does not rotate when file is exactly at max size', () => {
      const logPath = getLogFilePath('myapp', TEST_DIR);
      writeFileSync(logPath, 'x'.repeat(100));

      const rotated = rotateLogIfNeeded('myapp', TEST_DIR, 100);
      expect(rotated).toBe(false);
    });

    it('uses default max size of 10MB', () => {
      const logPath = getLogFilePath('myapp', TEST_DIR);
      writeFileSync(logPath, 'small');

      const rotated = rotateLogIfNeeded('myapp', TEST_DIR);
      expect(rotated).toBe(false);
    });
  });

  describe('readLogLines', () => {
    it('returns empty array when file does not exist', () => {
      const lines = readLogLines('nonexistent', TEST_DIR);
      expect(lines).toEqual([]);
    });

    it('returns empty array for empty file', () => {
      const logPath = getLogFilePath('myapp', TEST_DIR);
      writeFileSync(logPath, '');

      const lines = readLogLines('myapp', TEST_DIR);
      expect(lines).toEqual([]);
    });

    it('returns all lines', () => {
      const logPath = getLogFilePath('myapp', TEST_DIR);
      writeFileSync(logPath, 'line1\nline2\nline3\n');

      const lines = readLogLines('myapp', TEST_DIR);
      expect(lines).toEqual(['line1', 'line2', 'line3']);
    });

    it('returns last N lines', () => {
      const logPath = getLogFilePath('myapp', TEST_DIR);
      writeFileSync(logPath, 'line1\nline2\nline3\nline4\nline5\n');

      const lines = readLogLines('myapp', TEST_DIR, 3);
      expect(lines).toEqual(['line3', 'line4', 'line5']);
    });

    it('returns all lines when N exceeds total', () => {
      const logPath = getLogFilePath('myapp', TEST_DIR);
      writeFileSync(logPath, 'line1\nline2\n');

      const lines = readLogLines('myapp', TEST_DIR, 10);
      expect(lines).toEqual(['line1', 'line2']);
    });

    it('returns empty array when N is 0', () => {
      const logPath = getLogFilePath('myapp', TEST_DIR);
      writeFileSync(logPath, 'line1\nline2\n');

      const lines = readLogLines('myapp', TEST_DIR, 0);
      expect(lines).toEqual([]);
    });

    it('handles content without trailing newline', () => {
      const logPath = getLogFilePath('myapp', TEST_DIR);
      writeFileSync(logPath, 'line1\nline2');

      const lines = readLogLines('myapp', TEST_DIR);
      expect(lines).toEqual(['line1', 'line2']);
    });

    it('handles single line', () => {
      const logPath = getLogFilePath('myapp', TEST_DIR);
      writeFileSync(logPath, 'only line\n');

      const lines = readLogLines('myapp', TEST_DIR);
      expect(lines).toEqual(['only line']);
    });
  });

  describe('tailLogFile', () => {
    it('emits initial lines from existing content', () => {
      const logPath = getLogFilePath('myapp', TEST_DIR);
      writeFileSync(logPath, 'line1\nline2\nline3\n');

      const received: string[] = [];
      const handle = tailLogFile('myapp', TEST_DIR, {
        onLine: line => received.push(line),
        initialLines: 2,
        pollIntervalMs: 100,
      });

      // Initial lines are emitted synchronously
      expect(received).toEqual(['line2', 'line3']);

      handle.stop();
    });

    it('emits new content appended to the file', async () => {
      const logPath = getLogFilePath('myapp', TEST_DIR);
      writeFileSync(logPath, 'existing\n');

      const received: string[] = [];
      const handle = tailLogFile('myapp', TEST_DIR, {
        onLine: line => received.push(line),
        pollIntervalMs: 100,
      });

      // Append new content
      appendFileSync(logPath, 'new line 1\nnew line 2\n');

      // Wait for polling to pick it up
      await new Promise(resolve => setTimeout(resolve, 400));

      expect(received).toContain('new line 1');
      expect(received).toContain('new line 2');

      handle.stop();
    });

    it('stops emitting after stop() is called', async () => {
      const logPath = getLogFilePath('myapp', TEST_DIR);
      writeFileSync(logPath, '');

      const received: string[] = [];
      const handle = tailLogFile('myapp', TEST_DIR, {
        onLine: line => received.push(line),
        pollIntervalMs: 100,
      });

      handle.stop();

      appendFileSync(logPath, 'after stop\n');
      await new Promise(resolve => setTimeout(resolve, 300));

      expect(received).toEqual([]);
    });

    it('handles file that does not exist yet', () => {
      const received: string[] = [];
      const handle = tailLogFile('newapp', TEST_DIR, {
        onLine: line => received.push(line),
        initialLines: 5,
        pollIntervalMs: 100,
      });

      // Should not throw, no initial lines emitted
      expect(received).toEqual([]);

      handle.stop();
    });
  });

  describe('deleteLogFiles', () => {
    it('deletes both log and backup files', () => {
      const logPath = getLogFilePath('myapp', TEST_DIR);
      const backupPath = getBackupLogFilePath('myapp', TEST_DIR);
      writeFileSync(logPath, 'log content');
      writeFileSync(backupPath, 'backup content');

      deleteLogFiles('myapp', TEST_DIR);

      expect(existsSync(logPath)).toBe(false);
      expect(existsSync(backupPath)).toBe(false);
    });

    it('handles missing log file', () => {
      const backupPath = getBackupLogFilePath('myapp', TEST_DIR);
      writeFileSync(backupPath, 'backup content');

      deleteLogFiles('myapp', TEST_DIR);

      expect(existsSync(backupPath)).toBe(false);
    });

    it('handles missing backup file', () => {
      const logPath = getLogFilePath('myapp', TEST_DIR);
      writeFileSync(logPath, 'log content');

      deleteLogFiles('myapp', TEST_DIR);

      expect(existsSync(logPath)).toBe(false);
    });

    it('handles both files missing', () => {
      // Should not throw
      deleteLogFiles('nonexistent', TEST_DIR);
    });
  });
});
