#!/usr/bin/env node
/**
 * just-one - Ensure only one instance of a command runs at a time
 */

import { createRequire } from 'module';
import { parseArgs, validateOptions, getHelpText, type CliOptions } from './lib/cli.js';
import { readPid, writePid, deletePid, listPids, getPidFileMtime } from './lib/pid.js';
import {
  isProcessAlive,
  killProcess,
  waitForProcessToDie,
  spawnCommand,
  setupSignalHandlers,
  isSameProcessInstance,
} from './lib/process.js';

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
  const killed = killProcess(pid);

  if (killed) {
    await waitForProcessToDie(pid);
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
      log(`Killing existing process ${name} (PID: ${existingPid})...`, options);
      killProcess(existingPid);
      await waitForProcessToDie(existingPid);
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

  // Handle run
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
