export class LSError extends Error {
  constructor(
    message: string,
    public code?: number,
  ) {
    super(message);
    this.name = "LSPError";
  }
}

export class LSLockTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LSLockTimeoutError";
  }
}
