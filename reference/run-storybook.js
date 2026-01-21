#!/usr/bin/env node
/**
 * Reference implementation from storybook-addon-scratchpad
 *
 * This script demonstrates the PID file pattern that just-one will generalize.
 * Key patterns to extract:
 * - PID file read/write/delete
 * - Cross-platform process killing (Windows taskkill vs Unix SIGTERM)
 * - Orphan process handling (keep PID file on unexpected exit)
 * - Graceful shutdown on SIGINT/SIGTERM
 */
import 'dotenv/config';
import { spawn, execSync } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const version = process.argv[2];
const useNpm = process.argv.includes('--npm');
const isWindows = process.platform === 'win32';

if (!version || !['8', '9', '10'].includes(version)) {
  console.error('Usage: node scripts/run-storybook.js <8|9|10> [--npm]');
  console.error('');
  console.error('Options:');
  console.error('  --npm    Install addon from npm registry instead of local build');
  process.exit(1);
}

// Default ports: 16008, 16009, 16010
const defaultPort = 16000 + parseInt(version);
const envKey = `STORYBOOK_${version}_PORT`;
const port = parseInt(process.env[envKey] || String(defaultPort));
const pidFile = join(__dirname, `../.storybook-${version}.pid`);
const cwd = join(__dirname, `../e2e/storybook-${version}`);

async function main() {
  // Validate working directory exists
  if (!existsSync(cwd)) {
    console.error(`Error: e2e directory not found: ${cwd}`);
    console.error(`Run from the project root directory.`);
    process.exit(1);
  }

  // Check if dependencies are installed
  const nodeModulesPath = join(cwd, 'node_modules');
  if (!existsSync(nodeModulesPath)) {
    console.error(`Error: Dependencies not installed for Storybook ${version}`);
    console.error(`Run: npm run e2e:install:${version}`);
    process.exit(1);
  }

  // If --npm flag, install addon from npm registry instead of local
  if (useNpm) {
    console.log(`Installing storybook-addon-scratchpad from npm registry...`);
    try {
      execSync('npm install storybook-addon-scratchpad@latest', {
        cwd,
        stdio: 'inherit',
      });
      console.log(`Successfully installed from npm registry\n`);
    } catch (err) {
      console.error(`Error: Failed to install from npm registry`);
      console.error(`  ${err.message}`);
      process.exit(1);
    }
  }

  // Kill existing process if PID file exists
  if (existsSync(pidFile)) {
    try {
      const pid = parseInt(readFileSync(pidFile, 'utf8').trim());
      console.log(`Killing existing Storybook ${version} (PID: ${pid})...`);

      if (isWindows) {
        try {
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
        } catch {
          // Process might already be dead
        }
      } else {
        try {
          process.kill(-pid, 'SIGTERM');
        } catch {
          try {
            process.kill(pid, 'SIGTERM');
          } catch {
            // Process might already be dead
          }
        }
      }

      // Give it a moment to terminate
      await new Promise(resolve => setTimeout(resolve, 1500));
    } catch (err) {
      console.warn(`Warning: Could not read PID file: ${err.message}`);
    }

    try {
      unlinkSync(pidFile);
    } catch {
      // PID file might already be gone
    }
  }

  const mode = useNpm ? 'npm registry' : 'local build';
  console.log(`Starting Storybook ${version} on port ${port} (addon from ${mode})...`);
  console.log(`Working directory: ${cwd}`);

  // Use shell string on Windows to avoid DEP0190 warning about shell + args
  const command = isWindows
    ? `npx storybook dev -p ${port} --no-open`
    : 'npx';
  const args = isWindows
    ? []
    : ['storybook', 'dev', '-p', String(port), '--no-open'];

  const child = spawn(command, args, {
    cwd,
    stdio: 'inherit',
    shell: isWindows,
    detached: !isWindows,
  });

  // Handle spawn errors (e.g., command not found, permission denied)
  child.on('error', (err) => {
    console.error(`\nError: Failed to start Storybook ${version}`);
    console.error(`  ${err.message}`);
    if (err.code === 'ENOENT') {
      console.error(`  Make sure npx is available and dependencies are installed.`);
    }
    try {
      unlinkSync(pidFile);
    } catch {
      // Ignore
    }
    process.exit(1);
  });

  // Save PID
  writeFileSync(pidFile, String(child.pid));
  console.log(`Storybook ${version} started with PID: ${child.pid}`);
  console.log(`PID saved to: ${pidFile}`);
  console.log(`\nPress Ctrl+C to stop Storybook\n`);

  // Handle child process exit
  // Note: We intentionally do NOT delete the PID file here.
  // If the process exits unexpectedly (e.g., background task termination),
  // the PID file allows the next run to find and kill any orphaned processes.
  // The PID file is only deleted after successfully killing the process on next start.
  child.on('exit', (code, signal) => {
    if (signal) {
      console.log(`\nStorybook ${version} killed by signal: ${signal}`);
    } else if (code !== 0) {
      console.error(`\nStorybook ${version} exited with error code: ${code}`);
    } else {
      console.log(`\nStorybook ${version} exited`);
    }
    process.exit(code || 0);
  });

  // Handle graceful shutdown
  const shutdown = () => {
    console.log(`\nStopping Storybook ${version}...`);
    if (isWindows) {
      try {
        execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
      } catch {
        // Process might already be dead
      }
    } else {
      child.kill('SIGTERM');
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(`\nUnexpected error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
