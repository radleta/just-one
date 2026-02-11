/**
 * CLI argument parsing for just-one
 */

export interface CliOptions {
  name?: string;
  kill?: string;
  list: boolean;
  status?: string;
  killAll: boolean;
  ensure: boolean;
  clean: boolean;
  pid?: string;
  wait?: string;
  timeout?: number;
  grace?: number;
  daemon: boolean;
  logs?: string;
  tail: boolean;
  lines?: number;
  pidDir: string;
  quiet: boolean;
  help: boolean;
  version: boolean;
  command: string[];
}

export interface ParseResult {
  success: true;
  options: CliOptions;
}

export interface ParseError {
  success: false;
  error: string;
}

export type ParseOutput = ParseResult | ParseError;

const DEFAULT_PID_DIR = '.just-one';
const MAX_NAME_LENGTH = 255;

/**
 * Validate a process name for safe file operations
 * Rejects names containing path separators or traversal sequences
 */
function isValidName(name: string): boolean {
  if (!name || name.length > MAX_NAME_LENGTH) {
    return false;
  }
  // Reject path separators and traversal sequences
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    return false;
  }
  // Reject names that are only dots or whitespace
  if (/^[\s.]*$/.test(name)) {
    return false;
  }
  return true;
}

/**
 * Validate a PID directory path for safe file operations
 * Rejects paths containing traversal sequences
 */
function isValidPidDir(dir: string): boolean {
  if (!dir || dir.length > 1024) {
    return false;
  }
  // Reject path traversal sequences
  if (dir.includes('..')) {
    return false;
  }
  return true;
}

/**
 * Parse command line arguments
 */
