import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import type { Readable, Writable } from "node:stream";
import { $ } from "execa";

interface LSProcOptions {
  /** command to run the LS process */
  lsCommand: string;
  /** Arguments to pass to the LS process */
  lsArgs: string[];
  /** Callback for when LS process exits */
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  /** Callback for when LS process errors  */
  onError?: (error: Error) => void;
  /**
   * File to stream stdout to.
   *
   * Useful since the LSP naturally communicates over stdout/stderr, so teeing
   * it to a file is often useful for debugging.
   **/
  lsStdoutLogPath?: string;
  /**
   * File to stream stderr to.
   *
   * Useful since the LSP naturally communicates over stdout/stderr, so teeing
   * it to a file is often useful for debugging.
   **/
  lsStderrLogPath?: string;
  /**
   * How long to wait after SIGTERM before escalating to SIGKILL, in ms.
   * Defaults to 5000.
   */
  killGraceMs?: number;
  /**
   * How long to wait after SIGKILL before giving up, in ms.
   * Defaults to 2000.
   */
  killForceMs?: number;
}

const DEFAULT_KILL_GRACE_MS = 5_000;
const DEFAULT_KILL_FORCE_MS = 2_000;

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The LSProc class manages a Language Server process, allowing for spawning,
 * killing, and logging of the process's output. It's a thin wrapper around
 * Node.js's ChildProcess, and exposes properties like .stdin, .stdout, and .stderr directly.
 */
export class LSProc {
  public proc: ChildProcess | null = null;
  public spawnedAt: Date | null = null;

  public readonly lsCommand: string;
  public readonly lsArgs: string[];
  public readonly lsStdoutLogPath?: string;
  public readonly lsStderrLogPath?: string;

  public readonly stdoutLogFile?: fs.WriteStream;
  public readonly stderrLogFile?: fs.WriteStream;

  public readonly onExit?: (
    code: number | null,
    signal: NodeJS.Signals | null,
  ) => void | Promise<void>;
  public readonly onError?: (error: Error) => void | Promise<void>;

  readonly #killGraceMs: number;
  readonly #killForceMs: number;

  /** Set synchronously when the child exits, before async cleanup completes. */
  #exited = false;

  constructor({
    lsCommand,
    lsArgs,
    onExit,
    onError,
    lsStdoutLogPath,
    lsStderrLogPath,
    killGraceMs = DEFAULT_KILL_GRACE_MS,
    killForceMs = DEFAULT_KILL_FORCE_MS,
  }: LSProcOptions) {
    this.lsCommand = lsCommand;
    this.lsArgs = lsArgs;
    this.lsStdoutLogPath = lsStdoutLogPath;
    this.lsStderrLogPath = lsStderrLogPath;
    this.onExit = onExit;
    this.onError = onError;
    this.#killGraceMs = killGraceMs;
    this.#killForceMs = killForceMs;
  }

  public get pid(): number | null {
    return this.proc?.pid ?? null;
  }

  public get stdin(): Writable | null {
    return this.proc?.stdin ?? null;
  }

  public get stdout(): Readable | null {
    return this.proc?.stdout ?? null;
  }

  public get stderr(): Readable | null {
    return this.proc?.stderr ?? null;
  }

  /**
   * Stop the managed process and settle — never hang.
   *
   * - If the process has already exited (`#exited` set, or Node reports an exit
   *   code), returns immediately: there is no future 'exit' event to await and
   *   the async `onExit` chain (which may itself call back into `kill()` via
   *   session cleanup) is left to complete on its own.
   * - Otherwise SIGTERM, wait up to `killGraceMs`, escalate to SIGKILL, wait up
   *   to `killForceMs`, then settle regardless. `onExit` is invoked exactly once,
   *   by the completion handler, not by `kill()`.
   */
  public async kill(): Promise<void> {
    const proc = this.proc;
    if (!proc) return;

    // Already exited (exit event fired — async cleanup may still be in flight,
    // e.g. `onExit` chains that call back into `kill()` via closeSession).
    if (this.#exited || proc.exitCode !== null || proc.signalCode !== null) {
      return;
    }

    let resolveExit: () => void = () => {};
    const exitPromise = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    const onExitListener = () => resolveExit();
    proc.once("exit", onExitListener);

    try {
      // Graceful stop first: SIGTERM, wait a bounded period.
      try {
        proc.kill("SIGTERM");
      } catch {
        // Signal not deliverable (process already gone); fall through to settle.
      }
      const exitedGracefully = await Promise.race([
        exitPromise.then(() => true as const),
        delay(this.#killGraceMs).then(() => false as const),
      ]);
      if (exitedGracefully) return;

      // Escalate to SIGKILL for processes ignoring SIGTERM; wait once more,
      // then settle regardless (the process is outside our control).
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore
      }
      await Promise.race([
        exitPromise.then(() => true as const),
        delay(this.#killForceMs).then(() => false as const),
      ]);
    } catch (error) {
      this.onError?.(new Error(`Unknown error when killing process: ${error}`));
    } finally {
      proc.removeListener("exit", onExitListener);
    }
  }

  public spawn(): void {
    try {
      this.proc = spawn(this.lsCommand, this.lsArgs, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.spawnedAt = new Date();

      this.#setupStdoutLogging();
      this.#setupStderrLogging();

      this.#registerProcCompletion();
    } catch (error) {
      if (!(error instanceof Error))
        throw new Error(`Unknown error when spawning process: ${error}`);
      this.onError?.(error);
    }
  }

  /**
   * Get the past n lines from stderr and stdout log files.
   *
   * @param n The number of lines to retrieve from the end of the log file.
   */
  public async getLogTail(n: number): Promise<[string, string]> {
    const stdoutTail = this.lsStdoutLogPath
      ? (await $("tail", ["-n", n.toString(), this.lsStdoutLogPath])).stdout
      : "";
    const stderrTail = this.lsStderrLogPath
      ? (await $("tail", ["-n", n.toString(), this.lsStderrLogPath])).stdout
      : "";

    return [stdoutTail, stderrTail];
  }

  #setupLoggingForStream(stream: Readable, logFilePath: string) {
    if (!stream || !logFilePath) return;

    try {
      const logFile = fs.createWriteStream(logFilePath, { flags: "a" });
      stream.pipe(logFile);
      return logFile;
    } catch (error) {
      if (!(error instanceof Error)) {
        throw new Error(`Unknown error when setting up logging: ${error}`);
      }
      this.onError?.(error);
      return null;
    }
  }

  #setupStdoutLogging() {
    if (!this.proc?.stdout || !this.lsStdoutLogPath) return;
    this.#setupLoggingForStream(this.proc.stdout, this.lsStdoutLogPath);
  }

  #setupStderrLogging() {
    if (!this.proc?.stderr || !this.lsStderrLogPath) return;
    this.#setupLoggingForStream(this.proc.stderr, this.lsStderrLogPath);
  }

  #registerProcCompletion() {
    if (!this.proc) return;

    this.proc.on("exit", async (code, signal) => {
      // Mark the child as gone synchronously and clear the handle BEFORE any
      // async cleanup: downstream code (reconnect liveness checks, kill(),
      // getOrCreateProc) must never observe a dead process as alive (H4:
      // session tombstoning) or await an 'exit' event that already fired.
      this.#exited = true;
      this.proc = null;

      await this.onExit?.(code, signal);

      // Close log files
      this.stdoutLogFile?.end();
      this.stderrLogFile?.end();
    });

    this.proc.on("error", async (error) => {
      await this.onError?.(error);
    });
  }
}
