/**
 * CLI argument parsing for just-one
 */

export interface CliOptions {
  name?: string;
  kill?: string;
  list: boolean;
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
        return { success: false, error: 'Invalid name: must not contain path separators or be too long' };
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
        return { success: false, error: 'Invalid name: must not contain path separators or be too long' };
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
        return { success: false, error: 'Invalid PID directory: must not contain path traversal sequences' };
      }
      options.pidDir = value;
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
  just-one -k <name>                 Kill a named process
  just-one -l                        List all tracked processes

Options:
  -n, --name <name>     Name to identify this process (required for running)
  -k, --kill <name>     Kill the named process and exit
  -l, --list            List all tracked processes and their status
  -d, --pid-dir <dir>   Directory for PID files (default: .just-one/)
  -q, --quiet           Suppress output
  -h, --help            Show this help message
  -v, --version         Show version number

Examples:
  # Run storybook, killing any previous instance
  just-one -n storybook -- npx storybook dev -p 6006

  # Run vite dev server
  just-one -n vite -- npm run dev

  # Kill a named process
  just-one -k storybook

  # List all tracked processes
  just-one -l
`;
}