export function parseArgs(args: string[]): ParseOutput {
  const options: CliOptions = {
    name: undefined,
    kill: undefined,
    list: false,
    status: undefined,
    killAll: false,
    ensure: false,
    clean: false,
    pid: undefined,
    wait: undefined,
    timeout: undefined,
    grace: undefined,
    daemon: false,
    logs: undefined,
    tail: false,
    lines: undefined,
    pidDir: DEFAULT_PID_DIR,
    quiet: false,
    help: false,
    version: false,
    command: [],
  };

  let i = 0;
  while (i < args.length) {
    // TypeScript requires this check due to noUncheckedIndexedAccess
    const arg = args[i]!;

    // Everything after -- is the command
    if (arg === '--') {
      options.command = args.slice(i + 1);
      break;
    }

    // Help
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      i++;
      continue;
    }

    // Version
    if (arg === '--version' || arg === '-v') {
      options.version = true;
      i++;
      continue;
    }

    // List
    if (arg === '--list' || arg === '-l') {
      options.list = true;
      i++;
      continue;
    }

    // Quiet
    if (arg === '--quiet' || arg === '-q') {
      options.quiet = true;
      i++;
      continue;
    }

    // Name (requires value)
    if (arg === '--name' || arg === '-n') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        return { success: false, error: 'Option --name requires a value' };
      }
      if (!isValidName(value)) {
        return {
          success: false,
          error: 'Invalid name: must not contain path separators or be too long',
        };
      }
      options.name = value;
      i += 2;
      continue;
    }

    // Kill (requires value)
    if (arg === '--kill' || arg === '-k') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        return { success: false, error: 'Option --kill requires a value' };
      }
      if (!isValidName(value)) {
        return {
          success: false,
          error: 'Invalid name: must not contain path separators or be too long',
        };
      }
      options.kill = value;
      i += 2;
      continue;
    }

    // PID directory (requires value)
    if (arg === '--pid-dir' || arg === '-d') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        return { success: false, error: 'Option --pid-dir requires a value' };
      }
      if (!isValidPidDir(value)) {
        return {
          success: false,
          error: 'Invalid PID directory: must not contain path traversal sequences',
        };
      }
      options.pidDir = value;
      i += 2;
      continue;
    }

    // Status (requires value)
    if (arg === '--status' || arg === '-s') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        return { success: false, error: 'Option --status requires a value' };
      }
      if (!isValidName(value)) {
        return {
          success: false,
          error: 'Invalid name: must not contain path separators or be too long',
        };
      }
      options.status = value;
      i += 2;
      continue;
    }

    // Kill All
    if (arg === '--kill-all' || arg === '-K') {
      options.killAll = true;
      i++;
      continue;
    }

    // Ensure
    if (arg === '--ensure' || arg === '-e') {
      options.ensure = true;
      i++;
      continue;
    }

    // Clean
    if (arg === '--clean') {
      options.clean = true;
      i++;
      continue;
    }

    // PID output (requires value)
    if (arg === '--pid' || arg === '-p') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        return { success: false, error: 'Option --pid requires a value' };
      }
      if (!isValidName(value)) {
        return {
          success: false,
          error: 'Invalid name: must not contain path separators or be too long',
        };
      }
      options.pid = value;
      i += 2;
      continue;
    }

    // Wait (requires value)
    if (arg === '--wait' || arg === '-w') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        return { success: false, error: 'Option --wait requires a value' };
      }
      if (!isValidName(value)) {
        return {
          success: false,
          error: 'Invalid name: must not contain path separators or be too long',
        };
      }
      options.wait = value;
      i += 2;
      continue;
    }

    // Daemon
    if (arg === '--daemon' || arg === '-D') {
      options.daemon = true;
      i++;
      continue;
    }

    // Logs (requires value)
    if (arg === '--logs' || arg === '-L') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        return { success: false, error: 'Option --logs requires a value' };
      }
      if (!isValidName(value)) {
        return {
          success: false,
          error: 'Invalid name: must not contain path separators or be too long',
        };
      }
      options.logs = value;
      i += 2;
      continue;
    }

    // Tail (follow logs)
    if (arg === '--tail' || arg === '-f') {
      options.tail = true;
      i++;
      continue;
    }

    // Lines (requires positive integer value)
    if (arg === '--lines') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        return { success: false, error: 'Option --lines requires a positive integer' };
      }
      const num = Number(value);
      if (!Number.isInteger(num) || num <= 0) {
        return { success: false, error: 'Option --lines requires a positive integer' };
      }
      options.lines = num;
      i += 2;
      continue;
    }

    // Timeout (requires numeric value)
    if (arg === '--timeout' || arg === '-t') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        return { success: false, error: 'Option --timeout requires a positive number' };
      }
      const num = Number(value);
      if (isNaN(num) || num <= 0) {
        return { success: false, error: 'Option --timeout requires a positive number' };
      }
      options.timeout = num;
      i += 2;
      continue;
    }

    // Grace period for kill (requires numeric value)
    if (arg === '--grace' || arg === '-g') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        return { success: false, error: 'Option --grace requires a positive number (seconds)' };
      }
      const num = Number(value);
      if (isNaN(num) || num <= 0) {
        return { success: false, error: 'Option --grace requires a positive number (seconds)' };
      }
      options.grace = num;
      i += 2;
      continue;
    }

    // Unknown option
    if (arg.startsWith('-')) {
      return { success: false, error: `Unknown option: ${arg}` };
    }

    // Unexpected positional argument
    return { success: false, error: `Unexpected argument: ${arg}` };
  }

  return { success: true, options };
}

/**
 * Validate parsed options
 */
