---
tags: [just-one-expert/testing]
summary: "How to test just-one without harming the machine or fooling yourself: PID-scoped cleanup, Windows e2e traps, the PowerShell pipe-leak test, testing a published version, and smoke-testing the CLI by hand"
page-kind: procedure
---
# Testing

The test commands are `package.json` `scripts` (`test`, `test:coverage`, `test:npm`, `validate`).
Unit tests sit beside the module they cover; only `src/lib/**` is under the coverage gate, which is
why logic belongs there ([architecture](architecture.md)). The end-to-end suite,
`src/e2e/cli.e2e.test.ts`, runs the built CLI, so run `npm run build` before it.

## Clean up by PID, never by name

Record the PID of every process a test spawns, and clean up by that PID in `afterEach` or a
`finally`, ignoring the error when it is already dead:

```typescript
try {
  if (process.platform === 'win32') execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'pipe' });
  else process.kill(pid);
} catch {
  // already dead
}
```

For a test PID directory, use the e2e helpers `killTrackedProcesses` and `cleanTestDir` in
[`cli.e2e.test.ts`](../../../src/e2e/cli.e2e.test.ts). Never kill by image name
([process-killing](process-killing.md)).

## Windows and CI traps

- **Slow process operations.** Windows process calls take far longer; the global `testTimeout` in
  [`vitest.config.ts`](../../../vitest.config.ts) is set for that. When an e2e test flakes on
  Windows, widen its waits before suspecting the code.
- **File locks.** Kill the tracked daemons before `rmSync`ing their directory, and retry the removal.
  `killTrackedProcesses` then `cleanTestDir`, in that order, do both.
- **`cmd.exe` quoting.** Do not pass inline scripts with `node -e '...'`; `cmd.exe` mangles the
  quotes. Write a helper `.js` file to disk and run that.
- **No `fs.watchFile`.** libuv can skip poll intervals under CI load. Poll with `setInterval` and
  `statSync`, as [`log.ts` `tailLogFile`](../../../src/lib/log.ts) does.
- **mtime assertions.** Assert a preserved mtime to within 1 ms, never exactly; the reason is on
  [pid-file](pid-file.md).
- **The PowerShell pipe-leak test** ("daemon does not hold the caller's output pipe under a
  PowerShell layer on Windows") must keep launching through `powershell.exe`. Its comment says why.
  Do not rewrite it to hand Node an extra fd instead: that version passes on the bug. The general
  rule behind it is in the user-level `nodejs-expert` skill (page `windows-child-spawn`).

## Testing a published version

Do not run `JUST_ONE_NPX=1 JUST_ONE_CLI=@radleta/just-one@<v> npx vitest run src/e2e/` when `<v>`
equals the version in the local `package.json`: npx resolves the workspace build, and the run tests
the current code against itself. It once passed 79/79 while the published 1.4.2 failed 6 of the
same tests.

Instead:

1. Install the published version into a temp directory
   (`npm install @radleta/just-one@<v>` inside an empty `npm init -y` project).
2. Set `JUST_ONE_CLI` to the absolute path of its `node_modules/@radleta/just-one/bin/just-one.js`.
3. Run `npx vitest run src/e2e/` with no `JUST_ONE_NPX`.

`npm run test:npm` honors an inherited `JUST_ONE_CLI` and otherwise tests `latest`, but it always
sets `JUST_ONE_NPX=1`, so it cannot take the absolute-path route.

## Smoke-testing the CLI by hand

```bash
npm run build
node bin/just-one.js -n test -- ping -n 60 127.0.0.1   # Windows: there is no sleep
node bin/just-one.js -n test -- sleep 60               # Unix
node bin/just-one.js -l
node bin/just-one.js -k test
```
