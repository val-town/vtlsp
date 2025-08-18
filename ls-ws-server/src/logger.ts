/**
 * Logger module for the language server.
 *
 * Uses stderr since the language server operates via stdout.
 */
export const defaultLogger: Logger = {
  // (note the language server operates via stdout so we log to stderr)
  info: (...args: unknown[]) => {
    process.stderr.write(`[INFO] ${args.join(" ")}\n`);
  },
  warn: (...args: unknown[]) => {
    process.stderr.write(`[WARN] ${args.join(" ")}\n`);
  },
  error: (...args: unknown[]) => {
    process.stderr.write(`[ERROR] ${args.join(" ")}\n`);
  },
  debug: (...args: unknown[]) => {
    process.stderr.write(`[DEBUG] ${args.join(" ")}\n`);
  },
  trace: (...args: unknown[]) => {
    process.stderr.write(`[TRACE] ${args.join(" ")}\n`);
  },
};

/**
 * A no-operation logger that doesn't log.
 */
export const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
};

/**
 * Generic logger interface.
 */
export interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  trace: (...args: unknown[]) => void;
}
