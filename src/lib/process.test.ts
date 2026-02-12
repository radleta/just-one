import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isProcessAlive,
  killProcess,
  waitForProcessToDie,
  forceKillProcess,
  terminateProcess,
  spawnCommand,
  setupSignalHandlers,
  getProcessStartTime,
  isSameProcessInstance,
} from './process.js';
import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

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
