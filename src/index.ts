#!/usr/bin/env node
/**
 * just-one - Ensure only one instance of a command runs at a time
 */

import { createRequire } from 'module';
import { parseArgs, validateOptions, getHelpText, type CliOptions } from './lib/cli.js';
import { readPid, writePid, deletePid, listPids, getPidFileMtime } from './lib/pid.js';
import {
  isProcessAlive,
  terminateProcess,
  spawnCommand,
  spawnCommandDaemon,
  setupSignalHandlers,
  isSameProcessInstance,
} from './lib/process.js';
import { existsSync } from 'fs';
import {
  getLogFilePath,
  rotateLogIfNeeded,
  readLogLines,
  tailLogFile,
  deleteLogFiles,
} from './lib/log.js';

// Read version from package.json at runtime
const require = createRequire(import.meta.url);
const { version: VERSION } = require('../package.json');

function log(message: string, options: CliOptions): void {
  if (!options.quiet) {
    console.log(message);
  }
}

function logError(message: string): void {
  console.error(message);
}

async function handleKill(name: string, options: CliOptions): Promise<number> {
  const pid = readPid(name, options.pidDir);

  if (pid === null) {
    log(`No process found with name: ${name}`, options);
    return 0;
  }

  // Verify this is the same process we originally started (prevents killing
  // unrelated processes that reused the same PID)
  const pidFileMtime = getPidFileMtime(name, options.pidDir);
  const isSameInstance = pidFileMtime !== null && (await isSameProcessInstance(pid, pidFileMtime));

  if (!isSameInstance) {
    if (isProcessAlive(pid)) {
      log(`PID ${pid} belongs to a different process, not killing`, options);
    } else {
      log(`Process ${name} (PID: ${pid}) is not running, cleaning up PID file`, options);
    }
    deletePid(name, options.pidDir);
    return 0;
  }

  log(`Killing process ${name} (PID: ${pid})...`, options);
  const graceMs = options.grace !== undefined ? options.grace * 1000 : undefined;
  const terminated = await terminateProcess(pid, graceMs);

  if (terminated) {
    deletePid(name, options.pidDir);
    log(`Process ${name} killed`, options);
    return 0;
  } else {
    logError(`Failed to kill process ${name} (PID: ${pid})`);
    return 1;
  }
}

function handleList(options: CliOptions): number {
  const pids = listPids(options.pidDir);

  if (pids.length === 0) {
    log('No tracked processes', options);
    return 0;
  }

  log('Tracked processes:', options);
  for (const info of pids) {
    const status = info.exists && isProcessAlive(info.pid) ? 'running' : 'stopped';
    const pidStr = info.pid > 0 ? String(info.pid) : 'unknown';
    log(`  ${info.name}: PID ${pidStr} (${status})`, options);
  }

  return 0;
}

async function handleRun(options: CliOptions): Promise<number> {
  const name = options.name!;
  const [command, ...args] = options.command;

  if (!command) {
    logError('No command specified');
    return 1;
  }

  // Check for existing process
  const existingPid = readPid(name, options.pidDir);
  if (existingPid !== null) {
    const pidFileMtime = getPidFileMtime(name, options.pidDir);
    const shouldKill =
      pidFileMtime !== null && (await isSameProcessInstance(existingPid, pidFileMtime));

    if (shouldKill) {
      // In ensure mode, if the process is verified running, skip restart
      if (options.ensure) {
        log(`Process ${name} is already running (PID: ${existingPid}), skipping`, options);
        return 0;
      }
      log(`Killing existing process ${name} (PID: ${existingPid})...`, options);
      const graceMs = options.grace !== undefined ? options.grace * 1000 : undefined;
      const terminated = await terminateProcess(existingPid, graceMs);
      if (!terminated) {
        logError(`Warning: process ${existingPid} may still be running`);
      }
    } else if (isProcessAlive(existingPid)) {
      // PID exists but doesn't match our process - likely PID reuse
      log(
        `Stale PID file detected (PID ${existingPid} belongs to different process), skipping kill`,
        options
      );
    }
    deletePid(name, options.pidDir);
  }

  // Spawn the new process
  log(`Starting: ${command} ${args.join(' ')}`, options);

  try {
    if (options.daemon) {
      // Daemon mode: run detached with log file capture
      rotateLogIfNeeded(name, options.pidDir);
      const logPath = getLogFilePath(name, options.pidDir);
      const { pid } = spawnCommandDaemon(command, args, logPath);

      writePid(name, pid, options.pidDir);
      log(`Daemon started with PID: ${pid}`, options);
      log(`Logs: ${logPath}`, options);
      return 0;
    }

    // Foreground mode (existing behavior)
    const { child, pid } = spawnCommand(command, args);

    // Save PID
    writePid(name, pid, options.pidDir);
    log(`Process started with PID: ${pid}`, options);

    // Set up signal handlers
    // Note: We intentionally do NOT delete the PID file on exit.
    // If the process exits unexpectedly, the PID file allows the next run
    // to find and kill any orphaned processes.
    setupSignalHandlers(child);

    // The process will keep running until it exits or is killed
    // The exit handler in setupSignalHandlers will call process.exit
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError(`Failed to start process: ${message}`);
    return 1;
  }
}

