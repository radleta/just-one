/**
 * End-to-end tests for just-one CLI
 * These tests run the actual CLI binary and verify full workflows
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, execSync, ChildProcess } from 'child_process';
import { existsSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const CLI_PATH = join(__dirname, '../../dist/index.js');
const TEST_PID_DIR = join(__dirname, '../../.test-pids');

// Helper to run CLI and capture output
function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('node', [CLI_PATH, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });

    child.on('error', (err) => {
      resolve({ code: 1, stdout, stderr: err.message });
    });
  });
}

// Helper to start a long-running process via CLI
function startProcess(name: string, pidDir: string = TEST_PID_DIR): ChildProcess {
  const isWindows = process.platform === 'win32';
  const sleepCmd = isWindows ? 'ping' : 'sleep';
  const sleepArgs = isWindows ? ['-n', '60', '127.0.0.1'] : ['60'];

  const child = spawn('node', [
    CLI_PATH,
    '-n', name,
    '-d', pidDir,
    '--',
    sleepCmd,
    ...sleepArgs,
  ], {
    stdio: 'pipe',
    detached: false,
  });

  return child;
}

// Helper to wait for PID file to exist
async function waitForPidFile(name: string, pidDir: string = TEST_PID_DIR, timeoutMs: number = 5000): Promise<boolean> {
  const pidFile = join(pidDir, `${name}.pid`);
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (existsSync(pidFile)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

// Helper to read PID from file
function readPidFile(name: string, pidDir: string = TEST_PID_DIR): number | null {
  const pidFile = join(pidDir, `${name}.pid`);
  if (!existsSync(pidFile)) {
    return null;
  }
  const content = readFileSync(pidFile, 'utf8').trim();
  const pid = parseInt(content, 10);
  return isNaN(pid) ? null : pid;
}

// Helper to check if process is running (cross-platform)
function isProcessRunning(pid: number): boolean {
  try {
    if (process.platform === 'win32') {
      // On Windows, use tasklist like the actual CLI does
      const output = execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output.includes(String(pid));
    } else {
      process.kill(pid, 0);
      return true;
    }
  } catch {
    return false;
  }
}

describe('CLI E2E Tests', () => {
  beforeEach(() => {
    // Clean up test PID directory
    if (existsSync(TEST_PID_DIR)) {
      rmSync(TEST_PID_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_PID_DIR, { recursive: true });
  });

  afterEach(() => {
    // Clean up test PID directory
    if (existsSync(TEST_PID_DIR)) {
      rmSync(TEST_PID_DIR, { recursive: true, force: true });
    }
  });

  describe('Help and Version', () => {
    it('shows help with --help', async () => {
      const result = await runCli(['--help']);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('just-one');
      expect(result.stdout).toContain('Usage:');
      expect(result.stdout).toContain('Options:');
      expect(result.stdout).toContain('Examples:');
    });

    it('shows help with -h', async () => {
      const result = await runCli(['-h']);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Usage:');
    });

    it('shows version with --version', async () => {
      const result = await runCli(['--version']);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    });

    it('shows version with -v', async () => {
      const result = await runCli(['-v']);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe('Error Handling', () => {
    it('errors when --name is missing for run', async () => {
      const result = await runCli(['--', 'echo', 'test']);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('--name is required');
    });

    it('errors when command is missing', async () => {
      const result = await runCli(['-n', 'test']);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('No command specified');
    });

    it('errors for unknown option', async () => {
      const result = await runCli(['--unknown-option']);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Unknown option');
    });

    it('errors for path traversal in name', async () => {
      const result = await runCli(['-n', '../etc/passwd', '--', 'echo']);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Invalid name');
    });

    it('errors for path traversal in pid-dir', async () => {
      const result = await runCli(['-d', '../../../etc', '-n', 'test', '--', 'echo']);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Invalid PID directory');
    });
  });

  describe('List Command', () => {
    it('shows empty list when no processes tracked', async () => {
      const result = await runCli(['-l', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('No tracked processes');
    });

    it('lists tracked processes', async () => {
      // Start a process
      const child = startProcess('test-list');

      // Wait for PID file to be created
      const pidCreated = await waitForPidFile('test-list');
      expect(pidCreated).toBe(true);

      // List processes
      const result = await runCli(['-l', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('test-list');
      expect(result.stdout).toContain('running');

      // Cleanup
      child.kill();
    });
  });

  describe('Kill Command', () => {
    it('handles killing non-existent process gracefully', async () => {
      const result = await runCli(['-k', 'nonexistent', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('No process found');
    });

    it('kills a running process', async () => {
      const isWindows = process.platform === 'win32';

      // Start a process
      const child = startProcess('test-kill');

      // Wait for PID file
      const pidCreated = await waitForPidFile('test-kill');
      expect(pidCreated).toBe(true);

      const pid = readPidFile('test-kill');
      expect(pid).not.toBeNull();

      // Give process time to fully start (longer on Windows)
      await new Promise((resolve) => setTimeout(resolve, isWindows ? 2000 : 500));
      expect(isProcessRunning(pid!)).toBe(true);

      // Kill it
      const result = await runCli(['-k', 'test-kill', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('killed');

      // Wait a bit for process to die
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify it's dead
      expect(isProcessRunning(pid!)).toBe(false);

      // Cleanup
      child.kill();
    });
  });

  describe('Run Command', () => {
    it('runs a simple command and creates PID file', async () => {
      const child = startProcess('test-run');

      // Wait for PID file
      const pidCreated = await waitForPidFile('test-run');
      expect(pidCreated).toBe(true);

      // Verify PID file content
      const pid = readPidFile('test-run');
      expect(pid).not.toBeNull();
      expect(pid).toBeGreaterThan(0);

      // Verify process is running
      expect(isProcessRunning(pid!)).toBe(true);

      // Cleanup
      child.kill();
    });

    it('kills previous instance when starting new one', async () => {
      const isWindows = process.platform === 'win32';
      // Use ping on Windows (no special chars), sleep on Unix
      const sleepCmd = isWindows ? 'ping' : 'sleep';
      const sleepArgs = isWindows ? ['-n', '60', '127.0.0.1'] : ['60'];

      // First CLI invocation - starts a long-running process
      const child1 = spawn('node', [
        CLI_PATH,
        '-n', 'test-replace',
        '-d', TEST_PID_DIR,
        '--',
        sleepCmd,
        ...sleepArgs,
      ], { stdio: 'pipe' });

      // Wait for PID file
      const pidCreated1 = await waitForPidFile('test-replace');
      expect(pidCreated1).toBe(true);

      const pid1 = readPidFile('test-replace');
      expect(pid1).not.toBeNull();

      // Give it time to fully start (longer on Windows)
      await new Promise((resolve) => setTimeout(resolve, isWindows ? 2000 : 1000));

      // Verify process is running
      expect(isProcessRunning(pid1!)).toBe(true);

      // Second CLI invocation - should kill first and start new
      const child2 = spawn('node', [
        CLI_PATH,
        '-n', 'test-replace',
        '-d', TEST_PID_DIR,
        '--',
        sleepCmd,
        ...sleepArgs,
      ], { stdio: 'pipe' });

      // Wait for kill + respawn (longer on Windows due to taskkill)
      await new Promise((resolve) => setTimeout(resolve, isWindows ? 5000 : 3000));

      // First process should be dead
      expect(isProcessRunning(pid1!)).toBe(false);

      // PID file should exist with new PID
      const pid2 = readPidFile('test-replace');
      expect(pid2).not.toBeNull();
      // Note: We don't assert pid2 !== pid1 because PIDs can be reused by the OS
      // The important invariants are: old process dead (above), new process alive (below)

      // Second process should be alive
      expect(isProcessRunning(pid2!)).toBe(true);

      // Cleanup - kill both parent shells and their children
      child1.kill();
      child2.kill();
      // Also kill the spawned processes directly
      if (pid1 && isProcessRunning(pid1)) {
        try {
          if (isWindows) {
            execSync(`taskkill /PID ${pid1} /T /F`, { stdio: 'pipe' });
          } else {
            process.kill(pid1);
          }
        } catch { /* ignore */ }
      }
      if (pid2 && isProcessRunning(pid2)) {
        try {
          if (isWindows) {
            execSync(`taskkill /PID ${pid2} /T /F`, { stdio: 'pipe' });
          } else {
            process.kill(pid2);
          }
        } catch { /* ignore */ }
      }
    });
  });

  describe('Quiet Mode', () => {
    it('suppresses output in quiet mode for list', async () => {
      const result = await runCli(['-l', '-q', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('');
    });

    it('suppresses output in quiet mode for kill', async () => {
      const result = await runCli(['-k', 'nonexistent', '-q', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('');
    });
  });

  describe('Custom PID Directory', () => {
    it('uses custom PID directory', async () => {
      const customDir = join(TEST_PID_DIR, 'custom');
      mkdirSync(customDir, { recursive: true });

      const child = startProcess('test-custom', customDir);

      const pidCreated = await waitForPidFile('test-custom', customDir);
      expect(pidCreated).toBe(true);

      // Verify file is in custom directory
      expect(existsSync(join(customDir, 'test-custom.pid'))).toBe(true);
      expect(existsSync(join(TEST_PID_DIR, 'test-custom.pid'))).toBe(false);

      child.kill();
    });
  });
});

describe('Edge Cases', () => {
  beforeEach(() => {
    if (existsSync(TEST_PID_DIR)) {
      rmSync(TEST_PID_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_PID_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_PID_DIR)) {
      rmSync(TEST_PID_DIR, { recursive: true, force: true });
    }
  });

  it('handles names with hyphens and underscores', async () => {
    const result = await runCli(['-n', 'my-test_app-v1', '-d', TEST_PID_DIR, '--', 'node', '-e', 'process.exit(0)']);
    // Command exits immediately, which is fine
    expect(result.code).toBe(0);
  });

  it('handles very long but valid names', async () => {
    const longName = 'a'.repeat(200);
    const result = await runCli(['-n', longName, '-d', TEST_PID_DIR, '--', 'node', '-e', 'process.exit(0)']);
    expect(result.code).toBe(0);
  });

  it('rejects names that are too long', async () => {
    const tooLongName = 'a'.repeat(256);
    const result = await runCli(['-n', tooLongName, '-d', TEST_PID_DIR, '--', 'echo']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Invalid name');
  });

  it('handles orphaned PID files (process no longer exists)', async () => {
    const isWindows = process.platform === 'win32';

    // Create orphaned PID file with non-existent PID
    mkdirSync(TEST_PID_DIR, { recursive: true });
    const fs = await import('fs');
    fs.writeFileSync(join(TEST_PID_DIR, 'orphaned.pid'), '999999999', 'utf8');

    // List should show it as stopped (not running)
    const listResult = await runCli(['-l', '-d', TEST_PID_DIR]);
    expect(listResult.stdout).toContain('orphaned');
    expect(listResult.stdout).toContain('stopped');

    // Starting a new process with same name should work
    // The CLI should detect the process is dead and start a new one
    // Use ping on Windows (no special chars), sleep on Unix
    const sleepCmd = isWindows ? 'ping' : 'sleep';
    const sleepArgs = isWindows ? ['-n', '60', '127.0.0.1'] : ['60'];

    const child = spawn('node', [
      CLI_PATH,
      '-n', 'orphaned',
      '-d', TEST_PID_DIR,
      '--',
      sleepCmd,
      ...sleepArgs,
    ], { stdio: 'pipe' });

    // Wait for PID file to be updated
    await new Promise((resolve) => setTimeout(resolve, isWindows ? 3000 : 1000));

    const pid = readPidFile('orphaned');
    expect(pid).not.toBeNull();
    // New PID should be different from the orphaned one
    expect(pid).not.toBe(999999999);

    // Give process more time to stabilize on Windows
    await new Promise((resolve) => setTimeout(resolve, isWindows ? 2000 : 500));
    expect(isProcessRunning(pid!)).toBe(true);

    // Cleanup
    child.kill();
    if (pid && isProcessRunning(pid)) {
      try {
        if (isWindows) {
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'pipe' });
        } else {
          process.kill(pid);
        }
      } catch { /* ignore */ }
    }
  });
});
