import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import { $ } from "execa";
import type { Readable, Writable } from "node:stream";

interface LSProcOptions {
  lsCommand: string;
  lsArgs: string[];
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  onError?: (error: Error) => void;
  lsStdoutLogPath?: string;
  lsStderrLogPath?: string;
}

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

  constructor({
    lsCommand,
    lsArgs,
    onExit,
    onError,
    lsStdoutLogPath,
    lsStderrLogPath,
  }: LSProcOptions) {
    this.lsCommand = lsCommand;
    this.lsArgs = lsArgs;
    this.lsStdoutLogPath = lsStdoutLogPath;
    this.lsStderrLogPath = lsStderrLogPath;
    this.onExit = onExit;
    this.onError = onError;
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

  public async kill(): Promise<void> {
    if (!this.proc) return;

    try {
      this.proc.kill("SIGTERM");

      await new Promise<void>((resolve) => {
        this.proc!.once("exit", async () => {
          await this.onExit?.(this.proc?.exitCode || null, this.proc?.signalCode || null);
          resolve();
        });
      });
    } catch (error) {
      if (!(error instanceof Error)) {
        throw new Error(`Unknown error when killing process: ${error}`);
      }
      this.onError?.(error);
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
      if (!(Error.isError(error))) throw new Error(`Unknown error when spawning process: ${error}`);
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
      if (!(Error.isError(error))) {
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
      await this.onExit?.(code, signal);

      // Close log files
      this.stdoutLogFile?.end();
      this.stderrLogFile?.end();

      this.proc = null;
    });

    this.proc.on("error", async (error) => {
      await this.onError?.(error);
    });
  }
}
