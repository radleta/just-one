/**
 * Windows process launch with handle inheritance turned off.
 *
 * libuv's CreateProcessW call always passes bInheritHandles = TRUE, so a
 * detached daemon started through Node's spawn() keeps every inheritable
 * handle this process holds — including a caller's output pipe that an
 * ancestor shell left inheritable — and the caller never sees
 * EOF while the daemon lives. Calling CreateProcessW directly with inheritance
 * off is what libuv#5100 does upstream; delete this module once a released
 * Node carries that fix.
 */

import { createRequire } from 'module';

const DETACHED_PROCESS = 0x8;
const CREATE_NEW_PROCESS_GROUP = 0x200;
const STARTF_USESHOWWINDOW = 0x1;
const SW_HIDE = 0;

/** Quotes one argument by libuv's quote_cmd_arg (MSVCRT) rules. */
function quoteArg(arg: string): string {
  if (arg === '') return '""';
  if (!/[ \t"]/.test(arg)) return arg;
  return '"' + arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
}

/**
 * Builds a CreateProcessW command line that node.exe (or any MSVCRT program)
 * parses back into exactly `file` followed by `args`.
 */
export function buildWindowsCommandLine(file: string, args: string[]): string {
  return [file, ...args].map(quoteArg).join(' ');
}

type Win32 = ReturnType<typeof bindWin32>;
let win32: Win32 | undefined;

// koffi is an optional dependency loaded on first use, so Unix and foreground
// mode never pay for it and a missing install surfaces as a catchable error.
function bindWin32() {
  let koffi: typeof import('koffi');
  let kernel32: ReturnType<typeof koffi.load>;
  try {
    koffi = createRequire(import.meta.url)('koffi') as typeof import('koffi');
    kernel32 = koffi.load('kernel32.dll');
  } catch (err) {
    // First line only: a missing module's message appends a multi-line require stack.
    const message = (err instanceof Error ? err.message : String(err)).split(/\r?\n/, 1)[0];
    throw new Error(
      `koffi could not be loaded (${message}); reinstall just-one with optional dependencies to fix this`
    );
  }

  const STARTUPINFOW = koffi.struct({
    cb: 'uint32',
    lpReserved: 'void *',
    lpDesktop: 'void *',
    lpTitle: 'void *',
    dwX: 'uint32',
    dwY: 'uint32',
    dwXSize: 'uint32',
    dwYSize: 'uint32',
    dwXCountChars: 'uint32',
    dwYCountChars: 'uint32',
    dwFillAttribute: 'uint32',
    dwFlags: 'uint32',
    wShowWindow: 'uint16',
    cbReserved2: 'uint16',
    lpReserved2: 'void *',
    hStdInput: 'void *',
    hStdOutput: 'void *',
    hStdError: 'void *',
  });
  const PROCESS_INFORMATION = koffi.struct({
    hProcess: 'void *',
    hThread: 'void *',
    dwProcessId: 'uint32',
    dwThreadId: 'uint32',
  });

  return {
    startupInfoSize: koffi.sizeof(STARTUPINFOW),
    CreateProcessW: kernel32.func('__stdcall', 'CreateProcessW', 'int', [
      'str16',
      'void *',
      'void *',
      'void *',
      'int',
      'uint32',
      'void *',
      'str16',
      koffi.pointer(STARTUPINFOW),
      koffi.out(koffi.pointer(PROCESS_INFORMATION)),
    ]),
    GetLastError: kernel32.func('__stdcall', 'GetLastError', 'uint32', []),
    CloseHandle: kernel32.func('__stdcall', 'CloseHandle', 'int', ['void *']),
  };
}

/**
 * Starts `file` with `args` detached, hidden, and with no inherited handles.
 * A NULL environment and directory give the child this process's live
 * environment and cwd. Returns the child's PID. Windows only.
 */
export function spawnDetachedWithoutInheritance(file: string, args: string[]): number {
  win32 ??= bindWin32();

  // CreateProcessW may write to lpCommandLine, so it gets a writable buffer.
  const commandLine = Buffer.from(buildWindowsCommandLine(file, args) + '\0', 'utf16le');
  const startupInfo = {
    cb: win32.startupInfoSize,
    dwFlags: STARTF_USESHOWWINDOW,
    wShowWindow: SW_HIDE,
  };
  const processInfo: { hProcess?: unknown; hThread?: unknown; dwProcessId?: number } = {};

  const ok = win32.CreateProcessW(
    file,
    commandLine,
    null,
    null,
    0,
    DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
    null,
    null,
    startupInfo,
    processInfo
  );
  if (!ok) {
    const code = win32.GetLastError();
    throw new Error(
      `CreateProcessW failed with Windows error ${code}; security software may have blocked it, so report the code at https://github.com/radleta/just-one/issues if it persists`
    );
  }

  win32.CloseHandle(processInfo.hProcess);
  win32.CloseHandle(processInfo.hThread);
  return processInfo.dwProcessId!;
}