async function handleStatus(name: string, options: CliOptions): Promise<number> {
  const pid = readPid(name, options.pidDir);

  if (pid === null) {
    log(`Process ${name}: not tracked`, options);
    return 1;
  }

  const pidFileMtime = getPidFileMtime(name, options.pidDir);
  const isSameInstance = pidFileMtime !== null && (await isSameProcessInstance(pid, pidFileMtime));

  if (isSameInstance) {
    log(`Process ${name}: running (PID ${pid})`, options);
    return 0;
  }

  if (isProcessAlive(pid)) {
    log(`Process ${name}: stopped (PID ${pid} belongs to a different process)`, options);
  } else {
    log(`Process ${name}: stopped`, options);
  }
  return 1;
}

async function handleKillAll(options: CliOptions): Promise<number> {
  const pids = listPids(options.pidDir);

  if (pids.length === 0) {
    log('No tracked processes', options);
    return 0;
  }

  let failed = false;
  for (const info of pids) {
    if (!info.exists || info.pid <= 0) {
      deletePid(info.name, options.pidDir);
      continue;
    }

    const pidFileMtime = getPidFileMtime(info.name, options.pidDir);
    const isSameInstance =
      pidFileMtime !== null && (await isSameProcessInstance(info.pid, pidFileMtime));

    if (!isSameInstance) {
      log(`Process ${info.name} (PID: ${info.pid}) is stale, cleaning up`, options);
      deletePid(info.name, options.pidDir);
      continue;
    }

    log(`Killing process ${info.name} (PID: ${info.pid})...`, options);
    const graceMs = options.grace !== undefined ? options.grace * 1000 : undefined;
    const terminated = await terminateProcess(info.pid, graceMs);

    if (terminated) {
      deletePid(info.name, options.pidDir);
      log(`Process ${info.name} killed`, options);
    } else {
      logError(`Failed to kill process ${info.name} (PID: ${info.pid})`);
      failed = true;
    }
  }

  return failed ? 1 : 0;
}

async function handleClean(options: CliOptions): Promise<number> {
  const pids = listPids(options.pidDir);

  if (pids.length === 0) {
    log('No PID files to clean', options);
    return 0;
  }

  let cleaned = 0;
  for (const info of pids) {
    if (!info.exists || info.pid <= 0) {
      deletePid(info.name, options.pidDir);
      deleteLogFiles(info.name, options.pidDir);
      cleaned++;
      continue;
    }

    const pidFileMtime = getPidFileMtime(info.name, options.pidDir);
    const isSameInstance =
      pidFileMtime !== null && (await isSameProcessInstance(info.pid, pidFileMtime));

    if (!isSameInstance) {
      log(`Removing stale PID file: ${info.name} (PID: ${info.pid})`, options);
      deletePid(info.name, options.pidDir);
      deleteLogFiles(info.name, options.pidDir);
      cleaned++;
    }
  }

  if (cleaned === 0) {
    log('No stale PID files found', options);
  } else {
    log(`Cleaned ${cleaned} stale PID file${cleaned === 1 ? '' : 's'}`, options);
  }

  return 0;
}

async function handlePid(name: string, options: CliOptions): Promise<number> {
  const pid = readPid(name, options.pidDir);

  if (pid === null) {
    log(`No process found with name: ${name}`, options);
    return 1;
  }

  const pidFileMtime = getPidFileMtime(name, options.pidDir);
  const isSameInstance = pidFileMtime !== null && (await isSameProcessInstance(pid, pidFileMtime));

  if (isSameInstance) {
    log(String(pid), options);
    return 0;
  }

  log(`Process ${name} is not running`, options);
  return 1;
}

