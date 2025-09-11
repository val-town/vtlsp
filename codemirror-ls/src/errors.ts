/**
 * Generic language server error. Could be client or server side.
 */

export class LSError extends Error {
  constructor(
    message: string,
    public code?: number,
  ) {
    super(message);
    this.name = "LSPError";
  }
}

/**
 * Error thrown when a requested feature is not supported by the language server.
 *
 * Usually it should be impossible to request features that are not supported.
 * It may happen if you use externally exported functions like
 * handleFindReferences directly when they are not supported.
 */
export class LSNotSupportedError extends LSError {
  constructor(message: string) {
    super(message);
    this.name = "LSNotSupportedError";
  }
}
