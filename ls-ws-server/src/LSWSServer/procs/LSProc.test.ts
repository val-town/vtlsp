import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { LSProc } from "./LSProc.ts";
import { LSProcManager } from "./LSProcManager.ts";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const node = process.execPath;

/** Resolve when the child exits (its internal completion handler runs first). */
const waitChildExit = async (proc: LSProc) => {
  const child = proc.proc;
  if (!child) return;
  await once(child, "exit");
  await delay(10); // let the async exit-chain microtasks settle
};

describe("LSProc.kill() (H4 regression)", () => {
  it("settles immediately when the process already exited before kill() (was: deadlock)", async () => {
    const proc = new LSProc({
      lsCommand: node,
      lsArgs: ["-e", "process.exit(1)"],
    });
    proc.spawn();
    await waitChildExit(proc);
    expect(proc.pid).toBeNull(); // tombstone cleared synchronously

    const start = Date.now();
    await proc.kill(); // previously hung forever on once('exit') of an exited proc
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });

  it("settles for a live process that exits on SIGTERM", async () => {
    const proc = new LSProc({
      lsCommand: node,
      lsArgs: ["-e", "setInterval(() => {}, 1000)"],
      killGraceMs: 1000,
    });
    proc.spawn();
    const start = Date.now();
    await proc.kill();
    expect(Date.now() - start).toBeLessThan(1000);
    await waitChildExit(proc);
  });

  it("escalates to SIGKILL for a process ignoring SIGTERM and still settles", async () => {
    const proc = new LSProc({
      lsCommand: node,
      lsArgs: [
        "-e",
        "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000);",
      ],
      killGraceMs: 150,
      killForceMs: 150,
    });
    proc.spawn();
    // Wait until the child registered its SIGTERM handler before signalling.
    await once(proc.stdout!, "data");
    const start = Date.now();
    await proc.kill();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(100); // waited out the SIGTERM grace period
    expect(elapsed).toBeLessThan(3000); // ... but did not hang
    await waitChildExit(proc);
  });

  it("invokes onExit exactly once (kill() no longer doubles it)", async () => {
    let exitCalls = 0;
    const proc = new LSProc({
      lsCommand: node,
      lsArgs: ["-e", "setInterval(() => {}, 1000)"],
      onExit: async () => {
        exitCalls++;
      },
    });
    proc.spawn();
    await proc.kill();
    await delay(50);
    expect(exitCalls).toBe(1);
  });
});

describe("LSProcManager tombstone handling (H4/M12)", () => {
  it("replaces a dead process on getOrCreateProc instead of reusing it", async () => {
    const manager = new LSProcManager({
      lsCommand: node,
      lsArgs: ["-e", "process.exit(1)"],
    });
    const first = manager.getOrCreateProc("sess-1");
    await waitChildExit(first);
    expect(first.pid).toBeNull();

    const second = manager.getOrCreateProc("sess-1");
    expect(second).not.toBe(first);
    expect(second.pid).not.toBeNull();
    await second.kill();
    await waitChildExit(second);
  });

  it("evicting an already-dead process settles (no leaked pending kill)", async () => {
    const manager = new LSProcManager({
      lsCommand: node,
      lsArgs: ["-e", "process.exit(1)"],
      maxProcs: 1,
    });
    const first = manager.getOrCreateProc("sess-2");
    await waitChildExit(first);
    // Spawning a second process triggers eviction of the (dead) first proc.
    const second = manager.getOrCreateProc("sess-3");
    await delay(50);
    expect(manager.procs.size).toBeLessThanOrEqual(1);
    await second.kill();
    await waitChildExit(second);
  });
});
