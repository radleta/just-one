/**
 * End-to-end tests for just-one CLI
 * These tests run the actual CLI binary and verify full workflows
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, execSync, ChildProcess } from 'child_process';
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

// CLI invocation configuration
// To test the published npm package instead of local build:
//   JUST_ONE_NPX=1 npm test                    # uses npx @radleta/just-one
//   JUST_ONE_NPX=1 JUST_ONE_CLI=@radleta/just-one@1.0.0 npm test  # specific version
const USE_NPX = process.env.JUST_ONE_NPX === '1';
const CLI_PATH = process.env.JUST_ONE_CLI || join(__dirname, '../../dist/index.js');
const TEST_PID_DIR = join(__dirname, '../../.test-pids');

// Get spawn command and args based on configuration
function getCliSpawnArgs(args: string[]): { command: string; args: string[] } {
  if (USE_NPX) {
    return { command: 'npx', args: [CLI_PATH, ...args] };
  }
  return { command: 'node', args: [CLI_PATH, ...args] };
}

// Helper to run CLI and capture output
function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const { command, args: spawnArgs } = getCliSpawnArgs(args);
    const child = spawn(command, spawnArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', data => {
      stdout += data.toString();
    });

    child.stderr?.on('data', data => {
      stderr += data.toString();
    });

    child.on('close', code => {
      resolve({ code: code ?? 1, stdout, stderr });
    });

    child.on('error', err => {
      resolve({ code: 1, stdout, stderr: err.message });
    });
  });
}

// Helper to start a long-running process via CLI
function startProcess(name: string, pidDir: string = TEST_PID_DIR): ChildProcess {
  const isWindows = process.platform === 'win32';
  const sleepCmd = isWindows ? 'ping' : 'sleep';
  const sleepArgs = isWindows ? ['-n', '60', '127.0.0.1'] : ['60'];

  const { command, args } = getCliSpawnArgs([
    '-n',
    name,
    '-d',
    pidDir,
    '--',
    sleepCmd,
    ...sleepArgs,
  ]);

  const child = spawn(command, args, {
    stdio: 'pipe',
    detached: false,
  });

  return child;
}

// Helper to wait for PID file to exist
async function waitForPidFile(
  name: string,
  pidDir: string = TEST_PID_DIR,
  timeoutMs: number = 5000
): Promise<boolean> {
  const pidFile = join(pidDir, `${name}.pid`);
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (existsSync(pidFile)) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
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

// Helper to wait for a process to die with polling (avoids flaky fixed-delay waits)
async function waitForProcessDeath(pid: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (isProcessRunning(pid) && Date.now() - start < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return !isProcessRunning(pid);
}

// Helper to poll for expected content in a file (avoids flaky fixed-delay waits)
async function waitForFileContent(
  filePath: string,
  expected: string,
  timeoutMs: number = 10000
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf8');
      if (content.includes(expected)) {
        return content;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  // Return whatever we have (or empty) so the assertion can report clearly
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
}

// Helper to kill all tracked processes in a PID directory
function killTrackedProcesses(pidDir: string): void {
  if (!existsSync(pidDir)) return;
  const { readdirSync } = require('fs') as typeof import('fs');
  const files = readdirSync(pidDir).filter((f: string) => f.endsWith('.pid'));
  for (const file of files) {
    try {
      const content = readFileSync(join(pidDir, file), 'utf8').trim();
      const pid = parseInt(content, 10);
      if (!isNaN(pid) && isProcessRunning(pid)) {
        if (process.platform === 'win32') {
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'pipe' });
        } else {
          process.kill(pid);
        }
      }
    } catch {
      /* ignore - process may already be dead */
    }
  }
}

