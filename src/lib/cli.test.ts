import { describe, it, expect } from 'vitest';
import { parseArgs, validateOptions, getHelpText, type CliOptions } from './cli.js';

describe('parseArgs', () => {
  describe('help and version flags', () => {
    it('parses --help flag', () => {
      const result = parseArgs(['--help']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.help).toBe(true);
      }
    });

    it('parses -h flag', () => {
      const result = parseArgs(['-h']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.help).toBe(true);
      }
    });

    it('parses --version flag', () => {
      const result = parseArgs(['--version']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.version).toBe(true);
      }
    });

    it('parses -v flag', () => {
      const result = parseArgs(['-v']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.version).toBe(true);
      }
    });
  });

  describe('list flag', () => {
    it('parses --list flag', () => {
      const result = parseArgs(['--list']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.list).toBe(true);
      }
    });

    it('parses -l flag', () => {
      const result = parseArgs(['-l']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.list).toBe(true);
      }
    });
  });

  describe('quiet flag', () => {
    it('parses --quiet flag', () => {
      const result = parseArgs(['--quiet', '-l']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.quiet).toBe(true);
      }
    });

    it('parses -q flag', () => {
      const result = parseArgs(['-q', '-l']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.quiet).toBe(true);
      }
    });
  });

  describe('name option', () => {
    it('parses --name with value', () => {
      const result = parseArgs(['--name', 'myapp', '--', 'node', 'server.js']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.name).toBe('myapp');
      }
    });

    it('parses -n with value', () => {
      const result = parseArgs(['-n', 'myapp', '--', 'node', 'server.js']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.name).toBe('myapp');
      }
    });

    it('returns error when --name has no value', () => {
      const result = parseArgs(['--name']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('--name requires a value');
      }
    });

    it('returns error when --name value starts with dash', () => {
      const result = parseArgs(['--name', '--list']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('--name requires a value');
      }
    });
  });

  describe('kill option', () => {
    it('parses --kill with value', () => {
      const result = parseArgs(['--kill', 'myapp']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.kill).toBe('myapp');
      }
    });

    it('parses -k with value', () => {
      const result = parseArgs(['-k', 'myapp']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.kill).toBe('myapp');
      }
    });

    it('returns error when --kill has no value', () => {
      const result = parseArgs(['--kill']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('--kill requires a value');
      }
    });
  });

  describe('pid-dir option', () => {
    it('parses --pid-dir with value', () => {
      const result = parseArgs(['--pid-dir', '/tmp', '-l']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.pidDir).toBe('/tmp');
      }
    });

    it('parses -d with value', () => {
      const result = parseArgs(['-d', '/tmp', '-l']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.pidDir).toBe('/tmp');
      }
    });

    it('uses default pid-dir when not specified', () => {
      const result = parseArgs(['-l']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.pidDir).toBe('.just-one');
      }
    });

    it('returns error when --pid-dir has no value', () => {
      const result = parseArgs(['--pid-dir']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('--pid-dir requires a value');
      }
    });
  });

  describe('command parsing', () => {
    it('parses command after --', () => {
      const result = parseArgs(['-n', 'myapp', '--', 'node', 'server.js', '--port', '3000']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.command).toEqual(['node', 'server.js', '--port', '3000']);
      }
    });

    it('returns empty command when no -- is present', () => {
      const result = parseArgs(['-n', 'myapp']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.command).toEqual([]);
      }
    });
  });

  describe('error cases', () => {
    it('returns error for unknown option', () => {
      const result = parseArgs(['--unknown']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Unknown option');
      }
    });

    it('returns error for unexpected positional argument', () => {
      const result = parseArgs(['unexpected']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Unexpected argument');
      }
    });
  });
});

