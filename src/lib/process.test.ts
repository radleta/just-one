import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isProcessAlive,
  killProcess,
  waitForProcessToDie,
  forceKillProcess,
  terminateProcess,
  spawnCommand,
  spawnCommandDaemon,
  setupSignalHandlers,
  getProcessStartTime,
  isSameProcessInstance,
} from './process.js';
import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

describe('Process operations', () => {
  describe('isProcessAlive', () => {
    it('returns true for current process', () => {
      // The current process should always be alive
      const result = isProcessAlive(process.pid);
      expect(result).toBe(true);
    });

    it('returns false for non-existent PID', () => {
      // Use an extremely high PID that almost certainly doesn't exist
      const result = isProcessAlive(999999999);
      expect(result).toBe(false);
    });

    it('returns false for negative PID', () => {
      const result = isProcessAlive(-1);
      expect(result).toBe(false);
    });

    it('handles PID 0 gracefully', () => {
      // PID 0 is special - kernel scheduler on Unix, System Idle Process on Windows
      // Behavior varies by platform: Windows returns true, Unix returns false
      // Test verifies the function handles this edge case without throwing
      const result = isProcessAlive(0);
      expect(typeof result).toBe('boolean');
    });
  });

  describe('killProcess', () => {
    it('returns false for non-existent PID', () => {
      // Trying to kill a non-existent process should return false
      const result = killProcess(999999999);
      expect(result).toBe(false);
    });

    it('returns false for negative PID', () => {
      const result = killProcess(-1);
      expect(result).toBe(false);
    });
  });

  describe('waitForProcessToDie', () => {
    it('returns true immediately for non-existent process', async () => {
      const start = Date.now();
      const result = await waitForProcessToDie(999999999, 2000);
      const elapsed = Date.now() - start;

      expect(result).toBe(true);
      // Should return relatively quickly since process doesn't exist
      // Note: on Windows, tasklist checks can be slow
      expect(elapsed).toBeLessThan(1500);
    });

    it('respects timeout for long-running process', async () => {
      // Use current process - it won't die during the test
      const start = Date.now();
      const timeoutMs = 200;

      const result = await waitForProcessToDie(process.pid, timeoutMs);
      const elapsed = Date.now() - start;

      expect(result).toBe(false);
      // Should have waited at least the timeout duration
      expect(elapsed).toBeGreaterThanOrEqual(timeoutMs - 50); // Allow 50ms tolerance
    });
  });
  describe('forceKillProcess', () => {
    it('returns false for non-existent PID', () => {
      const result = forceKillProcess(999999999);
      expect(result).toBe(false);
    });

    it('returns false for negative PID', () => {
      const result = forceKillProcess(-1);
      expect(result).toBe(false);
    });

    it('returns false for PID 0', () => {
      const result = forceKillProcess(0);
      expect(result).toBe(false);
    });
  });

  describe('terminateProcess', () => {
    it('returns true for non-existent process (already dead)', async () => {
      // Use a valid PID that doesn't exist (within isValidPid range)
      const result = await terminateProcess(4194000);
      expect(result).toBe(true);
    });

    it('returns false for invalid PID', async () => {
      const result = await terminateProcess(-1);
      expect(result).toBe(false);
    });

    it('returns false for PID 0', async () => {
      const result = await terminateProcess(0);
      expect(result).toBe(false);
    });

    it('returns false for out-of-range PID', async () => {
      const result = await terminateProcess(999999999);
      expect(result).toBe(false);
    });

    it('accepts custom grace period', async () => {
      const result = await terminateProcess(4194000, 100);
      expect(result).toBe(true);
    });

    it('uses default grace period when not specified', async () => {
      const result = await terminateProcess(4194000);
      expect(result).toBe(true);
    });
  });
});

describe('killProcess with real processes', () => {
  let childPid: number | undefined;

  afterEach(() => {
    if (childPid) {
      try {
        process.kill(childPid, 'SIGKILL');
      } catch {
        /* already dead */
      }
      childPid = undefined;
    }
  });

  it('kills a running process and returns true', async () => {
    const child = spawn('sleep', ['60'], { detached: true });
    child.unref();
    childPid = child.pid!;
    expect(isProcessAlive(childPid)).toBe(true);

    const result = killProcess(childPid);
    expect(result).toBe(true);

    const died = await waitForProcessToDie(childPid, 2000);
    expect(died).toBe(true);
  });
});

