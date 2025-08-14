import { LSProc } from "~/LSWSServer/procs/LSProc.js";
import { defaultLogger, type Logger } from "~/logger.js";

export interface LSProcManagerOptions {
  lsCommand: string;
  lsArgs: string[];
  maxProcs?: number;
  onProcError?: (sessionId: string, error: Error) => void;
  onProcExit?: (
    sessionId: string,
    code: number | null,
    signal: string | null,
    lsProc: LSProc,
  ) => void;
  lsStdoutLogPath?: string;
  lsStderrLogPath?: string;
  logger?: Logger;
}

/**
 * The LSProcManager manages Language Server processes for different sessions by session ID,
 * providing utility functions to spawn, release, and clean up these processes.
 */
export class LSProcManager {
  public readonly lsCommand: string;
  public readonly lsArgs: string[];
  public readonly procs: Map<string, LSProc>;
  public readonly maxProcs: number;
  public readonly lsStdoutLogPath?: string;
  public readonly lsStderrLogPath?: string;

  #logger: Logger;

  private onProcError?: (
    sessionId: string,
    error: Error,
  ) => void | Promise<void>;
  private onProcExit?: (
    sessionId: string,
    code: number | null,
    signal: NodeJS.Signals | null,
    lsProc: LSProc,
  ) => void | Promise<void>;

  constructor({
    lsCommand,
    lsArgs,
    lsStdoutLogPath,
    lsStderrLogPath,
    maxProcs = 0,
    onProcError,
    onProcExit,
    logger = defaultLogger,
  }: LSProcManagerOptions) {
    this.lsCommand = lsCommand;
    this.lsArgs = lsArgs;
    this.lsStdoutLogPath = lsStdoutLogPath;
    this.lsStderrLogPath = lsStderrLogPath;
    this.#logger = logger;

    this.procs = new Map<string, LSProc>();
    this.maxProcs = maxProcs;
    this.onProcError = onProcError;
    this.onProcExit = onProcExit;
  }

  /**
   * Retrieves the LS process for a given session ID, if it exists.
   *
   * @param sessionId The session ID for which to retrieve the LS process.
   * @returns The LSProc instance for the session, or null if not found.
   */
  public getProc(sessionId: string): LSProc | null {
    return this.procs.get(sessionId) ?? null;
  }

  /**
   * Retrieves an existing LS process for the given session ID, or spawns a new
   * one if it doesn't exist.
   *
   * @param sessionId The session ID for which to get or create the LS process.
   * @returns The LSProc instance for the session.
   */
  public getOrCreateProc(sessionId: string): LSProc {
    const existing = this.procs.get(sessionId);

    if (existing) {
      this.#logger.info(
        { sessionId, pid: existing.pid },
        "Reusing existing LS process",
      );
      return existing;
    }

    const lsProc = this.#spawn(sessionId);
    this.procs.set(sessionId, lsProc);

    this.#logger.info({ sessionId, pid: lsProc.pid }, "Spawning LS process");
    return lsProc;
  }

  /**
   * Releases the LS process for a given session ID. Kills the process if it exists, or
   * silently does nothing if no process is found for that session ID.
   *
   * @param sessionId The session ID for which to release the LS process.
   */
  public async releaseProc(sessionId: string): Promise<void> {
    const proc = this.procs.get(sessionId);

    if (proc) {
      this.#logger.info({ sessionId, pid: proc.pid }, "Releasing LS process");
      await proc.kill();
      this.procs.delete(sessionId);
    } else {
      this.#logger.warn({ sessionId }, "No LS process found to release");
    }
  }

  #spawn(sessionId: string): LSProc {
    const lsProc = new LSProc({
      lsCommand: this.lsCommand,
      lsArgs: this.lsArgs,
      onExit: async (code, signal) => {
        await this.onProcExit?.(sessionId, code, signal, lsProc);

        this.#logger.info({ sessionId, code }, "LS process exited");
        this.procs.delete(sessionId);
      },
      onError: async (error) => {
        await this.onProcError?.(sessionId, error);
      },
      lsStdoutLogPath: this.lsStdoutLogPath,
      lsStderrLogPath: this.lsStderrLogPath,
    });

    lsProc.spawn();

    this.#enforceMaxProcs();

    return lsProc;
  }

  #enforceMaxProcs() {
    if (this.maxProcs <= 0 || this.procs.size < this.maxProcs) {
      // -n will allow unlimited processes
      return;
    }

    // Sort processes by spawn time
    const processes = Array.from(this.procs.entries()).sort(
      ([, procA], [, procB]) => {
        const timeA = procA.spawnedAt?.getTime() || 0;
        const timeB = procB.spawnedAt?.getTime() || 0;
        return timeA - timeB;
      },
    );

    // Remove oldest processes until we're under the limit
    while (processes.length >= this.maxProcs) {
      const [sessionId, proc] = processes.shift()!;
      this.#logger.info(
        { sessionId, pid: proc.pid, spawnTime: proc.spawnedAt },
        "Killing oldest LS process to make room for new one",
      );
      proc.kill();
      this.procs.delete(sessionId);
    }
  }
}
