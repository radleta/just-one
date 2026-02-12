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

  describe('status option', () => {
    it('parses --status with value', () => {
      const result = parseArgs(['--status', 'myapp']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.status).toBe('myapp');
      }
    });

    it('parses -s with value', () => {
      const result = parseArgs(['-s', 'myapp']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.status).toBe('myapp');
      }
    });

    it('returns error when --status has no value', () => {
      const result = parseArgs(['--status']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('--status requires a value');
      }
    });

    it('returns error when --status value starts with dash', () => {
      const result = parseArgs(['--status', '--list']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('--status requires a value');
      }
    });

    it('rejects status names with path traversal', () => {
      const result = parseArgs(['-s', '../etc/passwd']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid name');
      }
    });
  });

  describe('kill-all flag', () => {
    it('parses --kill-all flag', () => {
      const result = parseArgs(['--kill-all']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.killAll).toBe(true);
      }
    });

    it('parses -K flag', () => {
      const result = parseArgs(['-K']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.killAll).toBe(true);
      }
    });
  });

  describe('ensure flag', () => {
    it('parses --ensure flag', () => {
      const result = parseArgs(['-n', 'myapp', '--ensure', '--', 'node', 'server.js']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.ensure).toBe(true);
      }
    });

    it('parses -e flag', () => {
      const result = parseArgs(['-n', 'myapp', '-e', '--', 'node', 'server.js']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.ensure).toBe(true);
      }
    });
  });

  describe('clean flag', () => {
    it('parses --clean flag', () => {
      const result = parseArgs(['--clean']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.clean).toBe(true);
      }
    });

    it('does not have a short form -c', () => {
      const result = parseArgs(['-c']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Unknown option');
      }
    });
  });

  describe('pid option', () => {
    it('parses --pid with value', () => {
      const result = parseArgs(['--pid', 'myapp']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.pid).toBe('myapp');
      }
    });

    it('parses -p with value', () => {
      const result = parseArgs(['-p', 'myapp']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.pid).toBe('myapp');
      }
    });

    it('returns error when --pid has no value', () => {
      const result = parseArgs(['--pid']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('--pid requires a value');
      }
    });

    it('returns error when --pid value starts with dash', () => {
      const result = parseArgs(['--pid', '--list']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('--pid requires a value');
      }
    });

    it('rejects pid names with path traversal', () => {
      const result = parseArgs(['-p', '../etc/passwd']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid name');
      }
    });
  });

  describe('wait option', () => {
    it('parses --wait with value', () => {
      const result = parseArgs(['--wait', 'myapp']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.wait).toBe('myapp');
      }
    });

    it('parses -w with value', () => {
      const result = parseArgs(['-w', 'myapp']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.wait).toBe('myapp');
      }
    });

    it('returns error when --wait has no value', () => {
      const result = parseArgs(['--wait']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('--wait requires a value');
      }
    });

    it('returns error when --wait value starts with dash', () => {
      const result = parseArgs(['--wait', '--list']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('--wait requires a value');
      }
    });

    it('rejects wait names with path traversal', () => {
      const result = parseArgs(['-w', '../etc/passwd']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid name');
      }
    });
  });

  describe('timeout option', () => {
    it('parses --timeout with numeric value', () => {
      const result = parseArgs(['-w', 'myapp', '--timeout', '30']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.timeout).toBe(30);
      }
    });

    it('parses -t with numeric value', () => {
      const result = parseArgs(['-w', 'myapp', '-t', '10']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.timeout).toBe(10);
      }
    });

    it('accepts decimal values', () => {
      const result = parseArgs(['-w', 'myapp', '-t', '2.5']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.timeout).toBe(2.5);
      }
    });

    it('returns error when --timeout has no value', () => {
      const result = parseArgs(['--timeout']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('--timeout requires a positive number');
      }
    });

    it('returns error when --timeout value is not a number', () => {
      const result = parseArgs(['-w', 'myapp', '--timeout', 'abc']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('--timeout requires a positive number');
      }
    });

    it('returns error when --timeout value is zero', () => {
      const result = parseArgs(['-w', 'myapp', '--timeout', '0']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('--timeout requires a positive number');
      }
    });

    it('returns error when --timeout value starts with dash', () => {
      const result = parseArgs(['--timeout', '-5']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('--timeout requires a positive number');
      }
    });
  });

  describe('grace option', () => {
    it('parses --grace with numeric value', () => {
      const result = parseArgs(['-n', 'myapp', '--grace', '10', '--', 'sleep', '60']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.grace).toBe(10);
      }
    });

    it('parses -g with numeric value', () => {
      const result = parseArgs(['-n', 'myapp', '-g', '3', '--', 'sleep', '60']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.grace).toBe(3);
      }
    });

    it('accepts decimal values', () => {
      const result = parseArgs(['-n', 'myapp', '--grace', '2.5', '--', 'sleep', '60']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.grace).toBe(2.5);
      }
    });

    it('returns error when --grace has no value', () => {
      const result = parseArgs(['--grace']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('--grace requires a positive number');
      }
    });

    it('returns error when --grace value is not a number', () => {
      const result = parseArgs(['-n', 'myapp', '--grace', 'abc']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('--grace requires a positive number');
      }
    });

    it('returns error when --grace value is zero', () => {
      const result = parseArgs(['-n', 'myapp', '--grace', '0']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('--grace requires a positive number');
      }
    });

    it('returns error when --grace value starts with dash', () => {
      const result = parseArgs(['--grace', '-5']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('--grace requires a positive number');
      }
    });

    it('defaults grace to undefined', () => {
      const result = parseArgs(['-n', 'myapp', '--', 'sleep', '60']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.grace).toBeUndefined();
      }
    });
  });

  describe('daemon flag', () => {
    it('parses --daemon flag', () => {
      const result = parseArgs(['-n', 'myapp', '--daemon', '--', 'node', 'server.js']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.daemon).toBe(true);
      }
    });

    it('parses -D flag', () => {
      const result = parseArgs(['-n', 'myapp', '-D', '--', 'node', 'server.js']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.daemon).toBe(true);
      }
    });
  });

  describe('logs option', () => {
    it('parses --logs with value', () => {
      const result = parseArgs(['--logs', 'myapp']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.logs).toBe('myapp');
      }
    });

    it('parses -L with value', () => {
      const result = parseArgs(['-L', 'myapp']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.logs).toBe('myapp');
      }
    });

    it('returns error when --logs has no value', () => {
      const result = parseArgs(['--logs']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('--logs requires a value');
      }
    });

    it('returns error when --logs value starts with dash', () => {
      const result = parseArgs(['--logs', '--list']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('--logs requires a value');
      }
    });

    it('rejects logs names with path traversal', () => {
      const result = parseArgs(['-L', '../etc/passwd']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid name');
      }
    });
  });

  describe('tail flag', () => {
    it('parses --tail flag', () => {
      const result = parseArgs(['-L', 'myapp', '--tail']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.tail).toBe(true);
      }
    });

    it('parses -f flag', () => {
      const result = parseArgs(['-L', 'myapp', '-f']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.tail).toBe(true);
      }
    });
  });

  describe('lines option', () => {
    it('parses --lines with positive integer', () => {
      const result = parseArgs(['-L', 'myapp', '--lines', '50']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.options.lines).toBe(50);
      }
    });

    it('returns error when --lines has no value', () => {
      const result = parseArgs(['--lines']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('--lines requires a positive integer');
      }
    });

    it('returns error when --lines is not a number', () => {
      const result = parseArgs(['-L', 'myapp', '--lines', 'abc']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('--lines requires a positive integer');
      }
    });

    it('returns error when --lines is zero', () => {
      const result = parseArgs(['-L', 'myapp', '--lines', '0']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('--lines requires a positive integer');
      }
    });

    it('returns error when --lines is a decimal', () => {
      const result = parseArgs(['-L', 'myapp', '--lines', '2.5']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('--lines requires a positive integer');
      }
    });

    it('returns error when --lines value starts with dash', () => {
      const result = parseArgs(['--lines', '-5']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('--lines requires a positive integer');
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

  it('allows status without name or command', () => {
    const result = validateOptions({ ...baseOptions, status: 'myapp' });
    expect(result.success).toBe(true);
  });

  it('allows killAll without name or command', () => {
    const result = validateOptions({ ...baseOptions, killAll: true });
    expect(result.success).toBe(true);
  });

  it('allows clean without name or command', () => {
    const result = validateOptions({ ...baseOptions, clean: true });
    expect(result.success).toBe(true);
  });

  it('allows pid without name or command', () => {
    const result = validateOptions({ ...baseOptions, pid: 'myapp' });
    expect(result.success).toBe(true);
  });

  it('allows wait without name or command', () => {
    const result = validateOptions({ ...baseOptions, wait: 'myapp' });
    expect(result.success).toBe(true);
  });

  it('allows wait with timeout', () => {
    const result = validateOptions({ ...baseOptions, wait: 'myapp', timeout: 30 });
    expect(result.success).toBe(true);
  });

  it('errors when timeout is used without wait', () => {
    const result = validateOptions({ ...baseOptions, timeout: 30 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('--timeout can only be used with --wait');
    }
  });

  it('allows ensure with name and command', () => {
    const result = validateOptions({
      ...baseOptions,
      ensure: true,
      name: 'myapp',
      command: ['node', 'server.js'],
    });
    expect(result.success).toBe(true);
  });

  it('allows logs as standalone operation', () => {
    const result = validateOptions({ ...baseOptions, logs: 'myapp' });
    expect(result.success).toBe(true);
  });

  it('allows logs with tail', () => {
    const result = validateOptions({ ...baseOptions, logs: 'myapp', tail: true });
    expect(result.success).toBe(true);
  });

  it('allows logs with lines', () => {
    const result = validateOptions({ ...baseOptions, logs: 'myapp', lines: 50 });
    expect(result.success).toBe(true);
  });

  it('allows logs with tail and lines', () => {
    const result = validateOptions({ ...baseOptions, logs: 'myapp', tail: true, lines: 20 });
    expect(result.success).toBe(true);
  });

  it('errors when tail is used without logs', () => {
    const result = validateOptions({ ...baseOptions, tail: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('--tail can only be used with --logs');
    }
  });

  it('errors when lines is used without logs', () => {
    const result = validateOptions({ ...baseOptions, lines: 50 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('--lines can only be used with --logs');
    }
  });

  it('allows daemon with name and command', () => {
    const result = validateOptions({
      ...baseOptions,
      daemon: true,
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

  it('contains new flag names', () => {
    const help = getHelpText();
    expect(help).toContain('--status');
    expect(help).toContain('--kill-all');
    expect(help).toContain('--ensure');
    expect(help).toContain('--clean');
    expect(help).toContain('--pid');
    expect(help).toContain('--wait');
    expect(help).toContain('--timeout');
    expect(help).toContain('--grace');
    expect(help).toContain('--daemon');
    expect(help).toContain('--logs');
    expect(help).toContain('--tail');
    expect(help).toContain('--lines');
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
