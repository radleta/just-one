/**
 * Reference implementation from akn-www
 *
 * This script shows an alternative pattern: using npm's "predev" hook to
 * automatically kill the previous server before starting a new one.
 *
 * Key patterns:
 * - Uses a JSON file instead of plain PID (includes repoPath, port)
 * - Has isProcessAlive() check before killing
 * - Runs as a pre-hook (predev) - transparent to developer
 * - Doesn't block on errors (graceful degradation)
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_SERVER_FILE = path.join(__dirname, '..', 'dist', '.vite', 'dev-server.json');

/**
 * Check if a process with the given PID is still running.
 */
function isProcessAlive(pid) {
  try {
    if (process.platform === 'win32') {
      // Windows: tasklist returns exit code 0 if process found
      const output = execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      return output.includes(String(pid));
    } else {
      // Unix/Mac: kill -0 checks if process exists without killing it
      execSync(`kill -0 ${pid}`, { stdio: ['pipe', 'pipe', 'pipe'] });
      return true;
    }
  } catch {
    return false;
  }
}

/**
 * Kill a process by PID.
 */
function killProcess(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /F`, { stdio: ['pipe', 'pipe', 'pipe'] });
    } else {
      execSync(`kill -9 ${pid}`, { stdio: ['pipe', 'pipe', 'pipe'] });
    }
    return true;
  } catch (err) {
    console.warn(`[kill-existing-dev] Warning: Could not kill PID ${pid}: ${err.message}`);
    return false;
  }
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  // Check if dev-server.json exists
  if (!fs.existsSync(DEV_SERVER_FILE)) {
    // No existing server info - proceed with starting new server
    process.exit(0);
  }

  let serverInfo;
  try {
    serverInfo = JSON.parse(fs.readFileSync(DEV_SERVER_FILE, 'utf-8'));
  } catch (err) {
    // Corrupted file - clean up and proceed
    console.log(`[kill-existing-dev] Removing corrupted ${DEV_SERVER_FILE}`);
    fs.unlinkSync(DEV_SERVER_FILE);
    process.exit(0);
  }

  const { pid, repoPath, port } = serverInfo;
  const currentRepo = process.cwd();

  // Check if the existing server is from the same repository
  if (repoPath !== currentRepo) {
    // Different repo - this is fine, allow both to run
    // But clean up the stale file since it doesn't apply to us
    console.log(`[kill-existing-dev] Found dev-server.json from different repo, ignoring`);
    process.exit(0);
  }

  // Same repo - check if the process is still alive
  if (!pid || !isProcessAlive(pid)) {
    // Process is dead - clean up stale file
    console.log(`[kill-existing-dev] Cleaning up stale dev-server.json (PID ${pid} not running)`);
    fs.unlinkSync(DEV_SERVER_FILE);
    process.exit(0);
  }

  // Process is alive and from the same repo - kill it
  console.log(`[kill-existing-dev] Killing existing dev server (PID ${pid}, port ${port})...`);

  if (killProcess(pid)) {
    console.log(`[kill-existing-dev] Killed PID ${pid}`);

    // Wait briefly for the port to be released
    await sleep(500);

    // Clean up the file
    if (fs.existsSync(DEV_SERVER_FILE)) {
      fs.unlinkSync(DEV_SERVER_FILE);
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error(`[kill-existing-dev] Error: ${err.message}`);
  // Don't block dev server start on errors
  process.exit(0);
});