describe('validateOptions', () => {
  const baseOptions: CliOptions = {
    name: undefined,
    kill: undefined,
    list: false,
    pidDir: '.just-one',
    quiet: false,
    help: false,
    version: false,
    command: [],
  };

  it('allows help without other options', () => {
    const result = validateOptions({ ...baseOptions, help: true });
    expect(result.success).toBe(true);
  });

  it('allows version without other options', () => {
    const result = validateOptions({ ...baseOptions, version: true });
    expect(result.success).toBe(true);
  });

  it('allows list without name or command', () => {
    const result = validateOptions({ ...baseOptions, list: true });
    expect(result.success).toBe(true);
  });

  it('allows kill with just a name', () => {
    const result = validateOptions({ ...baseOptions, kill: 'myapp' });
    expect(result.success).toBe(true);
  });

  it('requires name when running a command', () => {
    const result = validateOptions({ ...baseOptions, command: ['node', 'server.js'] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('--name is required');
    }
  });

  it('requires command when name is provided', () => {
    const result = validateOptions({ ...baseOptions, name: 'myapp' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('No command specified');
    }
  });

  it('validates successfully when name and command are both provided', () => {
    const result = validateOptions({
      ...baseOptions,
      name: 'myapp',
      command: ['node', 'server.js'],
    });
    expect(result.success).toBe(true);
  });
});

describe('getHelpText', () => {
  it('returns help text containing usage information', () => {
    const help = getHelpText();
    expect(help).toContain('just-one');
    expect(help).toContain('Usage:');
    expect(help).toContain('Options:');
    expect(help).toContain('Examples:');
    expect(help).toContain('--name');
    expect(help).toContain('--kill');
    expect(help).toContain('--list');
    expect(help).toContain('--help');
    expect(help).toContain('--version');
  });
});

describe('Security validation', () => {
  describe('name validation', () => {
    it('rejects names with forward slash (path traversal)', () => {
      const result = parseArgs(['-n', '../etc/passwd', '--', 'echo']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid name');
      }
    });

    it('rejects names with backslash (path traversal)', () => {
      const result = parseArgs(['-n', '..\\windows\\system32', '--', 'echo']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid name');
      }
    });

    it('rejects names with double dot sequences', () => {
      const result = parseArgs(['-n', 'foo..bar', '--', 'echo']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid name');
      }
    });

    it('rejects names that are only dots', () => {
      const result = parseArgs(['-n', '..', '--', 'echo']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid name');
      }
    });

    it('rejects names that are only whitespace', () => {
      const result = parseArgs(['-n', '   ', '--', 'echo']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid name');
      }
    });

    it('accepts valid names with hyphens and underscores', () => {
      const result = parseArgs(['-n', 'my-app_v1', '--', 'echo']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.name).toBe('my-app_v1');
      }
    });

    it('accepts valid names with numbers', () => {
      const result = parseArgs(['-n', 'app123', '--', 'echo']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.name).toBe('app123');
      }
    });
  });

  describe('kill name validation', () => {
    it('rejects kill names with path traversal', () => {
      const result = parseArgs(['-k', '../etc/passwd']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid name');
      }
    });

    it('accepts valid kill names', () => {
      const result = parseArgs(['-k', 'my-process']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.kill).toBe('my-process');
      }
    });
  });

  describe('pid-dir validation', () => {
    it('rejects pid-dir with path traversal', () => {
      const result = parseArgs(['-d', '../../../etc', '-n', 'test', '--', 'echo']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid PID directory');
      }
    });

    it('rejects pid-dir with embedded double dots', () => {
      const result = parseArgs(['-d', 'foo/../bar', '-n', 'test', '--', 'echo']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid PID directory');
      }
    });

    it('accepts valid absolute paths', () => {
      const result = parseArgs(['-d', '/var/run/just-one', '-n', 'test', '--', 'echo']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.pidDir).toBe('/var/run/just-one');
      }
    });

    it('accepts valid relative paths without traversal', () => {
      const result = parseArgs(['-d', './pids', '-n', 'test', '--', 'echo']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.pidDir).toBe('./pids');
      }
    });
  });
});