// Helper to remove test directory with retries (Windows may hold file locks briefly)
async function cleanTestDir(dir: string): Promise<void> {
  if (!existsSync(dir)) return;
  const maxRetries = process.platform === 'win32' ? 5 : 1;
  for (let i = 0; i < maxRetries; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
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
      await new Promise(resolve => setTimeout(resolve, isWindows ? 2000 : 500));
      expect(isProcessRunning(pid!)).toBe(true);

      // Kill it
      const result = await runCli(['-k', 'test-kill', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('killed');

      // Wait a bit for process to die
      await new Promise(resolve => setTimeout(resolve, 500));

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
      const { command: cmd1, args: args1 } = getCliSpawnArgs([
        '-n',
        'test-replace',
        '-d',
        TEST_PID_DIR,
        '--',
        sleepCmd,
        ...sleepArgs,
      ]);
      const child1 = spawn(cmd1, args1, { stdio: 'pipe' });

      // Wait for PID file
      const pidCreated1 = await waitForPidFile('test-replace');
      expect(pidCreated1).toBe(true);

      const pid1 = readPidFile('test-replace');
      expect(pid1).not.toBeNull();

      // Give it time to fully start (longer on Windows)
      await new Promise(resolve => setTimeout(resolve, isWindows ? 2000 : 1000));

      // Verify process is running
      expect(isProcessRunning(pid1!)).toBe(true);

      // Second CLI invocation - should kill first and start new
      const { command: cmd2, args: args2 } = getCliSpawnArgs([
        '-n',
        'test-replace',
        '-d',
        TEST_PID_DIR,
        '--',
        sleepCmd,
        ...sleepArgs,
      ]);
      const child2 = spawn(cmd2, args2, { stdio: 'pipe' });

      // Wait for first process to die (polling instead of fixed delay)
      const died = await waitForProcessDeath(pid1!, isWindows ? 15000 : 10000);
      expect(died).toBe(true);

      // Poll until PID file has a running process (second CLI may still be writing it)
      let pid2: number | null = null;
      for (let i = 0; i < 50 && !pid2; i++) {
        const candidate = readPidFile('test-replace');
        if (candidate && candidate !== pid1 && isProcessRunning(candidate)) {
          pid2 = candidate;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      expect(pid2).not.toBeNull();
      // Note: The important invariants are: old process dead (above), new process alive (below)
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
        } catch {
          /* ignore */
        }
      }
      if (pid2 && isProcessRunning(pid2)) {
        try {
          if (isWindows) {
            execSync(`taskkill /PID ${pid2} /T /F`, { stdio: 'pipe' });
          } else {
            process.kill(pid2);
          }
        } catch {
          /* ignore */
        }
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

  describe('Status Command', () => {
    it('exits 1 for untracked process', async () => {
      const result = await runCli(['-s', 'nonexistent', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(1);
      expect(result.stdout).toContain('not tracked');
    });

    it('exits 0 for running process', async () => {
      const isWindows = process.platform === 'win32';
      const child = startProcess('test-status');

      const pidCreated = await waitForPidFile('test-status');
      expect(pidCreated).toBe(true);

      // Give process time to fully start
      await new Promise(resolve => setTimeout(resolve, isWindows ? 2000 : 500));

      const result = await runCli(['-s', 'test-status', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('running');

      child.kill();
    });

    it('exits 1 for stopped process with stale PID file', async () => {
      // Create orphaned PID file
      const fs = await import('fs');
      fs.writeFileSync(join(TEST_PID_DIR, 'stopped.pid'), '999999999', 'utf8');

      const result = await runCli(['-s', 'stopped', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(1);
      expect(result.stdout).toContain('stopped');
    });

    it('suppresses output in quiet mode', async () => {
      const result = await runCli(['-s', 'nonexistent', '-q', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe('');
    });
  });

  describe('Kill All Command', () => {
    it('exits 0 when no processes tracked', async () => {
      const result = await runCli(['-K', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('No tracked processes');
    });

    it('kills multiple running processes', async () => {
      const isWindows = process.platform === 'win32';

      const child1 = startProcess('test-ka1');
      const child2 = startProcess('test-ka2');

      const pid1Created = await waitForPidFile('test-ka1');
      const pid2Created = await waitForPidFile('test-ka2');
      expect(pid1Created).toBe(true);
      expect(pid2Created).toBe(true);

      const pid1 = readPidFile('test-ka1');
      const pid2 = readPidFile('test-ka2');

      // Give processes time to fully start
      await new Promise(resolve => setTimeout(resolve, isWindows ? 2000 : 500));

      const result = await runCli(['-K', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('killed');

      // Wait for processes to die
      await new Promise(resolve => setTimeout(resolve, 500));

      if (pid1) expect(isProcessRunning(pid1)).toBe(false);
      if (pid2) expect(isProcessRunning(pid2)).toBe(false);

      child1.kill();
      child2.kill();
    });

    it('suppresses output in quiet mode', async () => {
      const result = await runCli(['-K', '-q', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('');
    });
  });

  describe('Ensure Command', () => {
    it('starts process if not running', async () => {
      const isWindows = process.platform === 'win32';
      const sleepCmd = isWindows ? 'ping' : 'sleep';
      const sleepArgs = isWindows ? ['-n', '60', '127.0.0.1'] : ['60'];

      const { command, args } = getCliSpawnArgs([
        '-n',
        'test-ensure',
        '-e',
        '-d',
        TEST_PID_DIR,
        '--',
        sleepCmd,
        ...sleepArgs,
      ]);
      const child = spawn(command, args, { stdio: 'pipe' });

      const pidCreated = await waitForPidFile('test-ensure');
      expect(pidCreated).toBe(true);

      const pid = readPidFile('test-ensure');
      expect(pid).not.toBeNull();

      await new Promise(resolve => setTimeout(resolve, isWindows ? 2000 : 500));
      expect(isProcessRunning(pid!)).toBe(true);

      child.kill();
      if (pid && isProcessRunning(pid)) {
        try {
          if (isWindows) {
            execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'pipe' });
          } else {
            process.kill(pid);
          }
        } catch {
          /* ignore */
        }
      }
    });

    it('skips restart if already running (PID unchanged)', async () => {
      const isWindows = process.platform === 'win32';
      const sleepCmd = isWindows ? 'ping' : 'sleep';
      const sleepArgs = isWindows ? ['-n', '60', '127.0.0.1'] : ['60'];

      // Start first instance
      const { command: cmd1, args: args1 } = getCliSpawnArgs([
        '-n',
        'test-ensure2',
        '-e',
        '-d',
        TEST_PID_DIR,
        '--',
        sleepCmd,
        ...sleepArgs,
      ]);
      const child1 = spawn(cmd1, args1, { stdio: 'pipe' });

      const pidCreated = await waitForPidFile('test-ensure2');
      expect(pidCreated).toBe(true);

      const pid1 = readPidFile('test-ensure2');
      expect(pid1).not.toBeNull();

      await new Promise(resolve => setTimeout(resolve, isWindows ? 2000 : 500));

      // Second invocation with --ensure should skip
      const result = await runCli([
        '-n',
        'test-ensure2',
        '-e',
        '-d',
        TEST_PID_DIR,
        '--',
        sleepCmd,
        ...sleepArgs,
      ]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('already running');

      // PID should be unchanged
      const pid2 = readPidFile('test-ensure2');
      expect(pid2).toBe(pid1);

      child1.kill();
      if (pid1 && isProcessRunning(pid1)) {
        try {
          if (isWindows) {
            execSync(`taskkill /PID ${pid1} /T /F`, { stdio: 'pipe' });
          } else {
            process.kill(pid1);
          }
        } catch {
          /* ignore */
        }
      }
    });
  });

  describe('Clean Command', () => {
    it('exits 0 with no PID files', async () => {
      const result = await runCli(['--clean', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(0);
    });

    it('removes stale PID files', async () => {
      // Create stale PID file
      const fs = await import('fs');
      fs.writeFileSync(join(TEST_PID_DIR, 'stale.pid'), '999999999', 'utf8');

      const result = await runCli(['--clean', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('stale');

      // PID file should be removed
      expect(existsSync(join(TEST_PID_DIR, 'stale.pid'))).toBe(false);
    });

    it('keeps active PID files while removing stale ones', async () => {
      const isWindows = process.platform === 'win32';

      // Start a real process
      const child = startProcess('test-clean-active');
      const pidCreated = await waitForPidFile('test-clean-active');
      expect(pidCreated).toBe(true);

      await new Promise(resolve => setTimeout(resolve, isWindows ? 2000 : 500));

      // Create a stale PID file
      const fs = await import('fs');
      fs.writeFileSync(join(TEST_PID_DIR, 'stale2.pid'), '999999999', 'utf8');

      const result = await runCli(['--clean', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(0);

      // Active should remain, stale should be gone
      expect(existsSync(join(TEST_PID_DIR, 'test-clean-active.pid'))).toBe(true);
      expect(existsSync(join(TEST_PID_DIR, 'stale2.pid'))).toBe(false);

      child.kill();
    });
  });

  describe('PID Command', () => {
    it('exits 1 for untracked process', async () => {
      const result = await runCli(['-p', 'nonexistent', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(1);
    });

    it('prints correct PID for running process', async () => {
      const isWindows = process.platform === 'win32';
      const child = startProcess('test-pid-cmd');

      const pidCreated = await waitForPidFile('test-pid-cmd');
      expect(pidCreated).toBe(true);

      const expectedPid = readPidFile('test-pid-cmd');
      expect(expectedPid).not.toBeNull();

      await new Promise(resolve => setTimeout(resolve, isWindows ? 2000 : 500));

      const result = await runCli(['-p', 'test-pid-cmd', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe(String(expectedPid));

      child.kill();
    });

    it('exits 1 for stopped process', async () => {
      const fs = await import('fs');
      fs.writeFileSync(join(TEST_PID_DIR, 'dead.pid'), '999999999', 'utf8');

      const result = await runCli(['-p', 'dead', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(1);
      expect(result.stdout).toContain('not running');
    });
  });

  describe('Wait Command', () => {
    it('exits 1 for untracked process', async () => {
      const result = await runCli(['-w', 'nonexistent', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(1);
    });

    it('waits for a process and detects exit', async () => {
      const isWindows = process.platform === 'win32';

      // Start a long-running process
      const child = startProcess('test-wait-exit');
      const pidCreated = await waitForPidFile('test-wait-exit');
      expect(pidCreated).toBe(true);

      const pid = readPidFile('test-wait-exit');
      expect(pid).not.toBeNull();

      // Give process time to fully start
      await new Promise(resolve => setTimeout(resolve, isWindows ? 2000 : 500));

      // Start wait in background, then kill the process
      const waitPromise = runCli(['-w', 'test-wait-exit', '-d', TEST_PID_DIR, '-t', '15']);

      // Give wait time to start polling, then kill the process
      await new Promise(resolve => setTimeout(resolve, 1000));
      try {
        if (isWindows) {
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'pipe' });
        } else {
          process.kill(pid!);
        }
      } catch {
        /* may already be dead */
      }

      const result = await waitPromise;
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('has exited');

      child.kill();
    });

    it('exits 1 on timeout', async () => {
      const isWindows = process.platform === 'win32';
      const child = startProcess('test-wait-timeout');

      const pidCreated = await waitForPidFile('test-wait-timeout');
      expect(pidCreated).toBe(true);

      await new Promise(resolve => setTimeout(resolve, isWindows ? 2000 : 500));

      // Wait with 1-second timeout - should time out
      const result = await runCli(['-w', 'test-wait-timeout', '-t', '1', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(1);
      expect(result.stdout).toContain('Timeout');

      child.kill();
      const pid = readPidFile('test-wait-timeout');
      if (pid && isProcessRunning(pid)) {
        try {
          if (isWindows) {
            execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'pipe' });
          } else {
            process.kill(pid);
          }
        } catch {
          /* ignore */
        }
      }
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
    const result = await runCli([
      '-n',
      'my-test_app-v1',
      '-d',
      TEST_PID_DIR,
      '--',
      'node',
      '-e',
      'process.exit(0)',
    ]);
    // Command exits immediately, which is fine
    expect(result.code).toBe(0);
  });

  it('handles very long but valid names', async () => {
    const longName = 'a'.repeat(200);
    const result = await runCli([
      '-n',
      longName,
      '-d',
      TEST_PID_DIR,
      '--',
      'node',
      '-e',
      'process.exit(0)',
    ]);
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

    const { command, args } = getCliSpawnArgs([
      '-n',
      'orphaned',
      '-d',
      TEST_PID_DIR,
      '--',
      sleepCmd,
      ...sleepArgs,
    ]);
    const child = spawn(command, args, { stdio: 'pipe' });

    // Wait for PID file to be updated
    await new Promise(resolve => setTimeout(resolve, isWindows ? 3000 : 1000));

    const pid = readPidFile('orphaned');
    expect(pid).not.toBeNull();
    // New PID should be different from the orphaned one
    expect(pid).not.toBe(999999999);

    // Give process more time to stabilize on Windows
    await new Promise(resolve => setTimeout(resolve, isWindows ? 2000 : 500));
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
      } catch {
        /* ignore */
      }
    }
  });
});

describe('Daemon Mode', () => {
  beforeEach(async () => {
    killTrackedProcesses(TEST_PID_DIR);
    await cleanTestDir(TEST_PID_DIR);
    mkdirSync(TEST_PID_DIR, { recursive: true });
  });

  afterEach(async () => {
    killTrackedProcesses(TEST_PID_DIR);
    // Wait briefly for Windows to release file handles after process kill
    if (process.platform === 'win32') {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    await cleanTestDir(TEST_PID_DIR);
  });

  it('starts process in daemon mode and parent exits with code 0', async () => {
    const isWindows = process.platform === 'win32';
    const sleepCmd = isWindows ? 'ping' : 'sleep';
    const sleepArgs = isWindows ? ['-n', '60', '127.0.0.1'] : ['60'];

    const result = await runCli([
      '-n',
      'test-daemon',
      '-D',
      '-d',
      TEST_PID_DIR,
      '--',
      sleepCmd,
      ...sleepArgs,
    ]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Daemon started');

    // PID file should exist
    expect(existsSync(join(TEST_PID_DIR, 'test-daemon.pid'))).toBe(true);

    // Log file should exist
    expect(existsSync(join(TEST_PID_DIR, 'test-daemon.log'))).toBe(true);

    // Process should be running
    const pid = readPidFile('test-daemon');
    expect(pid).not.toBeNull();

    await new Promise(resolve => setTimeout(resolve, isWindows ? 2000 : 500));
    expect(isProcessRunning(pid!)).toBe(true);
  });

  it('captures stdout to log file', async () => {
    // Write a helper script to avoid Windows cmd.exe quoting issues with node -e
    const scriptPath = join(TEST_PID_DIR, '_echo.js');
    writeFileSync(scriptPath, 'console.log("hello from daemon"); console.log("second line");');

    const result = await runCli([
      '-n',
      'test-daemon-output',
      '-D',
      '-d',
      TEST_PID_DIR,
      '--',
      'node',
      scriptPath,
    ]);

    expect(result.code).toBe(0);

    // Poll for log content instead of fixed delay (Windows needs more time)
    const logPath = join(TEST_PID_DIR, 'test-daemon-output.log');
    const logContent = await waitForFileContent(logPath, 'hello from daemon');
    expect(logContent).toContain('hello from daemon');
    expect(logContent).toContain('second line');
  });

  it('replaces existing daemon (kills first, starts second)', async () => {
    const isWindows = process.platform === 'win32';
    const sleepCmd = isWindows ? 'ping' : 'sleep';
    const sleepArgs = isWindows ? ['-n', '60', '127.0.0.1'] : ['60'];

    // Start first daemon
    const result1 = await runCli([
      '-n',
      'test-daemon-replace',
      '-D',
      '-d',
      TEST_PID_DIR,
      '--',
      sleepCmd,
      ...sleepArgs,
    ]);
    expect(result1.code).toBe(0);

    const pid1 = readPidFile('test-daemon-replace');
    expect(pid1).not.toBeNull();
    await new Promise(resolve => setTimeout(resolve, isWindows ? 2000 : 500));
    expect(isProcessRunning(pid1!)).toBe(true);

    // Start second daemon with same name
    const result2 = await runCli([
      '-n',
      'test-daemon-replace',
      '-D',
      '-d',
      TEST_PID_DIR,
      '--',
      sleepCmd,
      ...sleepArgs,
    ]);
    expect(result2.code).toBe(0);

    // Wait for first process to die (polling instead of fixed delay)
    const died = await waitForProcessDeath(pid1!, isWindows ? 15000 : 10000);
    expect(died).toBe(true);

    // Second process should be alive
    const pid2 = readPidFile('test-daemon-replace');
    expect(pid2).not.toBeNull();
    expect(isProcessRunning(pid2!)).toBe(true);
  });

  it('rotates log on restart when oversized', async () => {
    const isWindows = process.platform === 'win32';

    // Create an oversized log file (just over threshold)
    const logPath = join(TEST_PID_DIR, 'test-rotate.log');
    writeFileSync(logPath, 'x'.repeat(11 * 1024 * 1024));

    expect(existsSync(logPath)).toBe(true);

    // Write helper script to avoid Windows cmd.exe quoting issues
    const scriptPath = join(TEST_PID_DIR, '_rotate-echo.js');
    writeFileSync(scriptPath, 'console.log("after rotation");');

    // Start daemon — should trigger rotation
    const result = await runCli([
      '-n',
      'test-rotate',
      '-D',
      '-d',
      TEST_PID_DIR,
      '--',
      'node',
      scriptPath,
    ]);
    expect(result.code).toBe(0);

    // Poll for backup file to appear
    const backupPath = join(TEST_PID_DIR, 'test-rotate.log.1');
    const start = Date.now();
    const timeout = isWindows ? 10000 : 5000;
    while (!existsSync(backupPath) && Date.now() - start < timeout) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    expect(existsSync(backupPath)).toBe(true);

    // Backup should contain the old content
    const backupContent = readFileSync(backupPath, 'utf8');
    expect(backupContent.length).toBeGreaterThan(10 * 1024 * 1024);
  });
});

describe('Logs Command', () => {
  beforeEach(async () => {
    killTrackedProcesses(TEST_PID_DIR);
    await cleanTestDir(TEST_PID_DIR);
    mkdirSync(TEST_PID_DIR, { recursive: true });
  });

  afterEach(async () => {
    killTrackedProcesses(TEST_PID_DIR);
    if (process.platform === 'win32') {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    await cleanTestDir(TEST_PID_DIR);
  });

  it('shows logs for a process', async () => {
    // Create a log file manually
    const logPath = join(TEST_PID_DIR, 'test-logs.log');
    writeFileSync(logPath, 'log line 1\nlog line 2\nlog line 3\n');

    // Also create a PID file so the process appears tracked
    writeFileSync(join(TEST_PID_DIR, 'test-logs.pid'), '999999999');

    const result = await runCli(['-L', 'test-logs', '-d', TEST_PID_DIR]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('log line 1');
    expect(result.stdout).toContain('log line 2');
    expect(result.stdout).toContain('log line 3');
  });

  it('exits 1 when no logs exist', async () => {
    const result = await runCli(['-L', 'nonexistent', '-d', TEST_PID_DIR]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('No logs found');
  });

  it('shows last N lines with --lines', async () => {
    const logPath = join(TEST_PID_DIR, 'test-lines.log');
    writeFileSync(logPath, 'line1\nline2\nline3\nline4\nline5\n');
    writeFileSync(join(TEST_PID_DIR, 'test-lines.pid'), '999999999');

    const result = await runCli(['-L', 'test-lines', '--lines', '2', '-d', TEST_PID_DIR]);
    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain('line1');
    expect(result.stdout).not.toContain('line2');
    expect(result.stdout).not.toContain('line3');
    expect(result.stdout).toContain('line4');
    expect(result.stdout).toContain('line5');
  });

  it('shows daemon logs end-to-end', async () => {
    // Write helper script to avoid Windows cmd.exe quoting issues
    const scriptPath = join(TEST_PID_DIR, '_logs-echo.js');
    writeFileSync(scriptPath, 'console.log("daemon output here");');

    // Start a daemon that writes output
    const result1 = await runCli([
      '-n',
      'test-logs-e2e',
      '-D',
      '-d',
      TEST_PID_DIR,
      '--',
      'node',
      scriptPath,
    ]);
    expect(result1.code).toBe(0);

    // Poll for log content to appear before reading via CLI
    const logPath = join(TEST_PID_DIR, 'test-logs-e2e.log');
    await waitForFileContent(logPath, 'daemon output here');

    // View logs
    const result2 = await runCli(['-L', 'test-logs-e2e', '-d', TEST_PID_DIR]);
    expect(result2.code).toBe(0);
    expect(result2.stdout).toContain('daemon output here');
  });
});

describe('Clean Command with Log Files', () => {
  beforeEach(async () => {
    killTrackedProcesses(TEST_PID_DIR);
    await cleanTestDir(TEST_PID_DIR);
    mkdirSync(TEST_PID_DIR, { recursive: true });
  });

  afterEach(async () => {
    killTrackedProcesses(TEST_PID_DIR);
    if (process.platform === 'win32') {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    await cleanTestDir(TEST_PID_DIR);
  });

  it('removes log files alongside stale PID files', async () => {
    // Create stale PID file + log files
    writeFileSync(join(TEST_PID_DIR, 'stale-app.pid'), '999999999');
    writeFileSync(join(TEST_PID_DIR, 'stale-app.log'), 'old logs');
    writeFileSync(join(TEST_PID_DIR, 'stale-app.log.1'), 'old backup');

    const result = await runCli(['--clean', '-d', TEST_PID_DIR]);
    expect(result.code).toBe(0);

    // All files should be removed
    expect(existsSync(join(TEST_PID_DIR, 'stale-app.pid'))).toBe(false);
    expect(existsSync(join(TEST_PID_DIR, 'stale-app.log'))).toBe(false);
    expect(existsSync(join(TEST_PID_DIR, 'stale-app.log.1'))).toBe(false);
  });
});
