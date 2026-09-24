---
tags: [just-one-expert/process-identity]
summary: "How a tracked PID is proven to be the same process before any kill: evidence per platform, the mtime fallback and its WSL2 failure, verdict semantics, and when evidence gets recorded"
page-kind: reference
---
# Process identity

Before just-one kills, skips or reports a tracked PID, it checks that the process holding that PID
is the one it started. A recycled PID that now belongs to an unrelated process must never be
killed. [process-killing](process-killing.md) runs this check before every kill; the evidence is
stored in the [pid-file](pid-file.md).

## Evidence per platform

The resolution order is in the doc comment of
[`process.ts` `isSameProcessInstance`](../../../src/lib/process.ts), and its inline comments explain
why a failed read means different things on the ticks branch and on the start-time branch. Read
them before you reorder anything.

| Platform | Recorded key | Source | Compared |
|---|---|---|---|
| Linux | `startTicks=` | field 22 of `/proc/<pid>/stat`, [`getProcessStartTicks`](../../../src/lib/process.ts) | exactly |
| Windows | `startTime=` | pidusage start time, [`getProcessStartTime`](../../../src/lib/process.ts) | exactly |
| macOS | `startTime=` | `ps -o lstart`, [`getProcessLstart`](../../../src/lib/process.ts) | exactly |
| BSD, other, and any legacy bare-PID file | none | PID file mtime against the pidusage start time | within `START_TIME_TOLERANCE_MS` |

- **Windows.** An exact comparison is safe because pidusage's value there reduces to the
  OS-reported `creation.getTime()`. It was measured stable across repeated reads and identical
  between the `wmic` and `gwmi` backends. Keep the comparison exact.
- **macOS.** Why `lstart` and not pidusage, and why `TZ`/`LC_ALL` are pinned, is in the
  `getProcessLstart` doc comment. `lstart` survives sleep/wake: `launchd` still reported boot time
  after 12 days of uptime. The residual gap: two processes that start in the same wall-clock second
  cannot be told apart, so the reuse window is at most 1 s, not the fallback's 5 s.
- **Fallback.** The mtime path is a proxy. It stays only where no exact value exists; the reason is
  the comment at the end of [`index.ts` `recordIdentityEvidence`](../../../src/index.ts).

## Why the exact evidence exists

The mtime fallback fails wherever the wall clock and the uptime clock diverge. On WSL2 a host
suspend freezes `/proc/uptime` while the wall clock keeps running, so pidusage's
`timestamp - elapsed` lands hours after the real start and every live daemon reads as foreign:
`-e` spawns duplicates, and `-k`/`-s` refuse the daemon they started. Do not route an exact
platform back through the mtime path.

## Verdicts

- The verdict is `IdentityVerdict`; its doc comment owns what each `basis` means. Decide on `same`,
  never on `basis`.
- Handlers call [`index.ts` `isTrackedInstance`](../../../src/index.ts), not `isSameProcessInstance`
  directly. `basis: 'noPidFile'` comes only from `isTrackedInstance`'s early return, when the PID
  file cannot be stat'd; `isSameProcessInstance` never returns it.
- Every rejection message is composed by
  [`process.ts` `describeRejection`](../../../src/lib/process.ts), whose doc comment owns the wording
  rules. Its callers are `handleKill`, the stale-PID branch of `handleRun`, and `handleStatus`. A
  new rejection message goes into `describeRejection`, never at a call site.
- Reading a rejection: an mtime rejection with a delta of hours is the clock-drift signature above,
  not PID reuse.

## When evidence is recorded

- **Linux and macOS** record at spawn: `handleRun` passes `getProcessStartTicks(pid)` and
  `getProcessLstart(pid)` to `writePid`, and each returns null off its own platform.
- **Windows** records lazily, on the first successful verification, through
  [`index.ts` `recordIdentityEvidence`](../../../src/index.ts). Its doc comment gives the reason
  (the subprocess cost on the `-e` spawn path). Keep Windows evidence off the spawn path.
- `recordIdentityEvidence` also upgrades bare-PID files an older version left, so a process started
  by an older version becomes exact without a restart. It runs only on paths where the PID file
  survives: `-s`, `-p` and the `-e` skip branch. Never call it right before a kill, which deletes
  the file.
