/**
 * Generic language server error. Could be client or server side.
 */

import {
  REFERENCE_KIND_LABELS,
  type ReferenceKind,
} from "./extensions/references.js";

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

/**
 * Error thrown when a lock could not be acquired within a certain timeout.
 */
export class LSLockTimeoutError extends LSError {
  constructor(message: string) {
    super(message);
    this.name = "LSLockTimeoutError";
  }
}

/**
 * Error thrown when no references of a certain kind could be found.
 */
export class NoReferencesError extends Error {
  constructor(message: ReferenceKind) {
    super(message);
    this.name = "NoReferencesError";
    this.message = `No ${REFERENCE_KIND_LABELS[message]} found`;
  }
}