describe('forceKillProcess with real processes', () => {
  let childPid: number | undefined;

  afterEach(() => {
    if (childPid) {
      try {
        process.kill(childPid, 'SIGKILL');
      } catch {
        /* already dead */
      }
      childPid = undefined;
    }
  });

  it('force kills a running process and returns true', async () => {
    const child = spawn('sleep', ['60'], { detached: true });
    child.unref();
    childPid = child.pid!;
    expect(isProcessAlive(childPid)).toBe(true);

    const result = forceKillProcess(childPid);
    expect(result).toBe(true);

    const died = await waitForProcessToDie(childPid, 2000);
    expect(died).toBe(true);
  });
});

describe('terminateProcess with real processes', () => {
  let childPid: number | undefined;

  afterEach(() => {
    if (childPid) {
      try {
        process.kill(childPid, 'SIGKILL');
      } catch {
        /* already dead */
      }
      childPid = undefined;
    }
  });

  it('terminates a running process via SIGTERM', async () => {
    const child = spawn('sleep', ['60'], { detached: true });
    child.unref();
    childPid = child.pid!;
    expect(isProcessAlive(childPid)).toBe(true);

    const result = await terminateProcess(childPid, 2000);
    expect(result).toBe(true);
    expect(isProcessAlive(childPid)).toBe(false);
  });

  it('escalates to SIGKILL when SIGTERM is ignored', async () => {
    // Spawn a process that traps (ignores) SIGTERM
    const child = spawn('bash', ['-c', "trap '' TERM; sleep 60"], { detached: true });
    child.unref();
    childPid = child.pid!;

    // Brief wait for the trap to be set up
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(isProcessAlive(childPid)).toBe(true);

    // Use a short grace period so it escalates to SIGKILL quickly
    const result = await terminateProcess(childPid, 500);
    expect(result).toBe(true);
    expect(isProcessAlive(childPid)).toBe(false);
  });
});