export function validateOptions(options: CliOptions): ParseOutput {
  // Help and version don't need validation
  if (options.help || options.version) {
    return { success: true, options };
  }

  // List doesn't need name or command
  if (options.list) {
    return { success: true, options };
  }

  // Kill only needs a name
  if (options.kill) {
    return { success: true, options };
  }

  // Logs is a standalone operation
  if (options.logs) {
    return { success: true, options };
  }

  // --tail and --lines only valid with --logs
  if (options.tail) {
    return { success: false, error: 'Option --tail can only be used with --logs' };
  }
  if (options.lines !== undefined) {
    return { success: false, error: 'Option --lines can only be used with --logs' };
  }

  // Standalone operations that don't need name or command
  if (options.status) {
    return { success: true, options };
  }
  if (options.killAll) {
    return { success: true, options };
  }
  if (options.clean) {
    return { success: true, options };
  }
  if (options.pid) {
    return { success: true, options };
  }
  if (options.wait) {
    if (options.timeout !== undefined && options.timeout <= 0) {
      return { success: false, error: 'Option --timeout requires a positive number' };
    }
    return { success: true, options };
  }

  // Timeout without wait is an error
  if (options.timeout !== undefined && !options.wait) {
    return { success: false, error: 'Option --timeout can only be used with --wait' };
  }

  // Daemon requires name and command (validated below as part of normal run)
  // No special check needed here since daemon is a modifier for run

  // Running a command requires both name and command
  if (!options.name) {
    return { success: false, error: 'Option --name is required when running a command' };
  }

  if (options.command.length === 0) {
    return { success: false, error: 'No command specified. Use: just-one -n <name> -- <command>' };
  }

  return { success: true, options };
}

/**
 * Get help text
 */
export function getHelpText(): string {
  return `just-one - Ensure only one instance of a command runs at a time

Usage:
  just-one -n <name> -- <command>    Run command, killing any previous instance
  just-one -n <name> -e -- <command> Run only if not already running (ensure mode)
  just-one -n <name> -D -- <command> Run in daemon mode (background, logs to file)
  just-one -L <name>                 View captured logs for a named process
  just-one -L <name> -f              Follow logs in real-time (auto-exits on process death)
  just-one -k <name>                 Kill a named process
  just-one -K                        Kill all tracked processes
  just-one -s <name>                 Check if a named process is running
  just-one -p <name>                 Print the PID of a named process
  just-one -w <name>                 Wait for a named process to exit
  just-one -l                        List all tracked processes
  just-one --clean                   Remove stale PID files and orphaned log files

Options:
  -n, --name <name>      Name to identify this process (required for running)
  -D, --daemon           Run in background with output captured to log file
  -L, --logs <name>      View captured logs for a named process
  -f, --tail             Follow log output in real-time (use with --logs)
  --lines <n>            Number of lines to show (use with --logs, default: all)
  -k, --kill <name>      Kill the named process and exit
  -K, --kill-all         Kill all tracked processes
  -s, --status <name>    Check if a named process is running (exit 0=running, 1=stopped)
  -e, --ensure           Only start if not already running (use with -n and command)
  -p, --pid <name>       Print the PID of a named process
  -w, --wait <name>      Wait for a named process to exit
  -t, --timeout <secs>   Timeout in seconds (use with --wait)
  -g, --grace <secs>     Grace period before force kill (default: 5s)
  --clean                Remove stale PID files and orphaned log files
  -l, --list             List all tracked processes and their status
  -d, --pid-dir <dir>    Directory for PID files (default: .just-one/)
  -q, --quiet            Suppress output
  -h, --help             Show this help message
  -v, --version          Show version number

Examples:
  # Run storybook, killing any previous instance
  just-one -n storybook -- npx storybook dev -p 6006

  # Run vite dev server only if not already running
  just-one -n vite -e -- npm run dev

  # Run in daemon mode (background with log capture)
  just-one -n myapp -D -- npm start

  # View captured logs
  just-one -L myapp

  # View last 50 lines of logs
  just-one -L myapp --lines 50

  # Follow logs in real-time (like tail -f)
  just-one -L myapp -f

  # Check if a process is running
  just-one -s storybook

  # Get the PID for scripting
  pid=$(just-one -p storybook -q)

  # Kill all tracked processes
  just-one -K

  # Wait for a process to exit (with 30s timeout)
  just-one -w myapp -t 30

  # Clean up stale PID files and orphaned logs
  just-one --clean

  # Kill a named process
  just-one -k storybook

  # List all tracked processes
  just-one -l
`;
}
