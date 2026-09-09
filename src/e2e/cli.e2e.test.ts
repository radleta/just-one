/**
 * End-to-end tests for just-one CLI
 * These tests run the actual CLI binary and verify full workflows
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, execSync, ChildProcess } from 'child_process';
import {
  existsSync,
  readFileSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  statSync,
  utimesSync,
} from 'fs';
import { join } from 'path';

// CLI invocation configuration
// To test the published npm package instead of local build:
//   JUST_ONE_NPX=1 npm test                    # uses npx @radleta/just-one
//   JUST_ONE_NPX=1 JUST_ONE_CLI=@radleta/just-one@1.0.0 npm test  # specific version
const USE_NPX = process.env.JUST_ONE_NPX === '1';
const CLI_PATH = process.env.JUST_ONE_CLI || join(__dirname, '../../dist/cli.js');
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
  timeoutMs: number = 10000
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

// Helper to start a process and wait for its PID file, with early exit detection.
// Fails fast with a descriptive error (including child stderr) if the child
// process exits before the PID file is created — avoids silent 10s timeouts.
async function startProcessAndWait(
  name: string,
  pidDir: string = TEST_PID_DIR,
  timeoutMs: number = 10000
): Promise<{ child: ChildProcess; pid: number }> {
  const child = startProcess(name, pidDir);
  const pidFile = join(pidDir, `${name}.pid`);

  let stderr = '';
  child.stderr?.on('data', (data: Buffer) => {
    stderr += data.toString();
  });

  return new Promise<{ child: ChildProcess; pid: number }>((resolve, reject) => {
    let settled = false;

    const settle = () => {
      settled = true;
    };

    child.on('exit', (code, signal) => {
      if (!settled) {
        settle();
        reject(
          new Error(
            `Child process exited before PID file was created (code=${code}, signal=${signal})` +
              (stderr ? `\nstderr: ${stderr}` : '')
          )
        );
      }
    });

    child.on('error', err => {
      if (!settled) {
        settle();
        reject(new Error(`Failed to spawn child process: ${err.message}`));
      }
    });

    const startTime = Date.now();
    const poll = async () => {
      while (!settled && Date.now() - startTime < timeoutMs) {
        if (existsSync(pidFile)) {
          const content = readFileSync(pidFile, 'utf8').trim();
          const pid = parseInt(content, 10);
          if (!isNaN(pid) && pid > 0) {
            settle();
            resolve({ child, pid });
            return;
          }
        }
        await new Promise(r => setTimeout(r, 100));
      }
      if (!settled) {
        settle();
        reject(
          new Error(
            `Timed out waiting for PID file after ${timeoutMs}ms` +
              (stderr ? `\nstderr: ${stderr}` : '')
          )
        );
      }
    };

    poll();
  });
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

// Helper to wait for a process to become alive with polling (avoids flaky fixed-delay waits)
async function waitForProcessAlive(pid: number, timeoutMs: number = 10000): Promise<boolean> {
  const start = Date.now();
  while (!isProcessRunning(pid) && Date.now() - start < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return isProcessRunning(pid);
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
  beforeEach(async () => {
    // Kill any tracked processes before cleaning up
    killTrackedProcesses(TEST_PID_DIR);
    await cleanTestDir(TEST_PID_DIR);
    mkdirSync(TEST_PID_DIR, { recursive: true });
  });

  afterEach(async () => {
    // Kill any tracked processes before cleaning up
    killTrackedProcesses(TEST_PID_DIR);
    await cleanTestDir(TEST_PID_DIR);
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

      // Cleanup - kill process tree on Windows, signal on Unix
      try {
        if (process.platform === 'win32' && child.pid) {
          execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'pipe' });
        } else {
          child.kill();
        }
      } catch {
        // Process may already be dead
      }
    });
  });

  describe('Kill Command', () => {
    it('exits 1 when killing non-existent process', async () => {
      const result = await runCli(['-k', 'nonexistent', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(1);
      expect(result.stdout).toContain('No process found');
    });

    it('exits 0 when killing stale PID (process not running)', async () => {
      // Create orphaned PID file with non-existent PID
      const fs = await import('fs');
      fs.writeFileSync(join(TEST_PID_DIR, 'stale-kill.pid'), '999999999', 'utf8');

      const result = await runCli(['-k', 'stale-kill', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('not running');

      // PID file should be cleaned up
      expect(existsSync(join(TEST_PID_DIR, 'stale-kill.pid'))).toBe(false);
    });

    it('kills a running process', async () => {
      const isWindows = process.platform === 'win32';

      // Start a process and wait for PID file (with early exit detection)
      const { child, pid } = await startProcessAndWait('test-kill');

      // Wait for process to be fully alive
      const alive = await waitForProcessAlive(pid, isWindows ? 10000 : 5000);
      expect(alive).toBe(true);

      // Kill it
      const result = await runCli(['-k', 'test-kill', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('killed');

      // Wait for process to die
      const died = await waitForProcessDeath(pid, isWindows ? 10000 : 5000);
      expect(died).toBe(true);

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

      // Wait for process to be fully alive
      const alive1 = await waitForProcessAlive(pid1!, isWindows ? 10000 : 5000);
      expect(alive1).toBe(true);

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
      expect(result.code).toBe(1);
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
      const { child, pid } = await startProcessAndWait('test-status');

      const alive = await waitForProcessAlive(pid, isWindows ? 10000 : 5000);
      expect(alive).toBe(true);

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

      // Wait for processes to be fully alive
      if (pid1) {
        const alive1 = await waitForProcessAlive(pid1, isWindows ? 10000 : 5000);
        expect(alive1).toBe(true);
      }
      if (pid2) {
        const alive2 = await waitForProcessAlive(pid2, isWindows ? 10000 : 5000);
        expect(alive2).toBe(true);
      }

      const result = await runCli(['-K', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('killed');

      // Wait for processes to die
      if (pid1) {
        const died1 = await waitForProcessDeath(pid1, isWindows ? 10000 : 5000);
        expect(died1).toBe(true);
      }
      if (pid2) {
        const died2 = await waitForProcessDeath(pid2, isWindows ? 10000 : 5000);
        expect(died2).toBe(true);
      }

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

      const alive = await waitForProcessAlive(pid!, isWindows ? 10000 : 5000);
      expect(alive).toBe(true);

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

      const alive = await waitForProcessAlive(pid1!, isWindows ? 10000 : 5000);
      expect(alive).toBe(true);

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

      // Start a real process and wait for it to be alive
      const { child, pid } = await startProcessAndWait('test-clean-active');
      const alive = await waitForProcessAlive(pid, isWindows ? 10000 : 5000);
      expect(alive).toBe(true);

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
      const { child, pid: expectedPid } = await startProcessAndWait('test-pid-cmd');

      const alive = await waitForProcessAlive(expectedPid, isWindows ? 10000 : 5000);
      expect(alive).toBe(true);

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

      // Start a long-running process and wait for it to be alive
      const { child, pid } = await startProcessAndWait('test-wait-exit');
      const alive = await waitForProcessAlive(pid, isWindows ? 10000 : 5000);
      expect(alive).toBe(true);

      // Start wait in background, then kill the process
      const waitPromise = runCli(['-w', 'test-wait-exit', '-d', TEST_PID_DIR, '-t', '15']);

      // Give wait time to start polling, then kill the process
      await new Promise(resolve => setTimeout(resolve, 1000));
      try {
        if (isWindows) {
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'pipe' });
        } else {
          process.kill(pid);
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
      const { child, pid } = await startProcessAndWait('test-wait-timeout');

      const alive = await waitForProcessAlive(pid, isWindows ? 10000 : 5000);
      expect(alive).toBe(true);

      // Wait with 1-second timeout - should time out
      const result = await runCli(['-w', 'test-wait-timeout', '-t', '1', '-d', TEST_PID_DIR]);
      expect(result.code).toBe(1);
      expect(result.stdout).toContain('Timeout');

      child.kill();
      if (isProcessRunning(pid)) {
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

    // Wait for PID file to exist, then poll until PID changes from orphaned value
    const pidFileCreated = await waitForPidFile('orphaned');
    expect(pidFileCreated).toBe(true);

    const timeout = isWindows ? 15000 : 10000;
    const start = Date.now();
    let pid: number | null = null;
    while (Date.now() - start < timeout) {
      const candidate = readPidFile('orphaned');
      if (candidate && candidate !== 999999999) {
        pid = candidate;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    expect(pid).not.toBeNull();
    expect(pid).not.toBe(999999999);

    // Wait for the new process to be alive
    const alive = await waitForProcessAlive(pid!, isWindows ? 10000 : 5000);
    expect(alive).toBe(true);

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

    const alive = await waitForProcessAlive(pid!, isWindows ? 10000 : 5000);
    expect(alive).toBe(true);
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

  it('daemon inherits caller environment variables', async () => {
    // Verify environment flows through the full CLI -> daemon chain.
    // On Windows this exercises the daemon-helper.js wrapper; on Unix the direct spawn.
    const envKey = 'JUST_ONE_E2E_ENV_TEST';
    const envVal = 'e2e-env-' + Date.now();

    const scriptPath = join(TEST_PID_DIR, '_env-e2e.js');
    writeFileSync(scriptPath, `console.log(process.env['${envKey}'] || 'NOT_SET')`);

    const { command, args } = getCliSpawnArgs([
      '-n',
      'test-daemon-env',
      '-D',
      '-d',
      TEST_PID_DIR,
      '--',
      'node',
      scriptPath,
    ]);

    // Spawn with the custom env var set
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, [envKey]: envVal },
    });

    const result = await new Promise<{ code: number; stdout: string; stderr: string }>(resolve => {
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      child.on('close', code => resolve({ code: code ?? 1, stdout, stderr }));
    });

    expect(result.code).toBe(0);

    // Poll daemon log for the env var value
    const logPath = join(TEST_PID_DIR, 'test-daemon-env.log');
    const logContent = await waitForFileContent(logPath, envVal, 5000);
    expect(logContent).not.toContain('NOT_SET');
    expect(logContent).toContain(envVal);
  });

  it('daemon mode resolves .cmd wrappers on Windows', async () => {
    if (process.platform !== 'win32') return; // .cmd wrappers are Windows-only

    // Create a node script that the .cmd wrapper will execute
    const scriptPath = join(TEST_PID_DIR, '_cmd-target.js');
    writeFileSync(scriptPath, 'console.log("cmd-wrapper-works");');

    // Create a .cmd wrapper (same pattern npm generates for bin entries)
    const cmdPath = join(TEST_PID_DIR, '_cmd-test.cmd');
    writeFileSync(cmdPath, `@node "${scriptPath}" %*\r\n`);

    const result = await runCli(['-n', 'test-daemon-cmd', '-D', '-d', TEST_PID_DIR, '--', cmdPath]);

    expect(result.code).toBe(0);

    const logPath = join(TEST_PID_DIR, 'test-daemon-cmd.log');
    const logContent = await waitForFileContent(logPath, 'cmd-wrapper-works');
    expect(logContent).toContain('cmd-wrapper-works');
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
    const alive1 = await waitForProcessAlive(pid1!, isWindows ? 10000 : 5000);
    expect(alive1).toBe(true);

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

  it('daemon-helper exits after child exits (no zombie)', async () => {
    // Regression test for daemon-helper zombie bug: when the child process exits,
    // the daemon-helper must also exit promptly. Previously, process.exit() was
    // gated on logStream.end() whose callback could never fire if the stream was
    // destroyed/errored, leaving the daemon-helper alive as a zombie.
    const scriptPath = join(TEST_PID_DIR, '_exit-fast.js');
    writeFileSync(scriptPath, 'console.log("child-exiting"); process.exit(0);');

    const result = await runCli([
      '-n',
      'test-daemon-zombie',
      '-D',
      '-d',
      TEST_PID_DIR,
      '--',
      'node',
      scriptPath,
    ]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Daemon started');

    // Read the daemon-helper PID from the PID file
    const pid = readPidFile('test-daemon-zombie');
    expect(pid).not.toBeNull();

    // The child exits immediately. The daemon-helper should follow within the
    // 1-second safety timeout. Poll for process death with generous timeout.
    const died = await waitForProcessDeath(pid!, 10000);
    expect(died).toBe(true);

    // Status should report stopped (not running)
    const status = await runCli(['-s', 'test-daemon-zombie', '-d', TEST_PID_DIR]);
    expect(status.code).toBe(1);
    expect(status.stdout).toContain('stopped');
  });

  it('ensure mode restarts after daemon child exits', async () => {
    // Verify the full user-facing scenario: a daemon's child exits, the
    // daemon-helper exits (no zombie), and a subsequent --ensure invocation
    // detects the dead process and starts a fresh instance.
    const isWindows = process.platform === 'win32';
    const exitScript = join(TEST_PID_DIR, '_ensure-exit.js');
    writeFileSync(exitScript, 'console.log("first-run"); process.exit(0);');

    // Start first daemon — child exits immediately
    const result1 = await runCli([
      '-n',
      'test-daemon-ensure-restart',
      '-D',
      '-d',
      TEST_PID_DIR,
      '--',
      'node',
      exitScript,
    ]);
    expect(result1.code).toBe(0);

    const pid1 = readPidFile('test-daemon-ensure-restart');
    expect(pid1).not.toBeNull();

    // Wait for daemon-helper to exit
    const died = await waitForProcessDeath(pid1!, 10000);
    expect(died).toBe(true);

    // Now use --ensure mode with a long-running command — should start fresh
    const sleepCmd = isWindows ? 'ping' : 'sleep';
    const sleepArgs = isWindows ? ['-n', '60', '127.0.0.1'] : ['60'];

    const result2 = await runCli([
      '-n',
      'test-daemon-ensure-restart',
      '-e',
      '-D',
      '-d',
      TEST_PID_DIR,
      '--',
      sleepCmd,
      ...sleepArgs,
    ]);
    expect(result2.code).toBe(0);
    expect(result2.stdout).toContain('Daemon started');

    // New PID should be different and alive
    const pid2 = readPidFile('test-daemon-ensure-restart');
    expect(pid2).not.toBeNull();
    expect(pid2).not.toBe(pid1);

    const alive2 = await waitForProcessAlive(pid2!, isWindows ? 10000 : 5000);
    expect(alive2).toBe(true);
  });
});

describe('Foreground Log Capture', () => {
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

  it('creates log file with captured output in foreground mode', async () => {
    // Write helper script to avoid Windows cmd.exe quoting issues
    const scriptPath = join(TEST_PID_DIR, '_fg-echo.js');
    writeFileSync(scriptPath, 'console.log("foreground-log-test"); console.log("line-two");');

    const result = await runCli([
      '-n',
      'test-fg-log',
      '-d',
      TEST_PID_DIR,
      '--',
      'node',
      scriptPath,
    ]);

    expect(result.code).toBe(0);

    // Log file should exist with captured output
    const logPath = join(TEST_PID_DIR, 'test-fg-log.log');
    const logContent = await waitForFileContent(logPath, 'foreground-log-test');
    expect(logContent).toContain('foreground-log-test');
    expect(logContent).toContain('line-two');
  });

  it('-L reads foreground logs', async () => {
    const scriptPath = join(TEST_PID_DIR, '_fg-logs-read.js');
    writeFileSync(scriptPath, 'console.log("readable-via-L");');

    const result1 = await runCli([
      '-n',
      'test-fg-read',
      '-d',
      TEST_PID_DIR,
      '--',
      'node',
      scriptPath,
    ]);
    expect(result1.code).toBe(0);

    // Poll for log content to appear
    const logPath = join(TEST_PID_DIR, 'test-fg-read.log');
    await waitForFileContent(logPath, 'readable-via-L');

    // View logs via -L
    const result2 = await runCli(['-L', 'test-fg-read', '-d', TEST_PID_DIR]);
    expect(result2.code).toBe(0);
    expect(result2.stdout).toContain('readable-via-L');
  });

  it('still propagates exit code in foreground mode', async () => {
    const scriptPath = join(TEST_PID_DIR, '_fg-exit.js');
    writeFileSync(scriptPath, 'process.exit(42);');

    const result = await runCli([
      '-n',
      'test-fg-exit',
      '-d',
      TEST_PID_DIR,
      '--',
      'node',
      scriptPath,
    ]);

    expect(result.code).toBe(42);
  });

  it('captures stderr to log file', async () => {
    const scriptPath = join(TEST_PID_DIR, '_fg-stderr.js');
    writeFileSync(scriptPath, 'console.error("foreground-stderr-test");');

    const result = await runCli([
      '-n',
      'test-fg-stderr',
      '-d',
      TEST_PID_DIR,
      '--',
      'node',
      scriptPath,
    ]);

    expect(result.code).toBe(0);

    const logPath = join(TEST_PID_DIR, 'test-fg-stderr.log');
    const logContent = await waitForFileContent(logPath, 'foreground-stderr-test');
    expect(logContent).toContain('foreground-stderr-test');
  });

  it('rotates log on foreground restart when oversized', async () => {
    // Create an oversized log file
    const logPath = join(TEST_PID_DIR, 'test-fg-rotate.log');
    writeFileSync(logPath, 'x'.repeat(11 * 1024 * 1024));
    expect(existsSync(logPath)).toBe(true);

    const scriptPath = join(TEST_PID_DIR, '_fg-rotate.js');
    writeFileSync(scriptPath, 'console.log("after-fg-rotation");');

    // Start foreground — should trigger rotation
    const result = await runCli([
      '-n',
      'test-fg-rotate',
      '-d',
      TEST_PID_DIR,
      '--',
      'node',
      scriptPath,
    ]);
    expect(result.code).toBe(0);

    // Backup file should exist with old oversized content
    const backupPath = join(TEST_PID_DIR, 'test-fg-rotate.log.1');
    const start = Date.now();
    const timeout = process.platform === 'win32' ? 10000 : 5000;
    while (!existsSync(backupPath) && Date.now() - start < timeout) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    expect(existsSync(backupPath)).toBe(true);

    const backupContent = readFileSync(backupPath, 'utf8');
    expect(backupContent.length).toBeGreaterThan(10 * 1024 * 1024);
  });

  it('long-running foreground captures output and stops on kill', async () => {
    const isWindows = process.platform === 'win32';

    // Write a script that prints periodically
    const scriptPath = join(TEST_PID_DIR, '_fg-long.js');
    writeFileSync(
      scriptPath,
      `
      let count = 0;
      const iv = setInterval(() => {
        console.log("tick-" + count++);
      }, 200);
      process.on("SIGTERM", () => { clearInterval(iv); process.exit(0); });
      `
    );

    const { command, args } = getCliSpawnArgs([
      '-n',
      'test-fg-long',
      '-d',
      TEST_PID_DIR,
      '--',
      'node',
      scriptPath,
    ]);
    const child = spawn(command, args, { stdio: 'pipe' });

    // Wait for PID file and some output
    const pidCreated = await waitForPidFile('test-fg-long');
    expect(pidCreated).toBe(true);

    const logPath = join(TEST_PID_DIR, 'test-fg-long.log');
    const logContent = await waitForFileContent(logPath, 'tick-2');
    expect(logContent).toContain('tick-0');

    // Kill via CLI
    const killResult = await runCli(['-k', 'test-fg-long', '-d', TEST_PID_DIR]);
    // Kill should succeed (exit 0) or process might already be gone
    expect(killResult.code).toBeLessThanOrEqual(1);

    // Cleanup
    child.kill();
    const pid = readPidFile('test-fg-long');
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

  it('daemon mode still works (regression guard)', async () => {
    const scriptPath = join(TEST_PID_DIR, '_fg-daemon-guard.js');
    writeFileSync(scriptPath, 'console.log("daemon-still-works");');

    const result = await runCli([
      '-n',
      'test-daemon-guard',
      '-D',
      '-d',
      TEST_PID_DIR,
      '--',
      'node',
      scriptPath,
    ]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Daemon started');

    // Log file should exist
    const logPath = join(TEST_PID_DIR, 'test-daemon-guard.log');
    const logContent = await waitForFileContent(logPath, 'daemon-still-works');
    expect(logContent).toContain('daemon-still-works');
  });

  it('--no-log suppresses log file creation in foreground mode', async () => {
    const scriptPath = join(TEST_PID_DIR, '_fg-nolog.js');
    writeFileSync(scriptPath, 'console.log("no-log-test");');

    const result = await runCli([
      '-n',
      'test-no-log',
      '--no-log',
      '-d',
      TEST_PID_DIR,
      '--',
      'node',
      scriptPath,
    ]);

    expect(result.code).toBe(0);

    // Log file should NOT exist
    const logPath = join(TEST_PID_DIR, 'test-no-log.log');
    // Give a moment for any async operations to complete
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(existsSync(logPath)).toBe(false);

    // But PID file should have been created (then cleaned up after exit)
    // The process already exited, so we just verify no log file was created
  });

  it('--no-log with --daemon errors', async () => {
    const result = await runCli([
      '-n',
      'test-nolog-daemon',
      '--no-log',
      '-D',
      '-d',
      TEST_PID_DIR,
      '--',
      'sleep',
      '60',
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--no-log cannot be used with --daemon');
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

  // writePid renames its temp sibling into place; one survives only a write
  // that died in between, and every other path filters on .pid.
  it('removes an abandoned temp file but spares one from a live writer', async () => {
    const abandoned = join(TEST_PID_DIR, 'abandoned.pid.999999999.tmp');
    const inFlight = join(TEST_PID_DIR, `in-flight.pid.${process.pid}.tmp`);
    writeFileSync(abandoned, '4242');
    writeFileSync(inFlight, '4243');

    const result = await runCli(['--clean', '-d', TEST_PID_DIR]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('orphaned temp file');
    expect(existsSync(abandoned)).toBe(false);
    // This test process is alive, so its temp file is a write in flight
    expect(existsSync(inFlight)).toBe(true);
  });

  it('removes orphaned log files with no matching PID file', async () => {
    // Create orphaned log files (no .pid file exists)
    writeFileSync(join(TEST_PID_DIR, 'orphaned-app.log'), 'orphaned logs');
    writeFileSync(join(TEST_PID_DIR, 'orphaned-app.log.1'), 'orphaned backup');

    const result = await runCli(['--clean', '-d', TEST_PID_DIR]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('orphaned');

    // Orphaned log files should be removed
    expect(existsSync(join(TEST_PID_DIR, 'orphaned-app.log'))).toBe(false);
    expect(existsSync(join(TEST_PID_DIR, 'orphaned-app.log.1'))).toBe(false);
  });
});

describe('PID Command with Quiet Mode', () => {
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

  it('prints PID even in quiet mode', async () => {
    const isWindows = process.platform === 'win32';
    const sleepCmd = isWindows ? 'ping' : 'sleep';
    const sleepArgs = isWindows ? ['-n', '60', '127.0.0.1'] : ['60'];

    // Start a daemon
    await runCli(['-n', 'test-pid-quiet', '-D', '-d', TEST_PID_DIR, '--', sleepCmd, ...sleepArgs]);

    const expectedPid = readPidFile('test-pid-quiet');
    expect(expectedPid).not.toBeNull();

    const alive = await waitForProcessAlive(expectedPid!, isWindows ? 10000 : 5000);
    expect(alive).toBe(true);

    // Get PID with quiet mode - should still output the PID
    const result = await runCli(['-p', 'test-pid-quiet', '-q', '-d', TEST_PID_DIR]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(String(expectedPid));
  });
});

describe('Exit Code Regression (Windows fix)', () => {
  // Regression tests for the Windows exit code bug where all commands exited 1.
  // Root cause: cli.ts relied on natural exit for code 0, but environment factors
  // (e.g. pidusage DEP0190 warning) could set process.exitCode = 1 before natural exit.
  // Fix: cli.ts now always calls process.exit(code) explicitly.
  //
  // These tests poison process.exitCode = 1 BEFORE cli.js runs, proving that
  // the explicit process.exit(code) call overrides it. Without the fix, these fail.

  const WRAPPER_PATH = join(TEST_PID_DIR, 'exitcode-wrapper.mjs');

  /** Run CLI through a wrapper that sets process.exitCode = 1 before importing cli.js */
  function runCliWithPoisonedExitCode(
    args: string[]
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise(resolve => {
      const child = spawn('node', [WRAPPER_PATH, ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
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

  beforeEach(async () => {
    killTrackedProcesses(TEST_PID_DIR);
    await cleanTestDir(TEST_PID_DIR);
    mkdirSync(TEST_PID_DIR, { recursive: true });

    // Write a wrapper that poisons process.exitCode before running the CLI.
    // On Windows, forward-slash paths work in ESM import URLs.
    const cliAbsPath = join(__dirname, '../../dist/cli.js').replace(/\\/g, '/');
    writeFileSync(
      WRAPPER_PATH,
      [
        '// Simulate environment pollution (e.g. DEP0190 setting exitCode)',
        'process.exitCode = 1;',
        `import('file:///${cliAbsPath}');`,
      ].join('\n')
    );
  });

  afterEach(async () => {
    killTrackedProcesses(TEST_PID_DIR);
    await cleanTestDir(TEST_PID_DIR);
  });

  it('--version exits 0 even when process.exitCode is polluted', async () => {
    const result = await runCliWithPoisonedExitCode(['--version']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  it('--help exits 0 even when process.exitCode is polluted', async () => {
    const result = await runCliWithPoisonedExitCode(['--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage:');
  });

  it('-l exits 0 even when process.exitCode is polluted', async () => {
    const result = await runCliWithPoisonedExitCode(['-l', '-d', TEST_PID_DIR]);
    expect(result.code).toBe(0);
  });

  it('error cases still exit 1 when process.exitCode is polluted', async () => {
    const result = await runCliWithPoisonedExitCode(['-s', 'nonexistent', '-d', TEST_PID_DIR]);
    expect(result.code).toBe(1);
  });

  it('daemon mode exits 0 even when process.exitCode is polluted', async () => {
    const isWindows = process.platform === 'win32';
    const sleepCmd = isWindows ? 'ping' : 'sleep';
    const sleepArgs = isWindows ? ['-n', '60', '127.0.0.1'] : ['60'];

    const result = await runCliWithPoisonedExitCode([
      '-n',
      'test-exitcode',
      '-D',
      '-d',
      TEST_PID_DIR,
      '--',
      sleepCmd,
      ...sleepArgs,
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Daemon started');
  });

  it('kill exits 0 even when process.exitCode is polluted', async () => {
    const isWindows = process.platform === 'win32';
    const sleepCmd = isWindows ? 'ping' : 'sleep';
    const sleepArgs = isWindows ? ['-n', '60', '127.0.0.1'] : ['60'];

    // Start a daemon first (via normal CLI, not poisoned)
    const startResult = await runCli([
      '-n',
      'test-exitcode-kill',
      '-D',
      '-d',
      TEST_PID_DIR,
      '--',
      sleepCmd,
      ...sleepArgs,
    ]);
    expect(startResult.code).toBe(0);

    const pid = readPidFile('test-exitcode-kill');
    expect(pid).not.toBeNull();

    // Wait for process to be fully alive
    const alive = await waitForProcessAlive(pid!, isWindows ? 10000 : 5000);
    expect(alive).toBe(true);

    // Kill via poisoned wrapper — should still exit 0
    const killResult = await runCliWithPoisonedExitCode([
      '-k',
      'test-exitcode-kill',
      '-d',
      TEST_PID_DIR,
    ]);
    expect(killResult.code).toBe(0);
    expect(killResult.stdout).toContain('killed');
  });

  it('kill of unknown exits 1 even when process.exitCode is polluted', async () => {
    const result = await runCliWithPoisonedExitCode(['-k', 'nonexistent', '-d', TEST_PID_DIR]);
    expect(result.code).toBe(1);
  });
});

// Start-tick identity checks are Linux-only; other platforms keep the mtime path.
const describeLinux = process.platform === 'linux' ? describe : describe.skip;

describeLinux('Start Ticks Identity (WSL2 clock drift)', () => {
  const sleepCmd = 'sleep';
  const sleepArgs = ['60'];

  // Push the PID file's mtime into the past, reproducing what a WSL2 host
  // suspend does: /proc/uptime freezes while the wall clock keeps running, so
  // the uptime-derived start time drifts far away from the recorded mtime.
  function simulateClockDrift(name: string, hours: number): void {
    const pidFile = join(TEST_PID_DIR, `${name}.pid`);
    const drifted = (Date.now() - hours * 3600000) / 1000;
    utimesSync(pidFile, drifted, drifted);
  }

  beforeEach(async () => {
    killTrackedProcesses(TEST_PID_DIR);
    await cleanTestDir(TEST_PID_DIR);
    mkdirSync(TEST_PID_DIR, { recursive: true });
  });

  afterEach(async () => {
    killTrackedProcesses(TEST_PID_DIR);
    await cleanTestDir(TEST_PID_DIR);
  });

  it('records start ticks in the PID file on spawn', async () => {
    const result = await runCli([
      '-n',
      'test-ticks',
      '-D',
      '-d',
      TEST_PID_DIR,
      '--',
      sleepCmd,
      ...sleepArgs,
    ]);
    expect(result.code).toBe(0);

    const content = readFileSync(join(TEST_PID_DIR, 'test-ticks.pid'), 'utf8');
    // Ticks only — the startTime key is for platforms that cannot supply ticks
    expect(content).toMatch(/^\d+\nstartTicks=\d+$/);
    // Older versions parseInt the whole file, which stops at the newline
    expect(parseInt(content, 10)).toBe(readPidFile('test-ticks'));
  });

  it('still recognizes its own daemon after a large clock drift', async () => {
    const started = await runCli([
      '-n',
      'test-drift',
      '-D',
      '-d',
      TEST_PID_DIR,
      '--',
      sleepCmd,
      ...sleepArgs,
    ]);
    expect(started.code).toBe(0);
    const pid = readPidFile('test-drift');
    expect(pid).not.toBeNull();
    expect(await waitForProcessAlive(pid!, 5000)).toBe(true);

    simulateClockDrift('test-drift', 4);

    const status = await runCli(['-s', 'test-drift', '-d', TEST_PID_DIR]);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain('running');
  });

  it('does not spawn a duplicate daemon under --ensure after a clock drift', async () => {
    const started = await runCli([
      '-n',
      'test-drift-ensure',
      '-D',
      '-d',
      TEST_PID_DIR,
      '--',
      sleepCmd,
      ...sleepArgs,
    ]);
    expect(started.code).toBe(0);
    const firstPid = readPidFile('test-drift-ensure');
    expect(firstPid).not.toBeNull();
    expect(await waitForProcessAlive(firstPid!, 5000)).toBe(true);

    simulateClockDrift('test-drift-ensure', 4);

    const ensure = await runCli([
      '-n',
      'test-drift-ensure',
      '-e',
      '-D',
      '-d',
      TEST_PID_DIR,
      '--',
      sleepCmd,
      ...sleepArgs,
    ]);

    expect(ensure.code).toBe(0);
    expect(ensure.stdout).toContain('already running');
    expect(ensure.stdout).not.toContain('Daemon started');
    // The original daemon is still the tracked one — nothing was leaked
    expect(readPidFile('test-drift-ensure')).toBe(firstPid);
  });

  it('backfills ticks into a legacy bare-PID file without disturbing its mtime', async () => {
    const started = await runCli([
      '-n',
      'test-backfill',
      '-D',
      '-d',
      TEST_PID_DIR,
      '--',
      sleepCmd,
      ...sleepArgs,
    ]);
    expect(started.code).toBe(0);
    const pid = readPidFile('test-backfill');
    expect(pid).not.toBeNull();

    // Rewrite as a file an older version would have produced: bare PID, no ticks
    const pidFile = join(TEST_PID_DIR, 'test-backfill.pid');
    writeFileSync(pidFile, String(pid), 'utf8');
    const { mtimeMs } = statSync(pidFile);

    const status = await runCli(['-s', 'test-backfill', '-d', TEST_PID_DIR]);
    expect(status.code).toBe(0);

    // Ticks are now recorded, and the mtime older versions rely on is unchanged
    expect(readFileSync(pidFile, 'utf8')).toMatch(/^\d+\nstartTicks=\d+$/);
    expect(statSync(pidFile).mtimeMs).toBe(mtimeMs);

    // Having been upgraded, it now survives the drift that would have broken it
    simulateClockDrift('test-backfill', 4);
    const after = await runCli(['-s', 'test-backfill', '-d', TEST_PID_DIR]);
    expect(after.code).toBe(0);
    expect(after.stdout).toContain('running');
  });
});

// Start-time identity checks are macOS-only: every other platform either has
// ticks or has no exactly-comparable start time at all.
const describeDarwin = process.platform === 'darwin' ? describe : describe.skip;

describeDarwin('Start Time Identity (macOS PID reuse)', () => {
  const sleepCmd = 'sleep';
  const sleepArgs = ['60'];

  function pidFilePath(name: string): string {
    return join(TEST_PID_DIR, `${name}.pid`);
  }

  function recordedStartTime(name: string): number {
    const match = readFileSync(pidFilePath(name), 'utf8').match(/^startTime=(\d+)$/m);
    expect(match).not.toBeNull();
    return Number(match![1]);
  }

  function setMtime(name: string, ms: number): void {
    utimesSync(pidFilePath(name), ms / 1000, ms / 1000);
  }

  async function startDaemonNamed(name: string): Promise<number> {
    const result = await runCli([
      '-n',
      name,
      '-D',
      '-d',
      TEST_PID_DIR,
      '--',
      sleepCmd,
      ...sleepArgs,
    ]);
    expect(result.code).toBe(0);
    const pid = readPidFile(name);
    expect(pid).not.toBeNull();
    expect(await waitForProcessAlive(pid!, 5000)).toBe(true);
    return pid!;
  }

  beforeEach(async () => {
    killTrackedProcesses(TEST_PID_DIR);
    await cleanTestDir(TEST_PID_DIR);
    mkdirSync(TEST_PID_DIR, { recursive: true });
  });

  afterEach(async () => {
    killTrackedProcesses(TEST_PID_DIR);
    await cleanTestDir(TEST_PID_DIR);
  });

  it('records the process start time in the PID file on spawn', async () => {
    const pid = await startDaemonNamed('test-start-time');

    const content = readFileSync(pidFilePath('test-start-time'), 'utf8');
    // No ticks here — macOS has no /proc, so the start time is the exact value
    expect(content).toMatch(/^\d+\nstartTime=\d+$/);
    // Older versions parseInt the whole file, which stops at the newline
    expect(parseInt(content, 10)).toBe(pid);
  });

  // The hole this closes: an unrelated process that inherits a recycled PID and
  // happens to have started inside the 5s mtime tolerance verifies as ours and
  // gets killed. Both halves run against the same live PID, so the only thing
  // that differs between them is whether the file carries a recorded start.
  it('rejects a recycled PID that the mtime tolerance would have accepted', async () => {
    const pid = await startDaemonNamed('test-reuse');
    // One second earlier: a different process, yet well inside the tolerance
    const foreignStart = recordedStartTime('test-reuse') - 1000;

    writeFileSync(pidFilePath('test-reuse'), `${pid}\nstartTime=${foreignStart}`, 'utf8');
    setMtime('test-reuse', Date.now());
    const withEvidence = await runCli(['-s', 'test-reuse', '-d', TEST_PID_DIR]);
    expect(withEvidence.code).toBe(1);
    expect(withEvidence.stdout).toContain('different process');

    // The same PID, the same mtime, without the recorded start: accepted
    writeFileSync(pidFilePath('test-reuse'), String(pid), 'utf8');
    setMtime('test-reuse', Date.now());
    const withoutEvidence = await runCli(['-s', 'test-reuse', '-d', TEST_PID_DIR]);
    expect(withoutEvidence.code).toBe(0);
    expect(withoutEvidence.stdout).toContain('running');
  });

  it('still recognizes its own daemon when the mtime is far from the start time', async () => {
    await startDaemonNamed('test-mtime-gap');
    setMtime('test-mtime-gap', Date.now() - 4 * 3600000);

    const status = await runCli(['-s', 'test-mtime-gap', '-d', TEST_PID_DIR]);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain('running');
  });

  it('backfills the start time into a legacy bare-PID file without disturbing its mtime', async () => {
    const pid = await startDaemonNamed('test-backfill-start-time');

    // Rewrite as a file an older version would have produced: bare PID
    const pidFile = pidFilePath('test-backfill-start-time');
    writeFileSync(pidFile, String(pid), 'utf8');
    const { mtimeMs } = statSync(pidFile);

    const status = await runCli(['-s', 'test-backfill-start-time', '-d', TEST_PID_DIR]);
    expect(status.code).toBe(0);

    // Recorded now, and the mtime older versions rely on is preserved. Not to
    // the bit: utimesSync takes float seconds, and a Unix epoch near 1.8e9 uses
    // up enough of a double's digits that APFS's sub-microsecond tail cannot
    // survive the round trip. Older versions compare it within 5s.
    expect(readFileSync(pidFile, 'utf8')).toMatch(/^\d+\nstartTime=\d+$/);
    expect(Math.abs(statSync(pidFile).mtimeMs - mtimeMs)).toBeLessThan(1);

    // Having been upgraded, it no longer depends on the mtime at all
    setMtime('test-backfill-start-time', Date.now() - 4 * 3600000);
    const after = await runCli(['-s', 'test-backfill-start-time', '-d', TEST_PID_DIR]);
    expect(after.code).toBe(0);
    expect(after.stdout).toContain('running');
  });
});

// A rejection has to say what it rejected on. An exact-evidence mismatch is
// definite; an mtime mismatch is only two clocks disagreeing, and reads as the
// WSL2 drift signature rather than as PID reuse.
describe('Rejection Diagnostics', () => {
  const isWindows = process.platform === 'win32';
  const sleepCmd = isWindows ? 'ping' : 'sleep';
  const sleepArgs = isWindows ? ['-n', '60', '127.0.0.1'] : ['60'];

  beforeEach(async () => {
    killTrackedProcesses(TEST_PID_DIR);
    await cleanTestDir(TEST_PID_DIR);
    mkdirSync(TEST_PID_DIR, { recursive: true });
  });

  afterEach(async () => {
    killTrackedProcesses(TEST_PID_DIR);
    await cleanTestDir(TEST_PID_DIR);
  });

  async function startDaemon(name: string): Promise<number> {
    const started = await runCli([
      '-n',
      name,
      '-D',
      '-d',
      TEST_PID_DIR,
      '--',
      sleepCmd,
      ...sleepArgs,
    ]);
    expect(started.code).toBe(0);
    const pid = readPidFile(name);
    expect(pid).not.toBeNull();
    expect(await waitForProcessAlive(pid!, 5000)).toBe(true);
    return pid!;
  }

  it('names recorded evidence as the basis when a start time does not match', async () => {
    const pid = await startDaemon('test-reject-evidence');

    // A start time no live process can have — the exact comparison must reject it
    writeFileSync(join(TEST_PID_DIR, 'test-reject-evidence.pid'), `${pid}\nstartTime=1`, 'utf8');

    const status = await runCli(['-s', 'test-reject-evidence', '-d', TEST_PID_DIR]);
    expect(status.code).toBe(1);
    expect(status.stdout).toContain('recorded start does not match');
    expect(status.stdout).toContain('belongs to a different process');
  });

  it('reports an unverified result with the measured delta on the mtime path', async () => {
    const pid = await startDaemon('test-reject-mtime');

    // A legacy bare-PID file whose mtime sits four hours from the process start:
    // exactly what a WSL2 host suspend produces, and not PID reuse.
    //
    // The drifted mtime carries a sub-millisecond fraction on purpose. Every
    // mtime the production path compares against is fractional — NTFS stores
    // 100ns units, ext4 nanoseconds — while the start time is whole
    // milliseconds, so a drift landing on a round millisecond is an input no
    // real run produces, and asserting against one hides an unrounded delta.
    const pidFile = join(TEST_PID_DIR, 'test-reject-mtime.pid');
    writeFileSync(pidFile, String(pid), 'utf8');
    const drifted = (Date.now() - 4 * 3600000 + 0.484) / 1000;
    utimesSync(pidFile, drifted, drifted);
    expect(Number.isInteger(statSync(pidFile).mtimeMs)).toBe(false);

    const status = await runCli(['-s', 'test-reject-mtime', '-d', TEST_PID_DIR]);
    expect(status.code).toBe(1);
    expect(status.stdout).toContain('could not be verified as ours');
    expect(status.stdout).toMatch(/differs from the PID file by \d+ms/);
    // The mtime path cannot establish reuse, so it must not claim it
    expect(status.stdout).not.toContain('belongs to a different process');
  });
});

describe('Daemon Mode with Auto-Created Directory', () => {
  const CUSTOM_DIR = join(__dirname, '../../.test-pids-autocreate');

  beforeEach(async () => {
    await cleanTestDir(CUSTOM_DIR);
  });

  afterEach(async () => {
    killTrackedProcesses(CUSTOM_DIR);
    if (process.platform === 'win32') {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    await cleanTestDir(CUSTOM_DIR);
  });

  it('auto-creates PID directory for daemon mode', async () => {
    const isWindows = process.platform === 'win32';
    const sleepCmd = isWindows ? 'ping' : 'sleep';
    const sleepArgs = isWindows ? ['-n', '60', '127.0.0.1'] : ['60'];

    // Directory should not exist yet
    expect(existsSync(CUSTOM_DIR)).toBe(false);

    const result = await runCli([
      '-n',
      'test-autocreate',
      '-D',
      '-d',
      CUSTOM_DIR,
      '--',
      sleepCmd,
      ...sleepArgs,
    ]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Daemon started');

    // Directory and files should now exist
    expect(existsSync(CUSTOM_DIR)).toBe(true);
    expect(existsSync(join(CUSTOM_DIR, 'test-autocreate.pid'))).toBe(true);
    expect(existsSync(join(CUSTOM_DIR, 'test-autocreate.log'))).toBe(true);
  });
});