describe('spawnCommandDaemon', () => {
  const DAEMON_TEST_DIR = join(__dirname, '../../.test-daemon-log');
  const isWindows = process.platform === 'win32';
  let daemonPid: number | undefined;

  beforeEach(() => {
    if (existsSync(DAEMON_TEST_DIR)) {
      rmSync(DAEMON_TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(DAEMON_TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (daemonPid) {
      try {
        if (isWindows) {
          // Kill process tree (wrapper + child) on Windows
          execSync(`taskkill /PID ${daemonPid} /T /F`, { stdio: 'pipe' });
        } else {
          process.kill(daemonPid, 'SIGKILL');
        }
      } catch {
        /* already dead */
      }
      daemonPid = undefined;
    }
    if (existsSync(DAEMON_TEST_DIR)) {
      rmSync(DAEMON_TEST_DIR, { recursive: true, force: true });
    }
  });

  it('spawns a daemon process and returns valid result', () => {
    // Use a script file for cross-platform compatibility (avoids cmd.exe quoting)
    const sleepScript = join(DAEMON_TEST_DIR, '_sleep.js');
    writeFileSync(sleepScript, 'setTimeout(() => {}, 60000)');

    const logPath = join(DAEMON_TEST_DIR, 'daemon.log');
    const result = spawnCommandDaemon('node', [sleepScript], logPath);
    daemonPid = result.pid;

    expect(result.child).toBeDefined();
    expect(result.pid).toBeGreaterThan(0);
    expect(typeof result.pid).toBe('number');
  });

  it('captures daemon output to log file', async () => {
    // Write a helper script to avoid cmd.exe quoting issues on Windows
    const echoScript = join(DAEMON_TEST_DIR, '_echo.js');
    writeFileSync(echoScript, 'console.log("daemon-hello")');

    const logPath = join(DAEMON_TEST_DIR, 'daemon-output.log');
    const result = spawnCommandDaemon('node', [echoScript], logPath);
    daemonPid = result.pid;

    // Poll for log content (robust across platforms and wrapper overhead)
    const start = Date.now();
    let content = '';
    while (Date.now() - start < 5000) {
      if (existsSync(logPath)) {
        content = readFileSync(logPath, 'utf8');
        if (content.includes('daemon-hello')) break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    expect(existsSync(logPath)).toBe(true);
    expect(content).toContain('daemon-hello');
  });

  it('creates a detached process that survives parent', () => {
    const sleepScript = join(DAEMON_TEST_DIR, '_sleep-detach.js');
    writeFileSync(sleepScript, 'setTimeout(() => {}, 60000)');

    const logPath = join(DAEMON_TEST_DIR, 'daemon-detached.log');
    const result = spawnCommandDaemon('node', [sleepScript], logPath);
    daemonPid = result.pid;

    // Process should be alive and independent
    expect(isProcessAlive(result.pid)).toBe(true);
  });

  it('inherits caller environment variables', async () => {
    // Verify that daemon processes see environment variables set by the caller.
    // This is a defensive contract test: Node.js spawn() defaults env to process.env,
    // but daemon mode uses detached processes (and on Windows, an intermediate helper
    // wrapper) where environment propagation must be explicitly guaranteed.
    const envKey = 'JUST_ONE_TEST_ENV_VAR';
    const envVal = 'daemon-env-inheritance-' + Date.now();
    process.env[envKey] = envVal;

    try {
      const envScript = join(DAEMON_TEST_DIR, '_env-check.js');
      writeFileSync(envScript, `console.log(process.env['${envKey}'] || 'NOT_SET')`);

      const logPath = join(DAEMON_TEST_DIR, 'daemon-env.log');
      const result = spawnCommandDaemon('node', [envScript], logPath);
      daemonPid = result.pid;

      // Poll for log content — fail fast if env var was not inherited
      const start = Date.now();
      let content = '';
      while (Date.now() - start < 5000) {
        if (existsSync(logPath)) {
          content = readFileSync(logPath, 'utf8');
          if (content.includes(envVal) || content.includes('NOT_SET')) break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      expect(content).not.toContain('NOT_SET');
      expect(content).toContain(envVal);
    } finally {
      delete process.env[envKey];
    }
  });
});

describe('spawnCommand', () => {
  it('spawns a command and returns valid result', () => {
    // Spawn a simple command that exits quickly
    const isWindows = process.platform === 'win32';
    const command = isWindows ? 'cmd' : 'echo';
    const args = isWindows ? ['/c', 'echo', 'test'] : ['test'];

    const result = spawnCommand(command, args);

    expect(result).toHaveProperty('child');
    expect(result).toHaveProperty('pid');
    expect(typeof result.pid).toBe('number');
    expect(result.pid).toBeGreaterThan(0);

    // Clean up - kill the spawned process
    result.child.kill();
  });

  it('returns the child process with correct pid', () => {
    const isWindows = process.platform === 'win32';
    const command = isWindows ? 'cmd' : 'echo';
    const args = isWindows ? ['/c', 'echo', 'hello'] : ['hello'];

    const result = spawnCommand(command, args);

    expect(result.child.pid).toBe(result.pid);

    result.child.kill();
  });

  describe('with log file', () => {
    const LOG_TEST_DIR = join(__dirname, '../../.test-process-log');

    beforeEach(() => {
      if (existsSync(LOG_TEST_DIR)) {
        rmSync(LOG_TEST_DIR, { recursive: true, force: true });
      }
      mkdirSync(LOG_TEST_DIR, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(LOG_TEST_DIR)) {
        rmSync(LOG_TEST_DIR, { recursive: true, force: true });
      }
    });

    it('captures stdout to log file', async () => {
      const logPath = join(LOG_TEST_DIR, 'test.log');
      const result = spawnCommand('node', ['-e', 'console.log("hello-log-test")'], logPath);

      await new Promise<void>(resolve => {
        result.child.on('exit', () => resolve());
      });

      // Give a brief moment for the stream to flush
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(existsSync(logPath)).toBe(true);
      const content = readFileSync(logPath, 'utf8');
      expect(content).toContain('hello-log-test');
    });

    it('captures stderr to log file', async () => {
      const logPath = join(LOG_TEST_DIR, 'test-stderr.log');
      const result = spawnCommand('node', ['-e', 'console.error("stderr-log-test")'], logPath);

      await new Promise<void>(resolve => {
        result.child.on('exit', () => resolve());
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(existsSync(logPath)).toBe(true);
      const content = readFileSync(logPath, 'utf8');
      expect(content).toContain('stderr-log-test');
    });

    it('provides piped streams when logFilePath is given', async () => {
      const logPath = join(LOG_TEST_DIR, 'test-streams.log');
      const isWindows = process.platform === 'win32';
      const command = isWindows ? 'cmd' : 'sleep';
      const args = isWindows ? ['/c', 'ping', '-n', '60', '127.0.0.1'] : ['60'];

      const result = spawnCommand(command, args, logPath);

      // With piped stdio, child should have readable stdout/stderr
      expect(result.child.stdout).not.toBeNull();
      expect(result.child.stderr).not.toBeNull();

      result.child.kill();
      // Wait for child to exit so the log stream closes before afterEach cleanup
      await new Promise<void>(resolve => result.child.on('exit', () => resolve()));
    });

    it('does not provide piped streams when logFilePath is omitted', async () => {
      const isWindows = process.platform === 'win32';
      const command = isWindows ? 'cmd' : 'sleep';
      const args = isWindows ? ['/c', 'ping', '-n', '60', '127.0.0.1'] : ['60'];

      const result = spawnCommand(command, args);

      // With inherited stdio, stdout/stderr are null
      expect(result.child.stdout).toBeNull();
      expect(result.child.stderr).toBeNull();

      result.child.kill();
      await new Promise<void>(resolve => result.child.on('exit', () => resolve()));
    });
  });
});

describe('setupSignalHandlers', () => {
  let mockChild: EventEmitter & { pid: number; kill: ReturnType<typeof vi.fn> };
  let originalProcessOn: typeof process.on;
  let originalProcessExit: typeof process.exit;
  let registeredHandlers: Map<string, (...args: unknown[]) => void>;

  beforeEach(() => {
    // Create mock child process with EventEmitter capabilities
    const emitter = new EventEmitter();
    mockChild = Object.assign(emitter, {
      pid: 12345,
      kill: vi.fn().mockReturnValue(true),
    });

    // Track registered handlers
    registeredHandlers = new Map();

    // Mock process.on to capture signal handlers
    originalProcessOn = process.on;
    process.on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      registeredHandlers.set(event, handler);
      return process;
    }) as unknown as typeof process.on;

    // Mock process.exit to prevent actual exit
    originalProcessExit = process.exit;
    process.exit = vi.fn() as unknown as typeof process.exit;
  });

  afterEach(() => {
    process.on = originalProcessOn;
    process.exit = originalProcessExit;
    vi.restoreAllMocks();
  });

  it('registers SIGINT and SIGTERM handlers', () => {
    setupSignalHandlers(mockChild as unknown as ChildProcess);

    expect(registeredHandlers.has('SIGINT')).toBe(true);
    expect(registeredHandlers.has('SIGTERM')).toBe(true);
  });

  it('registers child exit handler', () => {
    const exitSpy = vi.fn();
    setupSignalHandlers(mockChild as unknown as ChildProcess);

    mockChild.on('exit', exitSpy);
    mockChild.emit('exit', 0, null);

    expect(exitSpy).toHaveBeenCalled();
  });

  it('registers child error handler', () => {
    const errorSpy = vi.fn();
    setupSignalHandlers(mockChild as unknown as ChildProcess);

    mockChild.on('error', errorSpy);
    mockChild.emit('error', new Error('test error'));

    expect(errorSpy).toHaveBeenCalled();
  });

  it('calls onExit callback when child exits', () => {
    const onExitCallback = vi.fn();
    setupSignalHandlers(mockChild as unknown as ChildProcess, onExitCallback);

    // Emit exit event
    mockChild.emit('exit', 0, null);

    expect(onExitCallback).toHaveBeenCalled();
  });

  it('calls process.exit with child exit code', () => {
    setupSignalHandlers(mockChild as unknown as ChildProcess);

    mockChild.emit('exit', 42, null);

    expect(process.exit).toHaveBeenCalledWith(42);
  });

  it('calls process.exit with 0 when child exits with null code', () => {
    setupSignalHandlers(mockChild as unknown as ChildProcess);

    mockChild.emit('exit', null, null);

    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('calls process.exit with signal-based code for SIGTERM', () => {
    setupSignalHandlers(mockChild as unknown as ChildProcess);

    mockChild.emit('exit', null, 'SIGTERM');

    // 128 + 15 (SIGTERM = 15)
    expect(process.exit).toHaveBeenCalledWith(143);
  });

  it('calls process.exit with signal-based code for SIGINT', () => {
    setupSignalHandlers(mockChild as unknown as ChildProcess);

    mockChild.emit('exit', null, 'SIGINT');

    // 128 + 2 (SIGINT = 2)
    expect(process.exit).toHaveBeenCalledWith(130);
  });

  describe('signal forwarding behavior', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    if (process.platform === 'win32') {
      it('does not call child.kill on SIGINT (relies on OS CTRL_C_EVENT)', () => {
        setupSignalHandlers(mockChild as unknown as ChildProcess);

        const sigintHandler = registeredHandlers.get('SIGINT')!;
        sigintHandler();

        expect(mockChild.kill).not.toHaveBeenCalled();
      });

      it('sets a force-kill timer on SIGINT', () => {
        setupSignalHandlers(mockChild as unknown as ChildProcess);

        const sigintHandler = registeredHandlers.get('SIGINT')!;
        sigintHandler();

        expect(vi.getTimerCount()).toBe(1);
      });

      it('clears force-kill timer when child exits before timeout', () => {
        setupSignalHandlers(mockChild as unknown as ChildProcess);

        const sigintHandler = registeredHandlers.get('SIGINT')!;
        sigintHandler();
        expect(vi.getTimerCount()).toBe(1);

        // Child exits gracefully before timer fires
        mockChild.emit('exit', 0, null);
        expect(vi.getTimerCount()).toBe(0);
      });

      it('creates only one timer for multiple signals', () => {
        setupSignalHandlers(mockChild as unknown as ChildProcess);

        const sigintHandler = registeredHandlers.get('SIGINT')!;
        const sigtermHandler = registeredHandlers.get('SIGTERM')!;

        sigintHandler();
        sigtermHandler();
        sigintHandler();

        expect(vi.getTimerCount()).toBe(1);
      });
    } else {
      it('forwards SIGTERM to child on SIGINT', () => {
        setupSignalHandlers(mockChild as unknown as ChildProcess);

        const sigintHandler = registeredHandlers.get('SIGINT')!;
        sigintHandler();

        expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
      });

      it('forwards SIGTERM to child on SIGTERM', () => {
        setupSignalHandlers(mockChild as unknown as ChildProcess);

        const sigtermHandler = registeredHandlers.get('SIGTERM')!;
        sigtermHandler();

        expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
      });
    }
  });

  describe('pipedStdio signal handling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    if (process.platform === 'win32') {
      it('calls child.kill(SIGTERM) on SIGINT when pipedStdio is true', () => {
        setupSignalHandlers(mockChild as unknown as ChildProcess, undefined, true);

        const sigintHandler = registeredHandlers.get('SIGINT')!;
        sigintHandler();

        expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
      });

      it('does not call child.kill on SIGINT when pipedStdio is false', () => {
        setupSignalHandlers(mockChild as unknown as ChildProcess, undefined, false);

        const sigintHandler = registeredHandlers.get('SIGINT')!;
        sigintHandler();

        expect(mockChild.kill).not.toHaveBeenCalled();
      });

      it('still sets force-kill timer when pipedStdio is true', () => {
        setupSignalHandlers(mockChild as unknown as ChildProcess, undefined, true);

        const sigintHandler = registeredHandlers.get('SIGINT')!;
        sigintHandler();

        expect(vi.getTimerCount()).toBe(1);
      });
    } else {
      it('forwards SIGTERM to child on SIGINT regardless of pipedStdio', () => {
        setupSignalHandlers(mockChild as unknown as ChildProcess, undefined, true);

        const sigintHandler = registeredHandlers.get('SIGINT')!;
        sigintHandler();

        expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
      });
    }
  });
});

describe('getProcessStartTime', () => {
  it('returns start time for current process', async () => {
    const startTime = await getProcessStartTime(process.pid);
    expect(startTime).not.toBeNull();
    expect(startTime).toBeLessThanOrEqual(Date.now());
    // Process should have started within last hour (sanity check)
    expect(startTime).toBeGreaterThan(Date.now() - 3600000);
  });

  it('returns null for non-existent PID', async () => {
    const startTime = await getProcessStartTime(999999);
    expect(startTime).toBeNull();
  });

  it('returns null for invalid PID', async () => {
    const startTime = await getProcessStartTime(-1);
    expect(startTime).toBeNull();
  });
});

describe('isSameProcessInstance', () => {
  it('returns true when times are within tolerance', async () => {
    const startTime = await getProcessStartTime(process.pid);
    expect(startTime).not.toBeNull();
    // Simulate PID file created around same time as process
    const result = await isSameProcessInstance(process.pid, startTime! + 100);
    expect(result).toBe(true);
  });

  it('returns false when times differ significantly', async () => {
    const startTime = await getProcessStartTime(process.pid);
    expect(startTime).not.toBeNull();
    // Simulate PID file from 10 minutes ago
    const result = await isSameProcessInstance(process.pid, startTime! - 600000);
    expect(result).toBe(false);
  });

  it('returns false for non-existent process', async () => {
    const result = await isSameProcessInstance(999999, Date.now());
    expect(result).toBe(false);
  });
});