async function handleWait(name: string, options: CliOptions): Promise<number> {
  const pid = readPid(name, options.pidDir);

  if (pid === null) {
    log(`No process found with name: ${name}`, options);
    return 1;
  }

  // Check if process is alive first, then verify identity if possible.
  // Wait is non-destructive (we only poll), so we can be lenient with identity checks.
  if (!isProcessAlive(pid)) {
    log(`Process ${name} (PID: ${pid}) is not running`, options);
    return 1;
  }

  log(`Waiting for process ${name} (PID: ${pid}) to exit...`, options);

  const timeoutMs = options.timeout !== undefined ? options.timeout * 1000 : undefined;
  const startTime = Date.now();
  const pollInterval = 500;

  while (isProcessAlive(pid)) {
    if (timeoutMs !== undefined && Date.now() - startTime >= timeoutMs) {
      log(`Timeout waiting for process ${name} (PID: ${pid})`, options);
      return 1;
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  log(`Process ${name} (PID: ${pid}) has exited`, options);
  return 0;
}

async function handleLogs(name: string, options: CliOptions): Promise<number> {
  const logPath = getLogFilePath(name, options.pidDir);

  if (!existsSync(logPath)) {
    logError(`No logs found for process: ${name}`);
    return 1;
  }

  if (!options.tail) {
    // Static mode: print lines and exit
    const lines = readLogLines(name, options.pidDir, options.lines);
    for (const line of lines) {
      console.log(line);
    }
    return 0;
  }

  // Follow mode: print initial lines, then tail
  const initialLines = options.lines ?? 10;
  const initial = readLogLines(name, options.pidDir, initialLines);
  for (const line of initial) {
    console.log(line);
  }

  const handle = tailLogFile(name, options.pidDir, {
    onLine: line => console.log(line),
    pollIntervalMs: 500,
  });

  // Poll PID to auto-stop when process dies
  const pid = readPid(name, options.pidDir);
  const pidPollInterval = setInterval(() => {
    if (pid !== null && !isProcessAlive(pid)) {
      handle.stop();
      clearInterval(pidPollInterval);
      log(`Process ${name} has exited`, options);
      process.exit(0);
    }
    // Also stop if no PID file at all
    const currentPid = readPid(name, options.pidDir);
    if (currentPid === null) {
      handle.stop();
      clearInterval(pidPollInterval);
      log(`Process ${name} is no longer tracked`, options);
      process.exit(0);
    }
  }, 1000);

  // Handle SIGINT/SIGTERM for clean exit
  const cleanup = () => {
    handle.stop();
    clearInterval(pidPollInterval);
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Keep the process alive
  return new Promise<number>(() => {
    // Never resolves — exits via cleanup or process death detection
  });
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);

  // Parse arguments
  const parseResult = parseArgs(args);
  if (!parseResult.success) {
    logError(`Error: ${parseResult.error}`);
    logError('Use --help for usage information');
    return 1;
  }

  const options = parseResult.options;

  // Validate options
  const validateResult = validateOptions(options);
  if (!validateResult.success) {
    logError(`Error: ${validateResult.error}`);
    logError('Use --help for usage information');
    return 1;
  }

  // Handle help
  if (options.help) {
    console.log(getHelpText());
    return 0;
  }

  // Handle version
  if (options.version) {
    console.log(`just-one v${VERSION}`);
    return 0;
  }

  // Handle list
  if (options.list) {
    return handleList(options);
  }

  // Handle kill
  if (options.kill) {
    return await handleKill(options.kill, options);
  }

  // Handle kill all
  if (options.killAll) {
    return await handleKillAll(options);
  }

  // Handle status
  if (options.status) {
    return await handleStatus(options.status, options);
  }

  // Handle logs
  if (options.logs) {
    return await handleLogs(options.logs, options);
  }

  // Handle clean
  if (options.clean) {
    return await handleClean(options);
  }

  // Handle pid
  if (options.pid) {
    return await handlePid(options.pid, options);
  }

  // Handle wait
  if (options.wait) {
    return await handleWait(options.wait, options);
  }

  // Handle run (with optional --ensure modifier)
  return await handleRun(options);
}

// Run the CLI
main()
  .then(code => {
    // Only exit if we're not running a child process
    // The child process exit handler will call process.exit
    if (code !== 0) {
      process.exit(code);
    }
  })
  .catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
  });

// Export for testing
export { main };
