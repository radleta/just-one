import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { buildWindowsCommandLine, spawnDetachedWithoutInheritance } from './windows-spawn.js';

describe('buildWindowsCommandLine', () => {
  it('leaves arguments with no space, tab or quote as they are', () => {
    expect(buildWindowsCommandLine('node.exe', ['-n', 'a\\b', 'x.js'])).toBe(
      'node.exe -n a\\b x.js'
    );
  });

  it('writes an empty argument as ""', () => {
    expect(buildWindowsCommandLine('node', ['', 'x'])).toBe('node "" x');
  });

  it('wraps arguments containing a space or tab in quotes', () => {
    expect(buildWindowsCommandLine('C:\\Program Files\\node.exe', ['a b', 'c\td'])).toBe(
      '"C:\\Program Files\\node.exe" "a b" "c\td"'
    );
  });

  it('escapes quotes and doubles the backslashes before them', () => {
    expect(buildWindowsCommandLine('n', ['q"uote'])).toBe('n "q\\"uote"');
    expect(buildWindowsCommandLine('n', ['a\\"b'])).toBe('n "a\\\\\\"b"');
  });

  it('doubles trailing backslashes before the closing quote only', () => {
    expect(buildWindowsCommandLine('n', ['dir name\\'])).toBe('n "dir name\\\\"');
    expect(buildWindowsCommandLine('n', ['trail\\'])).toBe('n trail\\');
  });
});

describe('spawnDetachedWithoutInheritance', () => {
  const TEST_DIR = join(__dirname, '../../.test-windows-spawn');
  let childPid: number | undefined;

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (childPid !== undefined) {
      try {
        execSync(`taskkill /PID ${childPid} /T /F`, { stdio: 'pipe' });
      } catch {
        // already exited
      }
      childPid = undefined;
    }
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('round-trips every argument and returns the child PID', async () => {
    if (process.platform !== 'win32') return;

    const dumpScript = join(TEST_DIR, '_argv-dump.cjs');
    const outPath = join(TEST_DIR, 'out.json');
    writeFileSync(
      dumpScript,
      `require('fs').writeFileSync(process.argv[2], JSON.stringify({ argv: process.argv.slice(3), pid: process.pid }));`
    );
    const args = ['a b', 'q"uote', 'trail\\', '', "it's [a] ‘b’"];

    childPid = spawnDetachedWithoutInheritance(process.execPath, [dumpScript, outPath, ...args]);

    const start = Date.now();
    while (!existsSync(outPath) && Date.now() - start < 10000) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const result = JSON.parse(readFileSync(outPath, 'utf8'));
    expect(result.argv).toEqual(args);
    expect(result.pid).toBe(childPid);
  });

  it('reports the real Windows error code when CreateProcessW fails', () => {
    if (process.platform !== 'win32') return;

    // A missing file in an existing directory is ERROR_FILE_NOT_FOUND (2); a
    // missing directory is ERROR_PATH_NOT_FOUND (3).
    expect(() => spawnDetachedWithoutInheritance(join(TEST_DIR, 'no-such-file.exe'), [])).toThrow(
      /^CreateProcessW failed with Windows error 2;/
    );
    expect(() => spawnDetachedWithoutInheritance('C:\\no\\such\\file.exe', [])).toThrow(
      /^CreateProcessW failed with Windows error 3;/
    );
  });
});
